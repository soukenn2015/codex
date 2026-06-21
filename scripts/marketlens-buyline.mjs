/**
 * BuyLine policy — only promoted, traceable price sources are eligible.
 * Raw browser_observed_candidate / jpyCandidate / USD / unknown / AI / heuristic remain excluded.
 */

export const BUYLINE_ELIGIBLE_RANKS = new Set(["manual_price", "confirmed_price", "observed_market_price"]);
export const PROVISIONAL_BUYLINE_ELIGIBLE_RANKS = BUYLINE_ELIGIBLE_RANKS;

/** Future alias; not emitted in snapshot yet — treated as manual_price when introduced. */
export const PROVISIONAL_BUYLINE_CONFIRMED_RANK = "confirmed_price";

export const PROVISIONAL_BUYLINE_FORBIDDEN_RANKS = new Set([
  "browser_observed_candidate",
  "browser_observed",
  "historical_prediction",
  "llm_mentioned_price",
  "ai_estimate",
  "specialized_estimate",
]);

export const PROVISIONAL_BUYLINE_FUTURE_CONDITIONAL_RANKS = new Set([]);

export function isProvisionalBuyLineRank(rank = "") {
  const normalized = String(rank ?? "");
  return BUYLINE_ELIGIBLE_RANKS.has(normalized);
}

export function isProvisionalBuyLineCurrencyAllowed(currency = "JPY") {
  const normalized = String(currency ?? "JPY").toUpperCase();
  return normalized !== "UNKNOWN" && normalized !== "USD";
}

export function isProvisionalBuyLinePriceEligible(price = {}) {
  if (!price || price.buyLineEligible !== true) return false;
  if (!isProvisionalBuyLineRank(price.priceSourceRank)) return false;
  if (!isProvisionalBuyLineCurrencyAllowed(price.currency)) return false;
  if (price.sourceMode === "browser_observed" && price.priceSourceRank !== "observed_market_price") return false;
  if (price.jpyCandidate != null) return false;
  if (price.priceSourceRank === "observed_market_price" && price.promotionStatus !== "promoted") return false;
  return true;
}

export function isProvisionalBuyLineCandidateFieldEligible({
  rank = "",
  buyLineEligible = true,
  currency = "JPY",
  sourceMode = "",
  promotionStatus = "",
} = {}) {
  if (buyLineEligible === false) return false;
  if (!isProvisionalBuyLineRank(rank)) return false;
  if (sourceMode === "browser_observed") return false;
  if (rank === "observed_market_price" && promotionStatus !== "promoted") return false;
  return isProvisionalBuyLineCurrencyAllowed(currency);
}

export function resolveProvisionalBuyLinePriceFields(price = {}) {
  const buyLineEligible = isProvisionalBuyLinePriceEligible({
    ...price,
    buyLineEligible: true,
  });
  return {
    priceUsage: buyLineEligible ? "buyline" : "watch",
    buyLineEligible,
  };
}

export function resolveProvisionalBuyLineStatus(calc) {
  if (!calc || !Number.isFinite(calc.buyLine)) return "unavailable";
  return "available";
}

