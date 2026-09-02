const { countVassa, firstVassaBe, toParts, vassaFor, personTypeAt } = require("./lib/vassa");

function p(iso) { return toParts(iso); }

const cases = [
  ["บวช ก.ค. 2568 ยังไม่เข้าเดือน 8 → 0", p("2025-07-01"), p("2025-07-15"), 0],
  ["บวช ก.ค. 2568 เข้าเดือน 8 ปีแรก → 1", p("2025-07-01"), p("2025-08-15"), 1],
  ["บวช ส.ค. 2568 (เดือน 8) ปีแรก → 1", p("2025-08-15"), p("2025-08-15"), 1],
  ["บวช ก.ย. 2568 (หลังเดือน 8) ปีนั้นไม่นับ → 0", p("2025-09-01"), p("2025-11-15"), 0],
  ["บวช ก.ย. 2568 เข้าเดือน 8 ปี 2569 → 1", p("2025-09-01"), p("2026-08-15"), 1],
  ["บวช ก.ค. 2568 ก.ค. 2569 ยังไม่เข้าเดือน 8 ปีนี้ → 1", p("2025-07-01"), p("2026-07-15"), 1],
  ["บวช ก.ค. 2568 ส.ค. 2569 → 2", p("2025-07-01"), p("2026-08-15"), 2],
  ["บวช มี.ค. 2567 ก.ค. 2569 ปีกลางนับได้ ปีนี้ยังไม่เดือน 8 → 2", p("2024-03-01"), p("2026-07-15"), 2],
  ["บวช มี.ค. 2567 ส.ค. 2569 → 3", p("2024-03-01"), p("2026-08-15"), 3],
  ["สามเณรไม่มีพรรษา", null, null, "novice"],
  ["บวช เม.ย. 2552 ถึง ส.ค. 2568 → 17", p("2009-04-06"), p("2025-08-01"), 17],
  ["บวช เม.ย. 2552 ถึง ส.ค. 2569 (ปีปัจจุบัน) → 18", p("2009-04-06"), p("2026-08-31"), 18]
];

let fail = 0;
for (const c of cases) {
  if (c[3] === "novice") {
    const got = vassaFor({ person_type: "สามเณร" }, [], 2568);
    const ok = got == null;
    console.log(ok ? "OK" : "FAIL", c[0], "got", got);
    if (!ok) fail++;
    continue;
  }
  const got = countVassa(c[1], c[2]);
  const ok = got === c[3];
  console.log(ok ? "OK" : "FAIL", c[0], "got", got, "want", c[3], "first", firstVassaBe(c[1]));
  if (!ok) fail++;
}

const monk = { ordained_on: "2009-04-06" };
eqYear(vassaFor(monk, [], 2568), 17, "รายชื่อปี 2568 ใช้พรรษา ณ ส.ค. 2568");
eqYear(vassaFor(monk, [], 2569), 18, "รายชื่อปี 2569 ใช้พรรษา ณ ส.ค. 2569 = ปีก่อน + 1");

const laterMonk = {
  person_type: "ภิกษุ",
  ordained_on: "2026-01-11",
  bio: { ordainedOnText: "11 มกราคม 2569", noviceOn: "22 พฤศจิกายน 2563" }
};
eqYear(personTypeAt(laterMonk, 2568), "สามเณร", "บวชพระ ม.ค. 2569 → ปี 2568 ยังเป็นเณร");
eqYear(personTypeAt(laterMonk, 2569), "ภิกษุ", "ปี 2569 หลังอุปสมบทเป็นภิกษุ");
eqYear(vassaFor(laterMonk, [], 2568), null, "ปีที่เป็นเณรไม่มีพรรษา");
eqYear(vassaFor(laterMonk, [], 2569), 1, "บวช ม.ค. 2569 เข้าเดือน 8 ปี 2569 พรรษา 1");
function eqYear(got, want, label) {
  const ok = got === want;
  console.log(ok ? "OK" : "FAIL", label, "got", got, "want", want);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
