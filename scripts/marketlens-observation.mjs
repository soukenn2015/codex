/**
 * socialSignals: [{ source, postUrl, readerUrl, postedAt, text, authorHandle, engagement, sourceMode, observedAt, parseWarnings }]
 * realtimeResearchTargets: [{ id, productKey, productName, provider, query, searchUrl, label, sourceMode, buyLineEligible, buzzEligible }]
 * socialSearchSignals: [{ provider, query, searchUrl, productKey, productName, observedAt, sourceMode, resultCountApprox, samples, sampleTexts, confidence, parseWarnings, observationStatus, buzzEligible }]
 * marketplaceSignals: [{ marketplace, productKey, productName, query, searchUrl, listingCandidates[{ value, currency, rawPriceText, priceParseConfidence, title, itemUrl }], soldCandidates, observedAt, sourceMode, priceSourceRank, buyLineEligible, confidence, observationStatus, parseWarnings }]
 */

import {
  LIMITS,
  resolveMarketplaceDisplayLimit,
  resolveMarketplaceSubjectLimit,
  resolveObservationLimits,
  resolveRealtimeDisplayLimit,
} from "./marketlens-limits.mjs";
import { summarizeJpyCandidateSnapshot, summarizeMercariProbeSkipRegistry } from "./marketlens-mercari-browser.mjs";

const ENGAGEMENT_KEYS = [
  "likeCount",
  "repostCount",
  "quoteCount",
  "viewCount",
  "replyCount",
  "bookmarkCount",
  "likes",
  "retweets",
  "reposts",
  "views",
  "favoriteCount",
  "impressionCount",
];
const READER_ENGAGEMENT_KEYS = ["replyCount", "repostCount", "likeCount", "bookmarkCount", "viewCount"];

const X_HOST_RE = /(?:^|\/\/)(?:www\.)?(x\.com|twitter\.com)\//i;
const X_STATUS_RE = /\/status\//i;
const MARKETPLACE_URL_RE = /mercari\.com|mercari\.jp|paypayfleamarket\.yahoo\.co\.jp|fril\.jp/i;
const YAHOO_FLEAMARKET_URL_RE = /paypayfleamarket\.yahoo\.co\.jp|fril\.jp/i;
const MERCARI_ITEM_URL_RE = /jp\.mercari\.com\/item\//i;

function toWellFormedText(value) {
  const text = String(value ?? "");
  if (typeof text.toWellFormed === "function") return text.toWellFormed();
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index] + text[index + 1];
        index += 1;
      } else {
        out += "\ufffd";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\ufffd";
      continue;
    }
    out += text[index];
  }
  return out;
}

export function truncateUnicodeText(value, maxChars) {
  const text = toWellFormedText(value);
  if (!Number.isFinite(maxChars) || maxChars < 0) return text;
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join("");
}

export function stringifyWellFormedJson(value, space = 0) {
  return JSON.stringify(
    value,
    (_key, child) => (typeof child === "string" ? toWellFormedText(child) : child),
    space,
  );
}

function compactText(value) {
  return toWellFormedText(value).replace(/\s+/g, " ").trim();
}

function hasEngagementMetrics(target) {
  if (!target || typeof target !== "object") return false;
  if (target.engagement && typeof target.engagement === "object") {
    return hasEngagementMetrics(target.engagement);
  }
  return ENGAGEMENT_KEYS.some((key) => Number.isFinite(Number(target[key])) && Number(target[key]) > 0);
}

function normalizeStatusUrl(url = "") {
  return String(url)
    .trim()
    .replace(/^http:/i, "https:")
    .replace(/twitter\.com/i, "x.com");
}

function hasReaderEngagementValues(engagement = null) {
  if (!engagement || typeof engagement !== "object") return false;
  return READER_ENGAGEMENT_KEYS.some((key) => Number.isFinite(Number(engagement[key])) && Number(engagement[key]) > 0);
}

export function hasReaderObservedXEvidence({ socialSignals = [], url = "" } = {}) {
  const rows = Array.isArray(socialSignals) ? socialSignals.filter((row) => row?.sourceMode === "reader_observed") : [];
  if (!rows.length) return false;
  if (!url) return rows.some((row) => compactText(row.text).length >= 20);
  const normalized = normalizeStatusUrl(url);
  return rows.some((row) => normalizeStatusUrl(row.postUrl) === normalized && compactText(row.text).length >= 20);
}

export function hasObservedApiXEvidence({ socialSignals = [], engagement = null } = {}) {
  if (Array.isArray(socialSignals) && socialSignals.some((row) => ["observed", "observed_api"].includes(row?.sourceMode))) {
    return true;
  }
  if (engagement?.sourceMode === "observed_api" && hasEngagementMetrics(engagement)) return true;
  return false;
}

export function hasObservedXEvidence({
  text = "",
  url = "",
  socialSignals = [],
  engagement = null,
} = {}) {
  return hasObservedApiXEvidence({ socialSignals, engagement });
}

export const READER_OBSERVED_CONFIRMATION_LABEL = "X本文確認済み";
export const READER_OBSERVED_REACTION_LABEL = "X反応数値確認済み";
export const READER_OBSERVED_GLOBAL_TREND_LABEL = "X本文確認済みあり";
const LEGACY_READER_REACTION_LABEL = "X反応確認済み";

function normalizeHandle(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function extractXHandleFromUrl(url = "") {
  try {
    const normalized = normalizeStatusUrl(url);
    if (!X_HOST_RE.test(normalized)) return "";
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length || ["i", "intent", "search", "hashtag", "home"].includes(parts[0])) return "";
    return normalizeHandle(parts[0]);
  } catch {
    return "";
  }
}

export function isXProfileOnlyUrl(url = "") {
  const normalized = normalizeStatusUrl(url);
  if (!X_HOST_RE.test(normalized)) return false;
  return !X_STATUS_RE.test(normalized);
}

function collectSourceResultUrls(result = {}) {
  return [
    result.url,
    result.sourceUrl,
    result.routeUrl,
    result.routeFinalUrl,
    result.evidenceUrl,
    result.finalUrl,
  ]
    .filter(Boolean)
    .map((value) => normalizeStatusUrl(String(value)));
}

function readerObservedRows(socialSignals = []) {
  return Array.isArray(socialSignals)
    ? socialSignals.filter((row) => row?.sourceMode === "reader_observed" && compactText(row.text).length >= 20)
    : [];
}

export function sourceResultMatchesReaderSignal(result = {}, socialSignals = []) {
  const rows = readerObservedRows(socialSignals);
  if (!rows.length) return false;
  const urls = collectSourceResultUrls(result);
  if (!urls.length) return false;

  for (const row of rows) {
    const postUrl = normalizeStatusUrl(row.postUrl ?? "");
    if (postUrl && urls.some((url) => url === postUrl)) return true;
  }

  for (const row of rows) {
    const handle = normalizeHandle(row.authorHandle ?? "");
    if (!handle) continue;
    const postHandle = extractXHandleFromUrl(row.postUrl ?? "");
    if (postHandle && postHandle !== handle) continue;
    if (urls.some((url) => extractXHandleFromUrl(url) === handle)) return true;
  }

  return false;
}

function stripReaderLabelsFromSignals(signals = []) {
  return (signals ?? []).filter(
    (signal) =>
      signal !== READER_OBSERVED_CONFIRMATION_LABEL &&
      signal !== READER_OBSERVED_REACTION_LABEL &&
      signal !== LEGACY_READER_REACTION_LABEL &&
      signal !== READER_OBSERVED_GLOBAL_TREND_LABEL &&
      !String(signal).startsWith(`${READER_OBSERVED_GLOBAL_TREND_LABEL}（`),
  );
}

function stripReaderLabelsFromContext(context = "") {
  return compactText(
    String(context ?? "")
      .split(" / ")
      .filter(
        (part) =>
          part &&
          part !== READER_OBSERVED_CONFIRMATION_LABEL &&
          part !== READER_OBSERVED_REACTION_LABEL &&
          part !== LEGACY_READER_REACTION_LABEL &&
          part !== READER_OBSERVED_GLOBAL_TREND_LABEL &&
          !part.startsWith(`${READER_OBSERVED_GLOBAL_TREND_LABEL}（`),
      )
      .join(" / "),
  );
}

export function summarizeReaderObservation(socialSignals = []) {
  const rows = Array.isArray(socialSignals) ? socialSignals.filter((row) => row?.sourceMode === "reader_observed") : [];
  const textRows = rows.filter((row) => compactText(row.text).length >= 20);
  if (!textRows.length) return null;
  return {
    label: READER_OBSERVED_CONFIRMATION_LABEL,
    count: textRows.length,
    sourceMode: "reader_observed",
    engagementParsed: textRows.filter((row) => Number(row.engagement?.parseConfidence ?? 0) >= 0.7).length,
  };
}

function itemHasXReference(target = {}) {
  const blob = compactText(
    [
      target.context,
      target.keyword,
      target.action,
      target.sourceUrl,
      target.url,
      target.type,
      target.channel,
      ...(Array.isArray(target.signals) ? target.signals : []),
    ].join(" "),
  );
  return (
    hasXReference(blob, target.url ?? target.sourceUrl ?? "") ||
    /X確認対象|X本文確認済み|X反応数値確認済み|X反応確認済み|SNS確認待ち|\/sns/i.test(blob)
  );
}

function appendReaderConfirmationLabel(value = "", label = READER_OBSERVED_CONFIRMATION_LABEL) {
  const text = compactText(value);
  if (!text) return label;
  if (text.includes(label) || text.includes("X話題") || text.includes("Xでバズ") || text.includes("SNSで急上昇")) {
    return text;
  }
  return `${text} / ${label}`;
}

export function applyReaderObservedLabels(snapshot = {}) {
  const summary = summarizeReaderObservation(snapshot.socialSignals);
  if (!summary) return snapshot;
  const next = { ...snapshot };
  const confirmLabel = summary.label;
  const globalTrendNote = `${READER_OBSERVED_GLOBAL_TREND_LABEL}（${summary.count}件）`;
  const readerRows = readerObservedRows(snapshot.socialSignals);
  next.metadata = {
    ...(next.metadata ?? {}),
    readerObservation: summary,
  };
  next.trends = (next.trends ?? []).map((trend) => {
    const cleaned = {
      ...trend,
      context: stripReaderLabelsFromContext(trend.context),
    };
    delete cleaned.readerConfirmation;
    delete cleaned.readerConfirmationScope;
    if (!itemHasXReference(cleaned)) return cleaned;
    return {
      ...cleaned,
      context: appendReaderConfirmationLabel(cleaned.context, globalTrendNote),
      readerConfirmation: READER_OBSERVED_GLOBAL_TREND_LABEL,
      readerConfirmationScope: "global",
    };
  });
  next.sourceResults = (next.sourceResults ?? []).map((result) => {
    const signals = stripReaderLabelsFromSignals(Array.isArray(result.signals) ? result.signals : []);
    const cleaned = { ...result, signals };
    delete cleaned.readerConfirmation;
    delete cleaned.readerConfirmationScope;
    if (!sourceResultMatchesReaderSignal(cleaned, readerRows)) return cleaned;
    if (!signals.includes(confirmLabel) && !signals.includes("X話題") && !signals.includes("Xでバズ")) {
      signals.push(confirmLabel);
    }
    return {
      ...cleaned,
      signals,
      readerConfirmation: confirmLabel,
      readerConfirmationScope: "reader_match",
    };
  });
  return next;
}

export function resolveReaderObservedLabel({ socialSignals = [], url = "" } = {}) {
  const rows = Array.isArray(socialSignals) ? socialSignals.filter((row) => row?.sourceMode === "reader_observed") : [];
  if (!rows.length) return null;
  const normalized = url ? normalizeStatusUrl(url) : "";
  let pool = rows;
  if (normalized) {
    pool = rows.filter((row) => normalizeStatusUrl(row.postUrl) === normalized);
    if (!pool.length) return null;
  }
  const hasReaction = pool.some(
    (row) => Number(row.engagement?.parseConfidence ?? 0) >= 0.7 && hasReaderEngagementValues(row.engagement),
  );
  if (hasReaction) return READER_OBSERVED_REACTION_LABEL;
  if (pool.some((row) => compactText(row.text).length >= 20)) return "X本文確認済み";
  return null;
}

export function hasXReference(text = "", url = "") {
  return X_HOST_RE.test(compactText(`${url} ${text}`)) || /t\.co\//i.test(compactText(`${url} ${text}`));
}

export function resolveXSignalLabel({
  text = "",
  url = "",
  channel = "",
  socialSignals = [],
  engagement = null,
} = {}) {
  const readerLabel = resolveReaderObservedLabel({ socialSignals, url });
  if (readerLabel) return readerLabel;
  if (hasObservedXEvidence({ text, url, socialSignals, engagement })) return "X話題";
  if (hasXReference(text, url) || /sns/i.test(channel)) return "X確認対象";
  if (/sns監視|sns速報|sns抽出/i.test(channel)) return "SNS確認待ち";
  return null;
}

export function isMarketplaceUrl(url = "") {
  return MARKETPLACE_URL_RE.test(String(url ?? ""));
}

