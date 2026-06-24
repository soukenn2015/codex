/**
 * import-x-accounts.mjs — x-accounts.json を source-config trendCandidate へ merge
 */

import { readFile, writeFile } from "node:fs/promises";
import { compactText } from "./marketlens-shared.mjs";

const xAccountsUrl = new URL("../data/x-accounts.json", import.meta.url);
const sourceConfigUrl = new URL("../data/source-config.json", import.meta.url);
const MAX_ACCOUNTS = Math.max(10, Math.min(500, Number(process.env.MARKETLENS_X_ACCOUNT_LIMIT ?? 500)));

async function main() {
  const [xRaw, cfgRaw] = await Promise.all([
    readFile(xAccountsUrl, "utf8").catch(() => "{}"),
    readFile(sourceConfigUrl, "utf8"),
  ]);
  const xData = JSON.parse(xRaw);
  const sourceConfig = JSON.parse(cfgRaw);
  const handles = (Array.isArray(xData.accounts) ? xData.accounts : [])
    .map((row) => (typeof row === "string" ? row : row?.handle))
    .map((h) => compactText(h).replace(/^@/, ""))
    .filter(Boolean)
    .slice(0, MAX_ACCOUNTS);

  const existing = new Set(
    (sourceConfig.trendCandidate ?? [])
      .map((row) => compactText(row.account ?? row.handle ?? "").replace(/^@/, ""))
      .filter(Boolean),
  );

  let added = 0;
  for (const handle of handles) {
    if (existing.has(handle)) continue;
    sourceConfig.trendCandidate = sourceConfig.trendCandidate ?? [];
    sourceConfig.trendCandidate.push({
      account: handle,
      label: `@${handle}`,
      lane: "sns",
      reason: "x-accounts seed import",
    });
    existing.add(handle);
    added += 1;
  }

  await writeFile(sourceConfigUrl, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");
  console.log(`[import-x-accounts] added=${added} totalTrendCandidates=${sourceConfig.trendCandidate.length}`);
}

main().catch((error) => {
  console.error("[import-x-accounts] fatal:", error?.message ?? error);
  process.exit(1);
});
