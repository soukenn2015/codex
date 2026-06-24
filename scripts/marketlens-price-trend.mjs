/**
 * marketlens-price-trend.mjs — 7日 vs 今日の急上昇検出（20%以上）
 */

import { readFile, writeFile } from "node:fs/promises";
import { candidateJpyPrice, normalizeProductKey } from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const historyUrl = new URL("../data/marketlens.history.json", import.meta.url);
const RISE_THRESHOLD = Number(process.env.MARKETLENS_PRICE_RISE_THRESHOLD ?? 0.2);

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const [snapshotRaw, historyRaw] = await Promise.all([
    readFile(snapshotUrl, "utf8"),
    readFile(historyUrl, "utf8").catch(() => '{"runs":[]}'),
  ]);
  const snapshot = JSON.parse(snapshotRaw);
  const history = JSON.parse(historyRaw);
  const weekAgo = Date.now() - 7 * 86400000;

  const historicalPrices = new Map();
  for (const run of (history.runs ?? []).slice(-14)) {
    const runAt = new Date(run.observedAt ?? run.snapshot?.metadata?.updatedAt ?? 0).getTime();
    if (!Number.isFinite(runAt) || runAt > weekAgo) continue;
    for (const signal of run.snapshot?.marketplaceSignals ?? []) {
      const key = normalizeProductKey(signal.productKey ?? signal.productName ?? "");
      if (!key) continue;
      const prices = (signal.listingCandidates ?? []).map(candidateJpyPrice).filter(Number.isFinite);
      const med = median(prices);
      if (med) historicalPrices.set(key, med);
    }
  }

  const alerts = [];
  for (const signal of snapshot.marketplaceSignals ?? []) {
    const key = normalizeProductKey(signal.productKey ?? signal.productName ?? "");
    const baseline = historicalPrices.get(key);
    const currentPrices = (signal.listingCandidates ?? []).map(candidateJpyPrice).filter(Number.isFinite);
    const current = median(currentPrices);
    if (!baseline || !current) continue;
    const riseRate = (current - baseline) / baseline;
    if (riseRate >= RISE_THRESHOLD) {
      alerts.push({
        productKey: key,
        productName: signal.productName,
        baseline,
        current,
        riseRate: Number(riseRate.toFixed(3)),
        observedAt: new Date().toISOString(),
      });
    }
  }

  snapshot.priceTrendAlerts = alerts;
  snapshot.metadata.priceTrendAlertCount = alerts.length;
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[price-trend] alerts=${alerts.length}`);
}

main().catch((error) => {
  console.error("[price-trend] fatal:", error?.message ?? error);
  process.exit(1);
});
