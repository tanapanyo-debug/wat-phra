require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { withWatPrefix, normTemple, districtName, findTemple } = require("./lib/wats");
const { expandCourses, upsertCourse, ensureCourses } = require("./lib/courses");

const DRY = process.argv.includes("--dry-run");
const YEAR_BE = Number(process.argv.find((a) => a.startsWith("--year="))?.slice(7) || 2566);
const file = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || path.join(process.env.TEMP || "C:\\Temp", "phra-src", "dhammaduta-line2-ayutthaya.txt");
const AMPHOE = "พระนครศรีอยุธยา";

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
  if (!s || s === "-" || s === "–") return "";
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

function readTsv(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = (buf[0] === 0xFF && buf[1] === 0xFE ? buf.toString("utf16le") : buf.toString("utf8")).replace(/^\uFEFF/, "");
  return text.split(/\r?\n/).map((line) => line.split("\t").map((c) => String(c || "").replace(/\s+/g, " ").trim()));
}

function amphoeOk(v) {
  const d = districtName(thaiDigits(v)).replace(/เมือง/, "");
  return d === AMPHOE || d === "เมือง" + AMPHOE;
}

function parseRows(aoa) {
  const out = [];
  let skippedOtherAmphoe = 0;
  for (let i = 0; i < aoa.length; i++) {
    const c = aoa[i];
    const name = dash(c[1]);
    const pali = dash(c[2]);
    if (!name || name === "ชื่อ" || name === "ฉายา" || name.indexOf("บัญชี") === 0 || name.indexOf("รายชื่อ") === 0) continue;
    const seq = intOrNull(c[0], 1, 9999);
    if (!seq && i < 6) continue;
    const amphoe = dash(c[10]);
    if (!amphoeOk(amphoe)) {
      if (amphoe) skippedOtherAmphoe += 1;
      continue;
    }
    const provRaw = dash(c[11]);
    const dhammayut = /\(ธ\)/.test(provRaw);
    const province = districtName(provRaw.replace(/\(ธ\)/g, ""));
    const wat = withWatPrefix(c[8]);
    const bits = ["พระธรรมทูตฝ่ายปฏิบัติการ สายที่ ๒"];
    if (dash(c[12])) bits.push("อบรม " + dash(c[12]));
    if (dash(c[14])) bits.push(dash(c[14]));
    out.push({
      person_type: name.indexOf("สามเณร") === 0 ? "สามเณร" : "ภิกษุ",
      name,
      chaya_pali: pali.slice(0, 80),
      chaya: (name + (pali ? " " + pali : "")).slice(0, 120),
      wat_name: wat.slice(0, 160),
      tambon: dash(c[9]).slice(0, 80),
      district: AMPHOE,
      province: province || AMPHOE,
      nikaya: dhammayut ? "ธรรมยุต" : "มหานิกาย",
      status: "จำพรรษา",
      note: bits.join(" · ").slice(0, 800),
      age: intOrNull(c[3], 1, 130),
      vassa: intOrNull(c[4], 0, 100),
      naktham: dash(c[5]).slice(0, 40),
      pali: dash(c[6]).slice(0, 40),
      secular: dash(c[7]).slice(0, 80),
      trained: dash(c[12]).slice(0, 80),
      courses: expandCourses(c[12], "", "ปีที่แต่งตั้ง")
    });
  }
  return { rows: out, skippedOtherAmphoe };
}

function mergeBio(existing, src) {
  const bio = existing && typeof existing === "object" ? { ...existing } : {};
  if (!bio.specialWork) bio.specialWork = "พระธรรมทูตฝ่ายปฏิบัติการ";
  if (!bio.specialRole) bio.specialRole = "สายที่ ๒";
  if (src.trained && !bio.specialOn) bio.specialOn = src.trained;
  if (!bio.specialDetail) bio.specialDetail = src.note;
  if (src.naktham && !bio.dhammaLevel) bio.dhammaLevel = src.naktham;
  if (src.pali && !bio.paliLevel) bio.paliLevel = src.pali;
  if (src.secular && !bio.secularLevel) bio.secularLevel = src.secular;
  return bio;
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

(async () => {
  if (!fs.existsSync(file)) {
    console.error("ไม่พบไฟล์นำเข้า");
    process.exit(1);
  }
  const { rows, skippedOtherAmphoe } = parseRows(readTsv(file));
  console.log("อำเภอพระนครศรีอยุธยา", rows.length, "รูป · ข้ามอำเภออื่น", skippedOtherAmphoe, DRY ? "(ทดลอง ไม่บันทึก)" : "");
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  let matched = 0;
  let inserted = 0;
  let ambiguous = 0;
  try {
    const monks = (await client.query(
      `SELECT id, chaya, chaya_pali, wat_name, tambon, district, bio, is_dhammaduta, sangha_tambon
         FROM monks`
    )).rows;
    const temples = (await client.query("SELECT id, name, district, sangha_tambon FROM phra_wats")).rows;
    await ensureCourses(client);
    if (!DRY) await client.query("BEGIN");
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
          const bio = mergeBio(hit.monk.bio, r);
          await client.query(
            `UPDATE monks SET is_dhammaduta=true, chaya_pali=COALESCE(NULLIF(chaya_pali,''), $2),
                nikaya=COALESCE(NULLIF(nikaya,''), $3),
                sangha_tambon=COALESCE(NULLIF(sangha_tambon,''), $4),
                bio=$5, updated_at=now()
              WHERE id=$1`,
            [id, r.chaya_pali, r.nikaya, sangha, bio]
          );
          hit.monk.is_dhammaduta = true;
        }
      } else {
        inserted += 1;
        if (!DRY) {
          const ins = await client.query(
            `INSERT INTO monks (person_type, chaya, former_name, former_surname, title, nikaya,
               wat_name, tambon, sangha_tambon, district, province, chaya_pali, status, note, bio, is_dhammaduta)
             VALUES ($1,$2,'','','',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
             RETURNING id, chaya, chaya_pali, wat_name, tambon, district, bio, is_dhammaduta, sangha_tambon`,
            [r.person_type, r.chaya, r.nikaya, r.wat_name, r.tambon, sangha, r.district, r.province,
              r.chaya_pali, r.status, r.note, mergeBio({}, r)]
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
      if (id && !DRY) {
        for (const c of r.courses || []) await upsertCourse(client, id, "ธรรมทูต", c);
      }
    }
    if (!DRY) {
      await client.query("COMMIT");
      const tot = await client.query("SELECT count(*)::int AS n FROM monks WHERE is_dhammaduta");
      console.log("จับคู่ของเดิม", matched, "เพิ่มใหม่", inserted, "คลุมเครือข้าม", ambiguous, "ธรรมทูตในฐานทั้งสิ้น", tot.rows[0].n);
    } else {
      console.log("จับคู่ของเดิม", matched, "จะเพิ่มใหม่", inserted, "คลุมเครือข้าม", ambiguous);
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
