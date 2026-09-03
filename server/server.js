require("dotenv").config();
const path = require("path");
const { classifyRanks, matchRankFilter, parseSpecialKinds, isSanghaRankKind, normalizeRankKind, applyCallingName } = require("./lib/ranks");
const { standingOf } = require("./lib/edu");
const { displayName, displayNameAt } = require("./lib/names");
const { SAMANASAK, SAMANASAK_CLASS, SAMANASAK_GROUPS, THANANAMA, isThananukromAction, isThananukromEntry } = require("./lib/samanasak");
const { courseOut, ensureCourses, thaiDigits, normalizeCourseKind } = require("./lib/courses");
const { destWat, lastAffiliation, affHomeWat, sameWatName, homeRainPlace, statusFromLastAffiliation, movedStatusLabel } = require("./lib/affStatus");
const { headerLines, detectLevel, formRow } = require("./lib/rainsReport");
const { currentBe, isNovice, personTypeAt, ordainedYearBe, vassaFor, ageAt, toParts } = require("./lib/vassa");
const { pickRain, carrySourceSql, RAIN_KIND_PENDING, isPendingRainKind } = require("./lib/rainPick");
const { buildFormBlankXlsx } = require("./lib/formBlankXlsx");
const { parseFormExcel } = require("./lib/formExcelImport");
const {
  ensureRainYearLockSchema,
  yearLockStatus,
  assertYearWritable,
  mergeRainsKeepingClosed,
  setYearClosed
} = require("./lib/rainYearLock");
const {
  WAT_PLACE_SQL,
  ensureWatSchema,
  upsertWatFromPlace,
  listWats,
  catalogWatsFromRows,
  listSanghaTambons,
  addSanghaTambon,
  renameSanghaTambon,
  deleteSanghaTambon,
  assignSanghaWats,
  addWat,
  ensureDistrictFromDirectory,
  resolveWat,
  sendErr
} = require("./lib/phraWats");
const {
  ensureTempleDir, listProvinces, listDistricts, searchTemples, listTemplesInPlace, templeCount
} = require("./lib/templeDir");
const {
  ensureAuthSchema,
  seedAdmin,
  migratePlatformAdminEmail,
  applyAdminPassword,
  bindPlatformAdminHome,
  requestPasswordReset,
  resetPasswordWithCode,
  requireAuth,
  requireAdmin,
  requireUserManager,
  login,
  loginAllowed,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  registerUser,
  requestLevel,
  approveRequestedLevel,
  rejectRequestedLevel,
  canApproveRequested,
  usersVisibleWhere,
  appendViewScope,
  appendHomeScope,
  insertBeforeOrderBy,
  scopePlaces,
  filterWatsForPlaces,
  filterSanghaTambons,
  canManagePlaces,
  canManageUsers,
  assertPlaceWrite,
  assertNewMonkInScope,
  applyWatUserHome,
  readUserBody,
  fillUserScope,
    hashPassword,
    publicUser,
    loadSession
} = require("./lib/phraAuth");
const {
  isMailConfigured,
  sendMail,
  mailErrorMessage,
  publicMailSettings,
  saveMailSettings,
  escapeHtml,
  importAccountingMail
} = require("./lib/mail");
const express = require("express");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 4200);
const ON_RENDER = !!process.env.RENDER || String(process.env.TRUST_PROXY || "") === "1";
const BIND = String(process.env.BIND_HOST || (ON_RENDER ? "0.0.0.0" : "127.0.0.1")).trim() || "127.0.0.1";
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  console.error("ยังไม่ได้ตั้ง DATABASE_URL ใน server/.env");
  process.exit(1);
}
if (/wat_accounting|wat_audit/i.test(DATABASE_URL)) {
  console.error("DATABASE_URL ชี้ไปฐานบัญชีวัดหรือตรวจบัญชี — ระบบนี้ต้องใช้ wat_phra");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

const STATUSES = ["จำพรรษา", "ย้ายวัด", "มรณภาพ", "ลาสิกขา"];
const AFF_KINDS = ["สังกัดเมื่อบวช", "รับเข้าสังกัด", "ย้ายสังกัด"];
const PERSON_TYPES = ["ภิกษุ", "สามเณร"];
const RAIN_KIND_AWAY = "ไปจำพรรษาที่อื่น";
const RAIN_KIND_STUDY = "มาจำพรรษาเพื่อเรียน";
function isAwayVassa(kind) {
  const k = String(kind || "").trim();
  return k === RAIN_KIND_AWAY || k === "ยืมไปจำพรรษา" || k === RAIN_KIND_STUDY
    || k === "มาอยู่เพื่อเรียน" || k === "มาเรียน";
}
function normalizeRainKind(k) {
  const s = String(k || "").trim();
  if (isPendingRainKind(s)) return RAIN_KIND_PENDING;
  if (s === RAIN_KIND_STUDY || s === "มาอยู่เพื่อเรียน" || s === "มาเรียน") return RAIN_KIND_STUDY;
  if (isAwayVassa(s)) return RAIN_KIND_AWAY;
  return "";
}
const BIO_KEYS = [
  ["nittayapatSeq", 40], ["photoName", 200],
  ["nickname", 80], ["englishName", 160], ["birthText", 80], ["fatherName", 160], ["motherName", 160],
  ["formerHouse", 120], ["formerTambon", 80], ["formerDistrict", 80], ["formerProvince", 80], ["formerPostcode", 20],
  ["formerJob", 80], ["ethnicity", 40], ["nationality", 40], ["stature", 40], ["skinTone", 40], ["marks", 160],
  ["noviceOn", 80], ["noviceWat", 160],
  ["noviceTambon", 80], ["noviceDistrict", 80], ["noviceProvince", 80],
  ["novicePreceptor", 160], ["novicePreceptorWat", 160],
  ["novicePreceptorTambon", 80], ["novicePreceptorDistrict", 80], ["novicePreceptorProvince", 80],
  ["preceptor", 160], ["preceptorWat", 160],
  ["ordainedOnText", 80], ["ordainedWat", 160],
  ["ordainedTambon", 80], ["ordainedDistrict", 80], ["ordainedProvince", 80],
  ["ordainedAge", 40], ["ordainedTime", 40],
  ["kammavaca", 160], ["kammavacaWat", 160], ["anusavana", 160], ["anusavanaWat", 160],
  ["firstAffWat", 160], ["firstAffOn", 80], ["firstAbbot", 160],
  ["moveFromWat", 160], ["moveOn", 80], ["moveReason", 200], ["movedToWat", 160],
  ["stayWat", 220], ["watPhone", 40], ["mobile", 40],
  ["dhammaYear", 40], ["dhammaLevel", 40], ["dhammaSchool", 160],
  ["paliYear", 40], ["paliLevel", 40], ["paliSchool", 160],
  ["secularYear", 40], ["secularLevel", 40], ["secularSchool", 160], ["secularMajor", 120],
  ["priYear", 40], ["priGrade", 40], ["priSchool", 160], ["m1Year", 40], ["m1Grade", 40], ["m1School", 160],
  ["m3Year", 40], ["m3Grade", 40], ["m3School", 160], ["dipYear", 40], ["dipGrade", 40], ["dipSchool", 160],
  ["baYear", 40], ["baGrade", 40], ["baSchool", 160], ["maYear", 40], ["maGrade", 40], ["maSchool", 160],
  ["phdYear", 40], ["phdGrade", 40], ["phdSchool", 160], ["honYear", 40], ["honGrade", 40], ["honSchool", 160],
  ["dhammaTriYear", 40], ["dhammaTriSchool", 160], ["dhammaTriSamnak", 160], ["dhammaTriProvince", 80],
  ["dhammaToYear", 40], ["dhammaToSchool", 160], ["dhammaToSamnak", 160], ["dhammaToProvince", 80],
  ["dhammaEkYear", 40], ["dhammaEkSchool", 160], ["dhammaEkSamnak", 160], ["dhammaEkProvince", 80],
  ["pali12Year", 40], ["pali12Wat", 160], ["pali12School", 160], ["pali12Province", 80],
  ["pali3Year", 40], ["pali3Wat", 160], ["pali3School", 160], ["pali3Province", 80],
  ["pali4Year", 40], ["pali4Wat", 160], ["pali4School", 160], ["pali4Province", 80],
  ["pali5Year", 40], ["pali5Wat", 160], ["pali5School", 160], ["pali5Province", 80],
  ["pali6Year", 40], ["pali6Wat", 160], ["pali6School", 160], ["pali6Province", 80],
  ["pali7Year", 40], ["pali7Wat", 160], ["pali7School", 160], ["pali7Province", 80],
  ["pali8Year", 40], ["pali8Wat", 160], ["pali8School", 160], ["pali8Province", 80],
  ["pali9Year", 40], ["pali9Wat", 160], ["pali9School", 160], ["pali9Province", 80],
  ["royalOn", 80], ["royalClass", 160], ["royalName", 160], ["royalRank", 80], ["fanRank", 80], ["dutySide", 40], ["ratchakitcha", 300],
  ["watPosOn", 80], ["watPosition", 160], ["watPosPlace", 160],
  ["sanghaPosOn", 80], ["sanghaPosition", 200],
  ["specialOn", 80], ["specialWork", 160], ["specialRole", 160], ["specialDetail", 400],
  ["sixOn", 80], ["sixType", 160], ["sixDetail", 400]
];

function readEduExtra(list) {
  const kinds = ["ประกาศนียบัตร", "ป.บส.", "ปริญญาตรี", "ปริญญาโท", "ปริญญาเอก", "ปริญญากิตติมศักดิ์", "อื่น"];
  return (Array.isArray(list) ? list : []).map((a) => {
    const kind = str(a.kind, 40);
    return {
      kind: kinds.indexOf(kind) >= 0 ? kind : "อื่น",
      yearText: str(a.yearText, 40),
      title: str(a.title, 200),
      cohort: str(a.cohort, 40),
      school: str(a.school, 160),
      major: str(a.major, 120),
      note: str(a.note, 200)
    };
  }).filter((a) => a.title || a.school || a.yearText || a.cohort || a.major).slice(0, 20);
}

function readRoyalHistory(list) {
  const actions = ["ตั้งสมณศักดิ์", "เลื่อนสมณศักดิ์", "ปรับสมณศักดิ์", "แต่งตั้งเป็นพระฐานานุกรม"];
  const kinds = ["พระราชาคณะ", "พระครูสัญญาบัตร", "พระครูฐานานุกรม", "พระฐานานุกรม", ""];
  return (Array.isArray(list) ? list : []).map((a) => {
    let action = str(a.action, 40);
    const rankKind = str(a.rankKind, 40);
    if (action === "เปลี่ยนฐานานุกรม") action = "แต่งตั้งเป็นพระฐานานุกรม";
    if (actions.indexOf(action) < 0) {
      action = isThananukromEntry({ action, rankKind, position: a.position })
        ? "แต่งตั้งเป็นพระฐานานุกรม"
        : "ตั้งสมณศักดิ์";
    }
    const than = isThananukromAction(action);
    return {
      yearText: str(a.yearText, 40),
      action,
      rankKind: kinds.indexOf(rankKind) >= 0 ? rankKind : "",
      position: str(a.position, 200),
      royalClass: than ? "" : str(a.royalClass, 160),
      royalName: str(a.royalName, 160),
      royalOn: str(a.royalOn, 80),
      royalRank: str(a.royalRank, 80),
      fanRank: str(a.fanRank, 80),
      dutySide: str(a.dutySide, 40),
      ratchakitcha: str(a.ratchakitcha, 300),
      note: str(a.note, 300),
      patronName: str(a.patronName, 160),
      patronWat: str(a.patronWat, 200)
    };
  }).filter((a) => a.yearText || a.royalName || a.royalClass || a.position || a.royalOn || a.patronName).slice(0, 40);
}

function applyLatestRoyal(bio) {
  const hist = bio.royalHistory || [];
  if (!hist.length) return bio;
  let name = "";
  let lastSak = null;
  hist.forEach((a) => {
    const n = a.royalName || "";
    if (n && n !== "ในราชทินนามเดิม") name = n;
    if (!isThananukromEntry(a)) lastSak = a;
  });
  if (name) bio.royalName = name;
  if (lastSak) {
    if (lastSak.royalClass) bio.royalClass = lastSak.royalClass;
    if (lastSak.royalOn) bio.royalOn = lastSak.royalOn;
    if (lastSak.royalRank) bio.royalRank = lastSak.royalRank;
    if (lastSak.fanRank) bio.fanRank = lastSak.fanRank;
    if (lastSak.dutySide) bio.dutySide = lastSak.dutySide;
    if (lastSak.ratchakitcha) bio.ratchakitcha = lastSak.ratchakitcha;
  }
  return bio;
}

function readWatPosHistory(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({
    yearText: str(a.yearText, 40),
    position: str(a.position, 160),
    watName: str(a.watName, 160),
    tambon: str(a.tambon, 80),
    district: str(a.district, 80),
    province: str(a.province, 80),
    appointedOn: str(a.appointedOn, 80),
    note: str(a.note, 200)
  })).filter((a) => a.yearText || a.position || a.watName || a.appointedOn).slice(0, 20);
}

