import { readFile } from "node:fs/promises";

const snapshotPath = new URL("../data/marketlens.snapshot.json", import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isDateActive(endDate) {
  if (!endDate) return true;
  const ts = new Date(`${endDate}T23:59:59+09:00`).getTime();
  return Number.isFinite(ts) && ts >= Date.now();
}

function marketFreshnessLabel(observedAt) {
  if (!observedAt) return "未取得";
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) return "未取得";
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays <= 1) return "新しい";
  if (ageDays <= 3) return "通常";
  return "要更新";
}

function candidateValidationState(candidate) {
  const periodKnown = Boolean(candidate.startDate && candidate.endDate);
  const periodActive = candidate.endDate ? isDateActive(candidate.endDate) : true;
  const hasPrice = Number.isFinite(candidate?.retailPrice) && Number.isFinite(candidate?.marketPrice);
  const hasRoute = Boolean(candidate.sourceUrl);
  if (!periodKnown) return "missing_period";
  if (!periodActive) return "ended";
  if (!hasPrice) return "missing_price";
  if (marketFreshnessLabel(candidate.marketObservedAt) === "要更新") return "stale_price";
  if (!hasRoute) return "missing_route";
  return "ready";
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const candidates = Array.isArray(snapshot.discoveryCandidates) ? snapshot.discoveryCandidates : [];

  const states = new Map();
  for (const c of candidates) {
    states.set(c.name, candidateValidationState(c));
  }

  // invariant 1: 期間切れ候補は ready にならない
  for (const c of candidates) {
    if (c.endDate && !isDateActive(c.endDate)) {
      assert(candidateValidationState(c) !== "ready", `期限切れがready: ${c.name}`);
    }
  }

  // invariant 2: specialized-search 由来で時刻があれば stale/ready のどちらかになる
  for (const c of candidates) {
    if (String(c.marketPriceSource ?? "").includes("specialized-search") && c.marketObservedAt) {
      const st = candidateValidationState(c);
      assert(st === "ready" || st === "stale_price" || st === "missing_route", `specialized-search状態が不正: ${c.name} -> ${st}`);
    }
  }

  // invariant 3: 状態は許可された値のみ
  const allowed = new Set(["missing_period", "ended", "missing_price", "stale_price", "missing_route", "ready"]);
  for (const [name, st] of states.entries()) {
    assert(allowed.has(st), `未知状態: ${name} -> ${st}`);
  }

  const counts = [...states.values()].reduce((acc, st) => {
    acc[st] = (acc[st] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`UI regression checks passed: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(`UI regression check failed: ${e.message}`);
  process.exitCode = 1;
});

