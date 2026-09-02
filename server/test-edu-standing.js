const { standingOf, matchParianFilter } = require("./lib/edu");
const { matchRankFilter } = require("./lib/ranks");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

const ekP3 = standingOf({
  dhammaEkYear: "2560",
  pali3Year: "2561",
  pali4Year: "2562"
}, [], "");
eq(ekP3.label, "น.ธ.เอก ปธ.4", "highest pali not every passed grade");
eq(ekP3.paliRank, 4, "pali rank 4");
eq(ekP3.isParian, true, "p.3+ is parian");

const p12 = standingOf({ dhammaToSchool: "วัดทดสอบ", pali12Wat: "วัดทดสอบ" }, [], "");
eq(p12.label, "น.ธ.โท ปธ.1-2", "naktham to + pali 1-2");
eq(p12.isParian, false, "pali 1-2 is not parian");

const fromTitle = standingOf({}, [], "พระเปรียญธรรม ๙ ประโยค");
eq(fromTitle.paliRank, 9, "title highest grade");
eq(fromTitle.label, "ปธ.9", "title standing label");

const fromRain = standingOf({}, [{ naktham: "นักธรรมตรี", pali: "ป.ธ.๓" }], "");
eq(fromRain.label, "น.ธ.ตรี ปธ.3", "rains standing");
eq(fromRain.paliRank, 3, "rain pali 3");

const empty = standingOf({}, [], "");
eq(empty.label, "", "empty standing");
eq(empty.isParian, false, "empty is not parian");
eq(empty.remark, "", "empty remark");

eq(standingOf({ baYear: "2560", baGrade: "ปริญญาตรี", dhammaEkYear: "2553" }, [], "", "").remark, "ป.ตรี", "remark is highest worldly only");
eq(standingOf({}, [], "", "จ.ราชบุรี · สามัญ ป.ตรี · นธ.เอก ปี2553").remark, "ป.ตรี", "remark from note worldly only");
eq(standingOf({}, [], "", "จ.อยุธยา · สามัญ ม.๓ · นธ.โท ปี2553 · ป.ธ.1-2 ปี2567 วัดชัยฉิมพลี").paliRank, 0, "pali not taken from free-text note");
eq(standingOf({}, [], "", "จ.อยุธยา · สามัญ ม.๓ · นธ.โท ปี2553 · ป.ธ.1-2 ปี2567 วัดชัยฉิมพลี").label, "น.ธ.โท", "note may still fill naktham not pali");

eq(matchParianFilter({ paliRank: 5 }, "พระเปรียญธรรม"), true, "parian filter all");
eq(matchParianFilter({ paliRank: 2 }, "พระเปรียญธรรม"), false, "1-2 not parian filter");
eq(matchParianFilter({ paliRank: 5 }, "ป.ธ.5"), true, "exact grade 5");
eq(matchParianFilter({ paliRank: 5 }, "ป.ธ.3"), false, "highest is 5 not 3");
eq(matchParianFilter({ paliRank: 5 }, "พระราชาคณะ"), null, "not a parian filter");

eq(matchRankFilter({ paliRank: 6, rankKind: "" }, "พระเปรียญธรรม"), true, "rank filter parian");
eq(matchRankFilter({ paliRank: 6, rankKind: "" }, "ป.ธ.6"), true, "rank filter exact");
eq(matchRankFilter({ paliRank: 6, rankKind: "พระราชาคณะ" }, "พระราชาคณะ"), true, "samanasak still works");

eq(standingOf({ paliLevel: "ป.ธ. ๓" }, [], "").paliRank, 3, "paliLevel thai digit 3");
eq(standingOf({ paliLevel: "ป.ธ. ๔" }, [], "").paliRank, 4, "paliLevel thai digit 4");
eq(standingOf({ paliLevel: "ป.ธ. ๓" }, [], "").isParian, true, "paliLevel 3 is parian");
eq(matchRankFilter({ paliRank: 3, isParian: true }, "พระเปรียญธรรม"), true, "filter parian from paliLevel");

const { classifyRanks } = require("./lib/ranks");
const fromCourse = classifyRanks({ rank_kind: "", bio: {} }, [{ kind: "ธรรมทูต", yearText: "2559" }]);
eq(fromCourse.isDhammaduta, true, "course marks dhammaduta");
eq(matchRankFilter(fromCourse, "ธรรมทูต"), true, "filter dhammaduta from course");

console.log("ok");