export function assertProvisionalBuyLineGates(snapshot, observation = {}) {
  const errors = [];
  const priceSnapshots = Array.isArray(snapshot.priceSnapshots) ? snapshot.priceSnapshots : [];
  const candidates = Array.isArray(snapshot.discoveryCandidates) ? snapshot.discoveryCandidates : [];
  const marketplaceSignals = Array.isArray(snapshot.marketplaceSignals) ? snapshot.marketplaceSignals : [];

  for (const price of priceSnapshots) {
    if (price.buyLineEligible !== true) continue;
    if (!isProvisionalBuyLinePriceEligible(price)) {
      errors.push(`priceSnapshots BuyLine 対象が暫定許可外です: ${price.productKey} -> ${price.priceSourceRank}`);
    }
  }

  for (const price of priceSnapshots) {
    if (PROVISIONAL_BUYLINE_FORBIDDEN_RANKS.has(price.priceSourceRank) && price.buyLineEligible === true) {
      errors.push(`禁止 rank が BuyLine 対象です: ${price.productKey} -> ${price.priceSourceRank}`);
    }
    if (String(price.currency ?? "").toUpperCase() === "UNKNOWN" && price.buyLineEligible === true) {
      errors.push(`currency=unknown が BuyLine 対象です: ${price.productKey}`);
    }
  }

  for (const candidate of candidates) {
    if (
      candidate.marketPriceBuyLineEligible === true &&
      !isProvisionalBuyLineCandidateFieldEligible({
        rank: candidate.marketPriceSourceRank,
        buyLineEligible: true,
        currency: candidate.marketPriceCurrency,
        sourceMode: candidate.marketPriceSourceMode,
        promotionStatus: candidate.marketPricePromotionStatus,
      })
    ) {
      errors.push(`candidate market が暫定 BuyLine 許可外です: ${candidate.name} -> ${candidate.marketPriceSourceRank}`);
    }
    if (
      candidate.retailPriceBuyLineEligible === true &&
      !isProvisionalBuyLineCandidateFieldEligible({
        rank: candidate.retailPriceSourceRank,
        buyLineEligible: true,
        currency: candidate.retailPriceCurrency,
        sourceMode: candidate.retailPriceSourceMode,
        promotionStatus: candidate.retailPricePromotionStatus,
      })
    ) {
      errors.push(`candidate retail が暫定 BuyLine 許可外です: ${candidate.name} -> ${candidate.retailPriceSourceRank}`);
    }
  }

  for (const signal of marketplaceSignals) {
    if (signal.buyLineEligible === true) {
      errors.push(`marketplaceSignal が BuyLine 対象です: ${signal.query ?? signal.productKey}`);
    }
    for (const listing of signal.listingCandidates ?? []) {
      if (listing.jpyCandidate?.buyLineEligible === true) {
        errors.push(`jpyCandidate.buyLineEligible が true です: ${listing.itemUrl}`);
      }
      if (listing.currency === "USD" && listing.buyLineEligible === true) {
        errors.push(`USD listing が BuyLine 対象です: ${listing.itemUrl}`);
      }
    }
  }

  if (observation.buyLineBrowserMixDetected === true) {
    errors.push("buyLineBrowserMixDetected が true です");
  }

  const eligibleSources = observation.buyLineEligibleSources ?? {};
  for (const [rank, count] of Object.entries(eligibleSources)) {
    if (count > 0 && !isProvisionalBuyLineRank(rank)) {
      errors.push(`buyLineEligibleSources に暫定許可外 rank があります: ${rank}`);
    }
  }

  return errors;
}

export const OBSERVED_MARKET_PROMOTION_MIN_CONFIDENCE = Math.min(
  1,
  Math.max(0, Number(process.env.MARKETLENS_OBSERVED_MARKET_PROMOTION_MIN_CONFIDENCE ?? 0.8)),
);

export const OBSERVED_MARKET_PROMOTION_MAX_AGE_DAYS = Math.max(
  1,
  Number(process.env.MARKETLENS_OBSERVED_MARKET_PROMOTION_MAX_AGE_DAYS ?? 7),
);

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProductKey(value) {
  return compactText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

const PROMOTION_GENERIC_TOKENS = new Set([
  "発売",
  "新作",
  "モデル",
  "商品",
  "価格",
  "最新",
  "情報",
  "予約",
  "抽選",
  "販売",
  "開催",
]);

function tokenizePromotionIdentity(value = "") {
  return compactText(value)
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !PROMOTION_GENERIC_TOKENS.has(token));
}

