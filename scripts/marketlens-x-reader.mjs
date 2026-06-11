import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { LIMITS, resolveXQueueLimit, resolveXReaderLimit } from "./marketlens-limits.mjs";

const STATUS_URL_RE = /https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d{10,}/gi;
const JINA_READER_PREFIX = "https://r.jina.ai/";
const DEFAULT_SCAN_MAX_BYTES = 64 * 1024 * 1024;
const QUEUE_SCAN_MAX_BYTES = Number.POSITIVE_INFINITY;

const NOISE_LINE_RE =
  /^(?:Don.t miss|People on X|Log in|Sign up|See new posts|Show translation|Show more|Read \d+ replies|New to X\?|Trending now|What.s happening|Terms of Service|Privacy Policy|Cookie Policy|Accessibility|Ads info|More|© \d{4}|Something went wrong|Try reloading|Retry|Published Time:|URL Source:|Markdown Content:|Title:)/i;

export function normalizeStatusUrl(url = "") {
  return String(url)
    .trim()
    .replace(/^http:/i, "https:")
    .replace(/twitter\.com/i, "x.com");
}

export function buildJinaReaderUrl(postUrl = "") {
  const normalized = normalizeStatusUrl(postUrl);
  return `${JINA_READER_PREFIX}${normalized}`;
}

