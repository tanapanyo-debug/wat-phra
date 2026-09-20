const { sameWatName } = require("./affStatus");
const { displayNameAt } = require("./names");
const { vassaFor } = require("./vassa");
const { isPendingRainKind } = require("./rainPick");
const { sortLikeReport, watPosHistoryOf, isAbbot } = require("./reportSort");
const { thaiDigits } = require("./courses");

const KINDS = ["event", "daily"];
const ATTENDS = ["ตรงเวลา", "สาย", "ขาด", "ลา"];
const SKIP_STATUSES = ["ย้ายวัด", "มรณภาพ", "ลาสิกขา"];

const DUTY_WORKS = [
  { id: "งานปกครอง", acts: ["ไปตรวจวัด", "ประชุมคณะสงฆ์", "งานสารบรรณ", "อื่นๆ"] },
  { id: "งานศึกษา", acts: ["สอนนักธรรม-บาลี", "อบรมก่อนสอบ", "สอนศีลธรรมในโรงเรียน", "เข้ารับการอบรม", "อื่นๆ"] },
  { id: "งานเผยแผ่", acts: ["ไปบรรยาย", "เป็นวิทยากร", "ค่ายพุทธบุตร", "อบรมศีลธรรม", "เข้ารับการอบรม", "พิธีวันสำคัญ", "อื่นๆ"] },
  { id: "งานสาธารณูปการ", acts: ["ก่อสร้างถาวรวัตถุ", "บูรณะปฏิสังขรณ์", "อื่นๆ"] },
  { id: "งานสาธารณประโยชน์", acts: ["ช่วยเหลือประชาชน", "บริจาค", "เปิดสถานที่ให้ใช้", "อื่นๆ"] },
  { id: "งานศึกษาสงเคราะห์", acts: ["อุปถัมภ์โครงการ", "โรงเรียนผู้สูงอายุ", "อื่นๆ"] },
  { id: "งานเจ้าคณะ", acts: ["สนองงานเจ้าคณะ", "อื่นๆ"] },
  { id: "งานพิเศษ", acts: ["อื่นๆ"] }
];

function workOf(id) {
  const s = String(id || "").trim();
  return DUTY_WORKS.find(function (w) { return w.id === s; }) || null;
}

function parseWorkKind(v) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function parseActKind(work, v) {
  if (!parseWorkKind(work)) return "";
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function dutyFieldsFor(act, work) {
  const a = String(act || "").trim();
  const w = String(work || "").trim();
  const f = { topic: true, place: true, people: false, duration: false, amount: false, size: false, note: true };
  if (["ไปบรรยาย", "เป็นวิทยากร", "ค่ายพุทธบุตร", "อบรมศีลธรรม", "พิธีวันสำคัญ", "สอนศีลธรรมในโรงเรียน"].indexOf(a) >= 0) {
    f.people = true;
    f.duration = true;
  }
  if (["เข้ารับการอบรม", "อบรมก่อนสอบ"].indexOf(a) >= 0) f.duration = true;
  if (["ก่อสร้างถาวรวัตถุ", "บูรณะปฏิสังขรณ์"].indexOf(a) >= 0) {
    f.amount = true;
    f.size = true;
  }
  if (["ช่วยเหลือประชาชน", "บริจาค", "อุปถัมภ์โครงการ", "โรงเรียนผู้สูงอายุ"].indexOf(a) >= 0) {
    f.people = a !== "โรงเรียนผู้สูงอายุ";
    f.amount = true;
  }
  if (a && !f.people && !f.duration && !f.amount && !f.size) {
    if (w === "งานเผยแผ่") {
      f.people = true;
      f.duration = true;
    } else if (w === "งานสาธารณูปการ") {
      f.amount = true;
      f.size = true;
    } else if (w === "งานสาธารณประโยชน์" || w === "งานศึกษาสงเคราะห์") {
      f.amount = true;
    }
  }
  return f;
}

function dutyTopicLabel(act) {
  if (act === "ไปบรรยาย" || act === "เป็นวิทยากร") return "หัวข้อบรรยาย";
  if (act === "เข้ารับการอบรม" || act === "อบรมก่อนสอบ") return "หลักสูตร";
  if (act === "ก่อสร้างถาวรวัตถุ" || act === "บูรณะปฏิสังขรณ์") return "ชื่องาน / ถาวรวัตถุ";
  if (act === "โรงเรียนผู้สูงอายุ") return "โครงการ / โรงเรียนผู้สูงอายุ";
  if (act === "อุปถัมภ์โครงการ") return "โครงการ";
  if (act === "พิธีวันสำคัญ") return "ชื่อพิธี";
  return "ชื่องาน / หัวข้อ";
}

function composeDutyTitle(work, act, topic, fallback) {
  const bits = [work, act, topic].map(function (x) { return String(x || "").trim(); }).filter(Boolean);
  if (bits.length) return bits.join(" · ").slice(0, 300);
  return String(fallback || "").trim().slice(0, 300);
}

function parsePeople(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0 || n > 999999) return null;
  return n;
}