function applyLatestWatPos(bio) {
  const hist = bio.watPosHistory || [];
  if (!hist.length) return bio;
  const last = hist[hist.length - 1];
  if (last.position) bio.watPosition = last.position;
  if (last.watName) bio.watPosPlace = last.watName;
  if (last.appointedOn) bio.watPosOn = last.appointedOn;
  return bio;
}

function readSanghaPosHistory(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({
    yearText: str(a.yearText, 40),
    position: str(a.position, 80),
    tambon: str(a.tambon, 80),
    zone: str(a.zone, 40),
    district: str(a.district, 80),
    province: str(a.province, 80),
    region: str(a.region, 80),
    appointedOn: str(a.appointedOn, 80),
    note: str(a.note, 200)
  })).filter((a) => a.yearText || a.position || a.tambon || a.zone || a.district || a.province || a.region || a.appointedOn).slice(0, 20);
}

function applyLatestSanghaPos(bio) {
  const hist = bio.sanghaPosHistory || [];
  if (!hist.length) return bio;
  const last = hist[hist.length - 1];
  if (last.position) bio.sanghaPosition = last.position;
  if (last.appointedOn) bio.sanghaPosOn = last.appointedOn;
  return bio;
}

function readSixHistory(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({
    yearText: str(a.yearText, 40),
    type: str(a.type || a.sixType, 160),
    appointedOn: str(a.appointedOn || a.sixOn, 80),
    detail: str(a.detail || a.sixDetail, 400)
  })).filter((a) => a.yearText || a.type || a.appointedOn || a.detail).slice(0, 20);
}

function applyLatestSix(bio) {
  const hist = bio.sixHistory || [];
  if (!hist.length) return bio;
  const last = hist[hist.length - 1];
  if (last.type) bio.sixType = last.type;
  if (last.appointedOn) bio.sixOn = last.appointedOn;
  if (last.detail) bio.sixDetail = last.detail;
  return bio;
}

function readBio(b) {
  const src = b && b.bio && typeof b.bio === "object" && !Array.isArray(b.bio) ? Object.assign({}, b, b.bio) : (b || {});
  const out = {};
  BIO_KEYS.forEach(function (pair) {
    out[pair[0]] = str(src[pair[0]], pair[1]);
  });
  out.eduExtra = readEduExtra(src.eduExtra);
  out.royalHistory = readRoyalHistory(src.royalHistory);
  applyLatestRoyal(out);
  out.watPosHistory = readWatPosHistory(src.watPosHistory);
  if (!out.watPosHistory.length && (out.watPosition || out.watPosPlace || out.watPosOn)) {
    out.watPosHistory = readWatPosHistory([{
      position: out.watPosition, watName: out.watPosPlace, appointedOn: out.watPosOn
    }]);
  }
  applyLatestWatPos(out);
  out.sanghaPosHistory = readSanghaPosHistory(src.sanghaPosHistory);
  if (!out.sanghaPosHistory.length && (out.sanghaPosition || out.sanghaPosOn)) {
    out.sanghaPosHistory = readSanghaPosHistory([{
      position: out.sanghaPosition, appointedOn: out.sanghaPosOn
    }]);
  }
  applyLatestSanghaPos(out);
  out.sixHistory = readSixHistory(src.sixHistory);
  if (!Array.isArray(src.sixHistory) && !out.sixHistory.length && (out.sixType || out.sixOn || out.sixDetail)) {
    out.sixHistory = readSixHistory([{
      type: out.sixType, appointedOn: out.sixOn, detail: out.sixDetail
    }]);
  }
  applyLatestSix(out);
  const CORE = { "ธรรมทูต": 1, "นักเทศน์": 1, "วิปัสสนาจารย์": 1 };
  out.specialKinds = parseSpecialKinds({ bio: src })
    .map((k) => normalizeCourseKind(k))
    .filter((k) => k && !CORE[k])
    .slice(0, 20);
  return out;
}

function str(v, max) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, max || 200);
}
function dateOrNull(v) {
  const s = String(v || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function normalizeCitizenId(v) {
  const d = thaiDigits(String(v == null ? "" : v)).replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length !== 13) return null;
  return d;
}
function normalizeIdKind(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (/passport|พาสปอร์ต|ต่างชาติ|ต่างด้าว|foreign/.test(s)) return "passport";
  return "thai";
}
function normalizePersonId(v, kind) {
  if (kind === "passport") {
    const s = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
    if (!s) return "";
    const t = s.replace(/[^A-Z0-9]/g, "");
    if (t.length < 4 || t.length > 20) return null;
    return t;
  }
  return normalizeCitizenId(v);
}
function idBadError(kind) {
  return kind === "passport" ? "เลขพาสปอร์ตไม่ถูกต้อง" : "เลขบัตรประชาชนต้องมี 13 หลัก";
}
function idDupError(kind) {
  return kind === "passport" ? "เลขพาสปอร์ตนี้มีในฐานแล้ว" : "เลขบัตรประชาชนนี้มีในฐานแล้ว";
}
function searchQ(raw) {
  const q = str(raw, 80).toLowerCase();
  const d = thaiDigits(q).replace(/[^\d]/g, "");
  const letters = q.replace(/[\d\s\-./]/g, "");
  if (d.length >= 4 && !letters) return d;
  return q;
}
function intOrNull(v, min, max) {
  const n = parseInt(String(v == null ? "" : v).trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (min != null && n < min) return null;
  if (max != null && n > max) return null;
  return n;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monks (
      id SERIAL PRIMARY KEY,
      chaya TEXT NOT NULL,
      former_name TEXT NOT NULL DEFAULT '',
      former_surname TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      wat_name TEXT NOT NULL DEFAULT '',
      tambon TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      ordained_on DATE,
      status TEXT NOT NULL DEFAULT 'จำพรรษา',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS person_type TEXT NOT NULL DEFAULT 'ภิกษุ'`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS nikaya TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS sutthi_no TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS sangha_tambon TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS sangha_name TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS chaya_pali TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS birth_year_be INTEGER`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS birth_province TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS bio JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS citizen_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS id_kind TEXT NOT NULL DEFAULT 'thai'`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS monks_citizen_id_uidx ON monks (citizen_id) WHERE citizen_id <> ''`);
  await pool.query(`UPDATE monks SET id_kind='passport' WHERE id_kind='thai' AND citizen_id <> '' AND citizen_id !~ '^[0-9]{13}$'`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS rank_kind TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS is_dhammaduta BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS is_preacher BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS is_vipassana BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS wat_id INTEGER`);
  await pool.query(`ALTER TABLE monks ADD COLUMN IF NOT EXISTS stay_wat_id INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS monks_wat_id ON monks (wat_id) WHERE wat_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS monks_stay_wat_id ON monks (stay_wat_id) WHERE stay_wat_id IS NOT NULL`);
  await ensureCourses(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monk_rains (
      id SERIAL PRIMARY KEY,
      monk_id INTEGER NOT NULL REFERENCES monks(id) ON DELETE CASCADE,
      year_be INTEGER NOT NULL,
      wat_name TEXT NOT NULL DEFAULT '',
      tambon TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      age INTEGER,
      vassa INTEGER,
      UNIQUE (monk_id, year_be)
    )
  `);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS sangha_tambon TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS secular_edu TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS naktham TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS naktham_year TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS naktham_school TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS naktham_province TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS pali TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS pali_year TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS pali_school TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS pali_province TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS remark TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_rains ADD COLUMN IF NOT EXISTS rain_kind TEXT NOT NULL DEFAULT ''`);
  await ensureWatSchema(pool);
  await ensureTempleDir(pool);
  await ensureAuthSchema(pool);
  await ensureRainYearLockSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monk_affiliations (
      id SERIAL PRIMARY KEY,
      monk_id INTEGER NOT NULL REFERENCES monks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      wat_name TEXT NOT NULL DEFAULT '',
      tambon TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      event_date DATE,
      reason TEXT NOT NULL DEFAULT '',
      certifier_name TEXT NOT NULL DEFAULT '',
      certifier_position TEXT NOT NULL DEFAULT '',
      certified_on DATE,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE monk_affiliations ADD COLUMN IF NOT EXISTS event_text TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_affiliations ADD COLUMN IF NOT EXISTS to_wat_name TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_affiliations ADD COLUMN IF NOT EXISTS to_tambon TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_affiliations ADD COLUMN IF NOT EXISTS to_district TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_affiliations ADD COLUMN IF NOT EXISTS to_province TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE monk_affiliations ADD COLUMN IF NOT EXISTS to_event_text TEXT NOT NULL DEFAULT ''`);
}

function isoFromText(v) {
  const p = toParts(v);
  if (!p || p.ce < 1900 || p.ce > 2100) return null;
  return String(p.ce).padStart(4, "0") + "-" +
    String(p.month || 1).padStart(2, "0") + "-" +
    String(p.day || 1).padStart(2, "0");
}

function affOut(r) {
  return {
    id: r.id,
    kind: r.kind,
    watName: r.wat_name,
    tambon: r.tambon,
    district: r.district,
    province: r.province,
    eventDate: r.event_date ? String(r.event_date).slice(0, 10) : "",
    eventText: r.event_text || "",
    reason: r.reason,
    certifierName: r.certifier_name,
    certifierPosition: r.certifier_position,
    certifiedOn: r.certified_on ? String(r.certified_on).slice(0, 10) : "",
    note: r.note,
    toWatName: r.to_wat_name || "",
    toTambon: r.to_tambon || "",
    toDistrict: r.to_district || "",
    toProvince: r.to_province || "",
    toEventText: r.to_event_text || ""
  };
}

function rainsOut(r, skipVassa, computed) {
  return {
    id: r.id,
    yearBe: r.year_be,
    watName: r.wat_name,
    tambon: r.tambon,
    sanghaTambon: r.sangha_tambon || "",
    district: r.district,
    province: r.province,
    age: r.age,
    vassa: skipVassa ? null : (computed != null ? computed : r.vassa),
    vassaFromOrdained: !skipVassa && computed != null,
    secularEdu: r.secular_edu || "",
    naktham: r.naktham || "",
    nakthamYear: r.naktham_year || "",
    nakthamSchool: r.naktham_school || "",
    nakthamProvince: r.naktham_province || "",
    pali: r.pali || "",
    paliYear: r.pali_year || "",
    paliSchool: r.pali_school || "",
    paliProvince: r.pali_province || "",
    remark: r.remark || "",
    rainKind: r.rain_kind || ""
  };
}

function rowOut(r, affiliations, rains, asOfYear, courses) {
  const aff = Array.isArray(affiliations) ? affiliations.map(affOut) : [];
  const oy = isNovice(r) ? null : ordainedYearBe(r, rains);
  const asOf = asOfYear || currentBe();
  const rain = Array.isArray(rains) ? rains.map((x) => {
    const y = x.year_be != null ? x.year_be : x.yearBe;
    return rainsOut(x, isNovice(r, y), vassaFor(r, rains, y));
  }) : [];
  const stay = stayAtWat(r.wat_name, rains || [], affiliations || [], asOf);
  const cls = classifyRanks(r, courses);
  return {
    id: r.id,
    personType: r.person_type || "ภิกษุ",
    chaya: r.chaya,
    formerName: r.former_name,
    formerSurname: r.former_surname,
    title: r.title,
    sanghaName: r.sangha_name || "",
    chayaPali: r.chaya_pali || "",
    royalName: (r.bio && r.bio.royalName) || r.sangha_name || "",
    displayName: displayName(r),
    nikaya: r.nikaya || "",
    sutthiNo: r.sutthi_no || "",
    citizenId: r.citizen_id || "",
    idKind: r.id_kind === "passport" ? "passport" : "thai",
    watName: r.wat_name,
    watId: r.wat_id || null,
    stayWatId: r.stay_wat_id || null,
    tambon: r.tambon,
    sanghaTambon: r.sangha_tambon || "",
    district: r.district,
    province: r.province,
    birthYearBe: r.birth_year_be || "",
    birthProvince: r.birth_province || "",
    bio: r.bio && typeof r.bio === "object" ? r.bio : {},
    rankKind: r.rank_kind || cls.rankKind,
    isDhammaduta: cls.isDhammaduta,
    isPreacher: cls.isPreacher,
    isVipassana: cls.isVipassana,
    isPariyatti: cls.isPariyatti,
    isBandit: cls.isBandit,
    ranks: cls.ranks,
    courses: Array.isArray(courses) ? courses.map(courseOut) : [],
    ordainedOn: r.ordained_on ? String(r.ordained_on).slice(0, 10) : "",
    status: r.status,
    movedToWat: (r.bio && r.bio.movedToWat) || "",
    note: r.note,
    yearsAtWat: stay.yearsAtWat,
    yearsAtWatFrom: stay.yearsAtWatFrom,
    joinedWatOn: stay.joinedWatOn,
    stillHere: stay.stillHere,
    stays: stay.stays || [],
    borrowed: stay.borrowed || [],
    ordainedYearBe: oy,
    vassa: vassaFor(r, rains, asOf),
    affiliations: aff,
    rains: rain
  };
}

function readAffiliations(list) {
  return (Array.isArray(list) ? list : []).map((a) => {
    const kind = str(a.kind, 40);
    const eventText = str(a.eventText, 80);
    const toEventText = str(a.toEventText, 80);
    return {
      kind: AFF_KINDS.includes(kind) ? kind : "รับเข้าสังกัด",
      wat_name: str(a.watName, 160),
      tambon: str(a.tambon, 80),
      district: str(a.district, 80),
      province: str(a.province, 80),
      event_date: dateOrNull(a.eventDate) || isoFromText(eventText) || isoFromText(a.eventDate),
      event_text: eventText,
      reason: str(a.reason, 200),
      certifier_name: str(a.certifierName, 160),
      certifier_position: str(a.certifierPosition, 160),
      certified_on: dateOrNull(a.certifiedOn),
      note: str(a.note, 300),
      to_wat_name: str(a.toWatName, 160),
      to_tambon: str(a.toTambon, 80),
      to_district: str(a.toDistrict, 80),
      to_province: str(a.toProvince, 80),
      to_event_text: toEventText
    };
  }).filter((a) => a.kind === "สังกัดเมื่อบวช" || a.wat_name || a.to_wat_name || a.event_date || a.event_text || a.reason || a.certifier_name);
}

function syncAffIntoBio(bio, affiliations) {
  const first = (affiliations || []).find((a) => a.kind === "สังกัดเมื่อบวช");
  if (first) {
    bio.firstAffWat = first.wat_name || "";
    bio.firstAffOn = first.event_text || "";
    bio.firstAbbot = first.certifier_name || "";
  }
  const moves = (affiliations || []).filter((a) => a.kind === "ย้ายสังกัด");
  const move = moves[moves.length - 1];
  if (move) {
    bio.moveFromWat = move.wat_name || "";
    bio.moveOn = move.event_text || (move.event_date ? String(move.event_date).slice(0, 10) : "");
    bio.moveReason = move.reason || "";
    bio.movedToWat = destWat(move) || bio.movedToWat || "";
  }
  return bio;
}

function readRains(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({
    year_be: intOrNull(a.yearBe, 2400, 2700),
    wat_name: str(a.watName, 160),
    tambon: str(a.tambon, 80),
    sangha_tambon: str(a.sanghaTambon, 80),
    district: str(a.district, 80),
    province: str(a.province, 80),
    age: intOrNull(a.age, 1, 130),
    vassa: intOrNull(a.vassa, 0, 100),
    secular_edu: str(a.secularEdu, 80),
    naktham: str(a.naktham, 40),
    naktham_year: str(a.nakthamYear, 20),
    naktham_school: str(a.nakthamSchool, 120),
    naktham_province: str(a.nakthamProvince, 80),
    pali: str(a.pali, 40),
    pali_year: str(a.paliYear, 20),
    pali_school: str(a.paliSchool, 120),
    pali_province: str(a.paliProvince, 80),
    remark: str(a.remark, 160),
    rain_kind: normalizeRainKind(str(a.rainKind, 40))
  })).filter((a) => a.year_be);
}

