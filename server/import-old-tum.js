require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { thaiDigits } = require("./lib/courses");
const { toParts } = require("./lib/vassa");
const { withWatPrefix, normTemple } = require("./lib/wats");

const APPLY = process.argv.includes("--apply");
const ROOT = process.argv.find((a) => a.startsWith("--dir="))?.slice(6)
  || path.join(process.env.TEMP || "C:\\Temp", "phra-src", "old-wat-tum");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL || /wat_accounting|wat_audit/i.test(DATABASE_URL)) {
  console.error("ต้องใช้ฐาน wat_phra");
  process.exit(1);
}

function listTempleSheets() {
  const wb = fs.readFileSync(path.join(ROOT, "xl", "workbook.xml"), "utf8");
  const rels = fs.readFileSync(path.join(ROOT, "xl", "_rels", "workbook.xml.rels"), "utf8");
  const ridToFile = {};
  const relRe = /Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
  let rm;
  while ((rm = relRe.exec(rels))) {
    const target = rm[2].replace(/^worksheets\//, "").replace(/^\.\.\/worksheets\//, "");
    if (/sheet\d+\.xml$/i.test(target)) ridToFile[rm[1]] = path.basename(target);
  }
  const out = [];
  const shRe = /<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g;
  let sm;
  while ((sm = shRe.exec(wb))) {
    const name = sm[1];
    if (/^Sheet\d+$/i.test(name)) continue;
    const file = ridToFile[sm[2]];
    if (!file) continue;
    const full = path.join(ROOT, "xl", "worksheets", file);
    if (!fs.existsSync(full) || fs.statSync(full).size < 2000) continue;
    out.push([file, name]);
  }
  return out;
}

function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function dash(v) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–" || s === "x" || s === "X") return "";
  if (/^\d{1,3}$/.test(s) && Number(s) < 400) return "";
  return s;
}
function citizenId(v) {
  const d = thaiDigits(String(v || "")).replace(/[^\d]/g, "");
  return d.length === 13 ? d : "";
}
function loadShared() {
  const xml = fs.readFileSync(path.join(ROOT, "xl", "sharedStrings.xml"), "utf8");
  const out = [];
  const re = /<si[\s\S]*?<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const texts = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(m[0]))) texts.push(decode(tm[1]));
    out.push(texts.join(""));
  }
  return out;
}
function colRow(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { c: col - 1, r: +m[2] - 1 };
}
function parseGrid(file, shared) {
  const xml = fs.readFileSync(file, "utf8");
  const rows = [];
  const cRe = /<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = cRe.exec(xml))) {
    const pos = colRow(m[1]);
    if (!pos || pos.c > 80 || pos.r > 720) continue;
    const attrs = m[2];
    const body = m[3];
    const vm = body.match(/<v>([\s\S]*?)<\/v>/);
    let val = "";
    if (/t="s"/.test(attrs) && vm) val = shared[+vm[1]] || "";
    else if (vm) val = decode(vm[1]);
    val = String(val).replace(/\s+/g, " ").trim();
    if (!val) continue;
    if (!rows[pos.r]) rows[pos.r] = [];
    rows[pos.r][pos.c] = val;
  }
  return rows;
}
function cell(rows, r, c) {
  return dash((rows[r - 1] || [])[c] || "");
}
function cellKeepNum(rows, r, c) {
  const s = String((rows[r - 1] || [])[c] || "").replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–" || s === "x" || s === "X") return "";
  return s;
}
function marked(rows, r, c) {
  const v = String((rows[r - 1] || [])[c] || "").trim().toLowerCase();
  return v === "x" || v === "X" || v === "✓";
}
function isoDate(text) {
  const p = toParts(text);
  if (!p || !p.month) return null;
  if (p.ce < 1900 || p.ce > 2035) return null;
  return String(p.ce).padStart(4, "0") + "-" + String(p.month).padStart(2, "0") + "-" + String(p.day).padStart(2, "0");
}
function yearBe(text) {
  const d = thaiDigits(text || "");
  const m = d.match(/(24\d{2}|25\d{2}|26\d{2})/);
  return m ? Number(m[1]) : null;
}
function provinceOf(addr) {
  const m = String(addr || "").match(/จังหวัด\s*([ก-๙A-Za-z]+)/);
  return m ? m[1].replace(/จังหวั.*/, "").slice(0, 80) : "";
}
function parseEdu(raw) {
  const s = String(raw || "");
  const out = {};
  if (/น\.?ธ\.?\s*เอก|นธ\.?\s*เอก/.test(s)) out.dhammaLevel = "เอก";
  else if (/น\.?ธ\.?\s*โท|นธ\.?\s*โท/.test(s)) out.dhammaLevel = "โท";
  else if (/น\.?ธ\.?\s*ตรี|นธ\.?\s*ตรี/.test(s)) out.dhammaLevel = "ตรี";
  const pali = s.match(/ป\.?\s*ธ\.?\s*([๐-๙0-9](?:-[๐-๙0-9])?)/);
  if (pali) out.paliLevel = "ป.ธ." + thaiDigits(pali[1]);
  if (/ป\.?บส|ปบ\.?ส/.test(s)) out.secularLevel = out.secularLevel || "ป.บส.";
  if (/วท\.บ|ศศ\.บ|น\.บ|รป\.ม|พธ/.test(s)) out.secularLevel = s.replace(/น\.?ธ[^,]*/g, "").replace(/ป\.?ธ[^,]*/g, "").replace(/^[, ]+|[, ]+$/g, "").slice(0, 40);
  if (/ม\.?\s*๖|ม\.?\s*6/.test(s)) out.secularLevel = out.secularLevel || "ม.6";
  if (/ป\.?\s*๖|ป\.?\s*6/.test(s) && !out.paliLevel) out.secularLevel = out.secularLevel || "ป.6";
  return out;
}
function splitAddr(addr) {
  const s = String(addr || "");
  const tambon = (s.match(/ตำบล\s*([ก-๙]+)/) || s.match(/ต\.\s*([ก-๙]+)/) || [])[1] || "";
  const district = (s.match(/อำเภอ\s*([ก-๙]+)/) || s.match(/อ\.\s*([ก-๙]+)/) || [])[1] || "";
  return {
    formerHouse: dash(s).slice(0, 120),
    formerTambon: tambon.slice(0, 80),
    formerDistrict: district.slice(0, 80),
    formerProvince: provinceOf(s)
  };
}
function isJunkEdu(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t || t === "-" || t === "–" || /^[xX✓]$/.test(t)) return true;
  if (/^\d+(\.\d+)?$/.test(t) && Number(t) < 2400) return true;
  const d = thaiDigits(t);
  if (/^\d{4}$/.test(d) && !/^(24|25|26)\d{2}$/.test(d)) return true;
  return false;
}
function eduStr(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (isJunkEdu(s)) return "";
  return s.slice(0, max || 160);
}
function eduYear(v) {
  const d = thaiDigits(String(v == null ? "" : v));
  const m = d.match(/(24\d{2}|25\d{2}|26\d{2})/);
  return m ? m[1] : "";
}
function looksLikeGrade(s) {
  return /^(ปีที่|ม\.?\s*[0-9๑-๙]|พธ\.|ศศ\.|วท\.|น\.บ|รป\.|ป\.บส|อนุปริญญา|ปริญญา)/.test(String(s || "").trim());
}
function readWorldEdu(rows, c) {
  const blocks = [
    [108, "pri", "ประถม"], [111, "m1", "ม.ต้น"], [114, "m3", "ม.ปลาย"],
    [117, "dip", "อนุปริญญา"], [120, "ba", "ปริญญาตรี"], [123, "ma", "ปริญญาโท"],
    [126, "phd", "ปริญญาเอก"], [129, "hon", "กิตติมศักดิ์"]
  ];
  const out = { secularLevel: "", secularSchool: "" };
  for (const [r, p] of blocks) {
    out[p + "Grade"] = eduStr(cellKeepNum(rows, r, c), 40);
    out[p + "School"] = eduStr(cell(rows, r + 1, c), 160);
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const p = blocks[i][1];
    const label = blocks[i][2];
    if (out[p + "Grade"] || out[p + "School"]) {
      out.secularLevel = out[p + "Grade"] || label;
      out.secularSchool = out[p + "School"] || "";
      break;
    }
  }
  return out;
}
function readDhammaPaliEdu(rows, c) {
  const out = {};
  const dhamma = [
    [155, "dhammaTri", "ตรี"],
    [160, "dhammaTo", "โท"],
    [165, "dhammaEk", "เอก"]
  ];
  for (const [r, p] of dhamma) {
    out[p + "Year"] = eduYear(cellKeepNum(rows, r, c));
    out[p + "School"] = eduStr(cell(rows, r + 1, c), 160) || eduStr(cell(rows, r + 3, c), 160);
  }
  const pali = [
    [170, "pali12", "ป.ธ.1-2"], [175, "pali3", "ป.ธ.3"], [180, "pali4", "ป.ธ.4"],
    [185, "pali5", "ป.ธ.5"], [190, "pali6", "ป.ธ.6"], [195, "pali7", "ป.ธ.7"],
    [200, "pali8", "ป.ธ.8"], [205, "pali9", "ป.ธ.9"]
  ];
  for (const [r, p] of pali) {
    out[p + "Year"] = eduYear(cellKeepNum(rows, r, c));
    out[p + "School"] = eduStr(cell(rows, r + 1, c), 160) || eduStr(cell(rows, r + 3, c), 160);
  }
  if (out.dhammaEkYear || out.dhammaEkSchool) {
    out.dhammaLevel = "เอก";
    out.dhammaYear = out.dhammaEkYear;
    out.dhammaSchool = out.dhammaEkSchool;
  } else if (out.dhammaToYear || out.dhammaToSchool) {
    out.dhammaLevel = "โท";
    out.dhammaYear = out.dhammaToYear;
    out.dhammaSchool = out.dhammaToSchool;
  } else if (out.dhammaTriYear || out.dhammaTriSchool) {
    out.dhammaLevel = "ตรี";
    out.dhammaYear = out.dhammaTriYear;
    out.dhammaSchool = out.dhammaTriSchool;
  }
  for (let i = pali.length - 1; i >= 0; i--) {
    const p = pali[i][1];
    const label = pali[i][2];
    if (out[p + "Year"] || out[p + "School"] || marked(rows, pali[i][0], c)) {
      out.paliLevel = label;
      out.paliYear = out[p + "Year"];
      out.paliSchool = out[p + "School"];
      break;
    }
  }
  return out;
}

