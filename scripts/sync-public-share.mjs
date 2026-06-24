#!/usr/bin/env node
/**
 * Build public-share/ with only files safe for external/static sharing.
 * Does not copy source-config, history, scripts, secrets, or dev markdown.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public-share");

const PUBLIC_FILES = [
  "index.html",
  "styles.css",
  "script.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "data/marketlens.ui-snapshot.json",
];

function copyIfExists(rel) {
  const src = path.join(ROOT, rel);
  const dest = path.join(OUT, rel);
  if (!statSync(src, { throwIfNoEntry: false })) {
    throw new Error(`missing required public file: ${rel}`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const rel of PUBLIC_FILES) {
  copyIfExists(rel);
}

const publicIndexPath = path.join(OUT, "index.html");
const publicIndex = readFileSync(publicIndexPath, "utf8");
if (!publicIndex.includes('name="marketlens-surface"')) {
  writeFileSync(
    publicIndexPath,
    publicIndex.replace("</head>", '    <meta name="marketlens-surface" content="public-share" />\n  </head>'),
  );
}

writeFileSync(
  path.join(OUT, "README.txt"),
  [
    "MarketLens public-share (auto-generated)",
    "",
    "Serve from this directory only:",
    "  node scripts/serve-public-share.mjs",
    "  # or: cd public-share && python3 -m http.server 8765",
    "",
    "Do not add source-config, history, scripts, secrets, or dev markdown here.",
  ].join("\n"),
);

console.log(`public-share synced: ${PUBLIC_FILES.length} files → ${OUT}`);
for (const rel of PUBLIC_FILES) {
  console.log(`  + ${rel}`);
}
