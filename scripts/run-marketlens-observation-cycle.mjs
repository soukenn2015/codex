import { runMarketlensObservationCycle } from "./marketlens-observation-cycle.mjs";

const env = {
  ...process.env,
  MARKETLENS_OBSERVATION_ONLY: process.env.MARKETLENS_OBSERVATION_ONLY ?? "1",
};

try {
  const result = await runMarketlensObservationCycle({ env });
  const obs = result.observationMetrics ?? {};
  console.log(
    JSON.stringify(
      {
        mode: "observation_only",
        channel: result.limits.channel,
        durationMs: result.durationMs,
        delta: result.delta,
        marketplaceObservation: {
          requested: obs.marketplaceObservationRequested ?? result.marketplaceObservationResult?.execution?.requested ?? 0,
          succeeded: obs.marketplaceObservationSucceeded ?? result.marketplaceObservationResult?.execution?.succeeded ?? 0,
          failed: obs.marketplaceObservationFailed ?? result.marketplaceObservationResult?.execution?.failed ?? 0,
          skipped: obs.marketplaceObservationSkipped ?? result.marketplaceObservationResult?.execution?.skipped ?? 0,
        },
        marketplaceSignals: obs.marketplaceSignals ?? result.after.marketplaceSignals,
        listingCandidates: obs.marketplaceListingCandidateCount ?? result.after.listingCandidates,
        currency: obs.marketplaceListingCurrencyDistribution ?? {},
        socialSearchSignals: obs.socialSearchSignals ?? result.after.socialSearchSignals,
        browserObservedInPriceSnapshots: obs.browserObservedInPriceSnapshots ?? false,
        buyLineBrowserMixDetected: obs.buyLineBrowserMixDetected ?? false,
        forbiddenLabelDetected: obs.forbiddenLabelDetected ?? false,
      },
      null,
      2,
    ),
  );
  console.log(`[marketlens-observation-cycle] complete in ${result.durationMs}ms`);
} catch (error) {
  console.error(`[marketlens-observation-cycle] failed: ${error?.message ?? error}`);
  process.exit(1);
}