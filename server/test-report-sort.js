const { compareReportRows, officeRankFromText, sectionRank, isAbbot } = require("./lib/reportSort");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(officeRankFromText("เจ้าอาวาส"), 0, "abbot");
eq(officeRankFromText("รองเจ้าอาวาส"), 2, "deputy");
eq(isAbbot({ watPosition: "เจ้าอาวาสวัดราษฎร์" }), true, "abbot exempt");
eq(isAbbot({ watPosition: "รองเจ้าอาวาส" }), false, "deputy not abbot");
eq(isAbbot({
  watPosHistory: [{ position: "เจ้าอาวาส", watName: "วัดป่า" }]
}), true, "abbot of any wat");
eq(isAbbot({ watPosition: "ผู้ช่วยเจ้าอาวาส" }), false, "assistant not abbot");
eq(sectionRank({ personType: "ภิกษุ" }), 1, "monk section");
eq(sectionRank({ personType: "สามเณร" }), 2, "novice section");
eq(sectionRank({ away: true, personType: "ภิกษุ" }), 3, "away section");

eq(
  compareReportRows(
    { personType: "ภิกษุ", watPosition: "เจ้าอาวาส", displayName: "ข", vassa: 1, monkId: 1 },
    { personType: "ภิกษุ", displayName: "ก", vassa: 20, monkId: 2 },
    "วัดอินทาราม"
  ) < 0,
  true,
  "abbot before high vassa"
);
eq(
  compareReportRows(
    { personType: "ภิกษุ", displayName: "ก", vassa: 10, monkId: 1 },
    { personType: "ภิกษุ", displayName: "ข", vassa: 5, monkId: 2 },
    "วัดอินทาราม"
  ) < 0,
  true,
  "higher vassa first"
);
eq(
  compareReportRows(
    { personType: "ภิกษุ", displayName: "ก", vassa: 5, monkId: 1 },
    { personType: "สามเณร", displayName: "ก", monkId: 2 },
    "วัดอินทาราม"
  ) < 0,
  true,
  "monk before novice"
);
eq(
  compareReportRows(
    { away: true, personType: "ภิกษุ", displayName: "ก", vassa: 30, monkId: 1 },
    { personType: "สามเณร", displayName: "ข", monkId: 2 },
    "วัดอินทาราม"
  ) > 0,
  true,
  "away after novice"
);

console.log("ok report sort");
