const { zipFiles } = require("./xlsxZip");

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function cellXml(r, c, text, style) {
  const ref = colLetter(c) + r;
  const t = esc(text);
  const s = style ? ' s="' + style + '"' : "";
  if (t === "") return '<c r="' + ref + '"' + s + "/>";
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + t + "</t></is></c>";
}

function rowXml(r, cells) {
  return "<row r=\"" + r + "\">" + cells.join("") + "</row>";
}

function colsXml(widths) {
  return "<cols>" + widths.map(function (w, i) {
    return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
  }).join("") + "</cols>";
}

function sheetXml(rowsXml, widths, freezeRow) {
  const freeze = freezeRow
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + freezeRow +
      '" topLeftCell="A' + (freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    freeze + colsXml(widths) + "<sheetData>" + rowsXml.join("") + "</sheetData></worksheet>";
}

function tableSheet(headers, dataRows, widths) {
  const rows = [
    rowXml(1, headers.map(function (h, i) { return cellXml(1, i + 1, h, 1); }))
  ];
  dataRows.forEach(function (row, ri) {
    const r = ri + 2;
    rows.push(rowXml(r, (row || []).map(function (v, i) {
      return cellXml(r, i + 1, v, 4);
    })));
  });
  return sheetXml(rows, widths, 1);
}

function formSheet(sections) {
  const rows = [
    rowXml(1, [cellXml(1, 1, "รายการ", 1), cellXml(1, 2, "กรอกที่นี่ / Fill here", 1), cellXml(1, 3, "English", 1)])
  ];
  let r = 2;
  sections.forEach(function (sec) {
    rows.push(rowXml(r, [cellXml(r, 1, sec.title, 2), cellXml(r, 2, "", 2), cellXml(r, 3, "", 2)]));
    r += 1;
    sec.fields.forEach(function (f) {
      rows.push(rowXml(r, [
        cellXml(r, 1, f[0], 3),
        cellXml(r, 2, "", 4),
        cellXml(r, 3, f[1] || "", 5)
      ]));
      r += 1;
    });
  });
  return sheetXml(rows, [36, 42, 52], 1);
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
    '<font><sz val="12"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FF0F4F4B"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F4"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FF94A3B8"/></left>' +
    '<right style="thin"><color rgb="FF94A3B8"/></right>' +
    '<top style="thin"><color rgb="FF94A3B8"/></top>' +
    '<bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf xfId="0"/>' +
    '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/>' +
    '<xf xfId="0" fontId="2" fillId="3" applyFont="1" applyFill="1"/>' +
    '<xf xfId="0" applyBorder="1" borderId="1"/>' +
    '<xf xfId="0" fillId="0" borderId="1" applyBorder="1"/>' +
    '<xf xfId="0"><alignment wrapText="1"/></xf>' +
    '</cellXfs>' +
    '</styleSheet>';
}

function workbookXml(names) {
  const sheets = names.map(function (n, i) {
    return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets>" + sheets + "</sheets></workbook>";
}

function workbookRels(n) {
  let rels = "";
  for (let i = 1; i <= n; i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
  }
  rels += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>";
}

function contentTypes(n) {
  let ov = "";
  for (let i = 1; i <= n; i++) {
    ov += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    ov + "</Types>";
}

function rootRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";
}

function currentBe() {
  return new Date().getFullYear() + 543;
}

function formSections() {
  return [
    {
      title: "ข้อมูลพระภิกษุ (หัวรายการ) / Monk header",
      fields: [
        ["ประเภท", "Status — Bhikkhu or samanera"],
        ["สังกัดนิกาย", "Nikaya — Mahanikaya or Dhammayut"],
        ["เลขที่หนังสือสุทธิ", "Sutthi book no.  e.g. 27/2552"],
        ["ชื่อ (ราชทินนาม หรือฐานานุกรม)", "Name / royal title"],
        ["ฉายา *", "Chaya (Pali name) — required"],
        ["ประเภทชื่อ", "Name type — monk/novice name, Chao Khana, Phra Khru Sanyabat, Phra Khru Thananukrom, Phra Thananukrom"],
        ["ชั้นสมณศักดิ์", "Ecclesiastical rank — leave blank if none"],
        ["ประเภทเอกสาร", "Thai national ID, or foreign passport"],
        ["เลขบัตรประชาชน 13 หลัก", "Thai national ID (13 digits) — Thais only"],
        ["เลขพาสปอร์ต", "Passport no. — foreigners only"],
        ["ลำดับนิตยภัต", "Nittayapat no. if any"],
        ["วัดต้นสังกัดปัจจุบัน", "Home monastery — not a temporary rains-retreat temple"],
        ["ตำบลคณะสงฆ์", "Sangha tambon"],
        ["ตำบล (บ้านเมือง)", "Subdistrict"],
        ["อำเภอ", "District"],
        ["จังหวัด", "Province"],
        ["วันอุปสมบท", "Ordination date — day / month / B.E."],
        ["สถานะ", "Current status — resident, moved, passed away, or disrobed"],
        ["หมายเหตุ", "Notes"]
      ]
    },
    {
      title: "ส่วนที่ 1 รูป / Photo",
      fields: [["ชื่อไฟล์รูป", "JPEG file name — leave blank if no photo yet"]]
    },
    {
      title: "ส่วนที่ 2 ประวัติเดิม (ก่อนอุปสมบท) / Lay life before ordination",
      fields: [
        ["ชื่อจริง (ชื่อเดิม)", "Given name"],
        ["นามสกุล (เดิม)", "Family name"],
        ["ชื่อเล่น", "Nickname"],
        ["ชื่อภาษาอังกฤษ", "English / romanized name"],
        ["วัน/เดือน/ปี เกิด", "Date of birth"],
        ["ชื่อ-นามสกุล ของบิดา", "Father's name"],
        ["ชื่อ-นามสกุล ของมารดา", "Mother's name"],
        ["อาชีพเดิม", "Former occupation"],
        ["เชื้อชาติ", "Ethnicity"],
        ["สัญชาติ", "Nationality"],
        ["สัณฐาน", "Build"],
        ["สีเนื้อ", "Complexion"],
        ["ตำหนิ", "Distinguishing marks"],
        ["ที่อยู่เดิม บ้านเลขที่/หมู่ที่", "Former address"],
        ["รหัสไปรษณีย์", "Postal code"],
        ["แขวง/ตำบล", "Subdistrict"],
        ["เขต/อำเภอ", "District"],
        ["จังหวัด (ที่อยู่เดิม)", "Province / state"]
      ]
    },
    {
      title: "ส่วนที่ 3 บรรพชาสามเณร / Novice ordination",
      fields: [
        ["วันบรรพชาสามเณร", "Novice ordination date"],
        ["บรรพชาสามเณร ณ วัด", "Novice ordination monastery"],
        ["ตำบล (บรรพชา)", "Subdistrict"],
        ["อำเภอ (บรรพชา)", "District"],
        ["จังหวัด (บรรพชา)", "Province"],
        ["ชื่อพระอุปัชฌาย์ (ตอนบรรพชา)", "Preceptor"],
        ["วัดพระอุปัชฌาย์ (บรรพชา)", "Preceptor's monastery"],
        ["ตำบลวัดพระอุปัชฌาย์", "Subdistrict"],
        ["อำเภอวัดพระอุปัชฌาย์", "District"],
        ["จังหวัดวัดพระอุปัชฌาย์", "Province"]
      ]
    },
    {
      title: "ส่วนที่ 3 อุปสมบท / Higher ordination",
      fields: [
        ["วันอุปสมบท (ซ้ำได้ถ้าต่างจากหัวรายการ)", "Ordination date — repeat if different from the header"],
        ["อุปสมบทเมื่ออายุ", "Age at ordination"],
        ["เวลาที่อุปสมบท", "Time of ordination"],
        ["วัดที่อุปสมบท", "Ordination monastery"],
        ["ตำบล (อุปสมบท)", "Subdistrict"],
        ["อำเภอ (อุปสมบท)", "District"],
        ["จังหวัด (อุปสมบท)", "Province"],
        ["พระอุปัชฌาย์", "Preceptor"],
        ["สังกัดวัดของพระอุปัชฌาย์", "Preceptor's monastery"],
        ["พระกรรมวาจาจารย์", "Kammavaca acariya"],
        ["วัดพระกรรมวาจาจารย์", "Kammavaca's monastery"],
        ["พระอนุสาวนาจารย์", "Anusavana acariya"],
        ["วัดพระอนุสาวนาจารย์", "Anusavana's monastery"]
      ]
    },
    {
      title: "ส่วนที่ 4 สถานภาพปัจจุบัน / Current residence",
      fields: [
        ["วัดที่พำนัก", "Residence monastery — if visiting to study or borrow for rains, fill here; home affiliation above does not change"],
        ["เบอร์ติดต่อวัดที่พำนัก", "Monastery phone"],
        ["เบอร์มือถือ", "Mobile"]
      ]
    },
    {
      title: "ส่วนที่ 6 วิทยฐานะสามัญ (สูงสุด) / Secular education",
      fields: [
        ["สูงสุด พ.ศ.", "Highest B.E. year — fill each level on the Secular sheet"],
        ["ระดับชั้นสูงสุด", "Highest level  e.g. M.6, bachelor"],
        ["สถานศึกษา", "School / university  e.g. MCU"],
        ["สาขาที่เรียน", "Major"]
      ]
    },
    {
      title: "ส่วนที่ 10 ตำแหน่งงานพิเศษ / Special appointments",
      fields: [
        ["ประเภทงานพิเศษ", "Type — Dhammaduta, preacher, vipassana, pariyatti, propagation graduate, or other"],
        ["วันที่ได้รับมอบหมาย", "Date assigned"],
        ["ชื่องาน", "Work title"],
        ["รายละเอียด", "Details"]
      ]
    },
    {
      title: "หนังสือสุทธิ · สังกัดเมื่อบวช / Affiliation at ordination",
      fields: [
        ["สังกัดวัดเมื่อบวช", "Monastery at ordination — change affiliation only when the sutthi book actually moves"],
        ["วันที่สังกัดเมื่อบวช", "Date"],
        ["ตำบล (สังกัดเมื่อบวช)", "Subdistrict"],
        ["อำเภอ (สังกัดเมื่อบวช)", "District"],
        ["จังหวัด (สังกัดเมื่อบวช)", "Province"]
      ]
    },
    {
      title: "หนังสือสุทธิ · รับเข้าสังกัด / Received into affiliation",
      fields: [
        ["มาอยู่วัดชื่อวัด", "Received at monastery"],
        ["วันที่รับเข้าสังกัด", "Date received"],
        ["ตำบล (รับเข้า)", "Subdistrict"],
        ["อำเภอ (รับเข้า)", "District"],
        ["จังหวัด (รับเข้า)", "Province"],
        ["หมายเหตุรับเข้าสังกัด", "Notes"]
      ]
    },
    {
      title: "หนังสือสุทธิ · ย้ายสังกัด (ถ้าย้ายจริง) / Change of affiliation",
      fields: [
        ["ย้ายจากวัด", "From monastery — going away for rains is not a change of affiliation; use the Rains sheet"],
        ["วันที่ย้าย", "Move date"],
        ["ไปอยู่วัด", "To monastery"],
        ["เหตุที่ย้าย", "Reason"],
        ["ตำบลวัดที่ไป", "Subdistrict"],
        ["อำเภอวัดที่ไป", "District"],
        ["จังหวัดวัดที่ไป", "Province"],
        ["รับเข้าสังกัดวัดชื่อ (ปลายทาง)", "Receiving monastery"],
        ["วันที่รับเข้าสังกัด (ปลายทาง)", "Date received"]
      ]
    },
    {
      title: "ผู้กรอก / Filled by",
      fields: [
        ["ผู้กรอก / ผู้ให้ข้อมูล", "Filled by"],
        ["วัด / วันที่", "Monastery / date"],
        ["ผู้รับแบบ", "Received by"]
      ]
    }
  ];
}

function rainRows() {
  const now = currentBe();
  const out = [];
  for (let y = now - 6; y <= now; y++) {
    out.push([String(y), "", "", "", "", "", "", "", ""]);
  }
  out.push(["", "", "", "", "", "", "", "", ""]);
  out.push(["", "", "", "", "", "", "", "", ""]);
  return out;
}

function dhammaRows() {
  return [
    ["นักธรรม ชั้น ตรี / 3rd", "", "", "", ""],
    ["นักธรรม ชั้น โท / 2nd", "", "", "", ""],
    ["นักธรรม ชั้น เอก / 1st", "", "", "", ""],
    ["ประโยค ป.ธ. ๑-๒", "", "", "", ""],
    ["ป.ธ.3", "", "", "", ""],
    ["ป.ธ.4", "", "", "", ""],
    ["ป.ธ.5", "", "", "", ""],
    ["ป.ธ.6", "", "", "", ""],
    ["ป.ธ.7", "", "", "", ""],
    ["ป.ธ.8", "", "", "", ""],
    ["ป.ธ.9", "", "", "", ""]
  ];
}

function secularRows() {
  return [
    ["ประถม / Primary", "", "", ""],
    ["มัธยมต้น / Lower secondary", "", "", ""],
    ["มัธยมปลาย / Upper secondary", "", "", ""],
    ["อนุปริญญา / Diploma", "", "", ""],
    ["ปริญญาตรี / Bachelor", "", "", ""],
    ["ปริญญาโท / Master", "", "", ""],
    ["ปริญญาเอก / Doctorate", "", "", ""],
    ["ปริญญากิตติมศักดิ์ / Honorary", "", "", ""],
    ["วุฒิอื่น / ป.บส. / ประกาศนียบัตร / Other certificates", "", "", ""]
  ];
}

function officeRows() {
  return [
    ["", "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""]
  ];
}

function helpRows() {
  return [
    ["วิธีใช้แบบกรอกประวัติพระภิกษุ", "How to use this monk record form"],
    ["", ""],
    ["1. กรอกในชีต กรอกประวัติ ที่คอลัมน์ กรอกที่นี่ แล้วบันทึกไฟล์", "1. Fill the Form sheet in the Fill here column, then save"],
    ["2. จำพรรษา กรอกทีละปี — ไปจำที่อื่นหรือมาเรียน ใส่ลักษณะปีนี้ ไม่ใช่ย้ายสังกัด", "2. Record rains year by year. Away-rains or visiting to study is not a change of affiliation"],
    ["3. นักธรรม-บาลี และ สามัญ กรอกเฉพาะชั้นที่มี", "3. Naktham/Pali and secular sheets — fill only completed levels"],
    ["4. ส่งไฟล์กลับมา แล้วกด โหลดจาก Excel เพื่อใส่เข้าฟอร์ม ตรวจแล้วค่อยบันทึก", "4. Return the file and use Load from Excel, then review and save"],
    ["", ""],
    ["อย่าลบแถวหัวข้อสีเขียว และอย่าเปลี่ยนชื่อชีต", "Do not delete green section rows or rename sheets"],
    ["ฉายา เป็นช่องที่ต้องมี", "Chaya is required"],
    ["คนไทยใส่เลขบัตรประชาชน 13 หลัก · ต่างชาติใส่เลขพาสปอร์ต", "Thais use national ID; foreigners use passport no."],
    ["วัดต้นสังกัด กับ วัดที่พำนัก คนละช่อง — มาเรียนหรือยืมจำพรรษาไม่ย้ายต้นสังกัด", "Home monastery and residence monastery are separate — visiting to study does not move affiliation"]
  ];
}

function helpSheet() {
  const rows = helpRows().map(function (row, i) {
    const st = i === 0 ? 2 : 0;
    return rowXml(i + 1, [cellXml(i + 1, 1, row[0], st), cellXml(i + 1, 2, row[1], st)]);
  });
  return sheetXml(rows, [72, 72], 0);
}

function buildFormBlankXlsx() {
  const names = ["กรอกประวัติ", "จำพรรษา", "นักธรรม-บาลี", "สามัญ", "ตำแหน่ง", "วิธีใช้"];
  const sheets = [
    formSheet(formSections()),
    tableSheet(
      ["พ.ศ. / B.E.", "วัดที่จำพรรษา / Rains monastery", "ตำบล / Subdistrict", "ตำบลคณะสงฆ์ / Sangha tambon", "อำเภอ / District", "จังหวัด / Province", "อายุ / Age", "พรรษา / Vassa", "ลักษณะปีนี้ / This year"],
      rainRows(),
      [10, 28, 16, 20, 16, 18, 8, 10, 36]
    ),
    tableSheet(
      ["ชั้น / Level", "พ.ศ. / B.E.", "วัด / สอบในนามวัด / Exam monastery", "สำนักเรียน / School", "จังหวัด / Province"],
      dhammaRows(),
      [22, 10, 28, 28, 16]
    ),
    tableSheet(
      ["ชั้น / Level", "พ.ศ. / B.E.", "วุฒิ / ชั้น / Qualification", "สถานศึกษา / Institution"],
      secularRows(),
      [28, 10, 22, 36]
    ),
    tableSheet(
      ["พ.ศ. / B.E.", "ตำแหน่ง / Office", "วันที่ได้รับ / Date", "วัด / ตำบล / เขต / Place", "อำเภอ / District", "จังหวัด / Province", "หมายเหตุ / Notes"],
      officeRows(),
      [10, 28, 16, 28, 16, 16, 24]
    ),
    helpSheet()
  ];
  const files = [
    { name: "[Content_Types].xml", data: contentTypes(names.length) },
    { name: "_rels/.rels", data: rootRels() },
    { name: "xl/workbook.xml", data: workbookXml(names) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels(names.length) },
    { name: "xl/styles.xml", data: stylesXml() }
  ];
  sheets.forEach(function (xml, i) {
    files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: xml });
  });
  return zipFiles(files);
}

module.exports = { buildFormBlankXlsx };
