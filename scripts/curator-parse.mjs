/**
 * curator-parse.mjs — 信頼キュレーター投稿から商品名・期日・URL を抽出
 */

import { compactText, normalizeProductKey } from "./marketlens-shared.mjs";

const CURATOR_HANDLE_NOISE_RE = /(?:pokecachan|oroshinohito|ポケカ予約速報|物販アニキ|@pokecachan|@oroshinohito)/i;
const ACCOUNT_CHROME_RE =
  /(?:log in|sign up|\/ X$|ポケモンカード情報\s*\(|Amazon物販サロン|Xでフォロー|ミュート|プライバシー)/i;
const GENERIC_SUMMARY_RE =
  /^(?:ポケモンカード\s*抽選まとめ|抽選まとめ|ホビー発売|転売注目|速報まとめ|本日の抽選)/u;
const OFFICIAL_DOMAIN_RE =
  /(?:pokemon-card\.com|pokemoncenter|p-bandai\.jp|bandai\.co\.jp|1kuji\.com|card\.pokemon\.jp|amazon\.co\.jp|itoyokado|lawson|familymart|7net|animate\.onlineshop)/i;

const PRODUCT_PATTERNS = [
  /【[^】]{2,36}】([^【\n📅🎯🔗🛒📈💡]{3,48})/gu,
  /(?:MEGA|S\d+|SV)[^\s、。]{0,24}(?:拡張パック|ブースター|BOX)/gu,
  /ROBOT魂[^\s、。]{2,40}/gu,
  /METAL BUILD[^\s、。]{2,40}/gu,
  /S\.H\.Figuarts[^\s、。]{2,40}/gu,
  /ムニキス[^\s、。]{2,24}/gu,
  /ストームエメラルダ/gu,
  /30周年記念BOX/gu,
  /(?:ポケモンカード|ポケカ)[^\s、。]{2,36}(?:BOX|拡張パック|ブースター)/gu,
  /一番くじ[^\s、。]{2,36}/gu,
  /(?:✏️|✅|・|▪)\s*([^✏️✅・\n📅🎯🔗]{4,56})/gu,
];

function comparableTokens(value = "") {
  return compactText(value)
    .toLowerCase()
    .replace(/[「」『』【】（）()]/g, " ")
    .split(/[\s　・／/,:：]+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length >= 2);
}

export function nameOverlapScore(left = "", right = "") {
  const leftNorm = normalizeProductKey(left);
  const rightNorm = normalizeProductKey(right);
  if (leftNorm.length >= 4 && rightNorm.length >= 4) {
    if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) {
      const shorter = Math.min(leftNorm.length, rightNorm.length);
      const longer = Math.max(leftNorm.length, rightNorm.length);
      return Number(Math.max(0.72, shorter / longer).toFixed(3));
    }
  }
  const leftTokens = comparableTokens(left);
  const rightTokens = comparableTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token));
  return shared.length / Math.max(leftTokens.length, rightTokens.length);
}

export function looksLikeCuratorNoiseName(name = "", handles = []) {
  const cleaned = compactText(name);
  if (!cleaned || cleaned.length < 4) return true;
  if (ACCOUNT_CHROME_RE.test(cleaned)) return true;
  if (CURATOR_HANDLE_NOISE_RE.test(cleaned)) return true;
  for (const handle of handles) {
    if (cleaned.toLowerCase().includes(String(handle).toLowerCase())) return true;
  }
  if (GENERIC_SUMMARY_RE.test(cleaned)) return true;
  if (/^(?:抽選|応募|予約|再販|速報|まとめ)(?:情報|注意報)?$/u.test(cleaned)) return true;
  if (/^https?:\/\//i.test(cleaned)) return true;
  // 文章っぽい表現（商品名ではなく告知文の断片）を弾く
  if (/(のような|のような先着|お知らせします|いたします|予定です$|について$|についてお知|募集します|実施します)/u.test(cleaned)) return true;
  if (/[、。]/u.test(cleaned) && !/【[^】]+】/u.test(cleaned)) return true;
  return false;
}

export function extractUrlsFromText(text = "") {
  const urls = new Set();
  for (const match of String(text).matchAll(/https?:\/\/[^\s)]+/gi)) {
    const url = match[0].replace(/[.,;]+$/, "");
    if (url.length >= 12) urls.add(url);
  }
  for (const match of String(text).matchAll(/(?:jp\.|www\.)[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s)]*)?/gi)) {
    urls.add(`https://${match[0].replace(/[.,;]+$/, "")}`);
  }
  return [...urls];
}

export function extractDatesFromCuratorText(text = "") {
  const dates = {};
  const reception =
    text.match(/📅[^\n]*?(?:受付|期間)?\s*([0-9]{1,2}[\/／月][0-9]{1,2}(?:\s*[0-9]{1,2}:[0-9]{2})?(?:\s*[〜~\-－]\s*[0-9]{1,2}[\/／月][0-9]{1,2}(?:\s*[0-9]{1,2}:[0-9]{2})?)?)/u) ??
    text.match(/(?:受付|期間)\s*([0-9]{1,2}[\/／月][0-9]{1,2}[^\n]{0,40})/u);
  const announce =
    text.match(/🎯[^\n]*?(?:発表|当選)\s*([0-9]{1,2}[\/／月][0-9]{1,2}(?:\s*[0-9]{1,2}:[0-9]{2})?)/u) ??
    text.match(/(?:発表|当選)\s*([0-9]{1,2}[\/／月][0-9]{1,2}(?:\s*[0-9]{1,2}:[0-9]{2})?)/u);
  if (reception?.[1]) dates.reception = compactText(reception[1]);
  if (announce?.[1]) dates.announce = compactText(announce[1]);
  return dates;
}