function readCourses(list) {
  return (Array.isArray(list) ? list : []).map((a) => {
    const kind = normalizeCourseKind(a.kind);
    return {
      kind,
      year_text: str(a.yearText || a.year, 80),
      place: str(a.place, 200),
      note: str(a.note, 200)
    };
  }).filter((a) => a.kind && (a.year_text || a.place || a.note));
}

function readBody(b) {
  const status = str(b.status, 40) || "จำพรรษา";
  const personType = str(b.personType, 20) || "ภิกษุ";
  const affiliations = readAffiliations(b.affiliations);
  const rains = readRains(b.rains);
  const latest = [...affiliations]
    .filter((a) => a.wat_name)
    .sort((x, y) => String(x.event_date || "").localeCompare(String(y.event_date || "")))
    .pop();
  const bio = readBio(b);
  const chayaPali = str(b.chayaPali, 80) || str(b.chaya, 80);
  const rankKind = normalizeRankKind(b.rankKind);
  const sanghaName = str(b.sanghaName, 160) || (isSanghaRankKind(rankKind) ? str(bio.royalName, 160) : "");
  applyCallingName(bio, sanghaName, rankKind);
  syncAffIntoBio(bio, affiliations);
  const watName = str(b.watName, 160) || (latest ? latest.wat_name : "");
  const fromAff = statusFromLastAffiliation(affiliations, status, bio.movedToWat, watName);
  bio.movedToWat = fromAff.movedToWat || "";
  return {
    person_type: PERSON_TYPES.includes(personType) ? personType : "ภิกษุ",
    chaya: chayaPali,
    former_name: str(b.formerName, 120),
    former_surname: str(b.formerSurname, 120),
    title: str(b.title, 160),
    sangha_name: sanghaName,
    chaya_pali: chayaPali,
    nikaya: str(b.nikaya, 80),
    sutthi_no: str(b.sutthiNo, 80),
    id_kind: normalizeIdKind(b.idKind != null ? b.idKind : b.id_kind),
    citizen_id: normalizePersonId(
      b.citizenId != null ? b.citizenId : b.citizen_id,
      normalizeIdKind(b.idKind != null ? b.idKind : b.id_kind)
    ),
    wat_id: intOrNull(b.watId != null ? b.watId : b.wat_id, 1, 1e9),
    stay_wat_id: intOrNull(b.stayWatId != null ? b.stayWatId : b.stay_wat_id, 1, 1e9),
    wat_name: watName,
    tambon: str(b.tambon, 80) || (latest ? latest.tambon : ""),
    sangha_tambon: str(b.sanghaTambon, 80),
    district: str(b.district, 80) || (latest ? latest.district : ""),
    province: str(b.province, 80) || (latest ? latest.province : ""),
    birth_year_be: intOrNull(b.birthYearBe, 2400, 2700),
    birth_province: str(b.birthProvince, 80),
    bio: bio,
    rank_kind: rankKind,
    is_dhammaduta: !!(b.isDhammaduta === true || b.isDhammaduta === "true" || b.isDhammaduta === "1"),
    is_preacher: !!(b.isPreacher === true || b.isPreacher === "true" || b.isPreacher === "1"),
    is_vipassana: !!(b.isVipassana === true || b.isVipassana === "true" || b.isVipassana === "1"),
    ordained_on: dateOrNull(b.ordainedOn),
    status: STATUSES.includes(fromAff.status) ? fromAff.status : (STATUSES.includes(status) ? status : "จำพรรษา"),
    note: str(b.note, 500),
    affiliations,
    rains,
    courses: readCourses(b.courses)
  };
}

async function applyWatIds(client, b) {
  if (b.wat_id) {
    const w = await client.query(
      `SELECT id, name, district, tambon, province, sangha_tambon FROM phra_wats WHERE id = $1`,
      [b.wat_id]
    );
    if (!w.rows[0]) throw Object.assign(new Error("ไม่พบวัดต้นสังกัด"), { status: 400 });
    const row = w.rows[0];
    b.wat_name = row.name;
    b.district = row.district || b.district;
    b.tambon = row.tambon || b.tambon;
    b.province = row.province || b.province;
    if (row.sangha_tambon) b.sangha_tambon = row.sangha_tambon;
  }
  if (b.stay_wat_id) {
    const w = await client.query(`SELECT id, name FROM phra_wats WHERE id = $1`, [b.stay_wat_id]);
    if (!w.rows[0]) throw Object.assign(new Error("ไม่พบวัดที่จำพรรษา"), { status: 400 });
    if (!b.bio || typeof b.bio !== "object") b.bio = {};
    b.bio.stayWat = w.rows[0].name;
  }
}

async function loadRelated(monkId) {
  const [aff, rains, courses] = await Promise.all([
    pool.query(
      `SELECT * FROM monk_affiliations WHERE monk_id=$1
       ORDER BY CASE kind WHEN 'สังกัดเมื่อบวช' THEN 0 ELSE 1 END, event_date NULLS LAST, id`,
      [monkId]
    ),
    pool.query(
      `SELECT * FROM monk_rains WHERE monk_id=$1 ORDER BY year_be DESC, id`,
      [monkId]
    ),
    pool.query(
      `SELECT * FROM monk_courses WHERE monk_id=$1 ORDER BY kind, year_text, id`,
      [monkId]
    )
  ]);
  return { affiliations: aff.rows, rains: rains.rows, courses: courses.rows };
}

