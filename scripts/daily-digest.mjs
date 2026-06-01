import { readFile } from "node:fs/promises";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);

const settings = {
  feeRate: 5,
  targetProfit: 1500,
  priceBuffer: 3,
  packingCost: 80,
};

const shippingRules = {
  pokemon_box: 210,
  thin: 210,
  large: 750,
  unknown: 750,
};

const pokemonReleaseMaxAgeDays = 153;

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function calculateDeal(deal) {
  const fee = Math.round(deal.sellPrice * (settings.feeRate / 100));
  const buffer = Math.round(deal.sellPrice * (settings.priceBuffer / 100));
  const shipping = shippingRules[deal.category] ?? shippingRules.unknown;
  const profit = deal.sellPrice - fee - deal.buyPrice - shipping - settings.packingCost - buffer;
  const buyLine = deal.sellPrice - fee - shipping - settings.packingCost - buffer - settings.targetProfit;
  return { profit, buyLine };
}

function routeIsActive(route) {
  if (!route.startDate || new Date(route.startDate).getTime() <= Date.now()) {
    return !route.deadlineDate || new Date(route.deadlineDate).getTime() >= Date.now();
  }
  return false;
}

function releaseIsActive(release) {
  if (release.watchStatus === "archive") return false;
  if (release.saleStartDate && new Date(`${release.saleStartDate}T00:00:00+09:00`).getTime() > Date.now()) return false;
  if (release.saleEndDate && new Date(`${release.saleEndDate}T23:59:59+09:00`).getTime() < Date.now()) return false;
  if (release.releaseDate) {
    const ageDays = Math.floor((Date.now() - new Date(`${release.releaseDate}T00:00:00+09:00`).getTime()) / 86_400_000);
    if (ageDays > pokemonReleaseMaxAgeDays) return false;
  }
  return true;
}

function isKujiTrend(trend) {
  return /一番くじ|1kuji|kuji/i.test([trend.keyword, trend.type, trend.context, trend.source].join(" "));
}

function isKujiCandidate(candidate) {
  return /一番くじ|1kuji|kuji/i.test([candidate.name, candidate.trend].join(" "));
}

function normalizeSignalText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isDuplicateSignalCandidate(candidate) {
  const name = normalizeSignalText(candidate.name);
  const trend = normalizeSignalText(candidate.trend);
  if (!name || !trend) return false;
  return name === trend || name.includes(trend) || trend.includes(name);
}

function isVisibleDiscoveryCandidate(candidate, deals = []) {
  if (candidate.confidence === "低") return false;
  const dealNames = deals.map((deal) => normalizeSignalText(deal.name));
  const candidateName = normalizeSignalText(candidate.name);
  const alreadyActionable = dealNames.some((name) => name && candidateName && (name.includes(candidateName) || candidateName.includes(name)));
  return (
    candidate.stageKind === "candidate" &&
    !isKujiCandidate(candidate) &&
    !isDuplicateSignalCandidate(candidate) &&
    !alreadyActionable
  );
}

function buildDigest(snapshot) {
  const deals = snapshot.deals ?? [];
  const actionableDeals = deals
    .map((deal) => ({ deal, calc: calculateDeal(deal) }))
    .filter(({ deal, calc }) => deal.priceSignal !== "recheck" && calc.profit >= settings.targetProfit)
    .sort((a, b) => b.calc.profit - a.calc.profit);
  const totalProfit = actionableDeals.reduce((sum, item) => sum + item.calc.profit, 0);

  const activeLotteryRoutes = (snapshot.pokemonReleases ?? [])
    .filter(releaseIsActive)
    .flatMap((release) => (release.routes ?? []).filter(routeIsActive).map((route) => ({ release, route })));

  const topTrend = [...(snapshot.trends ?? [])]
    .filter((trend) => !isKujiTrend(trend))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const candidates = (snapshot.discoveryCandidates ?? []).filter((candidate) => isVisibleDiscoveryCandidate(candidate, deals));
  const failedSources = (snapshot.sourceResults ?? []).filter((source) => !source.ok);
  const meta = snapshot.metadata ?? {};

  const lines = [
    "MarketLens 朝8時ダイジェスト",
    `更新: ${meta.updatedAt ?? "不明"} / 取得: ${meta.reachableSources ?? "-"}${meta.totalSources ? `/${meta.totalSources}` : ""}`,
    `利益候補: ${actionableDeals.length}件 / 想定利益: ${yen.format(totalProfit)}`,
    `抽選ルート: ${activeLotteryRoutes.length}件`,
  ];

  if (actionableDeals[0]) {
    lines.push(`注目利益: ${actionableDeals[0].deal.name} ${yen.format(actionableDeals[0].calc.profit)}`);
  }
  if (activeLotteryRoutes[0]) {
    lines.push(`注目抽選: ${activeLotteryRoutes[0].release.name} / ${activeLotteryRoutes[0].route.name}`);
  }
  if (topTrend) {
    lines.push(`急上昇: ${topTrend.keyword} / 上昇度 ${topTrend.score}`);
  }
  if (candidates.length > 0) {
    lines.push(`AI検証: ${candidates.map((candidate) => candidate.name).join("、")}`);
  }
  if (failedSources.length > 0) {
    lines.push(`取得失敗: ${failedSources.map((source) => `${source.id}(${source.status})`).join("、")}`);
  }

  return lines.join("\n");
}

const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
console.log(buildDigest(snapshot));
