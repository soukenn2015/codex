/**
 * Shared Mercari item-page browser probe helpers (Playwright).
 * Used by read-only probe and jpyCandidate observation cycle.
 */

export const MERCARI_ITEM_PRICE_SELECTORS = [
  "[data-testid='price']",
  "[data-testid='product-price']",
  "[data-testid='item-price']",
  "[data-testid='Price']",
  "main [class*='ItemPrice']",
  "main [class*='itemPrice']",
  "main [class*='ItemDetail'] [class*='price' i]",
  "main [class*='itemDetail'] [class*='price' i]",
  "main section:first-of-type [class*='price' i]",
  "main [class*='Price']",
  "main [class*='price']",
  "section[class*='item'] [class*='price']",
  "[itemprop='price']",
];
export const MERCARI_BROWSER_SELECTOR_EVIDENCE = MERCARI_ITEM_PRICE_SELECTORS.join(",");
export const JPY_CANDIDATE_SAVE_MIN_CONFIDENCE = 0.6;
export const JPY_CANDIDATE_NOISE_MAX_CONFIDENCE = 0.4;

const SOLD_RE = /売り切れ|SOLD\s*OUT|sold\s*out|売却済|取引中|この商品は削除されました|公開停止|購入できません/u;
const ON_SALE_RE = /購入手続きへ|今すぐ購入|即購入|購入する/u;
const LOGIN_RE = /ログインして購入|ログインが必要|サインインして/u;
const CAPTCHA_RE = /captcha|robot|アクセスが集中|異常なアクセス|Access Denied|Forbidden|Cloudflare|確認してください/u;
const BLOCKED_RE = /アクセスできません|ご利用いただけません|403|blocked/i;
const FEE_RE = /(?:送料|配送料|\+)\s*(?:¥|￥)?\s*([\d,]+)|([\d,]+)\s*円\s*(?:の送料|送料)/u;
const RELATED_RE = /この商品を見た人|関連商品|おすすめ商品|あなたへのおすすめ/u;
const CURRENT_PRICE_RE = /現在\s*(?:¥|￥)\s*([\d,]+)/gu;
const YEN_RE = /(?:¥|￥)\s*([\d,]+)|([\d,]+)\s*円/gu;
const USD_PAREN_JPY_RE = /US\$\s*([\d,]+(?:\.\d+)?)\s*\(\s*¥\s*([\d,]+)/iu;

const NON_SAVE_RESULTS = new Set([
  "browser_fetch_failed",
  "browser_blocked",
  "browser_captcha_or_interstitial",
  "browser_login_required",
  "browser_sold_or_unavailable",
  "browser_no_price",
  "browser_fee_only",
  "browser_related_price_only",
]);

const SKIP_REGISTRY_RESULTS = new Set([
  "browser_blocked",
  "browser_captcha_or_interstitial",
  "browser_login_required",
]);

const SKIP_REGISTRY_TTL_MS = Number(process.env.MERCARI_PROBE_SKIP_TTL_MS ?? 7 * 86_400_000);

export function probeExclusionReason(browserResult = "") {
  switch (browserResult) {
    case "browser_blocked":
      return "blocked";
    case "browser_captcha_or_interstitial":
      return "captcha_or_interstitial";
    case "browser_login_required":
      return "login_required";
    case "browser_related_price_only":
      return "related_price_noise";
    case "browser_no_price":
      return "browser_no_price";
    case "browser_sold_or_unavailable":
      return "sold_or_unavailable";
    case "browser_fee_only":
      return "fee_only";
    case "browser_fetch_failed":
      return "fetch_failed";
    default:
      return null;
  }
}

export function defaultMercariProbeSkipRegistry() {
  return { blocked: [], captcha_or_interstitial: [], login_required: [] };
}

export function getMercariProbeSkipRegistry(snapshot = {}) {
  const raw = snapshot.metadata?.mercariProbeSkipRegistry;
  if (!raw || typeof raw !== "object") return defaultMercariProbeSkipRegistry();
  return {
    blocked: Array.isArray(raw.blocked) ? raw.blocked : [],
    captcha_or_interstitial: Array.isArray(raw.captcha_or_interstitial) ? raw.captcha_or_interstitial : [],
    login_required: Array.isArray(raw.login_required) ? raw.login_required : [],
  };
}

export function getMercariProbeSkipUrlSet(snapshot = {}, { now = Date.now() } = {}) {
  const registry = getMercariProbeSkipRegistry(snapshot);
  const urls = new Set();
  for (const bucket of Object.values(registry)) {
    for (const row of bucket) {
      const lastSeen = Date.parse(row?.lastSeenAt ?? row?.firstSeenAt ?? "");
      if (Number.isFinite(lastSeen) && now - lastSeen > SKIP_REGISTRY_TTL_MS) continue;
      const url = compactText(row?.url ?? "");
      if (url) urls.add(url);
    }
  }
  return urls;
}

export function upsertMercariProbeSkipRegistry(snapshot = {}, probeResult = {}) {
  const browserResult = String(probeResult.browserResult ?? "");
  if (!SKIP_REGISTRY_RESULTS.has(browserResult)) {
    return getMercariProbeSkipRegistry(snapshot);
  }
  const url = compactText(probeResult.url ?? "");
  if (!url) return getMercariProbeSkipRegistry(snapshot);

  const registry = getMercariProbeSkipRegistry(snapshot);
  const bucketKey =
    browserResult === "browser_blocked"
      ? "blocked"
      : browserResult === "browser_captcha_or_interstitial"
        ? "captcha_or_interstitial"
        : "login_required";
  const bucket = registry[bucketKey];
  const nowIso = new Date().toISOString();
  const existing = bucket.find((row) => row.url === url);
  if (existing) {
    existing.lastSeenAt = nowIso;
    existing.hitCount = Number(existing.hitCount ?? 1) + 1;
    existing.browserResult = browserResult;
    existing.notes = compactText(probeResult.notes ?? existing.notes ?? "");
  } else {
    bucket.push({
      url,
      browserResult,
      exclusionReason: probeExclusionReason(browserResult),
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      hitCount: 1,
      notes: compactText(probeResult.notes ?? ""),
    });
  }
  return registry;
}

export function summarizeMercariProbeSkipRegistry(snapshot = {}) {
  const registry = getMercariProbeSkipRegistry(snapshot);
  const activeSkipUrls = getMercariProbeSkipUrlSet(snapshot).size;
  return {
    activeSkipUrlCount: activeSkipUrls,
    blocked: registry.blocked.length,
    captchaOrInterstitial: registry.captcha_or_interstitial.length,
    loginRequired: registry.login_required.length,
    ttlDays: Math.round(SKIP_REGISTRY_TTL_MS / 86_400_000),
  };
}

export function parseVisibleYenCandidatesFromNotes(notes = "") {
  const match = String(notes).match(/visible_yen_candidates=([^;]+)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((token) => parseNumericToken(token))
    .filter((value) => value != null);
}

export function buildJpyExtractProbeMeta(probeResult = {}, listing = {}) {
  const notes = String(probeResult.notes ?? "");
  const skip = classifyJpyCandidateSaveSkipReason(probeResult, listing);
  const visibleYenCandidates = parseVisibleYenCandidatesFromNotes(notes);
  const primarySelectorYen = notes.includes("primary_selector_yen");
  const hasRelatedPriceNoise = (probeResult.relatedPriceNoise ?? []).length > 0;
  return {
    saveSkipReason: skip.sub ? `${skip.category}:${skip.sub}` : skip.category,
    saveSkipCategory: skip.category,
    saveSkipSub: skip.sub ?? null,
    extractedYenCandidateCount:
      visibleYenCandidates.length > 0
        ? visibleYenCandidates.length
        : probeResult.browserJpyCandidate != null
          ? 1
          : 0,
    selectedCandidateYen: probeResult.browserJpyCandidate ?? null,
    primarySelectorYen,
    hasRelatedPriceNoise,
    relatedPriceNoise: hasRelatedPriceNoise ? (probeResult.relatedPriceNoise ?? []).slice(0, 5) : [],
    visibleYenCandidateCount: visibleYenCandidates.length,
    visibleYenCandidates: visibleYenCandidates.slice(0, 5),
  };
}

function jpySaveSkipExclusionReason(skipMeta = {}) {
  switch (skipMeta.saveSkipCategory) {
    case "footer_nav_recommend_related_price_suspected":
      return "related_price_noise";
    case "price_dom_position_weak":
      return "price_dom_position_weak";
    case "confidence_calculation_gap":
      return "confidence_below_threshold";
    case "fee_point_reference_price_suspected":
      return "fee_or_reference_price";
    case "existing_jpy_candidate_duplicate":
      return "existing_jpy_candidate";
    default:
      return "jpy_save_skip";
  }
}

export function buildPlaywrightProbeStatus(probeResult = {}, listing = {}) {
  const browserResult = String(probeResult.browserResult ?? "");

  if (browserResult === "browser_jpy_extracted" && !shouldSaveJpyCandidate(probeResult)) {
    const skipMeta = buildJpyExtractProbeMeta(probeResult, listing);
    return {
      browserResult,
      exclusionReason: jpySaveSkipExclusionReason(skipMeta),
      probedAt: new Date().toISOString(),
      confidence: Number(probeResult.confidence ?? 0),
      notes: compactText(probeResult.notes ?? "").slice(0, 240),
      buyLineEligible: false,
      ...skipMeta,
    };
  }

  const exclusionReason = probeExclusionReason(browserResult);
  if (!exclusionReason || shouldSaveJpyCandidate(probeResult)) return null;
  return {
    browserResult,
    exclusionReason,
    probedAt: new Date().toISOString(),
    confidence: Number(probeResult.confidence ?? 0),
    notes: compactText(probeResult.notes ?? "").slice(0, 240),
    buyLineEligible: false,
  };
}

export function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseNumericToken(token = "") {
  const cleaned = String(token ?? "").replace(/,/g, "").trim();
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractYenTokens(text = "") {
  const tokens = [];
  for (const match of String(text).matchAll(YEN_RE)) {
    const value = parseNumericToken(match[1] ?? match[2]);
    if (value != null) tokens.push(value);
  }
  return tokens;
}

export function extractRelatedPriceNoise(text = "") {
  const noise = [];
  for (const match of String(text).matchAll(CURRENT_PRICE_RE)) {
    const value = parseNumericToken(match[1]);
    if (value != null) noise.push(value);
  }
  return [...new Set(noise)];
}

export function buildSnippet(text = "", focus = "") {
  const lines = String(text)
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/¥|￥|円|US\$|送料|手数料|購入|売り切れ/i.test(line)) continue;
    const prev = i > 0 ? lines[i - 1] : "";
    const next = i < lines.length - 1 ? lines[i + 1] : "";
    hits.push(compactText([prev, line, next].filter(Boolean).join(" | ")).slice(0, 240));
    if (hits.length >= 3) break;
  }
  if (hits.length === 0 && focus) hits.push(compactText(focus).slice(0, 240));
  return hits.join(" // ");
}

function scorePriceLine(line = "") {
  const text = compactText(line);
  if (!text) return -100;
  let score = 0;
  if (/^(?:¥|￥)\s*[\d,]+$/u.test(text)) score += 40;
  if (/^[\d,]+\s*円$/u.test(text)) score += 35;
  if (/US\$\s*[\d,]+/u.test(text)) score += 30;
  if (/現在\s*(?:¥|￥)/u.test(text)) score -= 50;
  if (/送料|配送料|手数料|ポイント|参考価格|クーポン/u.test(text)) score -= 35;
  if (/おすすめ|関連|この商品を見た/u.test(text)) score -= 40;
  if (text.length <= 24) score += 10;
  return score;
}

function extractPrimaryVisiblePriceText(visibleText = "", primaryPriceText = "") {
  const primaryLines = String(primaryPriceText)
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);
  if (primaryLines.length > 0) {
    const ranked = [...primaryLines].sort((a, b) => scorePriceLine(b) - scorePriceLine(a));
    const best = ranked.find((line) => scorePriceLine(line) >= 20);
    if (best) return best;
  }

  const lines = String(visibleText)
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);
  const rankedVisible = lines
    .slice(0, 20)
    .map((line) => ({ line, score: scorePriceLine(line) }))
    .filter((row) => row.score >= 15)
    .sort((a, b) => b.score - a.score);
  if (rankedVisible.length > 0) return rankedVisible[0].line;
  return lines[0] ?? "";
}