export function parseEngagementCountToken(token = "") {
  const cleaned = String(token ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/ Views?$/i, "");
  const match = cleaned.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;
  let value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = String(match[2] ?? "").toUpperCase();
  if (suffix === "K") value *= 1000;
  else if (suffix === "M") value *= 1_000_000;
  else if (suffix === "B") value *= 1_000_000_000;
  return Math.round(value);
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripMarkdownNoise(line = "") {
  return line
    .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[#>*]/g, "")
    .trim();
}

export function parseJinaMarkdown(raw = "", postUrl = "") {
  const warnings = [];
  const text = String(raw ?? "");
  if (!text.trim()) {
    return {
      text: "",
      postedAt: null,
      authorHandle: null,
      engagement: {
        replyCount: null,
        repostCount: null,
        likeCount: null,
        bookmarkCount: null,
        viewCount: null,
        parseConfidence: 0,
      },
      parseWarnings: ["empty_response"],
    };
  }

  if (/Something went wrong/i.test(text) && text.length < 1200) {
    warnings.push("partial_error_ui");
  }
  if (/Don.t miss what.s happening/i.test(text)) {
    warnings.push("login_chrome_present");
  }

  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  const conversationIdx = text.indexOf("# Conversation");
  const bodyRegion = conversationIdx >= 0 ? text.slice(conversationIdx) : text;

  let authorHandle = null;
  const handleMatch = bodyRegion.match(/\[@([A-Za-z0-9_]+)\]\(https?:\/\/(?:x|twitter)\.com\/[^)]+\)/i);
  if (handleMatch) authorHandle = `@${handleMatch[1]}`;

  let postedAt = null;
  const postedAtMatch =
    bodyRegion.match(/\[(\d{1,2}:\d{2}\s*[AP]M\s*·\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})\]/i) ??
    bodyRegion.match(/(\d{1,2}:\d{2}\s*[AP]M\s*·\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  if (postedAtMatch) postedAt = compactText(postedAtMatch[1]);

  let body = "";
  const showTranslationIdx = bodyRegion.indexOf("Show translation");
  if (showTranslationIdx >= 0) {
    const after = bodyRegion.slice(showTranslationIdx + "Show translation".length);
    const lines = after.split("\n").map((line) => stripMarkdownNoise(line.trim())).filter(Boolean);
    const chunks = [];
    for (const line of lines) {
      if (NOISE_LINE_RE.test(line)) continue;
      if (/^·$/.test(line)) continue;
      if (/^!\[/.test(line) || /^\d{1,2}:\d{2}\s*[AP]M\s*·/.test(line)) break;
      if (/^[\d.,]+[KMB]?\s*Views?$/i.test(line)) break;
      if (/^\d+$/.test(line) && chunks.length > 0) break;
      if (line.length < 2) continue;
      chunks.push(line);
      if (chunks.join(" ").length > 120) break;
    }
    body = compactText(chunks.join(" "));
  }

  if (!body && titleMatch) {
    const title = titleMatch[1];
    const quoted = title.match(/ on X:\s*"(.+)"\s*\/\s*X$/i);
    if (quoted) body = compactText(quoted[1]);
  }

  if (body.length < 20) warnings.push("body_short_or_missing");

  const engagement = {
    replyCount: null,
    repostCount: null,
    likeCount: null,
    bookmarkCount: null,
    viewCount: null,
    parseConfidence: 0,
  };

  const viewsMatch =
    bodyRegion.match(/\[([\d.,]+[KMB]?)\s*Views?\]/i) ?? bodyRegion.match(/([\d.,]+[KMB]?)\s*Views?/i);
  if (viewsMatch) engagement.viewCount = parseEngagementCountToken(viewsMatch[1]);

  const viewsIdx = bodyRegion.search(/[\d.,]+[KMB]?\s*Views?/i);
  if (viewsIdx >= 0) {
    const tail = bodyRegion.slice(viewsIdx).split("\n").map((line) => line.trim()).filter(Boolean);
    const numericLines = [];
    for (const line of tail.slice(0, 12)) {
      if (/^Read \d+ replies/i.test(line)) break;
      if (/^## /.test(line)) break;
      if (/^·$/.test(line)) continue;
      if (/^[\d.,]+[KMB]?$/.test(line)) numericLines.push(line);
      if (numericLines.length >= 4) break;
    }
    if (numericLines.length >= 3) {
      engagement.replyCount = parseEngagementCountToken(numericLines[0]);
      engagement.repostCount = parseEngagementCountToken(numericLines[1]);
      engagement.likeCount = parseEngagementCountToken(numericLines[2]);
      if (numericLines[3]) engagement.bookmarkCount = parseEngagementCountToken(numericLines[3]);
    } else if (numericLines.length > 0) {
      warnings.push("engagement_partial");
    }
  } else {
    warnings.push("engagement_missing");
  }

  let confidence = 0;
  if (body.length >= 20) confidence += 0.35;
  if (postedAt) confidence += 0.15;
  if (authorHandle) confidence += 0.1;
  if (Number.isFinite(engagement.viewCount) && engagement.viewCount > 0) confidence += 0.15;
  const metricCount = [engagement.replyCount, engagement.repostCount, engagement.likeCount, engagement.bookmarkCount].filter(
    (value) => Number.isFinite(value) && value > 0,
  ).length;
  if (metricCount >= 3) confidence += 0.25;
  else if (metricCount >= 1) confidence += 0.1;
  engagement.parseConfidence = Math.min(1, Number(confidence.toFixed(2)));

  if (!postUrl) warnings.push("missing_post_url");

  return {
    text: body,
    postedAt,
    authorHandle,
    engagement,
    parseWarnings: warnings,
  };
}

export const X_OBSERVATION_QUEUE_DEFAULT_MAX = LIMITS.X_QUEUE_DEFAULT;
export const X_READER_BATCH_LIMIT_DEFAULT = LIMITS.X_READER_DEFAULT;
export const X_READER_BATCH_LIMIT_MAX = LIMITS.X_READER_HARD_MAX;
export const X_OBSERVATION_QUEUE_STATUSES = ["pending", "reader_observed", "failed", "skipped", "stale"];

function isStatusPostUrl(url = "") {
  return /https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d{10,}/i.test(String(url));
}

export function summarizeXObservationQueue(queue = []) {
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

export function collectObservedPostUrls(snapshot = {}) {
  const urls = new Set();
  for (const row of snapshot.socialSignals ?? []) {
    const postUrl = normalizeStatusUrl(row?.postUrl ?? "");
    if (postUrl && isStatusPostUrl(postUrl)) urls.add(postUrl);
  }
  return urls;
}

function queueItemFromExisting(item = {}, postUrl = "") {
  return {
    postUrl,
    source: item.source ?? "existing_queue",
    firstSeenAt: item.firstSeenAt ?? new Date().toISOString(),
    priority: Number(item.priority ?? 0),
    reason: item.reason ?? "existing_queue",
    status: item.status ?? "pending",
    lastError: item.lastError ?? null,
    lastAttemptAt: item.lastAttemptAt ?? null,
  };
}

export async function buildXObservationQueue(rawArchiveDirUrl, snapshot = {}, options = {}) {
  const maxQueueSize = Math.max(
    50,
    Math.min(
      LIMITS.X_QUEUE_HARD_MAX,
      Number(options.maxQueueSize ?? resolveXQueueLimit(options.env ?? process.env)),
    ),
  );
  const maxScanBytes = Math.max(
    1024 * 1024,
    Number.isFinite(Number(options.maxScanBytes)) ? Number(options.maxScanBytes) : QUEUE_SCAN_MAX_BYTES,
  );
  const observedUrls = collectObservedPostUrls(snapshot);
  const existingByUrl = new Map();
  for (const item of snapshot.xObservationQueue ?? []) {
    const postUrl = normalizeStatusUrl(item?.postUrl ?? "");
    if (postUrl && isStatusPostUrl(postUrl)) existingByUrl.set(postUrl, item);
  }

  const queueByUrl = new Map();
  const upsertEntry = (postUrl, meta = {}) => {
    const normalized = normalizeStatusUrl(postUrl);
    if (!normalized || !isStatusPostUrl(normalized)) return false;
    if (observedUrls.has(normalized)) {
      if (!queueByUrl.has(normalized)) {
        const existing = existingByUrl.get(normalized);
        queueByUrl.set(
          normalized,
          queueItemFromExisting(
            {
              ...existing,
              source: existing?.source ?? meta.source ?? "social_signals",
              firstSeenAt: existing?.firstSeenAt ?? meta.firstSeenAt,
              priority: existing?.priority ?? meta.priority ?? 1,
              reason: existing?.reason ?? "already_observed",
              status: "reader_observed",
            },
            normalized,
          ),
        );
      }
      return false;
    }
    if (queueByUrl.has(normalized)) return false;
    const existing = existingByUrl.get(normalized);
    queueByUrl.set(
      normalized,
      queueItemFromExisting(
        {
          ...existing,
          source: meta.source ?? existing?.source ?? "raw_archive",
          firstSeenAt: meta.firstSeenAt ?? existing?.firstSeenAt ?? new Date().toISOString(),
          priority: meta.priority ?? existing?.priority ?? 0,
          reason: meta.reason ?? existing?.reason ?? "raw_archive_status_url",
          status:
            existing?.status === "reader_observed" ||
            existing?.status === "failed" ||
            existing?.status === "skipped" ||
            existing?.status === "stale"
              ? existing.status === "stale"
                ? "pending"
                : existing.status
              : "pending",
        },
        normalized,
      ),
    );
    return queueByUrl.size >= maxQueueSize;
  };

  const snapshotBlob = JSON.stringify(snapshot);
  for (const match of snapshotBlob.matchAll(STATUS_URL_RE)) {
    if (
      upsertEntry(match[0], {
        source: "snapshot",
        priority: 10,
        reason: "snapshot_reference",
        firstSeenAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
      })
    ) {
      break;
    }
  }

  let files = [];
  try {
    files = (await readdir(rawArchiveDirUrl)).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    files = [];
  }

  const archiveSeenAt = new Date().toISOString();
  for (const fileName of files) {
    if (queueByUrl.size >= maxQueueSize) break;
    const fileUrl = new URL(`./${fileName}`, rawArchiveDirUrl);
    let bytesRead = 0;
    const stream = createReadStream(fileUrl, { encoding: "utf8", highWaterMark: 64 * 1024 });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        bytesRead += Buffer.byteLength(line, "utf8");
        for (const match of line.matchAll(STATUS_URL_RE)) {
          if (
            upsertEntry(match[0], {
              source: fileName,
              priority: 0,
              reason: "raw_archive",
              firstSeenAt: archiveSeenAt,
            })
          ) {
            break;
          }
        }
        if (queueByUrl.size >= maxQueueSize || bytesRead >= maxScanBytes) break;
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  for (const [url, item] of existingByUrl) {
    if (queueByUrl.has(url)) continue;
    const preservedStatus =
      item.status === "reader_observed" || item.status === "failed" || item.status === "skipped"
        ? item.status
        : "stale";
    queueByUrl.set(
      url,
      queueItemFromExisting(
        {
          ...item,
          status: preservedStatus,
          reason: preservedStatus === "stale" ? item.reason ?? "archive_no_longer_present" : item.reason,
        },
        url,
      ),
    );
  }

  const statusOrder = { pending: 0, failed: 1, skipped: 2, reader_observed: 3 };
  const queue = [...queueByUrl.values()]
    .sort((a, b) => {
      const left = statusOrder[a.status] ?? 9;
      const right = statusOrder[b.status] ?? 9;
      if (left !== right) return left - right;
      return (b.priority ?? 0) - (a.priority ?? 0);
    })
    .slice(0, maxQueueSize);

  return { queue, summary: summarizeXObservationQueue(queue) };
}

export async function collectStatusUrlCandidates(rawArchiveDirUrl, snapshot = {}, options = {}) {
  const maxCandidates = Math.max(1, Number(options.maxCandidates ?? 50));
  const { queue } = await buildXObservationQueue(rawArchiveDirUrl, snapshot, {
    maxQueueSize: maxCandidates,
    maxScanBytes: options.maxScanBytes ?? DEFAULT_SCAN_MAX_BYTES,
  });
  const candidates = queue.map((item) => item.postUrl);
  return {
    candidates,
    uniqueCount: candidates.length,
  };
}

async function fetchJinaReader(postUrl, timeoutMs = 15000) {
  const readerUrl = buildJinaReaderUrl(postUrl);
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

export function summarizeXReaderSignals(socialSignals = []) {
  let observedText = 0;
  let engagementParsed = 0;
  let parseWarnings = 0;
  for (const row of socialSignals) {
    if (row?.sourceMode !== "reader_observed") continue;
    if (compactText(row.text).length >= 20) observedText += 1;
    if (Number(row.engagement?.parseConfidence ?? 0) >= 0.7) engagementParsed += 1;
    if (Array.isArray(row.parseWarnings) && row.parseWarnings.length > 0) parseWarnings += row.parseWarnings.length;
  }
  return { observedText, engagementParsed, parseWarnings };
}

function mergeSocialSignalsByPostUrl(existing = [], incoming = []) {
  const byUrl = new Map();
  for (const row of existing) {
    const postUrl = normalizeStatusUrl(row?.postUrl ?? "");
    if (postUrl) byUrl.set(postUrl, row);
  }
  for (const row of incoming) {
    const postUrl = normalizeStatusUrl(row?.postUrl ?? "");
    if (postUrl) byUrl.set(postUrl, row);
  }
  return [...byUrl.values()];
}

export async function collectXReaderSocialSignals({
  rawArchiveDirUrl,
  snapshot = {},
  enabled = false,
  limit = X_READER_BATCH_LIMIT_DEFAULT,
  timeoutMs = 15000,
  scanMaxBytes = DEFAULT_SCAN_MAX_BYTES,
  maxQueueSize = resolveXQueueLimit(),
  env = process.env,
} = {}) {
  const normalizedLimit = Math.max(
    0,
    Math.min(X_READER_BATCH_LIMIT_MAX, Number(limit ?? resolveXReaderLimit(env))),
  );
  const normalizedTimeout = Math.max(3000, Math.min(60000, Number(timeoutMs ?? 15000)));
  const existingSignals = Array.isArray(snapshot.socialSignals) ? snapshot.socialSignals : [];

  const { queue, summary: initialSummary } = await buildXObservationQueue(rawArchiveDirUrl, snapshot, {
    maxQueueSize,
    maxScanBytes: scanMaxBytes,
  });
  const queueByUrl = new Map(queue.map((item) => [item.postUrl, { ...item }]));

  const execution = {
    enabled: Boolean(enabled),
    limit: normalizedLimit,
    timeoutMs: normalizedTimeout,
    xStatusUrlCandidates: initialSummary.total,
    xObservationQueueTotal: initialSummary.total,
    xObservationQueuePending: initialSummary.pending,
    xObservationQueueObserved: initialSummary.reader_observed,
    xObservationQueueFailed: initialSummary.failed,
    xObservationQueueSkipped: initialSummary.skipped,
    xObservationQueueStale: initialSummary.stale,
    requested: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    xReaderObservedText: 0,
    xReaderEngagementParsed: 0,
    xReaderParseWarnings: 0,
    xBuzzEligible: 0,
  };

  const incomingSignals = [];
  const observedAt = new Date().toISOString();

  if (enabled && normalizedLimit > 0) {
    const pendingTargets = queue.filter((item) => item.status === "pending").slice(0, normalizedLimit);
    execution.requested = pendingTargets.length;

    for (const target of pendingTargets) {
      const queueItem = queueByUrl.get(target.postUrl) ?? target;
      const fetched = await fetchJinaReader(target.postUrl, normalizedTimeout);
      queueItem.lastAttemptAt = observedAt;
      if (!fetched.ok || !compactText(fetched.body)) {
        execution.failed += 1;
        queueItem.status = "failed";
        queueItem.lastError = fetched.error ?? (fetched.ok ? "empty_response" : `http_${fetched.status}`);
        continue;
      }

      const parsed = parseJinaMarkdown(fetched.body, target.postUrl);
      if (compactText(parsed.text).length < 20) {
        execution.failed += 1;
        queueItem.status = "failed";
        queueItem.lastError = "body_short_or_missing";
        continue;
      }

      execution.succeeded += 1;
      queueItem.status = "reader_observed";
      queueItem.lastError = null;
      incomingSignals.push({
        source: "x",
        postUrl: normalizeStatusUrl(target.postUrl),
        readerUrl: fetched.readerUrl,
        sourceMode: "reader_observed",
        text: parsed.text,
        postedAt: parsed.postedAt,
        authorHandle: parsed.authorHandle,
        engagement: parsed.engagement,
        observedAt,
        parseWarnings: parsed.parseWarnings,
        fetchStatus: fetched.status,
      });
    }
  }

  for (const row of existingSignals) {
    const postUrl = normalizeStatusUrl(row?.postUrl ?? "");
    if (!postUrl) continue;
    const queueItem = queueByUrl.get(postUrl);
    if (!queueItem || queueItem.status !== "pending") continue;
    queueItem.status = "reader_observed";
    queueItem.reason = "already_observed";
    execution.skipped += 1;
  }

  const updatedQueue = [...queueByUrl.values()].sort((a, b) => {
    const statusOrder = { pending: 0, failed: 1, skipped: 2, reader_observed: 3 };
    const left = statusOrder[a.status] ?? 9;
    const right = statusOrder[b.status] ?? 9;
    if (left !== right) return left - right;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });
  const queueSummary = summarizeXObservationQueue(updatedQueue);
  execution.xObservationQueueTotal = queueSummary.total;
  execution.xObservationQueuePending = queueSummary.pending;
  execution.xObservationQueueObserved = queueSummary.reader_observed;
  execution.xObservationQueueFailed = queueSummary.failed;
  execution.xObservationQueueSkipped = queueSummary.skipped + execution.skipped;
  execution.xObservationQueueStale = queueSummary.stale;
  execution.xStatusUrlCandidates = queueSummary.total;

  const socialSignals = mergeSocialSignalsByPostUrl(existingSignals, incomingSignals);
  const summary = summarizeXReaderSignals(socialSignals);
  execution.xReaderObservedText = summary.observedText;
  execution.xReaderEngagementParsed = summary.engagementParsed;
  execution.xReaderParseWarnings = summary.parseWarnings;

  return { socialSignals, execution, queue: updatedQueue, queueSummary };
}