const {
  applyCallingName, classifyRanks, PLAIN_NAME_KIND, isSanghaRankKind, normalizeRankKind
} = require("./lib/ranks");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(isSanghaRankKind("พระครูสัญญาบัตร"), true, "titled kind");
eq(isSanghaRankKind(PLAIN_NAME_KIND), false, "plain kind is not samanassak");
eq(normalizeRankKind(PLAIN_NAME_KIND), PLAIN_NAME_KIND, "keep plain kind");
eq(normalizeRankKind("อื่น"), "", "drop unknown kind");

let bio = { royalName: "พระสมชาย", royalHistory: [{ royalName: "พระสมชาย" }] };
applyCallingName(bio, "พระสมชาย", PLAIN_NAME_KIND);
eq(bio.royalName, "", "ordinary name is not royalName");
eq(bio.royalHistory.length, 0, "name-only history dropped for ordinary monk");

bio = { royalName: "", royalHistory: [] };
applyCallingName(bio, "พระครูสมุห์", "พระครูฐานานุกรม");
eq(bio.royalName, "พระครูสมุห์", "titled name stored as royalName");

bio = {
  royalName: "พระสมชาย",
  royalHistory: [{ royalName: "พระครูสมุห์", yearText: "2560", royalClass: "พระครูสัญญาบัตร เจ้าคณะตำบล ชั้นเอก (จต.ชอ.)" }]
};
applyCallingName(bio, "พระสมชาย", PLAIN_NAME_KIND);
eq(bio.royalName, "พระครูสมุห์", "section 7 history still supplies royalName");
eq(bio.royalHistory.length, 1, "dated history kept");

const plain = classifyRanks({ rank_kind: PLAIN_NAME_KIND, sangha_name: "พระครูทดสอบ" }, []);
eq(plain.rankKind, "", "plain type does not infer rank from the name");

const titled = classifyRanks({ rank_kind: "พระราชาคณะ", sangha_name: "พระธรรมวชิร" }, []);
eq(titled.rankKind, "พระราชาคณะ", "explicit titled type kept");

console.log("ok");