function promotionIdentityLooksConcrete(productName = "", query = "") {
  const identity = compactText(`${productName} ${query}`);
  if (!identity) return false;
  if (/新作モデル\s*\d{4}年|イベントが開催|試着できます|ラインナップ|関連記事|どこから見ても|商品で共通/u.test(identity)) {
    return /[A-Z]{2,}[-A-Z0-9]*\d[A-Z0-9-]*/iu.test(identity) || /BOX|ボックス|ラストワン|MASTERLISE/iu.test(identity);
  }
  return true;
}

function promotionTitleMatchesIdentity(signal = {}, listing = {}) {
  const title = compactText(listing.title ?? "").normalize("NFKC").toLowerCase();
  const identity = compactText(`${signal.productName ?? ""} ${signal.query ?? ""}`);
  const tokens = tokenizePromotionIdentity(identity);
  if (!title || !tokens.length) return false;
  const matches = tokens.filter((token) => title.includes(token)).length;
  const requiredMatches = tokens.length >= 3 ? 2 : 1;
  return matches >= requiredMatches;
}

function daysSince(value, now = new Date()) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return Infinity;
  return (now.getTime() - ts) / 86_400_000;
}

function jpyEvidenceText(candidate = {}) {
  return [
    candidate.rawText,
    candidate.jpyRawPriceText,
    candidate.selectorEvidence,
    candidate.visibleTextSnippet,
    candidate.currencyEvidence,
  ]
    .map(compactText)
    .filter(Boolean)
    .join(" ");
}

function listingObservedAt(signal = {}, listing = {}, candidate = {}) {
  return candidate.fetchedAt ?? listing.observedAt ?? signal.observedAt ?? signal.updatedAt ?? null;
}

function deriveJpyCandidateFromListing(signal = {}, listing = {}) {
  const amount = Number(listing.value);
  const rawPriceText = compactText(listing.rawPriceText ?? "");
  const itemUrl = compactText(listing.itemUrl ?? "");
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (String(listing.currency ?? "").toUpperCase() !== "JPY") return null;
  if (!/(?:¥|￥|円)/u.test(rawPriceText)) return null;
  if (!/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(itemUrl)) return null;
  return {
    amount,
    currency: "JPY",
    source: listing.sourceMode === "browser_rendered_search" ? "playwright_search_page" : "mercari_search_listing",
    sourceUrl: itemUrl,
    fetchedAt: listing.observedAt ?? signal.observedAt ?? null,
    rawText: compactText(`${rawPriceText} ${listing.title ?? ""}`).slice(0, 500),
    jpyRawPriceText: rawPriceText,
    selectorEvidence:
      listing.sourceMode === "browser_rendered_search"
        ? "a[href*='/item/m']"
        : "markdown item link with JPY price",
    visibleTextSnippet: compactText(`${rawPriceText} ${listing.title ?? ""}`).slice(0, 500),
    statusCandidate: compactText(listing.status ?? "on_sale"),
    confidence: Math.min(Number(listing.priceParseConfidence ?? 0), Number(signal.confidence ?? 1)),
    exclusionReason: null,
    buyLineEligible: false,
  };
}

