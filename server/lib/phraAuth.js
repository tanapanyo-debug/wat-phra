const crypto = require("crypto");

const LEVELS = ["wat", "tambon", "district", "province", "admin"];
const ACCESS_LABEL = {
  wat: "วัด",
  tambon: "ตำบลคณะสงฆ์",
  district: "อำเภอ",
  province: "จังหวัด",
  admin: "ผู้ดูแลแพลตฟอร์ม"
};
const LEVEL_RANK = { wat: 1, tambon: 2, district: 3, province: 4, admin: 5 };
const COOKIE = "phra_sid";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deny(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function parseAccessLevel(v) {
  const s = clean(v).toLowerCase();
  if (s === "wat" || s === "วัด" || s === "1") return "wat";
  if (s === "tambon" || s === "ตำบล" || s === "ตำบลคณะสงฆ์" || s === "2") return "tambon";
  if (s === "district" || s === "อำเภอ" || s === "3") return "district";
  if (s === "province" || s === "จังหวัด" || s === "4") return "province";
  if (s === "admin" || s === "ผู้ดูแลระบบ" || s === "ผู้ดูแลแพลตฟอร์ม" || s === "ผู้ดูแล" || s === "5") return "admin";
  return "";
}

function normalizeUsername(v) {
  return clean(v).toLowerCase().replace(/\s+/g, "");
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 32, SCRYPT);
  return salt.toString("hex") + ":" + hash.toString("hex");
}

function isLocalPasswordHash(stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 2) return false;
  if (!/^[0-9a-f]+$/i.test(parts[0]) || !/^[0-9a-f]+$/i.test(parts[1])) return false;
  return Buffer.from(parts[0], "hex").length === 16 && Buffer.from(parts[1], "hex").length === 32;
}

function verifyPassword(plain, stored) {
  if (!isLocalPasswordHash(stored)) return false;
  const parts = String(stored || "").split(":");
  const salt = Buffer.from(parts[0], "hex");
  const want = Buffer.from(parts[1], "hex");
  const got = crypto.scryptSync(String(plain), salt, 32, SCRYPT);
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

function publicUser(row) {
  if (!row) return null;
  const accessLevel = parseAccessLevel(row.access_level) || "wat";
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || "",
    accessLevel,
    accessLabel: ACCESS_LABEL[accessLevel] || accessLevel,
    watId: row.wat_id || null,
    watName: row.wat_name || "",
    sanghaTambon: row.sangha_tambon || "",
    district: row.district || "",
    province: row.province || "",
    requestedLevel: parseAccessLevel(row.requested_level) || "",
    requestedLabel: ACCESS_LABEL[parseAccessLevel(row.requested_level)] || ""
  };
}

function parseCookies(req) {
  const out = {};
  String((req && req.headers && req.headers.cookie) || "").split(";").forEach((part) => {
    const s = part.trim();
    const i = s.indexOf("=");
    if (i < 0) return;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') v = v.slice(1, -1);
    try { v = decodeURIComponent(v); } catch (e) {}
    out[k] = v;
  });
  return out;
}

function cookieSecure() {
  return !!process.env.RENDER || String(process.env.COOKIE_SECURE || "") === "1";
}

