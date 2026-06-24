/**
 * generate-buzz-queries.mjs — 600件のバズクエリ matrix を生成
 * Usage: node scripts/generate-buzz-queries.mjs [--write]
 */

import { writeJson, compactText } from "./marketlens-shared.mjs";

const buzzQueriesUrl = new URL("../data/buzz-queries.json", import.meta.url);
const TARGET = Math.max(60, Math.min(600, Number(process.env.MARKETLENS_BUZZ_QUERY_TARGET ?? 600)));
const ONEPIECE_RATIO = 0.2;

const KEYWORDS = [
  "即完売",
  "プレ値",
  "争奪戦",
  "転売",
  "高騰",
  "品切れ",
  "再販なし",
  "当選",
  "抽選",
  "限定",
];

const IPS = [
  { id: "pokeca", label: "ポケカ", terms: ["ポケカ", "ポケモンカード", "ポケセン抽選"] },
  { id: "onepiece", label: "ワンピカ", terms: ["ワンピース カード", "ワンピカ", "OP-"] },
  { id: "figure", label: "フィギュア", terms: ["ROBOT魂", "METAL BUILD", "figma", "S.H.Figuarts"] },
  { id: "kuji", label: "くじ", terms: ["一番くじ", "くじ引き", "ラストワン賞"] },
  { id: "gundam", label: "ガンプラ", terms: ["ガンプラ", "HG 再販", "MG 限定"] },
  { id: "limited", label: "限定品", terms: ["コラボ 限定", "店舗限定", "受注生産"] },
  { id: "game", label: "ゲーム", terms: ["Switch 限定", "特典付き", "早期購入特典"] },
];

function buildQueries() {
  const queries = [];
  const onePieceTarget = Math.round(TARGET * ONEPIECE_RATIO);
  let onePieceCount = 0;

  for (const ip of IPS) {
    for (const term of ip.terms) {
      for (const kw of KEYWORDS) {
        if (queries.length >= TARGET) break;
        const isOnePiece = ip.id === "onepiece";
        if (isOnePiece && onePieceCount >= onePieceTarget) continue;
        const query = `${term} ${kw}`;
        queries.push({
          id: `buzz:${ip.id}:${queries.length + 1}`,
          label: `${ip.label} ${kw}`,
          query,
          ip: ip.id,
          minFaves: kw === "即完売" || kw === "プレ値" ? 1000 : 0,
        });
        if (isOnePiece) onePieceCount += 1;
      }
    }
  }

  while (queries.length < TARGET) {
    const ip = IPS[queries.length % IPS.length];
    const kw = KEYWORDS[queries.length % KEYWORDS.length];
    const term = ip.terms[queries.length % ip.terms.length];
    queries.push({
      id: `buzz:auto:${queries.length + 1}`,
      label: `${ip.label} ${kw}`,
      query: `${term} ${kw}`,
      ip: ip.id,
      minFaves: 0,
    });
  }

  return queries.slice(0, TARGET);
}

const queries = buildQueries();
const summary = {
  generatedAt: new Date().toISOString(),
  total: queries.length,
  onePieceCount: queries.filter((q) => q.ip === "onepiece").length,
};

if (process.argv.includes("--write")) {
  await writeJson(buzzQueriesUrl, { version: 1, summary, queries });
  console.log(`[generate-buzz-queries] wrote ${queries.length} queries (${summary.onePieceCount} one piece)`);
} else {
  console.log(JSON.stringify({ summary, sample: queries.slice(0, 5) }, null, 2));
}