export function evaluateObservedMarketPromotion(signal = {}, listing = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const candidate =
    listing?.jpyCandidate && typeof listing.jpyCandidate === "object"
      ? listing.jpyCandidate
      : deriveJpyCandidateFromListing(signal, listing);
  const rejectionReasons = [];
  const productName = compactText(signal.productName ?? signal.query ?? listing.title ?? "");
  const productKey = normalizeProductKey(signal.productKey ?? productName);
  const observedAt = listingObservedAt(signal, listing, candidate ?? {});
  const amount = Number(candidate?.amount);
  const confidence = Number(candidate?.confidence ?? 0);
  const statusCandidate = compactText(candidate?.statusCandidate ?? listing?.status ?? "");
  const evidenceText = jpyEvidenceText(candidate ?? {});
  const itemUrl = compactText(candidate?.sourceUrl ?? listing?.itemUrl ?? "");

  if (!candidate) rejectionReasons.push("jpy_candidate_missing");
  if (!productName || !productKey) rejectionReasons.push("product_identity_missing");
  if (!Number.isFinite(amount) || amount <= 0) rejectionReasons.push("jpy_amount_invalid");
  if (String(candidate?.currency ?? "").toUpperCase() !== "JPY") rejectionReasons.push("currency_not_jpy");
  if (!/(?:¥|￥|円)/u.test(evidenceText)) rejectionReasons.push("jpy_evidence_missing");
  if (confidence < OBSERVED_MARKET_PROMOTION_MIN_CONFIDENCE) rejectionReasons.push("confidence_below_threshold");
  if (statusCandidate !== "on_sale") rejectionReasons.push("sale_status_not_on_sale");
  if (!promotionIdentityLooksConcrete(productName, signal.query ?? "")) rejectionReasons.push("product_identity_not_concrete");
  if (!promotionTitleMatchesIdentity(signal, listing)) rejectionReasons.push("listing_title_identity_mismatch");
  if (!observedAt) rejectionReasons.push("observed_at_missing");
  if (observedAt && daysSince(observedAt, now) > OBSERVED_MARKET_PROMOTION_MAX_AGE_DAYS) rejectionReasons.push("observed_price_stale");
  if (!/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(itemUrl)) rejectionReasons.push("item_url_invalid");
  if (candidate?.exclusionReason) rejectionReasons.push(`excluded:${candidate.exclusionReason}`);

  if (rejectionReasons.length > 0) {
    return {
      promoted: false,
      rejectionReasons: [...new Set(rejectionReasons)],
      productKey,
      productName,
      itemUrl,
    };
  }

  const roundedAmount = Math.round(amount);
  return {
    promoted: true,
    rejectionReasons: [],
    priceSnapshot: {
      productKey,
      productName,
      priceType: "market",
      value: roundedAmount,
      currency: "JPY",
      condition: "正式反映済み観測価格",
      source: "mercari_observed_market",
      sourceMode: "promoted_observed_market",
      provider: "mercari_browser",
      marketplace: signal.marketplace ?? "mercari",
      itemUrl,
      query: signal.query ?? null,
      priceSourceRank: "observed_market_price",
      priceUsage: "buyline",
      buyLineEligible: true,
      observedAt,
      freshness: daysSince(observedAt, now) <= 1 ? "fresh" : "normal",
      confidence,
      promotionStatus: "promoted",
      promotionReason: "jpy_candidate_on_sale_confident_fresh_traceable",
      promotionEvidence: {
        sourceSignalKey: signal.marketplaceSignalKey ?? signal.id ?? null,
        rawText: compactText(candidate.rawText ?? "").slice(0, 160),
        selectorEvidence: compactText(candidate.selectorEvidence ?? "").slice(0, 160),
        statusCandidate,
      },
    },
  };
}