function setSessionCookie(res, token) {
  const parts = [
    COOKIE + "=" + token,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=" + Math.floor(SESSION_MS / 1000)
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [COOKIE + "=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function p(params, value) {
  params.push(value);
  return "$" + params.length;
}

function appendViewScope(user, params, alias) {
  const m = alias || "m";
  const lv = user && user.accessLevel;
  if (!lv || lv === "admin") return "";
  if (lv === "wat") {
    const id = user.watId ? Number(user.watId) : null;
    const name = clean(user.watName);
    if (!id && !name) return " AND 1=0";
    const bits = [];
    if (id) {
      const a = p(params, id);
      bits.push("(" + m + ".wat_id = " + a + " OR " + m + ".stay_wat_id = " + a + ")");
    }
    if (name) {
      const n = p(params, name);
      bits.push("(lower(" + m + ".wat_name) = lower(" + n + "))");
      bits.push("EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND lower(y.wat_name) = lower(" + n + "))");
    }
    return " AND (" + bits.join(" OR ") + ")";
  }
  if (lv === "tambon") {
    const t = clean(user.sanghaTambon);
    if (!t) return " AND 1=0";
    const n = p(params, t);
    return " AND (" + m + ".sangha_tambon = " + n +
      " OR EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND y.sangha_tambon = " + n + ")" +
      " OR EXISTS (SELECT 1 FROM phra_wats w WHERE w.sangha_tambon = " + n +
      " AND (lower(w.name) = lower(" + m + ".wat_name)" +
      " OR EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND lower(y.wat_name) = lower(w.name)))))";
  }
  if (lv === "district") {
    const t = clean(user.district);
    if (!t) return " AND 1=0";
    const n = p(params, t);
    return " AND (" + m + ".district = " + n +
      " OR EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND y.district = " + n + ")" +
      " OR EXISTS (SELECT 1 FROM phra_wats w WHERE w.district = " + n +
      " AND (lower(w.name) = lower(" + m + ".wat_name)" +
      " OR EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND lower(y.wat_name) = lower(w.name)))))";
  }
  if (lv === "province") {
    const t = clean(user.province);
    if (!t) return " AND 1=0";
    const n = p(params, t);
    return " AND (" + m + ".province = " + n +
      " OR EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND y.province = " + n + ")" +
      " OR EXISTS (SELECT 1 FROM phra_wats w WHERE w.province = " + n +
      " AND (lower(w.name) = lower(" + m + ".wat_name)" +
      " OR EXISTS (SELECT 1 FROM monk_rains y WHERE y.monk_id = " + m + ".id AND lower(y.wat_name) = lower(w.name)))))";
  }
  return " AND 1=0";
}

function appendHomeScope(user, params, alias) {
  const m = alias || "m";
  const lv = user && user.accessLevel;
  if (!lv || lv === "admin") return "";
  if (lv === "wat") {
    const id = user.watId ? Number(user.watId) : null;
    const name = clean(user.watName);
    if (!id && !name) return " AND 1=0";
    const bits = [];
    if (id) bits.push(m + ".wat_id = " + p(params, id));
    if (name) bits.push("lower(" + m + ".wat_name) = lower(" + p(params, name) + ")");
    return " AND (" + bits.join(" OR ") + ")";
  }
  if (lv === "tambon") {
    const t = clean(user.sanghaTambon);
    if (!t) return " AND 1=0";
    const n = p(params, t);
    return " AND (" + m + ".sangha_tambon = " + n +
      " OR EXISTS (SELECT 1 FROM phra_wats w WHERE w.sangha_tambon = " + n +
      " AND lower(w.name) = lower(" + m + ".wat_name)))";
  }
  if (lv === "district") {
    const t = clean(user.district);
    if (!t) return " AND 1=0";
    const n = p(params, t);
    return " AND (" + m + ".district = " + n +
      " OR EXISTS (SELECT 1 FROM phra_wats w WHERE w.district = " + n +
      " AND lower(w.name) = lower(" + m + ".wat_name)))";
  }
  if (lv === "province") {
    const t = clean(user.province);
    if (!t) return " AND 1=0";
    const n = p(params, t);
    return " AND (" + m + ".province = " + n +
      " OR EXISTS (SELECT 1 FROM phra_wats w WHERE w.province = " + n +
      " AND lower(w.name) = lower(" + m + ".wat_name)))";
  }
  return " AND 1=0";
}

function insertBeforeOrderBy(sql, fragment) {
  if (!fragment) return sql;
  const i = sql.toUpperCase().lastIndexOf("ORDER BY");
  if (i < 0) return sql + fragment;
  return sql.slice(0, i) + fragment + " " + sql.slice(i);
}

function sameName(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase() && !!clean(a);
}

function watInScope(user, wat) {
  if (!user || user.accessLevel === "admin") return true;
  const w = wat || {};
  if (user.accessLevel === "wat") {
    if (user.watId && Number(w.id) === Number(user.watId)) return true;
    return sameName(w.name, user.watName);
  }
  if (user.accessLevel === "tambon") {
    return clean(w.sanghaTambon || w.sangha_tambon) === clean(user.sanghaTambon);
  }
  if (user.accessLevel === "district") {
    return clean(w.district) === clean(user.district);
  }
  if (user.accessLevel === "province") {
    return clean(w.province) === clean(user.province);
  }
  return false;
}

function filterWats(user, wats) {
  return (wats || []).filter((w) => watInScope(user, w));
}

function filterWatsForPlaces(user, wats) {
  if (!user || user.accessLevel === "admin") return wats || [];
  if (user.accessLevel === "district") {
    return (wats || []).filter((w) => clean(w.district) === clean(user.district));
  }
  if (user.accessLevel !== "tambon") return filterWats(user, wats);
  return (wats || []).filter((w) => {
    if (clean(w.sanghaTambon || w.sangha_tambon) === clean(user.sanghaTambon)) return true;
    const unmatched = !clean(w.sanghaTambon || w.sangha_tambon);
    if (!unmatched) return false;
    if (user.district && clean(w.district) === clean(user.district)) return true;
    if (!user.district && user.province && clean(w.province) === clean(user.province)) return true;
    return false;
  });
}

function filterSanghaTambons(user, tambons) {
  if (!user || user.accessLevel === "admin") return tambons || [];
  if (user.accessLevel === "wat") {
    return (tambons || []).filter((t) => clean(t.name) === clean(user.sanghaTambon));
  }
  if (user.accessLevel === "tambon") {
    return (tambons || []).filter((t) => clean(t.name) === clean(user.sanghaTambon));
  }
  if (user.accessLevel === "district") {
    return (tambons || []).filter((t) => !t.district || clean(t.district) === clean(user.district));
  }
  if (user.accessLevel === "province") {
    return (tambons || []).filter((t) => !t.province || clean(t.province) === clean(user.province));
  }
  return [];
}

function scopePlaces(user, data) {
  const sanghaTambons = data && data.sanghaTambons ? data.sanghaTambons : [];
  const wats = data && data.wats ? data.wats : [];
  if (!user || user.accessLevel === "admin") return { sanghaTambons, wats };
  const scopedWats = filterWats(user, wats);
  const names = new Set(scopedWats.map((w) => w.name));
  let groups = sanghaTambons.map((g) => ({
    name: g.name,
    wats: (g.wats || []).filter((n) => {
      if (user.accessLevel === "wat") return sameName(n, user.watName);
      if (user.accessLevel === "tambon") return true;
      return names.has(n);
    })
  }));
  if (user.accessLevel === "wat") {
    groups = groups.filter((g) => g.wats.length);
  } else if (user.accessLevel === "tambon") {
    groups = groups.filter((g) => clean(g.name) === clean(user.sanghaTambon));
  } else if (user.accessLevel === "district" || user.accessLevel === "province") {
    groups = groups.filter((g) => g.wats.length || g.name === "(ยังไม่ระบุตำบลคณะสงฆ์)");
  }
  return { sanghaTambons: groups, wats: scopedWats };
}

function canManagePlaces(user) {
  const lv = user && user.accessLevel;
  return lv === "admin" || lv === "province" || lv === "district" || lv === "tambon";
}

function canManageUsers(user) {
  const lv = user && user.accessLevel;
  return lv === "admin" || lv === "province" || lv === "district";
}

function assertPlaceWrite(user, action, payload) {
  const lv = user && user.accessLevel;
  if (!lv) throw deny(401, "กรุณาเข้าสู่ระบบ");
  if (lv === "admin") return;
  if (lv === "wat") throw deny(403, "ระดับวัดจัดตำบลคณะสงฆ์ไม่ได้");
  const body = payload || {};
  const province = clean(body.province);
  const name = clean(body.name || body.sanghaTambon);
  if (lv === "tambon") {
    if (action === "addTambon" || action === "rename" || action === "delete") {
      throw deny(403, "เพิ่มหรือลบตำบลคณะสงฆ์ได้เฉพาะจังหวัดหรือผู้ดูแลระบบ");
    }
    if (action === "assign" && name && name !== clean(user.sanghaTambon)) {
      throw deny(403, "ตำบลคณะสงฆ์นี้ไม่ใช่เขตของท่าน");
    }
    if (action === "addWat") {
      const sangha = clean(body.sanghaTambon);
      if (sangha && sangha !== clean(user.sanghaTambon)) {
        throw deny(403, "เพิ่มวัดได้เฉพาะในตำบลคณะสงฆ์ของท่าน");
      }
    }
    if (user.province && province && province !== clean(user.province)) {
      throw deny(403, "อยู่นอกจังหวัดของท่าน");
    }
    return;
  }
  if (lv === "district") {
    const district = clean(body.district);
    if (user.district && district && district !== clean(user.district)) {
      throw deny(403, "ใช้ได้เฉพาะอำเภอของท่าน");
    }
    if (user.province && province && province !== clean(user.province)) {
      throw deny(403, "อยู่นอกจังหวัดของท่าน");
    }
    return;
  }
  if (lv === "province") {
    if (user.province && province && province !== clean(user.province)) {
      throw deny(403, "ใช้ได้เฉพาะจังหวัดของท่าน");
    }
    return;
  }
  throw deny(403, "ไม่มีสิทธิ์");
}

function homeBodyInScope(user, body, watRow) {
  if (!user || user.accessLevel === "admin") return true;
  const b = body || {};
  const watName = clean(b.wat_name || b.watName);
  const sangha = clean(b.sangha_tambon || b.sanghaTambon || (watRow && watRow.sangha_tambon) || "");
  const province = clean(b.province || (watRow && watRow.province) || "");
  const watId = b.wat_id || b.watId || (watRow && watRow.id) || null;
  if (user.accessLevel === "wat") {
    if (user.watId && watId && Number(watId) === Number(user.watId)) return true;
    return sameName(watName, user.watName);
  }
  if (user.accessLevel === "tambon") {
    if (sangha === clean(user.sanghaTambon)) return true;
    return !!(watRow && clean(watRow.sangha_tambon) === clean(user.sanghaTambon));
  }
  if (user.accessLevel === "district") {
    const district = clean(b.district || (watRow && watRow.district) || "");
    if (district === clean(user.district)) return true;
    return !!(watRow && clean(watRow.district) === clean(user.district));
  }
  if (user.accessLevel === "province") {
    if (province === clean(user.province)) return true;
    return !!(watRow && clean(watRow.province) === clean(user.province));
  }
  return false;
}

async function lookupWat(pool, watId, watName) {
  const id = watId ? Number(watId) : null;
  const name = clean(watName);
  if (!id && !name) return null;
  const r = await pool.query(
    `SELECT id, name, sangha_tambon, district, province
       FROM phra_wats
      WHERE ($1::int IS NOT NULL AND id = $1)
         OR ($2 <> '' AND lower(name) = lower($2))
      ORDER BY CASE WHEN $1::int IS NOT NULL AND id = $1 THEN 0 ELSE 1 END, id
      LIMIT 1`,
    [id, name]
  );
  return r.rows[0] || null;
}

async function assertNewMonkInScope(pool, user, body) {
  if (!user || user.accessLevel === "admin") return;
  const wat = await lookupWat(pool, body && (body.wat_id || body.watId), body && (body.wat_name || body.watName));
  if (!homeBodyInScope(user, body, wat)) {
    throw deny(403, "บันทึกได้เฉพาะในเขตที่ได้รับสิทธิ์");
  }
}

function applyWatUserHome(user, body) {
  if (!user || user.accessLevel !== "wat") return body;
  const b = body || {};
  if (user.watName) b.wat_name = user.watName;
  if (user.watId) b.wat_id = user.watId;
  if (user.sanghaTambon) b.sangha_tambon = user.sanghaTambon;
  if (user.district) b.district = user.district;
  if (user.province) b.province = user.province;
  return b;
}

async function ensureAuthSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phra_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      access_level TEXT NOT NULL DEFAULT 'wat',
      wat_id INTEGER,
      wat_name TEXT NOT NULL DEFAULT '',
      sangha_tambon TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE phra_users ADD COLUMN IF NOT EXISTS requested_level TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE phra_users ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phra_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES phra_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS phra_sessions_user ON phra_sessions (user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS phra_sessions_exp ON phra_sessions (expires_at)`);
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

async function seedAdmin(pool) {
  const n = await pool.query("SELECT COUNT(*)::int AS n FROM phra_users");
  if (n.rows[0].n > 0) return null;
  const username = normalizeUsername(process.env.PHRA_ADMIN_USER || "admin") || "admin";
  let password = String(process.env.PHRA_ADMIN_PASSWORD || "").trim();
  let generated = false;
  if (!password) {
    password = randomPassword();
    generated = true;
  }
  await pool.query(
    `INSERT INTO phra_users (username, password_hash, display_name, access_level)
     VALUES ($1, $2, 'ผู้ดูแลระบบ', 'admin')`,
    [username, hashPassword(password)]
  );
  return { username, password: generated ? password : null, generated };
}

async function applyAdminPassword(pool) {
  const username = normalizeUsername(process.env.PHRA_ADMIN_USER || "admin") || "admin";
  const password = String(process.env.PHRA_ADMIN_PASSWORD || "").trim();
  if (!password) return false;
  const r = await pool.query("SELECT id FROM phra_users WHERE username=$1", [username]);
  if (!r.rowCount) return false;
  await pool.query("UPDATE phra_users SET password_hash=$2 WHERE id=$1", [r.rows[0].id, hashPassword(password)]);
  return true;
}

async function loadSession(pool, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const r = await pool.query(
    `SELECT u.* FROM phra_sessions s
       JOIN phra_users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return publicUser(r.rows[0]);
}

async function createSession(pool, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("DELETE FROM phra_sessions WHERE expires_at < now()");
  await pool.query(
    "INSERT INTO phra_sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [token, userId]
  );
  return token;
}

async function destroySession(pool, req) {
  const token = parseCookies(req)[COOKIE];
  if (token) await pool.query("DELETE FROM phra_sessions WHERE token = $1", [token]);
}

const loginHits = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const row = loginHits.get(ip) || { n: 0, t: now };
  if (now - row.t > 10 * 60 * 1000) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  loginHits.set(ip, row);
  return row.n <= 20;
}

async function login(pool, username, password) {
  const u = normalizeUsername(username);
  if (!u || !password) throw deny(400, "ใส่ชื่อผู้ใช้และรหัสผ่าน");
  const r = await pool.query("SELECT * FROM phra_users WHERE username = $1", [u]);
  const row = r.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw deny(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  }
  const token = await createSession(pool, row.id);
  return { token, user: publicUser(row) };
}

async function fillUserScope(pool, input) {
  const out = input;
  if (out.accessLevel === "wat" && (out.watId || out.watName)) {
    const wat = await lookupWat(pool, out.watId, out.watName);
    if (wat) {
      out.watId = wat.id;
      out.watName = wat.name;
      if (!out.sanghaTambon) out.sanghaTambon = wat.sangha_tambon || "";
      if (!out.district) out.district = wat.district || "";
      if (!out.province) out.province = wat.province || "";
    }
  }
  if (out.accessLevel === "wat") {
    out.sanghaTambon = "";
  }
  if (out.accessLevel === "tambon" && out.sanghaTambon) {
    const r = await pool.query(
      `SELECT name, district, province FROM phra_sangha_tambons
        WHERE lower(name) = lower($1)
        ORDER BY id LIMIT 1`,
      [out.sanghaTambon]
    );
    if (r.rows[0]) {
      out.sanghaTambon = r.rows[0].name;
      if (!out.district) out.district = r.rows[0].district || "";
      if (!out.province) out.province = r.rows[0].province || "";
    }
  }
  if (out.accessLevel === "district" && out.district && !out.province) {
    const r = await pool.query(
      `SELECT province FROM phra_wats
        WHERE lower(district) = lower($1) AND province <> ''
        ORDER BY id LIMIT 1`,
      [out.district]
    );
    if (r.rows[0]) out.province = r.rows[0].province || "";
  }
  return out;
}

function readUserBody(body, isCreate) {
  const accessLevel = parseAccessLevel(body && body.accessLevel);
  if (!accessLevel) throw deny(400, "เลือกระดับการใช้งาน");
  const username = normalizeUsername(body && body.username);
  if (isCreate && !username) throw deny(400, "ใส่ชื่อผู้ใช้");
  if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw deny(400, "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ความยาว 3–40");
  }
  const password = String((body && body.password) || "");
  if (isCreate && password.length < 6) throw deny(400, "รหัสผ่านอย่างน้อย 6 ตัว");
  if (!isCreate && password && password.length < 6) throw deny(400, "รหัสผ่านอย่างน้อย 6 ตัว");
  const out = {
    username,
    password,
    displayName: clean(body && body.displayName).slice(0, 80),
    accessLevel,
    watId: body && body.watId ? Number(body.watId) : null,
    watName: clean(body && body.watName).slice(0, 160),
    sanghaTambon: clean(body && body.sanghaTambon).slice(0, 80),
    district: clean(body && body.district).slice(0, 80),
    province: clean(body && body.province).slice(0, 80)
  };
  if (Number.isNaN(out.watId)) out.watId = null;
  if (accessLevel === "wat") {
    if (!out.watName && !out.watId) throw deny(400, "เลือกวัด");
    if (!out.province) throw deny(400, "เลือกจังหวัด");
    if (!out.district) throw deny(400, "เลือกอำเภอ");
    out.sanghaTambon = "";
  }
  if (accessLevel === "tambon" && !out.sanghaTambon) throw deny(400, "ระบุตำบลคณะสงฆ์");
  if (accessLevel === "district") {
    if (!out.district) throw deny(400, "ระบุอำเภอ");
    if (!out.province) throw deny(400, "ระบุจังหวัด");
  }
  if (accessLevel === "province" && !out.province) throw deny(400, "ระบุจังหวัด");
  if (accessLevel === "admin") {
    out.watId = null;
    out.watName = "";
    out.sanghaTambon = "";
    out.district = "";
    out.province = "";
  }
  return out;
}

