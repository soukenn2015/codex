/**
 * prediction-accuracy.mjs — 予測 vs 実売の学習ループ
 */

import { readFile, writeFile } from "node:fs/promises";
import { normalizeProductKey, candidateJpyPrice } from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);

function tierValue(group) {
  const tier = group?.judgment?.tier;
  if (!tier) return "HOLD";
  return typeof tier === "object" ? tier.value : tier;
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  const signalsByKey = new Map(
    (snapshot.marketplaceSignals ?? []).map((row) => [normalizeProductKey(row.productKey ?? row.productName ?? ""), row]),
  );

  const records = [];
  const categoryStats = {};

  for (const group of snapshot.productGroups ?? []) {
    const key = normalizeProductKey(group.canonicalName ?? "");
    const reason = group.judgment?.reason ?? {};
    const predictedMax = Number(reason.profitMax ?? 0);
    if (!predictedMax || !key) continue;

    const signal = signalsByKey.get(key);
    const soldPrices = (signal?.soldCandidates ?? [])
      .map(candidateJpyPrice)
      .filter(Number.isFinite);
    if (!soldPrices.length) continue;

    const actual = soldPrices.sort((a, b) => a - b)[Math.floor(soldPrices.length / 2)];
    const buy = Number(reason.buyPrice ?? reason.retailPrice ?? 0) || null;
    const actualProfit = buy && actual > buy ? actual - buy : null;
    const predictedProfit = predictedMax;
    const errorPct = actualProfit
      ? Math.abs(actualProfit - predictedProfit) / Math.max(predictedProfit, 1)
      : null;

    const category = group.category ?? "other";
    categoryStats[category] = categoryStats[category] ?? { count: 0, mapeSum: 0 };
    if (errorPct != null) {
      categoryStats[category].count += 1;
      categoryStats[category].mapeSum += errorPct;
    }

    records.push({
      productKey: key,
      productName: group.canonicalName,
      tier: tierValue(group),
      predictedProfit,
      actualProfit,
      errorPct: errorPct != null ? Number(errorPct.toFixed(3)) : null,
      observedAt: new Date().toISOString(),
    });
  }

  snapshot.predictionAccuracy = {
    observedAt: new Date().toISOString(),
    recordCount: records.length,
    records: records.slice(0, 100),
    categoryStats: Object.fromEntries(
      Object.entries(categoryStats).map(([cat, stat]) => [
        cat,
        {
          count: stat.count,
          mape: stat.count ? Number((stat.mapeSum / stat.count).toFixed(3)) : null,
        },
      ]),
    ),
  };

  snapshot.productLearning = [
    ...(snapshot.productLearning ?? []).filter((row) => row.kind !== "prediction_accuracy"),
    ...records.slice(0, 50).map((row) => ({
      kind: "prediction_accuracy",
      key: row.productKey,
      predictedProfit: row.predictedProfit,
      actualProfit: row.actualProfit,
      errorPct: row.errorPct,
      updatedAt: row.observedAt,
    })),
  ].slice(-500);

  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[prediction-accuracy] records=${records.length}`);
}

main().catch((error) => {
  console.error("[prediction-accuracy] fatal:", error?.message ?? error);
  process.exit(1);
});
