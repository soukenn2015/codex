import { readFile } from "node:fs/promises";

const snapshotPath = new URL("../data/marketlens.snapshot.json", import.meta.url);
const uiScriptPath = new URL("../script.js", import.meta.url);
const uiHtmlPath = new URL("../index.html", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const [snapshotRaw, uiSource, htmlSource, stylesSource] = await Promise.all([
    readFile(snapshotPath, "utf8"),
    readFile(uiScriptPath, "utf8"),
    readFile(uiHtmlPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotRaw);
  const productGroups = Array.isArray(snapshot.productGroups) ? snapshot.productGroups : [];

  assert(uiSource.includes("function escapeHtml("), "XSS escapeHtml がありません");
  assert(uiSource.includes("function isDisplayable("), "isDisplayable がありません");
  assert(htmlSource.includes('data-tab="overview"'), "俯瞰タブがありません");
  assert(htmlSource.includes('data-tab="products"'), "商品タブがありません");
  assert(uiSource.includes("function initChat("), "AIチャットがありません");
  assert(uiSource.includes("function getSignalPrice("), "getSignalPrice がありません");
  assert(uiSource.includes("candidate.value ?? candidate.price"), "メルカリ value 参照がありません");
  assert(uiSource.includes('currency ?? "JPY"'), "JPY フィルタがありません");
  assert(uiSource.includes("function normalizeKey("), "productKey 正規化がありません");
  assert(htmlSource.includes('data-cat="onepiece"'), "ワンピカタブがありません");
  assert(uiSource.includes("past_week"), "過去1週間セクションがありません");
  assert(uiSource.includes("similar_products"), "類似商品表示がありません");
  assert(uiSource.includes("buildBuzzSummary"), "Xバズサマリがありません");
  assert(uiSource.includes("buildTrendSummary"), "メルカリ急騰サマリがありません");
  assert(!uiSource.includes("tier === \"HOLD\" || tier === \"T3\""), "T3 非表示フィルタが残っています");
  assert(htmlSource.includes("chatFab"), "チャットFABがありません");
  assert(/springExpand/.test(stylesSource), "spring アニメーションがありません");
  assert(htmlSource.includes('data-mode="all"'), "全候補モード切替がありません");
  assert(htmlSource.includes('id="productSearch"'), "商品検索ボックスがありません");
  assert(uiSource.includes("function getVisibleGroups("), "getVisibleGroups がありません");
  assert(uiSource.includes("isStrictDisplayable"), "厳選フィルタがありません");
  assert(uiSource.includes("isNameValid"), "名前正常フィルタがありません");
  assert(uiSource.includes("curatorTrust"), "curatorTrust 参照がありません");
  assert(uiSource.includes("getCuratorBadgeHtml"), "キュレーターバッジがありません");
  assert(stylesSource.includes(".curator-badge"), "キュレーターバッジCSSがありません");
  assert(stylesSource.includes(".display-mode-tabs"), "表示モードCSSがありません");
  assert(uiSource.includes("buildDigestBundles"), "ダイジェスト束生成がありません");
  assert(uiSource.includes("renderDigestBundle"), "ダイジェスト束描画がありません");
  assert(uiSource.includes("renderInfoRow"), "情報行描画がありません");
  assert(uiSource.includes("getSectionEventDate"), "日付区分用イベント日付がありません");
  assert(stylesSource.includes(".digest-bundle"), "ダイジェスト束CSSがありません");
  assert(Array.isArray(productGroups), "snapshot.productGroups が配列ではありません");

  console.log(`UI regression checks passed (productGroups=${productGroups.length})`);
}

main().catch((e) => {
  console.error(`UI regression check failed: ${e.message}`);
  process.exitCode = 1;
});
