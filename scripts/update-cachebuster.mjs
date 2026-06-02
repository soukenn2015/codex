import { readFile, writeFile } from "node:fs/promises";

const indexUrl = new URL("../index.html", import.meta.url);
const now = new Date();
const stamp = [
  now.getUTCFullYear(),
  String(now.getUTCMonth() + 1).padStart(2, "0"),
  String(now.getUTCDate()).padStart(2, "0"),
  String(now.getUTCHours()).padStart(2, "0"),
  String(now.getUTCMinutes()).padStart(2, "0"),
].join("");

const html = await readFile(indexUrl, "utf8");
const updated = html
  .replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${stamp}`)
  .replace(/script\.js\?v=[^"']+/g, `script.js?v=${stamp}`);

if (updated !== html) {
  await writeFile(indexUrl, updated);
}

console.log(`MarketLens cachebuster: ${stamp}`);