async function saveRelated(client, monkId, b, user) {
  await client.query("DELETE FROM monk_affiliations WHERE monk_id=$1", [monkId]);
  for (const a of b.affiliations) {
    if (a.kind === "สังกัดเมื่อบวช" && !a.wat_name && !a.event_date && !a.event_text && !a.certifier_name) continue;
    await client.query(
      `INSERT INTO monk_affiliations
        (monk_id, kind, wat_name, tambon, district, province, event_date, event_text, reason,
         certifier_name, certifier_position, certified_on, note,
         to_wat_name, to_tambon, to_district, to_province, to_event_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        monkId, a.kind, a.wat_name, a.tambon, a.district, a.province, a.event_date,
        a.event_text || "", a.reason, a.certifier_name, a.certifier_position, a.certified_on, a.note,
        a.to_wat_name || "", a.to_tambon || "", a.to_district || "", a.to_province || "", a.to_event_text || ""
      ]
    );
  }
  const oldRains = await client.query("SELECT * FROM monk_rains WHERE monk_id=$1", [monkId]);
  const rains = await mergeRainsKeepingClosed(client, user, oldRains.rows, b.rains || []);
  if (rains && rains.length) {
    await client.query("DELETE FROM monk_rains WHERE monk_id=$1", [monkId]);
    for (const a of rains) {
      await client.query(
        `INSERT INTO monk_rains
        (monk_id, year_be, wat_name, tambon, sangha_tambon, district, province, age, vassa,
         secular_edu, naktham, naktham_year, naktham_school, naktham_province,
         pali, pali_year, pali_school, pali_province, remark, rain_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (monk_id, year_be) DO UPDATE SET
         wat_name=EXCLUDED.wat_name, tambon=EXCLUDED.tambon, sangha_tambon=EXCLUDED.sangha_tambon,
         district=EXCLUDED.district, province=EXCLUDED.province, age=EXCLUDED.age, vassa=EXCLUDED.vassa,
         secular_edu=EXCLUDED.secular_edu, naktham=EXCLUDED.naktham, naktham_year=EXCLUDED.naktham_year,
         naktham_school=EXCLUDED.naktham_school, naktham_province=EXCLUDED.naktham_province,
         pali=EXCLUDED.pali, pali_year=EXCLUDED.pali_year, pali_school=EXCLUDED.pali_school,
         pali_province=EXCLUDED.pali_province, remark=EXCLUDED.remark, rain_kind=EXCLUDED.rain_kind`,
        [
          monkId, a.year_be, a.wat_name, a.tambon, a.sangha_tambon || "", a.district, a.province, a.age, a.vassa,
          a.secular_edu || "", a.naktham || "", a.naktham_year || "", a.naktham_school || "", a.naktham_province || "",
          a.pali || "", a.pali_year || "", a.pali_school || "", a.pali_province || "", a.remark || "", a.rain_kind || ""
        ]
      );
    }
  }
  await client.query("DELETE FROM monk_courses WHERE monk_id=$1", [monkId]);
  for (const a of b.courses || []) {
    await client.query(
      `INSERT INTO monk_courses (monk_id, kind, year_text, place, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (monk_id, kind, year_text, place)
       DO UPDATE SET note = COALESCE(NULLIF(EXCLUDED.note, ''), monk_courses.note)`,
      [monkId, a.kind, a.year_text || "", a.place || "", a.note || ""]
    );
  }
}

function clientIp(req) {
  return String((req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")).split(",")[0].trim() || "local";
}

function reportPlaceOf(user, query) {
  let province = str(query && query.province, 80);
  let district = str(query && query.district, 80);
  const lv = user && user.accessLevel;
  if (lv === "province" && user.province) province = province || str(user.province, 80);
  if (lv === "district") {
    if (user.province) province = str(user.province, 80) || province;
    if (user.district) district = str(user.district, 80) || district;
  }
  return { province, district };
}

function adminNeedsPlacePick(user, bits) {
  if (!user || user.accessLevel !== "admin") return false;
  if (bits.q) return false;
  return !(bits.watName || bits.sanghaTambon || bits.district || bits.province || bits.unmatched);
}

const app = express();
app.disable("x-powered-by");
if (ON_RENDER) app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, app: "wat-phra" }));
app.post("/api/login", async (req, res) => {
  try {
    if (!loginAllowed(clientIp(req))) {
      return res.status(429).json({ error: "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" });
    }
    const out = await login(pool, (req.body && (req.body.email || req.body.username)), req.body && req.body.password);
    setSessionCookie(res, out.token);
    res.json({ user: out.user });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    res.status(status).json({ error: e.message || "เข้าสู่ระบบไม่สำเร็จ" });
  }
});
app.post("/api/register", async (req, res) => {
  try {
    if (!loginAllowed(clientIp(req))) {
      return res.status(429).json({ error: "ลองสมัครบ่อยเกินไป กรุณารอสักครู่" });
    }
    const body = req.body || {};
    const wat = await resolveWat(pool, {
      name: body.watName || body.name,
      district: body.district,
      province: body.province,
      tambon: body.tambon
    });
    const out = await registerUser(pool, body, wat);
    setSessionCookie(res, out.token);
    res.json({ user: out.user });
  } catch (e) {
    if (e && e.code === "23505") return res.status(409).json({ error: "เมลนี้สมัครแล้ว" });
    const status = e && e.status ? e.status : 500;
    res.status(status).json({ error: e.message || "สมัครไม่สำเร็จ" });
  }
});
const FORGOT_GENERIC = { ok: true, message: "ถ้ามีบัญชีนี้ ระบบส่งรหัส 6 หลักไปเมลแล้ว" };
app.post("/api/forgot-password", async (req, res) => {
  try {
    if (!loginAllowed(clientIp(req))) {
      return res.status(429).json({ error: "ขอลืมรหัสบ่อยเกินไป กรุณารอสักครู่" });
    }
    if (!(await isMailConfigured(pool))) {
      return res.status(503).json({ error: "ระบบยังส่งเมลไม่ได้ ผู้ดูแลแพลตฟอร์มต้องตั้งค่าส่งเมลก่อน" });
    }
    const out = await requestPasswordReset(pool, req.body && (req.body.email || req.body.username));
    if (out.user && out.code) {
      const name = out.user.display_name || out.user.username;
      await sendMail(pool, {
        to: out.user.username,
        subject: "รหัสตั้งรหัสผ่านใหม่ — ฐานข้อมูลพระภิกษุ",
        text: "เรียน " + name + "\n\nรหัส 6 หลักสำหรับตั้งรหัสผ่านใหม่: " + out.code + "\nใช้ได้ 15 นาที\nถ้าไม่ได้ขอไว้ ให้ทิ้งเมลนี้ได้เลย",
        html:
          "<p>เรียน " + escapeHtml(name) + "</p>" +
          "<p>รหัส 6 หลักสำหรับตั้งรหัสผ่านใหม่</p>" +
          '<p style="font-size:28px;letter-spacing:6px;font-weight:700;">' + escapeHtml(out.code) + "</p>" +
          "<p>ใช้ได้ 15 นาที ถ้าไม่ได้ขอไว้ ให้ทิ้งเมลนี้ได้เลย</p>"
      });
    }
    res.json(FORGOT_GENERIC);
  } catch (e) {
    if (e && e.code === "SMTP_NOT_CONFIGURED") {
      return res.status(503).json({ error: "ระบบยังส่งเมลไม่ได้ ผู้ดูแลแพลตฟอร์มต้องตั้งค่าส่งเมลก่อน" });
    }
    const status = e && e.status ? e.status : 500;
    res.status(status).json({ error: status >= 500 ? mailErrorMessage(e) : (e.message || "ส่งรหัสไม่สำเร็จ") });
  }
});
app.post("/api/reset-password", async (req, res) => {
  try {
    if (!loginAllowed(clientIp(req))) {
      return res.status(429).json({ error: "ลองตั้งรหัสบ่อยเกินไป กรุณารอสักครู่" });
    }
    const out = await resetPasswordWithCode(
      pool,
      req.body && (req.body.email || req.body.username),
      req.body && (req.body.code || req.body.token),
      req.body && (req.body.newPassword || req.body.password)
    );
    res.json({ ok: true, email: out.email, message: "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยเมลและรหัสใหม่ได้เลย" });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    res.status(status).json({ error: e.message || "ตั้งรหัสผ่านใหม่ไม่สำเร็จ" });
  }
});
app.use("/api", requireAuth(pool));
app.get("/api/me", (req, res) => {
  res.json({
    user: req.user,
    canManagePlaces: canManagePlaces(req.user),
    canManageUsers: canManageUsers(req.user)
  });
});
app.post("/api/me/request-level", async (req, res) => {
  try {
    const user = await requestLevel(pool, req.user, req.body && (req.body.accessLevel || req.body.level));
    res.json({ user });
  } catch (e) {
    sendErr(res, e, "ส่งคำขอไม่สำเร็จ");
  }
});
app.post("/api/logout", async (req, res) => {
  try {
    await destroySession(pool, req);
  } catch (e) {}
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get("/api/users", requireUserManager, async (req, res) => {
  try {
    const params = [];
    const where = usersVisibleWhere(req.user, params);
    const r = await pool.query(
      "SELECT * FROM phra_users WHERE 1=1" + where + " ORDER BY CASE WHEN requested_level <> '' THEN 0 ELSE 1 END, access_level, username, id",
      params
    );
    res.json({
      users: r.rows.map((row) => {
        const u = publicUser(row);
        u.canApprove = canApproveRequested(req.user, u);
        return u;
      })
    });
  } catch (e) {
    sendErr(res, e, "อ่านผู้ใช้ไม่สำเร็จ");
  }
});
app.post("/api/users", requireAdmin, async (req, res) => {
  try {
    const b = await fillUserScope(pool, readUserBody(req.body || {}, true));
    const r = await pool.query(
      `INSERT INTO phra_users (username, password_hash, display_name, access_level, wat_id, wat_name, sangha_tambon, district, province)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.username, hashPassword(b.password), b.displayName, b.accessLevel, b.watId, b.watName, b.sanghaTambon, b.district, b.province]
    );
    res.json({ user: publicUser(r.rows[0]) });
  } catch (e) {
    if (e && e.code === "23505") return res.status(409).json({ error: "เมลนี้มีแล้ว" });
    sendErr(res, e, "เพิ่มผู้ใช้ไม่สำเร็จ");
  }
});
app.patch("/api/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ไม่พบผู้ใช้" });
    const b = await fillUserScope(pool, readUserBody(req.body || {}, false));
    const cur = await pool.query("SELECT * FROM phra_users WHERE id=$1", [id]);
    if (!cur.rowCount) return res.status(404).json({ error: "ไม่พบผู้ใช้" });
    if (cur.rows[0].access_level === "admin" && b.accessLevel !== "admin") {
      const n = await pool.query("SELECT COUNT(*)::int AS n FROM phra_users WHERE access_level='admin'");
      if (n.rows[0].n <= 1) return res.status(400).json({ error: "ต้องเหลือผู้ดูแลระบบอย่างน้อยหนึ่งคน" });
    }
    const hash = b.password ? hashPassword(b.password) : cur.rows[0].password_hash;
    const username = b.username || cur.rows[0].username;
    const r = await pool.query(
      `UPDATE phra_users SET username=$2, password_hash=$3, display_name=$4, access_level=$5,
         wat_id=$6, wat_name=$7, sangha_tambon=$8, district=$9, province=$10, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, username, hash, b.displayName, b.accessLevel, b.watId, b.watName, b.sanghaTambon, b.district, b.province]
    );
    res.json({ user: publicUser(r.rows[0]) });
  } catch (e) {
    if (e && e.code === "23505") return res.status(409).json({ error: "เมลนี้มีแล้ว" });
    sendErr(res, e, "แก้ผู้ใช้ไม่สำเร็จ");
  }
});
app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ไม่พบผู้ใช้" });
    if (req.user.id === id) return res.status(400).json({ error: "ลบบัญชีตนเองไม่ได้" });
    const cur = await pool.query("SELECT access_level FROM phra_users WHERE id=$1", [id]);
    if (!cur.rowCount) return res.status(404).json({ error: "ไม่พบผู้ใช้" });
    if (cur.rows[0].access_level === "admin") {
      const n = await pool.query("SELECT COUNT(*)::int AS n FROM phra_users WHERE access_level='admin'");
      if (n.rows[0].n <= 1) return res.status(400).json({ error: "ต้องเหลือผู้ดูแลระบบอย่างน้อยหนึ่งคน" });
    }
    await pool.query("DELETE FROM phra_users WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) {
    sendErr(res, e, "ลบผู้ใช้ไม่สำเร็จ");
  }
});
app.post("/api/users/:id/approve", requireUserManager, async (req, res) => {
  try {
    const user = await approveRequestedLevel(pool, req.user, req.params.id, req.body || {});
    res.json({ user });
  } catch (e) {
    sendErr(res, e, "อนุมัติไม่สำเร็จ");
  }
});
app.post("/api/users/:id/reject", requireUserManager, async (req, res) => {
  try {
    const user = await rejectRequestedLevel(pool, req.user, req.params.id);
    res.json({ user });
  } catch (e) {
    sendErr(res, e, "ปฏิเสธไม่สำเร็จ");
  }
});
app.get("/api/mail-settings", requireAdmin, async (req, res) => {
  try {
    res.json(await publicMailSettings(pool));
  } catch (e) {
    sendErr(res, e, "อ่านตั้งค่าเมลไม่สำเร็จ");
  }
});
app.put("/api/mail-settings", requireAdmin, async (req, res) => {
  try {
    res.json(await saveMailSettings(pool, req.body || {}));
  } catch (e) {
    sendErr(res, e, "บันทึกตั้งค่าเมลไม่สำเร็จ");
  }
});
app.post("/api/mail-settings/test", requireAdmin, async (req, res) => {
  try {
    const to = String((req.body && req.body.to) || req.user.username || "").trim();
    await sendMail(pool, {
      to,
      subject: "ทดสอบส่งเมล — ฐานข้อมูลพระภิกษุ",
      text: "ถ้าเห็นเมลนี้ แสดงว่าตั้งค่าส่งเมลสำเร็จแล้ว ต่อไปลืมรหัสผ่านจะส่งรหัส 6 หลักมาที่เมลได้",
      html: "<p>ถ้าเห็นเมลนี้ แสดงว่าตั้งค่าส่งเมลสำเร็จแล้ว</p><p>ต่อไปลืมรหัสผ่านจะส่งรหัส 6 หลักมาที่เมลได้</p>"
    });
    res.json({ ok: true, message: "ส่งเมลทดสอบแล้ว" });
  } catch (e) {
    const status = e && e.code === "SMTP_NOT_CONFIGURED" ? 503 : 500;
    res.status(status).json({ error: mailErrorMessage(e) });
  }
});
app.get("/api/samanasak", (req, res) => {
  res.json({ classes: SAMANASAK_CLASS, groups: SAMANASAK_GROUPS, names: THANANAMA, offices: THANANAMA, all: SAMANASAK });
});

function normWat(name) {
  return String(name || "")
    .replace(/วัด/g, "")
    .replace(/ราชวรมหาวิหาร|ราชวรวิหาร|วรมหาวิหาร|วรวิหาร/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isoDate(v) {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return y + "-" + mo + "-" + da;
}

function ceToBe(iso) {
  const y = parseInt(String(iso || "").slice(0, 4), 10);
  return Number.isFinite(y) && y > 1800 && y < 2200 ? y + 543 : null;
}

function stayAtWat(watName, rains, affiliations, asOfYear) {
  const target = normWat(watName);
  const asOf = asOfYear || currentBe();
  const empty = { yearsAtWat: null, yearsAtWatFrom: "", joinedWatOn: "", stillHere: false, stays: [], borrowed: [] };
  if (!target) return empty;

  const borrowed = [];
  const borrowedYears = {};
  const byYear = {};
  for (const r of rains || []) {
    const y = r.year_be != null ? r.year_be : r.yearBe;
    const w = r.wat_name != null ? r.wat_name : r.watName;
    const kind = r.rain_kind || r.rainKind || "";
    if (!y) continue;
    if (isAwayVassa(kind)) {
      borrowed.push({ yearBe: y, watName: w || "", rainKind: kind });
      borrowedYears[y] = true;
      continue;
    }
    if (w) byYear[y] = w;
  }
  borrowed.sort((a, b) => a.yearBe - b.yearBe);

  const aff = affiliations || [];
  const hasMove = aff.some((a) => a.kind === "ย้ายสังกัด" && (a.wat_name || a.watName || a.to_wat_name || a.toWatName));

  function affIso(a) {
    return isoDate(a.event_date || a.eventDate) || isoFromText(a.event_text || a.eventText) || "";
  }
  const periods = [];
  for (const a of aff) {
    if (a.kind === "สังกัดเมื่อบวช" || a.kind === "รับเข้าสังกัด") {
      const wat = a.wat_name || a.watName || "";
      if (wat) periods.push({ wat, fromIso: affIso(a) });
    } else if (a.kind === "ย้ายสังกัด") {
      const toWat = a.to_wat_name || a.toWatName || "";
      const toIso = isoFromText(a.to_event_text || a.toEventText) || affIso(a);
      if (toWat) periods.push({ wat: toWat, fromIso: toIso });
    }
  }
  periods.sort((a, b) => String(a.fromIso).localeCompare(String(b.fromIso)));

  const stays = periods.map((p, i) => {
    const next = periods[i + 1];
    const startBe = p.fromIso ? ceToBe(p.fromIso) : null;
    const endBe = next && next.fromIso ? ceToBe(next.fromIso) : asOf;
    let years = null;
    if (startBe && endBe) {
      years = next ? Math.max(1, endBe - startBe) : Math.max(1, endBe - startBe + 1);
    }
    return { watName: p.wat, years, fromIso: p.fromIso, current: !next };
  });

  const last = stays[stays.length - 1];
  const stillHere = !hasMove || !!(last && last.current && normWat(last.watName) === target);

  let fromRains = null;
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  const startYear = byYear[asOf] && normWat(byYear[asOf]) === target
    ? asOf
    : years.find((y) => y <= asOf && normWat(byYear[y]) === target);
  if (startYear) {
    fromRains = 0;
    for (let y = startYear; y >= 2400; y--) {
      if (borrowedYears[y]) continue;
      if (!byYear[y] || normWat(byYear[y]) !== target) break;
      fromRains += 1;
    }
  }

  const homeStay = stays.filter((s) => normWat(s.watName) === target).pop();
  const joinedWatOn = (homeStay && homeStay.fromIso) || "";
  const fromSutthi = homeStay && homeStay.years ? homeStay.years : (joinedWatOn ? Math.max(1, asOf - (ceToBe(joinedWatOn) || asOf) + 1) : null);

  let yearsAtWat = null;
  let yearsAtWatFrom = "";
  if (stillHere && !hasMove) {
    yearsAtWatFrom = "ยังคงจำพรรษา ณ วัดนี้";
    if (fromSutthi) yearsAtWat = fromSutthi;
    else if (fromRains) yearsAtWat = fromRains;
  } else if (fromSutthi && fromRains && fromSutthi > fromRains) {
    yearsAtWat = fromSutthi;
    yearsAtWatFrom = "รับเข้าสังกัด";
  } else if (fromRains) {
    yearsAtWat = fromRains;
    yearsAtWatFrom = "บัญชีจำพรรษา";
  } else if (fromSutthi) {
    yearsAtWat = fromSutthi;
    yearsAtWatFrom = "รับเข้าสังกัด";
  }

  return { yearsAtWat, yearsAtWatFrom, joinedWatOn, stillHere, stays, borrowed };
}

function rainAt(rains, year, status) {
  return pickRain(rains, year, status) || (rains || []).find((x) => Number(x.year_be != null ? x.year_be : x.yearBe) === Number(year)) || null;
}

function rainKindAt(rains, year, status) {
  const hit = rainAt(rains, year, status);
  return hit ? (hit.rain_kind || hit.rainKind || "") : "";
}

function reportRow(r, stay, rains, asOf, courses, affiliations) {
  const stayCls = classifyRanks(r, courses);
  const stand = standingOf(r.bio, rains, r.title, r.note);
  const typeAt = personTypeAt(r, asOf);
  const oy = typeAt === "สามเณร" ? null : ordainedYearBe(r, rains);
  const computed = vassaFor(r, rains, asOf);
  const age = ageAt(r, rains, asOf);
  return {
    id: r.id,
    personType: typeAt,
    title: r.title || "",
    chaya: r.chaya,
    sanghaName: r.sangha_name || "",
    chayaPali: r.chaya_pali || "",
    royalName: (r.bio && r.bio.royalName) || r.sangha_name || "",
    formerName: r.former_name || "",
    formerSurname: r.former_surname || "",
    displayName: displayNameAt(r, typeAt),
    citizenId: r.citizen_id || "",
    idKind: r.id_kind === "passport" ? "passport" : "thai",
    watName: r.wat_name || "",
    tambon: r.tambon || "",
    sanghaTambon: r.sangha_tambon || "",
    district: r.district || "",
    province: r.province || "",
    age: age != null ? age : r.age,
    vassa: typeAt === "สามเณร" ? null : computed,
    ordainedYearBe: oy,
    status: r.status || "จำพรรษา",
    movedToWat: (r.bio && r.bio.movedToWat) || "",
    rankKind: stayCls.rankKind,
    isDhammaduta: stayCls.isDhammaduta,
    isPreacher: stayCls.isPreacher,
    isVipassana: stayCls.isVipassana,
    isPariyatti: stayCls.isPariyatti,
    isBandit: stayCls.isBandit,
    ranks: stayCls.ranks,
    eduStanding: stand.label,
    eduRemark: stand.remark,
    paliRank: stand.paliRank,
    nakthamRank: stand.nakthamRank,
    isParian: stand.isParian,
    yearsAtWat: stay ? stay.yearsAtWat : null,
    yearsAtWatFrom: stay ? stay.yearsAtWatFrom : "",
    joinedWatOn: stay ? stay.joinedWatOn : "",
    stillHere: stay ? stay.stillHere : false,
    stays: stay ? stay.stays || [] : [],
    borrowed: stay ? stay.borrowed || [] : [],
    affWatName: r.aff_wat_name || "",
    originWatName: affHomeWat(affiliations, r.aff_wat_name || ""),
    rainKindYear: rainKindAt(rains, asOf, r.status) || r.rain_kind || "",
    rainWatYear: (function () {
      const hit = rainAt(rains, asOf, r.status);
      return hit ? (hit.wat_name || hit.watName || "") : "";
    }()),
    rainRemarkYear: (function () {
      const hit = rainAt(rains, asOf, r.status);
      return hit ? (hit.remark || "") : "";
    }()),
    birthYearBe: r.birth_year_be || "",
    birthProvince: r.birth_province || "",
    note: r.note || "",
    rainsForm: formRow(Object.assign({}, r, {
      age: age != null ? age : r.age,
      vassa: typeAt === "สามเณร" ? null : computed,
      personType: typeAt
    }), rainAt(rains, asOf, r.status), stand)
  };
}

function carryFilterParams(user, fromYear, toYear, watName, sanghaTambon, unmatched) {
  const params = [fromYear, toYear, watName || "", unmatched ? "" : (sanghaTambon || ""), unmatched ? 1 : 0];
  const { fromWhere } = carrySourceSql(WAT_PLACE_SQL);
  const sql = insertBeforeOrderBy(fromWhere, appendViewScope(user, params, "m"));
  return { params, sql };
}

app.get("/api/rains/carry-preview", async (req, res) => {
  try {
    const yearBe = intOrNull(req.query.yearBe, 2400, 2700);
    if (!yearBe) return res.status(400).json({ error: "เลือกปีจำพรรษาก่อน" });
    const fromYear = intOrNull(req.query.fromYear, 2400, 2700) || yearBe - 1;
    const watName = str(req.query.watName, 160);
    const sanghaTambon = str(req.query.sanghaTambon, 80);
    const unmatched = String(req.query.unmatched || "") === "1";
    const { params, sql } = carryFilterParams(req.user, fromYear, yearBe, watName, sanghaTambon, unmatched);
    const r = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE m.person_type = 'สามเณร')::int AS novices " + sql, params);
    res.json({
      fromYear,
      yearBe,
      willCopy: r.rows[0].n,
      novices: r.rows[0].novices,
      monks: r.rows[0].n - r.rows[0].novices
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "นับรายชื่อที่จะยกมาไม่สำเร็จ" });
  }
});

app.post("/api/rains/carry", async (req, res) => {
  try {
    const b = req.body || {};
    const yearBe = intOrNull(b.yearBe, 2400, 2700);
    if (!yearBe) return res.status(400).json({ error: "เลือกปีจำพรรษาก่อน" });
    const fromYear = intOrNull(b.fromYear, 2400, 2700) || yearBe - 1;
    if (fromYear === yearBe) return res.status(400).json({ error: "ปียกมาต้องไม่ซ้ำกับปีที่สร้าง" });
    const watName = str(b.watName, 160);
    const sanghaTambon = str(b.sanghaTambon, 80);
    const unmatched = String(b.unmatched || "") === "1";
    await assertYearWritable(pool, req.user, yearBe, {
      watName,
      sanghaTambon: unmatched ? "" : sanghaTambon,
      province: req.user && req.user.province || ""
    });
    const { params, sql } = carryFilterParams(req.user, fromYear, yearBe, watName, sanghaTambon, unmatched);
    const ins = await pool.query(
      `INSERT INTO monk_rains (
          monk_id, year_be, wat_name, tambon, sangha_tambon, district, province,
          secular_edu, naktham, naktham_year, naktham_school, naktham_province,
          pali, pali_year, pali_school, pali_province, remark, rain_kind
        )
        SELECT m.id, $2, y.wat_name, y.tambon, y.sangha_tambon, y.district, y.province,
               y.secular_edu, y.naktham, y.naktham_year, y.naktham_school, y.naktham_province,
               y.pali, y.pali_year, y.pali_school, y.pali_province, y.remark, y.rain_kind
        ${sql}
        ON CONFLICT (monk_id, year_be) DO UPDATE SET
          wat_name = EXCLUDED.wat_name,
          tambon = EXCLUDED.tambon,
          sangha_tambon = EXCLUDED.sangha_tambon,
          district = EXCLUDED.district,
          province = EXCLUDED.province,
          secular_edu = EXCLUDED.secular_edu,
          naktham = EXCLUDED.naktham,
          naktham_year = EXCLUDED.naktham_year,
          naktham_school = EXCLUDED.naktham_school,
          naktham_province = EXCLUDED.naktham_province,
          pali = EXCLUDED.pali,
          pali_year = EXCLUDED.pali_year,
          pali_school = EXCLUDED.pali_school,
          pali_province = EXCLUDED.pali_province,
          remark = EXCLUDED.remark,
          rain_kind = EXCLUDED.rain_kind
        RETURNING monk_id`,
      params
    );
    res.json({ fromYear, yearBe, copied: ins.rowCount || 0 });
  } catch (e) {
    sendErr(res, e, "ยกมาจำพรรษาไม่สำเร็จ");
  }
});

app.post("/api/rains/return-home", async (req, res) => {
  try {
    const b = req.body || {};
    const yearBe = intOrNull(b.yearBe, 2400, 2700);
    const monkId = intOrNull(b.monkId != null ? b.monkId : b.id, 1, 1e9);
    if (!yearBe) return res.status(400).json({ error: "เลือกปีจำพรรษาก่อน" });
    if (!monkId) return res.status(400).json({ error: "ไม่พบรายการ" });
    const visParams = [monkId];
    const vis = await pool.query(
      "SELECT * FROM monks m WHERE m.id=$1" + appendViewScope(req.user, visParams, "m"),
      visParams
    );
    if (!vis.rowCount) {
      const exists = await pool.query("SELECT id FROM monks WHERE id=$1", [monkId]);
      if (!exists.rowCount) return res.status(404).json({ error: "ไม่พบรายการ" });
      return res.status(403).json({ error: "รายการนี้อยู่นอกเขตที่ได้รับสิทธิ์" });
    }
    const monk = vis.rows[0];
    const st = String(monk.status || "จำพรรษา").trim() || "จำพรรษา";
    if (st === "มรณภาพ" || st === "ลาสิกขา" || st === "ย้ายวัด") {
      return res.status(400).json({ error: "รูปนี้ไม่ใช่จำพรรษา จึงกลับต้นสังกัดปีนี้ไม่ได้" });
    }
    const aff = await pool.query(
      `SELECT * FROM monk_affiliations WHERE monk_id=$1
        ORDER BY CASE kind WHEN 'สังกัดเมื่อบวช' THEN 0 ELSE 1 END, event_date NULLS LAST, id`,
      [monkId]
    );
    const home = homeRainPlace(aff.rows, monk);
    if (!home || !home.wat_name) return res.status(400).json({ error: "ยังไม่มีต้นสังกัดในหนังสือสุทธิ" });
    const rain = await pool.query(
      "SELECT wat_name FROM monk_rains WHERE monk_id=$1 AND year_be=$2",
      [monkId, yearBe]
    );
    const curWat = rain.rowCount ? rain.rows[0].wat_name : "";
    if (curWat && sameWatName(curWat, home.wat_name)) {
      return res.status(400).json({ error: "ปีนี้จำพรรษาที่ต้นสังกัดอยู่แล้ว" });
    }
    const pw = await pool.query(
      `SELECT tambon, sangha_tambon, district, province FROM ${WAT_PLACE_SQL} pw
        WHERE lower(pw.name) = lower($1)
        ORDER BY CASE WHEN pw.sangha_tambon <> '' THEN 0 ELSE 1 END
        LIMIT 1`,
      [home.wat_name]
    );
    const place = pw.rows[0] || {};
    await assertYearWritable(pool, req.user, yearBe, {
      watName: home.wat_name,
      sanghaTambon: home.sangha_tambon || place.sangha_tambon || "",
      province: home.province || place.province || monk.province || ""
    });
    if (curWat) {
      await assertYearWritable(pool, req.user, yearBe, {
        watName: curWat,
        sanghaTambon: monk.sangha_tambon || "",
        province: monk.province || ""
      });
    }
    await pool.query(
      `INSERT INTO monk_rains (monk_id, year_be, wat_name, tambon, sangha_tambon, district, province, rain_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'')
       ON CONFLICT (monk_id, year_be) DO UPDATE SET
         wat_name = EXCLUDED.wat_name,
         tambon = EXCLUDED.tambon,
         sangha_tambon = EXCLUDED.sangha_tambon,
         district = EXCLUDED.district,
         province = EXCLUDED.province,
         rain_kind = ''`,
      [
        monkId, yearBe, home.wat_name,
        home.tambon || place.tambon || "",
        home.sangha_tambon || place.sangha_tambon || "",
        home.district || place.district || "",
        home.province || place.province || ""
      ]
    );
    res.json({ monkId, yearBe, watName: home.wat_name });
  } catch (e) {
    sendErr(res, e, "กลับต้นสังกัดไม่สำเร็จ");
  }
});

app.post("/api/rains/presence", async (req, res) => {
  try {
    const b = req.body || {};
    const yearBe = intOrNull(b.yearBe, 2400, 2700);
    const monkId = intOrNull(b.monkId != null ? b.monkId : b.id, 1, 1e9);
    const action = String(b.action || "").trim();
    if (!yearBe) return res.status(400).json({ error: "เลือกปีจำพรรษาก่อน" });
    if (!monkId) return res.status(404).json({ error: "ไม่พบรายการ" });
    if (action !== "absent" && action !== "present" && action !== "drop") {
      return res.status(400).json({ error: "ไม่รู้จักคำสั่งนี้" });
    }
    if ((action === "absent" || action === "present") && yearBe < currentBe()) {
      return res.status(400).json({ error: "ยังไม่มาใช้ได้ตั้งแต่ปีปัจจุบันเป็นต้นไป" });
    }
    const visParams = [monkId];
    const vis = await pool.query(
      "SELECT * FROM monks m WHERE m.id=$1" + appendViewScope(req.user, visParams, "m"),
      visParams
    );
    if (!vis.rowCount) {
      const exists = await pool.query("SELECT id FROM monks WHERE id=$1", [monkId]);
      if (!exists.rowCount) return res.status(404).json({ error: "ไม่พบรายการ" });
      return res.status(403).json({ error: "รายการนี้อยู่นอกเขตที่ได้รับสิทธิ์" });
    }
    const monk = vis.rows[0];
    const st = String(monk.status || "จำพรรษา").trim() || "จำพรรษา";
    if (st === "มรณภาพ" || st === "ลาสิกขา" || st === "ย้ายวัด") {
      return res.status(400).json({ error: "รูปนี้ไม่ใช่จำพรรษา จึงแก้ปีนี้จากรายชื่อไม่ได้" });
    }
    const rain = await pool.query(
      "SELECT id, rain_kind, wat_name, sangha_tambon, province FROM monk_rains WHERE monk_id=$1 AND year_be=$2",
      [monkId, yearBe]
    );
    if (!rain.rowCount) return res.status(400).json({ error: "ยังไม่มีบัญชีจำพรรษาปี " + yearBe });
    await assertYearWritable(pool, req.user, yearBe, {
      watName: rain.rows[0].wat_name || monk.wat_name || "",
      sanghaTambon: rain.rows[0].sangha_tambon || monk.sangha_tambon || "",
      province: rain.rows[0].province || monk.province || ""
    });
    if (action === "drop") {
      await pool.query("DELETE FROM monk_rains WHERE monk_id=$1 AND year_be=$2", [monkId, yearBe]);
      return res.json({ monkId, yearBe, action, rainKind: "" });
    }
    const rainKind = action === "absent" ? RAIN_KIND_PENDING : "";
    await pool.query(
      "UPDATE monk_rains SET rain_kind = $3 WHERE monk_id=$1 AND year_be=$2",
      [monkId, yearBe, rainKind]
    );
    res.json({ monkId, yearBe, action, rainKind });
  } catch (e) {
    sendErr(res, e, "แก้สถานะจำพรรษาปีนี้ไม่สำเร็จ");
  }
});

app.get("/api/rains/year-lock", async (req, res) => {
  try {
    const yearBe = intOrNull(req.query.yearBe, 2400, 2700);
    if (!yearBe) return res.status(400).json({ error: "เลือกปีจำพรรษาก่อน" });
    const watName = str(req.query.watName, 160);
    const sanghaTambon = str(req.query.sanghaTambon, 80);
    res.json(await yearLockStatus(pool, req.user, yearBe, watName, sanghaTambon));
  } catch (e) {
    sendErr(res, e, "อ่านสถานะปีจำพรรษาไม่สำเร็จ");
  }
});

app.get("/api/rains/year-locks", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT year_be, scope, scope_key, closed, closed_at, reopened_at
         FROM rain_year_locks
        WHERE closed = TRUE
        ORDER BY year_be DESC, scope, scope_key`
    );
    res.json({
      locks: r.rows.map((x) => ({
        yearBe: x.year_be,
        scope: x.scope,
        scopeKey: x.scope_key,
        closed: x.closed,
        closedAt: x.closed_at,
        label: (x.scope === "wat" ? "วัด " : x.scope === "tambon" ? "ตำบล " : x.scope === "province" ? "จังหวัด " : "ทั้งระบบ ") + (x.scope_key || "")
      }))
    });
  } catch (e) {
    sendErr(res, e, "อ่านปีที่ปิดไม่สำเร็จ");
  }
});

