const nodemailer = require("nodemailer");

function cleanPass(pass) {
  return String(pass || "").replace(/\s/g, "");
}

function envSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = cleanPass(process.env.SMTP_PASS);
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: host || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
    from: String(process.env.MAIL_FROM || user).trim()
  };
}

async function dbSmtpConfig(pool) {
  try {
    const r = await pool.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, mail_from
         FROM phra_mail_settings WHERE id = 1`
    );
    const row = r.rows[0];
    if (!row) return null;
    const user = String(row.smtp_user || "").trim();
    const pass = cleanPass(row.smtp_pass);
    if (!user || !pass) return null;
    const port = Number(row.smtp_port || 587);
    return {
      host: String(row.smtp_host || "smtp.gmail.com").trim() || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user, pass },
      from: String(row.mail_from || user).trim() || user
    };
  } catch (e) {
    return null;
  }
}

async function smtpConfig(pool) {
  return envSmtpConfig() || (await dbSmtpConfig(pool));
}

async function isMailConfigured(pool) {
  return !!(await smtpConfig(pool));
}

function mailErrorMessage(err) {
  const msg = String((err && (err.response || err.message)) || "");
  if (/Invalid login|EAUTH|Username and Password not accepted|BadCredentials/i.test(msg)) {
    return "จีเมลไม่รับรหัสนี้ ต้องใช้รหัสผ่านแอป 16 ตัว ไม่ใช่รหัสเข้าจีเมล และต้องเปิดยืนยันตัวตน 2 ขั้นตอนไว้ก่อน";
  }
  if (/ECONNECTION|ETIMEDOUT|ENOTFOUND|ESOCKET/i.test(msg)) {
    return "เชื่อมต่อเซิร์ฟเวอร์เมลไม่สำเร็จ ตรวจเน็ตแล้วลองใหม่";
  }
  return "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

async function sendMail(pool, { to, subject, text, html }) {
  const cfg = await smtpConfig(pool);
  if (!cfg) {
    const err = new Error("ระบบยังไม่ได้ตั้งค่าการส่งอีเมล");
    err.code = "SMTP_NOT_CONFIGURED";
    throw err;
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth
  });
  await transporter.sendMail({
    from: cfg.from || cfg.auth.user,
    to,
    subject,
    text,
    html
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function publicMailSettings(pool) {
  const env = envSmtpConfig();
  let smtpHost = "smtp.gmail.com";
  let smtpPort = 587;
  let smtpUser = "";
  let mailFrom = "";
  let hasPassword = false;
  try {
    const r = await pool.query(
      "SELECT smtp_host, smtp_port, smtp_user, smtp_pass, mail_from FROM phra_mail_settings WHERE id = 1"
    );
    const row = r.rows[0];
    if (row) {
      smtpHost = String(row.smtp_host || smtpHost).trim() || smtpHost;
      smtpPort = Number(row.smtp_port || smtpPort) || smtpPort;
      smtpUser = String(row.smtp_user || "").trim();
      mailFrom = String(row.mail_from || "").trim();
      hasPassword = !!cleanPass(row.smtp_pass);
    }
  } catch (e) {}
  if (env) {
    smtpHost = env.host || smtpHost;
    smtpPort = env.port || smtpPort;
    smtpUser = env.auth.user || smtpUser;
    mailFrom = env.from || mailFrom;
    hasPassword = true;
  }
  return {
    configured: !!(await smtpConfig(pool)),
    smtpHost,
    smtpPort,
    smtpUser,
    mailFrom,
    hasPassword
  };
}

async function saveMailSettings(pool, body) {
  const host = String((body && body.smtpHost) || "smtp.gmail.com").trim() || "smtp.gmail.com";
  const port = Number((body && body.smtpPort) || 587) || 587;
  const user = String((body && body.smtpUser) || "").trim();
  const from = String((body && body.mailFrom) || user).trim();
  const pass = cleanPass(body && body.smtpPass);
  const cur = await pool.query("SELECT smtp_pass FROM phra_mail_settings WHERE id = 1");
  const keep = cur.rows[0] ? cur.rows[0].smtp_pass : "";
  const nextPass = pass || keep;
  await pool.query(
    `INSERT INTO phra_mail_settings (id, smtp_host, smtp_port, smtp_user, smtp_pass, mail_from)
     VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       smtp_user = EXCLUDED.smtp_user,
       smtp_pass = CASE WHEN EXCLUDED.smtp_pass = '' THEN phra_mail_settings.smtp_pass ELSE EXCLUDED.smtp_pass END,
       mail_from = EXCLUDED.mail_from`,
    [host, port, user, nextPass, from]
  );
  return publicMailSettings(pool);
}

module.exports = {
  isMailConfigured,
  sendMail,
  mailErrorMessage,
  publicMailSettings,
  saveMailSettings,
  escapeHtml
};