function parseAmount(v) {
  const s = String(v == null ? "" : v).replace(/,/g, "").replace(/\s/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9999999999) return null;
  return Math.round(n * 100) / 100;
}

function isAwayDutyKind(kind) {
  const k = String(kind || "").trim();
  return k === "ไปจำพรรษาที่อื่น" || k === "ยืมไปจำพรรษา";
}

function yearBeOfIso(iso) {
  const m = String(iso || "").match(/^(\d{4})/);
  if (!m) return 0;
  const y = parseInt(m[1], 10);
  if (!Number.isFinite(y) || y < 1900) return 0;
  return y > 2200 ? y : y + 543;
}

function isAwayForDuty(listWat, homeWat, rainWat, rainKind) {
  if (!sameWatName(homeWat, listWat)) return false;
  if (isAwayDutyKind(rainKind)) return true;
  const rain = String(rainWat || "").trim();
  if (!rain) return false;
  return !sameWatName(listWat, rain);
}

function parseExempt(v) {
  return v === true || v === "true" || v === 1 || v === "1" || v === "on" || v === "ยกเว้น";
}

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max || 300);
}

function dateOrNull(v) {
  const s = isoDate(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isoDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : "";
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.getUTCFullYear() + "-" + pad2(v.getUTCMonth() + 1) + "-" + pad2(v.getUTCDate());
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function parseKind(v) {
  const k = String(v || "").trim();
  return KINDS.indexOf(k) >= 0 ? k : "";
}

function parseAttend(v) {
  const s = String(v || "").trim();
  return ATTENDS.indexOf(s) >= 0 ? s : "";
}

function watOf(user, wanted) {
  const fromUser = String((user && user.watName) || "").replace(/\s+/g, " ").trim();
  const lv = user && user.accessLevel;
  if (lv === "wat" || (user && user.embedLocked)) return fromUser;
  const fromWanted = String(wanted || "").replace(/\s+/g, " ").trim();
  return fromWanted || fromUser;
}

function monkLabel(m) {
  const who = displayNameAt(m, (m && m.person_type) || "ภิกษุ");
  return who || ("รหัส " + ((m && m.id) || ""));
}

function parseMonkId(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return n;
}

function parseCitizenId(v) {
  const raw = thaiDigits(String(v == null ? "" : v)).trim();
  if (!raw) return "";
  const d = raw.replace(/[^\d]/g, "");
  if (d.length === 13) return d;
  const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t.length >= 4 && t.length <= 20 && /[A-Z]/.test(t)) return t;
  return "";
}

function eventOut(r) {
  const monkId = r.monk_id || null;
  const monkName = monkId ? monkLabel({
    id: monkId,
    chaya: r.monk_chaya || r.chaya,
    sangha_name: r.monk_sangha_name || r.sangha_name,
    chaya_pali: r.monk_chaya_pali || r.chaya_pali,
    title: r.monk_title || "",
    person_type: r.monk_person_type || r.person_type,
    former_name: r.monk_former_name || r.former_name,
    former_surname: r.monk_former_surname || r.former_surname,
    bio: r.monk_bio || r.bio
  }) : "";
  return {
    id: r.id,
    watName: r.wat_name || "",
    monkId: monkId,
    monkName: monkName,
    citizenId: r.citizen_id || r.monk_citizen_id || "",
    dutyDate: r.duty_date ? String(r.duty_date).slice(0, 10) : "",
    dateText: r.date_text || "",
    workKind: r.work_kind || "",
    actKind: r.act_kind || "",
    topic: r.topic || "",
    title: r.title || "",
    place: r.place || "",
    people: r.people == null ? null : Number(r.people),
    duration: r.duration || "",
    amount: r.amount == null ? null : Number(r.amount),
    sizeText: r.size_text || "",
    note: r.note || ""
  };
}

function dailyOut(r, monk, meta) {
  const away = !!(meta && meta.away);
  const abbot = !!(meta && meta.abbot);
  const saved = !!(r && (r.id || r.morning || r.evening || r.exempt === true || r.exempt === false));
  const exempt = saved ? parseExempt(r && r.exempt) : (away || abbot);
  return {
    monkId: r.monk_id || (monk && monk.id),
    displayName: monk ? monkLabel(monk) : "",
    morning: parseAttend(r && r.morning),
    evening: parseAttend(r && r.evening),
    morningLeave: (r && r.morning_leave) || "",
    eveningLeave: (r && r.evening_leave) || "",
    exempt: exempt,
    away: away,
    awayWat: (meta && meta.awayWat) || "",
    abbot: abbot
  };
}

async function ensureDuties(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monk_duty_events (
      id SERIAL PRIMARY KEY,
      wat_name TEXT NOT NULL DEFAULT '',
      duty_date DATE,
      date_text TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS monk_duty_events_wat_date
    ON monk_duty_events (wat_name, duty_date DESC NULLS LAST, id DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monk_duty_daily (
      id SERIAL PRIMARY KEY,
      wat_name TEXT NOT NULL DEFAULT '',
      monk_id INTEGER NOT NULL REFERENCES monks(id) ON DELETE CASCADE,
      duty_date DATE NOT NULL,
      morning TEXT NOT NULL DEFAULT '',
      evening TEXT NOT NULL DEFAULT '',
      morning_leave TEXT NOT NULL DEFAULT '',
      evening_leave TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (wat_name, monk_id, duty_date)
    )
  `);
  await pool.query(`ALTER TABLE monk_duty_daily ADD COLUMN IF NOT EXISTS exempt BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS work_kind TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS act_kind TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS people INTEGER`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS duration TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS amount NUMERIC`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS size_text TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS monk_id INTEGER REFERENCES monks(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE monk_duty_events ADD COLUMN IF NOT EXISTS citizen_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS monk_duty_events_monk
    ON monk_duty_events (wat_name, monk_id, duty_date DESC NULLS LAST)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS monk_duty_events_citizen
    ON monk_duty_events (wat_name, citizen_id, duty_date DESC NULLS LAST)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wat_duty_works (
      id SERIAL PRIMARY KEY,
      wat_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (wat_name, name)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wat_duty_acts (
      id SERIAL PRIMARY KEY,
      wat_name TEXT NOT NULL DEFAULT '',
      work_id INTEGER NOT NULL REFERENCES wat_duty_works(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (wat_name, work_id, name)
    )
  `);
}

function catalogErr(e, fallback) {
  if (e && e.code === "23505") {
    throw Object.assign(new Error("มีชื่อนี้อยู่แล้ว"), { status: 409 });
  }
  throw e || new Error(fallback || "ไม่สำเร็จ");
}

async function seedCatalogIfEmpty(pool, watName) {
  const n = await pool.query("SELECT 1 FROM wat_duty_works WHERE wat_name=$1 LIMIT 1", [watName]);
  if (n.rowCount) return;
  for (let i = 0; i < DUTY_WORKS.length; i++) {
    const w = DUTY_WORKS[i];
    const wr = await pool.query(
      "INSERT INTO wat_duty_works (wat_name, name, sort_order) VALUES ($1,$2,$3) RETURNING id",
      [watName, w.id, i]
    );
    const workId = wr.rows[0].id;
    const acts = (w.acts || []).filter(function (a) { return a && a !== "อื่นๆ"; });
    for (let j = 0; j < acts.length; j++) {
      await pool.query(
        "INSERT INTO wat_duty_acts (wat_name, work_id, name, sort_order) VALUES ($1,$2,$3,$4)",
        [watName, workId, acts[j], j]
      );
    }
  }
}

function catalogName(v) {
  const s = String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!s) throw Object.assign(new Error("กรอกชื่อ"), { status: 400 });
  return s;
}

async function listCatalog(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  if (!watName) return { works: [], needWat: true };
  await seedCatalogIfEmpty(pool, watName);
  const works = await pool.query(
    "SELECT id, name FROM wat_duty_works WHERE wat_name=$1 ORDER BY sort_order, id",
    [watName]
  );
  const acts = await pool.query(
    "SELECT id, work_id, name FROM wat_duty_acts WHERE wat_name=$1 ORDER BY sort_order, id",
    [watName]
  );
  const byWork = {};
  acts.rows.forEach(function (a) {
    if (!byWork[a.work_id]) byWork[a.work_id] = [];
    byWork[a.work_id].push({ id: a.id, name: a.name });
  });
  return {
    needWat: false,
    watName,
    works: works.rows.map(function (w) {
      return { id: w.id, name: w.name, acts: byWork[w.id] || [] };
    })
  };
}

async function addWork(pool, user, body) {
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  await seedCatalogIfEmpty(pool, watName);
  const name = catalogName(body && body.name);
  const max = await pool.query(
    "SELECT COALESCE(MAX(sort_order), -1) AS n FROM wat_duty_works WHERE wat_name=$1",
    [watName]
  );
  try {
    const r = await pool.query(
      "INSERT INTO wat_duty_works (wat_name, name, sort_order) VALUES ($1,$2,$3) RETURNING id, name",
      [watName, name, Number(max.rows[0].n) + 1]
    );
    return { id: r.rows[0].id, name: r.rows[0].name, acts: [] };
  } catch (e) {
    catalogErr(e);
  }
}

async function renameWork(pool, user, id, body) {
  const n = Number(id);
  if (!n) throw Object.assign(new Error("ไม่พบรายการ"), { status: 400 });
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  const name = catalogName(body && body.name);
  try {
    const r = await pool.query(
      "UPDATE wat_duty_works SET name=$1 WHERE id=$2 AND wat_name=$3 RETURNING id, name",
      [name, n, watName]
    );
    if (!r.rowCount) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
    return { id: r.rows[0].id, name: r.rows[0].name };
  } catch (e) {
    if (e && e.status) throw e;
    catalogErr(e);
  }
}

async function deleteWork(pool, user, id) {
  const n = Number(id);
  if (!n) throw Object.assign(new Error("ไม่พบรายการ"), { status: 400 });
  const watName = watOf(user, "");
  const params = [n];
  let sql = "DELETE FROM wat_duty_works WHERE id=$1";
  if (watName) {
    params.push(watName);
    sql += " AND wat_name=$2";
  }
  sql += " RETURNING id";
  const r = await pool.query(sql, params);
  if (!r.rowCount) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
  return { ok: true };
}

async function addAct(pool, user, body) {
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  const workId = Number(body && body.workId);
  if (!workId) throw Object.assign(new Error("เลือกงานคณะสงฆ์ก่อน"), { status: 400 });
  const own = await pool.query(
    "SELECT id FROM wat_duty_works WHERE id=$1 AND wat_name=$2",
    [workId, watName]
  );
  if (!own.rowCount) throw Object.assign(new Error("ไม่พบงานคณะสงฆ์"), { status: 404 });
  const name = catalogName(body && body.name);
  const max = await pool.query(
    "SELECT COALESCE(MAX(sort_order), -1) AS n FROM wat_duty_acts WHERE wat_name=$1 AND work_id=$2",
    [watName, workId]
  );
  try {
    const r = await pool.query(
      "INSERT INTO wat_duty_acts (wat_name, work_id, name, sort_order) VALUES ($1,$2,$3,$4) RETURNING id, name, work_id",
      [watName, workId, name, Number(max.rows[0].n) + 1]
    );
    return { id: r.rows[0].id, name: r.rows[0].name, workId: r.rows[0].work_id };
  } catch (e) {
    catalogErr(e);
  }
}

async function renameAct(pool, user, id, body) {
  const n = Number(id);
  if (!n) throw Object.assign(new Error("ไม่พบรายการ"), { status: 400 });
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  const name = catalogName(body && body.name);
  try {
    const r = await pool.query(
      "UPDATE wat_duty_acts SET name=$1 WHERE id=$2 AND wat_name=$3 RETURNING id, name, work_id",
      [name, n, watName]
    );
    if (!r.rowCount) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
    return { id: r.rows[0].id, name: r.rows[0].name, workId: r.rows[0].work_id };
  } catch (e) {
    if (e && e.status) throw e;
    catalogErr(e);
  }
}

async function deleteAct(pool, user, id) {
  const n = Number(id);
  if (!n) throw Object.assign(new Error("ไม่พบรายการ"), { status: 400 });
  const watName = watOf(user, "");
  const params = [n];
  let sql = "DELETE FROM wat_duty_acts WHERE id=$1";
  if (watName) {
    params.push(watName);
    sql += " AND wat_name=$2";
  }
  sql += " RETURNING id";
  const r = await pool.query(sql, params);
  if (!r.rowCount) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
  return { ok: true };
}

async function listRoster(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  if (!watName) return { rows: [], needWat: true, yearBe: 0, abbotId: 0 };
  let yearBe = yearBeOfIso(query && query.dutyDate);
  const y = parseInt(String((query && query.yearBe) || "").replace(/[^\d]/g, ""), 10);
  if (!yearBe && y >= 2400 && y <= 2700) yearBe = y;
  if (!yearBe && y >= 1900 && y <= 2200) yearBe = y + 543;
  if (!yearBe) yearBe = new Date().getFullYear() + 543;
  const roster = await rosterForYear(pool, watName, yearBe);
  const rows = roster.map(function (r) {
    return {
      monkId: r.monkId,
      displayName: r.displayName,
      abbot: !!r.abbot,
      citizenId: String((r.monk && r.monk.citizen_id) || "").trim(),
      idKind: (r.monk && r.monk.id_kind) || "thai"
    };
  });
  const abbot = rows.filter(function (r) { return r.abbot && r.citizenId; })[0]
    || rows.filter(function (r) { return r.abbot; })[0];
  const withId = rows.filter(function (r) { return r.citizenId; })[0];
  return {
    needWat: false,
    watName,
    yearBe,
    rows,
    abbotId: abbot ? abbot.monkId : 0,
    abbotCitizenId: abbot && abbot.citizenId ? abbot.citizenId : (withId ? withId.citizenId : "")
  };
}

async function resolvePerson(pool, watName, body) {
  const citizenId = parseCitizenId(body && (body.citizenId || body.citizen_id));
  if (!citizenId) throw Object.assign(new Error("เลือกพระที่มีเลขบัตรประชาชน"), { status: 400 });
  const r = await pool.query(
    `SELECT m.id, m.citizen_id FROM monks m
       LEFT JOIN monk_rains y ON y.monk_id = m.id
      WHERE m.citizen_id=$1 AND (m.wat_name=$2 OR COALESCE(y.wat_name,'')=$2)
      LIMIT 1`,
    [citizenId, watName]
  );
  if (!r.rowCount) throw Object.assign(new Error("ไม่พบพระเลขบัตรนี้ในวัด"), { status: 400 });
  return { monkId: r.rows[0].id, citizenId: r.rows[0].citizen_id };
}

async function listEvents(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  if (!watName) return { rows: [], needWat: true };
  const monkId = parseMonkId(query && query.monkId);
  const citizenId = parseCitizenId(query && query.citizenId);
  const params = [watName];
  let sql = `SELECT e.*, m.chaya AS monk_chaya, m.sangha_name AS monk_sangha_name,
                    m.chaya_pali AS monk_chaya_pali, m.title AS monk_title,
                    m.person_type AS monk_person_type, m.former_name AS monk_former_name,
                    m.former_surname AS monk_former_surname, m.bio AS monk_bio,
                    m.citizen_id AS monk_citizen_id
               FROM monk_duty_events e
               LEFT JOIN monks m ON (
                 (COALESCE(e.citizen_id,'') <> '' AND m.citizen_id = e.citizen_id)
                 OR (COALESCE(e.citizen_id,'') = '' AND m.id = e.monk_id)
               )
              WHERE e.wat_name=$1`;
  if (citizenId) {
    params.push(citizenId);
    sql += " AND e.citizen_id=$" + params.length;
  } else if (monkId) {
    params.push(monkId);
    sql += " AND e.monk_id=$" + params.length;
  }
  sql += " ORDER BY e.duty_date DESC NULLS LAST, e.id DESC LIMIT 400";
  const r = await pool.query(sql, params);
  return { rows: r.rows.map(eventOut), needWat: false, watName };
}

async function addEvent(pool, user, body) {
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  const workKind = parseWorkKind(body && body.workKind);
  const actKind = parseActKind(workKind, body && body.actKind);
  if (!workKind) throw Object.assign(new Error("เลือกงานคณะสงฆ์"), { status: 400 });
  if (!actKind) throw Object.assign(new Error("กรอกลักษณะงาน"), { status: 400 });
  const topic = clean(body && (body.topic || body.title), 300);
  const fields = dutyFieldsFor(actKind, workKind);
  if ((actKind === "ไปบรรยาย" || actKind === "เข้ารับการอบรม") && !topic) {
    throw Object.assign(new Error("กรอก" + dutyTopicLabel(actKind)), { status: 400 });
  }
  const title = composeDutyTitle(workKind, actKind, topic, body && body.title);
  if (!title) throw Object.assign(new Error("กรอกข้อมูลงาน"), { status: 400 });
  const dutyDate = dateOrNull(body && body.dutyDate);
  const dateText = clean(body && body.dateText, 80);
  if (!dutyDate && !dateText) throw Object.assign(new Error("ใส่วันที่"), { status: 400 });
  const people = fields.people ? parsePeople(body && body.people) : null;
  const duration = fields.duration ? clean(body && body.duration, 40) : "";
  const amount = fields.amount ? parseAmount(body && body.amount) : null;
  const sizeText = fields.size ? clean(body && body.sizeText, 80) : "";
  const person = await resolvePerson(pool, watName, body);
  const r = await pool.query(
    `INSERT INTO monk_duty_events
      (wat_name, monk_id, citizen_id, duty_date, date_text, work_kind, act_kind, topic, title, place, people, duration, amount, size_text, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      watName, person.monkId, person.citizenId, dutyDate, dateText, workKind, actKind, topic, title,
      clean(body && body.place, 200), people, duration, amount, sizeText,
      clean(body && body.note, 400)
    ]
  );
  return eventOut(r.rows[0]);
}

async function deleteEvent(pool, user, id) {
  const n = Number(id);
  if (!n) throw Object.assign(new Error("ไม่พบรายการ"), { status: 400 });
  const watName = watOf(user, "");
  const params = [n];
  let sql = "DELETE FROM monk_duty_events WHERE id=$1";
  if (watName) {
    params.push(watName);
    sql += " AND wat_name=$2";
  }
  sql += " RETURNING id";
  const r = await pool.query(sql, params);
  if (!r.rowCount) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
  return { ok: true };
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function daysInMonth(ceYear, month) {
  return new Date(Date.UTC(ceYear, month, 0)).getUTCDate();
}

function monthMeta(yearBe, month) {
  const yb = Number(yearBe);
  const mo = Number(month);
  if (!Number.isInteger(yb) || yb < 2400 || yb > 2700) return null;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  const ceYear = yb - 543;
  const last = daysInMonth(ceYear, mo);
  return {
    yearBe: yb,
    month: mo,
    monthName: THAI_MONTHS[mo - 1],
    ceYear,
    last,
    start: ceYear + "-" + pad2(mo) + "-01",
    end: ceYear + "-" + pad2(mo) + "-" + pad2(last)
  };
}

function todayIsoBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function countedLastDay(meta, asOfIso) {
  if (!meta) return 0;
  const asOf = dateOrNull(asOfIso);
  if (!asOf) return meta.last;
  if (asOf < meta.start) return 0;
  if (asOf >= meta.end) return meta.last;
  return parseInt(asOf.slice(8, 10), 10);
}

function isoDays(meta, lastDay) {
  const out = [];
  const n = Number(lastDay) || 0;
  for (let d = 1; d <= n; d++) out.push(meta.ceYear + "-" + pad2(meta.month) + "-" + pad2(d));
  return out;
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((Number(n) * 1000) / Number(d)) / 10;
}

function sessionKind(attend, exempt) {
  if (exempt) return "exempt";
  const a = parseAttend(attend);
  if (a === "ลา") return "leave";
  if (a === "ตรงเวลา" || a === "สาย") return "present";
  return "miss";
}

function tallySession(kinds) {
  let duty = 0;
  let miss = 0;
  let present = 0;
  let leave = 0;
  let exempt = 0;
  (kinds || []).forEach((k) => {
    if (k === "exempt") { exempt += 1; return; }
    if (k === "leave") { leave += 1; return; }
    duty += 1;
    if (k === "present") present += 1;
    else miss += 1;
  });
  return { duty, miss, present, leave, exempt, pctMiss: pct(miss, duty), pctPresent: pct(present, duty) };
}

function tallyMonkMonth(days, recordsByIso, defaultExempt) {
  const morning = [];
  const evening = [];
  (days || []).forEach((iso) => {
    const rec = recordsByIso && recordsByIso[iso];
    const exempt = rec ? parseExempt(rec.exempt) : !!defaultExempt;
    morning.push(sessionKind(rec && rec.morning, exempt));
    evening.push(sessionKind(rec && rec.evening, exempt));
  });
  return { morning: tallySession(morning), evening: tallySession(evening) };
}

function addSessionTotals(into, part) {
  into.duty += part.duty;
  into.miss += part.miss;
  into.present += part.present;
  into.leave += part.leave;
  into.exempt += part.exempt;
}

async function rosterForYear(pool, watName, yearBe) {
  const monks = await pool.query(
    `SELECT m.id, m.chaya, m.sangha_name, m.chaya_pali, m.title, m.status, m.person_type, m.wat_name,
            m.former_name, m.former_surname, m.bio, m.ordained_on, m.citizen_id, m.id_kind,
            y.wat_name AS rain_wat, y.rain_kind, y.vassa AS rain_vassa
       FROM monks m
       INNER JOIN monk_rains y ON y.monk_id = m.id AND y.year_be = $2
      WHERE COALESCE(NULLIF(m.status,''), 'จำพรรษา') NOT IN ('ย้ายวัด', 'มรณภาพ', 'ลาสิกขา')
        AND (m.wat_name=$1 OR COALESCE(y.wat_name,'')=$1)`,
    [watName, yearBe]
  );
  return monks.rows.map((m) => {
    const away = isAwayForDuty(watName, m.wat_name, m.rain_wat, m.rain_kind);
    const awayWat = away ? String(m.rain_wat || "").trim() : "";
    const pending = isPendingRainKind(m.rain_kind);
    const personType = m.person_type || "ภิกษุ";
    const computed = vassaFor(m, [], yearBe);
    const stored = Number(m.rain_vassa);
    const vassa = personType === "สามเณร"
      ? null
      : (computed != null ? computed : (Number.isFinite(stored) ? stored : null));
    const bio = m.bio && typeof m.bio === "object" ? m.bio : {};
    const hist = watPosHistoryOf(bio);
    const abbot = isAbbot({ bio: bio, watPosHistory: hist, watPosition: bio.watPosition });
    return {
      monk: m,
      monkId: m.id,
      displayName: monkLabel(m),
      away,
      awayWat,
      abbot,
      pending,
      personType,
      vassa,
      watPosHistory: hist,
      watPosition: String(bio.watPosition || "").trim()
    };
  });
}

async function listDaily(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  const dutyDate = dateOrNull(query && query.dutyDate);
  if (!watName) return { rows: [], needWat: true };
  if (!dutyDate) return { rows: [], needDate: true, watName };
  const yearBe = yearBeOfIso(dutyDate);
  const roster = await rosterForYear(pool, watName, yearBe);
  const saved = await pool.query(
    "SELECT * FROM monk_duty_daily WHERE wat_name=$1 AND duty_date=$2",
    [watName, dutyDate]
  );
  const byId = {};
  saved.rows.forEach((row) => { byId[row.monk_id] = row; });
  const rows = roster.map((item) => {
    const out = dailyOut(byId[item.monkId] || { monk_id: item.monkId }, item.monk, {
      away: item.away,
      awayWat: item.awayWat,
      abbot: item.abbot
    });
    out.personType = item.personType;
    out.vassa = item.vassa;
    out.pending = item.pending;
    out.watPosHistory = item.watPosHistory;
    out.watPosition = item.watPosition;
    return out;
  });
  return {
    watName,
    dutyDate,
    yearBe,
    rows: sortLikeReport(rows, watName).map((r) => ({
      monkId: r.monkId,
      displayName: r.displayName,
      morning: r.morning,
      evening: r.evening,
      morningLeave: r.morningLeave,
      eveningLeave: r.eveningLeave,
      exempt: r.exempt,
      away: r.away,
      awayWat: r.awayWat,
      abbot: r.abbot
    }))
  };
}

function readDailyRow(a) {
  const monkId = Number(a && a.monkId);
  if (!monkId) return null;
  const morning = parseAttend(a.morning);
  const evening = parseAttend(a.evening);
  const exempt = parseExempt(a && a.exempt);
  return {
    monkId,
    morning: exempt ? "" : morning,
    evening: exempt ? "" : evening,
    morningLeave: (exempt || morning !== "ลา") ? "" : clean(a.morningLeave, 200),
    eveningLeave: (exempt || evening !== "ลา") ? "" : clean(a.eveningLeave, 200),
    exempt
  };
}

async function saveDaily(pool, user, body) {
  const watName = watOf(user, body && body.watName);
  const dutyDate = dateOrNull(body && body.dutyDate);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  if (!dutyDate) throw Object.assign(new Error("ใส่วันที่"), { status: 400 });
  const rows = (Array.isArray(body && body.rows) ? body.rows : []).map(readDailyRow).filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO monk_duty_daily
           (wat_name, monk_id, duty_date, morning, evening, morning_leave, evening_leave, exempt, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (wat_name, monk_id, duty_date) DO UPDATE SET
           morning=EXCLUDED.morning,
           evening=EXCLUDED.evening,
           morning_leave=EXCLUDED.morning_leave,
           evening_leave=EXCLUDED.evening_leave,
           exempt=EXCLUDED.exempt,
           updated_at=now()`,
        [watName, row.monkId, dutyDate, row.morning, row.evening, row.morningLeave, row.eveningLeave, row.exempt]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    throw e;
  } finally {
    client.release();
  }
  return listDaily(pool, user, { watName, dutyDate });
}

async function listMonth(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  if (!watName) return { rows: [], needWat: true };
  let yearBe = parseInt(query && query.yearBe, 10);
  let month = parseInt(query && query.month, 10);
  const fromIso = dateOrNull(query && query.dutyDate);
  if (fromIso && (!Number.isInteger(yearBe) || !Number.isInteger(month))) {
    yearBe = yearBeOfIso(fromIso);
    month = parseInt(fromIso.slice(5, 7), 10);
  }
  const meta = monthMeta(yearBe, month);
  if (!meta) throw Object.assign(new Error("เลือกเดือน"), { status: 400 });
  const asOf = dateOrNull(query && query.asOf) || todayIsoBangkok();
  const lastCounted = countedLastDay(meta, asOf);
  const days = isoDays(meta, lastCounted);
  const roster = await rosterForYear(pool, watName, meta.yearBe);
  const saved = await pool.query(
    "SELECT * FROM monk_duty_daily WHERE wat_name=$1 AND duty_date >= $2 AND duty_date <= $3",
    [watName, meta.start, meta.end]
  );
  const byMonk = {};
  saved.rows.forEach((row) => {
    const iso = isoDate(row.duty_date);
    if (!iso) return;
    const id = row.monk_id;
    if (!byMonk[id]) byMonk[id] = {};
    byMonk[id][iso] = row;
  });
  const totals = {
    morning: { duty: 0, miss: 0, present: 0, leave: 0, exempt: 0 },
    evening: { duty: 0, miss: 0, present: 0, leave: 0, exempt: 0 }
  };
  const rows = sortLikeReport(roster, watName).map((item) => {
    const tally = tallyMonkMonth(days, byMonk[item.monkId] || {}, item.away || item.abbot);
    addSessionTotals(totals.morning, tally.morning);
    addSessionTotals(totals.evening, tally.evening);
    const notes = [];
    if (item.abbot) notes.push("เจ้าอาวาส");
    if (item.away) notes.push("ไปจำพรรษาที่อื่น" + (item.awayWat ? " · " + item.awayWat : ""));
    return {
      monkId: item.monkId,
      displayName: item.displayName,
      abbot: item.abbot,
      away: item.away,
      awayWat: item.awayWat,
      morning: tally.morning,
      evening: tally.evening,
      note: notes.join(" · ")
    };
  });
  totals.morning.pctMiss = pct(totals.morning.miss, totals.morning.duty);
  totals.morning.pctPresent = pct(totals.morning.present, totals.morning.duty);
  totals.evening.pctMiss = pct(totals.evening.miss, totals.evening.duty);
  totals.evening.pctPresent = pct(totals.evening.present, totals.evening.duty);
  return {
    watName,
    yearBe: meta.yearBe,
    month: meta.month,
    monthName: meta.monthName,
    start: meta.start,
    end: meta.end,
    asOf,
    daysInMonth: meta.last,
    countedDays: lastCounted,
    rows,
    totals
  };
}

module.exports = {
  KINDS, ATTENDS, SKIP_STATUSES, DUTY_WORKS, parseKind, parseAttend, parseExempt,
  parseWorkKind, parseActKind, dutyFieldsFor, dutyTopicLabel, composeDutyTitle,
  parsePeople, parseAmount, isAwayDutyKind, isAwayForDuty, yearBeOfIso, watOf, ensureDuties,
  parseMonkId, parseCitizenId, monkLabel, resolvePerson, listRoster, listCatalog, addWork, renameWork, deleteWork, addAct, renameAct, deleteAct,
  listEvents, addEvent, deleteEvent, listDaily, saveDaily, listMonth,
  monthMeta, countedLastDay, isoDays, pct, sessionKind, tallySession, tallyMonkMonth
};
