import { LIMITS, resolveBrowserObservationBatchLimit } from "./marketlens-limits.mjs";
import {
  buildYahooRealtimeSearchUrl,
  prepareRealtimeObservationQuery,
  sanitizeSocialSearchSampleText,
} from "./marketlens-observation.mjs";
import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";

const JINA_READER_PREFIX = "https://r.jina.ai/";
const STATUS_TIME_RE =
  /\[([^\]]+)\]\((https?:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{10,}[^)]*)\)/i;
const HANDLE_RE = /\[@([A-Za-z0-9_]+)\]\(https?:\/\/x\.com\/[^)]+\)/i;
const RESULT_COUNT_RE = /([\d,]+)\s*件(?:のポスト)?/gu;
const FORBIDDEN_BUZZ_RE = /(?:Xでバズ|SNS急上昇|SNSで急上昇|X話題|話題化|急上昇)/u;

const PERMANENT_FAILURE_ERRORS = new Set(["login_required", "blocked"]);
const RETRYABLE_FAILURE_ERRORS = new Set(["timeout", "parse_failed", "no_results", "empty_response"]);
const MAX_BROWSER_OBSERVATION_FAILED_RETRIES = 2;

const NOISE_LINE_RE =
  /^(?:Title:|URL Source:|Markdown Content:|Published Time:|Yahoo! JAPAN|ヘルプ|キーワード：|ログイン|新規取得|IDでもっと便利|使いこなせなくていい|初回購入限定|ウェブ$|画像$|ミュートした|プライバシー|利用規約|広告について|検索サービス|ヘルプ・お問い合わせ|\*|\[!\[|!\[Image|!\[|https?:\/\/|# 「)/i;

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripMarkdownNoise(line = "") {
  return line
    .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[#>*_]/g, "")
    .trim();
}

function socialSearchSignalKey(row = {}) {
  return [row.provider ?? "yahoo_realtime", row.productKey ?? "", row.query ?? ""].join("::");
}

export function collectObservedSocialSearchKeys(socialSearchSignals = []) {
  const keys = new Set();
  for (const row of socialSearchSignals) {
    if (row?.sourceMode !== "browser_observed") continue;
    const key = socialSearchSignalKey(row);
    if (key) keys.add(key);
  }
  return keys;
}

function queueItemFromTarget(target = {}, overrides = {}) {
  const observationQuery = compactText(overrides.observationQuery ?? target.observationQuery ?? target.query ?? "");
  const searchUrl =
    overrides.searchUrl ??
    target.searchUrl ??
    (observationQuery ? buildYahooRealtimeSearchUrl(observationQuery) : "");
  return {
    id: target.id ?? `realtime:yahoo:${target.productKey}`,
    productKey: target.productKey ?? "",
    productName: target.productName ?? "",
    provider: target.provider ?? "yahoo_realtime",
    query: compactText(target.query ?? ""),
    originalQuery: compactText(overrides.originalQuery ?? target.originalQuery ?? target.query ?? ""),
    observationQuery,
    searchUrl,
    status: overrides.status ?? target.status ?? "pending",
    skipReason: overrides.skipReason ?? target.skipReason ?? null,
    failedCount: Number(overrides.failedCount ?? target.failedCount ?? 0) || 0,
    lastError: overrides.lastError ?? target.lastError ?? null,
    lastAttemptAt: overrides.lastAttemptAt ?? target.lastAttemptAt ?? null,
    reason: overrides.reason ?? target.reason ?? null,
    queryShortened: Boolean(overrides.queryShortened ?? target.queryShortened ?? false),
  };
}

function isPermanentSkipReason(reason = "") {
  return [
    "realtime_query_too_long",
    "realtime_query_description",
    "realtime_query_not_concrete",
    "permanent_login_required",
    "permanent_blocked",
    "permanent_failed_retries",
  ].includes(String(reason ?? ""));
}

function resolveQueueStatusFromExisting(existing = {}, observedKeys, key) {
  if (observedKeys.has(key)) {
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
  if (Number(existing.failedCount ?? 0) >= MAX_BROWSER_OBSERVATION_FAILED_RETRIES) {
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

export function summarizeBrowserObservationQueue(queue = []) {
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

export function buildBrowserObservationQueue(snapshot = {}, options = {}) {
  const targets = Array.isArray(snapshot.realtimeResearchTargets) ? snapshot.realtimeResearchTargets : [];
  const observedKeys = collectObservedSocialSearchKeys(snapshot.socialSearchSignals ?? []);
  const existingById = new Map();
  for (const item of snapshot.browserObservationQueue ?? []) {
    const id = String(item?.id ?? "");
    if (id) existingById.set(id, item);
  }

  const queueById = new Map();

  for (const target of targets) {
    if (target.provider !== "yahoo_realtime") continue;
    const id = target.id ?? `realtime:yahoo:${target.productKey}`;
    const key = socialSearchSignalKey(target);
    const existing = existingById.get(id) ?? {};
    const prepared = prepareRealtimeObservationQuery({
      query: target.query ?? "",
      productName: target.productName ?? "",
    });

    let status = "pending";
    let reason = null;
    let skipReason = null;
    let observationQuery = prepared.query;
    let searchUrl = buildYahooRealtimeSearchUrl(observationQuery);
    let queryShortened = prepared.shortened;

    if (!prepared.ok) {
      status = "skipped";
      skipReason = prepared.skipReason;
      reason = "query_quality_skip";
      observationQuery = prepared.query;
      searchUrl = "";
      queryShortened = false;
    } else if (existing.id) {
      const resolved = resolveQueueStatusFromExisting(existing, observedKeys, key);
      status = resolved.status;
      reason = resolved.reason;
      skipReason = resolved.skipReason;
      if (prepared.ok) {
        observationQuery = prepared.query;
        searchUrl = buildYahooRealtimeSearchUrl(observationQuery);
        queryShortened = prepared.shortened;
      }
    } else if (observedKeys.has(key)) {
      status = "browser_observed";
      reason = "already_observed";
    }

    queueById.set(
      id,
      queueItemFromTarget(target, {
        status,
        reason,
        skipReason,
        originalQuery: prepared.originalQuery,
        observationQuery,
        searchUrl,
        queryShortened,
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
    .filter((item) => item.provider === "yahoo_realtime")
    .sort((a, b) => {
      const left = statusOrder[a.status] ?? 9;
      const right = statusOrder[b.status] ?? 9;
      if (left !== right) return left - right;
      return String(a.productName ?? "").localeCompare(String(b.productName ?? ""), "ja");
    });

  return { queue, summary: summarizeBrowserObservationQueue(queue) };
}

function hasStatusUrls(text = "") {
  return /https?:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{10,}/i.test(String(text));
}

function detectFetchFailure(body = "") {
  const text = String(body ?? "");
  if (!compactText(text)) {
    return { kind: "parse_failed", warnings: ["empty_response"] };
  }
  if (/captcha|robot|アクセスが集中|異常なアクセス|Access Denied|Forbidden/i.test(text)) {
    return { kind: "blocked", warnings: ["blocked_or_captcha"] };
  }
  if (/ログイン/.test(text) && !hasStatusUrls(text)) {
    return { kind: "login_required", warnings: ["login_required"] };
  }
  return null;
}

function parseResultCountApprox(text = "") {
  const matches = [...String(text).matchAll(RESULT_COUNT_RE)];
  let best = null;
  for (const match of matches) {
    const value = Number(String(match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (best == null || value > best) best = value;
  }
  return best;
}

function tokenizeQuery(query = "") {
  return compactText(query)
    .toLowerCase()
    .split(/[\s　・／/]+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length >= 2);
}

function sampleMatchesQuery(sampleText = "", query = "") {
  const text = compactText(sampleText).toLowerCase();
  const tokens = tokenizeQuery(query);
  if (!text || !tokens.length) return false;
  return tokens.some((token) => text.includes(token));
}

function isSkippableObservationLine(rawLine = "", cleanLine = "") {
  if (!cleanLine) return true;
  if (NOISE_LINE_RE.test(cleanLine)) return true;
  if (/^\*+\s*$/.test(cleanLine)) return true;
  if (/^\[\]\(https?:\/\//i.test(rawLine)) return true;
  if (/x\.com\/intent\//i.test(rawLine)) return true;
  if (/^\[!\[Image/i.test(rawLine)) return true;
  if (/^!\[Image/i.test(rawLine)) return true;
  if (/^https?:\/\//i.test(cleanLine) && cleanLine.length < 80) return true;
  return false;
}

function extractTweetBlocks(raw = "") {
  const rawLines = String(raw).split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const timeMatch = rawLine.match(STATUS_TIME_RE);
    if (!timeMatch) continue;
    const postedAt = compactText(timeMatch[1]);
    const sourceUrl = compactText(timeMatch[2]).replace(/^http:/i, "https://");

    let accountHandle = null;
    let text = "";
    for (let back = index - 1; back >= Math.max(0, index - 20); back -= 1) {
      const prevRaw = rawLines[back];
      const prev = compactText(stripMarkdownNoise(prevRaw));
      if (isSkippableObservationLine(prevRaw, prev)) continue;

      const handleMatch = prevRaw.match(HANDLE_RE) ?? prev.match(/@([A-Za-z0-9_]+)/);
      if (handleMatch && !accountHandle) {
        accountHandle = handleMatch[1];
        continue;
      }

      if (
        !text &&
        prev.length >= 12 &&
        !HANDLE_RE.test(prevRaw) &&
        !FORBIDDEN_BUZZ_RE.test(prev) &&
        !/^\*+\s/.test(prevRaw)
      ) {
        text = prev;
      }
      if (text && accountHandle) break;
    }

    text = sanitizeSocialSearchSampleText(text.replace(/_([^_]+)_/g, "$1"));
    if (text.length < 12 || FORBIDDEN_BUZZ_RE.test(text)) continue;
    blocks.push({
      text: text.slice(0, 280),
      postedAt: postedAt || null,
      accountHandle,
      sourceUrl,
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const block of blocks) {
    const key = `${block.sourceUrl ?? ""}::${block.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(block);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

export function parseYahooRealtimeMarkdown(raw = "", query = "") {
  const warnings = [];
  const failure = detectFetchFailure(raw);
  if (failure) {
    return {
      observationStatus: failure.kind,
      resultCountApprox: null,
      samples: [],
      sampleTexts: [],
      parseWarnings: failure.warnings,
      confidence: failure.kind === "blocked" || failure.kind === "login_required" ? 0.1 : 0.2,
    };
  }

  const samples = extractTweetBlocks(raw);
  const resultCountApprox = parseResultCountApprox(raw);
  if (!samples.length) {
    const statusUrlsPresent = hasStatusUrls(String(raw));
    return {
      observationStatus: statusUrlsPresent ? "parse_failed" : "no_results",
      resultCountApprox,
      samples: [],
      sampleTexts: [],
      parseWarnings: statusUrlsPresent ? ["samples_missing"] : ["no_status_urls"],
      confidence: resultCountApprox ? 0.35 : 0.2,
    };
  }

  const confidence = computeSocialSearchConfidence({
    query,
    resultCountApprox,
    samples,
    observationStatus: "succeeded",
    parseWarnings: warnings,
  });

  return {
    observationStatus: "succeeded",
    resultCountApprox,
    samples,
    sampleTexts: samples.map((sample) => sample.text),
    parseWarnings: warnings,
    confidence,
  };
}

export function computeSocialSearchConfidence({
  query = "",
  resultCountApprox = null,
  samples = [],
  observationStatus = "succeeded",
  parseWarnings = [],
} = {}) {
  let confidence = 0.35;
  if (Number.isFinite(Number(resultCountApprox)) && Number(resultCountApprox) > 0) confidence += 0.15;
  if (samples.length >= 2) confidence += 0.15;
  if (samples.some((sample) => sampleMatchesQuery(sample.text, query))) confidence += 0.15;
  if (samples.some((sample) => compactText(sample.postedAt))) confidence += 0.1;
  if (observationStatus === "blocked" || observationStatus === "login_required") confidence -= 0.25;
  if (observationStatus === "parse_failed" || observationStatus === "timeout") confidence -= 0.15;
  if (parseWarnings.includes("blocked_or_captcha") || parseWarnings.includes("login_required")) confidence -= 0.2;
  return Math.min(1, Math.max(0, Number(confidence.toFixed(3))));
}

async function fetchYahooRealtimeSearch(searchUrl, timeoutMs = 15000) {
  const readerUrl = searchUrl.startsWith(JINA_READER_PREFIX) ? searchUrl : buildJinaReaderUrl(searchUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(readerUrl, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
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

function mergeSocialSearchSignals(existing = [], incoming = []) {
  const byKey = new Map();
  for (const row of existing) {
    const key = socialSearchSignalKey(row);
    if (key) byKey.set(key, row);
  }
  for (const row of incoming) {
    const key = socialSearchSignalKey(row);
    if (key) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function applyQueueStatusesToTargets(targets = [], queue = []) {
  const byId = new Map(queue.map((item) => [item.id, item]));
  return targets.map((target) => {
    const item = byId.get(target.id);
    if (!item) return { ...target, status: target.status ?? "stale" };
    const effectiveQuery = item.observationQuery || item.query;
    return {
      ...target,
      query: item.query ?? target.query,
      originalQuery: item.originalQuery ?? target.originalQuery ?? target.query,
      observationQuery: effectiveQuery,
      searchUrl: item.searchUrl ?? target.searchUrl,
      status: item.status,
      skipReason: item.skipReason ?? null,
      failedCount: item.failedCount ?? 0,
      lastError: item.lastError ?? null,
      lastAttemptAt: item.lastAttemptAt ?? null,
      queryShortened: Boolean(item.queryShortened),
    };
  });
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
  if (queueItem.failedCount >= MAX_BROWSER_OBSERVATION_FAILED_RETRIES) {
    queueItem.status = "skipped";
    queueItem.skipReason = "permanent_failed_retries";
    queueItem.reason = "retry_exhausted";
    return "skipped";
  }
  queueItem.status = "failed";
  queueItem.reason = "retryable_failed";
  return "failed";
}

function buildSocialSearchSignalFromObservation(target = {}, parsed = {}, observedAt = "") {
  const effectiveQuery = target.observationQuery || target.query || "";
  const samples = (parsed.samples ?? [])
    .map((sample) => ({
      text: sanitizeSocialSearchSampleText(sample.text),
      postedAt: sample.postedAt ?? null,
      accountHandle: sample.accountHandle ?? null,
      sourceUrl: sample.sourceUrl ?? null,
    }))
    .filter((sample) => sample.text.length >= 12);
  return {
    provider: "yahoo_realtime",
    query: effectiveQuery,
    searchUrl: target.searchUrl ?? buildYahooRealtimeSearchUrl(effectiveQuery),
    productKey: target.productKey ?? "",
    productName: target.productName ?? "",
    observedAt,
    sourceMode: "browser_observed",
    resultCountApprox: parsed.resultCountApprox ?? null,
    samples,
    sampleTexts: samples.map((sample) => sample.text),
    confidence: parsed.confidence ?? 0,
    parseWarnings: parsed.parseWarnings ?? [],
    observationStatus: parsed.observationStatus ?? "parse_failed",
    buzzEligible: false,
  };
}

export async function collectBrowserObservationSignals({
  snapshot = {},
  enabled = true,
  limit = resolveBrowserObservationBatchLimit(),
  timeoutMs = 15000,
  env = process.env,
} = {}) {
  const normalizedLimit = Math.max(
    0,
    Math.min(LIMITS.BROWSER_OBSERVATION_BATCH_HARD_MAX, Number(limit ?? resolveBrowserObservationBatchLimit(env))),
  );
  const normalizedTimeout = Math.max(3000, Math.min(60000, Number(timeoutMs ?? 15000)));
  const existingSignals = Array.isArray(snapshot.socialSearchSignals) ? snapshot.socialSearchSignals : [];

  const { queue: initialQueue, summary: initialSummary } = buildBrowserObservationQueue(snapshot);
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
    browserObservationQueueTotal: initialSummary.total,
    browserObservationQueuePending: initialSummary.pending,
    browserObservationQueueObserved: initialSummary.browser_observed,
    browserObservationQueueFailed: initialSummary.failed,
    browserObservationQueueSkipped: initialSummary.skipped,
    browserObservationQueueStale: initialSummary.stale,
  };

  const incomingSignals = [];
  const observedAt = new Date().toISOString();

  if (enabled && normalizedLimit > 0) {
    const pendingTargets = initialQueue
      .filter((item) => item.status === "pending" && item.searchUrl && item.observationQuery)
      .slice(0, normalizedLimit);
    execution.requested = pendingTargets.length;

    for (const target of pendingTargets) {
      const queueItem = queueById.get(target.id) ?? target;
      queueItem.lastAttemptAt = observedAt;
      const searchUrl = target.searchUrl || buildYahooRealtimeSearchUrl(target.observationQuery || target.query);
      const fetched = await fetchYahooRealtimeSearch(searchUrl, normalizedTimeout);

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

      const parsed = parseYahooRealtimeMarkdown(fetched.body, target.observationQuery || target.query);
      const observationStatus = parsed.observationStatus ?? "parse_failed";
      execution.byStatus[observationStatus] = (execution.byStatus[observationStatus] ?? 0) + 1;

      if (observationStatus === "succeeded") {
        execution.succeeded += 1;
        queueItem.status = "browser_observed";
        queueItem.lastError = null;
        queueItem.skipReason = null;
        incomingSignals.push(buildSocialSearchSignalFromObservation(target, parsed, observedAt));
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
    const key = socialSearchSignalKey(row);
    const queueItem = [...queueById.values()].find((item) => socialSearchSignalKey(item) === key);
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
  const queueSummary = summarizeBrowserObservationQueue(updatedQueue);
  execution.browserObservationQueueTotal = queueSummary.total;
  execution.browserObservationQueuePending = queueSummary.pending;
  execution.browserObservationQueueObserved = queueSummary.browser_observed;
  execution.browserObservationQueueFailed = queueSummary.failed;
  execution.browserObservationQueueSkipped = queueSummary.skipped;
  execution.browserObservationQueueStale = queueSummary.stale;
  execution.skipped = queueSummary.skipped;
  execution.skippedByReason = queueSummary.skippedByReason;

  const socialSearchSignals = mergeSocialSearchSignals(existingSignals, incomingSignals);
  const realtimeResearchTargets = applyQueueStatusesToTargets(snapshot.realtimeResearchTargets ?? [], updatedQueue);

  return {
    socialSearchSignals,
    realtimeResearchTargets,
    browserObservationQueue: updatedQueue,
    queueSummary,
    execution,
  };
}