/**
 * Provisional BuyLine policy — safe price sources only.
 * Mercari browser_observed_candidate / jpyCandidate / USD / unknown / AI / heuristic are excluded.
 */

export const PROVISIONAL_BUYLINE_ELIGIBLE_RANKS = new Set(["manual_price"]);

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

export const PROVISIONAL_BUYLINE_FUTURE_CONDITIONAL_RANKS = new Set(["observed_market_price"]);

export function isProvisionalBuyLineRank(rank = "") {
  const normalized = String(rank ?? "");
  if (normalized === PROVISIONAL_BUYLINE_CONFIRMED_RANK) return true;
  return PROVISIONAL_BUYLINE_ELIGIBLE_RANKS.has(normalized);
}

export function isProvisionalBuyLineCurrencyAllowed(currency = "JPY") {
  const normalized = String(currency ?? "JPY").toUpperCase();
  return normalized !== "UNKNOWN" && normalized !== "USD";
}

export function isProvisionalBuyLinePriceEligible(price = {}) {
  if (!price || price.buyLineEligible !== true) return false;
  if (!isProvisionalBuyLineRank(price.priceSourceRank)) return false;
  if (!isProvisionalBuyLineCurrencyAllowed(price.currency)) return false;
  if (price.sourceMode === "browser_observed") return false;
  if (price.jpyCandidate != null) return false;
  return true;
}

export function isProvisionalBuyLineCandidateFieldEligible({ rank = "", buyLineEligible = true, currency = "JPY" } = {}) {
  if (buyLineEligible === false) return false;
  if (!isProvisionalBuyLineRank(rank)) return false;
  return isProvisionalBuyLineCurrencyAllowed(currency);
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
      })
    ) {
      errors.push(`candidate market が暫定 BuyLine 許可外です: ${candidate.name} -> ${candidate.marketPriceSourceRank}`);
    }
    if (
      candidate.retailPriceBuyLineEligible === true &&
      !isProvisionalBuyLineCandidateFieldEligible({
        rank: candidate.retailPriceSourceRank,
        buyLineEligible: true,
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