export function isYahooFleamarketUrl(url = "") {
  return YAHOO_FLEAMARKET_URL_RE.test(String(url ?? ""));
}

export function isMercariItemUrl(url = "") {
  return MERCARI_ITEM_URL_RE.test(String(url ?? ""));
}

export function isObservedMarketplacePrice(price = {}) {
  if (price?.priceSourceRank !== "observed_market_price") return false;
  const urls = [price.url, price.sourceUrl, price.marketUrl, price.listingUrl, price.itemUrl, price.source].filter(Boolean).join(" ");
  return isMarketplaceUrl(urls) || /observed_market|mercari_observed_market/i.test(String(price.source ?? ""));
}

export const MARKETPLACE_MANUAL_CHECK_EVIDENCE = [
  "出品価格",
  "売り切れ価格",
  "直近成約",
  "送料込み条件",
  "BOX/単品/特典違い",
  "状態差",
  "同一商品かどうか",
];

const MARKETPLACE_QUERY_NOISE_TOKENS = new Set([
  "相場",
  "価格",
  "話題",
  "注目",
  "急上昇",
  "バズ",
  "トレンド",
  "人気",
  "最新",
  "情報",
  "確認",
  "チェック",
  "メルカリ",
  "フリマ",
  "スニダン",
  "yahoo",
  "paypay",
  "しなかん",
  "品薄",
  "完売",
  "監視",
  "渋谷",
  "心斎橋",
  "発売予定",
  "抽選受付",
  "通販",
  "予約",
  "ガチャ",
  "ファミマオンライン",
]);
const MARKETPLACE_QUERY_NOISE_PHRASES = [
  "品薄完売監視",
  "絵美のせどり部屋",
  "X確認対象",
  "SNS確認待ち",
  "詳細はこちら",
  "カートに入れる",
  "在庫状況",
  "会社概要",
  "特定商取引法",
  "発売予定",
  "抽選受付",
  "に決定した",
  "の発売が",
  "に加えて",
  "月刊コロコロコミック",
  "JUMP SHOP",
  "BY JUMP SHOP",
  "渋谷・心斎橋",
  "HOBBY Watch",
  "食べログ予約",
  "ぐるなびネット予約",
  "オフィシャルサイト",
  "BANDAI SPIRITS",
];
const MARKETPLACE_QUERY_BRACKET_RE = /[【［\[（(『「][^】］\]）)』」]*[】］\]）)』」]/g;
const MARKETPLACE_QUERY_MOJIBAKE_RE = /\uFFFD/;
const MARKETPLACE_QUERY_BROKEN_SUFFIX_RE = /\/[\uFFFDX]$/i;
const MARKETPLACE_QUERY_ARTICLE_RE =
  /の発売が|に決定した|に加えて|詳細はこちら|カートに入れる|在庫状況|における|フィギュア化|組み立ててみた|コラム|実写映画も|HOBBY Watch|商品販売・イベント|順次発売|\d+月\d+日|\d{4}\/\d{1,2}\/\d{1,2}|オフィシャルサイト|約\d+(?:\.\d+)?cm|PRODUCTS|GOODS|オプション|Others|お得な情報|お届けします|ご利用いただけます|最新モデルの情報/u;
const POKEMON_SET_PRIORITY = ["ムニキスゼロ", "ロケット団の栄光", "トリプレットビート", "テラスタルフェス"];
const MARKETPLACE_QUERY_CONCRETE_RE =
  /(?:[A-Z]{2,}[- ]?\d{2,}|[A-Z]{2,}\d{2,}|GA-\d|MRG-|HUC-|BOX|ボックス|パック|一番くじ|フィギュア|ムビチケ|入場者特典|劇場限定|拡張パック|スマートウォッチ|G-SHOCK|GARRACK|ROBOT魂|ねんどろいど|S\.H\.Figuarts|METAL BUILD|ドラゴンクエスト|ワンピース|ポケモンカード|プレミアムバンダイ|カシオ|Coca-Cola|エンスカイ|ソフビ|マスコット|ムニキスゼロ|ロケット団|テラスタルフェス|トリプレットビート)/i;
const MARKETPLACE_HTML_NAMED_ENTITIES = {
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  agrave: "à",
  uacute: "ú",
  oacute: "ó",
  iacute: "í",
  aacute: "á",
  ntilde: "ñ",
  ouml: "ö",
 uuml: "ü",
  auml: "ä",
  ocirc: "ô",
  ecirc: "ê",
  acirc: "â",
};
const POKEMON_SET_NAME_RE =
  /ムニキスゼロ|ロケット団の栄光|ロケット団スペシャルケース|テラスタルフェス|トリプレットビート|ムゲンゾーン|インフェルノX|ワイルドフォース|サイバージャッジ|シャイニートレジャー|(?:強化)?拡張パック\s+151|30th\s+CELEBRATION/i;
export const MARKETPLACE_DEFAULT_MAX_SUBJECTS = resolveMarketplaceSubjectLimit();
const MARKETPLACE_CATEGORY_CAPS_BASE = {
  "pokemon-specific": 15,
  movie: 10,
  kuji: 15,
  mascot: 5,
};
const MARKETPLACE_FAMILY_CAP_BASE = 8;
const MARKETPLACE_FAMILY_CAP_OVERRIDES_BASE = {
  "dq-metallic": 3,
  figure: 12,
  watch: 10,
  goods: 12,
};

function buildMarketplaceSelectionCaps(maxSubjects = MARKETPLACE_DEFAULT_MAX_SUBJECTS) {
  const scale = Math.max(1, maxSubjects / 100);
  const ceilScaled = (value) => Math.ceil(value * scale);
  return {
    categoryCaps: Object.fromEntries(
      Object.entries(MARKETPLACE_CATEGORY_CAPS_BASE).map(([key, value]) => [key, ceilScaled(value)]),
    ),
    familyCap: ceilScaled(MARKETPLACE_FAMILY_CAP_BASE),
    familyCapOverrides: Object.fromEntries(
      Object.entries(MARKETPLACE_FAMILY_CAP_OVERRIDES_BASE).map(([key, value]) => [key, ceilScaled(value)]),
    ),
  };
}
const MARKETPLACE_EXCLUSION_SAMPLE_LIMIT = 16;
export const MARKETPLACE_CATEGORY_DISPLAY_MAP = {
  thin: "小型物",
  large: "時計/大型",
  goods: "グッズ",
  generic_hobby: "その他",
  pokemon: "ポケカ",
  kuji: "一番くじ",
  movie_goods: "映画グッズ",
  movie_bonus: "映画グッズ",
  figure: "フィギュア",
};

export function marketplaceCategoryDisplayLabel(category = "") {
  return MARKETPLACE_CATEGORY_DISPLAY_MAP[category] ?? category;
}

function isGenericPokemonName(name = "") {
  const text = compactText(decodeHtmlEntities(name));
  return (
    /^ポケモンカード(?:ゲーム)?\s+MEGA\s+拡張パック$/iu.test(text) ||
    /^ポケモンカード(?:ゲーム)?\s+スカーレット&バイオレット\s+拡張パック$/iu.test(text) ||
    /^ポケモンカード(?:ゲーム)?\s+MEGA$/iu.test(text)
  );
}

function isPokemonSpecificSet(name = "", query = "") {
  const blob = `${name} ${query}`;
  return POKEMON_SET_NAME_RE.test(blob) || /ムニキスゼロ\s+BOX/i.test(blob);
}
const MARKETPLACE_QUERY_GENERIC_ONLY_RE =
  /^(プレミアムバンダイ|GARRACK|フィギュア|マスコット|METAL BUILD|ポケモンカードラウンジ|食べログ予約|ぐるなびネット予約|ポケモンカードゲーム\s+MEGA(?:\s+拡張パック)?|ポケモンカードゲーム\s+スカーレット&バイオレット\s+拡張パック)$/iu;
const MARKETPLACE_QUERY_TREND_ONLY_RE = /^しなかん(?:\s+品薄完売監視)?$/iu;
const MARKETPLACE_QUERY_PRIMARY_KEYS = ["canonicalName", "productName", "name", "title"];

