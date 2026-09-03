const {
  parseAccessLevel,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  isLocalPasswordHash,
  appendViewScope,
  appendHomeScope,
  insertBeforeOrderBy,
  filterWats,
  filterSanghaTambons,
  scopePlaces,
  canManagePlaces,
  assertPlaceWrite,
  homeBodyInScope,
  ACCESS_LABEL,
  canManageUsers,
  canApproveRequested,
  isEmail,
  PLATFORM_ADMIN_EMAIL,
  ADMIN_HOME_WAT,
  pickAdminHomeWat
} = require("./lib/phraAuth");

function eq(got, want, label) {
  if (got !== want) {
    console.error("FAIL", label, { got, want });
    process.exit(1);
  }
}

eq(parseAccessLevel("วัด"), "wat", "level wat");
eq(parseAccessLevel("ตำบล"), "tambon", "level tambon");
eq(parseAccessLevel("ตำบลคณะสงฆ์"), "tambon", "level sangha tambon");
eq(parseAccessLevel("จังหวัด"), "province", "level province");
eq(parseAccessLevel("อำเภอ"), "district", "level district");
eq(parseAccessLevel("ผู้ดูแลระบบ"), "admin", "level admin");
eq(parseAccessLevel("ผู้ดูแลแพลตฟอร์ม"), "admin", "level platform admin");
eq(ACCESS_LABEL.wat, "วัด", "label wat");

eq(normalizeUsername(" Admin "), "admin", "username");
eq(isEmail("ra_yut@hotmail.com"), true, "admin email");
eq(isEmail("admin"), false, "admin not email");
eq(PLATFORM_ADMIN_EMAIL, "ra_yut@hotmail.com", "platform admin email");
eq(ADMIN_HOME_WAT, "วัดอินทาราม", "admin home wat");
eq(pickAdminHomeWat([
  { id: 9, name: "วัดอินทาราม", district: "เมือง", province: "ชลบุรี" },
  { id: 1, name: "วัดอินทาราม", district: "พระนครศรีอยุธยา", province: "พระนครศรีอยุธยา", sangha_tambon: "ท่าวาสุกรี เขต ๒" }
]).id, 1, "admin home prefers Ayutthaya Intharam");

const hashed = hashPassword("secret1");
eq(verifyPassword("secret1", hashed), true, "hash ok");
eq(verifyPassword("wrong", hashed), false, "hash reject");
eq(isLocalPasswordHash(hashed), true, "local hash");
eq(isLocalPasswordHash("ext:accounting"), false, "accounting marker");

const admin = { accessLevel: "admin" };
const paramsA = [""];
eq(appendViewScope(admin, paramsA, "m"), "", "admin no scope");
eq(paramsA.length, 1, "admin params unchanged");

const watUser = { accessLevel: "wat", watId: 582, watName: "วัดอินทาราม" };
const paramsW = [];
const sqlW = appendViewScope(watUser, paramsW, "m");
eq(sqlW.indexOf("monk_rains") >= 0, true, "wat sees rain visitors");
eq(paramsW.length >= 2, true, "wat binds id and name");
eq(sqlW.indexOf("$1") >= 0, true, "wat param $1");

const homeW = appendHomeScope(watUser, [], "m");
eq(homeW.indexOf("monk_rains") >= 0, false, "home scope no rains");

const tambonUser = { accessLevel: "tambon", sanghaTambon: "ท่าวาสุกรี เขต ๒" };
const sqlT = appendViewScope(tambonUser, [], "m");
eq(sqlT.indexOf("sangha_tambon") >= 0, true, "tambon scope");

const provUser = { accessLevel: "province", province: "พระนครศรีอยุธยา" };
eq(appendViewScope(provUser, [], "m").indexOf("province") >= 0, true, "province scope");

const sql = "SELECT 1 FROM monks m WHERE 1=1 ORDER BY m.id";
eq(
  insertBeforeOrderBy(sql, " AND m.wat_name = $2").replace(/\s+/g, " ").trim(),
  "SELECT 1 FROM monks m WHERE 1=1 AND m.wat_name = $2 ORDER BY m.id",
  "insert before order"
);

const wats = [
  { id: 1, name: "วัดอินทาราม", sanghaTambon: "ท่าวาสุกรี เขต ๒", province: "พระนครศรีอยุธยา" },
  { id: 2, name: "วัดราชประดิษฐาน", sanghaTambon: "หัวรอ", province: "พระนครศรีอยุธยา" },
  { id: 3, name: "วัดอื่น", sanghaTambon: "อื่น", province: "ลพบุรี" }
];
eq(filterWats(watUser, wats).length, 1, "filter wat");
eq(filterWats(watUser, wats)[0].name, "วัดอินทาราม", "filter wat name");
eq(filterWats(tambonUser, wats).length, 1, "filter tambon");
eq(filterWats(provUser, wats).length, 2, "filter province");
eq(filterSanghaTambons(tambonUser, [{ name: "ท่าวาสุกรี เขต ๒" }, { name: "หัวรอ" }]).length, 1, "filter sangha list");