export function extractProductNamesFromCuratorPost(text = "", handles = []) {
  const names = new Set();
  const cleaned = compactText(text);
  if (!cleaned || cleaned.length < 8) return [];

  for (const pattern of PRODUCT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of cleaned.matchAll(pattern)) {
      const candidate = compactText(match[1] ?? match[0]);
      if (!looksLikeCuratorNoiseName(candidate, handles)) names.add(candidate);
    }
  }

  if (!names.size && !looksLikeCuratorNoiseName(cleaned.slice(0, 80), handles) && cleaned.length <= 80) {
    names.add(cleaned.slice(0, 80));
  }

  return [...names].slice(0, 8);
}

export function parseCuratorSample(sample = {}, curator = {}) {
  const handle = compactText(sample.accountHandle ?? curator.handle ?? "").replace(/^@/, "");
  const text = compactText(sample.text ?? "");
  if (!handle || !text) return [];

  const handles = [handle];
  const productNames = extractProductNamesFromCuratorPost(text, handles);
  const urls = extractUrlsFromText(text);
  const dates = extractDatesFromCuratorText(text);
  const postUrl = compactText(sample.sourceUrl ?? sample.postUrl ?? "").split("?")[0];

  if (!productNames.length) {
    if (looksLikeCuratorNoiseName(text, handles)) return [];
    return [
      {
        handle,
        productName: text.slice(0, 96),
        productKey: normalizeProductKey(text.slice(0, 96)),
        postedAt: sample.postedAt ?? null,
        postUrl: postUrl || null,
        dates,
        urls,
        excerpt: text.slice(0, 220),
        source: sample.source ?? "live_fetch",
        matchScore: null,
        productGroupKey: null,
      },
    ];
  }

  return productNames.map((productName) => ({
    handle,
    productName,
    productKey: normalizeProductKey(productName),
    postedAt: sample.postedAt ?? null,
    postUrl: postUrl || null,
    dates,
    urls,
    excerpt: text.slice(0, 220),
    source: sample.source ?? "live_fetch",
    matchScore: null,
    productGroupKey: null,
  }));
}

export function isOfficialUrl(url = "") {
  return OFFICIAL_DOMAIN_RE.test(String(url));
}

export function groupHasOfficialEvidence(group = {}, mentionUrls = []) {
  const urls = new Set(mentionUrls.filter(isOfficialUrl));
  const groupUrls = [
    ...(group.lotteryRoutes ?? []).map((row) => row.url ?? row.routeUrl),
    ...(group.routes ?? []).map((row) => row.url ?? row.routeUrl),
    ...(group.events ?? []).map((row) => row.sourceUrl ?? row.url),
  ].filter(Boolean);
  for (const groupUrl of groupUrls) {
    if (isOfficialUrl(groupUrl)) return true;
    for (const mentionUrl of urls) {
      try {
        const host = new URL(mentionUrl).hostname.replace(/^www\./, "");
        if (String(groupUrl).includes(host)) return true;
      } catch {
        // ignore malformed urls
      }
    }
  }
  return urls.size > 0 && groupUrls.some((groupUrl) => urls.has(String(groupUrl).split("?")[0]));
}

export function postedWithinHours(postedAt = "", hours = 72) {
  if (!postedAt) return true;
  const relative = String(postedAt);
  if (/^(?:\d+分前|昨日|今日|\d+時間前)/u.test(relative)) return true;
  const parsed = Date.parse(relative);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed <= hours * 3600 * 1000;
}

export function computeCuratorTrustLevel(mention = {}, group = null) {
  if (!group) return "C";
  const recent = postedWithinHours(mention.postedAt, 72);
  const official = groupHasOfficialEvidence(group, mention.urls ?? []);
  if (recent && official) return "B";
  if (recent) return "A";
  return "A";
}

export function mergeCuratorTrust(existing = null, incoming = {}) {
  const levelRank = { B: 4, A: 3, C: 2, D: 1, E: 0 };
  const existingLevel = existing?.level ?? "E";
  const incomingLevel = incoming.level ?? "E";
  const level = levelRank[incomingLevel] >= levelRank[existingLevel] ? incomingLevel : existingLevel;
  const handles = [...new Set([...(existing?.handles ?? []), ...(incoming.handles ?? [])])];
  return {
    level,
    handles,
    postedAt: incoming.postedAt ?? existing?.postedAt ?? null,
    postUrl: incoming.postUrl ?? existing?.postUrl ?? null,
    matchScore: Math.max(Number(existing?.matchScore ?? 0), Number(incoming.matchScore ?? 0)),
    updatedAt: new Date().toISOString(),
  };
}
