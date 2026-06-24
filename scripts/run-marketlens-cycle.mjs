import { spawn } from "node:child_process";

const retries = Number(process.env.MARKETLENS_RETRIES ?? 3);
const retryDelayMs = Number(process.env.MARKETLENS_RETRY_DELAY_MS ?? 15000);
const collectDegradedExitCode = 2;
const skipBuzzDiscovery = process.env.MARKETLENS_SKIP_BUZZ_DISCOVERY === "1";
const skipRejudge = process.env.MARKETLENS_SKIP_REJUDGE === "1";
const skipDiscoveryAgent = process.env.MARKETLENS_SKIP_DISCOVERY_AGENT === "1";
const skipCompetitorMonitor = process.env.MARKETLENS_SKIP_COMPETITOR_MONITOR === "1";
const skipScreening = process.env.MARKETLENS_SKIP_SCREENING === "1";
const skipDeepDive = process.env.MARKETLENS_SKIP_DEEP_DIVE === "1";
const skipPredictionAccuracy = process.env.MARKETLENS_SKIP_PREDICTION_ACCURACY === "1";
const skipCuratorSync = process.env.MARKETLENS_SKIP_CURATOR_SYNC === "1";
const skipCuratorQuality = process.env.MARKETLENS_SKIP_CURATOR_QUALITY === "1";
const skipPriceTrend = process.env.MARKETLENS_SKIP_PRICE_TREND === "1";

function scriptPath(name) {
  return new URL(`./${name}`, import.meta.url).pathname;
}

function runNodeScript(scriptPathValue, { optional = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPathValue], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve({ code: code ?? 1, optional }));
    child.on("error", () => resolve({ code: 1, optional }));
  });
}

async function runOptionalStep(label, fileName) {
  const result = await runNodeScript(scriptPath(fileName), { optional: true });
  if (result.code !== 0) {
    console.log(`[marketlens-cycle] ${label} failed (code=${result.code}); continuing`);
  }
  return result.code;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (!skipDiscoveryAgent) {
  await runOptionalStep("discovery agent", "discovery-agent.mjs");
}

await runOptionalStep("source priority", "source-priority.mjs");

let collectOk = false;
let collectState = "failed";
for (let attempt = 1; attempt <= retries; attempt += 1) {
  console.log(`[marketlens-cycle] collect attempt ${attempt}/${retries}`);
  const { code } = await runNodeScript(scriptPath("collect-marketlens.mjs"));
  if (code === 0) {
    collectOk = true;
    collectState = "ok";
    break;
  }
  if (code === collectDegradedExitCode) {
    collectState = "degraded";
    break;
  }
  if (attempt < retries) {
    console.log(`[marketlens-cycle] collect failed (code=${code}), retry in ${retryDelayMs}ms`);
    await sleep(retryDelayMs);
  }
}

if (collectState === "failed") {
  console.log("[marketlens-cycle] collector failed. fallback to existing snapshot for postprocess.");
}
if (collectState === "degraded") {
  console.log("[marketlens-cycle] collector degraded. preserved existing snapshot.");
}

const postprocessCode = (await runNodeScript(scriptPath("postprocess-marketlens-snapshot.mjs"))).code;
if (postprocessCode !== 0) {
  console.error(`[marketlens-cycle] postprocess failed (code=${postprocessCode})`);
  process.exit(postprocessCode);
}

if (!skipCuratorSync) {
  await runOptionalStep("trusted curator sync", "trusted-curator-sync.mjs");
}

if (!skipScreening) {
  await runOptionalStep("flash-lite screening", "marketlens-screening.mjs");
}

if (!skipRejudge) {
  const rejudgeCode = (await runNodeScript(scriptPath("rejudge-products.mjs"))).code;
  if (rejudgeCode !== 0) {
    console.log(`[marketlens-cycle] rejudge failed (code=${rejudgeCode}); continuing with postprocess snapshot`);
  }
}

if (!skipDeepDive) {
  await runOptionalStep("deep dive", "marketlens-deep-dive.mjs");
}

if (!skipPriceTrend) {
  await runOptionalStep("price trend", "marketlens-price-trend.mjs");
}

if (!skipPredictionAccuracy) {
  await runOptionalStep("prediction accuracy", "prediction-accuracy.mjs");
}

if (!skipBuzzDiscovery) {
  await runOptionalStep("buzz discovery", "marketlens-buzz-discovery.mjs");
}

if (!skipCompetitorMonitor) {
  await runOptionalStep("competitor monitor", "competitor-monitor.mjs");
}

if (!skipCuratorQuality) {
  await runOptionalStep("curator quality diff", "curator-quality-diff.mjs");
}

const digestCode = (await runNodeScript(scriptPath("daily-digest.mjs"))).code;
if (digestCode !== 0) {
  console.error(`[marketlens-cycle] digest failed (code=${digestCode})`);
  process.exit(digestCode);
}

console.log(`[marketlens-cycle] complete (collect=${collectState === "ok" ? "ok" : collectState})`);