app.post("/api/rains/year-lock", async (req, res) => {
  try {
    const b = req.body || {};
    const yearBe = intOrNull(b.yearBe, 2400, 2700);
    const closed = b.closed === true || b.closed === "true" || b.action === "close";
    const open = b.closed === false || b.closed === "false" || b.action === "open";
    if (!closed && !open) return res.status(400).json({ error: "ระบุปิดปีหรือเปิดปี" });
    const watName = str(b.watName, 160);
    const sanghaTambon = str(b.sanghaTambon, 80);
    const province = str(b.province, 80);
    res.json(await setYearClosed(pool, req.user, yearBe, watName, sanghaTambon, closed && !open, province));
  } catch (e) {
    sendErr(res, e, "บันทึกการปิดปีไม่สำเร็จ");
  }
});

app.get("/api/report", async (req, res) => {
  try {
    const q = searchQ(req.query.q);
    const yearBe = intOrNull(req.query.yearBe, 2400, 2700);
    const tambon = str(req.query.tambon, 80);
    const sanghaTambon = str(req.query.sanghaTambon, 80);
    const watName = str(req.query.watName, 160);
    const place = reportPlaceOf(req.user, req.query);
    const district = place.district || str(req.query.district, 80);
    const province = place.province;
    const unmatched = String(req.query.unmatched || "") === "1";
    const statusWanted = STATUSES.includes(str(req.query.status, 40)) ? str(req.query.status, 40) : "";
    const statusSql = `COALESCE(NULLIF(m.status,''), 'จำพรรษา')`;
    const sanghaExpr = `COALESCE(NULLIF(pw.sangha_tambon,''), NULLIF(y.sangha_tambon,''), m.sangha_tambon)`;
    const sanghaExprM = `COALESCE(NULLIF(pw.sangha_tambon,''), m.sangha_tambon)`;
    const yearSql = `SELECT m.id, m.person_type, m.chaya, m.title, m.former_name, m.former_surname, m.status,
            COALESCE(NULLIF(y.wat_name,''), m.wat_name) AS wat_name,
            COALESCE(NULLIF(pw.tambon,''), NULLIF(y.tambon,''), m.tambon) AS tambon,
            ${sanghaExpr} AS sangha_tambon,
            COALESCE(NULLIF(pw.district,''), NULLIF(y.district,''), m.district) AS district,
            COALESCE(NULLIF(pw.province,''), NULLIF(y.province,''), m.province) AS province,
            y.age, y.vassa, m.birth_year_be, m.birth_province,
            m.ordained_on, m.note, m.bio, m.sangha_name, m.chaya_pali, m.rank_kind,
            m.is_dhammaduta, m.is_preacher, m.is_vipassana, m.citizen_id, m.id_kind,
            m.wat_name AS aff_wat_name, y.rain_kind
         FROM monks m
         JOIN monk_rains y ON y.monk_id = m.id AND y.year_be = $2
         LEFT JOIN ${WAT_PLACE_SQL} pw ON lower(pw.name) = lower(COALESCE(NULLIF(y.wat_name,''), m.wat_name))
          AND (COALESCE(NULLIF(y.district,''), m.district) = '' OR lower(pw.district) = lower(COALESCE(NULLIF(y.district,''), m.district)))
         WHERE ($1 = '' OR lower(m.chaya||' '||m.chaya_pali||' '||m.sangha_name||' '||COALESCE(m.bio->>'royalName','')||' '||COALESCE(m.bio::text,'')||' '||m.former_name||' '||m.former_surname||' '||m.title||' '||COALESCE(y.wat_name,'')||' '||m.wat_name||' '||m.citizen_id) LIKE '%'||$1||'%')
           AND ($3 = '' OR COALESCE(NULLIF(pw.tambon,''), NULLIF(y.tambon,''), m.tambon) = $3)
           AND ($4 = '' OR COALESCE(NULLIF(pw.district,''), NULLIF(y.district,''), m.district) = $4)
           AND ($5 = '' OR ${sanghaExpr} = $5)
           AND ($6 = '' OR COALESCE(NULLIF(y.wat_name,''), m.wat_name) = $6 OR m.wat_name = $6)
           AND ($7 = 0 OR ${sanghaExpr} = '')
           AND ($8 = '' OR ${statusSql} = $8)
           AND ($9 = '' OR COALESCE(NULLIF(pw.province,''), NULLIF(y.province,''), m.province) = $9)
         ORDER BY ${sanghaExpr}, CASE WHEN COALESCE(m.person_type, 'ภิกษุ') = 'สามเณร' THEN 1 ELSE 0 END, 8, m.chaya, m.id`;
    const allSql = `SELECT m.id, m.person_type, m.chaya, m.title, m.former_name, m.former_surname, m.status,
            m.wat_name,
            COALESCE(NULLIF(pw.tambon,''), m.tambon) AS tambon,
            ${sanghaExprM} AS sangha_tambon,
            COALESCE(NULLIF(pw.district,''), m.district) AS district,
            COALESCE(NULLIF(pw.province,''), m.province) AS province,
            NULL::int AS age, NULL::int AS vassa, m.birth_year_be, m.birth_province,
            m.ordained_on, m.note, m.bio, m.sangha_name, m.chaya_pali, m.rank_kind,
            m.is_dhammaduta, m.is_preacher, m.is_vipassana, m.citizen_id, m.id_kind,
            m.wat_name AS aff_wat_name, ''::text AS rain_kind
         FROM monks m
         LEFT JOIN ${WAT_PLACE_SQL} pw ON lower(pw.name) = lower(m.wat_name)
          AND (m.district = '' OR lower(pw.district) = lower(m.district))
         WHERE ($1 = '' OR lower(m.chaya||' '||m.chaya_pali||' '||m.sangha_name||' '||COALESCE(m.bio->>'royalName','')||' '||COALESCE(m.bio::text,'')||' '||m.former_name||' '||m.former_surname||' '||m.title||' '||m.wat_name||' '||m.citizen_id) LIKE '%'||$1||'%')
           AND ($2 = '' OR COALESCE(NULLIF(pw.tambon,''), m.tambon) = $2)
           AND ($3 = '' OR COALESCE(NULLIF(pw.district,''), m.district) = $3)
           AND ($4 = '' OR ${sanghaExprM} = $4)
           AND ($5 = '' OR m.wat_name = $5)
           AND ($6 = '' OR ${statusSql} = $6)
           AND ($7 = '' OR COALESCE(NULLIF(pw.province,''), m.province) = $7)
         ORDER BY ${sanghaExprM}, CASE WHEN COALESCE(m.person_type, 'ภิกษุ') = 'สามเณร' THEN 1 ELSE 0 END, m.wat_name, m.chaya, m.id`;
    if (adminNeedsPlacePick(req.user, { q, watName, sanghaTambon, district, province, unmatched })) {
      return res.json({
        yearBe: yearBe || null, total: 0, monks: 0, novices: 0,
        tambons: [], sanghaTambons: [], wats: [],
        rankCounts: {}, statusCounts: {}, rainsHeader: {}, yearLock: null,
        rows: [], needPlace: true
      });
    }
    const yearParams = [q, yearBe, tambon, district, unmatched ? "" : sanghaTambon, watName, unmatched ? 1 : 0, statusWanted, province];
    const allParams = [q, tambon, district, sanghaTambon, watName, statusWanted, province];
    const r = yearBe
      ? await pool.query(insertBeforeOrderBy(yearSql, appendViewScope(req.user, yearParams, "m")), yearParams)
      : await pool.query(insertBeforeOrderBy(allSql, appendViewScope(req.user, allParams, "m")), allParams);
    const ids = r.rows.map((row) => row.id);
    const rainsBy = {};
    const affBy = {};
    const courseBy = {};
    if (ids.length) {
      const [rainQ, affQ, courseQ] = await Promise.all([
        pool.query("SELECT monk_id, year_be, wat_name, vassa, rain_kind, age, naktham, pali, secular_edu, naktham_year, naktham_school, naktham_province, pali_year, pali_school, pali_province, remark FROM monk_rains WHERE monk_id = ANY($1::int[])", [ids]),
        pool.query("SELECT monk_id, kind, wat_name, event_date, event_text, to_wat_name, to_event_text FROM monk_affiliations WHERE monk_id = ANY($1::int[])", [ids]),
        pool.query("SELECT * FROM monk_courses WHERE monk_id = ANY($1::int[]) ORDER BY kind, year_text, id", [ids])
      ]);
      for (const x of rainQ.rows) {
        if (!rainsBy[x.monk_id]) rainsBy[x.monk_id] = [];
        rainsBy[x.monk_id].push(x);
      }
      for (const x of affQ.rows) {
        if (!affBy[x.monk_id]) affBy[x.monk_id] = [];
        affBy[x.monk_id].push(x);
      }
      for (const x of courseQ.rows) {
        if (!courseBy[x.monk_id]) courseBy[x.monk_id] = [];
        courseBy[x.monk_id].push(courseOut(x));
      }
    }
    const asOf = yearBe || currentBe();
    let rows = r.rows.map((row) => {
      const rains = rainsBy[row.id] || [];
      const courses = courseBy[row.id] || [];
      const affiliations = affBy[row.id] || [];
      const rr = reportRow(
        row,
        stayAtWat(row.aff_wat_name || row.wat_name, rains, affiliations, asOf),
        rains,
        asOf,
        courses,
        affiliations
      );
      rr.courses = courses;
      return rr;
    });
    const rankCounts = {};
    const statusCounts = {};
    STATUSES.forEach((s) => { statusCounts[s] = 0; });
    rows.forEach((x) => {
      const st = STATUSES.includes(x.status) ? x.status : "จำพรรษา";
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      (x.ranks || []).forEach((t) => { rankCounts[t] = (rankCounts[t] || 0) + 1; });
      if (x.isParian) rankCounts["พระเปรียญธรรม"] = (rankCounts["พระเปรียญธรรม"] || 0) + 1;
    });
    const rankWanted = str(req.query.rank, 40);
    if (rankWanted) {
      rows = rows.filter((x) => matchRankFilter(x, rankWanted));
    }
    const monks = rows.filter((x) => x.personType !== "สามเณร").length;
    const novices = rows.length - monks;
    const tambons = [...new Set(rows.map((x) => x.tambon).filter(Boolean))].sort();
    const sanghaTambons = [...new Set(rows.map((x) => x.sanghaTambon).filter(Boolean))].sort();
    const wats = [...new Set(rows.map((x) => x.watName).filter(Boolean))].sort();
    const sample = rows[0] || {};
    const rainsHeader = headerLines({
      yearBe: yearBe || null,
      level: detectLevel({
        watName: watName,
        sanghaTambon: unmatched ? "" : sanghaTambon,
        accessLevel: req.user && req.user.accessLevel
      }),
      watName: watName || (req.user && req.user.watName) || sample.watName || "",
      sanghaTambon: unmatched ? "" : (sanghaTambon || (req.user && req.user.sanghaTambon) || ""),
      tambon: tambon || sample.tambon || "",
      district: district || (req.user && req.user.district) || sample.district || "",
      province: province || (req.user && req.user.province) || sample.province || ""
    });
    const yearLock = yearBe
      ? await yearLockStatus(pool, req.user, yearBe, watName, unmatched ? "" : sanghaTambon)
      : null;
    res.json({
      yearBe: yearBe || null, total: rows.length, monks, novices, tambons, sanghaTambons, wats,
      rankCounts, statusCounts, rainsHeader, yearLock, rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "อ่านรายงานไม่สำเร็จ" });
  }
});

