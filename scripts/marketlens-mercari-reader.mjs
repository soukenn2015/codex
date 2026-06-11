import { LIMITS, resolveMarketplaceBrowserObservationLimit } from "./marketlens-limits.mjs";
import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";

const JINA_READER_PREFIX = "https://r.jina.ai/";
const MERCARI_ITEM_PATH_RE = /^https:\/\/jp\.mercari\.com\/item\/m\d+$/i;
const MERCARI_SEARCH_URL_RE = /\/search\?keyword=/i;
const LISTING_LINE_RE =
  /((?:US\$|USD\s+|\$|¥|￥)\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*円)\s+([^\]]+)\]\((https:\/\/jp\.mercari\.com\/item\/m\d+)\)/gi;
const IMAGE_TITLE_RE = /\[!\[Image\s+\d+:\s*([^\]]+?)(?:のサムネイル)?\]/i;

const PERMANENT_FAILURE_ERRORS = new Set(["login_required", "blocked"]);
const RETRYABLE_FAILURE_ERRORS = new Set(["timeout", "parse_failed", "no_results", "empty_response"]);
const MAX_MARKETPLACE_OBSERVATION_FAILED_RETRIES = 2;
const MAX_LISTING_CANDIDATES = 8;

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseNumericToken(token = "") {
  const cleaned = String(token ?? "").replace(/,/g, "").trim();
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseMercariListingPrice(rawPriceText = "") {
  const raw = compactText(rawPriceText);
  if (!raw) {
    return { value: null, currency: "unknown", rawPriceText: "", priceParseConfidence: 0 };
  }

  const jpyPrefix = raw.match(/^(?:¥|￥)\s*([\d,]+(?:\.\d+)?)/u);
  if (jpyPrefix) {
    const value = parseNumericToken(jpyPrefix[1]);
    if (value != null) {
      return { value, currency: "JPY", rawPriceText: jpyPrefix[0], priceParseConfidence: 0.95 };
    }
  }

  const jpySuffix = raw.match(/^([\d,]+(?:\.\d+)?)\s*円/u);
  if (jpySuffix) {
    const value = parseNumericToken(jpySuffix[1]);
    if (value != null) {
      return { value, currency: "JPY", rawPriceText: jpySuffix[0], priceParseConfidence: 0.9 };
    }
  }

  const usdUs = raw.match(/^US\$\s*([\d,]+(?:\.\d+)?)/iu);
  if (usdUs) {
    const value = parseNumericToken(usdUs[1]);
    if (value != null) {
      return { value, currency: "USD", rawPriceText: usdUs[0], priceParseConfidence: 0.95 };
    }
  }

  const usdBare = raw.match(/^\$\s*([\d,]+(?:\.\d+)?)/u);
  if (usdBare) {
    const value = parseNumericToken(usdBare[1]);
    if (value != null) {
      return { value, currency: "USD", rawPriceText: usdBare[0], priceParseConfidence: 0.9 };
    }
  }

  const usdLabel = raw.match(/^USD\s+([\d,]+(?:\.\d+)?)/iu);
  if (usdLabel) {
    const value = parseNumericToken(usdLabel[1]);
    if (value != null) {
      return { value, currency: "USD", rawPriceText: usdLabel[0], priceParseConfidence: 0.9 };
    }
  }

  const digitsOnly = parseNumericToken(raw.replace(/[^\d.,]/g, ""));
  return {
    value: digitsOnly,
    currency: "unknown",
    rawPriceText: raw,
    priceParseConfidence: digitsOnly != null ? 0.35 : 0.2,
  };
}

function normalizeMercariItemUrl(url = "") {
  const normalized = compactText(url).replace(/^http:/i, "https://");
  if (!MERCARI_ITEM_PATH_RE.test(normalized)) return "";
  if (MERCARI_SEARCH_URL_RE.test(normalized)) return "";
  return normalized;
}

function cleanListingTitle(title = "") {
  return compactText(title).replace(/のサムネイル$/u, "").slice(0, 180);
}

export function marketplaceSignalKey(row = {}) {
  return [row.marketplace ?? "mercari", row.productKey ?? "", row.query ?? ""].join("::");
}

export function summarizeListingCurrencies(listings = []) {
  const counts = { JPY: 0, USD: 0, unknown: 0 };
  for (const row of listings) {
    const currency = String(row?.currency ?? "unknown").toUpperCase();
    if (currency === "JPY") counts.JPY += 1;
    else if (currency === "USD") counts.USD += 1;
    else counts.unknown += 1;
  }
  return counts;
}

export function signalNeedsCurrencyRecheck(signal = {}) {
  const listings = Array.isArray(signal.listingCandidates) ? signal.listingCandidates : [];
  if (!listings.length) return false;
  const counts = summarizeListingCurrencies(listings);
  if (counts.unknown === 0) return false;
  if (counts.JPY === 0 && counts.USD === 0) return true;
  return counts.unknown > counts.JPY && counts.unknown >= counts.USD;
}

export function collectStableObservedMarketplaceKeys(marketplaceSignals = []) {
  const keys = new Set();
  for (const row of marketplaceSignals) {
    if (row?.sourceMode !== "browser_observed") continue;
    if (row?.priceSourceRank !== "browser_observed_candidate") continue;
    if (signalNeedsCurrencyRecheck(row)) continue;
    const key = marketplaceSignalKey(row);
    if (key) keys.add(key);
  }
  return keys;
}

export function collectCurrencyRecheckMarketplaceKeys(marketplaceSignals = []) {
  const keys = new Set();
  for (const row of marketplaceSignals) {
    if (!signalNeedsCurrencyRecheck(row)) continue;
    const key = marketplaceSignalKey(row);
    if (key) keys.add(key);
  }
  return keys;
}

export function collectObservedMarketplaceKeys(marketplaceSignals = []) {
  return collectStableObservedMarketplaceKeys(marketplaceSignals);
}

function queueItemFromTarget(target = {}, overrides = {}) {
  return {
    id: target.id ?? `marketplace:mercari:${target.productKey}`,
    productKey: target.productKey ?? "",
    productName: target.productName ?? "",
    marketplace: target.marketplace ?? "mercari",
    query: compactText(target.query ?? ""),
    searchUrl: overrides.searchUrl ?? target.searchUrl ?? "",
    status: overrides.status ?? target.status ?? "pending",
    skipReason: overrides.skipReason ?? target.skipReason ?? null,
    failedCount: Number(overrides.failedCount ?? target.failedCount ?? 0) || 0,
    lastError: overrides.lastError ?? target.lastError ?? null,
    lastAttemptAt: overrides.lastAttemptAt ?? target.lastAttemptAt ?? null,
    reason: overrides.reason ?? target.reason ?? null,
  };
}

function isPermanentSkipReason(reason = "") {
  return ["permanent_login_required", "permanent_blocked", "permanent_failed_retries"].includes(String(reason ?? ""));
}

function resolveQueueStatusFromExisting(existing = {}, stableObservedKeys, recheckKeys, key) {
  if (recheckKeys.has(key)) {
    if (existing.status === "skipped" && isPermanentSkipReason(existing.skipReason)) {
      return { status: "skipped", reason: existing.reason ?? "permanent_skip", skipReason: existing.skipReason };
    }
    if (PERMANENT_FAILURE_ERRORS.has(existing.lastError)) {
      return {
        status: "skipped",
        reason: "permanent_fetch_failure",
        skipReason: existing.lastError === "login_required" ? "permanent_login_required" : "permanent_blocked",
      };
    }
    return { status: "pending", reason: "recheck_unknown_currency", skipReason: null };
  }
  if (stableObservedKeys.has(key)) {
    return { status: "browser_observed", reason: existing.reason ?? "already_observed", skipReason: null };
  }
  if (existing.status === "skipped" && isPermanentSkipReason(existing.skipReason)) {
    return { status: "skipped", reason: existing.reason ?? "permanent_skip", skipReason: existing.skipReason };
  }
  if (PERMANENT_FAILURE_ERRORS.has(existing.lastError)) {
    return {
      status: "skipped",
      reason: "permanent_fetch_failure",
      skipReason: existing.lastError === "login_required" ? "permanent_login_required" : "permanent_blocked",
    };
  }
  if (Number(existing.failedCount ?? 0) >= MAX_MARKETPLACE_OBSERVATION_FAILED_RETRIES) {
    return {
      status: "skipped",
      reason: "retry_exhausted",
      skipReason: "permanent_failed_retries",
    };
  }
  if (existing.status === "failed" && RETRYABLE_FAILURE_ERRORS.has(existing.lastError)) {
    return { status: "pending", reason: "retryable_failed", skipReason: null };
  }
  if (existing.status === "browser_observed") {
    return { status: "pending", reason: null, skipReason: null };
  }
  if (["pending", "failed", "skipped", "stale"].includes(existing.status)) {
    return { status: existing.status, reason: existing.reason ?? null, skipReason: existing.skipReason ?? null };
  }
  return { status: "pending", reason: null, skipReason: null };
}

export function summarizeMarketplaceObservationQueue(queue = []) {
  const byStatus = {};
  const skippedByReason = {};
  for (const item of queue) {
    const status = String(item?.status ?? "pending");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === "skipped" && item?.skipReason) {
      const reason = String(item.skipReason);
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
    }
  }
  return {
    total: queue.length,
    byStatus,
    skippedByReason,
    pending: byStatus.pending ?? 0,
    browser_observed: byStatus.browser_observed ?? 0,
    failed: byStatus.failed ?? 0,
    skipped: byStatus.skipped ?? 0,
    stale: byStatus.stale ?? 0,
  };
}

