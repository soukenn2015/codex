/**
 * trusted-curator-sync.mjs — Phase 0: 信頼キュレーター言及を snapshot に統合
 */

import { readFile, writeFile } from "node:fs/promises";
import { buildYahooRealtimeSearchUrl } from "./marketlens-observation.mjs";
import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";
import { parseYahooRealtimeMarkdown } from "./marketlens-yahoo-realtime-reader.mjs";
import {
  compactText,
  groupLookupKeys,
  normalizeProductKey,
} from "./marketlens-shared.mjs";
import {
  computeCuratorTrustLevel,
  looksLikeCuratorNoiseName,
  mergeCuratorTrust,
  nameOverlapScore,
  parseCuratorSample,
} from "./curator-parse.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const curatorConfigUrl = new URL("../data/trusted-curator-accounts.json", import.meta.url);
const TIMEOUT_MS = Math.max(5000, Math.min(30000, Number(process.env.MARKETLENS_CURATOR_TIMEOUT_MS ?? 15000)));
const SKIP_FETCH = process.env.MARKETLENS_SKIP_CURATOR_FETCH === "1";
const MATCH_THRESHOLD = Number(process.env.MARKETLENS_CURATOR_MATCH_THRESHOLD ?? 0.55);

async function fetchCuratorQuery(query) {
  const searchUrl = buildYahooRealtimeSearchUrl(query);
  const readerUrl = buildJinaReaderUrl(searchUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(readerUrl, {
      headers: { Accept: "text/plain", "X-Return-Format": "markdown" },
      signal: controller.signal,
    });
    return { ok: res.ok, body: await res.text() };
  } catch {
    return { ok: false, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

function mentionKey(mention = {}) {
  return [mention.handle, mention.productKey, mention.postUrl ?? ""].join("::");
}

function collectSnapshotCuratorSamples(snapshot = {}, curatorHandles = new Set()) {
  const samples = [];
  for (const signal of snapshot.socialSearchSignals ?? []) {
    for (const sample of signal.samples ?? []) {
      const handle = compactText(sample.accountHandle ?? "").replace(/^@/, "").toLowerCase();
      if (!handle || !curatorHandles.has(handle)) continue;
      samples.push({ ...sample, accountHandle: handle, source: "snapshot_buzz" });
    }
  }
  for (const doc of snapshot.documents ?? []) {
    const url = compactText(doc.url ?? "");
    const title = compactText(doc.title ?? "");
    for (const handle of curatorHandles) {
      if (!url.includes(handle) && !title.toLowerCase().includes(handle)) continue;
      if (title.length < 12) continue;
      samples.push({
        text: title,
        accountHandle: handle,
        sourceUrl: url,
        postedAt: doc.observedAt ?? doc.publishedAt ?? null,
        source: "snapshot_document",
      });
    }
  }
  return samples;
}

function buildGroupIndex(productGroups = [], curatorHandles = []) {
  const index = [];
  for (const group of productGroups) {
    const name = compactText(group.canonicalName ?? "");
    if (!name || looksLikeCuratorNoiseName(name, curatorHandles)) continue;
    index.push({
      group,
      keys: groupLookupKeys(group),
      names: [
        name,
        ...(group.members ?? []).map((member) => member.name).filter(Boolean),
      ],
    });
  }
  return index;
}

function matchMentionToGroup(mention = {}, groupIndex = []) {
  let best = null;
  let bestScore = 0;
  for (const entry of groupIndex) {
    for (const name of entry.names) {
      const score = nameOverlapScore(mention.productName, name);
      if (score > bestScore) {
        bestScore = score;
        best = entry.group;
      }
    }
  }
  if (!best || bestScore < MATCH_THRESHOLD) return { group: null, matchScore: bestScore };
  return { group: best, matchScore: Number(bestScore.toFixed(3)) };
}

function upsertDiscoveryCandidate(snapshot, mention = {}) {
  const key = normalizeProductKey(mention.productName);
  if (!key) return false;
  const existing = (snapshot.discoveryCandidates ?? []).find(
    (row) => normalizeProductKey(row.name) === key,
  );
  if (existing) {
    existing.curatorPromotion = true;
    existing.curatorHandle = mention.handle;
    existing.curatorPostUrl = mention.postUrl ?? existing.curatorPostUrl ?? null;
    existing.stage = existing.stage ?? "キュレーター昇格候補";
    return false;
  }
  snapshot.discoveryCandidates.push({
    name: mention.productName,
    stage: "キュレーター昇格候補",
    stageKind: "curator_promotion",
    reason: `@${mention.handle} が言及。自社 productGroup 未整備のため昇格候補。`,
    sourceUrl: mention.postUrl ?? null,
    evidenceUrl: mention.postUrl ?? null,
    curatorPromotion: true,
    curatorHandle: mention.handle,
    curatorPostUrl: mention.postUrl ?? null,
    confidence: "中",
    category: "curator",
    sourceChannel: "curator",
    sourceReliability: "high",
    firstSeenAt: new Date().toISOString(),
  });
  return true;
}

export function syncTrustedCurators(snapshot = {}, config = {}, { skipFetch = SKIP_FETCH } = {}) {
  const curators = config.curators ?? [];
  const curatorHandles = new Set(curators.map((row) => compactText(row.handle).replace(/^@/, "").toLowerCase()).filter(Boolean));
  const mentionMap = new Map();
  const fetchResults = [];

  const ingestSample = (sample, curator) => {
    for (const mention of parseCuratorSample(sample, curator)) {
      if (looksLikeCuratorNoiseName(mention.productName, [...curatorHandles])) continue;
      const key = mentionKey(mention);
      if (!mentionMap.has(key)) mentionMap.set(key, mention);
    }
  };

  for (const sample of collectSnapshotCuratorSamples(snapshot, curatorHandles)) {
    const curator = curators.find((row) => row.handle === sample.accountHandle) ?? { handle: sample.accountHandle };
    ingestSample(sample, curator);
  }

  if (!skipFetch) {
    for (const curator of curators) {
      const handle = compactText(curator.handle).replace(/^@/, "");
      const query = compactText(curator.searchQuery ?? `from:${handle}`);
      const fetched = fetchCuratorQuery(query);
      fetchResults.push({ handle, query, promise: fetched });
    }
  }

  return {
    curators,
    curatorHandles,
    mentionMap,
    fetchResults,
    ingestSample,
  };
}

export async function applyTrustedCuratorSync(snapshot = {}, config = {}, options = {}) {
  const { curators, curatorHandles, mentionMap, fetchResults, ingestSample } = syncTrustedCurators(
    snapshot,
    config,
    options,
  );

  if (!options.skipFetch) {
    for (const row of fetchResults) {
      const fetched = await row.promise;
      const curator = curators.find((item) => item.handle === row.handle) ?? { handle: row.handle };
      if (!fetched.ok) {
        row.status = "fetch_failed";
        continue;
      }
      const parsed = parseYahooRealtimeMarkdown(fetched.body, row.query);
      row.status = parsed.observationStatus;
      row.sampleCount = parsed.samples?.length ?? 0;
      for (const sample of parsed.samples ?? []) {
        if (compactText(sample.accountHandle ?? "").replace(/^@/, "").toLowerCase() !== row.handle) continue;
        ingestSample({ ...sample, source: "live_fetch" }, curator);
      }
    }
  }

  const groupIndex = buildGroupIndex(snapshot.productGroups ?? [], [...curatorHandles]);
  const curatorMentions = [];
  let matchedCount = 0;
  let promotedCount = 0;
  const trustCounts = { A: 0, B: 0, C: 0 };

  for (const group of snapshot.productGroups ?? []) {
    delete group.curatorTrust;
  }

  for (const mention of mentionMap.values()) {
    const { group, matchScore } = matchMentionToGroup(mention, groupIndex);
    mention.matchScore = matchScore;
    if (group) {
      const level = computeCuratorTrustLevel(mention, group);
      mention.productGroupKey = group.groupKey ?? group.productKey ?? normalizeProductKey(group.canonicalName);
      trustCounts[level] = (trustCounts[level] ?? 0) + 1;
      matchedCount += 1;
      group.curatorTrust = mergeCuratorTrust(group.curatorTrust, {
        level,
        handles: [mention.handle],
        postedAt: mention.postedAt,
        postUrl: mention.postUrl,
        matchScore,
      });
    } else {
      promotedCount += upsertDiscoveryCandidate(snapshot, mention) ? 1 : 0;
    }
    curatorMentions.push(mention);
  }

  snapshot.curatorMentions = curatorMentions.sort((left, right) => {
    const score = (row) => (row.productGroupKey ? 1 : 0) + Number(row.matchScore ?? 0);
    return score(right) - score(left);
  });
  snapshot.trustedCuratorSync = {
    observedAt: new Date().toISOString(),
    curatorCount: curators.length,
    mentionCount: curatorMentions.length,
    matchedCount,
    promotedCount,
    trustCounts,
    skipFetch: Boolean(options.skipFetch),
    fetchResults: fetchResults.map((row) => ({
      handle: row.handle,
      status: row.status ?? "skipped",
      sampleCount: row.sampleCount ?? 0,
    })),
  };

  return snapshot;
}

async function main() {
  const [snapshotRaw, configRaw] = await Promise.all([
    readFile(snapshotUrl, "utf8"),
    readFile(curatorConfigUrl, "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotRaw);
  const config = JSON.parse(configRaw);
  await applyTrustedCuratorSync(snapshot, config, { skipFetch: SKIP_FETCH });
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const summary = snapshot.trustedCuratorSync;
  console.log(
    `[trusted-curator-sync] mentions=${summary.mentionCount} matched=${summary.matchedCount} promoted=${summary.promotedCount} trust=${JSON.stringify(summary.trustCounts)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[trusted-curator-sync] fatal:", error?.message ?? error);
    process.exit(1);
  });
}
