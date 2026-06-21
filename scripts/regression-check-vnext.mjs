import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  applyMarketplaceResearchToSnapshot,
  applyReaderObservedLabels,
  assessMarketplaceQueryRejectReason,
  buildMarketplaceResearchQuery,
  buildMercariSearchUrl,
  buildYahooFleamarketSearchUrl,
  buildYahooRealtimeSearchUrl,
  countObservationMetrics,
  prepareRealtimeObservationQuery,
  REALTIME_OBSERVATION_QUERY_MAX_LEN,
  SOCIAL_SEARCH_CONFIDENCE_BADGE_MIN,
  isBrowserObservedPriceCandidate,
  formatMarketplaceListingPrice,
  summarizeMarketplaceSignalQuality,
  normalizeMarketplaceBrowserSignal,
  MARKETPLACE_BROWSER_OBSERVED_LABEL,
  realtimeResearchTargetLabel,
  decodeHtmlEntities,
  marketplaceResearchTargetLabel,
  resolveXSignalLabel,
  sanitizeClaimText,
  sourceResultMatchesReaderSignal,
  summarizeReaderObservation,
} from "./marketlens-observation.mjs";
import {
  parseMercariListingPrice,
  parseMercariSearchMarkdown,
  signalNeedsCurrencyRecheck,
} from "./marketlens-mercari-reader.mjs";
import { parseJinaMarkdown } from "./marketlens-x-reader.mjs";
import { assertProvisionalBuyLineGates } from "./marketlens-buyline.mjs";

const snapshotPath = new URL("../data/marketlens.snapshot.json", import.meta.url);
const collectScriptPath = new URL("./collect-marketlens.mjs", import.meta.url);
const FORBIDDEN_MARKET_LABEL_RE = /メルカリ相場|フリマ相場|実勢相場|観測相場/;
const REQUIRE_GEMINI = process.env.MARKETLENS_REQUIRE_GEMINI === "1";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function runNodeScript(scriptUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptUrl.pathname], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `script failed: ${scriptUrl.pathname}`));
        return;
      }
      resolve(stdout);
    });
    child.on("error", reject);
  });
}

const allowedPriceSourceRanks = new Set([
  "observed_market_price",
  "specialized_estimate",
  "historical_prediction",
  "llm_mentioned_price",
  "manual_price",
  "ai_estimate",
]);

const allowedCandidateStates = new Set(["ready", "researchTask", "watchOnly", "archive"]);
const allowedThesisModes = new Set(["heuristic", "gemini", "manual_ai", "openai"]);

function assertBrowserObservedPromotionGates(snapshot, observation, snapshotBlob, priceSnapshots = []) {
  const marketplaceSignals = Array.isArray(snapshot.marketplaceSignals) ? snapshot.marketplaceSignals : [];
  const browserSignals = marketplaceSignals.filter((row) => row?.priceSourceRank === "browser_observed_candidate");

  assert(
    !priceSnapshots.some((price) => price.priceSourceRank === "browser_observed_candidate"),
    "browser_observed_candidate が priceSnapshots に存在します",
  );
  assert(
    !priceSnapshots.some(
      (price) =>
        price.sourceMode === "browser_observed" ||
        price.priceSourceRank === "browser_observed" ||
        (price.provider === "mercari_browser" && price.priceSourceRank !== "observed_market_price"),
    ),
    "未昇格の browser 観測価格が priceSnapshots に投影されています",
  );
  assert(observation.buyLineBrowserMixDetected === false, "browser_observed_candidate が BuyLine に混入しています");

  for (const price of priceSnapshots.filter((row) => row.priceSourceRank === "observed_market_price")) {
    assert(price.promotionStatus === "promoted", `observed_market_price が昇格済みではありません: ${price.productKey}`);
    assert(price.buyLineEligible === true, `observed_market_price が BuyLine 対象ではありません: ${price.productKey}`);
    assert(String(price.currency ?? "").toUpperCase() === "JPY", `observed_market_price が JPY ではありません: ${price.productKey}`);
    assert(price.jpyCandidate == null, `observed_market_price に jpyCandidate が直接混入しています: ${price.productKey}`);
    assert(price.sourceMode === "promoted_observed_market", `observed_market_price の sourceMode が不正です: ${price.productKey}`);
    assert(/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(String(price.itemUrl ?? "")), `observed_market_price の itemUrl が不正です: ${price.productKey}`);
    assert(Number(price.confidence ?? 0) >= 0.8, `observed_market_price の confidence が不足しています: ${price.productKey}`);
    assert(price.observedAt, `observed_market_price の observedAt がありません: ${price.productKey}`);
    assert(price.promotionEvidence && typeof price.promotionEvidence === "object", `observed_market_price の evidence がありません: ${price.productKey}`);
  }

  for (const signal of browserSignals) {
    assert(signal.buyLineEligible === false, "browser_observed_candidate signal の buyLineEligible が true です");
    assert(signal.sourceMode === "browser_observed", "browser_observed_candidate の sourceMode が不正です");
    for (const listing of signal.listingCandidates ?? []) {
      if (String(listing.currency ?? "") !== "unknown") continue;
      assert(
        !formatMarketplaceListingPrice(listing).startsWith("¥"),
        "unknown currency listing が JPY 表示に fallback しています",
      );
      assert(
        !formatMarketplaceListingPrice(listing).startsWith("US$"),
        "unknown currency listing が USD 表示に fallback しています",
      );
    }
  }

  for (const price of priceSnapshots) {
    const currency = String(price.currency ?? "").toUpperCase();
    if (currency !== "UNKNOWN") continue;
    assert(price.buyLineEligible !== true, "currency=unknown の priceSnapshot が BuyLine 対象です");
  }

  const mercariUsdOnly =
    (observation.signalsWithJpy ?? 0) === 0 &&
    (observation.signalsWithUsdOnly ?? 0) > 0 &&
    (observation.marketplaceListingCandidateCount ?? 0) > 0;
  if (mercariUsdOnly) {
    assert(
      (observation.marketplacePriceSnapshots ?? 0) === 0,
      "Mercari USD-only 中に observed_market_price 昇格が検出されました",
    );
    assert(
      !priceSnapshots.some((price) => price.priceSourceRank === "browser_observed_candidate" && price.buyLineEligible),
      "Mercari USD-only 中に browser_observed_candidate の BuyLine 昇格が検出されました",
    );
    for (const signal of browserSignals.filter((row) => row.marketplace === "mercari" || !row.marketplace)) {
      assert(signal.buyLineEligible === false, "Mercari USD-only 中に browser signal が BuyLine 対象です");
    }
  }

  if ((observation.observedMarketPrice ?? 0) === 0) {
    const marketplaceUiBlob = JSON.stringify({
      marketplaceSignals: snapshot.marketplaceSignals,
      marketplaceResearchTargets: snapshot.marketplaceResearchTargets,
      socialSearchSignals: snapshot.socialSearchSignals,
      explorationTasks: (snapshot.explorationTasks ?? []).filter(
        (task) => task.kind === "marketplace_check" || task.sourceMode === "manual_check",
      ),
    });
    assert(
      !/メルカリ相場|フリマ相場|実勢相場|観測相場/.test(marketplaceUiBlob),
      "observed_market_price 0 で marketplace UI 向けデータに禁止相場ラベルが残っています",
    );
  }

  let jpyCandidateBuyLineTrueCount = 0;
  let jpyCandidateHighConfidenceNoiseCount = 0;
  for (const signal of browserSignals) {
    for (const listing of signal.listingCandidates ?? []) {
      const jpyCandidate = listing.jpyCandidate;
      if (!jpyCandidate || typeof jpyCandidate !== "object") continue;
      if (jpyCandidate.buyLineEligible === true) jpyCandidateBuyLineTrueCount += 1;
      assert(jpyCandidate.buyLineEligible !== true, "jpyCandidate.buyLineEligible が true です");
      if (jpyCandidate.currency != null) {
        assert(String(jpyCandidate.currency).toUpperCase() === "JPY", "jpyCandidate.currency が JPY ではありません");
      }
      assert(
        Number(jpyCandidate.confidence ?? 0) >= 0.6,
        `jpyCandidate.confidence が保存閾値未満です: ${listing.itemUrl}`,
      );
      if (jpyCandidate.exclusionReason === "related_price_noise" && Number(jpyCandidate.confidence ?? 0) >= 0.6) {
        jpyCandidateHighConfidenceNoiseCount += 1;
      }
      const uiBlob = JSON.stringify(jpyCandidate);
      assert(!/メルカリ相場|フリマ相場|実勢相場|観測相場|実勢価格|market price|observed market/i.test(uiBlob), "jpyCandidate に禁止相場ラベルがあります");
    }
  }
  assert(jpyCandidateBuyLineTrueCount === 0, "jpyCandidate.buyLineEligible=true が存在します");
  assert(jpyCandidateHighConfidenceNoiseCount === 0, "関連価格ノイズが高 confidence jpyCandidate として保存されています");

  const blockedSaveAsJpy = [];
  for (const signal of browserSignals) {
    for (const listing of signal.listingCandidates ?? []) {
      const status = listing.playwrightProbeStatus;
      if (!status || typeof status !== "object") continue;
      assert(status.buyLineEligible !== true, "playwrightProbeStatus.buyLineEligible が true です");
      if (listing.jpyCandidate && /blocked|captcha|login_required/i.test(String(status.exclusionReason ?? status.browserResult ?? ""))) {
        blockedSaveAsJpy.push(listing.itemUrl);
      }
      if (
        listing.jpyCandidate &&
        ["browser_blocked", "browser_captcha_or_interstitial", "browser_login_required"].includes(status.browserResult)
      ) {
        blockedSaveAsJpy.push(listing.itemUrl);
      }
    }
  }
  assert(blockedSaveAsJpy.length === 0, "blocked/CAPTCHA/login が jpyCandidate として保存されています");
  assert(
    !priceSnapshots.some((price) => price.jpyCandidate != null),
    "priceSnapshots に jpyCandidate が投影されています",
  );
  assert(
    !(snapshot.priceSnapshots ?? []).some((price) => price.priceSourceRank === "browser_observed_candidate" && price.jpyCandidate),
    "browser_observed_candidate + jpyCandidate が priceSnapshots に存在します",
  );
}