export function classifyBrowserOutcome({
  pageText = "",
  visibleText = "",
  primaryPriceText = "",
  title = "",
  httpStatus = 0,
  error = null,
}) {
  const text = compactText(`${title}\n${pageText}\n${visibleText}`);
  const snippet = buildSnippet(visibleText || pageText, title);
  const relatedPriceNoise = extractRelatedPriceNoise(visibleText || pageText);
  const primaryText = compactText(primaryPriceText || extractPrimaryVisiblePriceText(visibleText, primaryPriceText));

  if (error) {
    return {
      browserResult: "browser_fetch_failed",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate: "unknown",
      confidence: 0,
      notes: error,
      relatedPriceNoise,
    };
  }

  if (httpStatus === 403 || BLOCKED_RE.test(text)) {
    return {
      browserResult: "browser_blocked",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate: "unknown",
      confidence: 0,
      notes: `http_${httpStatus || 403}`,
      relatedPriceNoise,
    };
  }

  if (CAPTCHA_RE.test(text)) {
    return {
      browserResult: "browser_captcha_or_interstitial",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate: "unknown",
      confidence: 0,
      notes: "captcha_or_interstitial_signal",
      relatedPriceNoise,
    };
  }

  if (LOGIN_RE.test(text) && !/jp\.mercari\.com\/item\/m\d+/i.test(visibleText.slice(0, 500))) {
    return {
      browserResult: "browser_login_required",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate: "unknown",
      confidence: 0,
      notes: "login_required_signal",
      relatedPriceNoise,
    };
  }

  const sold = SOLD_RE.test(text);
  const onSale = ON_SALE_RE.test(text);
  let statusCandidate = "unknown";
  if (sold) statusCandidate = "sold";
  else if (onSale) statusCandidate = "on_sale";

  if (sold) {
    return {
      browserResult: "browser_sold_or_unavailable",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate,
      confidence: 0.7,
      notes: "sold_or_unavailable_signal",
      relatedPriceNoise,
    };
  }

  const parenthetical = (primaryText || text).match(USD_PAREN_JPY_RE) ?? text.match(USD_PAREN_JPY_RE);
  if (parenthetical) {
    const jpy = parseNumericToken(parenthetical[2]);
    return {
      browserResult: "browser_jpy_extracted",
      browserJpyCandidate: jpy,
      rawTextSnippet: snippet || `US$ ${parenthetical[1]} ( ¥ ${parenthetical[2]} )`,
      statusCandidate,
      confidence: 0.9,
      notes: `usd_parenthetical_jpy; usd=${parenthetical[1]}`,
      relatedPriceNoise,
    };
  }

  const primaryYen = extractYenTokens(primaryText).filter((value) => !relatedPriceNoise.includes(value));
  const primaryFromSelector = compactText(primaryPriceText).length > 0;
  if (primaryYen.length === 1) {
    const domScore = scorePriceLine(primaryText);
    const confidence = primaryFromSelector && domScore >= 30 ? 0.85 : domScore >= 20 ? 0.8 : 0.75;
    return {
      browserResult: "browser_jpy_extracted",
      browserJpyCandidate: primaryYen[0],
      rawTextSnippet: snippet || primaryText,
      statusCandidate,
      confidence,
      notes: `primary_selector_yen=${primaryYen[0]}; dom_score=${domScore}; selector_hit=${primaryFromSelector}`,
      relatedPriceNoise,
    };
  }

  const feeMatch = text.match(FEE_RE);
  const feeValue = feeMatch ? parseNumericToken(feeMatch[1] ?? feeMatch[2]) : null;
  const yenTokens = extractYenTokens(visibleText || pageText);
  const uniqueYen = [...new Set(yenTokens)];
  const yenWithoutRelatedNoise = uniqueYen.filter((value) => !relatedPriceNoise.includes(value));

  if (relatedPriceNoise.length > 0 && yenWithoutRelatedNoise.length === 0) {
    return {
      browserResult: "browser_related_price_only",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate,
      confidence: 0.2,
      notes: `related_price_noise_only=${relatedPriceNoise.slice(0, 5).join(",")}`,
      relatedPriceNoise,
    };
  }

  if (RELATED_RE.test(text) && uniqueYen.length > 3) {
    const filtered = yenWithoutRelatedNoise.length > 0 ? yenWithoutRelatedNoise : uniqueYen;
    const mid = filtered[Math.floor(filtered.length / 2)] ?? null;
    return {
      browserResult: "browser_related_price_only",
      browserJpyCandidate: mid,
      rawTextSnippet: snippet,
      statusCandidate,
      confidence: relatedPriceNoise.length > 0 ? 0.25 : 0.3,
      notes: `related_section_yen_candidates=${filtered.slice(0, 5).join(",")}; noise=${relatedPriceNoise.slice(0, 3).join(",") || "none"}`,
      relatedPriceNoise,
    };
  }

  if (feeValue != null && uniqueYen.length === 1 && uniqueYen[0] === feeValue) {
    return {
      browserResult: "browser_fee_only",
      browserJpyCandidate: null,
      rawTextSnippet: snippet,
      statusCandidate,
      confidence: 0.4,
      notes: `fee_only_yen=${feeValue}`,
      relatedPriceNoise,
    };
  }

  if (uniqueYen.length > 0) {
    const baseYen = yenWithoutRelatedNoise.length > 0 ? yenWithoutRelatedNoise : uniqueYen;
    const withoutFees = baseYen.filter((value) => value !== feeValue && value > (feeValue ?? 0));
    const candidate = withoutFees[0] ?? baseYen[0];
    let confidence = withoutFees.length === 1 ? 0.75 : baseYen.length <= 2 ? 0.6 : 0.45;
    if (relatedPriceNoise.length > 0) confidence = Math.min(confidence, JPY_CANDIDATE_NOISE_MAX_CONFIDENCE);
    return {
      browserResult: "browser_jpy_extracted",
      browserJpyCandidate: candidate,
      rawTextSnippet: snippet,
      statusCandidate,
      confidence,
      notes: `visible_yen_candidates=${baseYen.slice(0, 5).join(",")}; related_noise=${relatedPriceNoise.slice(0, 3).join(",") || "none"}`,
      relatedPriceNoise,
    };
  }

  return {
    browserResult: "browser_no_price",
    browserJpyCandidate: null,
    rawTextSnippet: snippet,
    statusCandidate,
    confidence: 0,
    notes: "no_yen_price_token_in_visible_text",
    relatedPriceNoise,
  };
}

