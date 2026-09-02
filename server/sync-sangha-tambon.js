require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { findTemple, sanghaTambonName } = require("./lib/wats");

function readKey(file, key) {
  if (!fs.existsSync(file)) return "";
  const m = fs.readFileSync(file, "utf8").match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

const phraUrl = String(process.env.DATABASE_URL || "").trim();
if (!phraUrl || /wat_accounting|wat_audit/i.test(phraUrl)) {
  console.error("server/.env ต้องชี้ wat_phra");
  process.exit(1);
}

const auditUrl = readKey(path.join("D:", "WatAccounting", "ตรวจบัญชีวัด", "server", ".env"), "DATABASE_URL");
if (!auditUrl) {
  console.error("ไม่พบ DATABASE_URL ของตรวจบัญชีวัด");
  process.exit(1);
}

(async () => {
  const audit = new Pool({ connectionString: auditUrl, ssl: false });
  const phra = new Pool({ connectionString: phraUrl, ssl: false });
  try {
    const src = await audit.query(
      `SELECT name, district, sangha_tambon
         FROM audit_temples
        WHERE name <> '' AND sangha_tambon <> ''`
    );
    console.log("วัดจากตรวจบัญชีที่มีตำบลคณะสงฆ์", src.rowCount, "แห่ง");
    await phra.query(`
      CREATE TABLE IF NOT EXISTS phra_wats (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        district TEXT NOT NULL DEFAULT '',
        sangha_tambon TEXT NOT NULL DEFAULT ''
      )
    `);
    await phra.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS phra_wats_place
        ON phra_wats (lower(name), lower(district))
    `);
    await phra.query("ALTER TABLE monks ADD COLUMN IF NOT EXISTS sangha_tambon TEXT NOT NULL DEFAULT ''");
    await phra.query("ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS sangha_tambon TEXT NOT NULL DEFAULT ''");
    await phra.query("DELETE FROM phra_wats");
    const seen = {};
    for (const t of src.rows) {
      const key = String(t.name || "").toLowerCase() + "|" + String(t.district || "").toLowerCase();
      seen[key] = [t.name, t.district || "", sanghaTambonName(t.sangha_tambon)];
    }
    for (const row of Object.values(seen)) {
      await phra.query(
        `INSERT INTO phra_wats (name, district, sangha_tambon) VALUES ($1,$2,$3)`,
        row
      );
    }
    const temples = (await phra.query("SELECT id, name, district, sangha_tambon FROM phra_wats")).rows;
    const rains = await phra.query(
      `SELECT DISTINCT wat_name, district FROM monk_rains WHERE wat_name <> ''`
    );
    let matched = 0;
    let missing = 0;
    let amb = 0;
    for (const row of rains.rows) {
      const hit = findTemple(row.wat_name, row.district || "พระนครศรีอยุธยา", temples);
      if (hit.temple && hit.temple.sangha_tambon) {
        await phra.query(
          `UPDATE monk_rains SET sangha_tambon=$1
            WHERE wat_name=$2 AND (district=$3 OR $3='')`,
          [hit.temple.sangha_tambon, row.wat_name, row.district || ""]
        );
        await phra.query(
          `UPDATE monks SET sangha_tambon=$1
            WHERE wat_name=$2 AND (sangha_tambon='' OR sangha_tambon IS NULL)`,
          [hit.temple.sangha_tambon, row.wat_name]
        );
        matched += 1;
      } else if (hit.reason === "ambiguous") amb += 1;
      else missing += 1;
    }
    const filled = await phra.query(
      `SELECT count(*)::int AS n FROM monk_rains WHERE year_be=2568 AND sangha_tambon <> ''`
    );
    const empty = await phra.query(
      `SELECT count(*)::int AS n FROM monk_rains WHERE year_be=2568 AND sangha_tambon = ''`
    );
    const tambons = await phra.query(
      `SELECT count(distinct sangha_tambon)::int AS n FROM monk_rains WHERE year_be=2568 AND sangha_tambon <> ''`
    );
    console.log("จับคู่ชื่อวัด", "ได้", matched, "คลุมเครือ", amb, "ไม่เจอ", missing);
    console.log("จำพรรษา 2568 มีตำบลคณะสงฆ์", filled.rows[0].n, "ยังไม่มี", empty.rows[0].n, "ตำบล", tambons.rows[0].n);
  } finally {
    await audit.end();
    await phra.end();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