export function promoteObservedMarketPrices(snapshot = {}, options = {}) {
  const marketplaceSignals = Array.isArray(snapshot.marketplaceSignals) ? snapshot.marketplaceSignals : [];
  const existing = Array.isArray(snapshot.priceSnapshots) ? snapshot.priceSnapshots : [];
  const baseExisting = existing.filter(
    (price) => !(price.source === "mercari_observed_market" && price.priceSourceRank === "observed_market_price"),
  );
  const promoted = [];
  const rejected = [];
  const seen = new Set(baseExisting.map((price) => `${price.productKey}|${price.priceType}|${price.source}|${price.itemUrl ?? ""}|${price.value}`));

  for (const signal of marketplaceSignals) {
    const signalMedian = signalObservedJpyMedian(signal);
    for (const listing of signal.listingCandidates ?? []) {
      const result = evaluateObservedMarketPromotion(signal, listing, options);
      if (!result.promoted) {
        if (result.productKey || result.itemUrl) rejected.push(result);
        continue;
      }
      const row = result.priceSnapshot;
      const outlierReason = observedPromotionOutlierReason(row, signalMedian);
      if (outlierReason) {
        rejected.push({
          promoted: false,
          rejectionReasons: [outlierReason],
          productKey: result.productKey,
          productName: result.productName,
          itemUrl: row.itemUrl,
        });
        continue;
      }
      const key = `${row.productKey}|${row.priceType}|${row.source}|${row.itemUrl ?? ""}|${row.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      promoted.push(row);
    }
  }

  return {
    priceSnapshots: [...baseExisting, ...promoted],
    promoted,
    rejected,
    summary: {
      promoted: promoted.length,
      rejected: rejected.length,
      rejectionReasons: rejected.reduce((acc, row) => {
        for (const reason of row.rejectionReasons ?? []) acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}

function yenLabel(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? `¥${number.toLocaleString("ja-JP")}` : "";
}

function observedPriceSortValue(price = {}) {
  const confidence = Number(price.confidence ?? 0);
  const observedAt = Date.parse(price.observedAt ?? "");
  return confidence * 10_000_000_000 + (Number.isFinite(observedAt) ? observedAt / 1_000_000_000 : 0);
}

function median(values = []) {
  const sorted = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function signalObservedJpyMedian(signal = {}) {
  const values = [];
  for (const listing of signal.listingCandidates ?? []) {
    const candidate = listing?.jpyCandidate && typeof listing.jpyCandidate === "object"
      ? listing.jpyCandidate
      : deriveJpyCandidateFromListing(signal, listing);
    const amount = Number(candidate?.amount);
    if (String(candidate?.currency ?? "").toUpperCase() === "JPY" && Number.isFinite(amount) && amount > 0) {
      values.push(amount);
    }
  }
  return values.length >= 3 ? median(values) : null;
}

function observedPromotionOutlierReason(price = {}, signalMedian = null) {
  const value = Number(price.value);
  if (!Number.isFinite(value) || !Number.isFinite(signalMedian) || signalMedian <= 0) return "";
  if (value < signalMedian * 0.35) return "price_outlier_low";
  if (value > signalMedian * 3) return "price_outlier_high";
  return "";
}

export function applyPromotedMarketPricesToCandidates(snapshot = {}) {
  const promotedByProduct = new Map();
  for (const price of snapshot.priceSnapshots ?? []) {
    if (price.priceSourceRank !== "observed_market_price") continue;
    if (price.priceType !== "market") continue;
    if (price.promotionStatus !== "promoted") continue;
    if (price.buyLineEligible !== true) continue;
    if (!Number.isFinite(Number(price.value))) continue;
    const key = normalizeProductKey(price.productKey ?? price.productName);
    if (!key) continue;
    const current = promotedByProduct.get(key);
    if (!current || observedPriceSortValue(price) > observedPriceSortValue(current)) promotedByProduct.set(key, price);
  }

  let applied = 0;
  const discoveryCandidates = (snapshot.discoveryCandidates ?? []).map((candidate) => {
    const key = normalizeProductKey(candidate.name);
    const promoted = promotedByProduct.get(key);
    if (!promoted) return candidate;
    if (candidate.marketPriceSourceRank === "manual_price" || candidate.marketPriceSourceRank === "confirmed_price") return candidate;
    applied += 1;
    return {
      ...candidate,
      marketPrice: Math.round(Number(promoted.value)),
      marketPriceLabel: `正式反映済み観測価格 ${yenLabel(promoted.value)}`,
      marketPriceSource: promoted.source,
      marketPriceSourceRank: "observed_market_price",
      marketPriceUsage: "buyline",
      marketPriceBuyLineEligible: true,
      marketPriceCurrency: promoted.currency,
      marketPriceSourceMode: promoted.sourceMode,
      marketPricePromotionStatus: promoted.promotionStatus,
      marketObservedAt: promoted.observedAt ?? candidate.marketObservedAt ?? null,
      marketPriceEvidence: promoted.promotionEvidence ?? null,
    };
  });

  return {
    discoveryCandidates,
    summary: {
      applied,
      promotedProducts: promotedByProduct.size,
    },
  };
}