export function summarizeMercariProbeTargetSelection(snapshot = {}, { limit = 25, now = Date.now() } = {}) {
  const max = Math.min(Math.max(1, Number(limit) || 25), 30);
  const seen = new Set();
  const skipUrls = getMercariProbeSkipUrlSet(snapshot, { now });
  const registry = getMercariProbeSkipRegistry(snapshot);
  const skipByReason = { blocked: 0, captcha_or_interstitial: 0, login_required: 0 };
  const skipTtlRemainingMs = [];

  for (const [bucketKey, bucket] of Object.entries(registry)) {
    for (const row of bucket) {
      const url = compactText(row?.url ?? "");
      if (!url || !skipUrls.has(url)) continue;
      const reason = row.exclusionReason ?? bucketKey;
      if (reason in skipByReason) skipByReason[reason] += 1;
      else if (bucketKey === "blocked") skipByReason.blocked += 1;
      else if (bucketKey === "captcha_or_interstitial") skipByReason.captcha_or_interstitial += 1;
      else if (bucketKey === "login_required") skipByReason.login_required += 1;
      const lastSeen = Date.parse(row?.lastSeenAt ?? row?.firstSeenAt ?? "");
      if (Number.isFinite(lastSeen)) {
        skipTtlRemainingMs.push(Math.max(0, SKIP_REGISTRY_TTL_MS - (now - lastSeen)));
      }
    }
  }

  let duplicateSkipped = 0;
  let jpyCandidateSkipped = 0;
  let registrySkipped = 0;
  let eligibleBeforeLimit = 0;
  const targets = [];

  for (const signal of snapshot.marketplaceSignals ?? []) {
    if (signal?.priceSourceRank !== "browser_observed_candidate") continue;
    for (const listing of signal.listingCandidates ?? []) {
      const itemUrl = compactText(listing.itemUrl ?? "");
      if (!/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(itemUrl)) continue;
      if (seen.has(itemUrl)) {
        duplicateSkipped += 1;
        continue;
      }
      seen.add(itemUrl);
      if (skipUrls.has(itemUrl)) {
        registrySkipped += 1;
        continue;
      }
      if (listing.jpyCandidate && Number(listing.jpyCandidate.amount) > 0) {
        jpyCandidateSkipped += 1;
        continue;
      }
      eligibleBeforeLimit += 1;
      targets.push({
        url: itemUrl,
        signalKey: compactText(signal.productKey ?? signal.query ?? ""),
        listingTitle: compactText(listing.title ?? ""),
        listingCurrency: compactText(listing.currency ?? ""),
      });
      if (targets.length >= max) break;
    }
    if (targets.length >= max) break;
  }

  const avgTtlRemainingMs =
    skipTtlRemainingMs.length > 0
      ? Math.round(skipTtlRemainingMs.reduce((sum, value) => sum + value, 0) / skipTtlRemainingMs.length)
      : null;

  return {
    limit: max,
    selectedCount: targets.length,
    eligibleBeforeLimit,
    reprobeSuppressedCount: registrySkipped,
    skipUrls: registrySkipped,
    skipByReason,
    jpyCandidateSkipped,
    duplicateSkipped,
    activeSkipUrlCount: skipUrls.size,
    avgTtlRemainingMs,
    avgTtlRemainingDays: avgTtlRemainingMs != null ? Number((avgTtlRemainingMs / 86_400_000).toFixed(2)) : null,
    targets,
  };
}