function normalizeMarketplaceSubjectKey(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function dedupeRepeatedMarketplacePhrase(value = "") {
  const text = compactText(value);
  if (!text) return text;
  const repeated = text.match(/^(.{4,48}?)\s+\1$/u);
  if (repeated?.[1]) return repeated[1].trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return text;
  const deduped = [];
  for (const token of tokens) {
    if (deduped[deduped.length - 1] === token) continue;
    deduped.push(token);
  }
  return deduped.join(" ").trim();
}

export function decodeHtmlEntities(value = "") {
  let out = String(value ?? "");
  out = out.replace(/<[^>]*>/g, " ").replace(/\\r\\n/g, " ").replace(/\\n/g, " ");
  out = out
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
  out = out.replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
  out = out.replace(/&([a-z]+);/gi, (match, name) => MARKETPLACE_HTML_NAMED_ENTITIES[name] ?? match);
  return out;
}

function stripMarketplaceColonArticle(value = "") {
  let text = compactText(decodeHtmlEntities(value));
  if (!text.includes(":") && !text.includes("：")) return text;
  for (const phrase of ["絵美のせどり部屋", "えみのせどり部屋"]) {
    text = text.replace(new RegExp(phrase, "gi"), " ");
  }
  const parts = text
    .split(/[:：]/)
    .map((part) => compactText(part))
    .filter(Boolean);
  if (parts.length <= 1) return compactText(text.replace(/[:：]/g, " "));
  const scored = parts
    .map((part) => ({
      part,
      score:
        (MARKETPLACE_QUERY_CONCRETE_RE.test(part) ? 4 : 0) +
        (MARKETPLACE_QUERY_ARTICLE_RE.test(part) ? -4 : 0) +
        (MARKETPLACE_QUERY_MOJIBAKE_RE.test(part) ? -6 : 0) +
        Math.min(part.length, 40) / 10,
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.part ?? parts[0];
}

function removeMarketplaceNoisePhrases(value = "") {
  let text = compactText(value);
  for (const phrase of MARKETPLACE_QUERY_NOISE_PHRASES) {
    text = text.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return compactText(text);
}

function cleanMarketplaceQueryTokens(value = "") {
  let text = removeMarketplaceNoisePhrases(
    stripMarketplaceColonArticle(decodeHtmlEntities(dedupeRepeatedMarketplacePhrase(value))),
  );
  text = text
    .replace(MARKETPLACE_QUERY_BRACKET_RE, " ")
    .replace(/[【】［］\[\]『』「」]/g, " ")
    .replace(/[￥¥][\d,]+/g, " ")
    .replace(/\d{4}年\d{1,2}月(?:予約)?/g, " ")
    .replace(/[#＃@＠]/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/！/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        !MARKETPLACE_QUERY_NOISE_TOKENS.has(token.toLowerCase()) &&
        token.toUpperCase() !== "BY" &&
        !/^\d+$/.test(token),
    )
    .join(" ")
    .replace(/\s*[:：]\s*/g, " ")
    .replace(/\s*・\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compactText(text);
}

function pickPrimaryMarketplaceName(fields = {}) {
  for (const key of MARKETPLACE_QUERY_PRIMARY_KEYS) {
    const value = compactText(decodeHtmlEntities(fields[key]));
    if (value.length >= 3) return value;
  }
  return "";
}

function extractPokemonSetQuerySuffix(source = "") {
  const text = compactText(decodeHtmlEntities(source));
  if (!text) return "";
  if (/BOX|ボックス/i.test(text)) {
    const boxMatch = text.match(/(?:MEGA\s+)?拡張パック\s+(.+?)\s+BOX/i) ?? text.match(/(.+?)\s+BOX/i);
    const setName = cleanMarketplaceQueryTokens(boxMatch?.[1] ?? "");
    if (setName && !/^MEGA$/i.test(setName) && !/^スカーレット&バイオレット$/i.test(setName)) {
      return `${setName} BOX`;
    }
  }
  const highClassMatch = text.match(/ハイクラスパック\s+(.+?)(?:\s|$|も)/i);
  if (highClassMatch) {
    const setName = cleanMarketplaceQueryTokens(highClassMatch[1]);
    if (setName) return `${setName} パック`;
  }
  const enhancedMatch = text.match(/強化拡張パック\s+(.+?)(?:\s|$|も)/i);
  if (enhancedMatch) {
    const setName = cleanMarketplaceQueryTokens(enhancedMatch[1]);
    if (setName) return `${setName} 拡張パック`;
  }
  const rocketMatch = text.match(/(ロケット団の栄光|ロケット団スペシャルケース)/i);
  if (rocketMatch) {
    const setName = cleanMarketplaceQueryTokens(rocketMatch[1]);
    if (/アタッシュケース|スペシャルケース/i.test(text)) return `${setName} BOX`;
    return `${setName} 拡張パック`;
  }
  const setNameMatch = text.match(POKEMON_SET_NAME_RE);
  if (setNameMatch) {
    const setName = cleanMarketplaceQueryTokens(setNameMatch[0]);
    if (/BOX|ボックス/i.test(text)) return `${setName} BOX`;
    if (/ハイクラスパック/i.test(text)) return `${setName} パック`;
    if (/強化拡張パック/i.test(text)) return `${setName} 拡張パック`;
    if (/拡張パック/i.test(text)) return `${setName} 拡張パック`;
  }
  const setMatch = text.match(/ポケモンカードゲーム\s+(.+?)\s+拡張パック/i);
  if (setMatch) {
    const setName = cleanMarketplaceQueryTokens(setMatch[1]);
    if (!setName || /^MEGA$/i.test(setName) || /^スカーレット&バイオレット$/i.test(setName)) return "";
    if (/BOX|ボックス/i.test(text)) return `${setName} BOX`;
    return `${setName} 拡張パック`;
  }
  return "";
}

function refinePokemonMarketplaceQuery(query = "", primaryName = "") {
  const source = compactText(decodeHtmlEntities(primaryName || query));
  const supply = /デッキシールド|プレイマット|スリーブ|ファイル/i;
  if (supply.test(source)) {
    const cleaned = cleanMarketplaceQueryTokens(source);
    return cleaned.length >= 8 ? cleaned : "";
  }
  if (isGenericPokemonName(source)) return "";
  const setQuery = extractPokemonSetQuerySuffix(source);
  if (setQuery) return setQuery;
  if (/ポケモンカードゲーム\s+MEGA\s+拡張パック/i.test(source) && !POKEMON_SET_NAME_RE.test(source)) return "";
  if (/スカーレット&バイオレット\s+拡張パック/i.test(source) && !POKEMON_SET_NAME_RE.test(source)) return "";
  return query;
}

function refineMovieMarketplaceQuery(query = "", primaryName = "", category = "") {
  if (!["movie_bonus", "movie_goods"].includes(category)) return query;
  const source = compactText(decodeHtmlEntities(primaryName || query));
  const cleanedSource = removeMarketplaceNoisePhrases(source);
  const muMovieMatch = cleanedSource.match(/(映画[^、。]{2,36}?ムビチケ(?:前売券)?)/u);
  if (muMovieMatch) return cleanMarketplaceQueryTokens(muMovieMatch[1]);
  const theaterMuMatch = cleanedSource.match(/(劇場版[^、。]+?ムビチケ(?:前売券)?)/u);
  if (theaterMuMatch) return cleanMarketplaceQueryTokens(theaterMuMatch[1]);
  if (!MARKETPLACE_QUERY_ARTICLE_RE.test(cleanedSource)) return query;
  const muMatch = cleanedSource.match(/(.{2,40}?ムビチケ(?:前売券)?)/u);
  if (muMatch && !/の発売が|に決定した|に加えて/.test(muMatch[1])) {
    return cleanMarketplaceQueryTokens(muMatch[1]);
  }
  const theaterMatch = cleanedSource.match(/(劇場版[^、。]+?)(?:ムビチケ|入場者|劇場|$)/u);
  if (theaterMatch) return cleanMarketplaceQueryTokens(theaterMatch[1]);
  const movieGoodsMatch = cleanedSource.match(/(映画[^、。]{2,30}?(?:グッズ|特典|パンフレット|入場者特典))/u);
  if (movieGoodsMatch) return cleanMarketplaceQueryTokens(movieGoodsMatch[1]);
  return "";
}

function trimMarketplaceQueryLength(query = "") {
  let text = compactText(query);
  if (text.length <= 50) return text;
  const shortened = text
    .replace(/\s+\d{1,2}[,，]?\d{3}\s*$/u, "")
    .replace(/\s+(メンズ|レディース|グッズ)\s*$/u, "")
    .replace(/\s+\d{4}年モデル\s+腕時計$/u, " 腕時計")
    .trim();
  if (shortened.length >= 10 && shortened.length <= 50) return shortened;
  if (text.length > 72) return "";
  return text.length <= 72 ? text : "";
}

export function assessMarketplaceQueryRejectReason(query = "", { primaryName = "", category = "" } = {}) {
  const text = compactText(query);
  if (!text) return "query_not_concrete";
  if (MARKETPLACE_QUERY_MOJIBAKE_RE.test(text) || MARKETPLACE_QUERY_MOJIBAKE_RE.test(primaryName)) return "query_mojibake";
  if (MARKETPLACE_QUERY_BROKEN_SUFFIX_RE.test(text)) return "query_mojibake";
  if (MARKETPLACE_QUERY_TREND_ONLY_RE.test(text) || /品薄完売監視/.test(text)) return "query_trend_label";
  if (/絵美のせどり部屋|えみのせどり部屋/.test(text)) return "query_article_title";
  if (MARKETPLACE_QUERY_ARTICLE_RE.test(text)) return "query_article_title";
  if ((text.match(/[:：]/g) ?? []).length >= 2) return "query_article_title";
  if (MARKETPLACE_QUERY_GENERIC_ONLY_RE.test(text)) return "query_too_generic";
  if (text.length < 10) return "query_not_concrete";
  if (text.length > 72 || (text.length > 50 && !MARKETPLACE_QUERY_CONCRETE_RE.test(text))) return "query_not_concrete";
  if (!MARKETPLACE_QUERY_CONCRETE_RE.test(text)) return "query_not_concrete";
  if (/^ポケモンカードゲーム\s+MEGA(?:\s+拡張パック)?$/iu.test(text)) return "query_too_generic";
  if (/^ポケモンカードゲーム\s+スカーレット&バイオレット\s+拡張パック$/iu.test(text)) return "query_too_generic";
  if (/フィギュア化|HOBBY Watch|における|オフィシャルサイト|約\d+(?:\.\d+)?cm|お得な情報|お届けします|ご利用いただけます|最新モデルの情報/u.test(text)) {
    return "query_article_title";
  }
  if ((text.match(/\b(?:PRODUCTS|GOODS|Others|オプション)\b/gi) ?? []).length >= 2) return "query_article_title";
  if (/^フィギュア\s+約/u.test(text)) return "query_not_concrete";
  if (/[￥¥]\s*[\d,]+/.test(text)) return "query_article_title";
  if (/『[^』]*$/.test(primaryName) || /『[^』]*$/.test(text)) return "query_not_concrete";
  if (/ドラゴンスター通販/.test(text) && text.length > 30) return "query_article_title";
  if (["movie_bonus", "movie_goods"].includes(category) && MARKETPLACE_QUERY_ARTICLE_RE.test(text)) return "query_article_title";
  return null;
}

export function buildMarketplaceResearchQuery({
  canonicalName = "",
  productName = "",
  name = "",
  title = "",
  trend = "",
  reason = "",
  context = "",
  category = "",
} = {}) {
  void trend;
  void reason;
  void context;
  const primaryName = pickPrimaryMarketplaceName({ canonicalName, productName, name, title });
  if (!primaryName) return "";
  let query = cleanMarketplaceQueryTokens(primaryName);
  if (category === "pokemon" || /ポケモンカード|ポケカ/i.test(primaryName)) {
    query = refinePokemonMarketplaceQuery(query, primaryName) || query;
  }
  query = refineMovieMarketplaceQuery(query, primaryName, category);
  query = trimMarketplaceQueryLength(query);
  return compactText(query);
}

export function buildMercariSearchUrl(query = "") {
  const q = compactText(query);
  if (!q) return "";
  return `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}`;
}

export function buildYahooFleamarketSearchUrl(query = "") {
  const q = compactText(query);
  if (!q) return "";
  return `https://paypayfleamarket.yahoo.co.jp/search/${encodeURIComponent(q)}`;
}

export function buildYahooRealtimeSearchUrl(query = "") {
  const q = compactText(query);
  if (!q) return "";
  return `https://search.yahoo.co.jp/realtime/search?p=${encodeURIComponent(q)}`;
}

export function realtimeResearchTargetLabel() {
  return "Yahooリアルタイム確認";
}

export const YAHOO_REALTIME_OBSERVED_LABEL = "Yahooリアルタイム確認済み";
export const SOCIAL_SEARCH_CONFIDENCE_BADGE_MIN = 0.55;
export const REALTIME_OBSERVATION_QUERY_MAX_LEN = 48;
export const REALTIME_QUERY_SKIP_REASONS = [
  "realtime_query_too_long",
  "realtime_query_description",
  "realtime_query_not_concrete",
  "permanent_login_required",
  "permanent_blocked",
  "permanent_failed_retries",
];

const REALTIME_QUERY_DESCRIPTION_RE =
  /どこから見ても|圧倒的な存在感|を放つ|A賞から[A-Z]賞まで|A賞と[A-Z]賞は|から[A-Z]賞まで|までフィギュアで|フィギュアで$/iu;
const REALTIME_QUERY_PRIZE_RANGE_RE = /^[A-Z]賞から[A-Z]賞まで/u;
const REALTIME_QUERY_PRIZE_PAIR_RE = /^[A-Z]賞と[A-Z]賞は/u;
const REALTIME_FORBIDDEN_SAMPLE_RE = /(?:Xでバズ|SNS急上昇|SNSで急上昇|X話題|話題化|急上昇)/gu;

export function sanitizeSocialSearchSampleText(text = "") {
  let out = compactText(text)
    .replace(REALTIME_FORBIDDEN_SAMPLE_RE, "")
    .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  if (out.length > 280) out = `${out.slice(0, 280)}...`;
  return compactText(out);
}

function stripRealtimeMarketingNoise(text = "") {
  return compactText(
    String(text ?? "")
      .replace(/BUSTISAN\s*360°?/giu, "")
      .replace(/どこから見ても[^、。]*/giu, "")
      .replace(/圧倒的な存在感を放つ/giu, "")
      .replace(/を放つ/giu, "")
      .replace(/シリーズ$/u, "")
      .replace(/\s+/g, " "),
  );
}

function extractConcreteRealtimeFragment(text = "") {
  const cleaned = stripRealtimeMarketingNoise(text);
  if (!cleaned) return "";
  const prizeMatch = cleaned.match(
    /[A-Z]賞\s+[^\s　、。]+(?:\s+[^\s　、。]+){0,4}(?:\s+1\/7)?(?:\s+Gracemaster)?(?:\s+フィギュア)?/iu,
  );
  if (prizeMatch) return compactText(prizeMatch[0]).slice(0, REALTIME_OBSERVATION_QUERY_MAX_LEN);
  const kujiMatch = cleaned.match(/一番くじ\s+[^\s　、。]{3,36}/iu);
  if (kujiMatch) return compactText(kujiMatch[0]).slice(0, REALTIME_OBSERVATION_QUERY_MAX_LEN);
  const modelMatch = cleaned.match(
    /(?:G-SHOCK|ROBOT魂|S\.H\.Figuarts|METAL BUILD|ねんどろいど|ポケモンカード|ポケカ)\s*[^\s　、。]{0,28}/iu,
  );
  if (modelMatch) return compactText(modelMatch[0]).slice(0, REALTIME_OBSERVATION_QUERY_MAX_LEN);
  const firstClause = cleaned.split(/[、。]/)[0] ?? cleaned;
  return compactText(firstClause).slice(0, REALTIME_OBSERVATION_QUERY_MAX_LEN);
}

export function isConcreteRealtimeObservationQuery(query = "") {
  const text = compactText(query);
  if (text.length < 8) return false;
  if (REALTIME_QUERY_DESCRIPTION_RE.test(text)) return false;
  if (REALTIME_QUERY_PRIZE_RANGE_RE.test(text) || REALTIME_QUERY_PRIZE_PAIR_RE.test(text)) return false;
  if (/^(映画|ホビー|グッズ|限定|新作|話題|注目|フィギュアで)/u.test(text)) return false;
  if (/^シリーズ/u.test(text) && text.length < 16) return false;
  return /[\p{L}\p{N}]{4,}/u.test(text);
}

export function prepareRealtimeObservationQuery({ query = "", productName = "" } = {}) {
  const originalQuery = compactText(query);
  const name = compactText(productName);
  const probe = originalQuery || name;
  if (!probe) {
    return {
      ok: false,
      query: "",
      originalQuery,
      shortened: false,
      skipReason: "realtime_query_not_concrete",
    };
  }
  if (
    REALTIME_QUERY_DESCRIPTION_RE.test(probe) ||
    REALTIME_QUERY_PRIZE_RANGE_RE.test(probe) ||
    REALTIME_QUERY_PRIZE_PAIR_RE.test(probe)
  ) {
    return {
      ok: false,
      query: probe,
      originalQuery,
      shortened: false,
      skipReason: "realtime_query_description",
    };
  }

  const candidates = [];
  if (originalQuery) candidates.push(originalQuery);
  if (name && name !== originalQuery) candidates.push(name);
  for (const candidate of candidates) {
    if (
      candidate.length <= REALTIME_OBSERVATION_QUERY_MAX_LEN &&
      isConcreteRealtimeObservationQuery(candidate)
    ) {
      return {
        ok: true,
        query: candidate,
        originalQuery,
        shortened: candidate !== originalQuery,
        skipReason: null,
      };
    }
  }

  const shortenedCandidates = [
    extractConcreteRealtimeFragment(name),
    extractConcreteRealtimeFragment(originalQuery),
  ].filter(Boolean);
  for (const shortened of [...new Set(shortenedCandidates)]) {
    if (
      shortened.length <= REALTIME_OBSERVATION_QUERY_MAX_LEN &&
      isConcreteRealtimeObservationQuery(shortened) &&
      shortened !== probe
    ) {
      return {
        ok: true,
        query: shortened,
        originalQuery,
        shortened: true,
        skipReason: null,
      };
    }
  }

  if (probe.length > REALTIME_OBSERVATION_QUERY_MAX_LEN) {
    return {
      ok: false,
      query: probe,
      originalQuery,
      shortened: false,
      skipReason: "realtime_query_too_long",
    };
  }
  return {
    ok: false,
    query: probe,
    originalQuery,
    shortened: false,
    skipReason: "realtime_query_not_concrete",
  };
}

export function normalizeSocialSearchSignal(row = {}) {
  const samples = Array.isArray(row.samples)
    ? row.samples
        .map((sample) => ({
          text: sanitizeSocialSearchSampleText(sample?.text ?? ""),
          postedAt: sample?.postedAt ?? null,
          accountHandle: sample?.accountHandle ?? null,
          sourceUrl: compactText(sample?.sourceUrl ?? "") || null,
        }))
        .filter((sample) => sample.text.length >= 12)
    : [];
  const sampleTexts = Array.isArray(row.sampleTexts)
    ? row.sampleTexts.map((text) => sanitizeSocialSearchSampleText(text)).filter((text) => text.length >= 12)
    : samples.map((sample) => sample.text).filter(Boolean);
  return {
    provider: compactText(row.provider ?? "yahoo_realtime") || "yahoo_realtime",
    query: compactText(row.query ?? ""),
    searchUrl: compactText(row.searchUrl ?? ""),
    productKey: compactText(row.productKey ?? ""),
    productName: compactText(row.productName ?? ""),
    observedAt: row.observedAt ?? null,
    sampleTexts,
    samples,
    resultCountApprox: Number.isFinite(Number(row.resultCountApprox)) ? Number(row.resultCountApprox) : null,
    sourceMode: row.sourceMode === "buzz_discovery"
      ? "buzz_discovery"
      : row.sourceMode === "browser_observed"
        ? "browser_observed"
        : "browser_observed",
    confidence: Math.min(1, Math.max(0, Number(row.confidence ?? 0))),
    buzzEligible: row.buzzEligible === true,
    parseWarnings: Array.isArray(row.parseWarnings) ? row.parseWarnings : [],
    observationStatus: compactText(row.observationStatus ?? "succeeded") || "succeeded",
  };
}

const LISTING_CURRENCY_VALUES = new Set(["JPY", "USD", "unknown"]);

function inferListingCurrency(rawPriceText = "", explicitCurrency = "") {
  const currency = compactText(explicitCurrency).toUpperCase();
  if (LISTING_CURRENCY_VALUES.has(currency)) return currency;
  const raw = compactText(rawPriceText);
  if (/^US\$/iu.test(raw) || /^USD\b/iu.test(raw) || /^\$/u.test(raw)) return "USD";
  if (/^(?:¥|￥)/u.test(raw) || /円$/u.test(raw)) return "JPY";
  return "unknown";
}

function normalizeListingRawPriceText(rawPriceText = "", currency = "unknown") {
  const raw = compactText(rawPriceText);
  if (!raw) return "";
  if (currency === "JPY") {
    const match = raw.match(/(?:¥|￥)\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*円/u);
    return compactText(match?.[0] ?? raw);
  }
  if (currency === "USD") {
    const match = raw.match(/(?:US\$|\$|USD\s+)\s*[\d,]+(?:\.\d+)?/iu);
    return compactText(match?.[0] ?? raw);
  }
  return raw;
}

export function formatMarketplaceListingPrice(listing = {}) {
  const currency = inferListingCurrency(listing.rawPriceText ?? "", listing.currency ?? "");
  const value = Number(listing.value);
  if (currency === "JPY" && Number.isFinite(value) && value > 0) {
    return `¥${Math.round(value).toLocaleString("ja-JP")}`;
  }
  if (currency === "USD" && Number.isFinite(value) && value > 0) {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
    return `US$${formatted}`;
  }
  const raw = compactText(listing.rawPriceText ?? "");
  if (raw) return raw;
  return Number.isFinite(value) && value > 0 ? String(value) : "（価格不明）";
}

function normalizeJpyCandidate(row = null) {
  if (!row || typeof row !== "object") return null;
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (String(row.currency ?? "").toUpperCase() !== "JPY") return null;
  if (row.buyLineEligible === true) return null;
  const confidence = Math.min(1, Math.max(0, Number(row.confidence ?? 0)));
  const sourceUrl = compactText(row.sourceUrl ?? "");
  if (sourceUrl && !/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(sourceUrl)) return null;
  const statusCandidate = ["on_sale", "sold", "unknown", "sold_or_unavailable"].includes(row.statusCandidate)
    ? row.statusCandidate
    : "unknown";
  return {
    amount: Math.round(amount),
    currency: "JPY",
    source: compactText(row.source ?? "playwright_product_page") || "playwright_product_page",
    sourceUrl,
    fetchedAt: row.fetchedAt ?? null,
    rawText: compactText(row.rawText ?? "").slice(0, 500),
    selectorEvidence: compactText(row.selectorEvidence ?? ""),
    visibleTextSnippet: compactText(row.visibleTextSnippet ?? "").slice(0, 300),
    statusCandidate,
    confidence,
    exclusionReason: row.exclusionReason ?? null,
    buyLineEligible: false,
  };
}

function normalizeListingCandidate(row = {}) {
  const itemUrl = compactText(row.itemUrl ?? "");
  if (!itemUrl || !/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(itemUrl)) return null;
  if (/\/search\?keyword=/i.test(itemUrl)) return null;
  const value = Number(row.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  const title = compactText(row.title ?? "");
  if (!title) return null;
  const inferredRawPriceText = compactText(row.rawPriceText ?? "");
  const currency = inferListingCurrency(inferredRawPriceText, row.currency ?? "");
  const rawPriceText = normalizeListingRawPriceText(inferredRawPriceText, currency);
  const priceParseConfidence = Math.min(
    1,
    Math.max(0, Number(row.priceParseConfidence ?? (currency === "unknown" ? 0.35 : 0.85))),
  );
  const jpyCandidate = normalizeJpyCandidate(row.jpyCandidate);
  const playwrightProbeStatus = normalizePlaywrightProbeStatus(row.playwrightProbeStatus);
  const normalized = {
    value,
    currency,
    rawPriceText: rawPriceText || (currency === "unknown" ? String(value) : formatMarketplaceListingPrice({ value, currency, rawPriceText })),
    priceParseConfidence,
    title,
    itemUrl,
    shippingIncluded: row.shippingIncluded === false ? false : null,
    status: row.status === "sold" ? "sold" : "on_sale",
    observedAt: row.observedAt ?? null,
  };
  if (jpyCandidate) normalized.jpyCandidate = jpyCandidate;
  if (playwrightProbeStatus && !jpyCandidate) normalized.playwrightProbeStatus = playwrightProbeStatus;
  return normalized;
}

function normalizePlaywrightProbeStatus(row = null) {
  if (!row || typeof row !== "object") return null;
  if (row.buyLineEligible === true) return null;
  const browserResult = compactText(row.browserResult ?? "");
  const exclusionReason = compactText(row.exclusionReason ?? "");
  if (!browserResult || !exclusionReason) return null;
  const normalized = {
    browserResult,
    exclusionReason,
    probedAt: row.probedAt ?? null,
    confidence: Math.min(1, Math.max(0, Number(row.confidence ?? 0))),
    notes: compactText(row.notes ?? "").slice(0, 240),
    buyLineEligible: false,
  };
  if (row.saveSkipReason) normalized.saveSkipReason = compactText(row.saveSkipReason);
  if (row.saveSkipCategory) normalized.saveSkipCategory = compactText(row.saveSkipCategory);
  if (row.saveSkipSub) normalized.saveSkipSub = compactText(row.saveSkipSub);
  if (row.selectedCandidateYen != null) normalized.selectedCandidateYen = Number(row.selectedCandidateYen);
  if (row.extractedYenCandidateCount != null) normalized.extractedYenCandidateCount = Number(row.extractedYenCandidateCount);
  if (row.primarySelectorYen != null) normalized.primarySelectorYen = Boolean(row.primarySelectorYen);
  if (row.hasRelatedPriceNoise != null) normalized.hasRelatedPriceNoise = Boolean(row.hasRelatedPriceNoise);
  if (row.visibleYenCandidateCount != null) normalized.visibleYenCandidateCount = Number(row.visibleYenCandidateCount);
  if (Array.isArray(row.visibleYenCandidates)) {
    normalized.visibleYenCandidates = row.visibleYenCandidates
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 5);
  }
  if (Array.isArray(row.relatedPriceNoise)) {
    normalized.relatedPriceNoise = row.relatedPriceNoise
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 5);
  }
  return normalized;
}

export function normalizeMarketplaceBrowserSignal(row = {}) {
  const listingCandidates = Array.isArray(row.listingCandidates)
    ? row.listingCandidates.map(normalizeListingCandidate).filter(Boolean)
    : [];
  return {
    marketplace: compactText(row.marketplace ?? "mercari") || "mercari",
    productKey: compactText(row.productKey ?? ""),
    productName: compactText(row.productName ?? ""),
    query: compactText(row.query ?? ""),
    searchUrl: compactText(row.searchUrl ?? ""),
    listingCandidates,
    soldCandidates: Array.isArray(row.soldCandidates) ? row.soldCandidates : [],
    observedAt: row.observedAt ?? null,
    sourceMode: row.sourceMode === "browser_observed" ? "browser_observed" : "browser_observed",
    priceSourceRank: "browser_observed_candidate",
    buyLineEligible: false,
    parseWarnings: Array.isArray(row.parseWarnings) ? row.parseWarnings : [],
    confidence: Math.min(1, Math.max(0, Number(row.confidence ?? 0))),
    observationStatus: compactText(row.observationStatus ?? "succeeded") || "succeeded",
  };
}

export function isBrowserObservedPriceCandidate(signal = {}) {
  return (
    signal?.sourceMode === "browser_observed" &&
    signal?.priceSourceRank === "browser_observed_candidate" &&
    signal?.buyLineEligible === false
  );
}

export function summarizeMarketplaceSignalQuality(marketplaceSignals = []) {
  let signalsWithUnknownCurrency = 0;
  let signalsWithUsdOnly = 0;
  let signalsWithJpy = 0;
  let listingTotal = 0;
  let signalCount = 0;

  for (const signal of marketplaceSignals) {
    const listings = Array.isArray(signal.listingCandidates) ? signal.listingCandidates : [];
    if (!listings.length) continue;
    signalCount += 1;
    listingTotal += listings.length;

    let hasUnknown = false;
    let hasJpy = false;
    let hasUsd = false;
    for (const listing of listings) {
      const currency = inferListingCurrency(listing.rawPriceText ?? "", listing.currency ?? "");
      if (currency === "unknown") hasUnknown = true;
      if (currency === "JPY") hasJpy = true;
      if (currency === "USD") hasUsd = true;
    }
    if (hasUnknown) signalsWithUnknownCurrency += 1;
    if (hasJpy) signalsWithJpy += 1;
    if (hasUsd && !hasJpy && !hasUnknown) signalsWithUsdOnly += 1;
  }

  return {
    signalsWithUnknownCurrency,
    signalsWithUsdOnly,
    signalsWithJpy,
    averageListingCandidatesPerSignal:
      signalCount > 0 ? Number((listingTotal / signalCount).toFixed(2)) : 0,
  };
}

export const MARKETPLACE_BROWSER_OBSERVED_LABEL = "価格候補確認済み";
export const MARKETPLACE_BROWSER_CANDIDATE_LABEL = "参考価格候補";

export function marketplaceResearchTargetLabel({
  hasObserved = false,
  marketplace = "mercari",
} = {}) {
  if (hasObserved) {
    return MARKETPLACE_BROWSER_OBSERVED_LABEL;
  }
  if (marketplace === "yahoo") return "Yahoo!フリマ確認待ち";
  if (marketplace === "fleamarket") return "フリマ確認対象";
  return "メルカリ確認待ち";
}

function subjectLooksConcrete(name = "", query = "", category = "") {
  const displayName = compactText(decodeHtmlEntities(name));
  const text = compactText(query);
  if (!displayName || !text) return false;
  if (assessMarketplaceQueryRejectReason(text, { primaryName: displayName, category })) return false;
  if (MARKETPLACE_QUERY_ARTICLE_RE.test(displayName) && !/ムビチケ|劇場版/.test(text)) return false;
  if (/^(映画|ホビー|グッズ|限定|新作|話題|注目)/u.test(displayName) && displayName.length < 12) return false;
  if (/コラム|組み立ててみた|実写映画も/.test(displayName)) return false;
  return true;
}

function createMarketplaceExclusions() {
  return { counts: {}, uniqueCounts: {}, uniqueKeys: new Set(), samples: [] };
}

function marketplaceExclusionUniqueKey(reason, entry, query = "") {
  const name = compactText(decodeHtmlEntities(entry.name ?? entry.canonicalName ?? entry.productName ?? ""));
  const q = compactText(query);
  const key = normalizeMarketplaceSubjectKey(q || name);
  return key ? `${reason}::${key}` : "";
}

function recordMarketplaceExclusion(exclusions, reason, entry, query = "") {
  if (!reason) return;
  exclusions.counts[reason] = (exclusions.counts[reason] ?? 0) + 1;
  const uniqueKey = marketplaceExclusionUniqueKey(reason, entry, query);
  if (uniqueKey && !exclusions.uniqueKeys.has(uniqueKey)) {
    exclusions.uniqueKeys.add(uniqueKey);
    exclusions.uniqueCounts[reason] = (exclusions.uniqueCounts[reason] ?? 0) + 1;
  }
  if (exclusions.samples.length < MARKETPLACE_EXCLUSION_SAMPLE_LIMIT) {
    const name = compactText(decodeHtmlEntities(entry.name ?? entry.canonicalName ?? entry.productName ?? ""));
    exclusions.samples.push({
      reason,
      name: name.slice(0, 72),
      query: compactText(query).slice(0, 72) || "(empty)",
      category: entry.category ?? entry.targetCategory ?? "generic_hobby",
      score: Number(entry.genreScore ?? 0) || undefined,
    });
  }
}

function finalizeMarketplaceExclusions(exclusions) {
  return {
    counts: exclusions.counts,
    uniqueCounts: exclusions.uniqueCounts,
    samples: exclusions.samples,
  };
}

function marketplaceProductFamily(subject = {}) {
  const productName = subject.productName ?? "";
  const query = subject.query ?? "";
  const targetCategory = subject.targetCategory ?? "generic_hobby";
  const blob = `${productName} ${query}`;
  if (/ドラゴンクエスト|メタリックモンスターズ/i.test(blob)) return "dq-metallic";
  if (/GARRACK/i.test(blob)) return "garrack";
  if (/G-SHOCK|MRG-|GA-\d/i.test(blob)) return "gshock";
  if (/一番くじ/i.test(blob)) {
    const series = productName.replace(/^一番くじ\s*/u, "").split(/\s+/).slice(0, 2).join(" ");
    return `kuji:${normalizeMarketplaceSubjectKey(series)}`;
  }
  if (/ポケモンカード|ポケカ/i.test(blob)) {
    const setMatch = blob.match(POKEMON_SET_NAME_RE);
    if (setMatch) return `pokemon:${normalizeMarketplaceSubjectKey(setMatch[0])}`;
    if (/デッキシールド|プレイマット/i.test(blob)) return "pokemon:supply";
    return "pokemon:other";
  }
  if (["movie_bonus", "movie_goods"].includes(targetCategory) || /ムビチケ|劇場版/.test(blob)) return "movie";
  if (/映画/.test(blob) && ["movie_bonus", "movie_goods"].includes(targetCategory)) return "movie";
  if (/ROBOT魂|S\.H\.Figuarts|METAL BUILD|ねんどろいど/i.test(blob)) return "figure";
  if (/マスコット|ソフビ/i.test(blob)) return "mascot";
  return targetCategory;
}

function isPokemonSupply(subject = {}) {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  return /デッキシールド|プレイマット|スリーブ|ファイル/i.test(blob);
}

function isWeakMovieQuery(subject = {}) {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  if (!/ムビチケ/.test(blob)) return false;
  return !/映画|劇場版/.test(blob);
}

function isNamedMovieQuery(subject = {}) {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  return /ムビチケ/.test(blob) && /映画|劇場版/.test(blob);
}

function isGenericPokemonCandidate(subject = {}) {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  if (!/ポケモンカード|ポケカ/i.test(blob)) return false;
  if (isPokemonSpecificSet(subject.productName, subject.query) || isPokemonSupply(subject)) return false;
  return true;
}

function isVagueMarketplaceCandidate(subject = {}) {
  const query = compactText(subject.query ?? "");
  const name = compactText(subject.productName ?? "");
  const blob = `${name} ${query}`;
  return (
    /^ポケモンカードゲーム MEGA ハイクラスパック$/iu.test(query) ||
    /^ポケモンカードゲーム 30周年記念商品$/iu.test(query) ||
    /新作くじ|＆限定グッズほか/.test(query) ||
    /^ワンピースカードゲーム 決戦の刻$/iu.test(query) ||
    /のブースターパック|の3周年を記念|特価 激安関連|ゲーム 腕時計 特価/.test(blob) ||
    /^フィギュア ゲーム 腕時計/.test(query) ||
    /四皇モデルのHUAWEI Band/.test(blob) ||
    /^P\.O\.Pフィギュア$/iu.test(query) ||
    /^ワンピース P\.O\.Pフィギュア$/iu.test(query) ||
    /15%|ご利用で$|アクリルスタンド.*15%/.test(blob) ||
    /^プレミアムバンダイ/u.test(query) ||
    /フィギュアとして注目を集めている/.test(blob) ||
    /^拡張パック 変幻の仮面$/iu.test(query) ||
    /全42巻セット|Double Cover Box/.test(blob)
  );
}

function kujiSetPriority(subject = {}) {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  if (/REBORN/i.test(blob)) return 0;
  if (/カービィ|PUPUPU/i.test(blob)) return 1;
  if (/Pokémon 30th|30th ANNIVERSARY/i.test(blob)) return 2;
  if (/アイカツ/i.test(blob)) return 9;
  return 5;
}

function isSwapExcludedCandidate(subject = {}) {
  return (
    isPokemonSupply(subject) ||
    isWeakMovieQuery(subject) ||
    isGenericPokemonCandidate(subject) ||
    isVagueMarketplaceCandidate(subject)
  );
}

function marketplaceSelectionBucket(subject = {}) {
  if (isPokemonSpecificSet(subject.productName, subject.query) && !isPokemonSupply(subject)) {
    return "pokemon-specific";
  }
  if (
    ["movie_bonus", "movie_goods"].includes(subject.targetCategory) ||
    (marketplaceProductFamily(subject) === "movie" && /ムビチケ|劇場版|映画/.test(`${subject.productName} ${subject.query}`))
  ) {
    return "movie";
  }
  if (
    marketplaceProductFamily(subject).startsWith("kuji:") ||
    subject.targetCategory === "kuji" ||
    /一番くじ/i.test(subject.query ?? "")
  ) {
    return "kuji";
  }
  if (marketplaceProductFamily(subject) === "mascot") return "mascot";
  if (/S\.H\.Figuarts|ROBOT魂|METAL BUILD|ねんどろいど/i.test(`${subject.productName} ${subject.query}`)) {
    return "figure";
  }
  if (/GARRACK|G-SHOCK|MRG-|GA-\d/i.test(`${subject.productName} ${subject.query}`)) return "watch";
  return "other";
}

function countSelectionBucket(selected = [], bucket = "") {
  return selected.filter((subject) => marketplaceSelectionBucket(subject) === bucket).length;
}

function familyCapFor(subject = {}, caps = buildMarketplaceSelectionCaps()) {
  const family = marketplaceProductFamily(subject);
  return caps.familyCapOverrides[family] ?? caps.familyCap;
}

function marketplaceSubjectSortScore(subject = {}) {
  let score = Number(subject.genreScore ?? 0);
  if (isSwapExcludedCandidate(subject)) score -= 100;
  if (marketplaceSelectionBucket(subject) === "kuji") score -= kujiSetPriority(subject) * 3;
  if (marketplaceSelectionBucket(subject) === "mascot") score -= 5;
  return score;
}

function pokemonSetPriority(subject = {}) {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  for (let index = 0; index < POKEMON_SET_PRIORITY.length; index += 1) {
    if (blob.includes(POKEMON_SET_PRIORITY[index])) return index;
  }
  return POKEMON_SET_PRIORITY.length;
}

function matchesPokemonSetName(subject = {}, setName = "") {
  const blob = `${subject.productName ?? ""} ${subject.query ?? ""}`;
  return blob.includes(setName) && isPokemonSpecificSet(subject.productName, subject.query) && !isPokemonSupply(subject);
}

function canAddMarketplaceSubject(subject, selected, usedKeys, familyCounts, caps = buildMarketplaceSelectionCaps()) {
  const key = normalizeMarketplaceSubjectKey(subject.productName);
  if (!key || usedKeys.has(key)) return false;
  const bucket = marketplaceSelectionBucket(subject);
  const bucketCap = caps.categoryCaps[bucket];
  if (bucketCap !== undefined && countSelectionBucket(selected, bucket) >= bucketCap) return false;
  const family = marketplaceProductFamily(subject);
  if ((familyCounts.get(family) ?? 0) >= familyCapFor(subject, caps)) return false;
  return true;
}

function selectDiversifiedMarketplaceSubjects(pool = [], { maxSubjects = MARKETPLACE_DEFAULT_MAX_SUBJECTS } = {}) {
  const caps = buildMarketplaceSelectionCaps(maxSubjects);
  const selected = [];
  const usedKeys = new Set();
  const familyCounts = new Map();

  const add = (subject) => {
    const key = normalizeMarketplaceSubjectKey(subject.productName);
    const family = marketplaceProductFamily(subject);
    selected.push(subject);
    usedKeys.add(key);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  };

  for (const setName of POKEMON_SET_PRIORITY) {
    if (countSelectionBucket(selected, "pokemon-specific") >= caps.categoryCaps["pokemon-specific"]) break;
    const candidate = pool
      .filter(
        (subject) =>
          matchesPokemonSetName(subject, setName) && canAddMarketplaceSubject(subject, selected, usedKeys, familyCounts, caps),
      )
      .sort((a, b) => pokemonSetPriority(a) - pokemonSetPriority(b) || marketplaceSubjectSortScore(b) - marketplaceSubjectSortScore(a))[0];
    if (candidate) add(candidate);
  }

  const namedMovies = pool
    .filter((subject) => isNamedMovieQuery(subject) && !isSwapExcludedCandidate(subject))
    .sort((a, b) => marketplaceSubjectSortScore(b) - marketplaceSubjectSortScore(a));
  for (const subject of namedMovies) {
    if (countSelectionBucket(selected, "movie") >= caps.categoryCaps.movie) break;
    if (!canAddMarketplaceSubject(subject, selected, usedKeys, familyCounts, caps)) continue;
    add(subject);
  }

  const sorted = [...pool]
    .filter((subject) => !usedKeys.has(normalizeMarketplaceSubjectKey(subject.productName)))
    .filter((subject) => !isSwapExcludedCandidate(subject))
    .sort((a, b) => marketplaceSubjectSortScore(b) - marketplaceSubjectSortScore(a));

  for (const subject of sorted) {
    if (selected.length >= maxSubjects) break;
    if (!canAddMarketplaceSubject(subject, selected, usedKeys, familyCounts, caps)) continue;
    add(subject);
  }

  if (selected.length < maxSubjects) {
    for (const subject of sorted) {
      if (selected.length >= maxSubjects) break;
      const key = normalizeMarketplaceSubjectKey(subject.productName);
      if (!key || usedKeys.has(key)) continue;
      const family = marketplaceProductFamily(subject);
      const strictCap = familyCapFor(subject, caps);
      if (caps.familyCapOverrides[family] && (familyCounts.get(family) ?? 0) >= strictCap) continue;
      const bucket = marketplaceSelectionBucket(subject);
      const bucketCap = caps.categoryCaps[bucket];
      if (bucketCap !== undefined && countSelectionBucket(selected, bucket) >= bucketCap) continue;
      if ((familyCounts.get(family) ?? 0) >= familyCapFor(subject, caps)) continue;
      add(subject);
    }
  }

  if (selected.length < maxSubjects) {
    for (const subject of sorted) {
      if (selected.length >= maxSubjects) break;
      const key = normalizeMarketplaceSubjectKey(subject.productName);
      if (!key || usedKeys.has(key)) continue;
      add(subject);
    }
  }

  return selected.slice(0, maxSubjects);
}

function summarizeMarketplaceSelection(subjects = []) {
  const byCategory = {};
  const byCategoryDisplay = {};
  const byFamily = {};
  const bySelectionBucket = {};
  for (const subject of subjects) {
    const category = subject.targetCategory ?? "generic_hobby";
    const family = marketplaceProductFamily(subject);
    const bucket = marketplaceSelectionBucket(subject);
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    const display = marketplaceCategoryDisplayLabel(category);
    byCategoryDisplay[display] = (byCategoryDisplay[display] ?? 0) + 1;
    byFamily[family] = (byFamily[family] ?? 0) + 1;
    bySelectionBucket[bucket] = (bySelectionBucket[bucket] ?? 0) + 1;
  }
  return { byCategory, byCategoryDisplay, byFamily, bySelectionBucket, subjectCount: subjects.length };
}

function promotePokemonSpecificCandidates(rawEntries = [], exclusions) {
  const genericPokemon = rawEntries.filter((entry) => isGenericPokemonName(entry.name));
  if (!genericPokemon.length) return rawEntries;
  const specificNearby = rawEntries.filter(
    (entry) =>
      !isGenericPokemonName(entry.name) &&
      (entry.targetCategory === "pokemon" ||
        entry.category === "pokemon" ||
        /ポケモンカード|ポケカ/i.test(entry.name)) &&
      isPokemonSpecificSet(entry.name, ""),
  );
  if (!specificNearby.length) return rawEntries;
  for (const generic of genericPokemon) {
    recordMarketplaceExclusion(exclusions, "query_too_generic", generic, buildMarketplaceResearchQuery({
      canonicalName: generic.canonicalName ?? generic.name,
      productName: generic.productName ?? generic.name,
      name: generic.name,
      title: generic.title ?? generic.name,
      category: generic.targetCategory ?? generic.category ?? "pokemon",
    }));
  }
  const genericKeys = new Set(genericPokemon.map((entry) => normalizeMarketplaceSubjectKey(entry.name)));
  return rawEntries.filter((entry) => !genericKeys.has(normalizeMarketplaceSubjectKey(entry.name)));
}

function collectMarketplaceResearchSubjects(snapshot = {}, { maxSubjects = MARKETPLACE_DEFAULT_MAX_SUBJECTS } = {}) {
  const exclusions = createMarketplaceExclusions();
  const pool = [];
  const seenPoolKeys = new Set();

  const buildEntry = (entry, origin) => ({
    name: entry.name ?? entry.canonicalName,
    canonicalName: entry.canonicalName,
    productName: entry.productName ?? entry.name ?? entry.canonicalName,
    productKey: entry.productKey,
    title: entry.title,
    trend: entry.trend,
    targetCategory: entry.targetCategory ?? entry.category ?? "generic_hobby",
    category: entry.category ?? entry.targetCategory ?? "generic_hobby",
    genreScore: Number(entry.genreScore ?? 0),
    origin,
  });

  const rawEntries = [
    ...(snapshot.discoveryCandidates ?? [])
      .filter((candidate) => candidate?.name)
      .map((candidate) => buildEntry(candidate, "candidate")),
    ...(snapshot.normalizedProducts ?? [])
      .filter((product) => product?.canonicalName)
      .map((product) =>
        buildEntry(
          {
            name: product.canonicalName,
            canonicalName: product.canonicalName,
            productName: product.canonicalName,
            productKey: product.productKey,
            targetCategory: product.category,
            genreScore: product.genreScore,
          },
          "product",
        ),
      ),
  ];

  const promotedEntries = promotePokemonSpecificCandidates(rawEntries, exclusions);

  const tryAddToPool = (entry) => {
    const name = compactText(decodeHtmlEntities(entry.name));
    const category = entry.targetCategory ?? entry.category ?? "generic_hobby";
    const query = buildMarketplaceResearchQuery({
      canonicalName: entry.canonicalName ?? name,
      productName: entry.productName ?? name,
      name,
      title: entry.title ?? name,
      trend: entry.trend ?? "",
      category,
    });
    const rejectReason = assessMarketplaceQueryRejectReason(query, { primaryName: name, category });
    if (rejectReason) {
      recordMarketplaceExclusion(exclusions, rejectReason, entry, query);
      return;
    }
    if (!subjectLooksConcrete(name, query, category)) {
      recordMarketplaceExclusion(exclusions, "query_not_concrete", entry, query);
      return;
    }
    const key = normalizeMarketplaceSubjectKey(name);
    const queryKey = normalizeMarketplaceSubjectKey(query);
    if (!key || seenPoolKeys.has(key) || (queryKey && seenPoolKeys.has(`q:${queryKey}`))) return;
    seenPoolKeys.add(key);
    if (queryKey) seenPoolKeys.add(`q:${queryKey}`);
    pool.push({
      productKey: entry.productKey ?? key,
      productName: name,
      query,
      targetCategory: category,
      genreScore: Number(entry.genreScore ?? 0),
      origin: entry.origin ?? "candidate",
    });
  };

  const rankedEntries = [...promotedEntries].sort((a, b) => Number(b.genreScore ?? 0) - Number(a.genreScore ?? 0));
  for (const entry of rankedEntries) tryAddToPool(entry);

  const subjects = selectDiversifiedMarketplaceSubjects(pool, { maxSubjects });
  return { subjects, exclusions: finalizeMarketplaceExclusions(exclusions), selectionSummary: summarizeMarketplaceSelection(subjects) };
}

function buildMarketplaceResearchTargetForSubject(subject, marketplace) {
  const searchUrl =
    marketplace === "yahoo" ? buildYahooFleamarketSearchUrl(subject.query) : buildMercariSearchUrl(subject.query);
  if (!searchUrl) return null;
  const label = marketplaceResearchTargetLabel({ hasObserved: false, marketplace });
  return {
    id: `marketplace:${marketplace}:${subject.productKey}`,
    productKey: subject.productKey,
    productName: subject.productName,
    marketplace,
    query: subject.query,
    searchUrl,
    label,
    reason: "価格未確認のため、検索結果を手動で確認する",
    expectedEvidence: [...MARKETPLACE_MANUAL_CHECK_EVIDENCE],
    sourceMode: "manual_check",
    buyLineEligible: false,
    targetCategory: subject.targetCategory,
    origin: subject.origin,
  };
}

function buildRealtimeResearchTargetForSubject(subject) {
  const searchUrl = buildYahooRealtimeSearchUrl(subject.query);
  if (!searchUrl) return null;
  return {
    id: `realtime:yahoo:${subject.productKey}`,
    productKey: subject.productKey,
    productName: subject.productName,
    provider: "yahoo_realtime",
    query: subject.query,
    searchUrl,
    label: realtimeResearchTargetLabel(),
    reason: "SNS上の言及をブラウザで確認する",
    sourceMode: "browser_check",
    status: "pending",
    buyLineEligible: false,
    buzzEligible: false,
    targetCategory: subject.targetCategory,
    origin: subject.origin,
  };
}

export function buildRealtimeResearchTargetsFromSubjects(subjects = []) {
  const targets = [];
  for (const subject of subjects) {
    const target = buildRealtimeResearchTargetForSubject(subject);
    if (target) targets.push(target);
  }
  return targets;
}

export function buildMarketplaceResearchTargets(snapshot = {}, { maxSubjects = MARKETPLACE_DEFAULT_MAX_SUBJECTS } = {}) {
  const { subjects, exclusions, selectionSummary } = collectMarketplaceResearchSubjects(snapshot, { maxSubjects });
  const targets = [];
  for (const subject of subjects) {
    for (const marketplace of ["mercari", "yahoo"]) {
      if (targets.length >= LIMITS.MARKETPLACE_TARGETS_HARD_MAX) break;
      const target = buildMarketplaceResearchTargetForSubject(subject, marketplace);
      if (target) targets.push(target);
    }
    if (targets.length >= LIMITS.MARKETPLACE_TARGETS_HARD_MAX) break;
  }
  const realtimeTargets = buildRealtimeResearchTargetsFromSubjects(subjects);
  return { targets, exclusions, selectionSummary, subjects, realtimeTargets };
}

export function applyBrowserObservationLayerToSnapshot(snapshot = {}, { maxSubjects = MARKETPLACE_DEFAULT_MAX_SUBJECTS } = {}) {
  const next = { ...snapshot };
  const { subjects, realtimeTargets } = buildMarketplaceResearchTargets(next, { maxSubjects });
  void subjects;
  next.realtimeResearchTargets = realtimeTargets;
  next.socialSearchSignals = (Array.isArray(next.socialSearchSignals) ? next.socialSearchSignals : []).map(normalizeSocialSearchSignal);
  next.marketplaceSignals = (Array.isArray(next.marketplaceSignals) ? next.marketplaceSignals : []).map(normalizeMarketplaceBrowserSignal);
  const realtimeDisplayLimit = resolveRealtimeDisplayLimit();
  next.metadata = {
    ...(next.metadata ?? {}),
    realtimeResearchTargetCount: realtimeTargets.length,
    yahooRealtimeCheckUrlCount: realtimeTargets.filter((target) => target.searchUrl).length,
    socialSearchSignalCount: next.socialSearchSignals.length,
    marketplaceSignalCount: next.marketplaceSignals.length,
    browserObservedPriceCandidateCount: next.marketplaceSignals.filter((row) => isBrowserObservedPriceCandidate(row)).length,
    realtimeDisplayLimit,
  };
  return next;
}

function marketplaceExplorationTaskFromTarget(target) {
  return {
    id: `marketplace_check:${target.marketplace}:${target.productKey}`,
    kind: "marketplace_check",
    status: "queued",
    dueAt: new Date().toISOString().slice(0, 10),
    topic: target.productName,
    targetCategory: target.targetCategory ?? "generic_hobby",
    marketplace: target.marketplace,
    query: target.query,
    searchUrl: target.searchUrl,
    reason: target.reason,
    expectedEvidence: target.expectedEvidence,
    sourceMode: "manual_check",
    buyLineEligible: false,
    priority: "medium",
    origin: `marketplace-${target.origin}`,
  };
}

function mergeRealtimeTargetObservationState(targets = [], queue = [], socialSearchSignals = []) {
  const queueById = new Map((queue ?? []).map((item) => [item.id, item]));
  const observedKeys = new Set(
    (socialSearchSignals ?? [])
      .filter((row) => row?.sourceMode === "browser_observed")
      .map((row) => [row.provider ?? "yahoo_realtime", row.productKey ?? "", row.query ?? ""].join("::")),
  );
  return targets.map((target) => {
    const key = [target.provider ?? "yahoo_realtime", target.productKey ?? "", target.query ?? ""].join("::");
    const queueItem = queueById.get(target.id);
    let status = queueItem?.status ?? target.status ?? "pending";
    if (observedKeys.has(key)) status = "browser_observed";
    return {
      ...target,
      status,
      lastError: queueItem?.lastError ?? target.lastError ?? null,
      lastAttemptAt: queueItem?.lastAttemptAt ?? target.lastAttemptAt ?? null,
    };
  });
}

export function applyMarketplaceResearchToSnapshot(snapshot = {}, { maxSubjects = MARKETPLACE_DEFAULT_MAX_SUBJECTS } = {}) {
  const next = { ...snapshot };
  const preservedSocialSearchSignals = (Array.isArray(next.socialSearchSignals) ? next.socialSearchSignals : []).map(
    normalizeSocialSearchSignal,
  );
  const preservedBrowserObservationQueue = Array.isArray(next.browserObservationQueue) ? next.browserObservationQueue : [];
  const { targets, exclusions, selectionSummary, realtimeTargets } = buildMarketplaceResearchTargets(next, { maxSubjects });
  next.marketplaceResearchTargets = targets;
  next.realtimeResearchTargets = mergeRealtimeTargetObservationState(
    realtimeTargets,
    preservedBrowserObservationQueue,
    preservedSocialSearchSignals,
  );
  next.socialSearchSignals = preservedSocialSearchSignals;
  if (!Array.isArray(next.browserObservationQueue)) next.browserObservationQueue = preservedBrowserObservationQueue;
  next.marketplaceSignals = (Array.isArray(next.marketplaceSignals) ? next.marketplaceSignals : []).map(normalizeMarketplaceBrowserSignal);

  const manualTaskIds = new Set(targets.map((target) => `marketplace_check:${target.marketplace}:${target.productKey}`));
  const preservedTasks = (next.explorationTasks ?? []).filter(
    (task) => !manualTaskIds.has(task.id) && task?.kind !== "marketplace_check" && task?.sourceMode !== "manual_check",
  );
  const manualTasks = targets.map((target) => marketplaceExplorationTaskFromTarget(target));
  const explorationTaskLimit = Math.min(
    LIMITS.MARKETPLACE_TARGETS_HARD_MAX + 32,
    Math.max(96, targets.length + 32),
  );
  next.explorationTasks = [...manualTasks, ...preservedTasks].slice(0, explorationTaskLimit);
  const observationLimits = resolveObservationLimits();
  const marketplaceDisplayLimit = resolveMarketplaceDisplayLimit();

  next.metadata = {
    ...(next.metadata ?? {}),
    observationLimits,
    marketplaceDisplayLimit,
    socialDisplayLimit: observationLimits.socialDisplayLimit,
    marketplaceResearchSubjectCount: selectionSummary.subjectCount,
    marketplaceResearchSubjectLimit: maxSubjects,
    marketplaceResearchTargetCount: targets.length,
    marketplaceResearchTargetLimit: Math.min(maxSubjects * 2, LIMITS.MARKETPLACE_TARGETS_HARD_MAX),
    mercariCheckUrlCount: targets.filter((target) => target.marketplace === "mercari").length,
    yahooFleamarketCheckUrlCount: targets.filter((target) => target.marketplace === "yahoo").length,
    realtimeResearchTargetCount: realtimeTargets.length,
    yahooRealtimeCheckUrlCount: realtimeTargets.filter((target) => target.searchUrl).length,
    socialSearchSignalCount: next.socialSearchSignals.length,
    marketplaceSignalCount: next.marketplaceSignals.length,
    browserObservedPriceCandidateCount: next.marketplaceSignals.filter((row) => isBrowserObservedPriceCandidate(row)).length,
    realtimeDisplayLimit: resolveRealtimeDisplayLimit(),
    marketplaceQueryExclusions: exclusions,
    marketplaceSelectionSummary: selectionSummary,
    marketplaceCategoryDisplayMap: MARKETPLACE_CATEGORY_DISPLAY_MAP,
  };
  return next;
}

export function sanitizeClaimText(text, metrics = {}) {
  let out = compactText(text);
  if (!out) return out;
  const xObserved =
    (metrics.xObservedApi ?? 0) > 0 ||
    (metrics.xEngagementApi ?? 0) > 0 ||
    (metrics.xBuzzEligible ?? 0) > 0;
  const marketplaceObserved = (metrics.marketplacePriceSnapshots ?? 0) > 0;

  out = out
    .replace(/Xでバズ/g, "SNS確認待ち")
    .replace(/SNSで急上昇/g, "SNS確認待ち")
    .replace(/SNS反応/g, "SNS確認待ち");
  if (!xObserved) {
    out = out.replace(/X話題/g, "X確認対象");
  }
  if (!marketplaceObserved) {
    out = out.replace(/Yahoo!フリマ相場/g, "Yahoo!フリマ確認待ち");
    out = out.replace(/メルカリ相場/g, "メルカリ確認待ち");
    out = out.replace(/フリマ相場/g, "フリマ確認対象");
    out = out.replace(/実勢相場/g, "価格確認待ち");
    out = out.replace(/観測相場/g, "参考価格");
  }
  return out;
}

function collectUrlsFromSnapshot(snapshot) {
  const urls = [];
  const push = (value) => {
    if (value) urls.push(String(value));
  };
  for (const doc of snapshot.documents ?? []) {
    push(doc.url);
    push(doc.sourceUrl);
    for (const link of doc.links ?? []) push(typeof link === "string" ? link : link?.url);
  }
  for (const candidate of snapshot.discoveryCandidates ?? []) {
    push(candidate.sourceUrl);
    push(candidate.routeFinalUrl);
  }
  for (const price of snapshot.priceSnapshots ?? []) {
    push(price.url);
    push(price.sourceUrl);
    push(price.marketUrl);
    push(price.listingUrl);
  }
  for (const route of snapshot.routeSnapshots ?? []) {
    push(route.url);
    push(route.applyUrl);
    push(route.sourceUrl);
  }
  return urls;
}

function summarizeXObservationQueueFromQueue(queue = []) {
  const byStatus = {};
  for (const item of queue) {
    const status = String(item?.status ?? "pending");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    total: queue.length,
    byStatus,
    pending: byStatus.pending ?? 0,
    reader_observed: byStatus.reader_observed ?? 0,
    failed: byStatus.failed ?? 0,
    skipped: byStatus.skipped ?? 0,
    stale: byStatus.stale ?? 0,
  };
}

function summarizeBrowserObservationQueueSummary(queue = []) {
  const byStatus = {};
  for (const item of queue) {
    const status = String(item?.status ?? "pending");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    total: queue.length,
    byStatus,
    pending: byStatus.pending ?? 0,
    browser_observed: byStatus.browser_observed ?? 0,
    failed: byStatus.failed ?? 0,
    skipped: byStatus.skipped ?? 0,
    stale: byStatus.stale ?? 0,
  };
}

function summarizeMarketplaceObservationQueueSummary(queue = []) {
  const byStatus = {};
  for (const item of queue) {
    const status = String(item?.status ?? "pending");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    total: queue.length,
    byStatus,
    pending: byStatus.pending ?? 0,
    browser_observed: byStatus.browser_observed ?? 0,
    failed: byStatus.failed ?? 0,
    skipped: byStatus.skipped ?? 0,
    stale: byStatus.stale ?? 0,
  };
}

function collectObservationLayerLabelBlob(snapshot = {}) {
  return JSON.stringify({
    marketplaceResearchTargets: snapshot.marketplaceResearchTargets ?? [],
    realtimeResearchTargets: snapshot.realtimeResearchTargets ?? [],
    marketplaceSignals: snapshot.marketplaceSignals ?? [],
    socialSearchSignals: snapshot.socialSearchSignals ?? [],
    explorationTasks: (snapshot.explorationTasks ?? []).filter(
      (task) => task?.kind === "marketplace_check" || task?.sourceMode === "manual_check" || task?.sourceMode === "browser_check",
    ),
  });
}

function detectForbiddenObservationLabels(snapshot = {}) {
  const blob = JSON.stringify(snapshot);
  const observationLayerBlob = collectObservationLayerLabelBlob(snapshot);
  return {
    xTopic: observationLayerBlob.includes("X話題") || blob.includes("X話題"),
    xBuzz: observationLayerBlob.includes("Xでバズ") || blob.includes("Xでバズ"),
    snsRising:
      observationLayerBlob.includes("SNS急上昇") ||
      observationLayerBlob.includes("SNSで急上昇") ||
      blob.includes("SNS急上昇") ||
      blob.includes("SNSで急上昇"),
    mercariMarketPrice: /メルカリ相場/.test(observationLayerBlob),
    fleamarketMarketPrice: /フリマ相場/.test(observationLayerBlob),
    realMarketPrice: /実勢相場/.test(observationLayerBlob),
  };
}

export function countObservationMetrics(snapshot = {}) {
  const socialSignals = Array.isArray(snapshot.socialSignals) ? snapshot.socialSignals : [];
  const socialSearchSignals = Array.isArray(snapshot.socialSearchSignals) ? snapshot.socialSearchSignals : [];
  const marketplaceSignals = Array.isArray(snapshot.marketplaceSignals) ? snapshot.marketplaceSignals : [];
  const realtimeResearchTargets = Array.isArray(snapshot.realtimeResearchTargets) ? snapshot.realtimeResearchTargets : [];
  const urls = collectUrlsFromSnapshot(snapshot);

  let xUrl = 0;
  let xStatusUrl = 0;
  let mercariUrl = 0;
  let mercariItemUrl = 0;
  let yahooFleamarketUrl = 0;
  for (const url of urls) {
    if (X_HOST_RE.test(url) || /t\.co\//i.test(url)) xUrl += 1;
    if (X_STATUS_RE.test(url)) xStatusUrl += 1;
    if (/mercari/i.test(url)) mercariUrl += 1;
    if (isMercariItemUrl(url)) mercariItemUrl += 1;
    if (isYahooFleamarketUrl(url)) yahooFleamarketUrl += 1;
  }

  let xPostText = 0;
  let xEngagement = 0;
  for (const doc of snapshot.documents ?? []) {
    const url = String(doc.url ?? doc.sourceUrl ?? "");
    if (!X_HOST_RE.test(url) && !X_STATUS_RE.test(url)) continue;
    if (compactText(doc.text ?? doc.content ?? "").length >= 20) xPostText += 1;
    if (hasEngagementMetrics(doc) || hasEngagementMetrics(doc.social) || hasEngagementMetrics(doc.engagement)) {
      xEngagement += 1;
    }
  }
  let xReaderObservedText = 0;
  let xReaderEngagementParsed = 0;
  let xReaderParseWarnings = 0;
  let xObservedApi = 0;
  let xEngagementApi = 0;
  for (const row of socialSignals) {
    if (compactText(row.text).length >= 20) xPostText += 1;
    if (hasEngagementMetrics(row)) xEngagement += 1;
    if (row?.sourceMode === "reader_observed") {
      if (compactText(row.text).length >= 20) xReaderObservedText += 1;
      if (Number(row.engagement?.parseConfidence ?? 0) >= 0.7) xReaderEngagementParsed += 1;
      if (Array.isArray(row.parseWarnings)) xReaderParseWarnings += row.parseWarnings.length;
    }
    if (["observed", "observed_api"].includes(row?.sourceMode)) {
      xObservedApi += 1;
      if (hasEngagementMetrics(row.engagement) || hasEngagementMetrics(row)) xEngagementApi += 1;
    }
  }

  const xReader = snapshot.metadata?.xReaderExecution ?? {};
  const browserObservation = snapshot.metadata?.browserObservationExecution ?? {};
  const queueSummary = snapshot.metadata?.xObservationQueueSummary ?? summarizeXObservationQueueFromQueue(snapshot.xObservationQueue);
  const browserQueueSummary =
    snapshot.metadata?.browserObservationQueueSummary ??
    summarizeBrowserObservationQueueSummary(snapshot.browserObservationQueue);
  const marketplaceObservation = snapshot.metadata?.marketplaceObservationExecution ?? {};
  const marketplaceQueueSummary =
    snapshot.metadata?.marketplaceObservationQueueSummary ??
    summarizeMarketplaceObservationQueueSummary(snapshot.marketplaceObservationQueue);

  const prices = snapshot.priceSnapshots ?? [];
  const observed = prices.filter((price) => price.priceSourceRank === "observed_market_price");
  const marketplacePriceSnapshots = prices.filter((price) => isObservedMarketplacePrice(price)).length;
  const observedMarketPriceSources = observed.reduce((acc, price) => {
    const key = String(price.source ?? price.sourceKind ?? price.marketplace ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const buyLineEligibleSources = prices
    .filter((price) => price.buyLineEligible)
    .reduce((acc, price) => {
      const key = String(price.priceSourceRank ?? "missing");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

  const marketplaceResearchTargets = Array.isArray(snapshot.marketplaceResearchTargets)
    ? snapshot.marketplaceResearchTargets
    : [];
  const manualCheckTasks = (snapshot.explorationTasks ?? []).filter(
    (task) => task?.sourceMode === "manual_check" || task?.kind === "marketplace_check",
  );
  const mercariCheckUrl =
    marketplaceResearchTargets.filter((target) => target.marketplace === "mercari" && target.searchUrl).length ||
    manualCheckTasks.filter((task) => task.marketplace === "mercari" && task.searchUrl).length;
  const yahooFleamarketCheckUrl =
    marketplaceResearchTargets.filter((target) => target.marketplace === "yahoo" && target.searchUrl).length ||
    manualCheckTasks.filter((task) => task.marketplace === "yahoo" && task.searchUrl).length;

  const marketplaceSelectionSummary = snapshot.metadata?.marketplaceSelectionSummary ?? {};
  const marketplaceQueryExclusions = snapshot.metadata?.marketplaceQueryExclusions ?? {};
  const observationLimits = snapshot.metadata?.observationLimits ?? resolveObservationLimits();
  const marketplaceDisplayLimit = Number(
    snapshot.metadata?.marketplaceDisplayLimit ?? observationLimits.marketplaceDisplayLimit ?? resolveMarketplaceDisplayLimit(),
  );
  const forbiddenLabels = detectForbiddenObservationLabels(snapshot);
  const realtimeDisplayLimit = Number(
    snapshot.metadata?.realtimeDisplayLimit ?? observationLimits.realtimeDisplayLimit ?? resolveRealtimeDisplayLimit(),
  );
  const browserObservedPriceCandidates = marketplaceSignals.filter((row) => isBrowserObservedPriceCandidate(row)).length;
  const socialSearchSignalsObserved = socialSearchSignals.filter((row) => row.sourceMode === "browser_observed").length;
  const browserObservedRealtimeCandidates = socialSearchSignalsObserved;
  const browserObservationQueue = Array.isArray(snapshot.browserObservationQueue) ? snapshot.browserObservationQueue : [];
  const realtimeResearchTargetsFailed = Math.max(
    browserQueueSummary.failed ?? 0,
    realtimeResearchTargets.filter((target) => target.status === "failed").length,
  );
  const realtimeResearchTargetsSkipped = Math.max(
    browserQueueSummary.skipped ?? 0,
    realtimeResearchTargets.filter((target) => target.status === "skipped").length,
  );
  const browserObservationSkippedByReason = browserObservation.skippedByReason ?? {};
  const realtimeQuerySkippedReasons = browserObservationQueue.reduce((acc, item) => {
    const reason = String(item?.skipReason ?? "");
    if (!reason) return acc;
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
  const socialSearchConfidenceDistribution = socialSearchSignals.reduce((acc, row) => {
    const confidence = Number(row.confidence ?? 0);
    const bucket =
      confidence >= SOCIAL_SEARCH_CONFIDENCE_BADGE_MIN
        ? "badge_eligible"
        : confidence > 0
          ? "below_badge_threshold"
          : "zero";
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});
  const marketplaceConfidenceDistribution = marketplaceSignals.reduce((acc, row) => {
    const confidence = Number(row.confidence ?? 0);
    const bucket =
      confidence >= SOCIAL_SEARCH_CONFIDENCE_BADGE_MIN
        ? "badge_eligible"
        : confidence > 0
          ? "below_badge_threshold"
          : "zero";
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});
  const marketplaceListingCandidateCount = marketplaceSignals.reduce(
    (sum, row) => sum + (Array.isArray(row.listingCandidates) ? row.listingCandidates.length : 0),
    0,
  );
  const marketplaceListingCurrencyDistribution = marketplaceSignals.reduce((acc, row) => {
    for (const listing of row.listingCandidates ?? []) {
      const currency = inferListingCurrency(listing.rawPriceText ?? "", listing.currency ?? "unknown");
      acc[currency] = (acc[currency] ?? 0) + 1;
    }
    return acc;
  }, {});
  const marketplaceSignalQuality = summarizeMarketplaceSignalQuality(marketplaceSignals);
  const buyLineBrowserMix =
    (snapshot.priceSnapshots ?? []).some(
      (price) =>
        price.buyLineEligible &&
        (price.sourceMode === "browser_observed" ||
          price.priceSourceRank === "browser_observed" ||
          price.priceSourceRank === "browser_observed_candidate" ||
          price.provider === "yahoo_realtime"),
    ) || false;
  const buyLineEligibleFalseCounts = {
    marketplaceResearchTargets: marketplaceResearchTargets.filter((target) => target.buyLineEligible === false).length,
    realtimeResearchTargets: realtimeResearchTargets.filter((target) => target.buyLineEligible === false).length,
    marketplaceSignals: marketplaceSignals.filter((row) => row.buyLineEligible === false).length,
    socialSearchSignals: socialSearchSignals.filter((row) => row.buzzEligible === false).length,
  };

  return {
    socialSignals: socialSignals.length,
    xUrl,
    xStatusUrl,
    xStatusUrlCandidates: Number(queueSummary.total ?? xReader.xStatusUrlCandidates ?? xStatusUrl),
    xObservationQueueTotal: Number(queueSummary.total ?? xReader.xObservationQueueTotal ?? 0),
    xObservationQueuePending: Number(queueSummary.pending ?? xReader.xObservationQueuePending ?? 0),
    xObservationQueueObserved: Number(queueSummary.reader_observed ?? xReader.xObservationQueueObserved ?? 0),
    xObservationQueueFailed: Number(queueSummary.failed ?? xReader.xObservationQueueFailed ?? 0),
    xObservationQueueSkipped: Number(queueSummary.skipped ?? xReader.xObservationQueueSkipped ?? 0),
    xObservationQueueStale: Number(queueSummary.stale ?? xReader.xObservationQueueStale ?? 0),
    xReaderRequested: Number(xReader.requested ?? 0),
    xReaderSucceeded: Number(xReader.succeeded ?? 0),
    xReaderFailed: Number(xReader.failed ?? 0),
    xReaderSkipped: Number(xReader.skipped ?? 0),
    xReaderObservedText: Number(xReader.xReaderObservedText ?? xReaderObservedText),
    xReaderEngagementParsed: Number(xReader.xReaderEngagementParsed ?? xReaderEngagementParsed),
    xReaderParseWarnings: Number(xReader.xReaderParseWarnings ?? xReaderParseWarnings),
    xBuzzEligible: Number(xReader.xBuzzEligible ?? 0),
    xPostText,
    xEngagement,
    xObservedApi,
    xEngagementApi,
    socialSearchSignals: socialSearchSignals.length,
    socialSearchSignalsObserved,
    browserObservedRealtimeCandidates,
    realtimeResearchTargetsPending:
      browserQueueSummary.pending ??
      realtimeResearchTargets.filter((target) => (target.status ?? "pending") === "pending").length,
    browserObservationRequested: Number(browserObservation.requested ?? 0),
    browserObservationSucceeded: Number(browserObservation.succeeded ?? 0),
    browserObservationFailed: Number(browserObservation.failed ?? 0),
    browserObservationSkipped: Number(browserObservation.skipped ?? 0),
    browserObservationSkippedByReason:
      Object.keys(browserObservationSkippedByReason).length > 0 ? browserObservationSkippedByReason : realtimeQuerySkippedReasons,
    realtimeQuerySkippedReasons,
    socialSearchConfidenceDistribution,
    realtimeResearchTargetsFailed,
    realtimeResearchTargetsSkipped,
    buyLineBrowserMix,
    buyLineBrowserMixDetected: buyLineBrowserMix,
    browserObservedInPriceSnapshots: (snapshot.priceSnapshots ?? []).some(
      (price) =>
        price.sourceMode === "browser_observed" ||
        price.priceSourceRank === "browser_observed" ||
        price.priceSourceRank === "browser_observed_candidate" ||
        price.provider === "yahoo_realtime",
    ),
    browserObservationByStatus:
      browserObservation.byStatus && typeof browserObservation.byStatus === "object"
        ? browserObservation.byStatus
        : {},
    browserObservationQueueTotal: Number(browserQueueSummary.total ?? browserObservation.browserObservationQueueTotal ?? 0),
    browserObservationQueuePending: Number(
      browserQueueSummary.pending ?? browserObservation.browserObservationQueuePending ?? 0,
    ),
    browserObservationQueueObserved: Number(
      browserQueueSummary.browser_observed ?? browserObservation.browserObservationQueueObserved ?? 0,
    ),
    browserObservationQueueFailed: Number(
      browserQueueSummary.failed ?? browserObservation.browserObservationQueueFailed ?? 0,
    ),
    browserObservationQueueSkipped: Number(
      browserQueueSummary.skipped ?? browserObservation.browserObservationQueueSkipped ?? 0,
    ),
    browserObservationQueueStale: Number(
      browserQueueSummary.stale ?? browserObservation.browserObservationQueueStale ?? 0,
    ),
    marketplaceObservationRequested: Number(marketplaceObservation.requested ?? 0),
    marketplaceObservationSucceeded: Number(marketplaceObservation.succeeded ?? 0),
    marketplaceObservationFailed: Number(marketplaceObservation.failed ?? 0),
    marketplaceObservationSkipped: Number(marketplaceObservation.skipped ?? 0),
    marketplaceObservationByStatus:
      marketplaceObservation.byStatus && typeof marketplaceObservation.byStatus === "object"
        ? marketplaceObservation.byStatus
        : {},
    marketplaceObservationQueueTotal: Number(
      marketplaceQueueSummary.total ?? marketplaceObservation.marketplaceObservationQueueTotal ?? 0,
    ),
    marketplaceObservationQueuePending: Number(
      marketplaceQueueSummary.pending ?? marketplaceObservation.marketplaceObservationQueuePending ?? 0,
    ),
    marketplaceObservationQueueObserved: Number(
      marketplaceQueueSummary.browser_observed ?? marketplaceObservation.marketplaceObservationQueueObserved ?? 0,
    ),
    marketplaceObservationQueueFailed: Number(
      marketplaceQueueSummary.failed ?? marketplaceObservation.marketplaceObservationQueueFailed ?? 0,
    ),
    marketplaceObservationQueueSkipped: Number(
      marketplaceQueueSummary.skipped ?? marketplaceObservation.marketplaceObservationQueueSkipped ?? 0,
    ),
    marketplaceObservationQueueSkippedByReason:
      marketplaceQueueSummary.skippedByReason && typeof marketplaceQueueSummary.skippedByReason === "object"
        ? marketplaceQueueSummary.skippedByReason
        : {},
    marketplaceObservationLastRunSkippedByReason:
      marketplaceObservation.skippedByReason && typeof marketplaceObservation.skippedByReason === "object"
        ? marketplaceObservation.skippedByReason
        : {},
    marketplaceObservationQueueStale: Number(
      marketplaceQueueSummary.stale ?? marketplaceObservation.marketplaceObservationQueueStale ?? 0,
    ),
    marketplaceListingCandidateCount,
    marketplaceListingCurrencyDistribution,
    signalsWithUnknownCurrency: marketplaceSignalQuality.signalsWithUnknownCurrency,
    signalsWithUsdOnly: marketplaceSignalQuality.signalsWithUsdOnly,
    signalsWithJpy: marketplaceSignalQuality.signalsWithJpy,
    averageListingCandidatesPerSignal: marketplaceSignalQuality.averageListingCandidatesPerSignal,
    unknownCurrencyRecheckPending: Number(marketplaceObservation.unknownCurrencyRecheckPending ?? 0),
    unknownCurrencyRecheckRequested: Number(marketplaceObservation.unknownCurrencyRecheckRequested ?? 0),
    unknownCurrencyRecheckSucceeded: Number(marketplaceObservation.unknownCurrencyRecheckSucceeded ?? 0),
    unknownCurrencyRecheckStillUnknown: Number(marketplaceObservation.unknownCurrencyRecheckStillUnknown ?? 0),
    marketplaceConfidenceDistribution,
    realtimeResearchTargets: realtimeResearchTargets.length,
    yahooRealtimeCheckUrl:
      realtimeResearchTargets.filter((target) => target.searchUrl).length ||
      Number(snapshot.metadata?.yahooRealtimeCheckUrlCount ?? 0),
    marketplaceSignals: marketplaceSignals.length,
    browserObservedPriceCandidates,
    buyLineEligibleFalseCounts,
    mercariUrl,
    mercariItemUrl,
    yahooFleamarketUrl,
    marketplacePriceSnapshots,
    observedMarketPrice: observed.length,
    observedMarketPriceSources,
    buyLineEligibleSources,
    marketplaceResearchSubjectCount: Number(
      snapshot.metadata?.marketplaceResearchSubjectCount ?? marketplaceSelectionSummary.subjectCount ?? 0,
    ),
    marketplaceResearchTargets: marketplaceResearchTargets.length,
    mercariCheckUrl,
    yahooFleamarketCheckUrl,
    marketplaceCategoryDistribution: marketplaceSelectionSummary.byCategoryDisplay ?? marketplaceSelectionSummary.byCategory ?? {},
    marketplaceFamilyDistribution: marketplaceSelectionSummary.byFamily ?? {},
    marketplaceExcludedUniqueCounts: marketplaceQueryExclusions.uniqueCounts ?? {},
    marketplaceDisplayCount: Math.min(marketplaceDisplayLimit, marketplaceResearchTargets.length),
    marketplaceDisplayLimit,
    realtimeDisplayCount: Math.min(realtimeDisplayLimit, realtimeResearchTargets.length),
    realtimeDisplayLimit,
    observationLimits,
    forbiddenLabels,
    forbiddenLabelDetected: Object.values(forbiddenLabels).some(Boolean),
    jpyCandidate: {
      ...summarizeJpyCandidateSnapshot(snapshot),
      lastProbe: snapshot.metadata?.jpyCandidateProbe ?? null,
      probeHistory: snapshot.metadata?.jpyCandidateProbeHistory ?? [],
      mercariProbeSkip: summarizeMercariProbeSkipRegistry(snapshot),
    },
  };
}

export function sanitizeSnapshotClaims(snapshot = {}) {
  const metrics = countObservationMetrics(snapshot);
  const scrub = (value) => sanitizeClaimText(value, metrics);
  const next = { ...snapshot };

  if (next.overviewNarrative?.text) {
    next.overviewNarrative = { ...next.overviewNarrative, text: scrub(next.overviewNarrative.text) };
  }
  next.trends = (next.trends ?? []).map((trend) => ({
    ...trend,
    context: scrub(trend.context),
    action: scrub(trend.action),
  }));
  next.discoveryCandidates = (next.discoveryCandidates ?? []).map((candidate) => ({
    ...candidate,
    reason: scrub(candidate.reason),
    adoptionReason: scrub(candidate.adoptionReason),
    aiThesis: candidate.aiThesis
      ? {
          ...candidate.aiThesis,
          whyHot: scrub(candidate.aiThesis.whyHot),
        }
      : candidate.aiThesis,
  }));
  next.sourceResults = (next.sourceResults ?? []).map((result) => ({
    ...result,
    signals: Array.isArray(result.signals) ? result.signals.map((signal) => scrub(String(signal))) : result.signals,
  }));
  next.selectionReasons = (next.selectionReasons ?? []).map((reason) => ({
    ...reason,
    whyTopic: scrub(reason.whyTopic),
    whyTiming: scrub(reason.whyTiming),
    whyRoute: scrub(reason.whyRoute),
    whyPrice: scrub(reason.whyPrice),
    shortNow: scrub(reason.shortNow),
    shortSoon: scrub(reason.shortSoon),
    shortMemo: scrub(reason.shortMemo),
    holdReason: scrub(reason.holdReason),
  }));
  next.normalizedProducts = (next.normalizedProducts ?? []).map((product) => ({
    ...product,
    aiThesis: product.aiThesis
      ? {
          ...product.aiThesis,
          whyHot: scrub(product.aiThesis.whyHot),
        }
      : product.aiThesis,
  }));
  if (!Array.isArray(next.socialSignals)) next.socialSignals = [];
  if (!Array.isArray(next.socialSearchSignals)) next.socialSearchSignals = [];
  if (!Array.isArray(next.marketplaceSignals)) next.marketplaceSignals = [];
  if (!Array.isArray(next.marketplaceResearchTargets)) next.marketplaceResearchTargets = [];
  if (!Array.isArray(next.realtimeResearchTargets)) next.realtimeResearchTargets = [];
  next.marketplaceSignals = next.marketplaceSignals.map(normalizeMarketplaceBrowserSignal);
  next.socialSearchSignals = next.socialSearchSignals.map(normalizeSocialSearchSignal);
  next.explorationTasks = (next.explorationTasks ?? []).map((task) => {
    if (task?.kind !== "marketplace_check" && task?.sourceMode !== "manual_check") return task;
    return {
      ...task,
      reason: scrub(task.reason),
    };
  });
  next.metadata = {
    ...(next.metadata ?? {}),
    observationMetrics: metrics,
  };
  return next;
}
