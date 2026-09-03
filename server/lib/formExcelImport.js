const { readWorkbook } = require("./xlsxRead");
const { thaiDigits } = require("./courses");

function dash(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function normLabel(s) {
  return dash(s).replace(/\s*\*$/, "").replace(/\s+\/\s+[A-Za-z].*$/, "");
}

function pick(map, label) {
  const want = normLabel(label);
  if (map[want] != null && map[want] !== "") return map[want];
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === want || keys[i].indexOf(want) === 0 || want.indexOf(keys[i]) === 0) {
      if (map[keys[i]]) return map[keys[i]];
    }
  }
  return "";
}

function formMap(rows) {
  const out = {};
  (rows || []).forEach(function (row) {
    const label = normLabel((row && row[0]) || "");
    const val = dash((row && row[1]) || "");
    if (!label || !val) return;
    if (/^(รายการ|กรอกที่นี่)/.test(label)) return;
    if (/ส่วนที่|หนังสือสุทธิ|ข้อมูลพระภิกษุ|ผู้กรอก/.test(label) && !val) return;
    out[label] = val;
  });
  return out;
}

function personTypeOf(v) {
  return /สามเณร/.test(v) ? "สามเณร" : "ภิกษุ";
}

function nikayaOf(v) {
  if (/ธรรมยุต/.test(v)) return "ธรรมยุต";
  if (/มหา/.test(v)) return "มหานิกาย";
  return dash(v).slice(0, 80);
}

function statusOf(v) {
  if (/มรณภาพ/.test(v)) return "มรณภาพ";
  if (/ลาสิกขา/.test(v)) return "ลาสิกขา";
  if (/ย้ายวัด/.test(v)) return "ย้ายวัด";
  return "จำพรรษา";
}

function rankKindOf(v) {
  const s = dash(v);
  if (/ราชาคณะ/.test(s)) return "พระราชาคณะ";
  if (/ครูสัญญาบัตร/.test(s)) return "พระครูสัญญาบัตร";
  if (/ครูฐานานุกรม/.test(s)) return "พระครูฐานานุกรม";
  if (/ฐานานุกรม/.test(s) && !/ครู/.test(s)) return "พระฐานานุกรม";
  return "ชื่อพระสงฆ์ / สามเณร";
}

function rainKindOf(v) {
  const s = dash(v);
  if (/ยังไม่มา/.test(s)) return "ยังไม่มา";
  if (/มาเรียน|มาจำพรรษาเพื่อเรียน|มาอยู่เพื่อเรียน/.test(s)) return "มาจำพรรษาเพื่อเรียน";
  if (/ไปที่อื่น|ไปจำพรรษา|ยืม/.test(s)) return "ไปจำพรรษาที่อื่น";
  return "";
}

function yearBeOf(v) {
  const d = thaiDigits(dash(v));
  const m = d.match(/(25\d{2}|24\d{2}|26\d{2})/);
  return m ? Number(m[1]) : null;
}

function tableRows(rows) {
  const list = (rows || []).filter(function (r) { return r && r.some(function (c) { return dash(c); }); });
  if (!list.length) return [];
  return list.slice(1);
}

function watAlias(name) {
  const s = dash(name);
  if (/intharam|อินทาราม/i.test(s)) return "วัดอินทาราม";
  return s;
}

function parseRains(rows) {
  return tableRows(rows).map(function (r) {
    const yearBe = yearBeOf(r[0]);
    const watName = watAlias(r[1]);
    const rainKind = rainKindOf(r[8]);
    if (!yearBe) return null;
    if (!watName && !rainKind && !dash(r[2]) && !dash(r[3]) && !dash(r[4]) && !dash(r[5])) return null;
    const atIntharam = watName === "วัดอินทาราม";
    return {
      yearBe: yearBe,
      watName: watName,
      tambon: dash(r[2]) || (atIntharam ? "หัวรอ" : ""),
      sanghaTambon: dash(r[3]),
      district: dash(r[4]) || (atIntharam ? "พระนครศรีอยุธยา" : ""),
      province: dash(r[5]) || (atIntharam ? "พระนครศรีอยุธยา" : ""),
      age: dash(r[6]),
      vassa: dash(r[7]),
      rainKind: rainKind
    };
  }).filter(Boolean);
}

