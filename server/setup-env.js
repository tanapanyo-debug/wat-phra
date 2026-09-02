const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const dest = path.join(__dirname, ".env");
const accountingEnv = path.join("D:", "WatAccounting", "backend", ".env");

function parseUrl(raw) {
  const u = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
  const m = u.match(/^(postgres(?:ql)?):\/\/([^/]+)\/([^?]*)(.*)$/i);
  if (!m) return { original: u, admin: u, phra: u };
  return {
    original: u,
    admin: m[1] + "://" + m[2] + "/postgres" + (m[4] || ""),
    phra: m[1] + "://" + m[2] + "/wat_phra" + (m[4] || "")
  };
}

function readKey(file, key) {
  if (!fs.existsSync(file)) return "";
  const m = fs.readFileSync(file, "utf8").match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

(async () => {
  let dbUrl = "postgres://postgres:password@localhost:5432/wat_phra";
  const fromAccounting = readKey(accountingEnv, "DATABASE_URL");
  if (fromAccounting) dbUrl = parseUrl(fromAccounting).phra;

  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, [
      "DATABASE_URL=" + dbUrl,
      "BIND_HOST=127.0.0.1",
      "PORT=4200",
      "PHRA_ADMIN_USER=admin",
      "# PHRA_ADMIN_PASSWORD=",
      "ACCOUNTING_DATABASE_URL=" + parseUrl(fromAccounting || dbUrl).original.replace("/wat_phra", "/wat_accounting"),
      ""
    ].join("\n"), "utf8");
    console.log("wrote server/.env → ฐาน wat_phra พอร์ต 4200");
  } else {
    console.log("server/.env already exists");
    dbUrl = readKey(dest, "DATABASE_URL") || dbUrl;
  }

  const urls = parseUrl(dbUrl);
  const c = new Client({
    connectionString: urls.admin,
    ssl: String(urls.admin).includes("localhost") ? false : { rejectUnauthorized: false }
  });
  try {
    await c.connect();
    const r = await c.query("SELECT 1 FROM pg_database WHERE datname = 'wat_phra'");
    if (!r.rowCount) {
      await c.query("CREATE DATABASE wat_phra");
      console.log("created database wat_phra");
    } else {
      console.log("database wat_phra already exists");
    }
    await c.end();
  } catch (e) {
    try { await c.end(); } catch (x) {}
    console.log("could not create database:", e.code || e.message);
    process.exitCode = 1;
  }
})();
