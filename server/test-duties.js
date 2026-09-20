const { parseKind, parseAttend, parseExempt, watOf, yearBeOfIso, isAwayDutyKind, isAwayForDuty,
  monthMeta, countedLastDay, pct, sessionKind, tallyMonkMonth } = require("./lib/duties");
const fs = require("fs");
const path = require("path");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(parseKind("event"), "event", "event");
eq(parseKind("daily"), "daily", "daily");
eq(parseAttend("ตรงเวลา"), "ตรงเวลา", "on time");
eq(parseAttend("สาย"), "สาย", "late");
eq(parseAttend("ขาด"), "ขาด", "absent");
eq(parseAttend("ลา"), "ลา", "leave");
eq(parseAttend("อื่น"), "", "reject attend");
eq(parseExempt(true), true, "exempt true");
eq(parseExempt("ยกเว้น"), true, "exempt label");
eq(parseExempt(false), false, "not exempt");
eq(yearBeOfIso("2026-09-20"), 2569, "duty year BE");
eq(isAwayDutyKind("ไปจำพรรษาที่อื่น"), true, "away kind");
eq(isAwayForDuty("วัดอินทาราม", "วัดอินทาราม", "วัดป่า", ""), true, "home monk rains elsewhere");
eq(isAwayForDuty("วัดอินทาราม", "วัดอินทาราม", "วัดอินทาราม", ""), false, "home rains here");
eq(isAwayForDuty("วัดอินทาราม", "วัดอินทาราม", "", "ไปจำพรรษาที่อื่น"), true, "away even if wat pending");
eq(isAwayForDuty("วัดอินทาราม", "วัดลำนารายณ์", "วัดอินทาราม", ""), false, "visitor here is not exempt");
eq(watOf({ accessLevel: "wat", watName: "วัดอินทาราม" }, "วัดอื่น"), "วัดอินทาราม", "wat locked");
eq(watOf({ accessLevel: "admin", embedLocked: true, watName: "วัดอินทาราม" }, "วัดป่า"), "วัดอินทาราม", "embed locked");

const src = fs.readFileSync(path.join(__dirname, "lib", "duties.js"), "utf8");
eq(src.indexOf("NOT IN ('ย้ายวัด', 'มรณภาพ', 'ลาสิกขา')") >= 0, true, "hides moved dead disrobed");
eq(src.indexOf("m.wat_name=$1 OR COALESCE(y.wat_name,'')=$1") >= 0, true, "includes rains visitors");
eq(src.indexOf("INNER JOIN monk_rains") >= 0, true, "duty list matches rains year");
eq(src.indexOf("displayNameAt") >= 0, true, "duty names match monk list");
eq(src.indexOf("ไปจำพรรษาที่อื่น") >= 0, true, "marks away rains");
eq(src.indexOf("isAbbot") >= 0, true, "abbots default exempt");
eq(src.indexOf("!row.morning && !row.evening && !row.exempt") < 0, true, "keeps unchecked exempt");
eq(src.indexOf("async function listMonth") >= 0, true, "monthly duty report");

eq(sessionKind("ตรงเวลา", false), "present", "on time present");
eq(sessionKind("สาย", false), "present", "late still present");
eq(sessionKind("ขาด", false), "miss", "absent is miss");
eq(sessionKind("", false), "miss", "empty past day is miss");
eq(sessionKind("ลา", false), "leave", "leave not miss");
eq(sessionKind("ขาด", true), "exempt", "exempt skips miss");
eq(pct(2, 30), 6.7, "miss percent one decimal");
eq(pct(0, 0), null, "no duty days no percent");

const sep = monthMeta(2569, 9);
eq(sep.start, "2026-09-01", "month start CE");
eq(sep.end, "2026-09-30", "month end CE");
eq(sep.monthName, "กันยายน", "thai month name");
eq(countedLastDay(sep, "2026-09-20"), 20, "current month cuts at asOf");
eq(countedLastDay(sep, "2026-10-01"), 30, "past month counts all days");
eq(countedLastDay(sep, "2026-08-31"), 0, "future month counts none");

const t = tallyMonkMonth(
  ["2026-09-01", "2026-09-02", "2026-09-03"],
  {
    "2026-09-01": { morning: "ตรงเวลา", evening: "ขาด", exempt: false },
    "2026-09-02": { morning: "ลา", evening: "ตรงเวลา", exempt: false }
  },
  false
);
eq(t.morning.miss, 1, "empty morning is miss");
eq(t.morning.leave, 1, "leave not miss morning");
eq(t.morning.duty, 2, "leave out of morning duty");
eq(t.morning.pctMiss, 50, "morning miss percent");
eq(t.evening.miss, 2, "absent plus empty evening");
eq(t.evening.duty, 3, "evening duty all three");

const abbot = tallyMonkMonth(
  ["2026-09-01", "2026-09-02"],
  { "2026-09-01": { morning: "ขาด", evening: "ขาด", exempt: false } },
  true
);
eq(abbot.morning.exempt, 1, "unsaved abbot day exempt");
eq(abbot.morning.miss, 1, "abbot unchecked day can miss");
eq(abbot.morning.duty, 1, "only non-exempt abbot days count");

console.log("ok duties");
