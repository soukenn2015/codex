#!/usr/bin/env node

import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write("usage: node .ai-ops/bin/measure-text.mjs <file> [file ...]\n");
  process.exit(1);
}

const results = files.map((file) => {
  const text = readFileSync(file, "utf8");
  const bytes = Buffer.byteLength(text);
  return {
    file,
    bytes,
    lines: text ? text.split(/\r?\n/).length : 0,
    approxTokens: Math.ceil(bytes / 4),
  };
});

process.stdout.write(`${JSON.stringify({
  files: results,
  approximation: "UTF-8 bytes divided by 4; use only as a rough comparison.",
}, null, 2)}\n`);