function readMonks(shared) {
  const out = [];
  const sheets = listTempleSheets();
  for (const [file, sheetWat] of sheets) {
    const rows = parseGrid(path.join(ROOT, "xl", "worksheets", file), shared);
    for (let c = 2; c <= 60; c++) {
      const id = citizenId(cell(rows, 4, c) || (rows[3] || [])[c]);
      const name = cell(rows, 7, c);
      const pali = cell(rows, 8, c);
      if (!id && (!name || name.indexOf("พระ") !== 0)) continue;
      if (!id && !pali) continue;
      const edu = parseEdu(cell(rows, 12, c));
      const world = readWorldEdu(rows, c);
      const dp = readDhammaPaliEdu(rows, c);
      if (dp.dhammaLevel) edu.dhammaLevel = edu.dhammaLevel || dp.dhammaLevel;
      if (dp.paliLevel) edu.paliLevel = edu.paliLevel || dp.paliLevel;
      if (world.secularLevel) edu.secularLevel = edu.secularLevel || world.secularLevel;
      if (marked(rows, 165, c)) edu.dhammaLevel = edu.dhammaLevel || "เอก";
      else if (marked(rows, 160, c)) edu.dhammaLevel = edu.dhammaLevel || "โท";
      else if (marked(rows, 155, c)) edu.dhammaLevel = edu.dhammaLevel || "ตรี";
      for (let lv = 9; lv >= 3; lv--) {
        if (marked(rows, 170 + (lv === 1 ? 0 : (lv - 3) * 5), c) || marked(rows, [170, 175, 180, 185, 190, 195, 200, 205][lv - 2] || 0, c)) {
          edu.paliLevel = edu.paliLevel || ("ป.ธ." + lv);
          break;
        }
      }
      const birth = cell(rows, 20, c);
      const ordainedText = cell(rows, 41, c);
      const home = splitAddr(cell(rows, 30, c));
      let watPosition = "";
      if (marked(rows, 220, c)) watPosition = "เจ้าอาวาส";
      else if (marked(rows, 216, c)) watPosition = "รองเจ้าอาวาส";
      else if (marked(rows, 212, c)) watPosition = "ผู้ช่วยเจ้าอาวาส";
      let sanghaPosition = "";
      if (marked(rows, 227, c)) sanghaPosition = "เจ้าคณะตำบล";
      else if (marked(rows, 224, c)) sanghaPosition = "รองเจ้าคณะตำบล";
      else if (marked(rows, 233, c)) sanghaPosition = "เจ้าคณะอำเภอ";
      else if (marked(rows, 230, c)) sanghaPosition = "รองเจ้าคณะอำเภอ";
      let rankKind = "";
      if (marked(rows, 339, c) || marked(rows, 342, c) || marked(rows, 333, c) || marked(rows, 336, c)) rankKind = "พระราชาคณะ";
      else if (marked(rows, 345, c) || marked(rows, 351, c) || marked(rows, 372, c) || marked(rows, 447, c) || marked(rows, 450, c) || marked(rows, 456, c)) rankKind = "พระครูสัญญาบัตร";
      else if (/พระครู(ปลัด|สมุห์|ใบฎีกา|วินัยธร|ธรรมธร)/.test(name)) rankKind = "พระครูฐานานุกรม";
      else if (/พระครู/.test(name)) rankKind = "พระครูสัญญาบัตร";
      out.push({
        sheetWat,
        citizen_id: id,
        sutthi_no: cell(rows, 5, c).replace(/^ที่\s*/, "").slice(0, 80),
        name: name.slice(0, 160),
        chaya_pali: pali.slice(0, 80),
        former_surname: (cell(rows, 9, c) || cell(rows, 19, c)).slice(0, 120),
        former_name: cell(rows, 18, c).replace(/^นาย/, "").slice(0, 120),
        nikaya: cell(rows, 15, c).slice(0, 80),
        oldWat: withWatPrefix(cell(rows, 13, c) || sheetWat.replace(/^วัด/, "")),
        birthText: birth.slice(0, 80),
        birth_year_be: yearBe(birth),
        birth_province: home.formerProvince,
        fatherName: cell(rows, 27, c).slice(0, 160),
        motherName: cell(rows, 28, c).slice(0, 160),
        formerJob: cell(rows, 21, c).slice(0, 80),
        ethnicity: cell(rows, 22, c).slice(0, 40),
        nationality: cell(rows, 23, c).slice(0, 40),
        stature: cell(rows, 24, c).slice(0, 40),
        skinTone: cell(rows, 25, c).slice(0, 40),
        marks: cell(rows, 26, c).slice(0, 160),
        ...home,
        noviceOn: cell(rows, 33, c).slice(0, 80),
        noviceWat: withWatPrefix(cell(rows, 34, c)).slice(0, 160),
        ordainedOnText: ordainedText.slice(0, 80),
        ordained_on: isoDate(ordainedText),
        ordainedAge: cellKeepNum(rows, 40, c).slice(0, 40),
        ordainedTime: cellKeepNum(rows, 42, c).slice(0, 40),
        ordainedWat: withWatPrefix(cell(rows, 43, c)).slice(0, 160),
        preceptor: cell(rows, 45, c).slice(0, 160),
        preceptorWat: withWatPrefix(cell(rows, 46, c)).slice(0, 160),
        kammavaca: cell(rows, 48, c).slice(0, 160),
        kammavacaWat: withWatPrefix(cell(rows, 49, c)).slice(0, 160),
        anusavana: cell(rows, 51, c).slice(0, 160),
        anusavanaWat: withWatPrefix(cell(rows, 52, c)).slice(0, 160),
        firstAffWat: withWatPrefix(cell(rows, 55, c)).slice(0, 160),
        firstAffOn: cell(rows, 57, c).slice(0, 80),
        firstAbbot: cell(rows, 58, c).slice(0, 160),
        moveFromWat: withWatPrefix(cell(rows, 60, c)).slice(0, 160),
        moveOn: cell(rows, 62, c).slice(0, 80),
        moveReason: cell(rows, 63, c).slice(0, 200),
        dhammaLevel: (edu.dhammaLevel || "").slice(0, 40),
        dhammaYear: (dp.dhammaYear || "").slice(0, 40),
        dhammaSchool: (dp.dhammaSchool || "").slice(0, 160),
        paliLevel: (edu.paliLevel || "").slice(0, 40),
        paliYear: (dp.paliYear || "").slice(0, 40),
        paliSchool: (dp.paliSchool || "").slice(0, 160),
        secularLevel: (edu.secularLevel || "").slice(0, 40),
        secularSchool: (world.secularSchool || "").slice(0, 160),
        priGrade: world.priGrade, priSchool: world.priSchool,
        m1Grade: world.m1Grade, m1School: world.m1School,
        m3Grade: world.m3Grade, m3School: world.m3School,
        dipGrade: world.dipGrade, dipSchool: world.dipSchool,
        baGrade: world.baGrade, baSchool: world.baSchool,
        maGrade: world.maGrade, maSchool: world.maSchool,
        phdGrade: world.phdGrade, phdSchool: world.phdSchool,
        honGrade: world.honGrade, honSchool: world.honSchool,
        dhammaTriYear: dp.dhammaTriYear, dhammaTriSchool: dp.dhammaTriSchool,
        dhammaToYear: dp.dhammaToYear, dhammaToSchool: dp.dhammaToSchool,
        dhammaEkYear: dp.dhammaEkYear, dhammaEkSchool: dp.dhammaEkSchool,
        pali12Year: dp.pali12Year, pali12School: dp.pali12School,
        pali3Year: dp.pali3Year, pali3School: dp.pali3School,
        pali4Year: dp.pali4Year, pali4School: dp.pali4School,
        pali5Year: dp.pali5Year, pali5School: dp.pali5School,
        pali6Year: dp.pali6Year, pali6School: dp.pali6School,
        pali7Year: dp.pali7Year, pali7School: dp.pali7School,
        pali8Year: dp.pali8Year, pali8School: dp.pali8School,
        pali9Year: dp.pali9Year, pali9School: dp.pali9School,
        watPosition,
        sanghaPosition: sanghaPosition.slice(0, 200),
        rankKind,
        is_dhammaduta: marked(rows, 580, c),
        is_preacher: marked(rows, 568, c),
        is_vipassana: marked(rows, 577, c) || marked(rows, 633, c)
      });
    }
  }
  return out;
}

