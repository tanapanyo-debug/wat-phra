const { watOf, parseAmount, parseCitizenId, monkLabel, resolvePerson } = require("./duties");
const { thaiDigits } = require("./courses");

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max || 300);
}

function parseYearBe(v) {
  const n = parseInt(thaiDigits(String(v == null ? "" : v)).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return 0;
  if (n >= 2400 && n <= 2700) return n;
  if (n >= 1900 && n <= 2200) return n + 543;
  return 0;
}

function parseGrantCount(v) {
  const n = parseInt(thaiDigits(String(v == null ? "" : v)).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 1 || n > 999999) return null;
  return n;
}

function parseBaht(v) {
  return parseAmount(thaiDigits(String(v == null ? "" : v)));
}

function currentYearBe() {
  return new Date().getFullYear() + 543;
}

function lineTotal(count, each) {
  const n = Number(count) || 0;
  const a = Number(each) || 0;
  return Math.round(n * a * 100) / 100;
}

function scholarshipOut(r) {
  const grantCount = r.grant_count == null || r.grant_count === "" ? 0 : Number(r.grant_count);
  const amountEach = r.amount_each == null || r.amount_each === "" ? null : Number(r.amount_each);
  return {
    id: r.id,
    watName: r.wat_name || "",
    yearBe: r.year_be || 0,
    title: r.title || "",
    school: r.school || "",
    place: r.place || "",
    grantCount: grantCount,
    amountEach: amountEach,
    total: lineTotal(grantCount, amountEach),
    monkId: r.monk_id || null,
    citizenId: r.citizen_id || "",
    monkName: "",
    note: r.note || ""
  };
}

async function ensureScholarships(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wat_scholarships (
      id SERIAL PRIMARY KEY,
      wat_name TEXT NOT NULL DEFAULT '',
      given_on DATE,
      date_text TEXT NOT NULL DEFAULT '',
      year_be INTEGER NOT NULL DEFAULT 0,
      recipient TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      amount NUMERIC NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE wat_scholarships ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE wat_scholarships ADD COLUMN IF NOT EXISTS place TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE wat_scholarships ADD COLUMN IF NOT EXISTS grant_count INTEGER`);
  await pool.query(`ALTER TABLE wat_scholarships ADD COLUMN IF NOT EXISTS amount_each NUMERIC`);
  await pool.query(`ALTER TABLE wat_scholarships ADD COLUMN IF NOT EXISTS monk_id INTEGER REFERENCES monks(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE wat_scholarships ADD COLUMN IF NOT EXISTS citizen_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wat_scholarships_monk
    ON wat_scholarships (wat_name, monk_id, year_be DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wat_scholarships_citizen
    ON wat_scholarships (wat_name, citizen_id, year_be DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wat_scholarships_wat_year
    ON wat_scholarships (wat_name, year_be DESC, id ASC)`);
}

async function listScholarships(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  if (!watName) return { rows: [], needWat: true, yearBe: 0, grantCount: 0, totalAmount: 0 };
  const yearBe = parseYearBe(query && query.yearBe) || currentYearBe();
  const citizenId = parseCitizenId(query && query.citizenId);
  const params = [watName, yearBe];
  let sql = `SELECT s.*, m.chaya AS monk_chaya, m.sangha_name AS monk_sangha_name,
                    m.chaya_pali AS monk_chaya_pali, m.title AS monk_title,
                    m.person_type AS monk_person_type, m.former_name AS monk_former_name,
                    m.former_surname AS monk_former_surname, m.bio AS monk_bio
               FROM wat_scholarships s
               LEFT JOIN monks m ON (
                 (COALESCE(s.citizen_id,'') <> '' AND m.citizen_id = s.citizen_id)
                 OR (COALESCE(s.citizen_id,'') = '' AND m.id = s.monk_id)
               )
              WHERE s.wat_name=$1 AND s.year_be=$2`;
  if (citizenId) {
    params.push(citizenId);
    sql += " AND s.citizen_id=$" + params.length;
  }
  sql += " ORDER BY s.id ASC LIMIT 800";
  const r = await pool.query(sql, params);
  const rows = r.rows.map(function (row) {
    const out = scholarshipOut(row);
    if (row.monk_id || row.citizen_id) {
      out.monkName = monkLabel({
        id: row.monk_id,
        chaya: row.monk_chaya,
        sangha_name: row.monk_sangha_name,
        chaya_pali: row.monk_chaya_pali,
        title: row.monk_title,
        person_type: row.monk_person_type,
        former_name: row.monk_former_name,
        former_surname: row.monk_former_surname,
        bio: row.monk_bio
      });
    }
    return out;
  });
  let totalAmount = 0;
  let grantCount = 0;
  rows.forEach(function (row) {
    totalAmount += row.total;
    grantCount += row.grantCount || 0;
  });
  return {
    rows,
    needWat: false,
    watName,
    yearBe,
    grantCount,
    totalAmount: Math.round(totalAmount * 100) / 100
  };
}

async function addScholarship(pool, user, body) {
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  const yearBe = parseYearBe(body && body.yearBe) || currentYearBe();
  const person = await resolvePerson(pool, watName, body);
  const school = clean(body && body.school, 300);
  if (!school) throw Object.assign(new Error("กรอกโรงเรียน / สถานศึกษา"), { status: 400 });
  const grantCount = parseGrantCount(body && (body.grantCount || body.count));
  if (!grantCount) throw Object.assign(new Error("กรอกจำนวนทุน"), { status: 400 });
  const amountEach = parseBaht(body && (body.amountEach || body.amount));
  if (amountEach == null || amountEach <= 0) throw Object.assign(new Error("กรอกทุนละกี่บาท"), { status: 400 });
  const total = lineTotal(grantCount, amountEach);
  const r = await pool.query(
    `INSERT INTO wat_scholarships
      (wat_name, monk_id, citizen_id, year_be, title, school, place, grant_count, amount_each, amount, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      watName,
      person.monkId,
      person.citizenId,
      yearBe,
      clean(body && body.title, 300),
      school,
      clean(body && body.place, 300),
      grantCount,
      amountEach,
      total,
      clean(body && body.note, 400)
    ]
  );
  return scholarshipOut(r.rows[0]);
}

async function deleteScholarship(pool, user, id) {
  const n = Number(id);
  if (!n) throw Object.assign(new Error("ไม่พบรายการ"), { status: 400 });
  const watName = watOf(user, "");
  const params = [n];
  let sql = "DELETE FROM wat_scholarships WHERE id=$1";
  if (watName) {
    params.push(watName);
    sql += " AND wat_name=$2";
  }
  sql += " RETURNING id";
  const r = await pool.query(sql, params);
  if (!r.rowCount) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
  return { ok: true };
}

module.exports = {
  parseYearBe, parseGrantCount, parseBaht, currentYearBe, lineTotal, scholarshipOut,
  ensureScholarships, listScholarships, addScholarship, deleteScholarship
};
