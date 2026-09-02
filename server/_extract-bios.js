const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SRC = process.argv[2] || "E:\\เอกสารงานอำเภอ2563 - 2568\\งานอำเภอ 2566\\ข้อมูลพระ\\เก็บตก";
const OUT = path.join(process.env.TEMP, "phra-src", "bio88");
fs.mkdirSync(OUT, { recursive: true });

function listDocx(dir) {
  const raw = execFileSync("powershell.exe", [
    "-NoProfile", "-Command",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-ChildItem -LiteralPath '" +
      dir.replace(/'/g, "''") +
      "' -Filter *.docx | ForEach-Object { $_.FullName }"
  ], { encoding: "utf8" });
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function extractText(docxPath) {
  const tmp = path.join(OUT, "one");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const copy = path.join(tmp, "bio.docx");
  fs.copyFileSync(docxPath, copy);
  execFileSync("tar", ["-xf", copy, "-C", tmp]);
  const xml = fs.readFileSync(path.join(tmp, "word", "document.xml"), "utf8");
  const paras = [];
  const pRe = /<w:p[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = pRe.exec(xml))) {
    const t = m[0]
      .replace(/<w:tab[^/]*\/>/g, " ")
      .replace(/<w:br[^/]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (t) paras.push(t);
  }
  return paras.join("\n");
}

const files = listDocx(SRC);
const index = [];
files.forEach((f, i) => {
  const text = extractText(f);
  const dest = path.join(OUT, "file-" + i + ".txt");
  fs.writeFileSync(dest, "FILE " + path.basename(f) + "\n" + text, "utf8");
  const starts = (text.match(/ส่วนที่ 2\s*:/g) || []).length;
  const chayaHits = (text.match(/ฉายา/g) || []).length;
  index.push({
    i,
    name: path.basename(f),
    chars: text.length,
    part2: starts,
    chayaHits,
    dest
  });
});
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2), "utf8");
console.log(JSON.stringify(index, null, 2));