app.get("/api/places", async (req, res) => {
  try {
    const yearBe = intOrNull(req.query.yearBe, 2400, 2700);
    const place = reportPlaceOf(req.user, req.query);
    const lv = req.user && req.user.accessLevel;
    if (lv === "admin" && !place.province && !place.district) {
      return res.json({ sanghaTambons: [], wats: [] });
    }
    const monkParams = [];
    let extra = "";
    if (yearBe) {
      monkParams.push(yearBe);
    }
    if (place.district) {
      monkParams.push(place.district);
      extra += " AND COALESCE(NULLIF(pw.district,''), " + (yearBe ? "NULLIF(y.district,''), " : "") + "m.district) = $" + monkParams.length;
    }
    if (place.province) {
      monkParams.push(place.province);
      extra += " AND COALESCE(NULLIF(pw.province,''), " + (yearBe ? "NULLIF(y.province,''), " : "") + "m.province) = $" + monkParams.length;
    }
    const r = yearBe
      ? await pool.query(
        `SELECT COALESCE(NULLIF(pw.sangha_tambon,''), NULLIF(y.sangha_tambon,''), m.sangha_tambon) AS sangha_tambon,
                COALESCE(NULLIF(y.wat_name,''), m.wat_name) AS wat_name
           FROM monks m
           JOIN monk_rains y ON y.monk_id = m.id AND y.year_be = $1
           LEFT JOIN ${WAT_PLACE_SQL} pw ON lower(pw.name) = lower(COALESCE(NULLIF(y.wat_name,''), m.wat_name))
          AND (COALESCE(NULLIF(y.district,''), m.district) = '' OR lower(pw.district) = lower(COALESCE(NULLIF(y.district,''), m.district)))
          WHERE COALESCE(NULLIF(y.wat_name,''), m.wat_name) <> ''` + extra +
          appendViewScope(req.user, monkParams, "m"),
        monkParams
      )
      : await pool.query(
        `SELECT COALESCE(NULLIF(pw.sangha_tambon,''), m.sangha_tambon) AS sangha_tambon, m.wat_name
           FROM monks m
           LEFT JOIN ${WAT_PLACE_SQL} pw ON lower(pw.name) = lower(m.wat_name)
          AND (m.district = '' OR lower(pw.district) = lower(m.district))
          WHERE m.wat_name <> ''` + extra +
          appendViewScope(req.user, monkParams, "m"),
        monkParams
      );
    const bySangha = {};
    for (const row of r.rows) {
      const s = row.sangha_tambon || "(ยังไม่ระบุตำบลคณะสงฆ์)";
      if (!bySangha[s]) bySangha[s] = new Set();
      if (row.wat_name) bySangha[s].add(row.wat_name);
    }
    const sanghaTambons = Object.keys(bySangha).sort().map((name) => ({
      name,
      wats: [...bySangha[name]].sort()
    }));
    const locParams = [];
    let locWhere = "WHERE name <> ''";
    if (place.province) {
      locParams.push(place.province);
      locWhere += " AND province = $" + locParams.length;
    }
    if (place.district) {
      locParams.push(place.district);
      locWhere += " AND district = $" + locParams.length;
    }
    if (lv === "tambon" && req.user.sanghaTambon) {
      locParams.push(req.user.sanghaTambon);
      locWhere += " AND sangha_tambon = $" + locParams.length;
    }
    if (lv === "wat" && req.user.watName) {
      locParams.push(req.user.watName);
      locWhere += " AND lower(name) = lower($" + locParams.length + ")";
    }
    const loc = await pool.query(
      "SELECT name, tambon, sangha_tambon, district, province FROM phra_wats " + locWhere,
      locParams
    );
    const wats = catalogWatsFromRows(loc.rows.concat(r.rows.map((row) => ({
      name: row.wat_name,
      sangha_tambon: row.sangha_tambon,
      tambon: "",
      district: place.district || "",
      province: place.province || ""
    }))));
    res.json(scopePlaces(req.user, { sanghaTambons, wats }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "อ่านตำบลคณะสงฆ์ไม่สำเร็จ" });
  }
});

