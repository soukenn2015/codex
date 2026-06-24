/**
 * marketlens-screening.mjs — Layer 3: Flash-Lite スクリーニング
 */

import { readFile, writeFile } from "node:fs/promises";
import { compactText } from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const MODEL = process.env.MARKETLENS_SCREENING_MODEL || "gemini-2.5-flash-lite";
const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const geminiBaseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const BATCH = Math.max(5, Math.min(20, Number(process.env.MARKETLENS_SCREENING_BATCH ?? 10)));

function isLikelyProduct(name = "") {
  const text = compactText(name);
  if (text.length < 4 || text.length > 90) return false;
  if (/@[\w_]+|速報|まとめ|情報源/.test(text)) return false;
  if (/[<>]|https?:\/\//i.test(text)) return false;
  return true;
}

async function screenBatch(names) {
  if (!geminiApiKey) {
    return names.map((name, index) => ({ index, isProduct: isLikelyProduct(name), isResaleTarget: isLikelyProduct(name) }));
  }
  const url = `${geminiBaseUrl}/models/${MODEL}:generateContent?key=${geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: `For each item, answer isProduct and isResaleTarget (boolean). JSON array.\n${JSON.stringify(names.map((name, index) => ({ index, name })))}`,
        }],
      }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) return names.map((name, index) => ({ index, isProduct: isLikelyProduct(name), isResaleTarget: isLikelyProduct(name) }));
  const data = await res.json();
  try {
    return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]");
  } catch {
    return names.map((name, index) => ({ index, isProduct: isLikelyProduct(name), isResaleTarget: isLikelyProduct(name) }));
  }
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  const groups = snapshot.productGroups ?? [];
  const pending = groups
    .map((g, index) => ({ index, name: g.canonicalName ?? "", group: g }))
    .filter((row) => !row.group.screening?.screenedAt);

  const screened = [];
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const results = await screenBatch(batch.map((row) => row.name));
    results.forEach((result, localIdx) => {
      const row = batch[localIdx];
      if (!row) return;
      row.group.screening = {
        screenedAt: new Date().toISOString(),
        isProduct: Boolean(result.isProduct ?? isLikelyProduct(row.name)),
        isResaleTarget: Boolean(result.isResaleTarget ?? isLikelyProduct(row.name)),
        model: geminiApiKey ? MODEL : "heuristic",
      };
      if (!row.group.screening.isProduct || !row.group.screening.isResaleTarget) {
        row.group.judgment = {
          ...(row.group.judgment ?? {}),
          tier: "HOLD",
          decisionOrigin: row.group.judgment?.decisionOrigin ?? "screening",
          reason: {
            ...(row.group.judgment?.reason ?? {}),
            headline: "スクリーニング不通過",
            detail: "商品名として不適切、または転売対象カテゴリ外と判定されました。",
          },
        };
      }
      screened.push(row.index);
    });
  }

  snapshot.metadata.screening = {
    observedAt: new Date().toISOString(),
    screenedCount: screened.length,
    pendingCount: pending.length,
  };
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[screening] screened=${screened.length}/${pending.length}`);
}

main().catch((error) => {
  console.error("[screening] fatal:", error?.message ?? error);
  process.exit(1);
});
