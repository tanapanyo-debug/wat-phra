const zlib = require("zlib");

function findEOCD(buf) {
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function unzip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw Object.assign(new Error("ไม่ใช่ไฟล์ Excel (.xlsx)"), { status: 400 });
  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const files = {};
  let o = cdOff;
  for (let i = 0; i < count; i++) {
    if (o + 46 > buf.length || buf.readUInt32LE(o) !== 0x02014b50) break;
    const method = buf.readUInt16LE(o + 10);
    const comp = buf.readUInt32LE(o + 20);
    const nameLen = buf.readUInt16LE(o + 28);
    const extraLen = buf.readUInt16LE(o + 30);
    const commentLen = buf.readUInt16LE(o + 32);
    const localOff = buf.readUInt32LE(o + 42);
    const name = buf.slice(o + 46, o + 46 + nameLen).toString("utf8").replace(/\\/g, "/");
    if (localOff + 30 > buf.length) break;
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    const raw = buf.slice(dataStart, dataStart + comp);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw Object.assign(new Error("ไม่รองรับไฟล์ Excel นี้"), { status: 400 });
    files[name] = data;
    o += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripNs(xml) {
  return String(xml || "").replace(/<\/?([A-Za-z0-9]+):/g, function (m) {
    return m.charAt(1) === "/" ? "</" : "<";
  });
}

function colOf(a) {
  let n = 0;
  for (let i = 0; i < a.length; i++) n = n * 26 + (a.charCodeAt(i) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  const out = [];
  stripNs(xml).replace(/<si[\s>][\s\S]*?<\/si>/g, function (si) {
    let s = "";
    si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, function (_, t) {
      s += decodeXml(t);
      return "";
    });
    out.push(s);
    return "";
  });
  return out;
}

function cellText(cellXml, strings) {
    const tm = /\bt="([^"]+)"/.exec(cellXml);
  const type = tm ? tm[1] : "";
  if (type === "inlineStr") {
    const m = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellXml);
    return decodeXml(m ? m[1] : "").trim();
  }
  const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellXml);
  if (!v) return "";
  if (type === "s") return String(strings[Number(v[1])] || "").trim();
  return decodeXml(v[1]).trim();
}

function parseSheet(xml, strings) {
  const body = stripNs(xml);
  const rows = [];
  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(body))) {
    const r = Number(m[1]);
    const cells = [];
    const re = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let c;
    while ((c = re.exec(m[2]))) {
      const attrs = c[1] || c[2] || "";
      const inner = c[3] || "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const i = colOf(ref[1]);
      while (cells.length <= i) cells.push("");
      cells[i] = cellText("<c " + attrs + ">" + inner + "</c>", strings);
    }
    rows[r - 1] = cells;
  }
  return rows;
}

function readWorkbook(buf) {
  const files = unzip(buf);
  function get(name) {
    const hit = Object.keys(files).find(function (k) {
      return k.replace(/^\/+/, "").toLowerCase() === name.toLowerCase();
    });
    return hit ? files[hit].toString("utf8") : "";
  }
  const strings = parseSharedStrings(get("xl/sharedStrings.xml"));
  const relXml = stripNs(get("xl/_rels/workbook.xml.rels"));
  const rels = {};
  relXml.replace(/<Relationship\b([^>]*)\/>/g, function (_, attrs) {
    const id = /Id="([^"]+)"/.exec(attrs);
    const target = /Target="([^"]+)"/.exec(attrs);
    if (id && target) rels[id[1]] = target[1].replace(/^\//, "").replace(/^xl\//, "");
    return "";
  });
  const wb = stripNs(get("xl/workbook.xml"));
  const sheets = {};
  wb.replace(/<sheet\b([^>]+)/g, function (_, attrs) {
    const name = /\bname="([^"]+)"/.exec(attrs);
    const rid = /\br:id="([^"]+)"/i.exec(attrs) || /\brid="([^"]+)"/i.exec(attrs);
    if (!name || !rid) return "";
    const target = rels[rid[1]] || "";
    const path = target.indexOf("xl/") === 0 ? target : "xl/" + target.replace(/^\.\//, "");
    sheets[name[1]] = parseSheet(get(path), strings);
    return "";
  });
  return sheets;
}

module.exports = { unzip, readWorkbook };