export function buildMarketplaceObservationQueue(snapshot = {}) {
  const targets = Array.isArray(snapshot.marketplaceResearchTargets) ? snapshot.marketplaceResearchTargets : [];
  const marketplaceSignals = snapshot.marketplaceSignals ?? [];
  const stableObservedKeys = collectStableObservedMarketplaceKeys(marketplaceSignals);
  const recheckKeys = collectCurrencyRecheckMarketplaceKeys(marketplaceSignals);
  const existingById = new Map();
  for (const item of snapshot.marketplaceObservationQueue ?? []) {
    const id = String(item?.id ?? "");
    if (id) existingById.set(id, item);
  }

  const queueById = new Map();

  for (const target of targets) {
    if (target.marketplace !== "mercari") continue;
    const id = target.id ?? `marketplace:mercari:${target.productKey}`;
    const key = marketplaceSignalKey(target);
    const existing = existingById.get(id) ?? {};
    let status = "pending";
    let reason = null;
    let skipReason = null;

    if (!target.searchUrl || !target.query) {
      status = "skipped";
      skipReason = "missing_search_url";
      reason = "invalid_target";
    } else if (existing.id) {
      const resolved = resolveQueueStatusFromExisting(existing, stableObservedKeys, recheckKeys, key);
      status = resolved.status;
      reason = resolved.reason;
      skipReason = resolved.skipReason;
    } else if (recheckKeys.has(key)) {
      status = "pending";
      reason = "recheck_unknown_currency";
    } else if (stableObservedKeys.has(key)) {
      status = "browser_observed";
      reason = "already_observed";
    }

    queueById.set(
      id,
      queueItemFromTarget(target, {
        status,
        reason,
        skipReason,
        searchUrl: target.searchUrl,
        failedCount: existing.failedCount ?? 0,
        lastError: existing.lastError ?? target.lastError ?? null,
        lastAttemptAt: existing.lastAttemptAt ?? target.lastAttemptAt ?? null,
      }),
    );
  }

  for (const [id, item] of existingById) {
    if (queueById.has(id)) continue;
    queueById.set(
      id,
      queueItemFromTarget(item, {
        status: item.status === "browser_observed" ? "stale" : item.status ?? "stale",
        reason: item.reason ?? "target_no_longer_present",
      }),
    );
  }

  const statusOrder = { pending: 0, failed: 1, skipped: 2, stale: 3, browser_observed: 4 };
  const queue = [...queueById.values()]
    .filter((item) => item.marketplace === "mercari")
    .sort((a, b) => {
      const left = statusOrder[a.status] ?? 9;
      const right = statusOrder[b.status] ?? 9;
      if (left !== right) return left - right;
      return String(a.productName ?? "").localeCompare(String(b.productName ?? ""), "ja");
    });

  return {
    queue,
    summary: summarizeMarketplaceObservationQueue(queue),
    recheckKeys: [...recheckKeys],
    stableObservedKeys: [...stableObservedKeys],
  };
}