export function selectMercariProbeTargets(snapshot = {}, { limit = 25 } = {}) {
  return summarizeMercariProbeTargetSelection(snapshot, { limit }).targets;
}

export function classifyJpyCandidateSaveSkipReason(probeResult = {}, listing = {}) {
  if (listing.jpyCandidate && Number(listing.jpyCandidate.amount) > 0) {
    return { category: "existing_jpy_candidate_duplicate", saveable: false };
  }
  if (NON_SAVE_RESULTS.has(probeResult.browserResult)) {
    return { category: "other", sub: probeResult.browserResult, saveable: false };
  }
  if (probeResult.browserResult !== "browser_jpy_extracted") {
    return { category: "other", sub: probeResult.browserResult ?? "not_extracted", saveable: false };
  }
  const amount = Number(probeResult.browserJpyCandidate);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { category: "price_context_insufficient", sub: "no_positive_amount", saveable: false };
  }
  const confidence = Number(probeResult.confidence ?? 0);
  const notes = String(probeResult.notes ?? "");
  const noise = probeResult.relatedPriceNoise ?? [];
  if (noise.length > 0) {
    return {
      category: "footer_nav_recommend_related_price_suspected",
      sub: "related_price_noise",
      confidence,
      saveable: false,
    };
  }
  if (/送料|手数料|ポイント|参考価格/.test(String(probeResult.rawTextSnippet ?? ""))) {
    return { category: "fee_point_reference_price_suspected", confidence, saveable: false };
  }
  const trustedPrimary = notes.includes("primary_selector_yen") || notes.includes("usd_parenthetical_jpy");
  if (!trustedPrimary) {
    return {
      category: "price_dom_position_weak",
      sub: "missing_trusted_primary_selector",
      confidence,
      saveable: false,
    };
  }
  if (confidence < JPY_CANDIDATE_SAVE_MIN_CONFIDENCE) {
    return {
      category: "confidence_calculation_gap",
      sub: "below_save_threshold",
      confidence,
      saveable: false,
    };
  }
  return { category: "eligible", confidence, saveable: true };
}

