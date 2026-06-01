import { readFile } from "node:fs/promises";

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

