/**
 * marketlens-deep-dive.mjs — T1/T2 類似実績の深掘り
 */

import { readFile, writeFile } from "node:fs/promises";
import { compactText, normalizeProductKey } from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const MODEL = process.env.MARKETLENS_DEEP_DIVE_MODEL || "gemini-2.5-pro";
const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const geminiBaseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const LIMIT = Math.max(3, Math.min(30, Number(process.env.MARKETLENS_DEEP_DIVE_LIMIT ?? 15)));

function tierValue(group) {
  const tier = group?.judgment?.tier;
  if (!tier) return "HOLD";
  return typeof tier === "object" ? tier.value : tier;
}

async function analyze(group, comparables) {
  if (!geminiApiKey) {
    return comparables.slice(0, 3).map((row) => ({
      name: row.comparableName ?? row.comparableKey,
      soldPrice: row.launchPrice ?? null,
      note: "historical comparable",
    }));
  }
  const url = `${geminiBaseUrl}/models/${MODEL}:generateContent?key=${geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: `Product: ${group.canonicalName}\nComparables: ${JSON.stringify(comparables.slice(0, 5))}\nReturn JSON { similar_products: [{ name, soldPrice, note }] }`,
        }],
      }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  try {
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    return parsed.similar_products ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  const comparablesByKey = new Map();
  for (const row of snapshot.historicalComparables ?? []) {
    const key = normalizeProductKey(row.productKey ?? row.comparableKey ?? "");
    if (!key) continue;
    const list = comparablesByKey.get(key) ?? [];
    list.push(row);
    comparablesByKey.set(key, list);
  }

  const targets = (snapshot.productGroups ?? [])
    .filter((g) => ["T1", "T2"].includes(tierValue(g)))
    .slice(0, LIMIT);

  let enriched = 0;
  for (const group of targets) {
    const key = normalizeProductKey(group.canonicalName ?? "");
    const comparables = comparablesByKey.get(key) ?? [];
    const similar = await analyze(group, comparables);
    if (!similar.length) continue;
    group.judgment = group.judgment ?? {};
    group.judgment.reason = group.judgment.reason ?? {};
    group.judgment.reason.similar_products = similar;
    group.deepDive = { analyzedAt: new Date().toISOString(), model: geminiApiKey ? MODEL : "heuristic" };
    enriched += 1;
  }

  snapshot.metadata.deepDive = { observedAt: new Date().toISOString(), enrichedCount: enriched };
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[deep-dive] enriched=${enriched}/${targets.length}`);
}

main().catch((error) => {
  console.error("[deep-dive] fatal:", error?.message ?? error);
  process.exit(1);
});
