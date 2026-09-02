require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { withWatPrefix, normTemple, districtName, findTemple } = require("./lib/wats");
const { expandCourses, upsertCourse, ensureCourses } = require("./lib/courses");

const DRY = process.argv.includes("--dry-run");
const YEAR_BE = Number(process.argv.find((a) => a.startsWith("--year="))?.slice(7) || 2566);
const TEMP = process.env.TEMP || "C:\\Temp";
const AMPHOE = "พระนครศรีอยุธยา";
const SRC = {
  preacher: path.join(TEMP, "phra-src", "preacher-s1.txt"),
  vipassana: path.join(TEMP, "phra-src", "vipassana-s1.txt"),
  vipassana2: path.join(TEMP, "phra-src", "vipassana-s2.txt")
};

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  console.error("ยังไม่มี DATABASE_URL ใน server/.env");
  process.exit(1);
}
if (/wat_accounting|wat_audit/i.test(DATABASE_URL)) {
  console.error("ฐานนี้ต้องเป็น wat_phra");
  process.exit(1);
}

function thaiDigits(s) {
  const map = { "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };
  return String(s || "").replace(/[๐-๙]/g, (ch) => map[ch] || ch);
}
function dash(v) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–" || s === "—") return "";
  return s;
}
function compact(s) {
  return String(s || "").replace(/\s+/g, "").replace(/[.]/g, "").toLowerCase();
}
function intOrNull(v, min, max) {
  const n = parseInt(thaiDigits(v).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  if (min != null && n < min) return null;
  if (max != null && n > max) return null;
  return n;
}
function amphoeOk(v) {
  const d = districtName(thaiDigits(v)).replace(/เมือง/, "");
  return d === AMPHOE || d === "เมือง" + AMPHOE;
}
function readTsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const buf = fs.readFileSync(filePath);
  const text = (buf[0] === 0xFF && buf[1] === 0xFE ? buf.toString("utf16le") : buf.toString("utf8")).replace(/^\uFEFF/, "");
  return text.split(/\r?\n/).map((line) => line.split("\t").map((c) => String(c || "").replace(/\s+/g, " ").trim()));
}
function findMonk(src, monks) {
  const wantChaya = compact(src.chaya);
  const wantName = compact(src.name);
  const wantPali = compact(src.chaya_pali);
  const wantWat = normTemple(src.wat_name);
  const scored = [];
  for (const m of monks) {
    const ch = compact(m.chaya);
    const pali = compact(m.chaya_pali);
    const wat = normTemple(m.wat_name);
    let score = 0;
    if (wantChaya && ch === wantChaya) score += 8;
    else if (wantName && ch.indexOf(wantName) >= 0) score += 5;
    else if (wantPali && (ch.indexOf(wantPali) >= 0 || pali === wantPali)) score += 3;
    else continue;
    if (wantWat && wat && (wat === wantWat || wat.indexOf(wantWat) >= 0 || wantWat.indexOf(wat) >= 0)) score += 4;
    else if (wantWat && wat) score -= 2;
    scored.push({ m, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return { monk: null, how: "missing" };
  if (scored[0].score < 5) return { monk: null, how: "weak" };
  if (scored.length > 1 && scored[1].score === scored[0].score) return { monk: null, how: "ambiguous" };
  return { monk: scored[0].m, how: scored[0].score >= 12 ? "exact" : "fuzzy" };
}

function parseRegister(aoa, kindLabel) {
  const out = [];
  let skippedOtherAmphoe = 0;
  let last = null;
  for (let i = 0; i < aoa.length; i++) {
    const c = aoa[i];
    const name = dash(c[1]);
    const pali = dash(c[2]);
    const trained = dash(c[15]);
    const place = dash(c[16]);
    const remark = dash(c[17]);
    if (!name || name === "ชื่อ" || name === "ฉายา" || name.indexOf("ทะเบียน") === 0 || name.indexOf("บัญชี") === 0) {
      if (last && (trained || place)) last.courses = (last.courses || []).concat(expandCourses(trained, place, remark));
      continue;
    }
    const seq = intOrNull(c[0], 1, 9999);
    if (!seq) continue;
    const amphoe = dash(c[13]);
    if (!amphoeOk(amphoe)) {
      last = null;
      if (amphoe) skippedOtherAmphoe += 1;
      continue;
    }
    const provRaw = dash(c[14]);
    const dhammayut = /\(ธ\)/.test(provRaw);
    const province = districtName(provRaw.replace(/\(ธ\)/g, ""));
    const bits = [kindLabel];
    if (trained) bits.push("อบรม " + trained);
    if (place) bits.push(place);
    if (remark) bits.push(remark);
    const otherEdu = [dash(c[7]), dash(c[8]), dash(c[9]), dash(c[10])].filter(Boolean).join(" ");
    const row = {
      person_type: name.indexOf("สามเณร") === 0 ? "สามเณร" : "ภิกษุ",
      name,
      chaya_pali: pali.slice(0, 80),
      chaya: (name + (pali ? " " + pali : "")).slice(0, 120),
      wat_name: withWatPrefix(c[11]).slice(0, 160),
      tambon: dash(c[12]).slice(0, 80),
      district: AMPHOE,
      province: province || AMPHOE,
      nikaya: dhammayut ? "ธรรมยุต" : "มหานิกาย",
      status: "จำพรรษา",
      note: bits.join(" · ").slice(0, 800),
      age: intOrNull(c[3], 1, 130),
      vassa: intOrNull(c[4], 0, 100),
      naktham: dash(c[5]).slice(0, 40),
      pali: dash(c[6]).slice(0, 40),
      secular: otherEdu.slice(0, 80),
      trained: trained.slice(0, 80),
      place: place.slice(0, 160),
      courses: expandCourses(trained, place, remark)
    };
    out.push(row);
    last = row;
  }
  return { rows: out, skippedOtherAmphoe };
}

function mergeBio(existing, src, kind) {
  const bio = existing && typeof existing === "object" ? { ...existing } : {};
  if (kind === "preacher") {
    if (!bio.sixType) bio.sixType = "พระนักเทศน์";
  } else if (!bio.sixType) {
    bio.sixType = "พระวิปัสสนาจารย์";
  }
  if (src.trained && !bio.sixOn) bio.sixOn = src.trained;
  if (src.place && !bio.sixDetail) bio.sixDetail = src.place;
  if (src.naktham && !bio.dhammaLevel) bio.dhammaLevel = src.naktham;
  if (src.pali && !bio.paliLevel) bio.paliLevel = src.pali;
  if (src.secular && !bio.secularLevel) bio.secularLevel = src.secular;
  return bio;
}

function mergeNote(old, extra) {
  const a = dash(old);
  const b = dash(extra);
  if (!b) return a;
  if (a.indexOf(b.slice(0, Math.min(18, b.length))) >= 0) return a;
  return [a, b].filter(Boolean).join(" · ").slice(0, 800);
}

async function applyKind(client, monks, temples, rows, kind, flagCol) {
  const kindName = kind === "preacher" ? "นักเทศน์" : "วิปัสสนาจารย์";
  let matched = 0;
  let inserted = 0;
  let ambiguous = 0;
  let courses = 0;
  for (const r of rows) {
    const hit = findMonk(r, monks);
    const temple = findTemple(r.wat_name, r.district, temples);
    const sangha = (temple.temple && temple.temple.sangha_tambon) || "";
    if (hit.how === "ambiguous") {
      ambiguous += 1;
      continue;
    }
    let id;
    if (hit.monk) {
      matched += 1;
      id = hit.monk.id;
      if (!DRY) {
        const bio = mergeBio(hit.monk.bio, r, kind);
        const note = mergeNote(hit.monk.note, r.note);
        await client.query(
          `UPDATE monks SET ${flagCol}=true, chaya_pali=COALESCE(NULLIF(chaya_pali,''), $2),
              nikaya=COALESCE(NULLIF(nikaya,''), $3),
              sangha_tambon=COALESCE(NULLIF(sangha_tambon,''), $4),
              bio=$5, note=$6, updated_at=now()
            WHERE id=$1`,
          [id, r.chaya_pali, r.nikaya, sangha, bio, note]
        );
        hit.monk[flagCol] = true;
        hit.monk.bio = bio;
        hit.monk.note = note;
      }
    } else {
      inserted += 1;
      if (!DRY) {
        const ins = await client.query(
          `INSERT INTO monks (person_type, chaya, former_name, former_surname, title, nikaya,
             wat_name, tambon, sangha_tambon, district, province, chaya_pali, status, note, bio, ${flagCol})
           VALUES ($1,$2,'','','',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
           RETURNING id, chaya, chaya_pali, wat_name, tambon, district, bio, note, sangha_tambon,
             is_dhammaduta, is_preacher, is_vipassana`,
          [r.person_type, r.chaya, r.nikaya, r.wat_name, r.tambon, sangha, r.district, r.province,
            r.chaya_pali, r.status, r.note, mergeBio({}, r, kind)]
        );
        monks.push(ins.rows[0]);
        id = ins.rows[0].id;
        const rainYears = [YEAR_BE];
        if (YEAR_BE !== 2568) rainYears.push(2568);
        for (const y of rainYears) {
          await client.query(
            `INSERT INTO monk_rains (monk_id, year_be, wat_name, tambon, sangha_tambon, district, province, age, vassa)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (monk_id, year_be) DO UPDATE SET
               wat_name=EXCLUDED.wat_name, tambon=EXCLUDED.tambon, sangha_tambon=EXCLUDED.sangha_tambon,
               district=EXCLUDED.district, province=EXCLUDED.province, age=EXCLUDED.age, vassa=EXCLUDED.vassa`,
            [id, y, r.wat_name, r.tambon, sangha, r.district, r.province, r.age, r.vassa]
          );
        }
      }
    }
    if (DRY) {
      courses += (r.courses || []).length;
    } else if (id) {
      for (const c of r.courses || []) {
        await upsertCourse(client, id, kindName, c);
        courses += 1;
      }
    }
  }
  return { matched, inserted, ambiguous, courses };
}

(async () => {
  const preacher = parseRegister(readTsv(SRC.preacher), "พระนักเทศน์");
  const vip1 = parseRegister(readTsv(SRC.vipassana), "พระวิปัสสนาจารย์");
  const vip2 = parseRegister(readTsv(SRC.vipassana2), "พระวิปัสสนาจารย์");
  const vipRows = vip1.rows.concat(vip2.rows);
  console.log(
    "นักเทศน์ อ.พระนครศรีอยุธยา", preacher.rows.length, "ข้ามอำเภออื่น", preacher.skippedOtherAmphoe,
    "· วิปัสสนา", vipRows.length, "ข้ามอำเภออื่น", vip1.skippedOtherAmphoe + vip2.skippedOtherAmphoe,
    DRY ? "(ทดลอง ไม่บันทึก)" : ""
  );
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  try {
    await client.query("ALTER TABLE monks ADD COLUMN IF NOT EXISTS is_preacher BOOLEAN NOT NULL DEFAULT false");
    await client.query("ALTER TABLE monks ADD COLUMN IF NOT EXISTS is_vipassana BOOLEAN NOT NULL DEFAULT false");
    await ensureCourses(client);
    const monks = (await client.query(
      `SELECT id, chaya, chaya_pali, wat_name, tambon, district, bio, note, sangha_tambon,
              is_dhammaduta, is_preacher, is_vipassana FROM monks`
    )).rows;
    const temples = (await client.query("SELECT id, name, district, sangha_tambon FROM phra_wats")).rows;
    if (!DRY) await client.query("BEGIN");
    const a = await applyKind(client, monks, temples, preacher.rows, "preacher", "is_preacher");
    const b = await applyKind(client, monks, temples, vipRows, "vipassana", "is_vipassana");
    if (!DRY) {
      await client.query("COMMIT");
      const tot = await client.query(
        `SELECT count(*) FILTER (WHERE is_preacher)::int AS preacher,
                count(*) FILTER (WHERE is_vipassana)::int AS vipassana FROM monks`
      );
      console.log("นักเทศน์ จับคู่", a.matched, "เพิ่มใหม่", a.inserted, "คลุมเครือ", a.ambiguous, "รายการอบรม", a.courses, "ในฐาน", tot.rows[0].preacher);
      console.log("วิปัสสนา จับคู่", b.matched, "เพิ่มใหม่", b.inserted, "คลุมเครือ", b.ambiguous, "รายการอบรม", b.courses, "ในฐาน", tot.rows[0].vipassana);
    } else {
      console.log("นักเทศน์ จับคู่", a.matched, "จะเพิ่มใหม่", a.inserted, "คลุมเครือ", a.ambiguous, "รายการอบรม", a.courses);
      console.log("วิปัสสนา จับคู่", b.matched, "จะเพิ่มใหม่", b.inserted, "คลุมเครือ", b.ambiguous, "รายการอบรม", b.courses);
    }
  } catch (e) {
    if (!DRY) try { await client.query("ROLLBACK"); } catch (x) {}
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