function isPublicApiPath(path) {
  return path === "/health" || path === "/login" || path === "/register"
    || path === "/temples/provinces" || path === "/temples/districts" || path === "/temples/in-place";
}

function requireAuth(pool) {
  return async function (req, res, next) {
    if (isPublicApiPath(req.path)) return next();
    try {
      const user = await loadSession(pool, req);
      if (!user) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ", login: true });
      req.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.accessLevel !== "admin") {
    return res.status(403).json({ error: "เฉพาะผู้ดูแลแพลตฟอร์ม" });
  }
  next();
}

function requireUserManager(req, res, next) {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ error: "เฉพาะผู้มีอำนาจอนุมัติผู้ใช้" });
  }
  next();
}

function canApproveRequested(actor, target) {
  if (!actor || !target || !target.requestedLevel) return false;
  const want = target.requestedLevel;
  if (actor.accessLevel === "admin") return true;
  if (want === "tambon") {
    return actor.accessLevel === "district" && sameName(actor.district, target.district);
  }
  if (want === "district") {
    return actor.accessLevel === "province" && sameName(actor.province, target.province);
  }
  return false;
}

function usersVisibleWhere(user, params) {
  if (!user || user.accessLevel === "admin") return "";
  if (user.accessLevel === "province") {
    return " AND access_level <> 'admin' AND lower(province) = lower(" + p(params, user.province) + ")";
  }
  if (user.accessLevel === "district") {
    return " AND access_level <> 'admin' AND lower(district) = lower(" + p(params, user.district) + ")";
  }
  return " AND 1=0";
}

