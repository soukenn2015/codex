import { readFile } from "node:fs/promises";
import {
  explorationTaskMatchesProduct,
  selectProductExplorationTasks,
} from "./marketlens-exploration-affinity.mjs";

const snapshotPath = new URL("../data/marketlens.snapshot.json", import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main() {
  const product = {
    canonicalName: "G-SHOCK GA-2100CC-3AJR",
    brand: "G-SHOCK",
    series: "GA-2100",
    category: "watch",
  };
  assert(
    !explorationTaskMatchesProduct({ query: "高級腕時計 新作", targetCategory: "watch" }, product),
    "同カテゴリだけの探索タスクが商品へ混入しています",
  );
  assert(
    !explorationTaskMatchesProduct({ query: "G-SHOCK 周年モデル", targetCategory: "watch" }, product),
    "query内のbrand文字列だけで探索タスクが商品へ混入しています",
  );
  assert(
    explorationTaskMatchesProduct({ query: "G-SHOCK GA-2100CC-3AJR 在庫" }, product),
    "正式商品名を含む探索タスクが一致しません",
  );
  assert(explorationTaskMatchesProduct({ brand: "G-SHOCK" }, product), "明示brandが一致しません");
  assert(explorationTaskMatchesProduct({ series: "GA-2100" }, product), "明示seriesが一致しません");
  assert(
    explorationTaskMatchesProduct({ topic: "Ｇ－ＳＨＯＣＫ　ＧＡ－２１００ＣＣ－３ＡＪＲ 再販" }, product),
    "全角の商品名を含むtopicが一致しません",
  );

  const selectedTasks = selectProductExplorationTasks(
    [
      { id: "category-only", query: "高級腕時計 新作", targetCategory: "watch" },
      { id: "loose-brand", query: "G-SHOCK 周年モデル", targetCategory: "watch" },
      { id: "name", query: "G-SHOCK GA-2100CC-3AJR 在庫" },
      { id: "brand", brand: "G-SHOCK" },
      { id: "series", series: "GA-2100" },
      { id: "other-series", series: "DW-5600", targetCategory: "watch" },
    ],
    product,
  );
  assert(
    selectedTasks.map((task) => task.id).join(",") === "name,brand,series",
    `探索タスクの絞り込み結果が不正です: ${selectedTasks.map((task) => task.id).join(",")}`,
  );

  const raw = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(raw);

  assert(snapshot?.metadata, "metadata がありません");
  assert(Number.isInteger(snapshot.metadata.reachableSources), "reachableSources が不正です");
  assert(Number.isInteger(snapshot.metadata.totalSources), "totalSources が不正です");
  assert(snapshot.metadata.reachableSources <= snapshot.metadata.totalSources, "取得件数が総数を超えています");

  const trends = Array.isArray(snapshot.trends) ? snapshot.trends : [];
  const candidates = Array.isArray(snapshot.discoveryCandidates) ? snapshot.discoveryCandidates : [];
  const trendPool = Array.isArray(snapshot.trendCollectionPool) ? snapshot.trendCollectionPool : [];
  const archivedConcrete = Array.isArray(snapshot.archivedConcreteTrends) ? snapshot.archivedConcreteTrends : [];

  for (const trend of trends) {
    assert(trend.keyword, "trend.keyword が空です");
    assert(isIsoDate(trend.startDate), `trend.startDate が不正です: ${trend.keyword}`);
    assert(isIsoDate(trend.endDate), `trend.endDate が不正です: ${trend.keyword}`);
  }

  for (const candidate of candidates) {
    assert(candidate.name, "candidate.name が空です");
    assert(isIsoDate(candidate.startDate), `candidate.startDate が不正です: ${candidate.name}`);
    assert(isIsoDate(candidate.endDate), `candidate.endDate が不正です: ${candidate.name}`);
    if (String(candidate.marketPriceSource ?? "").includes("specialized-search")) {
      assert(candidate.marketObservedAt, `specialized-search なのに marketObservedAt がありません: ${candidate.name}`);
    }
  }

  assert(trendPool.length >= trends.length, "trendCollectionPool が不足しています");
  for (const item of trendPool) {
    assert(item.keyword, "trendCollectionPool.keyword が空です");
    assert(item.type === "specific" || item.type === "broad", `trendCollectionPool.type が不正です: ${item.type}`);
  }

  for (const archived of archivedConcrete) {
    assert(archived.keyword, "archivedConcrete.keyword が空です");
    assert(archived.reason, "archivedConcrete.reason が空です");
  }

  console.log(
    `Regression checks passed: trends=${trends.length}, candidates=${candidates.length}, trendPool=${trendPool.length}, archived=${archivedConcrete.length}`,
  );
}

main().catch((error) => {
  console.error(`Regression check failed: ${error.message}`);
  process.exitCode = 1;
});
