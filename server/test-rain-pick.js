const { pickRain, canCarryStatus, carrySourceSql, isPendingRainKind, RAIN_KIND_PENDING } = require("./lib/rainPick");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

const rains = [
  { year_be: 2568, wat_name: "วัดอินทาราม" },
  { year_be: 2566, wat_name: "วัดเก่า" }
];

eq(pickRain(rains, 2568, "จำพรรษา").wat_name, "วัดอินทาราม", "exact year 2568");
eq(pickRain(rains, 2569, "จำพรรษา").year_be, 2568, "carry 2568 into 2569");
eq(pickRain(rains, 2569, "จำพรรษา").wat_name, "วัดอินทาราม", "carry keeps last wat");
eq(pickRain(rains, 2569, "มรณภาพ"), null, "do not carry if passed away");
eq(pickRain(rains, 2569, "ลาสิกขา"), null, "do not carry if disrobed");
eq(pickRain(rains, 2569, "ย้ายวัด"), null, "do not carry if moved");
eq(pickRain([{ year_be: 2569, wat_name: "วัดใหม่" }, ...rains], 2569, "จำพรรษา").wat_name, "วัดใหม่", "prefer exact 2569");
eq(pickRain(rains, 2567, "จำพรรษา").year_be, 2566, "carry older year if still resident");
eq(pickRain([{ year_be: 2568, wat_name: "วัดอินทาราม" }], 2568, "มรณภาพ").year_be, 2568, "exact year still shows even if died");

eq(canCarryStatus("จำพรรษา"), true, "resident can carry");
eq(canCarryStatus(""), true, "blank status carries as resident");
eq(canCarryStatus("ย้ายวัด"), false, "moved does not carry");
eq(canCarryStatus("มรณภาพ"), false, "death does not carry");

const { fromWhere } = carrySourceSql("phra_wats");
if (!fromWhere.includes("$2::int <> $1")) {
  console.error("FAIL carry SQL must allow both forward and backfill");
  process.exit(1);
}
if (!fromWhere.includes("ยังไม่มา")) {
  console.error("FAIL carry SQL must skip pending rains");
  process.exit(1);
}
if (!isPendingRainKind("ยังไม่มา") || RAIN_KIND_PENDING !== "ยังไม่มา") {
  console.error("FAIL pending rain kind");
  process.exit(1);
}
if (isPendingRainKind("ไปจำพรรษาที่อื่น")) {
  console.error("FAIL away is not pending");
  process.exit(1);
}

console.log("ok rain carry-forward");