async function registerUser(pool, body, wat) {
  const username = normalizeUsername(body && body.username);
  const password = String((body && body.password) || "");
  const displayName = clean(body && body.displayName).slice(0, 80);
  if (!username) throw deny(400, "ใส่ชื่อผู้ใช้");
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw deny(400, "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ความยาว 3–40");
  }
  if (password.length < 6) throw deny(400, "รหัสผ่านอย่างน้อย 6 ตัว");
  if (!wat || !wat.id) throw deny(400, "เลือกจังหวัด อำเภอ และวัด");
  const r = await pool.query(
    `INSERT INTO phra_users (username, password_hash, display_name, access_level, wat_id, wat_name, sangha_tambon, district, province)
     VALUES ($1,$2,$3,'wat',$4,$5,'',$6,$7) RETURNING *`,
    [username, hashPassword(password), displayName, wat.id, wat.name || "", wat.district || "", wat.province || ""]
  );
  const token = await createSession(pool, r.rows[0].id);
  return { token, user: publicUser(r.rows[0]) };
}

async function requestLevel(pool, user, wanted) {
  if (!user || !user.id) throw deny(401, "กรุณาเข้าสู่ระบบ");
  const lv = parseAccessLevel(wanted);
  if (!lv || lv === "admin" || lv === "wat") {
    throw deny(400, "ขอได้เฉพาะระดับตำบลคณะสงฆ์ อำเภอ หรือจังหวัด");
  }
  if ((LEVEL_RANK[lv] || 0) <= (LEVEL_RANK[user.accessLevel] || 0)) {
    throw deny(400, "มีระดับนี้หรือสูงกว่าอยู่แล้ว");
  }
  await pool.query(
    "UPDATE phra_users SET requested_level=$2, requested_at=now(), updated_at=now() WHERE id=$1",
    [user.id, lv]
  );
  const r = await pool.query("SELECT * FROM phra_users WHERE id=$1", [user.id]);
  return publicUser(r.rows[0]);
}

