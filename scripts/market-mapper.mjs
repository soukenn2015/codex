/**
 * market-mapper.mjs — Layer 0: 週次で未監視ソース候補を追加
 */

import { readFile, writeFile } from "node:fs/promises";
import { compactText } from "./marketlens-shared.mjs";

const sourceConfigUrl = new URL("../data/source-config.json", import.meta.url);
const registryUrl = new URL("../data/source-registry.json", import.meta.url);

const WEEKLY_CANDIDATES = [
  { url: "https://www.hobbyraizin.com/", lane: "news", keyword: "ホビーライズン" },
  { url: "https://www.plazajapan.com/blog", lane: "blog", keyword: "Plaza Japan" },
  { url: "https://gacha-jp.com/", lane: "blog", keyword: "ガチャ情報" },
  { url: "https://www.cardrush-pokemon.jp/", lane: "official", keyword: "カードラッシュ" },
  { url: "https://www.cardkingdom.com/", lane: "official", keyword: "Card Kingdom JP" },
  { url: "https://www.meccha-japan.com/", lane: "official", keyword: "Meccha Japan" },
  { url: "https://myfigurecollection.net/", lane: "sns", keyword: "MyFigureCollection" },
  { url: "https://www.mandarake.co.jp/", lane: "official", keyword: "まんだらけ" },
];

async function main() {
  const config = JSON.parse(await readFile(sourceConfigUrl, "utf8"));
  let registry = { entries: [] };
  try {
    registry = JSON.parse(await readFile(registryUrl, "utf8"));
  } catch {
    registry = { entries: [] };
  }

  const existingUrls = new Set([
    ...(config.sources ?? []).map((s) => s.url),
    ...(registry.entries ?? []).map((e) => e.canonicalUrl ?? e.url),
  ].filter(Boolean));

  let added = 0;
  for (const row of WEEKLY_CANDIDATES) {
    if (existingUrls.has(row.url)) continue;
    registry.entries.push({
      sourceKey: row.url.replace(/https?:\/\//, "").replace(/[^\w]+/g, "-").slice(0, 60),
      canonicalUrl: row.url,
      url: row.url,
      lane: row.lane,
      status: "trial",
      priority: "low",
      keywordHint: row.keyword,
      discoveredFrom: ["market-mapper"],
      lastDecisionReason: "weekly market mapper",
    });
    existingUrls.add(row.url);
    added += 1;
  }

  await writeFile(registryUrl, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  console.log(`[market-mapper] trial sources added=${added} registry=${registry.entries.length}`);
}

main().catch((error) => {
  console.error("[market-mapper] fatal:", error?.message ?? error);
  process.exit(1);
});
