function dash(v) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–" || s === "—") return "";
  return s;
}

function thaiDigits(s) {
  const map = { "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };
  return String(s || "").replace(/[๐-๙]/g, (ch) => map[ch] || ch);
}

const COURSE_KINDS = ["ธรรมทูต", "นักเทศน์", "วิปัสสนาจารย์", "ปริยัตินิเทศน์", "บัณฑิตเผยแผ่", "อบรม"];
const COURSE_ALIASES = {
  "วิปัสนาจารย์": "วิปัสสนาจารย์",
  "พระวิปัสนาจารย์": "วิปัสสนาจารย์",
  "พระวิปัสสนาจารย์": "วิปัสสนาจารย์",
  "ปริยัตินิเทศก์": "ปริยัตินิเทศน์",
  "พระปริยัตินิเทศก์": "ปริยัตินิเทศน์",
  "พระปริยัตินิเทศน์": "ปริยัตินิเทศน์",
  "พระบัณฑิตเผยแผ่": "บัณฑิตเผยแผ่",
  "พระธรรมทูต": "ธรรมทูต",
  "พระนักเทศน์": "นักเทศน์"
};

function normalizeCourseKind(raw) {
  const s = dash(raw).slice(0, 40);
  if (!s) return "";
  if (COURSE_ALIASES[s]) return COURSE_ALIASES[s];
  const bare = s.replace(/^พระ/, "");
  if (COURSE_ALIASES[bare]) return COURSE_ALIASES[bare];
  if (COURSE_KINDS.indexOf(s) >= 0) return s;
  if (COURSE_KINDS.indexOf(bare) >= 0) return bare;
  return s;
}

function splitYearText(s) {
  const raw = dash(s);
  if (!raw) return [""];
  const t = thaiDigits(raw);
  const bits = t.split(/\s*และ\s*|\s*,\s*/).map((x) => dash(x)).filter(Boolean);
  return bits.length ? bits : [t];
}

function expandCourses(year, place, note) {
  const years = splitYearText(year);
  const ys = years.length ? years : [""];
  const p = dash(place).slice(0, 200);
  const n = dash(note).slice(0, 200);
  return ys.map((y) => ({
    year_text: String(y || "").slice(0, 80),
    place: p,
    note: n
  })).filter((c) => c.year_text || c.place);
}

function courseOut(r) {
  return {
    id: r.id,
    kind: r.kind,
    yearText: r.year_text || "",
    place: r.place || "",
    note: r.note || ""
  };
}

async function ensureCourses(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS monk_courses (
      id SERIAL PRIMARY KEY,
      monk_id INTEGER NOT NULL REFERENCES monks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      year_text TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS monk_courses_uniq
      ON monk_courses (monk_id, kind, year_text, place)
  `);
}

async function upsertCourse(client, monkId, kind, c) {
  const yearText = dash(c.year_text || c.yearText).slice(0, 80);
  const place = dash(c.place).slice(0, 200);
  const note = dash(c.note).slice(0, 200);
  if (!yearText && !place) return;
  await client.query(
    `INSERT INTO monk_courses (monk_id, kind, year_text, place, note)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (monk_id, kind, year_text, place)
     DO UPDATE SET note = COALESCE(NULLIF(EXCLUDED.note, ''), monk_courses.note)`,
    [monkId, kind, yearText, place, note]
  );
}

module.exports = {
  COURSE_KINDS, dash, thaiDigits, splitYearText, expandCourses, courseOut, ensureCourses, upsertCourse, normalizeCourseKind
};