function hasMercariItemUrls(text = "") {
  return /https?:\/\/jp\.mercari\.com\/item\/m\d+/i.test(String(text));
}

function detectFetchFailure(body = "") {
  const text = String(body ?? "");
  if (!compactText(text)) {
    return { kind: "parse_failed", warnings: ["empty_response"] };
  }
  if (/captcha|robot|アクセスが集中|異常なアクセス|Access Denied|Forbidden/i.test(text)) {
    return { kind: "blocked", warnings: ["blocked_or_captcha"] };
  }
  if (/ログイン/.test(text) && !hasMercariItemUrls(text)) {
    return { kind: "login_required", warnings: ["login_required"] };
  }
  return null;
}

function tokenizeQuery(query = "") {
  return compactText(query)
    .toLowerCase()
    .split(/[\s　・／/]+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length >= 2);
}

function titleMatchesQuery(title = "", query = "") {
  const text = compactText(title).toLowerCase();
  const tokens = tokenizeQuery(query);
  if (!text || !tokens.length) return false;
  return tokens.some((token) => text.includes(token));
}

export function parseMercariSearchMarkdown(raw = "", query = "", observedAt = "") {
  const warnings = [];
  const failure = detectFetchFailure(raw);
  if (failure) {
    return {
      observationStatus: failure.kind,
      listingCandidates: [],
      soldCandidates: [],
      parseWarnings: failure.warnings,
      confidence: failure.kind === "blocked" || failure.kind === "login_required" ? 0.1 : 0.2,
    };
  }

  const listingCandidates = [];
  const seenUrls = new Set();
  const rawText = String(raw);
  for (const match of rawText.matchAll(LISTING_LINE_RE)) {
    const inlineTitle = cleanListingTitle(match[2] ?? "");
    const contextStart = Math.max(0, Number(match.index ?? 0) - 240);
    const context = rawText.slice(contextStart, Number(match.index ?? 0));
    const imageTitle = cleanListingTitle(context.match(IMAGE_TITLE_RE)?.[1] ?? "");
    const title = inlineTitle || imageTitle;
    const price = parseMercariListingPrice(match[1] ?? "");
    const itemUrl = normalizeMercariItemUrl(match[3] ?? "");
    if (!title || price.value == null || !itemUrl || seenUrls.has(itemUrl)) continue;
    seenUrls.add(itemUrl);
    listingCandidates.push({
      value: price.value,
      currency: price.currency,
      rawPriceText: price.rawPriceText,
      priceParseConfidence: price.priceParseConfidence,
      title,
      itemUrl,
      shippingIncluded: null,
      status: "on_sale",
      observedAt: observedAt || null,
    });
    if (listingCandidates.length >= MAX_LISTING_CANDIDATES) break;
  }

  if (!listingCandidates.length) {
    const itemsPresent = hasMercariItemUrls(String(raw));
    return {
      observationStatus: itemsPresent ? "parse_failed" : "no_results",
      listingCandidates: [],
      soldCandidates: [],
      parseWarnings: itemsPresent ? ["listing_candidates_missing"] : ["no_item_urls"],
      confidence: itemsPresent ? 0.25 : 0.2,
    };
  }

  const confidence = computeMarketplaceObservationConfidence({
    query,
    listingCandidates,
    observationStatus: "succeeded",
    parseWarnings: warnings,
  });

  return {
    observationStatus: "succeeded",
    listingCandidates,
    soldCandidates: [],
    parseWarnings: warnings,
    confidence,
  };
}

