const { destWat, lastAffiliation, affHomeWat, sameWatName, homeRainPlace, statusFromLastAffiliation, movedStatusLabel } = require("./lib/affStatus");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(destWat({ wat_name: "วัดเอ", to_wat_name: "วัดบี" }), "วัดบี", "dest prefers to_wat");
eq(destWat({ watName: "วัดเอ" }), "วัดเอ", "dest watName");

const aff = [
  { kind: "สังกัดเมื่อบวช", wat_name: "วัดอินทาราม" },
  { kind: "รับเข้าสังกัด", wat_name: "วัดอินทาราม" },
  { kind: "ย้ายสังกัด", wat_name: "วัดอินทาราม", to_wat_name: "วัดป่า" }
];
eq(lastAffiliation(aff).kind, "ย้ายสังกัด", "last is move");
eq(statusFromLastAffiliation(aff, "จำพรรษา").status, "ย้ายวัด", "last move → ย้ายวัด");
eq(statusFromLastAffiliation(aff, "จำพรรษา").movedToWat, "วัดป่า", "dest temple");
eq(statusFromLastAffiliation(aff, "มรณภาพ").status, "มรณภาพ", "death not overwritten");
eq(statusFromLastAffiliation(aff, "จำพรรษา", "", "วัดอินทาราม").status, "ย้ายวัด", "left current home");
eq(statusFromLastAffiliation(aff, "ย้ายวัด", "วัดป่า", "วัดป่า").status, "จำพรรษา", "arrived at current home");
eq(statusFromLastAffiliation(aff, "ย้ายวัด", "วัดป่า", "วัดป่า").movedToWat, "", "arrived clears movedTo");

const arrivedHome = [
  { kind: "สังกัดเมื่อบวช", wat_name: "วัดสามวิหาร" },
  { kind: "ย้ายสังกัด", wat_name: "วัดอินทาราม", to_wat_name: "วัดอินทาราม" }
];
eq(statusFromLastAffiliation(arrivedHome, "ย้ายวัด", "วัดอินทาราม", "วัดอินทาราม").status, "จำพรรษา", "move in to current wat is resident");
eq(movedStatusLabel("ย้ายวัด", "วัดป่า"), "ย้ายวัด · วัดป่า", "label");

const back = [
  { kind: "สังกัดเมื่อบวช", wat_name: "วัดอินทาราม" },
  { kind: "ย้ายสังกัด", to_wat_name: "วัดป่า" },
  { kind: "รับเข้าสังกัด", wat_name: "วัดป่า" }
];
eq(lastAffiliation(back).kind, "รับเข้าสังกัด", "last receive stays last");
eq(statusFromLastAffiliation(back, "จำพรรษา").status, "จำพรรษา", "last receive keeps resident");

const neverMoved = [{ kind: "สังกัดเมื่อบวช", wat_name: "วัดเจดีย์แดง" }];
eq(affHomeWat(neverMoved, "วัดอินทาราม"), "วัดเจดีย์แดง", "never moved keeps ordination wat");
eq(affHomeWat([], "วัดอินทาราม"), "วัดอินทาราม", "fallback if no sutthi");
eq(affHomeWat(aff, "วัดอินทาราม"), "วัดป่า", "moved uses destination");

eq(sameWatName("วัดลำนารายณ์", "ลำนารายณ์"), true, "same wat ignores prefix");
const home = homeRainPlace(neverMoved, { wat_name: "วัดอินทาราม", tambon: "ท่าวาสุกรี" });
eq(home.wat_name, "วัดเจดีย์แดง", "return-home uses sutthi not current listing");
eq(home.tambon, "", "do not copy listing tambon onto other home wat");

console.log("ok");