app.post("/api/monks/from-excel", async (req, res) => {
  try {
    const raw = req.body && (req.body.fileBase64 || req.body.base64);
    if (!raw) return res.status(400).json({ error: "เลือกไฟล์ Excel ก่อน" });
    let b64 = String(raw);
    const mark = b64.indexOf("base64,");
    if (mark >= 0) b64 = b64.slice(mark + 7);
    const buf = Buffer.from(b64.replace(/\s/g, ""), "base64");
    if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
      return res.status(400).json({ error: "ไฟล์นี้ไม่ใช่ Excel .xlsx" });
    }
    const parsed = parseFormExcel(buf);
    const cid = String(parsed.monk.citizenId || "").trim();
    if (cid) {
      const hit = await pool.query(
        "SELECT id FROM monks WHERE citizen_id=$1 OR lower(citizen_id)=lower($1) LIMIT 1",
        [cid]
      );
      if (hit.rowCount) {
        parsed.existingId = hit.rows[0].id;
        const kind = parsed.monk.idKind === "passport" ? "เลขพาสปอร์ต" : "เลขบัตร";
        parsed.warnings.push(kind + "นี้มีในฐานแล้ว รหัส " + hit.rows[0].id + " — ตรวจก่อนบันทึก จะชนกันถ้าเพิ่มรูปใหม่");
      }
    }
    res.json(parsed);
  } catch (e) {
    sendErr(res, e, "อ่านไฟล์ Excel ไม่สำเร็จ");
  }
});

app.get("/api/monks", async (req, res) => {
  try {
    const q = searchQ(req.query.q);
    const yearBe = intOrNull(req.query.yearBe, 2400, 2700);
    const yearSql = `SELECT m.* FROM monks m
         JOIN monk_rains y ON y.monk_id = m.id AND y.year_be = $2
         WHERE ($1 = '' OR lower(m.chaya||' '||m.chaya_pali||' '||m.sangha_name||' '||COALESCE(m.bio->>'royalName','')||' '||COALESCE(m.bio::text,'')||' '||m.former_name||' '||m.former_surname||' '||m.wat_name||' '||m.title||' '||m.citizen_id) LIKE '%'||$1||'%')
         ORDER BY m.chaya, m.id`;
    const allSql = `SELECT m.* FROM monks m
         WHERE ($1 = '' OR lower(m.chaya||' '||m.chaya_pali||' '||m.sangha_name||' '||COALESCE(m.bio->>'royalName','')||' '||COALESCE(m.bio::text,'')||' '||m.former_name||' '||m.former_surname||' '||m.wat_name||' '||m.title||' '||m.citizen_id) LIKE '%'||$1||'%')
         ORDER BY m.chaya, m.id`;
    const yearParams = [q, yearBe];
    const allParams = [q];
    if (adminNeedsPlacePick(req.user, Object.assign({ q: searchQ(req.query.q) }, reportPlaceOf(req.user, req.query)))) {
      return res.json({ monks: [], needPlace: true });
    }
    const r = yearBe
      ? await pool.query(insertBeforeOrderBy(yearSql, appendViewScope(req.user, yearParams, "m")), yearParams)
      : await pool.query(insertBeforeOrderBy(allSql, appendViewScope(req.user, allParams, "m")), allParams);
    res.json({ monks: r.rows.map((row) => rowOut(row, [], [])) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "อ่านรายชื่อไม่สำเร็จ" });
  }
});

