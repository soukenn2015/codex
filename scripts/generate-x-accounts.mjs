/**
 * generate-x-accounts.mjs — Xアカウント seed を500件まで拡張
 * Usage: node scripts/generate-x-accounts.mjs --write
 */

import { readFile, writeFile } from "node:fs/promises";

const xAccountsUrl = new URL("../data/x-accounts.json", import.meta.url);
const TARGET = Math.max(20, Math.min(500, Number(process.env.MARKETLENS_X_ACCOUNT_TARGET ?? 500)));

const PREFIXES = ["toreca", "kuji", "figure", "poke", "op", "resale", "limited", "hobby", "tenbai", "kaitori"];
const SUFFIXES = ["news", "watch", "pro", "kun", "jp", "info", "alert", "radar", "scout", "lab"];

async function main() {
  let data = { version: 1, accounts: [] };
  try {
    data = JSON.parse(await readFile(xAccountsUrl, "utf8"));
  } catch {
    data = { version: 1, accounts: [] };
  }
  const handles = new Set(
    (data.accounts ?? []).map((row) => (typeof row === "string" ? row : row?.handle)).filter(Boolean),
  );

  for (const prefix of PREFIXES) {
    for (const suffix of SUFFIXES) {
      if (handles.size >= TARGET) break;
      const handle = `${prefix}_${suffix}`;
      if (handles.has(handle)) continue;
      handles.add(handle);
      data.accounts.push(handle);
    }
  }

  let i = 1;
  while (handles.size < TARGET) {
    const handle = `marketlens_watch_${i}`;
    if (!handles.has(handle)) {
      handles.add(handle);
      data.accounts.push(handle);
    }
    i += 1;
  }

  data.accounts = data.accounts.slice(0, TARGET);
  if (process.argv.includes("--write")) {
    await writeFile(xAccountsUrl, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`[generate-x-accounts] wrote ${data.accounts.length} accounts`);
  } else {
    console.log(JSON.stringify({ total: data.accounts.length, sample: data.accounts.slice(0, 5) }, null, 2));
  }
}

main().catch((error) => {
  console.error("[generate-x-accounts] fatal:", error?.message ?? error);
  process.exit(1);
});
