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
  canApproveAccount,
  parseAccountStatus,
  accountStatusMessage,
  isEmail,
  PLATFORM_ADMIN_EMAIL,
  ADMIN_HOME_WAT,
  pickAdminHomeWat,
  applyEmbedLock,
  isEmbedRequest,
  parseAppScope,
  isDutiesOnly,
  isDutiesAllowedPath,
  requireAppScope
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

eq(parseAccountStatus("pending"), "pending", "status pending");
eq(parseAccountStatus(""), "approved", "status default approved");
eq(accountStatusMessage("pending").indexOf("รอ") >= 0, true, "pending message");
eq(canApproveAccount({ accessLevel: "admin" }, { status: "pending", district: "ผักไห่" }), true, "admin approves signup");
eq(canApproveAccount({ accessLevel: "district", district: "ผักไห่" }, { status: "pending", district: "ผักไห่" }), true, "district approves signup in area");
eq(canApproveAccount({ accessLevel: "district", district: "ผักไห่" }, { status: "pending", district: "วังน้อย" }), false, "district other area");
eq(canApproveAccount({ accessLevel: "admin" }, { status: "approved", district: "ผักไห่" }), false, "already approved");

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

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const srcDuty = fs.readFileSync(path.join(__dirname, "lib", "duties.js"), "utf8");
eq(html.indexOf("form[hidden]") >= 0, true, "hidden forms stay hidden");
eq(html.indexOf("รอผู้ดูแลอนุมัติจึงเข้าใช้งานได้") >= 0, true, "signup waits for approval");
eq(html.indexOf("สมัครแล้วเข้าใช้") >= 0, false, "no instant signup login");
eq(html.indexOf('id="btn-goto-signup" hidden') >= 0, true, "signup button hidden until open");
eq(html.indexOf("btn-register-toggle") >= 0, true, "admin can open register");
eq((html.match(/กลับเมนูหลัก/g) || []).length >= 2, true, "กลับเมนูหลัก on login and nav");
eq(html.indexOf('id="login-user" type="text"') >= 0, true, "login still accepts admin");
eq(html.indexOf("size: legal landscape") >= 0, true, "rains report prints legal");
eq(html.indexOf('col class="c-age"') >= 0, true, "age column is narrow");
eq(html.indexOf('col class="c-wat"') >= 0, true, "wat column has its own width");
eq(html.indexOf('col class="c-nak"') >= 0, true, "naktham column is narrow");
eq(html.indexOf('col class="c-place"') >= 0, true, "tambon column is narrow");
eq(html.indexOf("col.c-name { width: 12.2%") >= 0, true, "name column fits Ananda Priya Bhikkhu");
eq(html.indexOf("col.c-chaya { width: 12.4%") >= 0, true, "chaya column is wide enough");
eq(html.indexOf("col.c-school { width: 6.6%") >= 0, true, "school column can hold a temple name");
eq(html.indexOf("col.c-wat { width: 5.6%") >= 0, true, "wat column stays compact");
eq(html.indexOf("col.c-bprov { width: 6.8%") >= 0, true, "birth province has room");
eq(html.indexOf("function rainsNameCell") >= 0, true, "name and chaya keep spaces on one line");
eq(html.indexOf("td.chaya") >= 0 && html.indexOf("white-space: nowrap") >= 0, true, "chaya does not wrap");
eq(html.indexOf("col.c-prov { width: 7%") >= 0, true, "exam province can hold Ayutthaya");
eq(html.indexOf('col class="c-bprov"') >= 0, true, "birth province has its own column");
eq(html.indexOf("เกิดที่<br>จังหวัด") >= 0, true, "birth province header wraps on purpose");
eq(html.indexOf("#rains-report-body") >= 0 && html.indexOf("width: 345mm") >= 0, true, "report preview matches legal width");
eq(html.indexOf("พิมพ์และไฟล์") >= 0, true, "print and files sit in overflow");
eq(html.indexOf('href="https://wat-accounting.onrender.com/hub"') >= 0, true, "กลับเมนูหลัก goes to hub");
eq(html.indexOf("body.embed #btn-logout") >= 0, true, "embed hides logout in accounting");
eq(html.indexOf("id=\"nav-duties\"") >= 0, true, "duty tab");
eq(html.indexOf("id=\"duty-kind\"") >= 0, true, "duty kind dropdown");
eq(html.indexOf(">ปฏิบัติศาสนกิจประจำวัน<") >= 0, true, "daily duty heading");
eq(html.indexOf("id=\"duty-event-face\"") >= 0 && html.indexOf("openPhraCal") >= 0, true, "duty date calendar");
eq(html.indexOf("class=\"duty-card\"") >= 0 && html.indexOf("duty-chip") >= 0, true, "daily duty phone cards");
eq(html.indexOf("saveDutyDaily({ quiet: true })") >= 0, true, "exempt toggle saves");
eq(html.indexOf("duty-saved") >= 0 && html.indexOf("pulseDutySaveBtn") >= 0, true, "save button press effect");
eq(html.indexOf("duty-event-pick") < 0 && html.indexOf("duty-daily-pick") < 0, true, "duty no month dropdowns");
eq(html.indexOf("ยกเว้น</label>") >= 0 && html.indexOf("data-f=\"exempt\"") >= 0, true, "duty exempt checkbox");
eq(srcDuty.indexOf("ย้ายวัด") >= 0 && srcDuty.indexOf("มรณภาพ") >= 0 && srcDuty.indexOf("NOT IN") >= 0, true, "duty hides moved and dead");
eq(html.indexOf('class="duty-when">เช้า<') >= 0, true, "morning chant");
eq(html.indexOf("เหตุผลลา") >= 0, true, "leave reason");
eq(serverSrc.indexOf("/api/duties/events") >= 0, true, "duty event api");
eq(serverSrc.indexOf("/api/duties/daily") >= 0, true, "duty daily api");
eq(serverSrc.indexOf("/api/duties/month") >= 0, true, "duty month report api");
eq(html.indexOf("รายงานการทำวัตร") >= 0, true, "duty month report page");
eq(html.indexOf("size: A4 landscape") >= 0, true, "duty month prints A4 landscape");
eq(html.indexOf("id=\"duty-report-year\"") >= 0 && html.indexOf("id=\"duty-report-month\"") >= 0, true, "duty report month pick");
eq(html.indexOf("id=\"btn-duty-daily-print\"") >= 0, true, "print month report on daily page");
eq(html.indexOf('id="nav-list"') >= 0 && html.indexOf("รายงานพระภิกษุ") >= 0, true, "rains list menu stays");
eq(html.indexOf('id="nav-places"') >= 0 && html.indexOf('id="nav-users"') >= 0, true, "places and users menus stay");
eq(html.indexOf('id="btn-rains-report"') >= 0 && html.indexOf("page: rains-sheet") >= 0, true, "rains print menu stays");
eq(html.indexOf("hideAppPages") >= 0 && html.indexOf('"duty-report-open", "print-duty"') >= 0, true, "leaving duties closes duty print overlay");
eq(html.indexOf("$(\"nav-list\").hidden = dutiesOnly") >= 0, true, "full users keep list menu");
eq(isDutiesAllowedPath("/report"), false, "rains report not duties-only");
eq(isDutiesAllowedPath("/monks"), false, "monk list not duties-only");
(function () {
  let next = false;
  requireAppScope({ user: { appScope: "all" }, path: "/monks" }, {}, function () { next = true; });
  eq(next, true, "full user still loads monks");
  next = false;
  requireAppScope({ user: { appScope: "all" }, path: "/report" }, {}, function () { next = true; });
  eq(next, true, "full user still loads rains report");
  next = false;
  requireAppScope({ user: { accessLevel: "admin" }, path: "/users" }, {}, function () { next = true; });
  eq(next, true, "admin users page not blocked");
})();
eq(html.indexOf("id=\"ill\"") >= 0, true, "ill is extra on จำพรรษา");
eq(html.indexOf("id=\"illBedridden\"") >= 0, true, "ill bedridden");
eq(html.indexOf("id=\"illPlace\"") >= 0, true, "ill treatment place");
eq(html.indexOf(">โรงพยาบาล<") >= 0, true, "hospital place");
eq(html.indexOf('id="user-app-scope"') >= 0, true, "user app scope field");
eq(html.indexOf("เฉพาะปฏิบัติศาสนกิจ") >= 0 && html.indexOf("ทั้งหมด") >= 0, true, "duties or all rights");
eq(html.indexOf("body.duties-only") >= 0, true, "duties-only hides monk list");
eq(serverSrc.indexOf("requireAppScope") >= 0, true, "duties-only blocks other apis");
eq(parseAppScope("duties", "wat"), "duties", "wat can be duties-only");
eq(parseAppScope("duties", "admin"), "all", "admin always all");
eq(parseAppScope("duties", "district"), "all", "district always all");
eq(isDutiesOnly({ appScope: "duties" }), true, "duties-only user");
eq(isDutiesAllowedPath("/duties/daily"), true, "duty api allowed");
eq(isDutiesAllowedPath("/api/duties/month"), true, "duty month allowed");
eq(isDutiesAllowedPath("/monks"), false, "monk list blocked");
eq(isDutiesAllowedPath("/me"), true, "me allowed");
(function () {
  let next = false;
  requireAppScope({ user: { appScope: "duties" }, path: "/duties/daily" }, {}, function () { next = true; });
  eq(next, true, "middleware allows duties");
  next = false;
  const res = { code: 0, status: function (c) { this.code = c; return this; }, json: function (b) { this.body = b; return this; } };
  requireAppScope({ user: { appScope: "duties" }, path: "/monks" }, res, function () { next = true; });
  eq(next, false, "middleware blocks monks");
  eq(res.code, 403, "duties-only 403");
})();
eq(html.indexOf("$(\"btn-logout\").hidden = !!embedOn") >= 0, true, "only the accounting iframe hides logout");
eq(html.indexOf("X-Phra-Embed") >= 0, true, "iframe marks embed API calls");
eq(isEmbedRequest({ headers: {} }), false, "standalone is not embed");
eq(isEmbedRequest({ headers: { "x-phra-embed": "1" } }), true, "iframe header is embed");
eq(html.indexOf("/embed/accept") >= 0, true, "embed accepts accounting ticket");
eq(serverSrc.indexOf("app.post(\"/api/embed/accept\"") >= 0, true, "embed accept route");
eq(serverSrc.indexOf("frame-ancestors") >= 0, true, "accounting can iframe monks");
const { lockUserToWat, signPhraEmbed, verifyPhraEmbed } = require("./lib/phraEmbed");
const embedTok = signPhraEmbed({ watName: "วัดอินทาราม", email: "a@b.c" }, "secret-a", 1000);
eq(verifyPhraEmbed(embedTok, "secret-a", 2000).watName, "วัดอินทาราม", "embed ticket");
const embedAdmin = lockUserToWat({ accessLevel: "admin", watId: 9, watName: "" }, "วัดอินทาราม", 1);
eq(embedAdmin.accessLevel, "wat", "embed admin becomes wat");
eq(embedAdmin.watId, 1, "embed drops other wat id");
eq(canManagePlaces(embedAdmin), false, "embed cannot manage places");
eq(lockUserToWat({ accessLevel: "wat", watName: "วัดอื่น" }, "วัดอินทาราม").embedMismatch, true, "other wat blocked");
const embedSess = signPhraEmbed({ watName: "วัดอินทาราม", email: "a@b.c" });
eq(applyEmbedLock({ accessLevel: "admin" }, { headers: { cookie: "phra_embed=" + embedSess } }).accessLevel, "admin", "standalone ignores embed cookie");
eq(applyEmbedLock({ accessLevel: "admin" }, { headers: { cookie: "phra_embed=" + embedSess, "x-phra-embed": "1" } }).accessLevel, "wat", "iframe still locks to one wat");
const logoutClick = html.slice(html.indexOf("$(\"btn-logout\").onclick"), html.indexOf("};", html.indexOf("$(\"btn-logout\").onclick")) + 2);
eq(logoutClick.indexOf("api(\"/logout\"") >= 0, true, "logout calls api");
eq(logoutClick.indexOf("location.replace(\"https://wat-accounting.onrender.com/hub\")") >= 0, true, "logout goes to hub");
eq(logoutClick.indexOf("classList.contains(\"embed\")") >= 0, true, "embed logout stays in iframe");

const { thaiPlaceName, watAlias } = require("./lib/formExcelImport");
eq(watAlias("Wat Intharam"), "วัดอินทาราม", "alias intharam");
eq(thaiPlaceName("Ayutthaya"), "พระนครศรีอยุธยา", "alias ayutthaya");
eq(thaiPlaceName("Wang-noi"), "วังน้อย", "alias wang noi");

console.log("ok");
