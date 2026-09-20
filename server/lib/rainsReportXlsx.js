const { zipFiles } = require("./xlsxZip");

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
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

function cellXml(r, c, text, style, asNumber) {
  const ref = colLetter(c) + r;
  const s = style ? ' s="' + style + '"' : "";
  if (asNumber) {
    const n = Number(text);
    if (Number.isFinite(n) && String(text).trim() !== "") {
      return '<c r="' + ref + '"' + s + ' t="n"><v>' + n + "</v></c>";
    }
  }
  const t = esc(text);
  if (t === "") return '<c r="' + ref + '"' + s + "/>";
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + t + "</t></is></c>";
}

function rowXml(r, cells) {
  return '<row r="' + r + '">' + cells.join("") + "</row>";
}

function colsXml(widths) {
  return "<cols>" + widths.map(function (w, i) {
    return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
  }).join("") + "</cols>";
}

function sheetXml(rowsXml, widths, freezeRow, merges) {
  const freeze = freezeRow
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + freezeRow +
      '" topLeftCell="A' + (freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";
  const mergeXml = merges && merges.length
    ? '<mergeCells count="' + merges.length + '">' +
      merges.map(function (ref) { return '<mergeCell ref="' + ref + '"/>'; }).join("") +
      "</mergeCells>"
    : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    freeze + colsXml(widths) + "<sheetData>" + rowsXml.join("") + "</sheetData>" + mergeXml + "</worksheet>";
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
    '<font><sz val="12"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="16"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FF94A3B8"/></left>' +
    '<right style="thin"><color rgb="FF94A3B8"/></right>' +
    '<top style="thin"><color rgb="FF94A3B8"/></top>' +
    '<bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf xfId="0"/>' +
    '<xf xfId="0" fontId="1" applyFont="1"><alignment horizontal="center" wrapText="1"/></xf>' +
    '<xf xfId="0" fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" horizontal="center" vertical="center"/></xf>' +
    '<xf xfId="0" borderId="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf>' +
    '</cellXfs>' +
    '</styleSheet>';
}

function workbookXml(name) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets><sheet name=\"" + esc(name) + "\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";
}

function workbookRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";
}

function contentTypes() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";
}

function rootRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";
}

const HEADERS = [
  "เลขที่", "ชื่อ", "ฉายา", "นามสกุล", "อายุ", "พรรษา", "เกิด พ.ศ.", "เกิดที่จังหวัด",
  "ความรู้สามัญ", "วัด", "ตำบล", "นธ.", "นธ.พ.ศ.", "นธ.สำนักเรียน", "นธ.จังหวัด",
  "ป.ธ.", "ป.ธ.พ.ศ.", "ป.ธ.สำนักเรียน", "ป.ธ.จังหวัด", "หมายเหตุ"
];

const WIDTHS = [8, 22, 22, 14, 8, 8, 10, 14, 14, 16, 12, 8, 10, 18, 12, 8, 10, 18, 12, 12];
const LAST_COL = colLetter(HEADERS.length);

function dash(v) {
  const s = String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
  return s === "-" ? "" : s;
}

function formCells(r, f) {
  const row = f || {};
  const vals = [
    r - 5,
    dash(row.name),
    dash(row.chaya),
    dash(row.surname),
    row.age,
    row.vassa,
    dash(row.birthYearBe),
    dash(row.birthProvince),
    dash(row.secular),
    dash(row.wat),
    dash(row.tambon),
    dash(row.naktham),
    dash(row.nakthamYear),
    dash(row.nakthamSchool),
    dash(row.nakthamProvince),
    dash(row.pali),
    dash(row.paliYear),
    dash(row.paliSchool),
    dash(row.paliProvince),
    dash(row.remark)
  ];
  return vals.map(function (v, i) {
    const num = i === 0 || i === 4 || i === 5 || i === 6 || i === 12 || i === 16;
    return cellXml(r, i + 1, v, 3, num);
  });
}

function sheetNameOf(yearBe) {
  const y = String(yearBe || "").replace(/[\\/?*\[\]:]/g, "");
  const name = y ? "จำพรรษา " + y : "จำพรรษา";
  return name.slice(0, 31);
}

function buildRainsReportXlsx(opt) {
  const o = opt || {};
  const header = o.header || {};
  const list = o.rows || [];
  const monks = o.monks != null ? o.monks : list.length;
  const novices = o.novices != null ? o.novices : 0;
  const yearBe = o.yearBe || "";
  const rows = [
    rowXml(1, [cellXml(1, 1, header.line1 || "บัญชีรายชื่อพระภิกษุ-สามเณร อยู่จำพรรษา", 1)]),
    rowXml(2, [cellXml(2, 1, header.line2 || "", 1)]),
    rowXml(3, [cellXml(3, 1, header.line3 || "", 1)]),
    rowXml(4, [cellXml(4, 1, "", 0)]),
    rowXml(5, HEADERS.map(function (h, i) { return cellXml(5, i + 1, h, 2); }))
  ];
  list.forEach(function (f, i) {
    rows.push(rowXml(6 + i, formCells(6 + i, f)));
  });
  const foot = 6 + list.length;
  rows.push(rowXml(foot, [
    cellXml(foot, 1, "รวมภิกษุ " + monks + " รูป · สามเณร " + novices + " รูป · รวม " + list.length + " รูป", 1)
  ]));
  const merges = [
    "A1:" + LAST_COL + "1",
    "A2:" + LAST_COL + "2",
    "A3:" + LAST_COL + "3",
    "A" + foot + ":" + LAST_COL + foot
  ];
  const sheet = sheetXml(rows, WIDTHS, 5, merges);
  return zipFiles([
    { name: "[Content_Types].xml", data: contentTypes() },
    { name: "_rels/.rels", data: rootRels() },
    { name: "xl/workbook.xml", data: workbookXml(sheetNameOf(yearBe)) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels() },
    { name: "xl/styles.xml", data: stylesXml() },
    { name: "xl/worksheets/sheet1.xml", data: sheet }
  ]);
}

module.exports = { buildRainsReportXlsx, HEADERS };
