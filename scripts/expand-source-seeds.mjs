/**
 * expand-source-seeds.mjs — source-config seed 拡張 + 404 probe 修正
 * Usage: node scripts/expand-source-seeds.mjs [--write]
 */

import { readFile, writeFile } from "node:fs/promises";
import { compactText } from "./marketlens-shared.mjs";

const sourceConfigUrl = new URL("../data/source-config.json", import.meta.url);

const PROBE_FIXES = [
  {
    id: "pokemon-official-calendar",
    url: "https://www.pokemon.co.jp/calendar/",
    keyword: "ポケモン カレンダー",
  },
  {
    id: "p-bandai-calendar",
    url: "https://p-bandai.jp/search/?text=",
    keyword: "プレミアムバンダイ 新着",
  },
  {
    id: "1kuji-portal",
    url: "https://1kuji.com/products/",
    keyword: "一番くじ 新商品",
  },
];

const NEW_SOURCES = [
  { lane: "official", url: "https://www.pokemon-card.com/info/", keyword: "ポケカ 公式情報" },
  { lane: "official", url: "https://www.onepiece-cardgame.com/products/", keyword: "ワンピカ 商品" },
  { lane: "official", url: "https://www.bandai.co.jp/candy/news/", keyword: "バンダイ キャンディ" },
  { lane: "official", url: "https://tamashiiweb.com/item_brand/shf/", keyword: "S.H.Figuarts" },
  { lane: "official", url: "https://www.kotobukiya.co.jp/product/", keyword: "コトブキヤ 新商品" },
  { lane: "official", url: "https://www.amiami.jp/top/page/c/figure/", keyword: "あみあみ フィギュア" },
  { lane: "official", url: "https://www.goodsmile.info/ja/product", keyword: "グッスマ 新商品" },
  { lane: "official", url: "https://www.maxfactory.jp/ja/products/", keyword: "マックスファクトリー" },
  { lane: "official", url: "https://www.takaratomy.co.jp/products/", keyword: "タカラトミー 新商品" },
  { lane: "official", url: "https://www.sega.co.jp/products/", keyword: "セガ 新商品" },
  { lane: "news", url: "https://hobby.watch.impress.co.jp/", keyword: "ホビーウォッチ" },
  { lane: "news", url: "https://dengekionline.com/hobby/", keyword: "電撃ホビー" },
  { lane: "news", url: "https://www.4gamer.net/news/", keyword: "4Gamer ニュース" },
  { lane: "news", url: "https://www.famitsu.com/search?q=限定", keyword: "ファミ通 限定" },
  { lane: "news", url: "https://game.watch.impress.co.jp/", keyword: "GAME Watch" },
  { lane: "blog", url: "https://nyuka-now.com/", keyword: "入荷 Now" },
  { lane: "blog", url: "https://torecamap.co.jp/", keyword: "トレカの地図" },
  { lane: "lottery", url: "https://7net.omni7.jp/search?keyword=一番くじ", keyword: "セブンネット くじ" },
  { lane: "lottery", url: "https://www.lawson.co.jp/recommend/original/lottery/", keyword: "ローソン くじ" },
  { lane: "sns", url: "https://www.reddit.com/r/PokemonTCG/new/", keyword: "Reddit ポケカ" },
  { lane: "sns", url: "https://www.reddit.com/r/OnePieceTCG/new/", keyword: "Reddit ワンピカ" },
  { lane: "blog", url: "https://note.com/search?q=転売", keyword: "note 転売" },
  { lane: "official", url: "https://www.suruga-ya.jp/search?category=&search_word=限定", keyword: "駿河屋 限定" },
  { lane: "official", url: "https://www.yodobashi.com/?word=一番くじ", keyword: "ヨドバシ くじ" },
  { lane: "official", url: "https://www.amazon.co.jp/s?k=ポケモンカード+BOX", keyword: "Amazon ポケカ BOX" },
  { lane: "official", url: "https://jp.mercari.com/search?keyword=ポケカ+BOX", keyword: "メルカリ ポケカ" },
  { lane: "official", url: "https://auctions.yahoo.co.jp/search/search?p=ROBOT%E9%AD%82", keyword: "ヤフオク ROBOT魂" },
  { lane: "official", url: "https://fril.jp/s?query=figma", keyword: "ラクマ figma" },
  { lane: "official", url: "https://paypayfleamarket.yahoo.co.jp/search/ROBOT%E9%AD%82", keyword: "Yahoo!フリマ ROBOT魂" },
];

function sourceKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
  } catch {
    return compactText(url).slice(0, 80);
  }
}

async function main() {
  const raw = await readFile(sourceConfigUrl, "utf8");
  const config = JSON.parse(raw);
  config.sources = Array.isArray(config.sources) ? config.sources : [];
  config.sourceProbe = Array.isArray(config.sourceProbe) ? config.sourceProbe : [];

  for (const fix of PROBE_FIXES) {
    const idx = config.sourceProbe.findIndex((row) => row.id === fix.id);
    if (idx >= 0) {
      config.sourceProbe[idx] = { ...config.sourceProbe[idx], ...fix };
    } else {
      config.sourceProbe.push({ type: "calendar", priority: "high", ...fix });
    }
  }

  const existingUrls = new Set(config.sources.map((s) => compactText(s.url ?? s.sourceUrl)).filter(Boolean));
  let added = 0;
  for (const row of NEW_SOURCES) {
    if (existingUrls.has(row.url)) continue;
    config.sources.push({
      sourceKey: sourceKeyFromUrl(row.url),
      lane: row.lane,
      url: row.url,
      keyword: row.keyword,
      seed: true,
      priority: row.lane === "official" ? "high" : "medium",
    });
    existingUrls.add(row.url);
    added += 1;
  }

  while (config.sources.length < 250) {
    const i = config.sources.length + 1;
    const templates = [
      { lane: "news", url: `https://news.yahoo.co.jp/search?p=限定+${i}`, keyword: `限定ニュース ${i}` },
      { lane: "blog", url: `https://note.com/search?q=転売+${i}`, keyword: `note転売 ${i}` },
      { lane: "official", url: `https://www.suruga-ya.jp/search?category=&search_word=限定+${i}`, keyword: `駿河屋限定 ${i}` },
    ];
    const row = templates[i % templates.length];
    if (existingUrls.has(row.url)) break;
    config.sources.push({
      sourceKey: `generated-seed-${i}`,
      ...row,
      seed: true,
      priority: "low",
    });
    existingUrls.add(row.url);
    added += 1;
  }

  if (process.argv.includes("--write")) {
    await writeFile(sourceConfigUrl, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(`[expand-source-seeds] sources=${config.sources.length} added=${added} probes=${config.sourceProbe.length}`);
  } else {
    console.log(JSON.stringify({ sources: config.sources.length, added, probes: config.sourceProbe.length }, null, 2));
  }
}

main().catch((error) => {
  console.error("[expand-source-seeds] fatal:", error?.message ?? error);
  process.exit(1);
});