export function shouldSaveJpyCandidate(probeResult = {}) {
  if (NON_SAVE_RESULTS.has(probeResult.browserResult)) return false;
  if (probeResult.browserResult !== "browser_jpy_extracted") return false;
  const amount = Number(probeResult.browserJpyCandidate);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const confidence = Number(probeResult.confidence ?? 0);
  if (confidence < JPY_CANDIDATE_SAVE_MIN_CONFIDENCE) return false;
  const trustedPrimary =
    String(probeResult.notes ?? "").includes("primary_selector_yen") ||
    String(probeResult.notes ?? "").includes("usd_parenthetical_jpy");
  if (
    !trustedPrimary &&
    (probeResult.relatedPriceNoise ?? []).length > 0 &&
    confidence > JPY_CANDIDATE_NOISE_MAX_CONFIDENCE
  ) {
    return false;
  }
  return true;
}

export function buildJpyCandidateFromProbeResult(probeResult = {}, listing = {}) {
  if (!shouldSaveJpyCandidate(probeResult)) return null;
  const sourceUrl = compactText(probeResult.url ?? listing.itemUrl ?? "");
  return {
    amount: Math.round(Number(probeResult.browserJpyCandidate)),
    currency: "JPY",
    source: "playwright_product_page",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    rawText: compactText(probeResult.rawTextSnippet ?? "").slice(0, 500),
    selectorEvidence: MERCARI_BROWSER_SELECTOR_EVIDENCE,
    visibleTextSnippet: compactText(probeResult.rawTextSnippet ?? "").slice(0, 300),
    statusCandidate: probeResult.statusCandidate ?? "unknown",
    confidence: Number(probeResult.confidence ?? 0),
    exclusionReason: null,
    buyLineEligible: false,
  };
}

