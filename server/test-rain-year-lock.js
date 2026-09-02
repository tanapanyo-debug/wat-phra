const {
  scopeFromFilters,
  lockCoversPlace,
  placeClosedByLocks,
  scopeLabel
} = require("./lib/rainYearLock");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(scopeFromFilters({ accessLevel: "wat", watName: "วัดอินทาราม" }, "", "").scope, "wat", "wat user scope");
eq(scopeFromFilters({ accessLevel: "wat", watName: "วัดอินทาราม" }, "", "").scopeKey, "วัดอินทาราม", "wat user key");
eq(scopeFromFilters({ accessLevel: "admin" }, "วัดอินทาราม", "ท่าวาสุกรี เขต ๒").scope, "wat", "filter wat wins");
eq(scopeFromFilters({ accessLevel: "tambon", sanghaTambon: "ท่าวาสุกรี เขต ๒" }, "", "ท่าวาสุกรี เขต ๒").scope, "tambon", "tambon scope");
eq(scopeFromFilters({ accessLevel: "admin" }, "", "").scope, "all", "admin all");

const watLock = { year_be: 2569, scope: "wat", scope_key: "วัดอินทาราม", closed: true };
eq(lockCoversPlace(watLock, { watName: "วัดอินทาราม" }), true, "covers same wat");
eq(lockCoversPlace(watLock, { watName: "วัดเจดีย์แดง" }), false, "other wat open");
eq(placeClosedByLocks([watLock], 2569, { watName: "วัดอินทาราม" }), true, "2569 closed at wat");
eq(placeClosedByLocks([watLock], 2568, { watName: "วัดอินทาราม" }), false, "other year open");
eq(placeClosedByLocks([{ year_be: 2569, scope: "all", scope_key: "", closed: true }], 2569, { watName: "วัดใด" }), true, "all covers");
eq(scopeLabel("wat", "วัดอินทาราม").indexOf("อินทาราม") >= 0, true, "label has wat");

console.log("ok rain year lock");