app.get("/api/monks/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ไม่พบรายการ" });
    const params = [id];
    const r = await pool.query(
      "SELECT * FROM monks m WHERE m.id=$1" + appendViewScope(req.user, params, "m"),
      params
    );
    if (!r.rowCount) {
      const exists = await pool.query("SELECT id FROM monks WHERE id=$1", [id]);
      if (!exists.rowCount) return res.status(404).json({ error: "ไม่พบรายการ" });
      return res.status(403).json({ error: "รายการนี้อยู่นอกเขตที่ได้รับสิทธิ์" });
    }
    const rel = await loadRelated(id);
    res.json({ monk: rowOut(r.rows[0], rel.affiliations, rel.rains, undefined, rel.courses) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "อ่านรายการไม่สำเร็จ" });
  }
});

app.post("/api/monks", async (req, res) => {
  const client = await pool.connect();
  let idKind = "thai";
  try {
    const b = applyWatUserHome(req.user, readBody(req.body || {}));
    idKind = b.id_kind || "thai";
    if (!b.chaya_pali) return res.status(400).json({ error: "กรุณาใส่ฉายา" });
    if (b.citizen_id === null) return res.status(400).json({ error: idBadError(idKind) });
    await assertNewMonkInScope(pool, req.user, b);
    await client.query("BEGIN");
    await applyWatIds(client, b);
    const r = await client.query(
      `INSERT INTO monks (person_type, chaya, former_name, former_surname, title, nikaya, sutthi_no,
         wat_name, wat_id, stay_wat_id, tambon, sangha_tambon, district, province, sangha_name, chaya_pali,
         birth_year_be, birth_province, ordained_on, status, note, bio, rank_kind,
         is_dhammaduta, is_preacher, is_vipassana, citizen_id, id_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [
        b.person_type, b.chaya, b.former_name, b.former_surname, b.title, b.nikaya, b.sutthi_no,
        b.wat_name, b.wat_id, b.stay_wat_id, b.tambon, b.sangha_tambon, b.district, b.province, b.sangha_name, b.chaya_pali,
        b.birth_year_be, b.birth_province, b.ordained_on, b.status, b.note, b.bio || {},
        b.rank_kind || "", b.is_dhammaduta, b.is_preacher, b.is_vipassana, b.citizen_id || "", b.id_kind || "thai"
      ]
    );
    await saveRelated(client, r.rows[0].id, b, req.user);
    await upsertWatFromPlace(client, b);
    await client.query("COMMIT");
    const rel = await loadRelated(r.rows[0].id);
    res.json({ monk: rowOut(r.rows[0], rel.affiliations, rel.rains, undefined, rel.courses) });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    console.error(e);
    if (e && e.code === "23505") return res.status(409).json({ error: idDupError(idKind) });
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: "บันทึกไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.put("/api/monks/:id", async (req, res) => {
  const client = await pool.connect();
  let idKind = "thai";
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ไม่พบรายการ" });
    const b = applyWatUserHome(req.user, readBody(req.body || {}));
    idKind = b.id_kind || "thai";
    if (!b.chaya_pali) return res.status(400).json({ error: "กรุณาใส่ฉายา" });
    if (b.citizen_id === null) return res.status(400).json({ error: idBadError(idKind) });
    const homeParams = [id];
    const home = await pool.query(
      "SELECT id FROM monks m WHERE m.id=$1" + appendHomeScope(req.user, homeParams, "m"),
      homeParams
    );
    if (!home.rowCount) {
      const exists = await pool.query("SELECT id FROM monks WHERE id=$1", [id]);
      if (!exists.rowCount) return res.status(404).json({ error: "ไม่พบรายการ" });
      return res.status(403).json({ error: "แก้ไขได้เฉพาะพระสังกัดในเขตของท่าน" });
    }
    await assertNewMonkInScope(pool, req.user, b);
    await client.query("BEGIN");
    await applyWatIds(client, b);
    const r = await client.query(
      `UPDATE monks SET person_type=$2, chaya=$3, former_name=$4, former_surname=$5, title=$6,
         nikaya=$7, sutthi_no=$8, wat_name=$9, wat_id=$10, stay_wat_id=$11, tambon=$12, sangha_tambon=$13, district=$14, province=$15,
         sangha_name=$16, chaya_pali=$17, birth_year_be=$18, birth_province=$19,
         ordained_on=$20, status=$21, note=$22, bio=$23, rank_kind=$24,
         is_dhammaduta=$25, is_preacher=$26, is_vipassana=$27, citizen_id=$28, id_kind=$29, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        id, b.person_type, b.chaya, b.former_name, b.former_surname, b.title, b.nikaya, b.sutthi_no,
        b.wat_name, b.wat_id, b.stay_wat_id, b.tambon, b.sangha_tambon, b.district, b.province,
        b.sangha_name, b.chaya_pali, b.birth_year_be, b.birth_province,
        b.ordained_on, b.status, b.note, b.bio || {}, b.rank_kind || "",
        b.is_dhammaduta, b.is_preacher, b.is_vipassana, b.citizen_id || "", b.id_kind || "thai"
      ]
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบรายการ" });
    }
    await saveRelated(client, id, b, req.user);
    await upsertWatFromPlace(client, b);
    await client.query("COMMIT");
    const rel = await loadRelated(id);
    res.json({ monk: rowOut(r.rows[0], rel.affiliations, rel.rains, undefined, rel.courses) });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    console.error(e);
    if (e && e.code === "23505") return res.status(409).json({ error: idDupError(idKind) });
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: "บันทึกไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.delete("/api/monks/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ไม่พบรายการ" });
    const homeParams = [id];
    const home = await pool.query(
      "SELECT id FROM monks m WHERE m.id=$1" + appendHomeScope(req.user, homeParams, "m"),
      homeParams
    );
    if (!home.rowCount) {
      const exists = await pool.query("SELECT id FROM monks WHERE id=$1", [id]);
      if (!exists.rowCount) return res.status(404).json({ error: "ไม่พบรายการ" });
      return res.status(403).json({ error: "ลบได้เฉพาะพระสังกัดในเขตของท่าน" });
    }
    const r = await pool.query("DELETE FROM monks WHERE id=$1 RETURNING id", [id]);
    if (!r.rowCount) return res.status(404).json({ error: "ไม่พบรายการ" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "ลบไม่สำเร็จ" });
  }
});

app.get("/api/temples/provinces", async (req, res) => {
  try {
    const provinces = await listProvinces(pool);
    const total = await templeCount(pool);
    res.json({ total, provinces });
  } catch (e) {
    sendErr(res, e, "อ่านจังหวัดไม่สำเร็จ");
  }
});

app.get("/api/temples/districts", async (req, res) => {
  try {
    const districts = await listDistricts(pool, req.query.province);
    res.json({ districts });
  } catch (e) {
    sendErr(res, e, "อ่านอำเภอไม่สำเร็จ");
  }
});

app.get("/api/temples/in-place", async (req, res) => {
  try {
    const wats = await listTemplesInPlace(pool, req.query.province, req.query.district);
    res.json({ wats });
  } catch (e) {
    sendErr(res, e, "อ่านวัดในอำเภอไม่สำเร็จ");
  }
});

app.get("/api/temples/search", async (req, res) => {
  try {
    const wats = await searchTemples(pool, req.query || {});
    res.json({ wats });
  } catch (e) {
    sendErr(res, e, "ค้นวัดไม่สำเร็จ");
  }
});

app.post("/api/wats/resolve", async (req, res) => {
  try {
    const wat = await resolveWat(pool, req.body || {});
    res.json({ wat });
  } catch (e) {
    sendErr(res, e, "หาวัดไม่สำเร็จ");
  }
});

app.post("/api/wats/ensure-district", async (req, res) => {
  try {
    assertPlaceWrite(req.user, "addWat", req.body || {});
    const result = await ensureDistrictFromDirectory(pool, req.body || {});
    res.json(result);
  } catch (e) {
    sendErr(res, e, "โหลดวัดในอำเภอไม่สำเร็จ");
  }
});

app.get("/api/wats", async (req, res) => {
  try {
    const wats = filterWatsForPlaces(req.user, await listWats(pool));
    const tambons = filterSanghaTambons(req.user, await listSanghaTambons(pool, req.query.district, req.query.province));
    const districts = [...new Set(wats.map((w) => w.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
    res.json({
      wats,
      tambons,
      districts,
      unmatched: wats.filter((w) => !w.sanghaTambon).length,
      drifted: wats.filter((w) => w.drifted).length
    });
  } catch (e) {
    sendErr(res, e, "อ่านรายชื่อวัดไม่สำเร็จ");
  }
});

app.post("/api/wats", async (req, res) => {
  try {
    assertPlaceWrite(req.user, "addWat", req.body || {});
    const wat = await addWat(pool, req.body || {});
    res.json({ wat });
  } catch (e) {
    sendErr(res, e, "เพิ่มวัดไม่สำเร็จ");
  }
});

app.get("/api/sangha-tambons", async (req, res) => {
  try {
    const tambons = filterSanghaTambons(req.user, await listSanghaTambons(pool, req.query.district, req.query.province));
    res.json({ tambons });
  } catch (e) {
    sendErr(res, e, "อ่านตำบลคณะสงฆ์ไม่สำเร็จ");
  }
});

app.post("/api/sangha-tambons", async (req, res) => {
  try {
    assertPlaceWrite(req.user, "addTambon", req.body || {});
    const tambon = await addSanghaTambon(pool, req.body || {});
    res.json({ tambon });
  } catch (e) {
    sendErr(res, e, "เพิ่มตำบลคณะสงฆ์ไม่สำเร็จ");
  }
});

app.put("/api/sangha-tambons/assign", async (req, res) => {
  try {
    assertPlaceWrite(req.user, "assign", req.body || {});
    const result = await assignSanghaWats(pool, req.body || {});
    res.json(result);
  } catch (e) {
    sendErr(res, e, "บันทึกวัดในตำบลคณะสงฆ์ไม่สำเร็จ");
  }
});

app.patch("/api/sangha-tambons/:id", async (req, res) => {
  try {
    assertPlaceWrite(req.user, "rename", req.body || {});
    const tambon = await renameSanghaTambon(pool, Number(req.params.id), (req.body || {}).name);
    res.json({ tambon });
  } catch (e) {
    sendErr(res, e, "แก้ชื่อตำบลคณะสงฆ์ไม่สำเร็จ");
  }
});

app.delete("/api/sangha-tambons/:id", async (req, res) => {
  try {
    assertPlaceWrite(req.user, "delete", {});
    await deleteSanghaTambon(pool, Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    sendErr(res, e, "ลบตำบลคณะสงฆ์ไม่สำเร็จ");
  }
});

app.get("/form-blank.html", async (req, res) => {
  const user = await loadSession(pool, req);
  if (!user) return res.redirect("/");
  const file = path.join(__dirname, "..", "form-blank.html");
  res.set("Cache-Control", "no-store");
  if (String(req.query.download || "") === "1") {
    res.set("Content-Disposition", 'attachment; filename="form-monk-blank.html"');
  }
  res.sendFile(file);
});

app.get("/form-blank.xlsx", async (req, res) => {
  const user = await loadSession(pool, req);
  if (!user) return res.redirect("/");
  try {
    const buf = buildFormBlankXlsx();
    const ascii = "form-monk-blank.xlsx";
    const thai = encodeURIComponent("แบบกรอกประวัติพระภิกษุ.xlsx");
    res.set("Cache-Control", "no-store");
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition", 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + thai);
    res.send(buf);
  } catch (e) {
    sendErr(res, e, "สร้างไฟล์ Excel ไม่สำเร็จ");
  }
});

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

async function start() {
  await ensureSchema();
  const seeded = await seedAdmin(pool);
  await migratePlatformAdminEmail(pool);
  const reset = await applyAdminPassword(pool);
  const adminHome = await bindPlatformAdminHome(pool);
  const mailCopied = await importAccountingMail(pool).catch(() => false);
  app.listen(PORT, BIND, () => {
    console.log("Monk database  http://" + (BIND === "127.0.0.1" ? "localhost" : BIND) + ":" + PORT);
    console.log("Separate from accounting 4000 and audit 4100");
    if (seeded && seeded.generated) {
      console.log("first login  user=" + seeded.username + "  password=" + seeded.password);
      console.log("change this password after login");
    } else if (seeded) {
      console.log("created first admin user=" + seeded.username);
    }
    if (reset) console.log("admin password taken from PHRA_ADMIN_PASSWORD");
    if (adminHome) console.log("platform admin home = Wat Intharam");
    if (mailCopied) console.log("forgot-password mail copied from accounting SMTP");
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
