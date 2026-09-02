require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { thaiDigits } = require("./lib/courses");
const { toParts } = require("./lib/vassa");
const { withWatPrefix } = require("./lib/wats");
const { SAMANASAK_CLASS, THANANAMA } = require("./lib/samanasak");

const APPLY = process.argv.includes("--apply");
const ROOT = process.argv.find((a) => a.startsWith("--dir="))?.slice(6)
  || path.join(process.env.TEMP || "C:\\Temp", "phra-src", "test-base");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL || /wat_accounting|wat_audit/i.test(DATABASE_URL)) {
  console.error("ต้องใช้ฐาน wat_phra");
  process.exit(1);
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
function isJunk(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t || t === "-" || /^[xX✓]$/.test(t)) return true;
  if (/^\d+(\.\d+)?$/.test(t) && Number(t) < 2400) return true;
  const d = thaiDigits(t);
  if (/^\d{4}$/.test(d) && !/^(24|25|26)\d{2}$/.test(d)) return true;
  return false;
}
function txt(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (isJunk(s)) return "";
  return s.slice(0, max || 160);
}
function eduYear(v) {
  const d = thaiDigits(String(v == null ? "" : v));
  const m = d.match(/(24\d{2}|25\d{2}|26\d{2})/);
  return m ? m[1] : "";
}
function citizenId(v) {
  const d = thaiDigits(String(v || "")).replace(/[^\d]/g, "");
  return d.length === 13 ? d : "";
}
function colRow(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { c: col - 1, r: +m[2] - 1 };
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
function parseGrid(file, shared) {
  const xml = fs.readFileSync(file, "utf8");
  const rows = [];
  const cRe = /<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = cRe.exec(xml))) {
    const pos = colRow(m[1]);
    if (!pos || pos.c > 6 || pos.r > 540) continue;
    const vm = m[3].match(/<v>([\s\S]*?)<\/v>/);
    const is = m[3].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    let val = "";
    if (/t="s"/.test(m[2]) && vm) val = shared[+vm[1]] || "";
    else if (is) val = decode(is[1]);
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
function raw(rows, r, c) {
  return String((rows[r - 1] || [])[c] || "").replace(/\s+/g, " ").trim();
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
function splitAddr(addr) {
  const s = String(addr || "");
  const tambon = (s.match(/ตำบล\s*([ก-๙]+)/) || s.match(/ต\.\s*([ก-๙]+)/) || [])[1] || "";
  const district = (s.match(/อำเภอ\s*([ก-๙]+)/) || s.match(/อ\.\s*([ก-๙]+)/) || [])[1] || "";
  const prov = (s.match(/จังหวัด\s*([ก-๙A-Za-z]+)/) || [])[1] || "";
  return {
    formerHouse: txt(s, 120),
    formerTambon: tambon.slice(0, 80),
    formerDistrict: district.slice(0, 80),
    formerProvince: (prov || "").slice(0, 80)
  };
}
function blockHasData(rows, start, span, c) {
  for (let r = start; r < start + span; r++) {
    if (txt(raw(rows, r, c), 80) || eduYear(raw(rows, r, c))) return true;
  }
  return false;
}

function readMonk(rows, c) {
  const id = citizenId(raw(rows, 4, c));
  if (!id) return null;
  const home = splitAddr(txt(raw(rows, 30, c), 200));
  const ordainedText = txt(raw(rows, 41, c), 80);
  const world = [
    [82, "pri"], [85, "m1"], [88, "m3"], [91, "dip"],
    [94, "ba"], [97, "ma"], [100, "phd"], [103, "hon"]
  ];
  const edu = {};
  world.forEach(([r, p]) => {
    edu[p + "Grade"] = txt(raw(rows, r, c), 40);
    edu[p + "School"] = txt(raw(rows, r + 1, c), 160);
  });
  for (let i = world.length - 1; i >= 0; i--) {
    const p = world[i][1];
    if (edu[p + "Grade"] || edu[p + "School"]) {
      edu.secularLevel = edu[p + "Grade"] || "";
      edu.secularSchool = edu[p + "School"] || "";
      break;
    }
  }
  const dhamma = [
    [129, "dhammaTri", "ตรี"],
    [134, "dhammaTo", "โท"],
    [139, "dhammaEk", "เอก"]
  ];
  dhamma.forEach(([r, p]) => {
    edu[p + "Year"] = eduYear(raw(rows, r, c));
    edu[p + "School"] = txt(raw(rows, r + 1, c), 160) || txt(raw(rows, r + 3, c), 160);
  });
  if (edu.dhammaEkYear || edu.dhammaEkSchool) {
    edu.dhammaLevel = "เอก";
    edu.dhammaYear = edu.dhammaEkYear;
    edu.dhammaSchool = edu.dhammaEkSchool;
  } else if (edu.dhammaToYear || edu.dhammaToSchool) {
    edu.dhammaLevel = "โท";
    edu.dhammaYear = edu.dhammaToYear;
    edu.dhammaSchool = edu.dhammaToSchool;
  } else if (edu.dhammaTriYear || edu.dhammaTriSchool) {
    edu.dhammaLevel = "ตรี";
    edu.dhammaYear = edu.dhammaTriYear;
    edu.dhammaSchool = edu.dhammaTriSchool;
  }
  const pali = [
    [144, "pali12", "ประโยค 1-2"], [149, "pali3", "ป.ธ.3"], [154, "pali4", "ป.ธ.4"],
    [159, "pali5", "ป.ธ.5"], [164, "pali6", "ป.ธ.6"], [169, "pali7", "ป.ธ.7"],
    [174, "pali8", "ป.ธ.8"], [179, "pali9", "ป.ธ.9"]
  ];
  pali.forEach(([r, p]) => {
    edu[p + "Year"] = eduYear(raw(rows, r, c));
    edu[p + "School"] = txt(raw(rows, r + 1, c), 160) || txt(raw(rows, r + 3, c), 160);
  });
  for (let i = pali.length - 1; i >= 0; i--) {
    const p = pali[i][1];
    const label = pali[i][2];
    if (edu[p + "Year"] || edu[p + "School"]) {
      edu.paliLevel = label;
      edu.paliYear = edu[p + "Year"];
      edu.paliSchool = edu[p + "School"];
      break;
    }
  }
  let watPosition = "";
  if (blockHasData(rows, 198, 4, c) || blockHasData(rows, 194, 4, c)) watPosition = "เจ้าอาวาส";
  else if (blockHasData(rows, 190, 4, c)) watPosition = "รองเจ้าอาวาส";
  else if (blockHasData(rows, 186, 4, c)) watPosition = "ผู้ช่วยเจ้าอาวาส";
  let sanghaPosition = "";
  const sangha = [
    [226, "เจ้าคณะใหญ่"], [223, "เจ้าคณะภาค"], [220, "รองเจ้าคณะภาค"],
    [217, "เจ้าคณะจังหวัด"], [214, "รองเจ้าคณะจังหวัด"],
    [211, "เจ้าคณะอำเภอ"], [208, "รองเจ้าคณะอำเภอ"],
    [205, "เจ้าคณะตำบล"], [202, "รองเจ้าคณะตำบล"]
  ];
  for (const [r, label] of sangha) {
    if (blockHasData(rows, r, 3, c)) { sanghaPosition = label; break; }
  }
  if (!sanghaPosition) {
    const sec = [
      [250, "เลขานุการเจ้าคณะอำเภอ"], [247, "เลขานุการรองเจ้าคณะอำเภอ"],
      [244, "เลขานุการเจ้าคณะตำบล"], [241, "เลขานุการรองเจ้าคณะตำบล"]
    ];
    for (const [r, label] of sec) {
      if (blockHasData(rows, r, 3, c)) { sanghaPosition = label; break; }
    }
  }
  let royalClass = "";
  const classRows = [
    [347, "พระเปรียญธรรม ๙ ประโยค"], [398, "พระเปรียญธรรม ๘ ประโยค"],
    [404, "พระเปรียญธรรม ๗ ประโยค"], [455, "พระเปรียญธรรม ๖ ประโยค"],
    [458, "พระเปรียญธรรม ๕ ประโยค"], [491, "พระเปรียญธรรม ๔ ประโยค"],
    [500, "พระเปรียญธรรม ๓ ประโยค"]
  ];
  for (const [r, label] of classRows) {
    if (blockHasData(rows, r, 4, c) || eduYear(raw(rows, r, c))) {
      royalClass = label;
      break;
    }
  }
  if (!royalClass) {
    for (const label of SAMANASAK_CLASS) {
      /* keep for datalist only */
    }
  }
  let royalName = txt(raw(rows, 7, c), 160);
  for (const [r, label] of [
    [515, "พระครูสมุห์"], [521, "พระครูใบฎีกา"], [509, "พระครูสังฆรักษ์"],
    [473, "พระครูวินัยธร"], [479, "พระครูธรรมธร"], [485, "พระครูคู่สวด"]
  ]) {
    if (blockHasData(rows, r, 5, c) && !royalName) royalName = label;
  }
  const rankKind = /พระครู/.test(royalName || "") || /พระครู/.test(royalClass || "")
    ? (THANANAMA.some((x) => (royalName || "").indexOf(x) === 0) ? "พระครูฐานานุกรม" : "พระครูสัญญาบัตร")
    : "";
  const summary = txt(raw(rows, 12, c), 80);
  return {
    citizen_id: id,
    sutthi_no: txt(raw(rows, 5, c), 80).replace(/^ที่\s*/, ""),
    royalName,
    chaya_pali: txt(raw(rows, 8, c), 80),
    former_surname: txt(raw(rows, 9, c), 120) || txt(raw(rows, 19, c), 120),
    former_name: txt(raw(rows, 18, c), 120).replace(/^นาย/, ""),
    nikaya: txt(raw(rows, 15, c), 80),
    wat_current: withWatPrefix(txt(raw(rows, 13, c), 160)),
    birthText: txt(raw(rows, 20, c), 80),
    birth_year_be: yearBe(raw(rows, 20, c)),
    birth_province: home.formerProvince,
    fatherName: txt(raw(rows, 27, c), 160),
    motherName: txt(raw(rows, 28, c), 160),
    formerJob: txt(raw(rows, 21, c), 80),
    ethnicity: txt(raw(rows, 22, c), 40),
    nationality: txt(raw(rows, 23, c), 40),
    stature: txt(raw(rows, 24, c), 40),
    skinTone: txt(raw(rows, 25, c), 40),
    marks: txt(raw(rows, 26, c), 160),
    ...home,
    ordainedAge: txt(raw(rows, 40, c), 40),
    ordainedOnText: ordainedText,
    ordained_on: isoDate(ordainedText),
    ordainedTime: txt(raw(rows, 42, c), 40),
    ordainedWat: withWatPrefix(txt(raw(rows, 43, c), 160)),
    preceptor: txt(raw(rows, 45, c), 160),
    preceptorWat: withWatPrefix(txt(raw(rows, 46, c), 160)),
    kammavaca: txt(raw(rows, 48, c), 160),
    kammavacaWat: withWatPrefix(txt(raw(rows, 49, c), 160)),
    anusavana: txt(raw(rows, 51, c), 160),
    anusavanaWat: withWatPrefix(txt(raw(rows, 52, c), 160)),
    firstAffWat: withWatPrefix(txt(raw(rows, 55, c), 160)),
    firstAffOn: txt(raw(rows, 57, c), 80),
    firstAbbot: txt(raw(rows, 58, c), 160),
    moveFromWat: withWatPrefix(txt(raw(rows, 60, c), 160)),
    moveOn: txt(raw(rows, 62, c), 80),
    moveReason: txt(raw(rows, 63, c), 200),
    royalClass,
    rankKind,
    watPosition,
    sanghaPosition,
    eduSummary: summary,
    ...edu
  };
}

function set(obj, key, val) {
  if (val == null || val === "" || val === false) return false;
  if (String(obj[key] || "") === String(val)) return false;
  obj[key] = val;
  return true;
}

(async () => {
  const shared = loadShared();
  const file = path.join(ROOT, "xl", "worksheets", "sheet1.xml");
  const rows = parseGrid(file, shared);
  const src = readMonk(rows, 2);
  if (!src) {
    console.error("ไม่พบเลขบัตรในไฟล์ทดลอง");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  const client = await pool.connect();
  try {
    const r = await client.query("SELECT * FROM monks WHERE citizen_id=$1", [src.citizen_id]);
    if (!r.rowCount) {
      console.log(JSON.stringify({ matched: 0, reason: "no citizen_id in db" }));
      return;
    }
    const m = r.rows[0];
    const bio = m.bio && typeof m.bio === "object" ? Object.assign({}, m.bio) : {};
    const changed = [];
    const beforeWat = m.wat_name;
    if (set(m, "sutthi_no", src.sutthi_no)) changed.push("sutthi_no");
    if (set(m, "chaya_pali", src.chaya_pali)) changed.push("chaya_pali");
    if (src.chaya_pali && set(m, "chaya", src.chaya_pali)) changed.push("chaya");
    if (src.royalName && set(m, "sangha_name", src.royalName)) changed.push("sangha_name");
    if (set(m, "former_name", src.former_name)) changed.push("former_name");
    if (set(m, "former_surname", src.former_surname)) changed.push("former_surname");
    if (set(m, "nikaya", src.nikaya)) changed.push("nikaya");
    if (set(m, "title", src.royalClass || m.title)) changed.push("title");
    if (src.rankKind && set(m, "rank_kind", src.rankKind)) changed.push("rank_kind");
    if (m.birth_year_be == null && src.birth_year_be) {
      m.birth_year_be = src.birth_year_be;
      changed.push("birth_year_be");
    }
    if (set(m, "birth_province", src.birth_province)) changed.push("birth_province");
    if (src.ordained_on && String(m.ordained_on || "").slice(0, 10) !== src.ordained_on) {
      m.ordained_on = src.ordained_on;
      changed.push("ordained_on");
    }
    if (src.wat_current && src.wat_current !== m.wat_name) {
      m.wat_name = src.wat_current;
      changed.push("wat_name");
    }
    const bioKeys = [
      "birthText", "fatherName", "motherName", "formerJob", "ethnicity", "nationality",
      "stature", "skinTone", "marks", "formerHouse", "formerTambon", "formerDistrict", "formerProvince",
      "ordainedAge", "ordainedOnText", "ordainedTime", "ordainedWat",
      "preceptor", "preceptorWat", "kammavaca", "kammavacaWat", "anusavana", "anusavanaWat",
      "firstAffWat", "firstAffOn", "firstAbbot", "moveFromWat", "moveOn", "moveReason",
      "royalName", "royalClass", "watPosition", "sanghaPosition",
      "dhammaLevel", "dhammaYear", "dhammaSchool", "paliLevel", "paliYear", "paliSchool",
      "secularLevel", "secularSchool",
      "priGrade", "priSchool", "m1Grade", "m1School", "m3Grade", "m3School",
      "dipGrade", "dipSchool", "baGrade", "baSchool", "maGrade", "maSchool",
      "phdGrade", "phdSchool", "honGrade", "honSchool",
      "dhammaTriYear", "dhammaTriSchool", "dhammaToYear", "dhammaToSchool",
      "dhammaEkYear", "dhammaEkSchool",
      "pali12Year", "pali12School", "pali3Year", "pali3School"
    ];
    bioKeys.forEach((k) => {
      if (src[k] != null && src[k] !== "" && set(bio, k, src[k])) changed.push("bio." + k);
    });
    if (src.eduSummary && set(bio, "secularMajor", src.eduSummary)) changed.push("bio.secularMajor");
    m.bio = bio;
    if (m.wat_name !== src.wat_current && src.wat_current && changed.indexOf("wat_name") < 0) {
      /* keep */
    }
    if (APPLY && changed.length) {
      await client.query(
        `UPDATE monks SET
           chaya=$2, former_name=$3, former_surname=$4, chaya_pali=$5, nikaya=$6,
           sutthi_no=$7, title=$8, rank_kind=$9, birth_year_be=$10, birth_province=$11,
           ordained_on=$12, wat_name=$13, bio=$14, sangha_name=$15, updated_at=now()
         WHERE id=$1`,
        [
          m.id, m.chaya, m.former_name || "", m.former_surname || "", m.chaya_pali || "",
          m.nikaya || "", m.sutthi_no || "", m.title || "", m.rank_kind || "",
          m.birth_year_be, m.birth_province || "", m.ordained_on || null,
          m.wat_name, bio, m.sangha_name || ""
        ]
      );
    }
    console.log(JSON.stringify({
      apply: APPLY,
      matched: 1,
      watUnchanged: beforeWat === m.wat_name,
      changed: changed
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