async function main() {
  const raw = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(raw);

  assert(snapshot?.metadata, "metadata がありません");
  assert(Number.isInteger(snapshot.metadata.reachableSources), "reachableSources が不正です");
  assert(Number.isInteger(snapshot.metadata.totalSources), "totalSources が不正です");
  assert(snapshot.metadata.reachableSources <= snapshot.metadata.totalSources, "取得件数が総数を超えています");

  const trends = Array.isArray(snapshot.trends) ? snapshot.trends : [];
  const candidates = Array.isArray(snapshot.discoveryCandidates) ? snapshot.discoveryCandidates : [];
  const trendPool = Array.isArray(snapshot.trendCollectionPool) ? snapshot.trendCollectionPool : [];
  const archivedConcrete = Array.isArray(snapshot.archivedConcreteTrends) ? snapshot.archivedConcreteTrends : [];
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const normalizedProducts = Array.isArray(snapshot.normalizedProducts) ? snapshot.normalizedProducts : [];
  const productEvents = Array.isArray(snapshot.productEvents) ? snapshot.productEvents : [];
  const priceSnapshots = Array.isArray(snapshot.priceSnapshots) ? snapshot.priceSnapshots : [];
  const routeSnapshots = Array.isArray(snapshot.routeSnapshots) ? snapshot.routeSnapshots : [];
  const selectionReasons = Array.isArray(snapshot.selectionReasons) ? snapshot.selectionReasons : [];
  const explorationTasks = Array.isArray(snapshot.explorationTasks) ? snapshot.explorationTasks : [];
  const marketplaceResearchTargets = Array.isArray(snapshot.marketplaceResearchTargets)
    ? snapshot.marketplaceResearchTargets
    : [];
  const llmExtractions = Array.isArray(snapshot.llmExtractions) ? snapshot.llmExtractions : [];
  const historicalComparables = Array.isArray(snapshot.historicalComparables) ? snapshot.historicalComparables : [];
  const predictedPriceSnapshots = Array.isArray(snapshot.predictedPriceSnapshots) ? snapshot.predictedPriceSnapshots : [];
  const registrySummary = snapshot.sourceRegistrySummary ?? null;
  const sourceDiscovery = snapshot.sourceDiscoveryResults ?? null;

  for (const trend of trends) {
    assert(trend.keyword, "trend.keyword が空です");
    assert(isIsoDate(trend.startDate), `trend.startDate が不正です: ${trend.keyword}`);
    assert(isIsoDate(trend.endDate), `trend.endDate が不正です: ${trend.keyword}`);
  }

  for (const candidate of candidates) {
    assert(candidate.name, "candidate.name が空です");
    assert(isIsoDate(candidate.startDate), `candidate.startDate が不正です: ${candidate.name}`);
    assert(isIsoDate(candidate.endDate), `candidate.endDate が不正です: ${candidate.name}`);
    if (String(candidate.marketPriceSource ?? "").includes("specialized-search")) {
      assert(candidate.marketObservedAt, `specialized-search なのに marketObservedAt がありません: ${candidate.name}`);
    }
  }

  assert(trendPool.length >= trends.length, "trendCollectionPool が不足しています");
  for (const item of trendPool) {
    assert(item.keyword, "trendCollectionPool.keyword が空です");
    assert(item.type === "specific" || item.type === "broad", `trendCollectionPool.type が不正です: ${item.type}`);
  }

  for (const archived of archivedConcrete) {
    assert(archived.keyword, "archivedConcrete.keyword が空です");
    assert(archived.reason, "archivedConcrete.reason が空です");
  }

  assert(Array.isArray(documents), "documents が配列ではありません");
  for (const document of documents) {
    assert(document.docId, "document.docId が空です");
    assert(document.sourceKey, `document.sourceKey が空です: ${document.docId}`);
    assert(document.url, `document.url が空です: ${document.docId}`);
    assert(document.fetchedAt, `document.fetchedAt が空です: ${document.docId}`);
  }

  assert(Array.isArray(productEvents), "productEvents が配列ではありません");
  for (const event of productEvents) {
    assert(event.id, "productEvent.id が空です");
    assert(event.productKey, `productEvent.productKey が空です: ${event.id}`);
    assert(event.eventType, `productEvent.eventType が空です: ${event.id}`);
  }

  assert(Array.isArray(normalizedProducts), "normalizedProducts が配列ではありません");
  for (const product of normalizedProducts) {
    assert(product.productKey, "normalizedProducts.productKey が空です");
    assert(product.canonicalName, `normalizedProducts.canonicalName が空です: ${product.productKey}`);
    if (product.aiThesis) {
      assert(typeof product.aiThesis.whyHot === "string", `aiThesis.whyHot が不正です: ${product.productKey}`);
      assert(Number.isFinite(product.aiThesis.confidence), `aiThesis.confidence が不正です: ${product.productKey}`);
      assert(Array.isArray(product.aiThesis.nextChecks), `aiThesis.nextChecks が不正です: ${product.productKey}`);
      assert(Array.isArray(product.aiThesis.demandDrivers), `aiThesis.demandDrivers が不正です: ${product.productKey}`);
      assert(Array.isArray(product.aiThesis.supplyConstraints), `aiThesis.supplyConstraints が不正です: ${product.productKey}`);
      assert(Array.isArray(product.aiThesis.riskFactors), `aiThesis.riskFactors が不正です: ${product.productKey}`);
      if (product.aiThesis.sourceMode) {
        assert(allowedThesisModes.has(product.aiThesis.sourceMode), `aiThesis.sourceMode が不正です: ${product.productKey} -> ${product.aiThesis.sourceMode}`);
      }
    }
    if (product.priceThesis) {
      assert(Number.isFinite(product.priceThesis.estimatedMarketPrice), `priceThesis.estimatedMarketPrice が不正です: ${product.productKey}`);
      assert(product.priceThesis.priceSourceRank === "ai_estimate", `priceThesis.priceSourceRank が不正です: ${product.productKey}`);
      assert(product.priceThesis.notForBuyLineReason, `priceThesis.notForBuyLineReason が空です: ${product.productKey}`);
      if (product.priceThesis.sourceMode) {
        assert(allowedThesisModes.has(product.priceThesis.sourceMode), `priceThesis.sourceMode が不正です: ${product.productKey} -> ${product.priceThesis.sourceMode}`);
      }
    }
  }

  assert(Array.isArray(priceSnapshots), "priceSnapshots が配列ではありません");
  for (const price of priceSnapshots) {
    assert(price.productKey, "priceSnapshots.productKey が空です");
    assert(price.priceType, `priceSnapshots.priceType が空です: ${price.productKey}`);
    assert(allowedPriceSourceRanks.has(price.priceSourceRank), `priceSourceRank が不正です: ${price.productKey} -> ${price.priceSourceRank}`);
    assert(["buyline", "watch"].includes(price.priceUsage), `priceUsage が不正です: ${price.productKey} -> ${price.priceUsage}`);
    assert(typeof price.buyLineEligible === "boolean", `buyLineEligible が不正です: ${price.productKey}`);
  }

  assert(Array.isArray(routeSnapshots), "routeSnapshots が配列ではありません");
  for (const route of routeSnapshots) {
    assert(route.productKey, "routeSnapshots.productKey が空です");
    assert(route.routeType, `routeSnapshots.routeType が空です: ${route.id ?? route.productKey}`);
  }

  assert(Array.isArray(selectionReasons), "selectionReasons が配列ではありません");
  for (const reason of selectionReasons) {
    assert(reason.productKey, "selectionReasons.productKey が空です");
    assert(reason.shortNow != null, `selectionReasons.shortNow が空です: ${reason.productKey}`);
  }

  assert(Array.isArray(explorationTasks), "explorationTasks が配列ではありません");
  for (const task of explorationTasks) {
    assert(task.id, "explorationTasks.id が空です");
    assert(task.kind, `explorationTasks.kind が空です: ${task.id}`);
    assert(task.status, `explorationTasks.status が空です: ${task.id}`);
    assert(task.query || task.topic || task.brand || task.series, `explorationTasks.query/topic が空です: ${task.id}`);
    assert(task.targetCategory, `explorationTasks.targetCategory が空です: ${task.id}`);
    assert(task.reason, `explorationTasks.reason が空です: ${task.id}`);
    assert(task.sourceMode, `explorationTasks.sourceMode が空です: ${task.id}`);
    assert(Array.isArray(task.expectedEvidence), `explorationTasks.expectedEvidence が配列ではありません: ${task.id}`);
  }

  assert(Array.isArray(llmExtractions), "llmExtractions が配列ではありません");
  for (const extraction of llmExtractions) {
    assert(extraction.docId, "llmExtractions.docId が空です");
    assert(extraction.model, `llmExtractions.model が空です: ${extraction.docId}`);
    assert(["openai", "gemini", "heuristic"].includes(extraction.mode), `llmExtractions.mode が不正です: ${extraction.docId} -> ${extraction.mode}`);
    assert(typeof extraction.geminiEligibilityReason === "string", `llmExtractions.geminiEligibilityReason が不正です: ${extraction.docId}`);
    assert(Array.isArray(extraction.products), `llmExtractions.products が配列ではありません: ${extraction.docId}`);
    assert(Array.isArray(extraction.events), `llmExtractions.events が配列ではありません: ${extraction.docId}`);
  }

  assert(Array.isArray(historicalComparables), "historicalComparables が配列ではありません");
  for (const comparable of historicalComparables) {
    assert(comparable.productKey, "historicalComparables.productKey が空です");
    assert(comparable.comparableKey, `historicalComparables.comparableKey が空です: ${comparable.productKey}`);
  }

  assert(Array.isArray(predictedPriceSnapshots), "predictedPriceSnapshots が配列ではありません");
  for (const price of predictedPriceSnapshots) {
    assert(price.productKey, "predictedPriceSnapshots.productKey が空です");
    assert(price.priceType, `predictedPriceSnapshots.priceType が空です: ${price.productKey}`);
    assert(Number.isFinite(price.base), `predictedPriceSnapshots.base が不正です: ${price.productKey}`);
    assert(price.priceSourceRank === "historical_prediction", `predicted priceSourceRank が不正です: ${price.productKey} -> ${price.priceSourceRank}`);
    assert(price.priceUsage === "watch", `predicted priceUsage が不正です: ${price.productKey} -> ${price.priceUsage}`);
    assert(price.buyLineEligible === false, `predicted buyLineEligible が不正です: ${price.productKey}`);
  }

  for (const candidate of candidates) {
    assert(allowedCandidateStates.has(candidate.candidateState), `candidateState が不正です: ${candidate.name} -> ${candidate.candidateState}`);
    assert(allowedCandidateStates.has(candidate.candidateStatus), `candidateStatus が不正です: ${candidate.name} -> ${candidate.candidateStatus}`);
    assert(allowedCandidateStates.has(candidate.status), `status が不正です: ${candidate.name} -> ${candidate.status}`);
    assert(Array.isArray(candidate.insufficiencyReasons), `insufficiencyReasons が配列ではありません: ${candidate.name}`);
    assert(Array.isArray(candidate.statusReasons), `statusReasons が配列ではありません: ${candidate.name}`);
    assert(typeof candidate.geminiEligible === "boolean", `geminiEligible が不正です: ${candidate.name}`);
    assert(typeof candidate.geminiEligibilityReason === "string", `geminiEligibilityReason が不正です: ${candidate.name}`);
    if (Number.isFinite(candidate.marketPrice)) {
      assert(allowedPriceSourceRanks.has(candidate.marketPriceSourceRank), `marketPriceSourceRank が不正です: ${candidate.name}`);
      assert(["buyline", "watch"].includes(candidate.marketPriceUsage), `marketPriceUsage が不正です: ${candidate.name}`);
      assert(typeof candidate.marketPriceBuyLineEligible === "boolean", `marketPriceBuyLineEligible が不正です: ${candidate.name}`);
    }
    if (Number.isFinite(candidate.retailPrice)) {
      assert(allowedPriceSourceRanks.has(candidate.retailPriceSourceRank), `retailPriceSourceRank が不正です: ${candidate.name}`);
      assert(["buyline", "watch"].includes(candidate.retailPriceUsage), `retailPriceUsage が不正です: ${candidate.name}`);
      assert(typeof candidate.retailPriceBuyLineEligible === "boolean", `retailPriceBuyLineEligible が不正です: ${candidate.name}`);
    }
  }

  assert(registrySummary && Number.isInteger(registrySummary.total), "sourceRegistrySummary.total が不正です");
  assert(registrySummary.byStatus && typeof registrySummary.byStatus === "object", "sourceRegistrySummary.byStatus がありません");
  assert(registrySummary.byLane && typeof registrySummary.byLane === "object", "sourceRegistrySummary.byLane がありません");

  assert(sourceDiscovery && typeof sourceDiscovery === "object", "sourceDiscoveryResults がありません");
  assert(Array.isArray(sourceDiscovery.discoveredSources), "sourceDiscoveryResults.discoveredSources が配列ではありません");
  assert(Array.isArray(sourceDiscovery.promotedToTrial), "sourceDiscoveryResults.promotedToTrial が配列ではありません");
  assert(Array.isArray(sourceDiscovery.promotedToActive), "sourceDiscoveryResults.promotedToActive が配列ではありません");
  assert(Number.isInteger(sourceDiscovery.trialFetched), "sourceDiscoveryResults.trialFetched が不正です");
  assert(Number.isInteger(sourceDiscovery.activeFetched), "sourceDiscoveryResults.activeFetched が不正です");
  assert(snapshot.overviewNarrative && typeof snapshot.overviewNarrative.text === "string", "overviewNarrative.text がありません");
  assert(["openai", "gemini", "heuristic"].includes(snapshot.overviewNarrative.sourceMode), `overviewNarrative.sourceMode が不正です: ${snapshot.overviewNarrative?.sourceMode}`);
  assert(snapshot.metadata.llmExecution && typeof snapshot.metadata.llmExecution === "object", "metadata.llmExecution がありません");
  assert(typeof snapshot.metadata.llmExecution.configured === "boolean", "metadata.llmExecution.configured が不正です");
  assert(typeof snapshot.metadata.llmExecution.openAiCount === "number", "metadata.llmExecution.openAiCount が不正です");
  assert(typeof snapshot.metadata.llmExecution.geminiCount === "number", "metadata.llmExecution.geminiCount が不正です");
  assert(typeof snapshot.metadata.llmExecution.heuristicCount === "number", "metadata.llmExecution.heuristicCount が不正です");
  assert(snapshot.metadata.llmExecution.modeCounts && typeof snapshot.metadata.llmExecution.modeCounts === "object", "metadata.llmExecution.modeCounts がありません");
  assert(snapshot.metadata.llmExecution.eligibilityReasonCounts && typeof snapshot.metadata.llmExecution.eligibilityReasonCounts === "object", "metadata.llmExecution.eligibilityReasonCounts がありません");
  assert(typeof snapshot.metadata.llmExecution.overviewFallbackReason === "string", "metadata.llmExecution.overviewFallbackReason が不正です");
  assert(snapshot.metadata.aiThesisSourceModeCounts && typeof snapshot.metadata.aiThesisSourceModeCounts === "object", "metadata.aiThesisSourceModeCounts がありません");
  assert(snapshot.metadata.priceThesisSourceModeCounts && typeof snapshot.metadata.priceThesisSourceModeCounts === "object", "metadata.priceThesisSourceModeCounts がありません");
  assert(snapshot.metadata.collectGuard && typeof snapshot.metadata.collectGuard === "object", "metadata.collectGuard がありません");
  assert(typeof snapshot.metadata.collectGuard.degraded === "boolean", "metadata.collectGuard.degraded が不正です");
  assert(Array.isArray(snapshot.metadata.collectGuard.reasons), "metadata.collectGuard.reasons が配列ではありません");
  assert(snapshot.metadata.collectGuard.current && typeof snapshot.metadata.collectGuard.current === "object", "metadata.collectGuard.current がありません");
  assert(snapshot.metadata.collectGuard.thresholds && typeof snapshot.metadata.collectGuard.thresholds === "object", "metadata.collectGuard.thresholds がありません");
  assert(Number.isFinite(snapshot.metadata.collectGuard.thresholds.minDocuments), "metadata.collectGuard.thresholds.minDocuments が不正です");
  assert(Number.isFinite(snapshot.metadata.collectGuard.thresholds.minProducts), "metadata.collectGuard.thresholds.minProducts が不正です");
  assert(Number.isFinite(snapshot.metadata.collectGuard.thresholds.minPreviousRatio), "metadata.collectGuard.thresholds.minPreviousRatio が不正です");
  assert(typeof snapshot.metadata.collectGuard.wroteSnapshot === "boolean", "metadata.collectGuard.wroteSnapshot が不正です");
  assert(typeof snapshot.metadata.collectGuard.wrotePartialSnapshot === "boolean", "metadata.collectGuard.wrotePartialSnapshot が不正です");
  assert(snapshot.metadata.candidateStatusCounts && typeof snapshot.metadata.candidateStatusCounts === "object", "metadata.candidateStatusCounts がありません");

  const llmExecution = snapshot.metadata.llmExecution;
  if (llmExecution.extraction && typeof llmExecution.extraction === "object") {
    assert(typeof llmExecution.extraction.requested === "number", "metadata.llmExecution.extraction.requested が不正です");
    assert(typeof llmExecution.extraction.succeeded === "number", "metadata.llmExecution.extraction.succeeded が不正です");
    assert(typeof llmExecution.extraction.failed === "number", "metadata.llmExecution.extraction.failed が不正です");
    assert(typeof llmExecution.extraction.skipped === "number", "metadata.llmExecution.extraction.skipped が不正です");
    assert(llmExecution.extraction.modeCounts && typeof llmExecution.extraction.modeCounts === "object", "metadata.llmExecution.extraction.modeCounts がありません");
  }
  if (llmExecution.overview && typeof llmExecution.overview === "object") {
    assert(["openai", "gemini", "heuristic"].includes(llmExecution.overview.sourceMode), `metadata.llmExecution.overview.sourceMode が不正です: ${llmExecution.overview.sourceMode}`);
    assert(typeof llmExecution.overview.requested === "number", "metadata.llmExecution.overview.requested が不正です");
    assert(typeof llmExecution.overview.succeeded === "number", "metadata.llmExecution.overview.succeeded が不正です");
    assert(typeof llmExecution.overview.failed === "number", "metadata.llmExecution.overview.failed が不正です");
    if (llmExecution.extraction && typeof llmExecution.extraction.requested === "number") {
      assert(
        llmExecution.overview.requested !== llmExecution.extraction.requested ||
          llmExecution.overview.succeeded !== llmExecution.extraction.succeeded ||
          llmExecution.overview.sourceMode !== "heuristic" ||
          (llmExecution.extraction.modeCounts?.gemini ?? 0) === 0,
        "overview と extraction の Gemini カウントが同一値で混同されている可能性があります",
      );
    }
  }

  const statusStdout = await runNodeScript(new URL("./marketlens-status.mjs", import.meta.url));
  const status = JSON.parse(statusStdout);
  assert(status.llmExecution?.extraction && typeof status.llmExecution.extraction === "object", "marketlens-status llmExecution.extraction がありません");
  assert(status.llmExecution?.overview && typeof status.llmExecution.overview === "object", "marketlens-status llmExecution.overview がありません");
  assert(status.llmExecution.extraction.modeCounts && typeof status.llmExecution.extraction.modeCounts === "object", "marketlens-status extraction.modeCounts がありません");
  assert(typeof status.llmExecution.overview.sourceMode === "string", "marketlens-status overview.sourceMode がありません");
  assert(
    status.llmExecution.extraction.geminiRequestedCount === status.llmExecution.legacyFlat.geminiRequestedCount,
    "marketlens-status extraction と legacyFlat の geminiRequestedCount が一致しません",
  );
  assert(
    status.llmExecution.overview.sourceMode === (snapshot.overviewNarrative?.sourceMode ?? "missing") ||
      status.llmExecution.overview.sourceMode === "missing",
    "marketlens-status overview.sourceMode が snapshot と乖離しています",
  );
  if (REQUIRE_GEMINI) {
    assert(llmExecution.configured === true, "MARKETLENS_REQUIRE_GEMINI=1 ですが metadata.llmExecution.configured が false です");
    assert(llmExecution.provider === "gemini", `MARKETLENS_REQUIRE_GEMINI=1 ですが provider=${llmExecution.provider} です`);
    assert(Array.isArray(llmExecution.actualModelUsed) && llmExecution.actualModelUsed.length > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが actualModelUsed が空です");
    assert((llmExecution.actualModelUsed ?? []).some((model) => String(model).includes("gemini")), "MARKETLENS_REQUIRE_GEMINI=1 ですが Gemini model 使用証跡がありません");
    assert(Number(llmExecution.extraction?.requested ?? 0) > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが extraction.requested=0 です");
    assert(Number(llmExecution.extraction?.succeeded ?? 0) > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが extraction.succeeded=0 です");
    assert(Number(status.llmExecution?.extraction?.requested ?? 0) > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが status extraction.requested=0 です");
    assert(Number(status.llmExecution?.extraction?.succeeded ?? 0) > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが status extraction.succeeded=0 です");
    assert(status.llmExecution?.overview?.sourceMode === "gemini", `MARKETLENS_REQUIRE_GEMINI=1 ですが status overview.sourceMode=${status.llmExecution?.overview?.sourceMode} です`);
    assert(Number(status.llmExecution?.overview?.requested ?? 0) > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが overview.requested=0 です");
    assert(Number(status.llmExecution?.overview?.succeeded ?? 0) > 0, "MARKETLENS_REQUIRE_GEMINI=1 ですが overview.succeeded=0 です");
    assert(status.llmExecution?.overview?.freshness === "current_run", `MARKETLENS_REQUIRE_GEMINI=1 ですが overview freshness=${status.llmExecution?.overview?.freshness} です`);
    assert(
      status.llmExecution?.overview?.interpretation === "overview_llm_success_this_run",
      `MARKETLENS_REQUIRE_GEMINI=1 ですが overview interpretation=${status.llmExecution?.overview?.interpretation} です`,
    );
    assert(
      !String(status.llmExecution?.overview?.fallbackReason ?? "").includes("gemini_api_key_missing"),
      "MARKETLENS_REQUIRE_GEMINI=1 ですが overview が gemini_api_key_missing fallback です",
    );
    assert(
      !String(llmExecution.overview?.fallbackReason ?? "").includes("gemini_api_key_missing"),
      "MARKETLENS_REQUIRE_GEMINI=1 ですが snapshot overview が gemini_api_key_missing fallback です",
    );
  }

  assert(resolveXSignalLabel({ url: "https://x.com/example" }) === "X確認対象", "X URLのみでは X話題 を付けない");
  assert(
    resolveXSignalLabel({ url: "https://x.com/example/status/1", text: "post body long enough" }) === "X確認対象",
    "status URL+本文ヒューリスティックだけでは X話題 を付けない",
  );
  assert(
    resolveXSignalLabel({
      url: "https://x.com/example/status/1",
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/1",
          text: "reader observed post body with enough length",
        },
      ],
    }) === "X本文確認済み",
    "reader_observed では X本文確認済み になる",
  );
  assert(
    resolveXSignalLabel({
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/2",
          text: "reader observed post body with enough length",
          engagement: { replyCount: 10, repostCount: 20, likeCount: 30, viewCount: 1000, parseConfidence: 0.8 },
        },
      ],
    }) === "X反応数値確認済み",
    "reader_observed + engagement parse では X反応数値確認済み になる",
  );
  assert(
    !resolveXSignalLabel({
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/3",
          text: "reader observed post body with enough length",
          engagement: { replyCount: 10, repostCount: 20, likeCount: 30, viewCount: 1000, parseConfidence: 0.8 },
        },
      ],
    })?.includes("バズ"),
    "reader_observed では Xでバズ 系ラベルを出さない",
  );
  assert(
    resolveXSignalLabel({
      url: "https://x.com/example/status/9",
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/9",
          text: "reader observed post body with enough length",
          engagement: { replyCount: 10, repostCount: 20, likeCount: 30, viewCount: 1000, parseConfidence: 0.69 },
        },
      ],
    }) === "X本文確認済み",
    "parseConfidence 0.69 では X本文確認済み のみ",
  );
  assert(
    resolveXSignalLabel({
      url: "https://x.com/example/status/10",
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/10",
          text: "reader observed post body with enough length",
          engagement: { replyCount: 10, repostCount: 20, likeCount: 30, viewCount: 1000, parseConfidence: 0.7 },
        },
      ],
    }) === "X反応数値確認済み",
    "parseConfidence 0.7 以上かつ engagement parse 成功時は X反応数値確認済み",
  );
  assert(
    resolveXSignalLabel({
      url: "https://x.com/BANPRE_PZ",
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/99",
          text: "reader observed post body with enough length",
          engagement: { replyCount: 10, repostCount: 20, likeCount: 30, viewCount: 1000, parseConfidence: 0.9 },
        },
      ],
    }) === "X確認対象",
    "URL不一致時は reader_observed ラベルを付けない",
  );
  assert(
    resolveXSignalLabel({
      url: "https://x.com/example/status/11",
      socialSignals: [
        {
          sourceMode: "reader_observed",
          postUrl: "https://x.com/example/status/11",
          text: "reader observed post body with enough length",
          engagement: { replyCount: 10, repostCount: 20, likeCount: 30, viewCount: 1000, parseConfidence: 0.8 },
        },
      ],
    }) !== "X話題",
    "reader_observed では X話題 を出さない",
  );

  const readerSummary = summarizeReaderObservation([
    {
      sourceMode: "reader_observed",
      postUrl: "https://x.com/example/status/21",
      text: "reader observed post body with enough length",
      engagement: { parseConfidence: 0.8, viewCount: 1000, likeCount: 10, repostCount: 2, replyCount: 1 },
    },
  ]);
  assert(readerSummary?.label === "X本文確認済み", "reader_observed summary label が不正です");
  assert(readerSummary?.count === 1, "reader_observed summary count が不正です");
  assert(readerSummary?.sourceMode === "reader_observed", "reader_observed summary sourceMode が不正です");

  const readerRows = [
    {
      sourceMode: "reader_observed",
      postUrl: "https://x.com/BANPRE_PZ/status/2061734610481136018",
      authorHandle: "@BANPRE_PZ",
      text: "reader observed post body with enough length",
    },
    {
      sourceMode: "reader_observed",
      postUrl: "https://x.com/Televi_Kun/status/2054773705193197889",
      authorHandle: "@Televi_Kun",
      text: "another reader observed post body with enough length",
    },
    {
      sourceMode: "reader_observed",
      postUrl: "https://x.com/HobbySite/status/1959814536770506807",
      authorHandle: "@HobbySite",
      text: "third reader observed post body with enough length",
    },
  ];

  assert(
    sourceResultMatchesReaderSignal({ url: "https://x.com/BANPRE_PZ/status/2061734610481136018" }, readerRows),
    "postUrl一致では sourceResultMatchesReaderSignal が true になる",
  );
  assert(
    sourceResultMatchesReaderSignal({ url: "https://x.com/BANPRE_PZ" }, readerRows),
    "authorHandle強一致では sourceResultMatchesReaderSignal が true になる",
  );
  assert(
    !sourceResultMatchesReaderSignal({ url: "https://x.com/pokecachan", signals: ["X確認対象"] }, readerRows),
    "XプロフィールURLのみでは sourceResultMatchesReaderSignal が false になる",
  );
  assert(
    !sourceResultMatchesReaderSignal({ url: "https://www.dragonquest.jp/news/detail/4245/", signals: ["X確認対象"] }, readerRows),
    "X確認対象のみでは sourceResultMatchesReaderSignal が false になる",
  );
  assert(
    !sourceResultMatchesReaderSignal({ url: "https://example.com/sns", signals: ["SNS確認待ち"] }, readerRows),
    "SNS確認待ちのみでは sourceResultMatchesReaderSignal が false になる",
  );

  const labeledSnapshot = applyReaderObservedLabels({
    socialSignals: readerRows,
    trends: [{ keyword: "sample", context: "公式グッズ / X確認対象", sourceUrl: "https://x.com/example" }],
    sourceResults: [
      { url: "https://x.com/BANPRE_PZ/status/2061734610481136018", signals: ["公式グッズ"] },
      { url: "https://x.com/pokecachan", signals: ["X確認対象"] },
      { url: "https://www.dragonquest.jp/news/detail/4245/", signals: ["X確認対象"] },
      { url: "https://x.com/RakutenBooks", signals: ["X確認対象"] },
    ],
    metadata: { xReaderExecution: { xBuzzEligible: 0 } },
  });
  assert(labeledSnapshot.metadata?.readerObservation?.count === 3, "readerObservation metadata count が不正です");
  assert(String(labeledSnapshot.trends[0]?.context ?? "").includes("X本文確認済みあり"), "trend に全体確認メモが付与されていません");
  assert(
    (labeledSnapshot.sourceResults[0]?.signals ?? []).includes("X本文確認済み"),
    "postUrl一致 sourceResults に X本文確認済み が付与されていません",
  );
  for (const result of labeledSnapshot.sourceResults.slice(1)) {
    assert(!(result.signals ?? []).includes("X本文確認済み"), `不一致 sourceResults に X本文確認済み が付いています: ${result.url}`);
  }
  assert(labeledSnapshot.sourceResults.filter((row) => (row.signals ?? []).includes("X本文確認済み")).length === 1, "sourceResults の X本文確認済み 件数が不正です");
  assert(!JSON.stringify(labeledSnapshot).includes("X話題"), "reader_observed 反映で X話題 を出さない");
  assert(!JSON.stringify(labeledSnapshot).includes("Xでバズ"), "reader_observed 反映で Xでバズ を出さない");
  assert(!JSON.stringify(labeledSnapshot).includes("SNSで急上昇"), "reader_observed 反映で SNSで急上昇 を出さない");

  const brokenParse = parseJinaMarkdown("", "https://x.com/example/status/1");
  assert(brokenParse.parseWarnings.includes("empty_response"), "engagement parse失敗時に warnings を返す");
  assert(brokenParse.engagement.parseConfidence === 0, "engagement parse失敗時も confidence=0 で落ちない");
  assert(
    marketplaceResearchTargetLabel({ hasObserved: false }) === "メルカリ確認待ち",
    "観測なしでは メルカリ相場 ラベルを出さない",
  );
  assert(
    marketplaceResearchTargetLabel({ hasObserved: false, marketplace: "yahoo" }) === "Yahoo!フリマ確認待ち",
    "観測なしでは Yahoo!フリマ確認待ち を返す",
  );
  assert(
    marketplaceResearchTargetLabel({ hasObserved: false, marketplace: "fleamarket" }) === "フリマ確認対象",
    "観測なしでは フリマ確認対象 を返す",
  );
  assert(
    marketplaceResearchTargetLabel({ hasObserved: true, marketplace: "mercari" }) === MARKETPLACE_BROWSER_OBSERVED_LABEL,
    "browser_observed_candidate では 価格候補確認済み を返す",
  );
  assert(
    marketplaceResearchTargetLabel({ hasObserved: true, marketplace: "yahoo" }) === MARKETPLACE_BROWSER_OBSERVED_LABEL,
    "browser_observed_candidate では Yahoo も 価格候補確認済み を返す",
  );
  const noisyQuery = buildMarketplaceResearchQuery({
    canonicalName: "【話題】ポケモンカード 拡張パック 相場 メルカリ",
    productName: "ポケモンカード 拡張パック",
    title: "ポケモンカード 拡張パック 話題",
    trend: "しなかん 品薄完売監視",
  });
  assert(noisyQuery.includes("ポケモンカード"), "marketplace query が商品名を保持しません");
  assert(!/相場|メルカリ|話題|しなかん|品薄完売監視/.test(noisyQuery), "marketplace query からノイズを除去できません");
  const trendOnly = buildMarketplaceResearchQuery({
    productName: "プレミアムバンダイ",
    trend: "しなかん 品薄完売監視",
  });
  assert(trendOnly === "プレミアムバンダイ" || assessMarketplaceQueryRejectReason(trendOnly, { primaryName: "プレミアムバンダイ" }) === "query_too_generic", "trend が productName より優先されています");
  assert(assessMarketplaceQueryRejectReason("しなかん 品薄完売監視") === "query_trend_label", "監視フレーズを拒否できません");
  assert(assessMarketplaceQueryRejectReason("絵美のせどり部屋 テスト商品") === "query_article_title", "ブログ媒体名を拒否できません");
  assert(decodeHtmlEntities("スカーレット&amp;バイオレット").includes("スカーレット&バイオレット"), "&amp; をデコードできません");
  assert(decodeHtmlEntities("Pok&eacute;mon").includes("Pokémon"), "&eacute; をデコードできません");
  assert(assessMarketplaceQueryRejectReason("S.H.Figuarts METAL BUILD /X") === "query_mojibake", "文字化け候補を拒否できません");
  assert(
    !assessMarketplaceQueryRejectReason("ROBOT魂 ガンダム", { primaryName: "ROBOT魂 ガンダム" }),
    "ROBOT魂 を concrete 判定できません",
  );
  const munikisZeroQuery = buildMarketplaceResearchQuery({
    productName: "ポケモンカードゲーム MEGA 拡張パック ムニキスゼロ BOX",
    category: "pokemon",
  });
  assert(munikisZeroQuery === "ムニキスゼロ BOX", "ポケカ具体弾 query を名寄せできません");
  assert(
    assessMarketplaceQueryRejectReason("フィギュアを実際に組み立ててみた コラム 2026/6/7") === "query_article_title",
    "コラム記事 query を拒否できません",
  );
  const movieQuery = buildMarketplaceResearchQuery({
    productName: "映画クレヨンしんちゃん アクション仮面VSハイグレ魔王 ムビチケ前売券",
    category: "movie_goods",
  });
  assert(
    !assessMarketplaceQueryRejectReason(movieQuery, {
      primaryName: "映画クレヨンしんちゃん アクション仮面VSハイグレ魔王 ムビチケ前売券",
      category: "movie_goods",
    }),
    "movie 具体名 query を拒否してしまいます",
  );
  assert(buildMercariSearchUrl(noisyQuery).includes("jp.mercari.com/search"), "mercari searchUrl が不正です");
  assert(buildYahooFleamarketSearchUrl(noisyQuery).includes("paypayfleamarket.yahoo.co.jp/search"), "yahoo searchUrl が不正です");
  assert(
    buildYahooRealtimeSearchUrl("ポケモンカード ムニキスゼロ BOX").includes("search.yahoo.co.jp/realtime/search"),
    "yahoo realtime searchUrl が不正です",
  );
  assert(realtimeResearchTargetLabel() === "Yahooリアルタイム確認", "realtime label が不正です");
  const browserSignal = normalizeMarketplaceBrowserSignal({
    marketplace: "mercari",
    query: "テスト",
    listingCandidates: [
      {
        value: 1200,
        currency: "JPY",
        rawPriceText: "¥1,200",
        title: "テスト商品",
        itemUrl: "https://jp.mercari.com/item/m12345678901",
        shippingIncluded: true,
      },
    ],
    buyLineEligible: true,
    priceSourceRank: "observed_market_price",
  });
  assert(isBrowserObservedPriceCandidate(browserSignal), "browser_observed_candidate が認識されません");
  assert(browserSignal.buyLineEligible === false, "browser signal が BuyLine 対象です");
  assert(browserSignal.priceSourceRank === "browser_observed_candidate", "browser signal rank が不正です");
  assert(browserSignal.listingCandidates.length === 1, "listingCandidates が正規化されません");
  assert(browserSignal.listingCandidates[0].shippingIncluded === null, "shippingIncluded を断定しません");
  assert(browserSignal.listingCandidates[0].currency === "JPY", "JPY currency が保持されません");
  assert(browserSignal.listingCandidates[0].rawPriceText === "¥1,200", "rawPriceText が保持されません");
  assert(
    normalizeMarketplaceBrowserSignal({
      marketplace: "mercari",
      listingCandidates: [{ value: 100, title: "bad", itemUrl: "https://jp.mercari.com/search?keyword=test" }],
    }).listingCandidates.length === 0,
    "検索URLを itemUrl として保存しません",
  );
  const usdPrice = parseMercariListingPrice("US$12.97");
  assert(usdPrice.currency === "USD", "US$ を USD として扱えません");
  assert(usdPrice.value === 12.97, "US$ value が不正です");
  assert(usdPrice.rawPriceText === "US$12.97", "US$ rawPriceText が不正です");
  assert(formatMarketplaceListingPrice(usdPrice) === "US$12.97", "USD 表示が不正です");
  const jpyPrice = parseMercariListingPrice("¥12,800");
  assert(jpyPrice.currency === "JPY", "¥ を JPY として扱えません");
  assert(jpyPrice.value === 12800, "JPY value が不正です");
  assert(formatMarketplaceListingPrice(jpyPrice) === "¥12,800", "JPY 表示が不正です");
  const jpySuffix = parseMercariListingPrice("12,800円");
  assert(jpySuffix.currency === "JPY", "円 suffix を JPY として扱えません");
  const mercariSample = parseMercariSearchMarkdown(
    "*   [![Image 1: テスト商品のサムネイル](https://static.mercdn.net/thumb/item/webp/m55011768223_1.jpg) US$12.97 テスト商品](https://jp.mercari.com/item/m55011768223)",
    "テスト商品",
  );
  assert(mercariSample.observationStatus === "succeeded", "mercari parser が listing を抽出しません");
  assert(mercariSample.listingCandidates.length === 1, "mercari listingCandidates が空です");
  assert(mercariSample.listingCandidates[0].title === "テスト商品", "mercari title が不正です");
  assert(mercariSample.listingCandidates[0].itemUrl.includes("/item/m"), "mercari itemUrl が不正です");
  assert(mercariSample.listingCandidates[0].currency === "USD", "US$ listing が JPY 扱いされています");
  assert(mercariSample.listingCandidates[0].rawPriceText === "US$12.97", "mercari rawPriceText が不正です");
  assert(formatMarketplaceListingPrice(mercariSample.listingCandidates[0]) === "US$12.97", "USD listing を円表示しています");
  assert(
    signalNeedsCurrencyRecheck({
      listingCandidates: [{ currency: "unknown", value: 16.74, rawPriceText: "16.74", title: "t", itemUrl: "https://jp.mercari.com/item/m1" }],
    }),
    "legacy unknown signal が recheck 対象になりません",
  );
  assert(
    !signalNeedsCurrencyRecheck({
      listingCandidates: [{ currency: "USD", value: 12, rawPriceText: "US$12", title: "t", itemUrl: "https://jp.mercari.com/item/m2" }],
    }),
    "USD signal が誤って recheck 対象です",
  );
  const unknownDisplay = formatMarketplaceListingPrice({ currency: "unknown", value: 16.74, rawPriceText: "16.74" });
  assert(!unknownDisplay.startsWith("¥"), "unknown に円記号が付きます");
  const quality = summarizeMarketplaceSignalQuality([
    {
      listingCandidates: [
        { currency: "USD", value: 12, rawPriceText: "US$12", title: "a", itemUrl: "https://jp.mercari.com/item/m1" },
        { currency: "USD", value: 20, rawPriceText: "US$20", title: "b", itemUrl: "https://jp.mercari.com/item/m2" },
      ],
    },
  ]);
  assert(quality.signalsWithUsdOnly === 1, "signalsWithUsdOnly が不正です");
  assert(quality.averageListingCandidatesPerSignal === 2, "averageListingCandidatesPerSignal が不正です");
  assert(
    sanitizeClaimText("公式グッズ・X話題・メルカリ相場", { xPostText: 0, xEngagement: 0, marketplacePriceSnapshots: 0 }) ===
      "公式グッズ・X確認対象・メルカリ確認待ち",
    "誤解ラベルの置換が効きません",
  );

  const observation = status.observation ?? countObservationMetrics(snapshot);
  assert(observation && typeof observation === "object", "observation metrics がありません");
  assert(Number.isInteger(observation.observedMarketPrice), "observedMarketPrice が不正です");
  assert(Number.isInteger(observation.marketplacePriceSnapshots), "marketplacePriceSnapshots が不正です");
  assert(Number.isInteger(observation.socialSignals), "observation.socialSignals が不正です");
  assert(Number.isInteger(observation.xStatusUrlCandidates), "observation.xStatusUrlCandidates が不正です");
  assert(Number.isInteger(observation.xReaderRequested), "observation.xReaderRequested が不正です");
  assert(Number.isInteger(observation.xReaderSucceeded), "observation.xReaderSucceeded が不正です");
  assert(Number.isInteger(observation.xReaderFailed), "observation.xReaderFailed が不正です");
  assert(Number.isInteger(observation.xReaderObservedText), "observation.xReaderObservedText が不正です");
  assert(Number.isInteger(observation.xReaderEngagementParsed), "observation.xReaderEngagementParsed が不正です");
  assert(Number.isInteger(observation.xReaderParseWarnings), "observation.xReaderParseWarnings が不正です");
  assert(Number.isInteger(observation.xBuzzEligible), "observation.xBuzzEligible が不正です");
  assert(observation.xBuzzEligible === 0, "reader_observed のみでは xBuzzEligible は 0");
  assert(Number.isInteger(observation.xObservationQueueTotal), "observation.xObservationQueueTotal が不正です");
  assert(Number.isInteger(observation.xObservationQueuePending), "observation.xObservationQueuePending が不正です");
  assert(Number.isInteger(observation.xObservationQueueObserved), "observation.xObservationQueueObserved が不正です");
  assert(Number.isInteger(observation.xObservationQueueFailed), "observation.xObservationQueueFailed が不正です");
  assert(Number.isInteger(observation.xObservationQueueSkipped), "observation.xObservationQueueSkipped が不正です");
  assert(Number.isInteger(observation.xObservationQueueStale), "observation.xObservationQueueStale が不正です");
  const queueLimit = Number(snapshot.metadata?.observationLimits?.xQueueLimit ?? snapshot.metadata?.xReaderExecution?.queueLimit ?? 500);
  assert(observation.xObservationQueueTotal >= 80, `xObservationQueue が80件未満です: ${observation.xObservationQueueTotal}`);
  assert(observation.xObservationQueueTotal <= queueLimit, `xObservationQueue が queue limit を超えています: ${observation.xObservationQueueTotal}`);
  assert(queueLimit <= 500, `xQueueLimit hard max を超えています: ${queueLimit}`);
  assert(observation.xReaderRequested <= 20, `xReaderRequested が20超です: ${observation.xReaderRequested}`);
  assert(
    observation.xReaderRequested <= Number(snapshot.metadata?.xReaderExecution?.limit ?? snapshot.metadata?.observationLimits?.xReaderLimit ?? 20),
    "xReaderRequested が batch limit を超えています",
  );
  assert(Array.isArray(snapshot.xObservationQueue), "xObservationQueue が配列ではありません");
  assert(snapshot.xObservationQueue.length === observation.xObservationQueueTotal, "xObservationQueue 件数が不一致です");
  for (const item of snapshot.xObservationQueue.slice(0, 12)) {
    assert(item.postUrl, "xObservationQueue.postUrl が空です");
    assert(/\/status\/\d{10,}/.test(item.postUrl), `profile URL が queue に混入: ${item.postUrl}`);
    assert(["pending", "reader_observed", "failed", "skipped", "stale"].includes(item.status), `queue status が不正: ${item.status}`);
  }
  assert(observation.observationLimits && typeof observation.observationLimits === "object", "observationLimits がありません");
  assert(observation.forbiddenLabels && typeof observation.forbiddenLabels === "object", "forbiddenLabels がありません");
  assert(observation.forbiddenLabelDetected === false, `禁止ラベルが検出されました: ${JSON.stringify(observation.forbiddenLabels)}`);
  const snapshotBlob = JSON.stringify(snapshot);
  assert(!snapshotBlob.includes("X反応確認済み"), "snapshot に旧ラベル X反応確認済み が残っています");
  assert(!snapshotBlob.includes("Xでバズ"), "snapshot に Xでバズ が残っています");
  if ((observation.xObservedApi ?? 0) === 0) {
    assert(!snapshotBlob.includes("X話題"), "observed_api なしで snapshot に X話題 が残っています");
  }
  if ((observation.xPostText ?? 0) === 0 && (observation.xEngagement ?? 0) === 0 && (observation.xReaderObservedText ?? 0) === 0) {
    for (const product of normalizedProducts) {
      assert(!String(product.aiThesis?.whyHot ?? "").includes("X話題"), `X実測なしで X話題: ${product.canonicalName}`);
    }
    for (const candidate of candidates) {
      assert(!String(candidate.aiThesis?.whyHot ?? "").includes("X話題"), `候補aiThesisに X話題: ${candidate.name}`);
    }
    for (const reason of snapshot.selectionReasons ?? []) {
      const blob = JSON.stringify(reason);
      assert(!blob.includes("X話題"), `selectionReasons に X話題 が残っています: ${reason.productName}`);
      assert(!/メルカリ相場|フリマ相場/.test(blob), `selectionReasons に実測なし相場断定: ${reason.productName}`);
    }
  }
  if ((observation.marketplacePriceSnapshots ?? 0) === 0) {
    assert(observation.observedMarketPrice === 0, "marketplace観測0件なのに observedMarketPrice が非0です");
  }

  assert(Array.isArray(marketplaceResearchTargets), "marketplaceResearchTargets が配列ではありません");
  assert(Number.isInteger(observation.marketplaceResearchTargets), "observation.marketplaceResearchTargets が不正です");
  assert(Number.isInteger(observation.mercariCheckUrl), "observation.mercariCheckUrl が不正です");
  assert(Number.isInteger(observation.yahooFleamarketCheckUrl), "observation.yahooFleamarketCheckUrl が不正です");
  assert(observation.marketplaceResearchTargets === marketplaceResearchTargets.length, "marketplaceResearchTargets 件数が不一致です");
  assert(marketplaceResearchTargets.length > 0, "marketplaceResearchTargets が 0 件です");
  for (const target of marketplaceResearchTargets) {
    assert(target.marketplace, `marketplaceResearchTargets.marketplace が空です: ${target.id}`);
    assert(target.query, `marketplaceResearchTargets.query が空です: ${target.id}`);
    assert(target.searchUrl, `marketplaceResearchTargets.searchUrl が空です: ${target.id}`);
    assert(target.sourceMode === "manual_check", `marketplaceResearchTargets.sourceMode が manual_check ではありません: ${target.id}`);
    assert(target.buyLineEligible === false, `marketplaceResearchTargets.buyLineEligible が true です: ${target.id}`);
    assert(Array.isArray(target.expectedEvidence) && target.expectedEvidence.length >= 5, `expectedEvidence が不足: ${target.id}`);
    assert(!/メルカリ相場|フリマ相場/.test(String(target.label ?? "")), `禁止ラベルが target.label にあります: ${target.id}`);
    assert(!/しなかん|品薄完売監視|絵美のせどり部屋|&amp;/.test(String(target.query ?? "")), `低品質 query が残っています: ${target.id}`);
    assert(!assessMarketplaceQueryRejectReason(target.query, { primaryName: target.productName, category: target.targetCategory }), `除外対象 query が残っています: ${target.id}`);
  }
  const manualCheckTasks = explorationTasks.filter((task) => task.sourceMode === "manual_check" || task.kind === "marketplace_check");
  for (const task of manualCheckTasks) {
    assert(task.searchUrl, `manual_check task に searchUrl がありません: ${task.id}`);
    assert(task.buyLineEligible === false, `manual_check task が BuyLine 対象です: ${task.id}`);
    assert(task.sourceMode === "manual_check", `manual_check task の sourceMode が不正です: ${task.id}`);
  }
  for (const price of priceSnapshots) {
    if (String(price.sourceMode ?? "") === "manual_check") {
      assert(price.buyLineEligible === false, `manual_check priceSnapshot が BuyLine 対象です: ${price.productKey}`);
      assert(price.priceSourceRank !== "observed_market_price", `manual_check が observed_market_price です: ${price.productKey}`);
    }
  }
  if ((observation.observedMarketPrice ?? 0) === 0) {
    assert(!/メルカリ相場|フリマ相場/.test(snapshotBlob), "observed_market_price 0 で禁止相場ラベルが snapshot に残っています");
  }
  const mercariTargets = marketplaceResearchTargets.filter((target) => target.marketplace === "mercari");
  const yahooTargets = marketplaceResearchTargets.filter((target) => target.marketplace === "yahoo");
  const pokemonSpecificTargets = mercariTargets.filter((target) =>
    /ムニキスゼロ|ロケット団|テラスタルフェス|トリプレットビート/.test(target.query),
  );
  const namedMovieTargets = mercariTargets.filter(
    (target) => /映画|劇場版/.test(target.query) && /ムビチケ/.test(target.query),
  );
  const kujiTargets = mercariTargets.filter((target) => /一番くじ/i.test(target.query));
  const mascotTargets = mercariTargets.filter((target) => /マスコット|ソフビ/i.test(target.query));
  const subjectCount = Number(
    observation.marketplaceResearchSubjectCount ?? snapshot.metadata?.marketplaceResearchSubjectCount ?? 0,
  );
  const subjectLimit = Number(
    observation.observationLimits?.marketplaceSubjectLimit ?? snapshot.metadata?.marketplaceResearchSubjectLimit ?? 200,
  );
  const targetLimit = Math.min(subjectLimit * 2, 1000);
  assert(subjectCount >= 90, `marketplace subject が90件未満です: ${subjectCount}`);
  assert(subjectCount <= subjectLimit, `marketplace subject が subject limit を超えています: ${subjectCount}`);
  assert(subjectLimit <= 500, `marketplace subject hard max を超えています: ${subjectLimit}`);
  assert(
    marketplaceResearchTargets.length <= targetLimit,
    `marketplaceResearchTargets が subject limit x2 を超えています: ${marketplaceResearchTargets.length}`,
  );
  assert(marketplaceResearchTargets.length <= 1000, `marketplaceResearchTargets が1000件超です: ${marketplaceResearchTargets.length}`);
  assert(mercariTargets.length === subjectCount, "mercari URL 件数が subjectCount と不一致です");
  assert(yahooTargets.length === subjectCount, "Yahoo!フリマ URL 件数が subjectCount と不一致です");
  assert(pokemonSpecificTargets.length >= 4, `ポケカ具体弾が4件未満です: ${pokemonSpecificTargets.length}`);
  assert(namedMovieTargets.length >= 1, "映画名付きムビチケがありません");
  assert(kujiTargets.length <= subjectCount, `kuji が subject 総数超です: ${kujiTargets.length}`);
  assert(mascotTargets.length <= subjectCount, `mascot が subject 総数超です: ${mascotTargets.length}`);
  assert(kujiTargets.length >= 1, "kuji カテゴリがありません");
  assert(Number.isInteger(observation.marketplaceDisplayCount), "marketplaceDisplayCount が不正です");
  assert(observation.marketplaceDisplayCount <= 30, `marketplace UI表示件数が30超です: ${observation.marketplaceDisplayCount}`);
  assert(observation.marketplaceDisplayCount <= observation.marketplaceResearchTargets, "marketplaceDisplayCount が総数超です");
  assert(observation.marketplaceExcludedUniqueCounts && typeof observation.marketplaceExcludedUniqueCounts === "object", "marketplaceExcludedUniqueCounts がありません");
  assert(!mercariTargets.some((target) => /デッキシールド|プレイマット/.test(target.query)), "サプライが marketplaceResearchTargets に残っています");
  assert(!mercariTargets.some((target) => /ムビチケ前売券\s*＆超豪華グッズ/.test(target.query)), "弱いムビチケが残っています");
  assert(snapshot.metadata?.marketplaceSelectionSummary?.byCategory, "marketplaceSelectionSummary が metadata にありません");
  assert(snapshot.metadata?.marketplaceSelectionSummary?.byCategoryDisplay, "byCategoryDisplay が metadata にありません");
  assert(snapshot.metadata?.marketplaceCategoryDisplayMap?.thin === "小型物", "category表示マップがありません");

  const realtimeResearchTargets = Array.isArray(snapshot.realtimeResearchTargets) ? snapshot.realtimeResearchTargets : [];
  assert(Number.isInteger(observation.realtimeResearchTargets), "observation.realtimeResearchTargets が不正です");
  assert(Number.isInteger(observation.yahooRealtimeCheckUrl), "observation.yahooRealtimeCheckUrl が不正です");
  assert(Number.isInteger(observation.socialSearchSignals), "observation.socialSearchSignals が不正です");
  assert(Number.isInteger(observation.browserObservedPriceCandidates), "observation.browserObservedPriceCandidates が不正です");
  assert(observation.realtimeResearchTargets === realtimeResearchTargets.length, "realtimeResearchTargets 件数が不一致です");
  assert(realtimeResearchTargets.length === subjectCount, "realtimeResearchTargets が subjectCount と不一致です");
  const realtimeTargetsWithSearchUrl = realtimeResearchTargets.filter((target) => target.searchUrl).length;
  assert(observation.yahooRealtimeCheckUrl === realtimeTargetsWithSearchUrl, "yahooRealtimeCheckUrl 件数が不一致です");
  assert(realtimeTargetsWithSearchUrl >= subjectCount - 10, `searchUrl 生成済み realtime target が少なすぎます: ${realtimeTargetsWithSearchUrl}`);
  assert(Number.isInteger(observation.realtimeDisplayCount), "realtimeDisplayCount が不正です");
  assert(observation.realtimeDisplayCount <= 15, `realtime UI表示件数が15超です: ${observation.realtimeDisplayCount}`);
  assert(observation.buyLineEligibleFalseCounts && typeof observation.buyLineEligibleFalseCounts === "object", "buyLineEligibleFalseCounts がありません");
  assert(
    observation.buyLineEligibleFalseCounts.realtimeResearchTargets === realtimeResearchTargets.length,
    "realtimeResearchTargets の buyLineEligible=false 件数が不一致です",
  );
  for (const target of realtimeResearchTargets.slice(0, 12)) {
    assert(target.searchUrl, `realtimeResearchTargets.searchUrl が空です: ${target.id}`);
    assert(target.sourceMode === "browser_check", `realtime sourceMode が browser_check ではありません: ${target.id}`);
    assert(target.buyLineEligible === false, `realtime target が BuyLine 対象です: ${target.id}`);
    assert(target.buzzEligible === false, `realtime target が buzzEligible です: ${target.id}`);
    assert(!/Xでバズ|X話題|メルカリ相場|フリマ相場|実勢相場|SNS急上昇|SNSで急上昇/.test(String(target.label ?? "")), `禁止ラベルが realtime.label にあります: ${target.id}`);
    assert(target.searchUrl.includes("search.yahoo.co.jp/realtime/search"), `realtime searchUrl が不正です: ${target.id}`);
  }
  for (const signal of snapshot.marketplaceSignals ?? []) {
    if (signal?.priceSourceRank === "browser_observed_candidate") {
      assert(signal.buyLineEligible === false, "browser_observed_candidate が BuyLine 対象です");
      assert(signal.sourceMode === "browser_observed", "browser_observed_candidate の sourceMode が不正です");
      assert(Array.isArray(signal.listingCandidates), "listingCandidates が配列ではありません");
      for (const listing of signal.listingCandidates ?? []) {
        assert(Number.isFinite(Number(listing.value)) && Number(listing.value) > 0, "listingCandidates.value が不正です");
        assert(["JPY", "USD", "unknown"].includes(String(listing.currency ?? "")), "listingCandidates.currency が不正です");
        assert(String(listing.rawPriceText ?? "").trim(), "listingCandidates.rawPriceText が空です");
        assert(String(listing.title ?? "").trim(), "listingCandidates.title が空です");
        assert(/^https:\/\/jp\.mercari\.com\/item\/m\d+$/i.test(String(listing.itemUrl ?? "")), "listingCandidates.itemUrl が不正です");
        assert(!/\/search\?keyword=/i.test(String(listing.itemUrl ?? "")), "検索URLを itemUrl として保存しています");
        assert(listing.shippingIncluded === null || listing.shippingIncluded === false, "shippingIncluded=true を断定しています");
        if (listing.currency === "USD") {
          assert(/^US\$/i.test(String(listing.rawPriceText ?? "")) || /^\$/i.test(String(listing.rawPriceText ?? "")), "USD rawPriceText が不正です");
          assert(formatMarketplaceListingPrice(listing).startsWith("US$"), "USD listing を円表示しています");
        }
        if (listing.currency === "JPY") {
          assert(/^(?:¥|￥)|円$/u.test(String(listing.rawPriceText ?? "")), "JPY rawPriceText が不正です");
          assert(formatMarketplaceListingPrice(listing).startsWith("¥"), "JPY listing 表示が不正です");
        }
        if (listing.currency === "unknown") {
          assert(!formatMarketplaceListingPrice(listing).startsWith("¥"), "unknown listing に円記号が付きます");
          assert(!formatMarketplaceListingPrice(listing).startsWith("US$"), "unknown listing を USD 表示しています");
        }
      }
    }
  }
  assert(Number.isInteger(observation.signalsWithUnknownCurrency), "signalsWithUnknownCurrency が不正です");
  assert(Number.isInteger(observation.signalsWithUsdOnly), "signalsWithUsdOnly が不正です");
  assert(Number.isInteger(observation.signalsWithJpy), "signalsWithJpy が不正です");
  assert(Number.isFinite(observation.averageListingCandidatesPerSignal), "averageListingCandidatesPerSignal が不正です");
  const qualityFromObservation = summarizeMarketplaceSignalQuality(snapshot.marketplaceSignals ?? []);
  assert(
    observation.signalsWithUnknownCurrency === qualityFromObservation.signalsWithUnknownCurrency,
    "signalsWithUnknownCurrency 件数が不一致です",
  );
  assert(
    !(snapshot.priceSnapshots ?? []).some((price) => price.priceSourceRank === "browser_observed_candidate"),
    "priceSnapshots に browser_observed_candidate が混入しています",
  );
  assert(
    !(snapshot.priceSnapshots ?? []).some(
      (price) => price.priceSourceRank === "browser_observed_candidate" && price.buyLineEligible,
    ),
    "priceSnapshots に browser_observed_candidate の BuyLine 混入があります",
  );
  const marketplaceBrowserLimit = Number(
    observation.observationLimits?.marketplaceBrowserObservationLimit ??
      snapshot.metadata?.marketplaceObservationExecution?.batchLimit ??
      2,
  );
  assert(Number.isInteger(observation.marketplaceObservationRequested), "marketplaceObservationRequested が不正です");
  assert(Number.isInteger(observation.marketplaceObservationSucceeded), "marketplaceObservationSucceeded が不正です");
  assert(Number.isInteger(observation.marketplaceObservationFailed), "marketplaceObservationFailed が不正です");
  assert(Number.isInteger(observation.marketplaceObservationSkipped), "marketplaceObservationSkipped が不正です");
  assert(Number.isInteger(observation.marketplaceListingCandidateCount), "marketplaceListingCandidateCount が不正です");
  assert(
    observation.marketplaceObservationRequested <= marketplaceBrowserLimit,
    "marketplaceObservationRequested が limit 超です",
  );
  assert(marketplaceBrowserLimit <= 5, `marketplace browser observation limit が hard max 5 超です: ${marketplaceBrowserLimit}`);
  assert(
    observation.marketplaceObservationByStatus && typeof observation.marketplaceObservationByStatus === "object",
    "marketplaceObservationByStatus がありません",
  );
  assert(
    observation.marketplaceListingCurrencyDistribution && typeof observation.marketplaceListingCurrencyDistribution === "object",
    "marketplaceListingCurrencyDistribution がありません",
  );
  const usdListings = Number(observation.marketplaceListingCurrencyDistribution?.USD ?? 0);
  if (usdListings > 0) {
    for (const signal of snapshot.marketplaceSignals ?? []) {
      for (const listing of signal.listingCandidates ?? []) {
        if (listing.currency !== "USD") continue;
        assert(!formatMarketplaceListingPrice(listing).startsWith("¥"), "USD を円表示しています");
      }
    }
  }
  if (Array.isArray(snapshot.marketplaceObservationQueue) && snapshot.marketplaceObservationQueue.length > 0) {
    for (const item of snapshot.marketplaceObservationQueue.slice(0, 12)) {
      assert(item.id, "marketplaceObservationQueue.id が空です");
      assert(
        ["pending", "browser_observed", "failed", "skipped", "stale"].includes(item.status),
        `marketplaceObservationQueue.status が不正: ${item.status}`,
      );
    }
  }
  if ((observation.marketplaceObservationFailed ?? 0) > 0 || (observation.marketplaceObservationByStatus?.blocked ?? 0) > 0) {
    const observedBefore = Number(snapshot.metadata?.collectGuard?.previous?.observedMarketPrice ?? observation.observedMarketPrice);
    const marketplaceObservationSucceeded = Number(observation.marketplaceObservationSucceeded ?? 0);
    assert(
      marketplaceObservationSucceeded > 0 ||
        (observation.observedMarketPrice ?? 0) <= observedBefore + 2,
      "marketplace observation failed/blocked 後に observed_market_price が増えています",
    );
  }
  assert(!observation.forbiddenLabels?.snsRising, "snapshot に SNS急上昇 系ラベルが残っています");

  const socialSearchSignals = Array.isArray(snapshot.socialSearchSignals) ? snapshot.socialSearchSignals : [];
  const browserObservationLimit = Number(
    observation.observationLimits?.browserObservationBatchLimit ??
      snapshot.metadata?.browserObservationExecution?.batchLimit ??
      5,
  );
  assert(Number.isInteger(observation.browserObservationRequested), "browserObservationRequested が不正です");
  assert(Number.isInteger(observation.browserObservationSucceeded), "browserObservationSucceeded が不正です");
  assert(Number.isInteger(observation.browserObservationFailed), "browserObservationFailed が不正です");
  assert(Number.isInteger(observation.browserObservationSkipped), "browserObservationSkipped が不正です");
  assert(Number.isInteger(observation.socialSearchSignalsObserved), "socialSearchSignalsObserved が不正です");
  assert(Number.isInteger(observation.browserObservedRealtimeCandidates), "browserObservedRealtimeCandidates が不正です");
  assert(Number.isInteger(observation.realtimeResearchTargetsPending), "realtimeResearchTargetsPending が不正です");
  assert(observation.browserObservationRequested <= browserObservationLimit, "browserObservationRequested が limit 超です");
  assert(browserObservationLimit <= 10, `browser observation limit が hard max 10 超です: ${browserObservationLimit}`);
  assert(
    observation.socialSearchSignalsObserved === socialSearchSignals.filter((row) => row.sourceMode === "browser_observed").length,
    "socialSearchSignalsObserved 件数が不一致です",
  );
  for (const signal of socialSearchSignals) {
    assert(signal.buzzEligible === false, "socialSearchSignals.buzzEligible が true です");
    assert(signal.sourceMode === "browser_observed", "socialSearchSignals.sourceMode が browser_observed ではありません");
    assert(!/Xでバズ|SNS急上昇|SNSで急上昇|X話題|話題化|急上昇/.test(JSON.stringify(signal)), "socialSearchSignals に禁止ラベルがあります");
  }
  const socialSignalKeys = new Set((snapshot.socialSignals ?? []).map((row) => `${row.postUrl ?? ""}::${row.text ?? ""}`));
  for (const signal of socialSearchSignals) {
    for (const sample of signal.samples ?? []) {
      const key = `${sample.sourceUrl ?? ""}::${sample.text ?? ""}`;
      assert(!socialSignalKeys.has(key), "socialSearchSignals が socialSignals に混入しています");
    }
  }
  assert(
    !(snapshot.priceSnapshots ?? []).some((price) => price.sourceMode === "browser_observed" || price.priceSourceRank === "browser_observed"),
    "priceSnapshots に browser_observed が混入しています",
  );
  if ((observation.browserObservationFailed ?? 0) > 0 || (observation.browserObservationByStatus?.blocked ?? 0) > 0) {
    assert(
      !(snapshot.priceSnapshots ?? []).some(
        (price) =>
          price.sourceMode === "browser_observed" ||
          price.provider === "yahoo_realtime" ||
          String(price.query ?? "").length > 0 && price.priceSourceRank === "observed_market_price",
      ),
      "browser observation failed/blocked 後に priceSnapshots へ観測価格が混入しています",
    );
  }
  if (Array.isArray(snapshot.browserObservationQueue) && snapshot.browserObservationQueue.length > 0) {
    for (const item of snapshot.browserObservationQueue.slice(0, 12)) {
      assert(item.id, "browserObservationQueue.id が空です");
      if (item.status !== "skipped" || item.observationQuery) {
        assert(item.searchUrl || item.status === "skipped", `browserObservationQueue.searchUrl が空です: ${item.id}`);
      }
      assert(
        ["pending", "browser_observed", "failed", "skipped", "stale"].includes(item.status),
        `browserObservationQueue.status が不正: ${item.status}`,
      );
    }
  }
  assert(Number.isInteger(observation.realtimeResearchTargetsFailed), "realtimeResearchTargetsFailed が不正です");
  assert(Number.isInteger(observation.realtimeResearchTargetsSkipped), "realtimeResearchTargetsSkipped が不正です");
  assert(observation.buyLineBrowserMixDetected === false, "BuyLine に browser observation 混入があります");
  assert(observation.browserObservedInPriceSnapshots === false, "priceSnapshots に browser_observed 混入があります");
  assertBrowserObservedPromotionGates(snapshot, observation, snapshotBlob, priceSnapshots);
  const buyLineSources = observation.buyLineEligibleSources ?? {};
  const allowedBuyLineSources = new Set(["manual_price", "confirmed_price", "observed_market_price"]);
  for (const [rank, count] of Object.entries(buyLineSources)) {
    assert(allowedBuyLineSources.has(rank), `BuyLine 対象外 rank が含まれています: ${rank}`);
    assert(Number(count) > 0, `BuyLine source count が不正です: ${rank}`);
  }
  assert(
    Object.keys(buyLineSources).length > 0,
    `buyLineEligibleSources が空です: ${JSON.stringify(buyLineSources)}`,
  );
  assert((observation.jpyCandidate?.jpyCandidateBuyLineEligibleTrue ?? 0) === 0, "jpyCandidate BuyLine 昇格が検出されました");
  assert((observation.jpyCandidate?.priceSnapshotsJpyCandidateMix ?? 0) === 0, "priceSnapshots jpyCandidate 混入があります");
  assert(
    (observation.jpyCandidate?.observedMarketPricePromotionCount ?? 0) === (observation.observedMarketPrice ?? 0),
    "observed_market_price 件数が status と jpyCandidate 集計で一致しません",
  );
  for (const message of assertProvisionalBuyLineGates(snapshot, observation)) {
    assert(false, message);
  }
  assert(
    observation.socialSearchConfidenceDistribution && typeof observation.socialSearchConfidenceDistribution === "object",
    "socialSearchConfidenceDistribution がありません",
  );
  for (const signal of socialSearchSignals) {
    if (Number(signal.confidence ?? 0) < SOCIAL_SEARCH_CONFIDENCE_BADGE_MIN) {
      assert(signal.confidence < SOCIAL_SEARCH_CONFIDENCE_BADGE_MIN, "低 confidence の閾値判定が不正です");
    }
  }
  const descriptionSkip = prepareRealtimeObservationQuery({
    query: "A賞からC賞までフィギュアで",
    productName: "A賞からC賞までフィギュアで",
  });
  assert(descriptionSkip.ok === false, "説明文 query が skip されません");
  assert(descriptionSkip.skipReason === "realtime_query_description", "説明文 skipReason が不正です");
  const longSkip = prepareRealtimeObservationQuery({
    query: "BUSTISAN 360°どこから見ても圧倒的な存在感を放つ一番くじ胸像シリーズ",
    productName: "BUSTISAN 360°どこから見ても圧倒的な存在感を放つ一番くじ胸像シリーズ",
  });
  assert(longSkip.ok === false, "長文説明 query が skip/短縮判定されません");
  const shortenOk = prepareRealtimeObservationQuery({
    query: "A賞 有村麻央 フィギュア 1/7 Gracemaster",
    productName: "A賞 有村麻央 フィギュア 1/7 Gracemaster",
  });
  assert(shortenOk.ok === true, "具体 query が observation 対象になりません");
  assert(
    shortenOk.query.length <= REALTIME_OBSERVATION_QUERY_MAX_LEN,
    "具体 query が長さ上限を超えています",
  );
  const skippedLongQuery = (snapshot.browserObservationQueue ?? []).find(
    (item) => item.skipReason === "realtime_query_too_long" || item.skipReason === "realtime_query_description",
  );
  if (skippedLongQuery) {
    assert(skippedLongQuery.status === "skipped", "長文/説明 query が skipped になっていません");
  }
  if ((observation.browserObservationFailed ?? 0) > 0 || (observation.realtimeResearchTargetsSkipped ?? 0) > 0) {
    const observedBefore = Number(snapshot.metadata?.collectGuard?.previous?.observedMarketPrice ?? observation.observedMarketPrice);
    assert(
      observation.observedMarketPrice <= observedBefore + 2,
      "failed/skipped 後に observed_market_price が不自然に増えています",
    );
  }

  const enriched = applyMarketplaceResearchToSnapshot({ discoveryCandidates: candidates.slice(0, 2), normalizedProducts: normalizedProducts.slice(0, 2) });
  assert((enriched.marketplaceResearchTargets ?? []).length >= 2, "applyMarketplaceResearchToSnapshot が targets を生成しません");
  assert((enriched.realtimeResearchTargets ?? []).length >= 1, "applyMarketplaceResearchToSnapshot が realtime targets を生成しません");
  assert(Array.isArray(enriched.socialSearchSignals), "socialSearchSignals 配列がありません");
  assert(Array.isArray(enriched.marketplaceSignals), "marketplaceSignals 配列がありません");
  assert(enriched.metadata?.marketplaceQueryExclusions?.counts, "marketplaceQueryExclusions が metadata にありません");
  assert(enriched.metadata?.marketplaceQueryExclusions?.uniqueCounts, "marketplaceQueryExclusions.uniqueCounts がありません");

  const collectScript = await readFile(collectScriptPath, "utf8");
  assert(!FORBIDDEN_MARKET_LABEL_RE.test(collectScript), "collect-marketlens.mjs に禁止相場ラベルが残っています");

  const overviewHtml = await readFile(new URL("../marketlens-overview.html", import.meta.url), "utf8");
  const overviewJs = await readFile(new URL("../marketlens-overview.js", import.meta.url), "utf8");
  assert(overviewHtml.includes("marketlens-overview.js"), "marketlens-overview.html に JS 参照がありません");
  assert(!FORBIDDEN_MARKET_LABEL_RE.test(overviewHtml), "overview HTML に禁止相場ラベルがあります");
  const overviewJsBody = overviewJs.replace(/^const FORBIDDEN_LABEL_RE[^\n]*\n/, "");
  assert(!FORBIDDEN_MARKET_LABEL_RE.test(overviewJsBody), "overview JS に禁止相場ラベルがあります");
  assert(overviewJs.includes("出口価格候補"), "overview JS に出口価格候補説明がありません");
  assert(overviewJs.includes("判断補助対象外"), "overview JS に判断補助対象外 説明がありません");
  assert(overviewJs.includes("概要同期"), "overview JS に概要同期ルール説明がありません");
  assert(overviewJs.includes("新品購入価格は"), "overview JS に新品購入は人間判断の説明がありません");
  assert(overviewHtml.includes("概要同期"), "overview HTML に概要同期ルールセクションがありません");
  assert(overviewHtml.includes("batchCompareTable"), "overview HTML にバッチ比較表がありません");
  assert(overviewJs.includes("renderBatchComparison"), "overview JS にバッチ比較レンダラーがありません");
  assert(overviewJs.includes("renderSkipRegistry"), "overview JS に skip registry レンダラーがありません");

  const probeHistory = snapshot.metadata?.jpyCandidateProbeHistory ?? [];
  if (probeHistory.length > 0) {
    assert(
      probeHistory.every((row) => typeof row.batchLabel === "string" && typeof row.probeTargetCount === "number"),
      "jpyCandidateProbeHistory の形式が不正です",
    );
  }
  const lastProbe = snapshot.metadata?.jpyCandidateProbe ?? {};
  if (lastProbe.batchLabel === "batch3" && lastProbe.targetSelection) {
    assert(
      Number(lastProbe.targetSelection.reprobeSuppressedCount ?? 0) >= 1,
      "batch3 で skip registry 再probe抑制が記録されていません",
    );
  }

  console.log(
    `Regression checks passed: trends=${trends.length}, candidates=${candidates.length}, products=${normalizedProducts.length}, docs=${documents.length}, events=${productEvents.length}, registry=${registrySummary.total}, tasks=${explorationTasks.length}, marketplace=${marketplaceResearchTargets.length}, llm=${llmExtractions.length}, predicted=${predictedPriceSnapshots.length}`,
  );
}

main().catch((error) => {
  console.error(`Regression check failed: ${error.message}`);
  process.exitCode = 1;
});