function empty(v) {
  return v == null || String(v).trim() === "";
}
function put(obj, key, val) {
  if (val == null || val === "" || val === false) return false;
  if (!empty(obj[key])) return false;
  obj[key] = val;
  return true;
}

function patchMonk(m, src) {
  const changed = [];
  const bio = m.bio && typeof m.bio === "object" ? Object.assign({}, m.bio) : {};
  if (put(m, "citizen_id", src.citizen_id)) changed.push("citizen_id");
  if (put(m, "former_name", src.former_name)) changed.push("former_name");
  if (put(m, "former_surname", src.former_surname)) changed.push("former_surname");
  if (put(m, "chaya_pali", src.chaya_pali)) changed.push("chaya_pali");
  if (put(m, "nikaya", src.nikaya)) changed.push("nikaya");
  if (put(m, "sutthi_no", src.sutthi_no)) changed.push("sutthi_no");
  if (m.birth_year_be == null && src.birth_year_be) {
    m.birth_year_be = src.birth_year_be;
    changed.push("birth_year_be");
  }
  if (put(m, "birth_province", src.birth_province)) changed.push("birth_province");
  if (!m.ordained_on && src.ordained_on) {
    m.ordained_on = src.ordained_on;
    changed.push("ordained_on");
  }
  if (put(m, "rank_kind", src.rankKind)) changed.push("rank_kind");
  if (!m.is_dhammaduta && src.is_dhammaduta) { m.is_dhammaduta = true; changed.push("dhammaduta"); }
  if (!m.is_preacher && src.is_preacher) { m.is_preacher = true; changed.push("preacher"); }
  if (!m.is_vipassana && src.is_vipassana) { m.is_vipassana = true; changed.push("vipassana"); }
  const bioMap = [
    ["birthText", src.birthText], ["fatherName", src.fatherName], ["motherName", src.motherName],
    ["formerJob", src.formerJob], ["ethnicity", src.ethnicity], ["nationality", src.nationality],
    ["stature", src.stature], ["skinTone", src.skinTone], ["marks", src.marks],
    ["formerHouse", src.formerHouse], ["formerTambon", src.formerTambon],
    ["formerDistrict", src.formerDistrict], ["formerProvince", src.formerProvince],
    ["noviceOn", src.noviceOn], ["noviceWat", src.noviceWat],
    ["preceptor", src.preceptor], ["preceptorWat", src.preceptorWat],
    ["ordainedOnText", src.ordainedOnText], ["ordainedWat", src.ordainedWat],
    ["ordainedAge", src.ordainedAge], ["ordainedTime", src.ordainedTime],
    ["kammavaca", src.kammavaca], ["kammavacaWat", src.kammavacaWat],
    ["anusavana", src.anusavana], ["anusavanaWat", src.anusavanaWat],
    ["firstAffWat", src.firstAffWat], ["firstAffOn", src.firstAffOn], ["firstAbbot", src.firstAbbot],
    ["moveFromWat", src.moveFromWat], ["moveOn", src.moveOn], ["moveReason", src.moveReason],
    ["dhammaLevel", src.dhammaLevel], ["dhammaYear", src.dhammaYear], ["dhammaSchool", src.dhammaSchool],
    ["paliLevel", src.paliLevel], ["paliYear", src.paliYear], ["paliSchool", src.paliSchool],
    ["secularLevel", src.secularLevel], ["secularSchool", src.secularSchool],
    ["priGrade", src.priGrade], ["priSchool", src.priSchool],
    ["m1Grade", src.m1Grade], ["m1School", src.m1School],
    ["m3Grade", src.m3Grade], ["m3School", src.m3School],
    ["dipGrade", src.dipGrade], ["dipSchool", src.dipSchool],
    ["baGrade", src.baGrade], ["baSchool", src.baSchool],
    ["maGrade", src.maGrade], ["maSchool", src.maSchool],
    ["phdGrade", src.phdGrade], ["phdSchool", src.phdSchool],
    ["honGrade", src.honGrade], ["honSchool", src.honSchool],
    ["dhammaTriYear", src.dhammaTriYear], ["dhammaTriSchool", src.dhammaTriSchool],
    ["dhammaToYear", src.dhammaToYear], ["dhammaToSchool", src.dhammaToSchool],
    ["dhammaEkYear", src.dhammaEkYear], ["dhammaEkSchool", src.dhammaEkSchool],
    ["pali12Year", src.pali12Year], ["pali12School", src.pali12School],
    ["pali3Year", src.pali3Year], ["pali3School", src.pali3School],
    ["pali4Year", src.pali4Year], ["pali4School", src.pali4School],
    ["pali5Year", src.pali5Year], ["pali5School", src.pali5School],
    ["pali6Year", src.pali6Year], ["pali6School", src.pali6School],
    ["pali7Year", src.pali7Year], ["pali7School", src.pali7School],
    ["pali8Year", src.pali8Year], ["pali8School", src.pali8School],
    ["pali9Year", src.pali9Year], ["pali9School", src.pali9School],
    ["watPosition", src.watPosition], ["sanghaPosition", src.sanghaPosition]
  ];
  bioMap.forEach(([k, v]) => {
    if (put(bio, k, v)) changed.push("bio." + k);
  });
  if (looksLikeGrade(bio.secularSchool) && src.secularSchool && !looksLikeGrade(src.secularSchool)) {
    bio.secularSchool = src.secularSchool;
    changed.push("bio.secularSchool");
  }
  m.bio = bio;
  return changed;
}

