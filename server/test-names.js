const { displayName, displayNameAt } = require("./lib/names");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(
  displayName({
    bio: { royalName: "พระครูสมุห์" },
    chaya_pali: "กัลยาโณ",
    chaya: "กัลยาโณ",
    title: "พระเปรียญธรรม ๙ ประโยค",
    former_name: "สมชาย",
    former_surname: "ใจดี"
  }),
  "พระครูสมุห์ กัลยาโณ (สมชาย ใจดี)",
  "rank + chaya + civil"
);

eq(
  displayName({
    title: "พระเปรียญธรรม ๙ ประโยค",
    chaya: "กัลยาโณ",
    chaya_pali: "กัลยาโณ",
    former_name: "สมชาย"
  }),
  "กัลยาโณ (สมชาย)",
  "no rank name — do not use class/title"
);

eq(
  displayName({
    chaya: "พระมหา ปัญโญ",
    chaya_pali: "ปัญโญ",
    former_name: "แดง",
    former_surname: "ดี"
  }),
  "พระมหา ปัญโญ (แดง ดี)",
  "legacy combined name without samanassak"
);

eq(
  displayName({
    sangha_name: "พระครูปลัด",
    chaya_pali: "พระครูปลัด สุมโน",
    former_name: "ดำ"
  }),
  "พระครูปลัด สุมโน (ดำ)",
  "do not duplicate rank in chaya"
);

eq(
  displayName({
    sangha_name: "พระสมชาย",
    chaya_pali: "กัลยาโณ",
    former_name: "John",
    former_surname: "Smith",
    bio: { englishName: "Phra Somchai" }
  }),
  "พระสมชาย กัลยาโณ (John Smith)",
  "ordinary monk name is calling name not samanassak"
);

eq(
  displayNameAt({
    person_type: "ภิกษุ",
    chaya: "อคฺคธมฺโม",
    chaya_pali: "อคฺคธมฺโม",
    former_name: "ชัยธวัช",
    former_surname: "วนาจิตภาวนา",
    sangha_name: "พระชัยธวัช"
  }, "สามเณร"),
  "สามเณรชัยธวัช วนาจิตภาวนา (ชัยธวัช วนาจิตภาวนา)",
  "novice uses surname in place of chaya"
);

eq(
  displayNameAt({
    chaya: "สว่างจิตร",
    chaya_pali: "",
    former_name: "ปุญญพัฒน์",
    former_surname: "สว่างจิตร"
  }, "สามเณร"),
  "สามเณรปุญญพัฒน์ สว่างจิตร (ปุญญพัฒน์ สว่างจิตร)",
  "novice given name then surname"
);

console.log("ok");
