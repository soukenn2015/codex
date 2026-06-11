import { readFile, writeFile } from "node:fs/promises";
import {
  applyBrowserObservationLayerToSnapshot,
  countObservationMetrics,
  sanitizeSnapshotClaims,
} from "./marketlens-observation.mjs";
import { collectMarketplaceObservationSignals } from "./marketlens-mercari-reader.mjs";
import { collectBrowserObservationSignals } from "./marketlens-yahoo-realtime-reader.mjs";
import {
  resolveBrowserObservationBatchLimit,
  resolveMarketplaceBrowserObservationLimit,
  resolveObservationLimits,
  resolveRealtimeBrowserObservationLimit,
} from "./marketlens-limits.mjs";

const snapshotPath = new URL("../data/marketlens.snapshot.json", import.meta.url);

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function truthyEnv(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function resolveObservationChannel(env = process.env) {
  const raw = String(env.MARKETLENS_OBSERVATION_CHANNEL ?? "all").trim().toLowerCase();
  if (raw === "mercari" || raw === "marketplace") return "mercari";
  if (raw === "realtime" || raw === "yahoo" || raw === "yahoo_realtime") return "realtime";
  return "all";
}

export function resolveObservationCycleLimits(env = process.env) {
  const channel = resolveObservationChannel(env);
  const batchLimit = resolveBrowserObservationBatchLimit(env);
  const marketplaceDefault = resolveMarketplaceBrowserObservationLimit(env);
  const realtimeDefault = resolveRealtimeBrowserObservationLimit(env);
  const enabled = env.MARKETLENS_BROWSER_OBSERVATION_ENABLED !== "0";

  if (channel === "mercari") {
    return {
      channel,
      enabled,
      batchLimit,
      marketplaceLimit: marketplaceDefault > 0 ? marketplaceDefault : batchLimit,
      realtimeLimit: 0,
    };
  }
  if (channel === "realtime") {
    return {
      channel,
      enabled,
      batchLimit,
      marketplaceLimit: 0,
      realtimeLimit: realtimeDefault > 0 ? realtimeDefault : batchLimit,
    };
  }
  return {
    channel,
    enabled,
    batchLimit,
    marketplaceLimit: marketplaceDefault,
    realtimeLimit: realtimeDefault,
  };
}

function countListingCandidates(snapshot = {}) {
  return (snapshot.marketplaceSignals ?? []).reduce(
    (sum, signal) => sum + (Array.isArray(signal?.listingCandidates) ? signal.listingCandidates.length : 0),
    0,
  );
}

function summarizeBeforeAfter(before = {}, after = {}) {
  return {
    marketplaceSignals: {
      before: before.marketplaceSignals ?? 0,
      after: after.marketplaceSignals ?? 0,
      delta: (after.marketplaceSignals ?? 0) - (before.marketplaceSignals ?? 0),
    },
    listingCandidates: {
      before: before.listingCandidates ?? 0,
      after: after.listingCandidates ?? 0,
      delta: (after.listingCandidates ?? 0) - (before.listingCandidates ?? 0),
    },
    socialSearchSignals: {
      before: before.socialSearchSignals ?? 0,
      after: after.socialSearchSignals ?? 0,
      delta: (after.socialSearchSignals ?? 0) - (before.socialSearchSignals ?? 0),
    },
  };
}

export async function runMarketlensObservationCycle({
  env = process.env,
  snapshotUrl = snapshotPath,
  writeSnapshot = true,
} = {}) {
  if (!truthyEnv(env.MARKETLENS_OBSERVATION_ONLY)) {
    throw new Error("MARKETLENS_OBSERVATION_ONLY=1 is required for lightweight observation cycle");
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const limits = resolveObservationCycleLimits(env);
  const observationLimits = resolveObservationLimits(env);
  const browserObservationTimeoutMs = clampNumber(
    Number(env.MARKETLENS_BROWSER_OBSERVATION_TIMEOUT_MS ?? 15000),
    3000,
    60000,
  );
  const marketplaceObservationTimeoutMs = clampNumber(
    Number(
      env.MARKETLENS_MARKETPLACE_BROWSER_OBSERVATION_TIMEOUT_MS ??
        env.MARKETLENS_BROWSER_OBSERVATION_TIMEOUT_MS ??
        25000,
    ),
    5000,
    60000,
  );

  const raw = await readFile(snapshotUrl, "utf8");
  let snapshot = JSON.parse(raw);
  const beforeCounts = {
    marketplaceSignals: (snapshot.marketplaceSignals ?? []).length,
    listingCandidates: countListingCandidates(snapshot),
    socialSearchSignals: (snapshot.socialSearchSignals ?? []).length,
  };

  let browserObservationResult = null;
  if (limits.realtimeLimit > 0) {
    browserObservationResult = await collectBrowserObservationSignals({
      snapshot,
      enabled: limits.enabled,
      limit: limits.realtimeLimit,
      timeoutMs: browserObservationTimeoutMs,
      env,
    });
    snapshot.browserObservationQueue = browserObservationResult.browserObservationQueue;
    snapshot.socialSearchSignals = browserObservationResult.socialSearchSignals;
    snapshot.realtimeResearchTargets = browserObservationResult.realtimeResearchTargets;
  }

  let marketplaceObservationResult = null;
  if (limits.marketplaceLimit > 0) {
    marketplaceObservationResult = await collectMarketplaceObservationSignals({
      snapshot,
      enabled: limits.enabled,
      limit: limits.marketplaceLimit,
      timeoutMs: marketplaceObservationTimeoutMs,
      env,
    });
    snapshot.marketplaceObservationQueue = marketplaceObservationResult.marketplaceObservationQueue;
    snapshot.marketplaceSignals = marketplaceObservationResult.marketplaceSignals;
  }

  snapshot = applyBrowserObservationLayerToSnapshot(snapshot, {
    maxSubjects: observationLimits.marketplaceSubjectLimit,
  });
  snapshot = sanitizeSnapshotClaims(snapshot);

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const afterCounts = {
    marketplaceSignals: (snapshot.marketplaceSignals ?? []).length,
    listingCandidates: countListingCandidates(snapshot),
    socialSearchSignals: (snapshot.socialSearchSignals ?? []).length,
  };
  const observationMetrics = countObservationMetrics(snapshot);

  snapshot.metadata = {
    ...(snapshot.metadata ?? {}),
    updatedAt: finishedAt,
    observationLimits,
    observationCycleExecution: {
      mode: "observation_only",
      channel: limits.channel,
      startedAt,
      finishedAt,
      durationMs,
      limits,
      before: beforeCounts,
      after: afterCounts,
      delta: summarizeBeforeAfter(beforeCounts, afterCounts),
      browserObservationExecution: browserObservationResult
        ? {
            ...browserObservationResult.execution,
            batchLimit: limits.realtimeLimit,
          }
        : null,
      marketplaceObservationExecution: marketplaceObservationResult
        ? {
            ...marketplaceObservationResult.execution,
            batchLimit: limits.marketplaceLimit,
            sharedBatchLimit: limits.batchLimit,
          }
        : null,
      browserObservationQueueSummary: browserObservationResult?.queueSummary ?? null,
      marketplaceObservationQueueSummary: marketplaceObservationResult?.queueSummary ?? null,
    },
    browserObservationQueueSummary:
      browserObservationResult?.queueSummary ?? snapshot.metadata?.browserObservationQueueSummary ?? null,
    browserObservationExecution:
      browserObservationResult?.execution ?? snapshot.metadata?.browserObservationExecution ?? null,
    marketplaceObservationQueueSummary:
      marketplaceObservationResult?.queueSummary ?? snapshot.metadata?.marketplaceObservationQueueSummary ?? null,
    marketplaceObservationExecution:
      marketplaceObservationResult?.execution ?? snapshot.metadata?.marketplaceObservationExecution ?? null,
    marketplaceSignalCount: snapshot.marketplaceSignals?.length ?? 0,
    socialSearchSignalCount: snapshot.socialSearchSignals?.length ?? 0,
    observationMetrics,
  };

  if (writeSnapshot) {
    await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  return {
    snapshot,
    durationMs,
    limits,
    before: beforeCounts,
    after: afterCounts,
    delta: summarizeBeforeAfter(beforeCounts, afterCounts),
    observationMetrics,
    browserObservationResult,
    marketplaceObservationResult,
  };
}