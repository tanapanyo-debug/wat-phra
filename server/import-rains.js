require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const YEAR_BE = Number(process.argv.find((a) => a.startsWith("--year="))?.slice(7) || 2568);
const file = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || path.join(process.env.TEMP, "phra-src", "rains2568.txt");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  console.error("ยังไม่มี DATABASE_URL ใน server/.env");
  process.exit(1);
}
if (/wat_accounting|wat_audit/i.test(DATABASE_URL)) {
  console.error("ฐานนี้ต้องเป็น wat_phra");
  process.exit(1);
}

function readTsv(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = (buf[0] === 0xFF && buf[1] === 0xFE ? buf.toString("utf16le") : buf.toString("utf8")).replace(/^\uFEFF/, "");
  return text.split(/\r?\n/).map((line) => line.split("\t").map((c) => String(c || "").replace(/\s+/g, " ").trim()));
}

function intOrNull(v, min, max) {
  const n = parseInt(String(v || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  if (min != null && n < min) return null;
  if (max != null && n > max) return null;
  return n;
}

function dash(v) {
  const s = String(v || "").trim();
  if (!s || s === "-") return "";
  return s;
}

function withWat(name) {
  const s = dash(name);
  if (!s) return "";
  if (/^วัด/.test(s)) return s.slice(0, 160);
  return ("วัด" + s).slice(0, 160);
}

function titleFromNote(note) {
  const s = String(note || "").replace(/\s+/g, "");
  if (!s || s === "-" || /^วัด/.test(s)) return "";
  if (s.indexOf("นวกะ") >= 0) return "นวกะ";
  if (/ผจล|ผจร/.test(s)) return "ผู้ช่วยเจ้าอาวาส";
  if (/รจล/.test(s)) return "รองเจ้าอาวาส";
  if (/รก/.test(s)) return "รักษาการเจ้าอาวาส";
  if (/จล|จร/.test(s)) return "เจ้าอาวาส";
  return "";
}

function parseRows(aoa) {
  const out = [];
  for (let i = 0; i < aoa.length; i++) {
    const c = aoa[i];
    const name = dash(c[1]);
    const chayaPali = dash(c[2]);
    if (!name || name === "ชื่อ" || name.indexOf("บัญชี") === 0) continue;
    const seq = intOrNull(c[0], 1, 9999);
    if (!seq && i < 6) continue;
    const noteRaw = dash(c[19]);
    const title = titleFromNote(noteRaw);
    const chaya = (name + (chayaPali ? " " + chayaPali : "")).slice(0, 120);
    const bits = [];
    const born = intOrNull(c[6], 2400, 2700);
    if (born) bits.push("เกิด พ.ศ." + born);
    if (dash(c[7])) bits.push("จ." + dash(c[7]));
    if (dash(c[8])) bits.push("สามัญ " + dash(c[8]));
    if (dash(c[11])) bits.push("นธ." + dash(c[11]) + (dash(c[12]) ? " ปี" + dash(c[12]) : "") + (dash(c[13]) ? " " + dash(c[13]) : "") + (dash(c[14]) ? " " + dash(c[14]) : ""));
    if (dash(c[15])) bits.push("ป.ธ." + dash(c[15]) + (dash(c[16]) ? " ปี" + dash(c[16]) : "") + (dash(c[17]) ? " " + dash(c[17]) : "") + (dash(c[18]) ? " " + dash(c[18]) : ""));
    if (noteRaw && !/^วัด/.test(noteRaw) && noteRaw !== "-") bits.push(noteRaw);
    out.push({
      person_type: name.indexOf("สามเณร") === 0 ? "สามเณร" : "ภิกษุ",
      chaya,
      former_surname: dash(c[3]).slice(0, 120),
      title: title.slice(0, 160),
      wat_name: withWat(c[9]),
      tambon: dash(c[10]).slice(0, 80),
      district: "พระนครศรีอยุธยา",
      province: "พระนครศรีอยุธยา",
      status: "จำพรรษา",
      note: bits.join(" · ").slice(0, 800),
      age: intOrNull(c[4], 1, 130),
      vassa: intOrNull(c[5], 0, 100)
    });
  }
  return out;
}

(async () => {
  if (!fs.existsSync(file)) {
    console.error("ไม่พบไฟล์นำเข้า");
    process.exit(1);
  }
  const rows = parseRows(readTsv(file));
  console.log("จะนำเข้า", rows.length, "รูป ปี", YEAR_BE);
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      if (!r.chaya) continue;
      const found = await client.query(
        `SELECT id FROM monks
         WHERE chaya=$1 AND wat_name=$2 AND former_surname=$3
         LIMIT 1`,
        [r.chaya, r.wat_name, r.former_surname]
      );
      let id;
      if (found.rowCount) {
        id = found.rows[0].id;
        await client.query(
          `UPDATE monks SET person_type=$2, title=$3, tambon=$4, district=$5, province=$6,
             status=$7, note=$8, updated_at=now()
           WHERE id=$1`,
          [id, r.person_type, r.title, r.tambon, r.district, r.province, r.status, r.note]
        );
        updated += 1;
      } else {
        const ins = await client.query(
          `INSERT INTO monks (person_type, chaya, former_name, former_surname, title,
             wat_name, tambon, district, province, status, note)
           VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [r.person_type, r.chaya, r.former_surname, r.title, r.wat_name, r.tambon, r.district, r.province, r.status, r.note]
        );
        id = ins.rows[0].id;
        inserted += 1;
      }
      await client.query(
        `INSERT INTO monk_rains (monk_id, year_be, wat_name, tambon, district, province, age, vassa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (monk_id, year_be) DO UPDATE SET
           wat_name=EXCLUDED.wat_name, tambon=EXCLUDED.tambon, district=EXCLUDED.district,
           province=EXCLUDED.province, age=EXCLUDED.age, vassa=EXCLUDED.vassa`,
        [id, YEAR_BE, r.wat_name, r.tambon, r.district, r.province, r.age, r.vassa]
      );
    }
    await client.query("COMMIT");
    const tot = await client.query("SELECT count(*)::int AS n FROM monk_rains WHERE year_be=$1", [YEAR_BE]);
    console.log("เพิ่มใหม่", inserted, "อัปเดต", updated, "บัญชีจำพรรษาปี", YEAR_BE, "=", tot.rows[0].n, "รูป");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