function normPali(s) {
  return String(s || "").replace(/[ฺํ์\s."]/g, "").replace(/ปัญ/g, "ปญ").toLowerCase();
}

(async () => {
  const shared = loadShared();
    const srcRows = readMonks(shared);
    const sheets = listTempleSheets();
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  const client = await pool.connect();
  try {
    const monks = (await client.query(
      `SELECT id, chaya, chaya_pali, former_name, former_surname, title, wat_name, tambon,
              sangha_tambon, district, province, nikaya, sutthi_no, citizen_id, birth_year_be,
              birth_province, ordained_on, status, note, bio, rank_kind,
              is_dhammaduta, is_preacher, is_vipassana
         FROM monks`
    )).rows;
    const byId = {};
    monks.forEach((m) => { if (m.citizen_id) byId[m.citizen_id] = m; });
    const stats = {
      excel: srcRows.length,
      withId: srcRows.filter((r) => r.citizen_id).length,
      matchedId: 0,
      moved: 0,
      sameWat: 0,
      notInDb: 0,
      noId: 0,
      patched: 0,
      fields: {}
    };
    const updates = [];
    const affAdds = [];
    const used = {};
    for (const r of srcRows) {
      if (!r.citizen_id) { stats.noId += 1; continue; }
      const m = byId[r.citizen_id];
      if (!m) { stats.notInDb += 1; continue; }
      if (used[m.id]) continue;
      used[m.id] = true;
      stats.matchedId += 1;
      const curWat = normTemple(m.wat_name);
      const oldWat = normTemple(r.oldWat);
      if (curWat && oldWat && curWat !== oldWat) stats.moved += 1;
      else stats.sameWat += 1;
      const before = m.wat_name;
      const changed = patchMonk(m, r);
      if (m.wat_name !== before) throw new Error("must not change wat");
      if (put(m.bio, "stayWat", m.wat_name)) changed.push("bio.stayWat");
      if (r.firstAffWat) {
        affAdds.push({
          monk_id: m.id, kind: "รับเข้าสังกัด", wat_name: r.firstAffWat,
          event_date: isoDate(r.firstAffOn), reason: "", note: r.firstAbbot || ""
        });
      }
      if (r.moveFromWat) {
        affAdds.push({
          monk_id: m.id, kind: "ย้ายสังกัด", wat_name: r.moveFromWat,
          event_date: isoDate(r.moveOn), reason: r.moveReason || "", note: ""
        });
      }
      if (changed.length) {
        stats.patched += 1;
        changed.forEach((k) => { stats.fields[k] = (stats.fields[k] || 0) + 1; });
        updates.push(m);
      }
    }
    if (APPLY) {
      await client.query("BEGIN");
      for (const m of updates) {
        await client.query(
          `UPDATE monks SET
             former_name=$2, former_surname=$3, chaya_pali=$4, nikaya=$5, sutthi_no=$6,
             citizen_id=$7, birth_year_be=$8, birth_province=$9, ordained_on=$10,
             bio=$11, rank_kind=$12, is_dhammaduta=$13, is_preacher=$14, is_vipassana=$15,
             updated_at=now()
           WHERE id=$1`,
          [
            m.id, m.former_name || "", m.former_surname || "", m.chaya_pali || "",
            m.nikaya || "", m.sutthi_no || "", m.citizen_id || "",
            m.birth_year_be, m.birth_province || "", m.ordained_on || null,
            m.bio || {}, m.rank_kind || "", !!m.is_dhammaduta, !!m.is_preacher, !!m.is_vipassana
          ]
        );
      }
      let affInserted = 0;
      for (const a of affAdds) {
        const exist = await client.query(
          `SELECT id FROM monk_affiliations
            WHERE monk_id=$1 AND kind=$2 AND wat_name=$3
              AND (event_date IS NOT DISTINCT FROM $4::date)`,
          [a.monk_id, a.kind, a.wat_name, a.event_date]
        );
        if (exist.rowCount) continue;
        await client.query(
          `INSERT INTO monk_affiliations
            (monk_id, kind, wat_name, tambon, district, province, event_date, reason, note)
           VALUES ($1,$2,$3,'','','',$4,$5,$6)`,
          [a.monk_id, a.kind, a.wat_name, a.event_date, a.reason || "", a.note || ""]
        );
        affInserted += 1;
      }
      await client.query("COMMIT");
      stats.affInserted = affInserted;
    } else {
      stats.affCandidates = affAdds.length;
    }
    console.log(JSON.stringify({ apply: APPLY, sheets: sheets.map((x) => x[1]), compare: stats, updated: updates.length }, null, 2));
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (x) {}
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
