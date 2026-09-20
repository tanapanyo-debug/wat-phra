const {
  headerLines, splitNameChaya, parseNote, remarkOf, formRow, toThaiNum, detectLevel
} = require("./lib/rainsReport");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(toThaiNum("2568"), "๒๕๖๘", "year to thai digits");

const district = headerLines({
  yearBe: 2568,
  level: "district",
  district: "พระนครศรีอยุธยา",
  province: "พระนครศรีอยุธยา"
});
eq(district.line1, "บัญชีรายชื่อพระภิกษุ-สามเณร อยู่จำพรรษา", "district title");
eq(district.line2, "อำเภอพระนครศรีอยุธยา จังหวัดพระนครศรีอยุธยา ภาค ๒", "district place");
eq(district.line3, "ประจำปี พุทธศักราช ๒๕๖๘", "district year");
eq(district.levelLabel, "ระดับอำเภอ", "district label");

const wat = headerLines({
  yearBe: 2568,
  level: "wat",
  watName: "พนัญเชิงวรวิหาร",
  tambon: "กะมัง",
  district: "พระนครศรีอยุธยา",
  province: "พระนครศรีอยุธยา"
});
eq(wat.line1, district.line1, "wat uses same title");
eq(wat.line2, "วัดพนัญเชิงวรวิหาร ตำบลกะมัง อำเภอพระนครศรีอยุธยา จังหวัดพระนครศรีอยุธยา", "wat place");
eq(wat.line3, district.line3, "wat uses same year line");
eq(wat.levelLabel, "ระดับวัด", "wat label");

const tambon = headerLines({
  yearBe: 2568,
  level: "tambon",
  sanghaTambon: "กะมัง",
  district: "พระนครศรีอยุธยา",
  province: "พระนครศรีอยุธยา"
});
eq(tambon.line1, district.line1, "tambon uses same title");
eq(tambon.line2, "ตำบลคณะสงฆ์กะมัง อำเภอพระนครศรีอยุธยา จังหวัดพระนครศรีอยุธยา ภาค ๒", "tambon place");

eq(detectLevel({ watName: "วัดป่า" }), "wat", "filter wat → wat level");
eq(detectLevel({ sanghaTambon: "กะมัง" }), "tambon", "filter tambon → tambon level");
eq(detectLevel({}), "district", "no filter → district");
eq(detectLevel({ accessLevel: "wat", watName: "" }), "wat", "wat user stays wat level");

const names = splitNameChaya({ chaya: "พระธรรมรัตนมงคล กตสาโร" });
eq(names.name, "พระธรรมรัตนมงคล", "split given name");
eq(names.chaya, "กตสาโร", "split chaya");

const royal = splitNameChaya({
  bio: { royalName: "พระธรรมรัตนมงคล" },
  chaya_pali: "กตสาโร",
  chaya: "พระธรรมรัตนมงคล กตสาโร"
});
eq(royal.name, "พระธรรมรัตนมงคล", "royal name column");
eq(royal.chaya, "กตสาโร", "royal chaya column");

const novice = splitNameChaya({
  personType: "สามเณร",
  former_name: "ปุญญพัฒน์",
  former_surname: "สว่างจิตร",
  chaya: "สว่างจิตร"
});
eq(novice.name, "สามเณรปุญญพัฒน์", "novice name is given name");
eq(novice.chaya, "สว่างจิตร", "novice chaya column is surname");

const note = parseNote("เกิด พ.ศ.2487 · จ.อยุธยา · สามัญ ประถม ๖ · นธ.เอก ปี2509 ป้อมแก้ว อยุธยา · ป.ธ.3 ปี2527 พนัญเชิงฯ อยุธยา · จล.");
eq(note.birthYearBe, "2487", "note birth year");
eq(note.birthProvince, "อยุธยา", "note birth province");
eq(note.secular, "ประถม ๖", "note secular");
eq(note.naktham, "เอก", "note naktham");
eq(note.nakthamYear, "2509", "note naktham year");
eq(note.pali, "3", "note pali");

eq(remarkOf("เจ้าอาวาส", "", ""), "จร.", "abbot remark");
eq(remarkOf("", "จล.", ""), "จล.", "code from note");
eq(remarkOf("ผู้ช่วยเจ้าอาวาส", "", ""), "ผจร.", "assistant remark");
eq(remarkOf("", "มาเรียนหนังสือที่ มจร.", ""), "", "MCU abbreviation is not abbot");
eq(remarkOf("", "จร.วัดอินทาราม", ""), "จร.", "abbot code in note still counts");

const form = formRow({
  chaya: "พระธรรมรัตนมงคล กตสาโร",
  former_surname: "ทรัพย์บุญ",
  title: "เจ้าอาวาส",
  wat_name: "วัดพนัญเชิงวรวิหาร",
  tambon: "กะมัง",
  age: 81,
  vassa: 61,
  personType: "ภิกษุ",
  note: "เกิด พ.ศ.2487 · จ.อยุธยา · สามัญ ประถม ๖ · นธ.เอก ปี2509 ป้อมแก้ว อยุธยา · จล."
}, {}, { nakthamRank: 3 });
eq(form.name, "พระธรรมรัตนมงคล", "form name");
eq(form.chaya, "กตสาโร", "form chaya");
eq(form.surname, "ทรัพย์บุญ", "form surname");
eq(form.wat, "พนัญเชิงวรวิหาร", "form wat without prefix");
eq(form.naktham, "เอก", "form naktham short");
eq(form.remark, "จล.", "form remark prefers note code");

const { buildRainsReportXlsx, HEADERS } = require("./lib/rainsReportXlsx");
const { readWorkbook } = require("./lib/xlsxRead");
const xlsx = buildRainsReportXlsx({
  header: { line1: district.line1, line2: wat.line2, line3: district.line3 },
  yearBe: 2568,
  monks: 1,
  novices: 0,
  rows: [form]
});
eq(xlsx.slice(0, 2).toString("utf8"), "PK", "xlsx is a zip");
const sheets = readWorkbook(xlsx);
const rainSheet = sheets["จำพรรษา 2568"];
if (!rainSheet || !rainSheet.length) {
  console.error("FAIL rains xlsx sheet missing", Object.keys(sheets));
  process.exit(1);
}
eq(rainSheet[0][0], district.line1, "xlsx title");
eq(rainSheet[1][0], wat.line2, "xlsx place");
eq(rainSheet[4][1], "ชื่อ", "xlsx name header");
eq(rainSheet[4].length, HEADERS.length, "xlsx column count");
eq(String(rainSheet[5][0]), "1", "xlsx row number");
eq(rainSheet[5][1], form.name, "xlsx monk name");
eq(rainSheet[5][2], form.chaya, "xlsx monk chaya");
eq(String(rainSheet[5][4]), "81", "xlsx age as number");

console.log("ok rains report headers");