export function computeMarketplaceObservationConfidence({
  query = "",
  listingCandidates = [],
  observationStatus = "succeeded",
  parseWarnings = [],
} = {}) {
  let confidence = 0.35;
  if (listingCandidates.length >= 2) confidence += 0.15;
  if (listingCandidates.length >= 5) confidence += 0.1;
  if (listingCandidates.some((row) => titleMatchesQuery(row.title, query))) confidence += 0.15;
  if (listingCandidates.some((row) => row.currency === "JPY" || row.currency === "USD")) confidence += 0.05;
  if (observationStatus === "blocked" || observationStatus === "login_required") confidence -= 0.25;
  if (observationStatus === "parse_failed" || observationStatus === "timeout") confidence -= 0.15;
  if (parseWarnings.includes("blocked_or_captcha") || parseWarnings.includes("login_required")) confidence -= 0.2;
  return Math.min(1, Math.max(0, Number(confidence.toFixed(3))));
}

async function fetchMercariSearch(searchUrl, timeoutMs = 15000) {
  const readerUrl = searchUrl.startsWith(JINA_READER_PREFIX) ? searchUrl : buildJinaReaderUrl(searchUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(readerUrl, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
        "X-Wait-For-Selector": "a[href*='/item/']",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      readerUrl,
      body,
      error: response.ok ? null : `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      readerUrl,
      body: "",
      error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? "fetch_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function mergeMarketplaceSignals(existing = [], incoming = []) {
  const byKey = new Map();
  for (const row of existing) {
    const key = marketplaceSignalKey(row);
    if (key) byKey.set(key, row);
  }
  for (const row of incoming) {
    const key = marketplaceSignalKey(row);
    if (key) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function markQueueFetchFailure(queueItem, observationStatus) {
  queueItem.failedCount = Number(queueItem.failedCount ?? 0) + 1;
  queueItem.lastError = observationStatus;
  if (PERMANENT_FAILURE_ERRORS.has(observationStatus)) {
    queueItem.status = "skipped";
    queueItem.skipReason =
      observationStatus === "login_required" ? "permanent_login_required" : "permanent_blocked";
    queueItem.reason = "permanent_fetch_failure";
    return "skipped";
  }
  if (queueItem.failedCount >= MAX_MARKETPLACE_OBSERVATION_FAILED_RETRIES) {
    queueItem.status = "skipped";
    queueItem.skipReason = "permanent_failed_retries";
    queueItem.reason = "retry_exhausted";
    return "skipped";
  }
  queueItem.status = "failed";
  queueItem.reason = "retryable_failed";
  return "failed";
}

function buildMarketplaceSignalFromObservation(target = {}, parsed = {}, observedAt = "") {
  const listingCandidates = (parsed.listingCandidates ?? []).map((row) => ({
    ...row,
    observedAt: row.observedAt ?? observedAt,
  }));
  return {
    marketplace: "mercari",
    productKey: target.productKey ?? "",
    productName: target.productName ?? "",
    query: target.query ?? "",
    searchUrl: target.searchUrl ?? "",
    observedAt,
    sourceMode: "browser_observed",
    priceSourceRank: "browser_observed_candidate",
    buyLineEligible: false,
    listingCandidates,
    soldCandidates: parsed.soldCandidates ?? [],
    parseWarnings: parsed.parseWarnings ?? [],
    confidence: parsed.confidence ?? 0,
    observationStatus: parsed.observationStatus ?? "parse_failed",
  };
}

export async function collectMarketplaceObservationSignals({
  snapshot = {},
  enabled = true,
  limit = resolveMarketplaceBrowserObservationLimit(),
  timeoutMs = 15000,
  env = process.env,
} = {}) {
  const normalizedLimit = Math.max(
    0,
    Math.min(LIMITS.MARKETPLACE_BROWSER_OBSERVATION_HARD_MAX, Number(limit ?? resolveMarketplaceBrowserObservationLimit(env))),
  );
  const normalizedTimeout = Math.max(3000, Math.min(60000, Number(timeoutMs ?? 15000)));
  const existingSignals = Array.isArray(snapshot.marketplaceSignals) ? snapshot.marketplaceSignals : [];

  const { queue: initialQueue, summary: initialSummary, recheckKeys } = buildMarketplaceObservationQueue(snapshot);
  const queueById = new Map(initialQueue.map((item) => [item.id, { ...item }]));

  const execution = {
    enabled: Boolean(enabled),
    limit: normalizedLimit,
    timeoutMs: normalizedTimeout,
    requested: 0,
    succeeded: 0,
    failed: 0,
    skipped: initialSummary.skipped,
    skippedByReason: { ...(initialSummary.skippedByReason ?? {}) },
    byStatus: {
      succeeded: 0,
      no_results: 0,
      parse_failed: 0,
      blocked: 0,
      login_required: 0,
      timeout: 0,
    },
    marketplaceObservationQueueTotal: initialSummary.total,
    marketplaceObservationQueuePending: initialSummary.pending,
    marketplaceObservationQueueObserved: initialSummary.browser_observed,
    marketplaceObservationQueueFailed: initialSummary.failed,
    marketplaceObservationQueueSkipped: initialSummary.skipped,
    marketplaceObservationQueueStale: initialSummary.stale,
    unknownCurrencyRecheckPending: initialQueue.filter((item) => item.reason === "recheck_unknown_currency").length,
    unknownCurrencyRecheckRequested: 0,
    unknownCurrencyRecheckSucceeded: 0,
    unknownCurrencyRecheckStillUnknown: 0,
  };

  const incomingSignals = [];
  const observedAt = new Date().toISOString();

  if (enabled && normalizedLimit > 0) {
    const pendingTargets = initialQueue
      .filter((item) => item.status === "pending" && item.searchUrl && item.query)
      .sort((a, b) => {
        const aRecheck = a.reason === "recheck_unknown_currency" ? 0 : 1;
        const bRecheck = b.reason === "recheck_unknown_currency" ? 0 : 1;
        if (aRecheck !== bRecheck) return aRecheck - bRecheck;
        return String(a.productName ?? "").localeCompare(String(b.productName ?? ""), "ja");
      })
      .slice(0, normalizedLimit);
    execution.requested = pendingTargets.length;
    execution.unknownCurrencyRecheckRequested = pendingTargets.filter(
      (item) => item.reason === "recheck_unknown_currency",
    ).length;

    for (const target of pendingTargets) {
      const queueItem = queueById.get(target.id) ?? target;
      const isRecheck = target.reason === "recheck_unknown_currency";
      queueItem.lastAttemptAt = observedAt;
      const fetched = await fetchMercariSearch(target.searchUrl, normalizedTimeout);

      if (fetched.error === "timeout") {
        execution.failed += 1;
        execution.byStatus.timeout += 1;
        markQueueFetchFailure(queueItem, "timeout");
        continue;
      }

      if (!fetched.ok || !compactText(fetched.body)) {
        execution.failed += 1;
        execution.byStatus.parse_failed += 1;
        markQueueFetchFailure(queueItem, fetched.error ?? "parse_failed");
        continue;
      }

      const parsed = parseMercariSearchMarkdown(fetched.body, target.query, observedAt);
      const observationStatus = parsed.observationStatus ?? "parse_failed";
      execution.byStatus[observationStatus] = (execution.byStatus[observationStatus] ?? 0) + 1;

      if (observationStatus === "succeeded") {
        execution.succeeded += 1;
        const signal = buildMarketplaceSignalFromObservation(target, parsed, observedAt);
        if (isRecheck) {
          execution.unknownCurrencyRecheckSucceeded += 1;
          if (signalNeedsCurrencyRecheck(signal)) {
            execution.unknownCurrencyRecheckStillUnknown += 1;
          }
        }
        queueItem.status = signalNeedsCurrencyRecheck(signal) ? "pending" : "browser_observed";
        queueItem.reason = signalNeedsCurrencyRecheck(signal) ? "recheck_unknown_currency" : "browser_observed";
        queueItem.lastError = null;
        queueItem.skipReason = null;
        incomingSignals.push(signal);
        continue;
      }

      const outcome = markQueueFetchFailure(queueItem, observationStatus);
      if (outcome === "skipped") {
        execution.skipped += 1;
        const reason = queueItem.skipReason ?? observationStatus;
        execution.skippedByReason[reason] = (execution.skippedByReason[reason] ?? 0) + 1;
      } else {
        execution.failed += 1;
      }
    }
  }

  for (const row of existingSignals) {
    if (signalNeedsCurrencyRecheck(row)) continue;
    const key = marketplaceSignalKey(row);
    const queueItem = [...queueById.values()].find((item) => marketplaceSignalKey(item) === key);
    if (!queueItem || queueItem.status !== "pending") continue;
    queueItem.status = "browser_observed";
    queueItem.reason = "already_observed";
    execution.skipped += 1;
    execution.skippedByReason.already_observed = (execution.skippedByReason.already_observed ?? 0) + 1;
  }
  const updatedQueue = [...queueById.values()].sort((a, b) => {
    const statusOrder = { pending: 0, failed: 1, skipped: 2, stale: 3, browser_observed: 4 };
    const left = statusOrder[a.status] ?? 9;
    const right = statusOrder[b.status] ?? 9;
    if (left !== right) return left - right;
    return String(a.productName ?? "").localeCompare(String(b.productName ?? ""), "ja");
  });
  const queueSummary = summarizeMarketplaceObservationQueue(updatedQueue);
  execution.marketplaceObservationQueueTotal = queueSummary.total;
  execution.marketplaceObservationQueuePending = queueSummary.pending;
  execution.marketplaceObservationQueueObserved = queueSummary.browser_observed;
  execution.marketplaceObservationQueueFailed = queueSummary.failed;
  execution.marketplaceObservationQueueSkipped = queueSummary.skipped;
  execution.marketplaceObservationQueueStale = queueSummary.stale;
  execution.skipped = queueSummary.skipped;
  execution.skippedByReason = queueSummary.skippedByReason;

  const marketplaceSignals = mergeMarketplaceSignals(existingSignals, incomingSignals);

  return {
    marketplaceSignals,
    marketplaceObservationQueue: updatedQueue,
    queueSummary,
    execution,
  };
}