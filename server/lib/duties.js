const { sameWatName } = require("./affStatus");
const { displayNameAt } = require("./names");
const { vassaFor } = require("./vassa");
const { isPendingRainKind } = require("./rainPick");
const { sortLikeReport, watPosHistoryOf, isAbbot } = require("./reportSort");

const KINDS = ["event", "daily"];
const ATTENDS = ["ตรงเวลา", "สาย", "ขาด", "ลา"];
const SKIP_STATUSES = ["ย้ายวัด", "มรณภาพ", "ลาสิกขา"];

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

function eventOut(r) {
  return {
    id: r.id,
    watName: r.wat_name || "",
    dutyDate: r.duty_date ? String(r.duty_date).slice(0, 10) : "",
    dateText: r.date_text || "",
    title: r.title || "",
    place: r.place || ""
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
}

async function listEvents(pool, user, query) {
  const watName = watOf(user, query && query.watName);
  if (!watName) return { rows: [], needWat: true };
  const r = await pool.query(
    `SELECT * FROM monk_duty_events WHERE wat_name=$1
      ORDER BY duty_date DESC NULLS LAST, id DESC LIMIT 400`,
    [watName]
  );
  return { rows: r.rows.map(eventOut), needWat: false, watName };
}

async function addEvent(pool, user, body) {
  const watName = watOf(user, body && body.watName);
  if (!watName) throw Object.assign(new Error("เลือกวัดก่อน"), { status: 400 });
  const title = clean(body && body.title, 300);
  if (!title) throw Object.assign(new Error("กรอกข้อมูลงาน"), { status: 400 });
  const dutyDate = dateOrNull(body && body.dutyDate);
  const dateText = clean(body && body.dateText, 80);
  if (!dutyDate && !dateText) throw Object.assign(new Error("ใส่วันที่"), { status: 400 });
  const r = await pool.query(
    `INSERT INTO monk_duty_events (wat_name, duty_date, date_text, title, place)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [watName, dutyDate, dateText, title, clean(body && body.place, 200)]
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
            m.former_name, m.former_surname, m.bio, m.ordained_on,
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
  KINDS, ATTENDS, SKIP_STATUSES, parseKind, parseAttend, parseExempt,
  isAwayDutyKind, isAwayForDuty, yearBeOfIso, watOf, ensureDuties,
  listEvents, addEvent, deleteEvent, listDaily, saveDaily, listMonth,
  monthMeta, countedLastDay, isoDays, pct, sessionKind, tallySession, tallyMonkMonth
};
