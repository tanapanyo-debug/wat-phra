const crypto = require("crypto");

const LOCAL_SECRET = "local-wat-phra-embed-v1";
const EMBED_COOKIE = "phra_embed";
const FRAME_ANCESTORS = [
  "'self'",
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  "https://wat-accounting.onrender.com",
  "https://banchiwat.com",
  "https://www.banchiwat.com"
];

function embedSecret() {
  const s = String(process.env.PHRA_EMBED_SECRET || "").trim();
  if (s) return s;
  if (process.env.RENDER) return "";
  return LOCAL_SECRET;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function parseEmbedAppScope(v) {
  return String(v || "").trim().toLowerCase() === "duties" ? "duties" : "all";
}

function signPhraEmbed(payload, secret, now) {
  const key = secret == null ? embedSecret() : String(secret);
  if (!key) throw new Error("ยังไม่ได้ตั้ง PHRA_EMBED_SECRET");
  const watName = String((payload && payload.watName) || "").replace(/\s+/g, " ").trim();
  if (!watName) throw new Error("ยังไม่ได้ตั้งชื่อวัด");
  const exp = Number((payload && payload.exp) || 0) || (Number(now || Date.now()) + 15 * 60 * 1000);
  const body = {
    v: 1,
    watName,
    email: String((payload && payload.email) || "").trim().toLowerCase(),
    exp,
    appScope: parseEmbedAppScope(payload && payload.appScope)
  };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", key).update(data).digest("base64url");
  return data + "." + sig;
}

function verifyPhraEmbed(token, secret, now) {
  const key = secret == null ? embedSecret() : String(secret);
  const raw = String(token || "").trim();
  const i = raw.lastIndexOf(".");
  if (!key || i < 8) return null;
  const data = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const want = crypto.createHmac("sha256", key).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(Buffer.from(data, "base64url").toString("utf8")); } catch (e) { return null; }
  if (!body || body.v !== 1) return null;
  const watName = String(body.watName || "").replace(/\s+/g, " ").trim();
  if (!watName) return null;
  if (Number(body.exp || 0) < Number(now || Date.now())) return null;
  return {
    watName,
    email: String(body.email || "").trim().toLowerCase(),
    exp: Number(body.exp),
    appScope: parseEmbedAppScope(body.appScope)
  };
}

function sameWatName(a, b) {
  const x = String(a || "").replace(/\s+/g, " ").trim().toLowerCase();
  const y = String(b || "").replace(/\s+/g, " ").trim().toLowerCase();
  return !!x && x === y;
}

function lockUserToWat(user, watName, watId) {
  const name = String(watName || "").replace(/\s+/g, " ").trim();
  if (!user || !name) return user;
  const mismatch = user.accessLevel === "wat" && user.watName && !sameWatName(user.watName, name);
  return Object.assign({}, user, {
    accessLevel: "wat",
    accessLabel: "วัด",
    watName: name,
    watId: watId || null,
    embedLocked: true,
    embedMismatch: !!mismatch
  });
}

function applyTicketAppScope(user, ticket) {
  if (!user || !ticket) return user;
  if (parseEmbedAppScope(ticket.appScope) !== "duties") return user;
  return Object.assign({}, user, {
    appScope: "duties",
    appLabel: "เฉพาะปฏิบัติศาสนกิจ"
  });
}

module.exports = {
  LOCAL_SECRET,
  EMBED_COOKIE,
  FRAME_ANCESTORS,
  embedSecret,
  parseEmbedAppScope,
  signPhraEmbed,
  verifyPhraEmbed,
  sameWatName,
  lockUserToWat,
  applyTicketAppScope
};