function parseDhamma(rows, bio) {
  tableRows(rows).forEach(function (r) {
    const lv = dash(r[0]);
    const year = dash(r[1]);
    const wat = dash(r[2]);
    const school = dash(r[3]);
    const prov = dash(r[4]);
    if (!year && !wat && !school && !prov) return;
    function set(prefix, extraWat) {
      if (year) bio[prefix + "Year"] = year.slice(0, 40);
      if (school) bio[prefix + "School"] = school.slice(0, 160);
      if (prov) bio[prefix + "Province"] = prov.slice(0, 80);
      if (extraWat && wat) bio[prefix + extraWat] = wat.slice(0, 160);
    }
    if (/ตรี/.test(lv) && /นักธรรม|น\.?ธ/.test(lv)) {
      bio.dhammaLevel = bio.dhammaLevel || "ตรี";
      set("dhammaTri", "Samnak");
    } else if (/โท/.test(lv) && /นักธรรม|น\.?ธ/.test(lv)) {
      bio.dhammaLevel = "โท";
      set("dhammaTo", "Samnak");
    } else if (/เอก/.test(lv) && /นักธรรม|น\.?ธ/.test(lv)) {
      bio.dhammaLevel = "เอก";
      set("dhammaEk", "Samnak");
    } else if (/1-2|๑-๒|ประโยค/.test(lv)) {
      bio.paliLevel = bio.paliLevel || "ประโยค 1-2";
      set("pali12", "Wat");
    } else {
      const n = lv.match(/ป\.?\s*ธ\.?\s*([3-9๓-๙])/);
      if (!n) return;
      const map = { "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };
      const g = map[n[1]] || n[1];
      bio.paliLevel = "ป.ธ." + g;
      set("pali" + g, "Wat");
    }
  });
}

function parseSecular(rows, bio) {
  tableRows(rows).forEach(function (r) {
    const lv = dash(r[0]);
    const year = dash(r[1]);
    const grade = dash(r[2]);
    const school = dash(r[3]);
    if (!year && !grade && !school) return;
    const pairs = [
      [/ประถม|Primary/i, "pri"],
      [/มัธยมต้น|Lower/i, "m1"],
      [/มัธยมปลาย|Upper/i, "m3"],
      [/อนุปริญญา|Diploma/i, "dip"],
      [/ปริญญาตรี|Bachelor/i, "ba"],
      [/ปริญญาโท|Master/i, "ma"],
      [/ปริญญาเอก|Doctorate/i, "phd"],
      [/กิตติมศักดิ์|Honorary/i, "hon"]
    ];
    for (let i = 0; i < pairs.length; i++) {
      if (!pairs[i][0].test(lv)) continue;
      const p = pairs[i][1];
      if (year) bio[p + "Year"] = year.slice(0, 40);
      if (grade) bio[p + "Grade"] = grade.slice(0, 40);
      if (school) bio[p + "School"] = school.slice(0, 160);
      return;
    }
    if (!bio.eduExtra) bio.eduExtra = [];
    bio.eduExtra.push({
      kind: "อื่น",
      yearText: year,
      title: lv,
      school: school,
      note: grade
    });
  });
}

function parseOffices(rows) {
  return tableRows(rows).map(function (r) {
    const yearText = dash(r[0]);
    const position = dash(r[1]);
    const appointedOn = dash(r[2]);
    const watName = dash(r[3]);
    const district = dash(r[4]);
    const province = dash(r[5]);
    const note = dash(r[6]);
    if (!yearText && !position && !appointedOn && !watName) return null;
    return { yearText, position, appointedOn, watName, district, province, note };
  }).filter(Boolean);
}

function parseSpecial(text, bio) {
  const s = dash(text);
  const courses = [];
  if (/ธรรมทูต/.test(s)) {
    bio._dhammaduta = true;
    courses.push({ kind: "ธรรมทูต", yearText: dash(bio.specialOn), place: dash(bio.specialWork), note: dash(bio.specialDetail) });
  }
  if (/นักเทศน์/.test(s)) {
    bio._preacher = true;
    courses.push({ kind: "นักเทศน์", yearText: dash(bio.specialOn), place: dash(bio.specialWork), note: dash(bio.specialDetail) });
  }
  if (/วิปัสสนา/.test(s)) {
    bio._vipassana = true;
    courses.push({ kind: "วิปัสสนาจารย์", yearText: dash(bio.specialOn), place: dash(bio.specialWork), note: dash(bio.specialDetail) });
  }
  if (/ปริยัตินิเทศน์/.test(s)) courses.push({ kind: "ปริยัตินิเทศน์", yearText: dash(bio.specialOn), place: dash(bio.specialWork) });
  if (/บัณฑิตเผยแผ่/.test(s)) courses.push({ kind: "บัณฑิตเผยแผ่", yearText: dash(bio.specialOn), place: dash(bio.specialWork) });
  return courses.filter(function (a) { return a.kind; });
}

function sheetByName(sheets, names) {
  const keys = Object.keys(sheets || {});
  for (let i = 0; i < names.length; i++) {
    const want = names[i];
    const hit = keys.find(function (k) { return k === want || k.indexOf(want) === 0; });
    if (hit) return sheets[hit];
  }
  return [];
}

function parseFormExcel(buf) {
  const sheets = readWorkbook(buf);
  const f = formMap(sheetByName(sheets, ["กรอกประวัติ"]));
  const warnings = [];
  const bio = {
    nittayapatSeq: pick(f, "ลำดับนิตยภัต"),
    photoName: pick(f, "ชื่อไฟล์รูป"),
    nickname: pick(f, "ชื่อเล่น"),
    englishName: pick(f, "ชื่อภาษาอังกฤษ"),
    birthText: pick(f, "วัน/เดือน/ปี เกิด"),
    fatherName: pick(f, "ชื่อ-นามสกุล ของบิดา"),
    motherName: pick(f, "ชื่อ-นามสกุล ของมารดา"),
    formerJob: pick(f, "อาชีพเดิม"),
    ethnicity: pick(f, "เชื้อชาติ"),
    nationality: pick(f, "สัญชาติ"),
    stature: pick(f, "สัณฐาน"),
    skinTone: pick(f, "สีเนื้อ"),
    marks: pick(f, "ตำหนิ"),
    formerHouse: pick(f, "ที่อยู่เดิม บ้านเลขที่/หมู่ที่"),
    formerPostcode: pick(f, "รหัสไปรษณีย์"),
    formerTambon: pick(f, "แขวง/ตำบล"),
    formerDistrict: pick(f, "เขต/อำเภอ"),
    formerProvince: pick(f, "จังหวัด (ที่อยู่เดิม)"),
    noviceOn: pick(f, "วันบรรพชาสามเณร"),
    noviceWat: pick(f, "บรรพชาสามเณร ณ วัด"),
    noviceTambon: pick(f, "ตำบล (บรรพชา)"),
    noviceDistrict: pick(f, "อำเภอ (บรรพชา)"),
    noviceProvince: pick(f, "จังหวัด (บรรพชา)"),
    novicePreceptor: pick(f, "ชื่อพระอุปัชฌาย์ (ตอนบรรพชา)"),
    novicePreceptorWat: pick(f, "วัดพระอุปัชฌาย์ (บรรพชา)"),
    novicePreceptorTambon: pick(f, "ตำบลวัดพระอุปัชฌาย์"),
    novicePreceptorDistrict: pick(f, "อำเภอวัดพระอุปัชฌาย์"),
    novicePreceptorProvince: pick(f, "จังหวัดวัดพระอุปัชฌาย์"),
    ordainedOnText: pick(f, "วันอุปสมบท") || pick(f, "วันอุปสมบท (ซ้ำได้ถ้าต่างจากหัวรายการ)"),
    ordainedAge: pick(f, "อุปสมบทเมื่ออายุ"),
    ordainedTime: pick(f, "เวลาที่อุปสมบท"),
    ordainedWat: pick(f, "วัดที่อุปสมบท"),
    ordainedTambon: pick(f, "ตำบล (อุปสมบท)"),
    ordainedDistrict: pick(f, "อำเภอ (อุปสมบท)"),
    ordainedProvince: pick(f, "จังหวัด (อุปสมบท)"),
    preceptor: pick(f, "พระอุปัชฌาย์"),
    preceptorWat: pick(f, "สังกัดวัดของพระอุปัชฌาย์"),
    kammavaca: pick(f, "พระกรรมวาจาจารย์"),
    kammavacaWat: pick(f, "วัดพระกรรมวาจาจารย์"),
    anusavana: pick(f, "พระอนุสาวนาจารย์"),
    anusavanaWat: pick(f, "วัดพระอนุสาวนาจารย์"),
    stayWat: pick(f, "วัดที่พำนัก"),
    watPhone: pick(f, "เบอร์ติดต่อวัดที่พำนัก"),
    mobile: pick(f, "เบอร์มือถือ"),
    secularYear: pick(f, "สูงสุด พ.ศ."),
    secularLevel: pick(f, "ระดับชั้นสูงสุด"),
    secularSchool: pick(f, "สถานศึกษา"),
    secularMajor: pick(f, "สาขาที่เรียน"),
    specialOn: pick(f, "วันที่ได้รับมอบหมาย"),
    specialWork: pick(f, "ชื่องาน"),
    specialRole: pick(f, "ประเภทงานพิเศษ"),
    specialDetail: pick(f, "รายละเอียด"),
    firstAffWat: pick(f, "สังกัดวัดเมื่อบวช"),
    firstAffOn: pick(f, "วันที่สังกัดเมื่อบวช"),
    moveFromWat: pick(f, "ย้ายจากวัด"),
    moveOn: pick(f, "วันที่ย้าย"),
    moveReason: pick(f, "เหตุที่ย้าย"),
    movedToWat: pick(f, "ไปอยู่วัด")
  };
  parseDhamma(sheetByName(sheets, ["นักธรรม-บาลี", "นักธรรม"]), bio);
  parseSecular(sheetByName(sheets, ["สามัญ"]), bio);
  const offices = parseOffices(sheetByName(sheets, ["ตำแหน่ง"]));
  if (offices.length) bio.watPosHistory = offices;
  const courses = parseSpecial(pick(f, "ประเภทงานพิเศษ"), bio);
  const affiliations = [];
  if (bio.firstAffWat || pick(f, "วันที่สังกัดเมื่อบวช")) {
    affiliations.push({
      kind: "สังกัดเมื่อบวช",
      watName: bio.firstAffWat,
      eventText: pick(f, "วันที่สังกัดเมื่อบวช"),
      tambon: pick(f, "ตำบล (สังกัดเมื่อบวช)"),
      district: pick(f, "อำเภอ (สังกัดเมื่อบวช)"),
      province: pick(f, "จังหวัด (สังกัดเมื่อบวช)")
    });
  }
  if (pick(f, "มาอยู่วัดชื่อวัด")) {
    affiliations.push({
      kind: "รับเข้าสังกัด",
      watName: pick(f, "มาอยู่วัดชื่อวัด"),
      eventText: pick(f, "วันที่รับเข้าสังกัด"),
      tambon: pick(f, "ตำบล (รับเข้า)"),
      district: pick(f, "อำเภอ (รับเข้า)"),
      province: pick(f, "จังหวัด (รับเข้า)"),
      note: pick(f, "หมายเหตุรับเข้าสังกัด")
    });
  }
  if (bio.moveFromWat || bio.movedToWat) {
    affiliations.push({
      kind: "ย้ายสังกัด",
      watName: bio.moveFromWat,
      eventText: bio.moveOn,
      reason: bio.moveReason,
      toWatName: bio.movedToWat,
      toTambon: pick(f, "ตำบลวัดที่ไป"),
      toDistrict: pick(f, "อำเภอวัดที่ไป"),
      toProvince: pick(f, "จังหวัดวัดที่ไป"),
      toEventText: pick(f, "วันที่รับเข้าสังกัด (ปลายทาง)")
    });
  }
  const chayaPali = pick(f, "ฉายา");
  if (!chayaPali) warnings.push("ยังไม่มีฉายาในไฟล์");
  const passportNo = pick(f, "เลขพาสปอร์ต") || pick(f, "พาสปอร์ต");
  const thaiId = pick(f, "เลขบัตรประชาชน 13 หลัก") || pick(f, "เลขบัตรประชาชน");
  const nat = pick(f, "สัญชาติ");
  const typeRaw = pick(f, "ประเภทเอกสาร") + " " + nat;
  let idKind = "thai";
  if (/ต่างชาติ|ต่างด้าว|พาสปอร์ต|passport|foreign/i.test(typeRaw) || (passportNo && !thaiId)) idKind = "passport";
  else if (nat && !/ไทย|Thai/i.test(nat)) idKind = "passport";
  const citizenId = idKind === "passport" ? (passportNo || thaiId) : (thaiId || passportNo);
  const filled = Object.keys(f).length;
  if (!filled) warnings.push("ชีต กรอกประวัติ ยังไม่มีค่าในคอลัมน์ กรอกที่นี่");
  const monk = {
    personType: personTypeOf(pick(f, "ประเภท")),
    nikaya: nikayaOf(pick(f, "สังกัดนิกาย")),
    sanghaName: pick(f, "ชื่อ (ราชทินนาม หรือฐานานุกรม)"),
    chayaPali: chayaPali,
    chaya: chayaPali,
    formerName: pick(f, "ชื่อจริง (ชื่อเดิม)"),
    formerSurname: pick(f, "นามสกุล (เดิม)"),
    title: pick(f, "ชั้นสมณศักดิ์"),
    rankKind: rankKindOf(pick(f, "ประเภทชื่อ")),
    sutthiNo: pick(f, "เลขที่หนังสือสุทธิ"),
    citizenId: citizenId,
    idKind: idKind,
    watName: pick(f, "วัดต้นสังกัดปัจจุบัน"),
    sanghaTambon: pick(f, "ตำบลคณะสงฆ์"),
    tambon: pick(f, "ตำบล (บ้านเมือง)"),
    district: pick(f, "อำเภอ"),
    province: pick(f, "จังหวัด"),
    status: statusOf(pick(f, "สถานะ")),
    note: pick(f, "หมายเหตุ"),
    ordainedOn: "",
    birthYearBe: yearBeOf(bio.birthText) || "",
    birthProvince: bio.formerProvince || "",
    isDhammaduta: !!bio._dhammaduta,
    isPreacher: !!bio._preacher,
    isVipassana: !!bio._vipassana,
    bio: bio,
    affiliations: affiliations,
    rains: parseRains(sheetByName(sheets, ["จำพรรษา"])),
    courses: courses
  };
  delete bio._dhammaduta;
  delete bio._preacher;
  delete bio._vipassana;
  return { monk, warnings, filled: filled + monk.rains.length };
}

module.exports = { parseFormExcel };
