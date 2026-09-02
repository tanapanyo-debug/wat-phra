const fs = require("fs");
const xml = fs.readFileSync(process.env.TEMP + "/phra-src/bio88/word/document.xml", "utf8");

function cellText(cell) {
  return cell
    .replace(/<w:tab[^/]*\/>/g, "\t")
    .replace(/<w:br[^/]*\/>/g, "\n")
    .replace(/<w:cr[^/]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const tables = [];
const tableRe = /<w:tbl[\s\S]*?<\/w:tbl>/g;
let tm;
while ((tm = tableRe.exec(xml))) {
  const rows = [];
  const rowRe = /<w:tr[\s\S]*?<\/w:tr>/g;
  let rm;
  while ((rm = rowRe.exec(tm[0]))) {
    const cells = [];
    const cellRe = /<w:tc[\s\S]*?<\/w:tc>/g;
    let cm;
    while ((cm = cellRe.exec(rm[0]))) cells.push(cellText(cm[0]));
    rows.push(cells);
  }
  tables.push(rows);
}

const paras = [];
const body = xml.replace(/<w:tbl[\s\S]*?<\/w:tbl>/g, "\n[[TABLE]]\n");
const pRe = /<w:p[\s\S]*?<\/w:p>/g;
let pm;
while ((pm = pRe.exec(body))) {
  const t = cellText(pm[0]);
  if (t && t !== "[[TABLE]]") paras.push(t);
}

const out = [];
out.push("tables " + tables.length + " paras " + paras.length);
out.push("---PARA---");
paras.forEach((p, i) => out.push(String(i).padStart(3, " ") + "|" + p));
out.push("---TABLES---");
tables.forEach((rows, ti) => {
  out.push("\n==== TABLE " + ti + " rows " + rows.length + " ====");
  rows.forEach((r, ri) => {
    out.push("R" + ri + " (" + r.length + ") " + r.map((c, ci) => "[" + ci + "]" + c).join(" | "));
  });
});
const dest = process.env.TEMP + "/phra-src/bio88/peek.txt";
fs.writeFileSync(dest, out.join("\n"), "utf8");
console.log("wrote", dest, "chars", out.join("\n").length);