const places = scopePlaces(watUser, {
  sanghaTambons: [
    { name: "ท่าวาสุกรี เขต ๒", wats: ["วัดอินทาราม", "วัดอื่น"] },
    { name: "หัวรอ", wats: ["วัดราชประดิษฐาน"] }
  ],
  wats
});
eq(places.sanghaTambons.length, 1, "places one tambon");
eq(places.sanghaTambons[0].wats.join(","), "วัดอินทาราม", "places only own wat");

eq(canManagePlaces(watUser), false, "wat cannot manage places");
eq(canManagePlaces(tambonUser), true, "tambon can assign");
eq(canManagePlaces({ accessLevel: "district", district: "พระนครศรีอยุธยา" }), true, "district can assign");
eq(canManageUsers({ accessLevel: "admin" }), true, "admin users");
eq(canManageUsers({ accessLevel: "district" }), true, "district users");
eq(canManageUsers(watUser), false, "wat no users page");
eq(canApproveRequested({ accessLevel: "district", district: "พระนครศรีอยุธยา" }, { requestedLevel: "tambon", district: "พระนครศรีอยุธยา" }), true, "district approves tambon");
eq(canApproveRequested({ accessLevel: "province", province: "พระนครศรีอยุธยา" }, { requestedLevel: "district", province: "พระนครศรีอยุธยา" }), true, "province approves district");
eq(canApproveRequested({ accessLevel: "district", district: "พระนครศรีอยุธยา" }, { requestedLevel: "province", province: "พระนครศรีอยุธยา" }), false, "district cannot approve province");
eq(canApproveRequested({ accessLevel: "admin" }, { requestedLevel: "province", province: "พระนครศรีอยุธยา" }), true, "platform approves province");

const distUser = { accessLevel: "district", district: "พระนครศรีอยุธยา" };
eq(appendViewScope(distUser, [], "m").indexOf("district") >= 0, true, "district scope");
eq(filterWats(distUser, [
  { id: 1, name: "วัดอินทาราม", district: "พระนครศรีอยุธยา" },
  { id: 3, name: "วัดอื่น", district: "เมืองลพบุรี" }
]).length, 1, "filter district");

let threw = false;
try { assertPlaceWrite(watUser, "assign", { name: "ท่าวาสุกรี เขต ๒" }); } catch (e) { threw = e.status === 403; }
eq(threw, true, "wat cannot assign");
assertPlaceWrite(tambonUser, "assign", { name: "ท่าวาสุกรี เขต ๒", province: "พระนครศรีอยุธยา" });
threw = false;
try { assertPlaceWrite(tambonUser, "addTambon", { name: "ใหม่" }); } catch (e) { threw = e.status === 403; }
eq(threw, true, "tambon cannot add tambon");
assertPlaceWrite(provUser, "addTambon", { province: "พระนครศรีอยุธยา" });

eq(homeBodyInScope(watUser, { wat_name: "วัดอินทาราม", wat_id: 582 }), true, "home own wat");
eq(homeBodyInScope(watUser, { wat_name: "วัดราชประดิษฐาน" }), false, "home other wat");
eq(homeBodyInScope(tambonUser, { sangha_tambon: "ท่าวาสุกรี เขต ๒" }), true, "home own tambon");
eq(homeBodyInScope(admin, { wat_name: "วัดใดก็ได้" }), true, "admin home");

const fs = require("fs");
const path = require("path");
const serverSrc = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
eq(serverSrc.indexOf("adminNeedsPlacePick") >= 0, true, "admin waits to pick place");
eq(serverSrc.indexOf("$9 = '' OR COALESCE(NULLIF(pw.province") >= 0, true, "report filters province");
eq(serverSrc.indexOf("yearPwJoinSql") >= 0, true, "year list joins rain place");
eq(serverSrc.indexOf("$6 <> '' AND (COALESCE(NULLIF(y.wat_name,''), m.wat_name) = $6") >= 0, true, "wat filter keeps rain guests");
eq(serverSrc.indexOf("lv === \"wat\" && req.user.watName") >= 0, true, "places catalog scoped to wat");

const { thaiPlaceName, watAlias } = require("./lib/formExcelImport");
eq(watAlias("Wat Intharam"), "วัดอินทาราม", "alias intharam");
eq(thaiPlaceName("Ayutthaya"), "พระนครศรีอยุธยา", "alias ayutthaya");
eq(thaiPlaceName("Wang-noi"), "วังน้อย", "alias wang noi");

console.log("ok");