async function approveRequestedLevel(pool, actor, targetId, body) {
  const id = Number(targetId);
  if (!id) throw deny(400, "ไม่พบผู้ใช้");
  const cur = await pool.query("SELECT * FROM phra_users WHERE id=$1", [id]);
  if (!cur.rowCount) throw deny(404, "ไม่พบผู้ใช้");
  const target = publicUser(cur.rows[0]);
  if (!canApproveRequested(actor, target)) throw deny(403, "ไม่มีสิทธิ์อนุมัติคำขอนี้");
  const want = target.requestedLevel;
  let sangha = clean(body && (body.sanghaTambon || body.sangha_tambon));
  if (want === "tambon" && !sangha) throw deny(400, "เลือกตำบลคณะสงฆ์เมื่ออนุมัติ");
  if (want !== "tambon") sangha = cur.rows[0].sangha_tambon || "";
  const r = await pool.query(
    `UPDATE phra_users SET access_level=$2, sangha_tambon=$3, requested_level='', requested_at=NULL, updated_at=now()
      WHERE id=$1 RETURNING *`,
    [id, want, sangha]
  );
  return publicUser(r.rows[0]);
}

async function rejectRequestedLevel(pool, actor, targetId) {
  const id = Number(targetId);
  if (!id) throw deny(400, "ไม่พบผู้ใช้");
  const cur = await pool.query("SELECT * FROM phra_users WHERE id=$1", [id]);
  if (!cur.rowCount) throw deny(404, "ไม่พบผู้ใช้");
  const target = publicUser(cur.rows[0]);
  if (!canApproveRequested(actor, target)) throw deny(403, "ไม่มีสิทธิ์ปฏิเสธคำขอนี้");
  const r = await pool.query(
    "UPDATE phra_users SET requested_level='', requested_at=NULL, updated_at=now() WHERE id=$1 RETURNING *",
    [id]
  );
  return publicUser(r.rows[0]);
}

module.exports = {
  LEVELS,
  ACCESS_LABEL,
  COOKIE,
  deny,
  parseAccessLevel,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  publicUser,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  appendViewScope,
  appendHomeScope,
  insertBeforeOrderBy,
  watInScope,
  filterWats,
  filterWatsForPlaces,
  filterSanghaTambons,
  scopePlaces,
  canManagePlaces,
  assertPlaceWrite,
  homeBodyInScope,
  lookupWat,
  assertNewMonkInScope,
  applyWatUserHome,
  ensureAuthSchema,
  seedAdmin,
  applyAdminPassword,
  loadSession,
  createSession,
  destroySession,
  loginAllowed,
  login,
  isLocalPasswordHash,
  fillUserScope,
  readUserBody,
  requireAuth,
  requireAdmin,
  requireUserManager,
  canManageUsers,
  canApproveRequested,
  usersVisibleWhere,
  registerUser,
  requestLevel,
  approveRequestedLevel,
  rejectRequestedLevel
};
