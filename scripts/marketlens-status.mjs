import { readFile } from "node:fs/promises";
import { countObservationMetrics } from "./marketlens-observation.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);

function countBy(items, keyFn) {
  return (items ?? []).reduce((acc, item) => {
    const key = String(keyFn(item) ?? "missing") || "missing";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function compactGuard(guard = {}) {
  return {
    degraded: Boolean(guard.degraded),
    reasons: Array.isArray(guard.reasons) ? guard.reasons : [],
    current: guard.current ?? null,
    previous: guard.previous ?? null,
    thresholds: guard.thresholds ?? null,
    wroteSnapshot: Boolean(guard.wroteSnapshot),
    wrotePartialSnapshot: Boolean(guard.wrotePartialSnapshot),
  };
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readExtractionMetrics(llm = {}, llmExtractions = []) {
  const extraction = llm.extraction && typeof llm.extraction === "object" ? llm.extraction : {};
  const modeCountsFromExtractions = countBy(llmExtractions, (item) => item.mode ?? "heuristic");
  const modeCounts = Object.keys(extraction.modeCounts ?? {}).length > 0 ? extraction.modeCounts : llm.modeCounts ?? modeCountsFromExtractions;
  const geminiOutputCount = numberOr(modeCounts.gemini, 0);
  const metadataRequested = numberOr(
    extraction.geminiRequestedCount,
    numberOr(extraction.requested, numberOr(llm.geminiRequestedCount, llm.requested)),
  );
  const metadataSucceeded = numberOr(
    extraction.geminiSucceededCount,
    numberOr(extraction.succeeded, numberOr(llm.geminiSucceededCount, llm.succeeded)),
  );
  const metadataFailed = numberOr(
    extraction.geminiFailedCount,
    numberOr(extraction.failed, numberOr(llm.geminiFailedCount, llm.failed)),
  );
  const metadataSkipped = numberOr(
    extraction.geminiSkippedCount,
    numberOr(extraction.skipped, numberOr(llm.geminiSkippedCount, llm.skipped)),
  );
  const reconciledSucceeded = geminiOutputCount;
  const reconciledRequested = geminiOutputCount > 0 ? metadataRequested : 0;
  const staleMetadata = geminiOutputCount === 0 && (metadataSucceeded > 0 || metadataRequested > 0);
  return {
    requested: reconciledRequested,
    succeeded: reconciledSucceeded,
    failed: metadataFailed,
    skipped: metadataSkipped,
    eligible: numberOr(extraction.eligible, llm.eligible),
    geminiRequestedCount: reconciledRequested,
    geminiSucceededCount: reconciledSucceeded,
    geminiFailedCount: metadataFailed,
    geminiSkippedCount: metadataSkipped,
    metadataGeminiRequestedCount: metadataRequested,
    metadataGeminiSucceededCount: metadataSucceeded,
    modeCounts,
    openAiCount: numberOr(llm.openAiCount, modeCounts.openai),
    geminiCount: geminiOutputCount,
    heuristicCount: numberOr(llm.heuristicCount, modeCounts.heuristic),
    staleMetadata,
    interpretation:
      geminiOutputCount === 0
        ? "no_gemini_document_extractions_in_llmExtractions"
        : "gemini_document_extractions_present",
  };
}

function readOverviewMetrics(llm = {}, overviewNarrative = {}, updatedAt = null) {
  const overview = llm.overview && typeof llm.overview === "object" ? llm.overview : {};
  const generatedAt = overview.generatedAt ?? overviewNarrative.generatedAt ?? null;
  const isCurrentRun =
    overview.isCurrentRun ??
    Boolean(generatedAt && updatedAt && generatedAt === updatedAt);
  let requested = numberOr(overview.requested);
  let succeeded = numberOr(overview.succeeded);
  let failed = numberOr(overview.failed);
  if (overview.requested === undefined && overview.succeeded === undefined && overview.failed === undefined) {
    const sourceMode = overviewNarrative.sourceMode ?? "heuristic";
    const fallbackReason =
      overview.fallbackReason ??
      llm.overviewFallbackReason ??
      overviewNarrative.fallbackReason ??
      "";
    if (["openai", "gemini"].includes(sourceMode) && isCurrentRun) {
      requested = 1;
      if (overviewNarrative.error || fallbackReason) {
        succeeded = 0;
        failed = 1;
      } else {
        succeeded = 1;
        failed = 0;
      }
    }
  }
  const sourceMode = overview.sourceMode ?? overviewNarrative.sourceMode ?? "missing";
  const freshness = !generatedAt ? "missing" : isCurrentRun ? "current_run" : "stale_or_unknown";
  return {
    sourceMode,
    generatedAt,
    model: overview.model ?? overviewNarrative.model ?? null,
    requested,
    succeeded,
    failed,
    fallbackReason:
      overview.fallbackReason ??
      llm.overviewFallbackReason ??
      overviewNarrative.fallbackReason ??
      "",
    error: overview.error ?? overviewNarrative.error ?? null,
    isCurrentRun: Boolean(isCurrentRun),
    freshness,
    interpretation:
      freshness === "current_run" && ["openai", "gemini"].includes(sourceMode) && succeeded > 0
        ? "overview_llm_success_this_run"
        : freshness === "current_run" && failed > 0
          ? "overview_llm_failed_this_run"
          : freshness === "stale_or_unknown" && ["openai", "gemini"].includes(sourceMode)
            ? "overview_llm_source_mode_present_but_not_verified_current_run"
            : sourceMode === "heuristic"
              ? "overview_heuristic"
              : "overview_state_unknown",
  };
}

const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
const products = Array.isArray(snapshot.normalizedProducts) ? snapshot.normalizedProducts : [];
const candidates = Array.isArray(snapshot.discoveryCandidates) ? snapshot.discoveryCandidates : [];
const prices = Array.isArray(snapshot.priceSnapshots) ? snapshot.priceSnapshots : [];
const predicted = Array.isArray(snapshot.predictedPriceSnapshots) ? snapshot.predictedPriceSnapshots : [];
const llmExtractions = Array.isArray(snapshot.llmExtractions) ? snapshot.llmExtractions : [];
const tasks = Array.isArray(snapshot.explorationTasks) ? snapshot.explorationTasks : [];
const llm = snapshot.metadata?.llmExecution ?? {};
const updatedAt = snapshot.metadata?.updatedAt ?? null;
const extraction = readExtractionMetrics(llm, llmExtractions);
const overview = readOverviewMetrics(llm, snapshot.overviewNarrative ?? {}, updatedAt);
const observation = countObservationMetrics(snapshot);

const status = {
  updatedAt,
  collectGuard: compactGuard(snapshot.metadata?.collectGuard),
  llmExecution: {
    provider: llm.provider ?? null,
    configured: Boolean(llm.configured),
    model: llm.model ?? null,
    fallbackModel: llm.fallbackModel ?? "",
    actualModelUsed: Array.isArray(llm.actualModelUsed) ? llm.actualModelUsed : [],
    fallbackReasons: llm.fallbackReasons ?? {},
    eligibilityReasonCounts: llm.eligibilityReasonCounts ?? {},
    geminiQuotaStopped: Boolean(llm.geminiQuotaStopped),
    geminiQuotaStopReason: llm.geminiQuotaStopReason ?? "",
    estimatedCost: numberOr(llm.estimatedCost),
    extraction,
    overview,
    legacyFlat: {
      requested: numberOr(llm.requested, extraction.requested),
      succeeded: numberOr(llm.succeeded, extraction.succeeded),
      failed: numberOr(llm.failed, extraction.failed),
      skipped: numberOr(llm.skipped, extraction.skipped),
      geminiRequestedCount: extraction.geminiRequestedCount,
      geminiSucceededCount: extraction.geminiSucceededCount,
      geminiFailedCount: extraction.geminiFailedCount,
      geminiSkippedCount: extraction.geminiSkippedCount,
      overviewFallbackReason: llm.overviewFallbackReason ?? overview.fallbackReason ?? "",
    },
  },
  llmExtractionModes: extraction.modeCounts,
  aiThesisSourceModes: countBy(products, (item) => item.aiThesis?.sourceMode ?? "missing"),
  priceThesisSourceModes: countBy(products, (item) => item.priceThesis?.sourceMode ?? "missing"),
  explorationTasks: tasks.length,
  movieBonus: products.filter((item) => item.category === "movie_bonus").length,
  movieGoods: products.filter((item) => item.category === "movie_goods").length,
  candidateStates: countBy(candidates, (item) => item.candidateState ?? "missing"),
  candidateGeminiEligibility: countBy(candidates, (item) => item.geminiEligibilityReason ?? "missing"),
  priceSourceRanks: countBy(prices, (item) => item.priceSourceRank ?? "missing"),
  predictedPriceSourceRanks: countBy(predicted, (item) => item.priceSourceRank ?? "missing"),
  observation,
};

console.log(JSON.stringify(status, null, 2));