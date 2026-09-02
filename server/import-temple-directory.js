require("dotenv").config();
const path = require("path");
const { Pool } = require("pg");
const { ensureTempleDir, importTemples, readTemplesFromXlsx, templeCount } = require("./lib/templeDir");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  console.error("ยังไม่ได้ตั้ง DATABASE_URL ใน server/.env");
  process.exit(1);
}

const xlsx = process.argv[2] || path.join(
  process.env.USERPROFILE || "",
  "Downloads",
  "Report_Temple (1).xlsx"
);

async function main() {
  const fs = require("fs");
  if (!fs.existsSync(xlsx)) {
    console.error("ไม่พบไฟล์", xlsx);
    process.exit(1);
  }
  console.log("อ่าน", xlsx);
  const temples = readTemplesFromXlsx(xlsx);
  console.log("ได้", temples.length, "วัด");
  const pool = new Pool({ connectionString: DATABASE_URL });
  await ensureTempleDir(pool);
  await pool.query("TRUNCATE temple_directory RESTART IDENTITY");
  const n = await importTemples(pool, temples);
  const count = await templeCount(pool);
  const prov = await pool.query("SELECT COUNT(DISTINCT province)::int AS n FROM temple_directory WHERE province <> ''");
  const dist = await pool.query("SELECT COUNT(DISTINCT (province, district))::int AS n FROM temple_directory WHERE district <> ''");
  console.log("บันทึก", n, "แถว · ในฐาน", count, "วัด ·", prov.rows[0].n, "จังหวัด ·", dist.rows[0].n, "อำเภอ");
  console.log("ตำบลคณะสงฆ์ไม่ได้ปูทั้งประเทศ — ตั้งทีหลังเฉพาะจังหวัด/อำเภอที่ใช้งาน");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