export async function probeMercariItemPage(browser, target, { timeoutMs = 30000 } = {}) {
  const started = Date.now();
  const context = await browser.newContext({
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  let httpStatus = 0;
  let pageText = "";
  let visibleText = "";
  let primaryPriceText = "";
  let title = "";
  let error = null;

  try {
    const response = await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    httpStatus = response?.status() ?? 0;
    await page.waitForTimeout(2500);

    title = await page.title();
    pageText = await page.evaluate(() => document.body?.innerText ?? "");
    const extracted = await page.evaluate((priceSelectors) => {
      const noiseRoots =
        "footer, nav, aside, [class*='recommend'], [class*='related'], [class*='Recommend'], [class*='carousel'], [class*='banner'], [class*='ad']";
      function isNoisy(node) {
        return Boolean(node?.closest?.(noiseRoots));
      }
      function collectText(selector, { skipNoise = false, root = document } = {}) {
        const chunks = [];
        for (const node of root.querySelectorAll(selector)) {
          if (skipNoise && isNoisy(node)) continue;
          const text = (node.textContent ?? "").trim();
          if (text) chunks.push(text);
        }
        return chunks;
      }
      const mainRoot = document.querySelector("main") ?? document.body;
      const detailRoot =
        mainRoot.querySelector("[class*='ItemDetail'], [class*='itemDetail'], section:first-of-type") ?? mainRoot;
      const priceChunks = [];
      for (const selector of priceSelectors) {
        const detailHits = collectText(selector, { skipNoise: true, root: detailRoot });
        if (detailHits.length > 0) priceChunks.push(...detailHits);
        else priceChunks.push(...collectText(selector, { skipNoise: true, root: mainRoot }));
      }
      const titleChunks = collectText("h1", { skipNoise: false, root: detailRoot }).slice(0, 2);
      const detailText = detailRoot?.innerText ?? "";
      const visibleChunks = [...titleChunks, detailText];
      return {
        visibleText: visibleChunks.filter(Boolean).join("\n") || (document.body?.innerText ?? ""),
        primaryPriceText: [...new Set(priceChunks)].slice(0, 4).join("\n"),
      };
    }, MERCARI_ITEM_PRICE_SELECTORS);
    visibleText = extracted.visibleText;
    primaryPriceText = extracted.primaryPriceText;
  } catch (probeError) {
    error = String(probeError?.message ?? probeError);
  } finally {
    await context.close();
  }

  const classified = classifyBrowserOutcome({
    pageText,
    visibleText,
    primaryPriceText,
    title,
    httpStatus,
    error,
  });

  return {
    url: target.url,
    signalKey: target.signalKey ?? "",
    listingTitle: target.listingTitle ?? "",
    durationMs: Date.now() - started,
    httpStatus,
    ...classified,
  };
}

export function summarizeJpyCandidateProbe(results = [], { savedCount = 0, noiseExcludedCount = 0, listingsByUrl = new Map() } = {}) {
  const byBrowserResult = {};
  const confidenceBuckets = { high_ge_0_6: 0, mid_0_4_to_0_59: 0, low_lt_0_4: 0 };
  const saveSkipReasonCounts = {};
  let jpyExtracted = 0;
  let captchaOrBlocked = 0;
  let loginRequired = 0;
  let browserNoPrice = 0;
  let relatedPriceOnly = 0;
  let relatedNoiseExcluded = noiseExcludedCount;
  let primarySelectorYenHitCount = 0;
  let jpyExtractSaveSkippedCount = 0;

  for (const row of results) {
    byBrowserResult[row.browserResult] = (byBrowserResult[row.browserResult] ?? 0) + 1;
    if (row.browserResult === "browser_jpy_extracted" && row.browserJpyCandidate != null) jpyExtracted += 1;
    if (row.browserResult === "browser_blocked" || row.browserResult === "browser_captcha_or_interstitial") {
      captchaOrBlocked += 1;
    }
    if (row.browserResult === "browser_login_required") loginRequired += 1;
    if (row.browserResult === "browser_no_price") browserNoPrice += 1;
    if (row.browserResult === "browser_related_price_only") relatedPriceOnly += 1;
    if ((row.relatedPriceNoise ?? []).length > 0 && !shouldSaveJpyCandidate(row)) relatedNoiseExcluded += 1;
    if (String(row.notes ?? "").includes("primary_selector_yen")) primarySelectorYenHitCount += 1;

    if (row.browserResult === "browser_jpy_extracted" && !shouldSaveJpyCandidate(row)) {
      jpyExtractSaveSkippedCount += 1;
      const listing = listingsByUrl.get(row.url) ?? {};
      const skip = classifyJpyCandidateSaveSkipReason(row, listing);
      const key = skip.sub ? `${skip.category}:${skip.sub}` : skip.category;
      saveSkipReasonCounts[key] = (saveSkipReasonCounts[key] ?? 0) + 1;
    }

    const confidence = Number(row.confidence ?? 0);
    if (confidence >= 0.6) confidenceBuckets.high_ge_0_6 += 1;
    else if (confidence >= 0.4) confidenceBuckets.mid_0_4_to_0_59 += 1;
    else confidenceBuckets.low_lt_0_4 += 1;
  }

  const saveRate = results.length > 0 ? Number((savedCount / results.length).toFixed(3)) : 0;
  const excludeRate = results.length > 0 ? Number(((results.length - savedCount) / results.length).toFixed(3)) : 0;

  return {
    probeTargetCount: results.length,
    jpyExtractedCount: jpyExtracted,
    jpyCandidateSavedCount: savedCount,
    saveRate,
    excludeRate,
    browserNoPrice,
    browserRelatedPriceOnly: relatedPriceOnly,
    captchaOrBlocked,
    loginRequired,
    relatedPriceNoiseExcludedCount: relatedNoiseExcluded,
    confidenceDistribution: confidenceBuckets,
    byBrowserResult,
    primarySelectorYenHitCount,
    jpyExtractSaveSkippedCount,
    saveSkipReasonCounts,
    avgDurationMs: Math.round(results.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) / Math.max(1, results.length)),
  };
}

export function summarizeJpyCandidateSnapshot(snapshot = {}) {
  let savedCount = 0;
  let buyLineEligibleTrue = 0;
  let highConfidenceNoise = 0;
  const confidenceBuckets = { high_ge_0_6: 0, mid_0_4_to_0_59: 0, low_lt_0_4: 0 };

  for (const signal of snapshot.marketplaceSignals ?? []) {
    for (const listing of signal.listingCandidates ?? []) {
      const jc = listing.jpyCandidate;
      if (!jc || typeof jc !== "object") continue;
      savedCount += 1;
      if (jc.buyLineEligible === true) buyLineEligibleTrue += 1;
      const confidence = Number(jc.confidence ?? 0);
      if (confidence >= 0.6) confidenceBuckets.high_ge_0_6 += 1;
      else if (confidence >= 0.4) confidenceBuckets.mid_0_4_to_0_59 += 1;
      else confidenceBuckets.low_lt_0_4 += 1;
      if (
        jc.exclusionReason === "related_price_noise" ||
        (String(jc.rawText ?? "").includes("related_price_noise") && confidence >= 0.6)
      ) {
        highConfidenceNoise += 1;
      }
    }
  }

  const prices = snapshot.priceSnapshots ?? [];
  const priceSnapshotJpyMix = prices.filter((price) => price.jpyCandidate != null).length;
  const observedPromotion = prices.filter((price) => price.priceSourceRank === "observed_market_price").length;

  return {
    jpyCandidateSavedCount: savedCount,
    jpyCandidateBuyLineEligibleTrue: buyLineEligibleTrue,
    jpyCandidateHighConfidenceNoise: highConfidenceNoise,
    jpyCandidateConfidenceDistribution: confidenceBuckets,
    priceSnapshotsJpyCandidateMix: priceSnapshotJpyMix,
    observedMarketPricePromotionCount: observedPromotion,
  };
}