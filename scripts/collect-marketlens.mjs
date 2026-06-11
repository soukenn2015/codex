import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  applyMarketplaceResearchToSnapshot,
  hasObservedXEvidence,
  resolveXSignalLabel,
  sanitizeClaimText,
} from "./marketlens-observation.mjs";
import { collectXReaderSocialSignals } from "./marketlens-x-reader.mjs";
import { collectMarketplaceObservationSignals } from "./marketlens-mercari-reader.mjs";
import { collectBrowserObservationSignals } from "./marketlens-yahoo-realtime-reader.mjs";
import {
  resolveBrowserObservationBatchLimit,
  resolveMarketplaceBrowserObservationLimit,
  resolveObservationLimits,
  resolveRealtimeBrowserObservationLimit,
  resolveXQueueLimit,
  resolveXReaderLimit,
} from "./marketlens-limits.mjs";

const configUrl = new URL("../data/source-config.json", import.meta.url);
const registryUrl = new URL("../data/source-registry.json", import.meta.url);
const dealInputUrl = new URL("../data/deal-candidates.csv", import.meta.url);
const outputUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const partialOutputUrl = new URL("../data/marketlens.partial.snapshot.json", import.meta.url);
const historyUrl = new URL("../data/marketlens.history.json", import.meta.url);
const publicHistoryUrl = new URL("../data/marketlens.public-history.json", import.meta.url);
const rawArchiveDirUrl = new URL("../data/raw-archive/", import.meta.url);

const config = JSON.parse(await readFile(configUrl, "utf8"));
const requestedLlmProvider = String(process.env.MARKETLENS_AI_PROVIDER ?? "gemini")
  .trim()
  .toLowerCase();
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const openAiBaseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const geminiBaseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const openAiBaseModel = process.env.MARKETLENS_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-5";
const openAiComplexModel = process.env.MARKETLENS_LLM_COMPLEX_MODEL || openAiBaseModel;
const geminiBaseModel = process.env.MARKETLENS_GEMINI_MODEL || "gemini-3.1-flash-lite";
const geminiFallbackModel = process.env.MARKETLENS_GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
const geminiComplexModel = process.env.MARKETLENS_GEMINI_COMPLEX_MODEL || geminiBaseModel;
const heuristicLlmModel = "heuristic-structured-v1";
const llmExtractionDocLimit = clampNumber(Number(process.env.MARKETLENS_LLM_LIMIT ?? 18), 1, 50);
const geminiExtractionDocLimit = clampNumber(Number(process.env.MARKETLENS_GEMINI_LIMIT ?? 1), 1, 3);
const geminiDailyCallLimit = clampNumber(Number(process.env.MARKETLENS_GEMINI_DAILY_CALL_LIMIT ?? 20), 1, 2000);
const geminiMonthlyCallLimit = clampNumber(Number(process.env.MARKETLENS_GEMINI_MONTHLY_CALL_LIMIT ?? 500), 1, 100000);
const aiBudgetJpy = clampNumber(Number(process.env.MARKETLENS_AI_BUDGET_JPY ?? 2500), 0, 1000000);
const llmTimeoutMs = Number(process.env.MARKETLENS_LLM_TIMEOUT_MS ?? 30000);
const sourceFetchTimeoutMs = clampNumber(Number(process.env.MARKETLENS_FETCH_TIMEOUT_MS ?? 8000), 2000, 20000);
const xReaderEnabled = truthyEnv(process.env.MARKETLENS_X_READER_ENABLED);
const browserObservationEnabled = process.env.MARKETLENS_BROWSER_OBSERVATION_ENABLED !== "0";
const observationLimits = resolveObservationLimits();
const browserObservationLimit = resolveBrowserObservationBatchLimit();
const marketplaceBrowserObservationLimit = resolveMarketplaceBrowserObservationLimit();
const realtimeBrowserObservationLimit = resolveRealtimeBrowserObservationLimit();
const xReaderLimit = resolveXReaderLimit();
const xQueueLimit = resolveXQueueLimit();
const xReaderTimeoutMs = clampNumber(Number(process.env.MARKETLENS_X_READER_TIMEOUT_MS ?? 15000), 3000, 60000);
const browserObservationTimeoutMs = clampNumber(
  Number(process.env.MARKETLENS_BROWSER_OBSERVATION_TIMEOUT_MS ?? 15000),
  3000,
  60000,
);
const marketplaceObservationTimeoutMs = clampNumber(
  Number(process.env.MARKETLENS_MARKETPLACE_BROWSER_OBSERVATION_TIMEOUT_MS ?? process.env.MARKETLENS_BROWSER_OBSERVATION_TIMEOUT_MS ?? 25000),
  5000,
  60000,
);
const routeCheckConcurrency = clampNumber(Number(process.env.MARKETLENS_ROUTE_CHECK_CONCURRENCY ?? 12), 4, 24);
const minSnapshotReachableSources = clampNumber(Number(process.env.MARKETLENS_MIN_REACHABLE_SOURCES ?? 1), 0, 100000);
const minSnapshotDocumentCount = clampNumber(Number(process.env.MARKETLENS_MIN_DOCUMENTS ?? 100), 0, 100000);
const minSnapshotProductCount = clampNumber(Number(process.env.MARKETLENS_MIN_PRODUCTS ?? 100), 0, 100000);
const minSnapshotPreviousRatio = Math.min(1, Math.max(0, Number(process.env.MARKETLENS_MIN_PREVIOUS_RATIO ?? 0.35)));
const minSnapshotProductRetentionRatio = Math.min(
  1,
  Math.max(0, Number(process.env.MARKETLENS_MIN_PRODUCT_RETENTION_RATIO ?? process.env.MARKETLENS_MIN_PREVIOUS_RATIO ?? 0.35)),
);
const minSnapshotDocumentRetentionRatio = Math.min(
  1,
  Math.max(0, Number(process.env.MARKETLENS_MIN_DOCUMENT_RETENTION_RATIO ?? process.env.MARKETLENS_MIN_PREVIOUS_RATIO ?? 0.35)),
);
const defaultProfitFeeRate = Number(process.env.MARKETLENS_FEE_RATE ?? 5);
const defaultProfitBufferRate = Number(process.env.MARKETLENS_PRICE_BUFFER ?? 3);
const defaultPackingCost = Number(process.env.MARKETLENS_PACKING_COST ?? 80);
const existingSnapshotOnDisk = await readJsonIfExists(outputUrl);
const structuredExtractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["products", "events", "links", "prices", "reasons", "confidence"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "category", "productType", "confidence"],
        properties: {
          name: { type: "string" },
          category: {
            type: "string",
            enum: ["pokemon", "kuji", "watch", "figure", "goods", "generic_hobby", "movie_bonus", "movie_goods", "unknown"],
          },
          productType: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productName", "eventType", "startDate", "endDate", "dateConfidence", "shopName", "routeType", "applyUrl", "sourceUrl"],
        properties: {
          productName: { type: "string" },
          eventType: {
            type: "string",
            enum: ["release", "sale_open", "sale_close", "lottery_open", "lottery_close", "resale_open", "invite_open", "restock_signal", "trend_signal"],
          },
          startDate: { type: "string" },
          endDate: { type: "string" },
          dateConfidence: {
            type: "string",
            enum: ["official_exact", "official_inferred", "article_exact", "article_inferred", "rolling"],
          },
          shopName: { type: "string" },
          routeType: { type: "string", enum: ["lottery", "sale", "resale", "invite", "signal"] },
          applyUrl: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "anchorText", "kind", "confidence"],
        properties: {
          url: { type: "string" },
          anchorText: { type: "string" },
          kind: { type: "string", enum: ["apply_page", "product_page", "market_page", "article", "profile", "page", "generic"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    prices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productName", "priceType", "value", "condition", "confidence"],
        properties: {
          productName: { type: "string" },
          priceType: { type: "string", enum: ["retail", "market", "predicted_market", "mentioned_price"] },
          value: { type: "number" },
          condition: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    reasons: {
      type: "object",
      additionalProperties: false,
      required: ["whyTopic", "whyTiming", "whyRoute", "whyPrice", "whyHistory"],
      properties: {
        whyTopic: { type: "string" },
        whyTiming: { type: "string" },
        whyRoute: { type: "string" },
        whyPrice: { type: "string" },
        whyHistory: { type: "string" },
      },
    },
    aiThesis: {
      type: "object",
      additionalProperties: false,
      required: ["whyHot", "demandDrivers", "supplyConstraints", "comparableMarkets", "riskFactors", "nextChecks"],
      properties: {
        whyHot: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        demandDrivers: { type: "array", items: { type: "string" } },
        supplyConstraints: { type: "array", items: { type: "string" } },
        comparableMarkets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "reason"],
            properties: {
              name: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
        riskFactors: { type: "array", items: { type: "string" } },
        nextChecks: { type: "array", items: { type: "string" } },
      },
    },
    priceThesis: {
      type: "object",
      additionalProperties: false,
      required: ["estimatedMarketPrice", "confidence", "basis", "priceSourceRank", "notForBuyLineReason"],
      properties: {
        estimatedMarketPrice: { type: "number" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        basis: { type: "array", items: { type: "string" } },
        priceSourceRank: { type: "string", enum: ["ai_estimate"] },
        notForBuyLineReason: { type: "string" },
      },
    },
    explorationTasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["query", "targetCategory", "reason", "priority", "expectedEvidence"],
        properties: {
          query: { type: "string" },
          targetCategory: { type: "string" },
          reason: { type: "string" },
          priority: { type: "number", minimum: 1, maximum: 5 },
          expectedEvidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

async function readJsonIfExists(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null;
  }
}
const overviewNarrativeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "basedOn"],
  properties: {
    text: { type: "string" },
    basedOn: {
      type: "array",
      items: { type: "string" },
    },
  },
};
let realLlmExtractionCount = 0;
let geminiQuotaStopped = false;
let geminiQuotaStopReason = "";
const llmExecutionStats = {
  extractionFallbackReasons: new Map(),
  eligible: 0,
  skipped: 0,
  requested: 0,
  succeeded: 0,
  failed: 0,
  actualModelsUsed: new Set(),
  overviewRequested: 0,
  overviewSucceeded: 0,
  overviewFailed: 0,
  overviewFallbackReason: "",
};

function normalizeLlmProvider(value) {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "gemini") return "gemini";
  if (provider === "heuristic") return "heuristic";
  return "openai";
}

const configuredLlmProvider = normalizeLlmProvider(requestedLlmProvider);

function llmProviderApiKey(provider = configuredLlmProvider) {
  if (provider === "gemini") return geminiApiKey;
  if (provider === "openai") return openAiApiKey;
  return "";
}

function llmProviderConfigured(provider = configuredLlmProvider) {
  return Boolean(llmProviderApiKey(provider));
}

function llmProviderMissingReason(provider = configuredLlmProvider) {
  if (provider === "gemini") return "gemini_api_key_missing";
  if (provider === "openai") return "openai_api_key_missing";
  return "provider_forced_heuristic";
}

function llmProviderBaseModel(provider = configuredLlmProvider) {
  if (provider === "gemini") return geminiBaseModel;
  if (provider === "openai") return openAiBaseModel;
  return heuristicLlmModel;
}

function llmProviderComplexModel(provider = configuredLlmProvider) {
  if (provider === "gemini") return geminiComplexModel;
  if (provider === "openai") return openAiComplexModel;
  return heuristicLlmModel;
}

function effectiveLlmExtractionDocLimit(provider = configuredLlmProvider) {
  if (provider === "gemini") return geminiExtractionDocLimit;
  return llmExtractionDocLimit;
}

function markGeminiQuotaStopped(reason = "gemini_quota_exceeded") {
  geminiQuotaStopped = true;
  geminiQuotaStopReason = reason;
}

function noteActualModelUsed(model = "") {
  if (!model) return;
  llmExecutionStats.actualModelsUsed.add(model);
}

function geminiFallbackReason({ kind, model, status = "" }) {
  const suffix = [`status=${status}`.trim(), model ? `model=${model}` : ""].filter(Boolean).join(" ");
  if (kind === "quota") return ["gemini_quota_exceeded", suffix].filter(Boolean).join(" ");
  if (kind === "timeout") return ["gemini_timeout", suffix].filter(Boolean).join(" ");
  if (kind === "parse") return ["gemini_parse_failure", suffix].filter(Boolean).join(" ");
  return ["gemini_request_failed", suffix].filter(Boolean).join(" ");
}

function geminiShouldRetryWithFallback(status, model) {
  if (status !== 404) return false;
  if (!geminiFallbackModel) return false;
  return model !== geminiFallbackModel;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  if (!html) return links;
  const hrefPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = hrefPattern.exec(html))) {
    const rawHref = (match[1] ?? "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;
    try {
      const url = new URL(rawHref, baseUrl).toString();
      const anchorText = stripHtml(match[2] ?? "").slice(0, 180);
      links.push({ url, anchorText });
    } catch {
      // ignore invalid URL
    }
  }
  return links;
}

function extractLotteryDeadline(text) {
  if (!text) return null;
  const jp = text.match(/(20\d{2})[\/\-年\.](\d{1,2})[\/\-月\.](\d{1,2})日?/);
  if (jp) {
    const [, y, m, d] = jp;
    const year = Number(y);
    const currentYear = new Date().getFullYear();
    if (Number.isFinite(year) && (year < currentYear - 1 || year > currentYear + 2)) return null;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T23:59:59+09:00`;
  }
  return null;
}

const lotteryWord = /(抽選|応募|エントリー|lottery|entry|apply|membercard|招待|入店|受付|先着|予約)/i;
const lotteryPathWord = /(lottery|entry|apply|membercard|campaign|chusen|抽選|応募|reservation|reserve)/i;
const ignoredLotteryHosts = /(google\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|snkrdunk\.com)$/i;
const ignoredLotteryName = /^(調整中|こちら|詳しく|応募リンク|確認)$/i;
const ignoredAffiliateHosts =
  /(hb\.afl\.rakuten\.co\.jp|pt\.afl\.rakuten\.co\.jp|px\.a8\.net|al\.dmm\.com|click\.linksynergy\.com|amzn\.to|bit\.ly|t\.co|linktr\.ee|fc2\.com)$/i;
const allowedLotteryHosts =
  /(pokemoncenter-online\.com|pokemon-card\.com|membercard\.jp|p-bandai\.jp|bandai\.co\.jp|dmm\.com|amiami\.jp|yellowsubmarine\.co\.jp|joshinweb\.jp|biccamera\.com|yodobashi\.com|edion\.com|one-piece\.com|square-enix\.com|casio\.com|gshock\.casio\.com|nyuka-now\.com)$/i;

function sourceHasLotteryIntent(source) {
  if (source.type === "pokemonRelease") return true;
  if (source.lane === "lottery") return true;
  const trendType = String(source.trend?.type ?? "");
  const trendAction = String(source.trend?.action ?? "");
  const trendContext = String(source.trend?.context ?? "");
  if (!lotteryWord.test(`${trendType} ${trendAction} ${trendContext}`)) return false;
  if (/ブログ監視|SNS監視|価格差|時計|公式グッズ/i.test(`${trendType} ${trendContext}`)) return false;
  const text = [
    source.keyword,
    source.trend?.keyword,
    source.candidate?.trend,
    source.candidate?.marginSignal,
  ]
    .filter(Boolean)
    .join(" ");
  return lotteryWord.test(text);
}

function normalizeRouteName(value, fallback = "抽選ルート") {
  const name = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/応募はこちら|詳しくはこちら|詳細はこちら/gi, "")
    .trim();
  return name.length >= 2 ? name : fallback;
}

function tryParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isAffiliateUrl(value) {
  const parsed = tryParseUrl(value);
  if (!parsed) return true;
  return ignoredAffiliateHosts.test(parsed.hostname) || /ck\.jp\.ap\.valuecommerce\.com/i.test(parsed.hostname);
}

function isGenericCommerceUrl(value) {
  const parsed = tryParseUrl(value);
  if (!parsed) return true;
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  if (/joshinweb\.jp$/i.test(parsed.hostname) && /\/top\.html?$/.test(path)) return true;
  if (/biccamera\.com$/i.test(parsed.hostname) && /\/bc\/main\/?$/.test(path)) return true;
  if (/dmm\.com$/i.test(parsed.hostname) && /\/mono\/hobby\/-\/search\//.test(path)) return true;
  if (/rakuten\.ne\.jp$/i.test(parsed.hostname) && /\/gold\//.test(path)) return true;
  if (/amiami\.jp$/i.test(parsed.hostname) && /^\/?$/.test(parsed.pathname)) return true;
  return false;
}

function fallbackLotteryRouteFromSource(source, result = null) {
  if (!sourceHasLotteryIntent(source)) return null;
  const urls = [source.candidate?.sourceUrl, source.trend?.sourceUrl, source.url, result?.url].filter(Boolean);
  const url = urls.find((candidateUrl) => {
    const parsedUrl = tryParseUrl(candidateUrl);
    return parsedUrl && allowedLotteryHosts.test(parsedUrl.hostname) && !ignoredLotteryHosts.test(parsedUrl.hostname) && !ignoredAffiliateHosts.test(parsedUrl.hostname);
  });
  const parsed = tryParseUrl(url);
  if (!parsed) return null;
  const joined = [source.keyword, source.trend?.keyword, source.trend?.context, source.candidate?.name, source.candidate?.trend, url]
    .filter(Boolean)
    .join(" ");
  if (!lotteryWord.test(joined) && !lotteryPathWord.test(`${parsed.pathname}${parsed.search}`)) return null;
  let inferredPeriod =
    result?.text && result?.fetchedAt ? determineStartEndDate(source, result.fetchedAt.slice(0, 10), result.text) : { startDate: null, endDate: null };
  const inferredEndTs = inferredPeriod.endDate ? new Date(`${inferredPeriod.endDate}T23:59:59+09:00`).getTime() : Number.NaN;
  if (Number.isFinite(inferredEndTs) && inferredEndTs < Date.now()) {
    const today = todayIsoDate();
    inferredPeriod = { startDate: today, endDate: addDaysToIsoDate(today, 14) };
  }
  const startDate = source.candidate?.startDate
    ? `${source.candidate.startDate}T00:00:00+09:00`
    : source.trend?.startDate
      ? `${source.trend.startDate}T00:00:00+09:00`
      : inferredPeriod.startDate
        ? `${inferredPeriod.startDate}T00:00:00+09:00`
      : null;
  const deadlineDate = source.candidate?.endDate
    ? `${source.candidate.endDate}T23:59:59+09:00`
    : source.trend?.endDate
      ? `${source.trend.endDate}T23:59:59+09:00`
      : inferredPeriod.endDate
        ? `${inferredPeriod.endDate}T23:59:59+09:00`
      : null;
  return {
    id: `lottery-${normalizeSignalText(`${source.id}-${url}`)}`,
    scope: /大阪|osaka|梅田|なんば|日本橋/i.test(joined) ? "osaka" : "online",
    priority: /先着|当日|開始|web応募|会員|抽選販売|応募/i.test(joined) ? "high" : "medium",
    name: normalizeRouteName(source.candidate?.name || source.keyword || source.trend?.keyword, "抽選ルート"),
    source: source.trend?.source ?? source.type ?? "source",
    action: "応募条件と期間を確認",
    note: source.trend?.context ?? "抽選ページを直接ルート化",
    condition: "開始日/終了日/応募方法を確認",
    sourceUrl: url,
    startDate,
    deadlineDate,
    applyUrl: url,
  };
}

function extractLotteryRoutesFromSource(source, result) {
  if (!sourceHasLotteryIntent(source)) return [];
  if (!result?.ok) {
    const fallback = fallbackLotteryRouteFromSource(source, result);
    return fallback ? [fallback] : [];
  }
  const text = String(result.text ?? "");
  const links = extractLinksFromHtml(result.html ?? "", result.url ?? source.url);
  const candidates = [];

  for (const link of links) {
    const parsed = tryParseUrl(link.url);
    if (!parsed) continue;
    if (ignoredLotteryHosts.test(parsed.hostname)) continue;
    if (ignoredAffiliateHosts.test(parsed.hostname)) continue;
    if (!allowedLotteryHosts.test(parsed.hostname)) continue;
    if (parsed.pathname === "/" && !parsed.search && !lotteryWord.test(link.anchorText)) continue;
    const joined = `${link.anchorText} ${link.url}`;
    if (!lotteryWord.test(joined) && !lotteryPathWord.test(`${parsed.pathname}${parsed.search}`)) continue;
    const name = normalizeRouteName(link.anchorText, source.keyword || "抽選ルート");
    if (ignoredLotteryName.test(name)) continue;
    const startDate = source.candidate?.startDate
      ? `${source.candidate.startDate}T00:00:00+09:00`
      : source.trend?.startDate
        ? `${source.trend.startDate}T00:00:00+09:00`
        : null;
    const parsedDeadlineDate = extractLotteryDeadline(`${link.anchorText} ${text.slice(0, 2400)}`);
    const fallbackDeadlineDate = source.candidate?.endDate
      ? `${source.candidate.endDate}T23:59:59+09:00`
      : source.trend?.endDate
        ? `${source.trend.endDate}T23:59:59+09:00`
        : null;
    const deadlineDate = parsedDeadlineDate || fallbackDeadlineDate;
    candidates.push({
      id: `lottery-${normalizeSignalText(`${source.id}-${link.url}`)}`,
      scope: /大阪|osaka|梅田|なんば|日本橋/i.test(joined) ? "osaka" : "online",
      priority: /先着|当日|開始|web応募|会員/i.test(joined) ? "high" : "medium",
      name,
      source: source.trend?.source ?? source.type ?? "source",
      action: "応募条件と期間を確認",
      note: source.trend?.context ?? "外部ソースから抽選導線を抽出",
      condition: "開始日/終了日/応募方法を確認",
      sourceUrl: link.url,
      startDate,
      deadlineDate,
      applyUrl: link.url,
    });
    if (candidates.length >= 8) break;
  }

  if (candidates.length === 0) {
    const fallback = fallbackLotteryRouteFromSource(source, result);
    if (fallback) candidates.push(fallback);
  }

  return candidates;
}

function shiftDate(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateParts(date) {
  return {
    y: String(date.getFullYear()),
    m: String(date.getMonth() + 1),
    d: String(date.getDate()),
  };
}

function todayIsoDate() {
  const now = formatDateParts(new Date());
  return `${now.y}-${now.m.padStart(2, "0")}-${now.d.padStart(2, "0")}`;
}

function resolveSourceUrl(source) {
  if (source.type !== "pokemonRelease") return source.url;
  const parsed = tryParseUrl(source.url);
  if (!parsed || !parsed.hostname.includes("pokemon-card.com")) return source.url;

  const lower = formatDateParts(shiftDate(new Date(), -180));
  const upper = formatDateParts(shiftDate(new Date(), 270));
  parsed.searchParams.set("dateLowerY", lower.y);
  parsed.searchParams.set("dateLowerM", lower.m);
  parsed.searchParams.set("dateLowerD", lower.d);
  parsed.searchParams.set("dateUpperY", upper.y);
  parsed.searchParams.set("dateUpperM", upper.m);
  parsed.searchParams.set("dateUpperD", upper.d);
  if (!parsed.searchParams.get("productType")) {
    parsed.searchParams.set("productType", "expansion");
  }
  return parsed.toString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSignalText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truthyEnv(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const BLOG_SNS_RECENT_LIMIT = 30;
const BLOG_SNS_DETAIL_FETCH_LIMIT = 12;
const DISCOVERY_SOURCE_LIMIT = 120;
const TRIAL_SOURCE_FETCH_LIMIT = 30;
const TRIAL_PROMOTION_LIMIT = 20;
const ACTIVE_PROMOTION_LIMIT = 10;
const TRIAL_FAIL_LIMIT = 3;
const ACTIVE_FAIL_LIMIT = 5;
const ARCHIVE_AFTER_IDLE_DAYS = 45;
const PRODUCT_ALIAS_RULES = [
  [/ドラスタ/gi, "ドラゴンスター"],
  [/イエサブ/gi, "イエローサブマリン"],
  [/ポケカbox/gi, "ポケモンカード BOX"],
  [/ワンピ/gi, "ワンピース"],
  [/フィギュアーツ/gi, "S.H.Figuarts"],
  [/プレバン/gi, "プレミアムバンダイ"],
];
const PRODUCT_SITE_CHROME_WORD =
  /(一番くじ情報サイト|キャラクター一覧|ブランド一覧|店舗検索|商品検索|language\s+日本語|発売時期|発売済|すべて|ラインナップ|ウェブアクセシビリティ方針|公式ホームページ\s*商品情報|カード\s*Q&A|イベント検索|はじめての方へ|はじめよう！ポケモンカード|ポケモンカードチャンネル|ポケモン公式\s*twitter|公式facebook|公式チャンネル|閉じる\s*×|スペシャルページ|各等賞一覧|一番くじ公式ショップ|全\d+種|ファンの感想|ご案内させていただきます|ポイくじ|送料無料チケット|一番くじでしか手に入らない|最後の1個を引くと手に入る|くじの残り数は店舗でご確認|店舗でご確認下さい|店舗でご確認ください|illustration\s+by|描きおろし|描き下ろし|商品説明を見る|物語の主人公|作品に欠かせない|一番くじフィギュアブランド)/i;
const PRODUCT_SIGNAL_WORD =
  /(一番くじ|ポケモン|ポケカ|拡張パック|BOX|ドラゴンボール|ワンピース|ドラクエ|ドラゴンクエスト|G-SHOCK|GARRACK|フィギュア|S\.H\.Figuarts|METAL BUILD|ROBOT魂|超合金|ねんどろいど|figma|Portrait\.Of\.Pirates|P\.O\.P|プレミアムバンダイ|プレバン|抽選|応募|予約|再販|完売|品薄|サプライ|マスコット|ぬいぐるみ|キーホルダー|カービィ|ちいかわ|サンリオ|たまごっち|お文具|映画|劇場版|入場者特典|来場者特典|前売券|ムビチケ|劇場限定|上映記念|パンフレット)/i;
const ROUTE_HOST_ALLOW =
  /(pokemoncenter-online\.com|pokemon-card\.com|membercard\.jp|p-bandai\.jp|dmm\.com|amiami\.jp|yellowsubmarine\.co\.jp|joshinweb\.jp|biccamera\.com|yodobashi\.com|edion\.com|one-piece\.com|square-enix\.com|casio\.com|gshock\.casio\.com|nyuka-now\.com|7netshopping\.jp|rakuten\.co\.jp|amazon\.co\.jp|ticket\.moviewalker\.jp|tohotheater\.jp|109cinemas\.net)/i;
const NEWS_SOURCE_HOSTS = /(hobby\.watch\.impress\.co\.jp|game\.watch\.impress\.co\.jp|dengekihobby\.com|dengekionline\.com|magmix\.jp|famitsu\.com|4gamer\.net)$/i;
const BLOG_SOURCE_HOSTS = /(fc2\.com|livedoor\.jp|ameblo\.jp|tenbailabo\.com|emisresaleroom\.com|blog108\.fc2\.com|blog114\.fc2\.com)$/i;
const MARKET_SOURCE_HOSTS = /(mercari\.com|mercari\.jp|snkrdunk\.com|amazon\.co\.jp|rakuten\.co\.jp|fril\.jp|paypayfleamarket\.yahoo\.co\.jp)$/i;
const OFFICIAL_SOURCE_HOSTS =
  /(pokemoncenter-online\.com|pokemon-card\.com|p-bandai\.jp|bandai\.co\.jp|one-piece\.com|square-enix\.com|dragonquest\.jp|casio\.com|gshock\.casio\.com|sej\.co\.jp|1kuji\.com)$/i;

function stripTrackingParams(parsed) {
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|yclid|mkt_tok|srsltid)/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed;
}

function laneFromHostAndText(url, anchorText = "", contextText = "") {
  const parsed = tryParseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  const directJoined = `${anchorText} ${url}`;
  const contextualJoined = `${anchorText} ${contextText} ${url}`;
  if (host === "x.com" || host === "twitter.com") return "sns";
  if (MARKET_SOURCE_HOSTS.test(host)) return "market";
  if (BLOG_SOURCE_HOSTS.test(host)) return "blog";
  if (NEWS_SOURCE_HOSTS.test(host)) return "news";
  if (
    allowedLotteryHosts.test(host) &&
    (lotteryPathWord.test(path) || lotteryWord.test(directJoined) || /membercard|nyuka-now/.test(host))
  ) {
    return "lottery";
  }
  if (OFFICIAL_SOURCE_HOSTS.test(host)) return "official";
  if (lotteryWord.test(directJoined) && !ignoredLotteryHosts.test(host)) return "lottery";
  if (/blog|diary|journal|entry|archives/.test(path)) return "blog";
  if (/news|article|topics|special/.test(path) && PRODUCT_SIGNAL_WORD.test(contextualJoined)) return "news";
  return null;
}

function canonicalizeDiscoveredSource(url, lane) {
  const parsed = tryParseUrl(url);
  if (!parsed) return null;
  stripTrackingParams(parsed);
  parsed.hash = "";
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (lane === "sns") {
    const handle = segments[0];
    if (!handle || /^(search|home|explore|i|intent|share|hashtag)$/.test(handle)) return null;
    parsed.pathname = `/${handle.replace(/^@/, "")}`;
    parsed.search = "";
    return {
      canonicalUrl: parsed.toString(),
      canonicalPath: parsed.pathname,
      templateKind: "profile",
      host,
    };
  }

  if (lane === "blog" || lane === "news") {
    if (segments[0] === "docs" && segments[1] === "news") {
      parsed.pathname = "/docs/news/";
    } else if (segments[0] === "archives") {
      parsed.pathname = "/archives/";
    } else if (segments[0] === "category" && segments[1]) {
      parsed.pathname = `/category/${segments[1]}/`;
    } else if (segments[0] === "tag" && segments[1]) {
      parsed.pathname = `/tag/${segments[1]}/`;
    } else {
      parsed.pathname = "/";
    }
    parsed.search = "";
    return {
      canonicalUrl: parsed.toString(),
      canonicalPath: parsed.pathname,
      templateKind: segments[0] === "archives" ? "archive" : parsed.pathname === "/" ? "root" : "section",
      host,
    };
  }

  if (lane === "market") {
    if (/snkrdunk\.com$/.test(host) && /\/products\//.test(parsed.pathname)) {
      return {
        canonicalUrl: parsed.toString(),
        canonicalPath: parsed.pathname,
        templateKind: "product",
        host,
      };
    }
    parsed.pathname = "/";
    parsed.search = "";
    return {
      canonicalUrl: parsed.toString(),
      canonicalPath: "/",
      templateKind: /search/.test(`${parsed.pathname}${parsed.search}`) ? "search" : "root",
      host,
    };
  }

  return {
    canonicalUrl: parsed.toString(),
    canonicalPath: parsed.pathname || "/",
    templateKind: lotteryPathWord.test(`${parsed.pathname}${parsed.search}`) ? "entry" : "page",
    host,
  };
}

function discoveredSourceIsValid(candidate) {
  if (!candidate?.lane || !candidate?.canonicalUrl) return false;
  if (isAffiliateUrl(candidate.canonicalUrl)) return false;
  if (candidate.lane !== "blog" && candidate.lane !== "news" && isSearchLikeUrl(candidate.canonicalUrl)) return false;
  if (candidate.lane !== "blog" && candidate.lane !== "news" && routeTargetIsGeneric(candidate.canonicalUrl)) return false;
  if (candidate.lane === "official") {
    if (candidate.templateKind === "root") return false;
    if (
      /(login|cart|mypage|privacy|notice|rule|guide|corporate|contact|license|termofuse|inquiry|calendar|favorite|mailmagazine|recruit|owner|csr|sustainability|concept|system|external-transmission|newregist|myorder|mycollection|brand|category|contents|chara|shop_list|shop_lists|sitemap)/i.test(
        candidate.canonicalPath,
      )
    ) {
      return false;
    }
  }
  if (candidate.lane === "lottery") {
    if (candidate.templateKind === "root") return false;
    if (
      !lotteryPathWord.test(candidate.canonicalPath) &&
      !lotteryWord.test(`${candidate.titleHint ?? ""} ${candidate.keywordHint ?? ""} ${candidate.url ?? ""}`)
    ) {
      return false;
    }
  }
  if (candidate.lane === "news" && candidate.templateKind === "root") return false;
  return true;
}

function sourceKeyForLaneUrl(lane, url) {
  return `${lane}:${normalizeSignalText(url)}`;
}

function sourcePriorityWeight(priority) {
  if (priority === "high") return 3;
  if (priority === "low") return 1;
  return 2;
}

function registryStatusRank(status) {
  if (status === "manual") return 0;
  if (status === "active") return 1;
  if (status === "trial") return 2;
  if (status === "candidate") return 3;
  if (status === "blocked") return 4;
  if (status === "archived") return 5;
  return 9;
}

function defaultExpansionPolicyForLane(lane) {
  if (lane === "blog" || lane === "sns" || lane === "news") return "article_links";
  if (lane === "official" || lane === "lottery") return "article_plus_official_links";
  if (lane === "market") return "search_results";
  return "none";
}

function defaultCrawlBudgetForLane(lane) {
  if (lane === "official" || lane === "lottery") {
    return { recentLimit: 50, detailLimit: 20, externalFollowLimit: 10 };
  }
  return { recentLimit: 50, detailLimit: 20, externalFollowLimit: 6 };
}

function buildRegistryEntry(record = {}) {
  const lane = record.lane ?? "official";
  return {
    sourceKey: record.sourceKey ?? sourceKeyForLaneUrl(lane, record.canonicalUrl ?? record.url ?? ""),
    lane,
    keywordHint: record.keywordHint ?? record.keyword ?? "",
    titleHint: record.titleHint ?? "",
    url: record.url ?? record.canonicalUrl ?? "",
    canonicalUrl: record.canonicalUrl ?? record.url ?? "",
    canonicalPath: record.canonicalPath ?? "/",
    templateKind: record.templateKind ?? "page",
    host: record.host ?? String(tryParseUrl(record.canonicalUrl ?? record.url ?? "")?.hostname ?? "").replace(/^www\./, "").toLowerCase(),
    status: record.status ?? "candidate",
    seed: Boolean(record.seed),
    priority: record.priority ?? "medium",
    expansionPolicy: record.expansionPolicy ?? defaultExpansionPolicyForLane(lane),
    followDomains: Array.isArray(record.followDomains) ? [...new Set(record.followDomains.filter(Boolean))] : [],
    crawlBudget: { ...defaultCrawlBudgetForLane(lane), ...(record.crawlBudget ?? {}) },
    discoveredFrom: Array.isArray(record.discoveredFrom) ? [...new Set(record.discoveredFrom.filter(Boolean))].slice(0, 12) : [],
    evidenceDocs: Array.isArray(record.evidenceDocs) ? [...new Set(record.evidenceDocs.filter(Boolean))].slice(0, 24) : [],
    evidenceProducts: Array.isArray(record.evidenceProducts) ? [...new Set(record.evidenceProducts.filter(Boolean))].slice(0, 24) : [],
    firstSeenAt: record.firstSeenAt ?? null,
    lastSeenAt: record.lastSeenAt ?? null,
    lastFetchedAt: record.lastFetchedAt ?? null,
    successRuns: Number(record.successRuns ?? 0),
    failureRuns: Number(record.failureRuns ?? 0),
    usefulRuns: Number(record.usefulRuns ?? 0),
    productHitCount: Number(record.productHitCount ?? 0),
    routeHitCount: Number(record.routeHitCount ?? 0),
    discoveredCount: Number(record.discoveredCount ?? 0),
    specificProductCount: Number(record.specificProductCount ?? 0),
    genericNoiseCount: Number(record.genericNoiseCount ?? 0),
    priceHitCount: Number(record.priceHitCount ?? 0),
    directRouteCount: Number(record.directRouteCount ?? 0),
    specificProductRatio: Number(record.specificProductRatio ?? 0),
    productExtractionRate: Number(record.productExtractionRate ?? 0),
    directRouteRate: Number(record.directRouteRate ?? 0),
    priceHitRate: Number(record.priceHitRate ?? 0),
    consecutiveFailures: Number(record.consecutiveFailures ?? 0),
    lastUsefulAt: record.lastUsefulAt ?? null,
    lastDecisionReason: record.lastDecisionReason ?? "",
    sourceQuality: Number(record.sourceQuality ?? 0),
  };
}

function mergeRegistryEntry(base, next) {
  const merged = buildRegistryEntry({ ...base, ...next });
  merged.seed = Boolean(base.seed || next.seed);
  merged.discoveredFrom = [...new Set([...(base.discoveredFrom ?? []), ...(next.discoveredFrom ?? [])])].slice(0, 12);
  merged.evidenceDocs = [...new Set([...(base.evidenceDocs ?? []), ...(next.evidenceDocs ?? [])])].slice(0, 24);
  merged.evidenceProducts = [...new Set([...(base.evidenceProducts ?? []), ...(next.evidenceProducts ?? [])])].slice(0, 24);
  merged.successRuns = Number(base.successRuns ?? 0) + Number(next.successRuns ?? 0);
  merged.failureRuns = Number(base.failureRuns ?? 0) + Number(next.failureRuns ?? 0);
  merged.usefulRuns = Number(base.usefulRuns ?? 0) + Number(next.usefulRuns ?? 0);
  merged.productHitCount = Number(base.productHitCount ?? 0) + Number(next.productHitCount ?? 0);
  merged.routeHitCount = Number(base.routeHitCount ?? 0) + Number(next.routeHitCount ?? 0);
  merged.discoveredCount = Number(base.discoveredCount ?? 0) + Number(next.discoveredCount ?? 0);
  merged.specificProductCount = Number(base.specificProductCount ?? 0) + Number(next.specificProductCount ?? 0);
  merged.genericNoiseCount = Number(base.genericNoiseCount ?? 0) + Number(next.genericNoiseCount ?? 0);
  merged.priceHitCount = Number(base.priceHitCount ?? 0) + Number(next.priceHitCount ?? 0);
  merged.directRouteCount = Number(base.directRouteCount ?? 0) + Number(next.directRouteCount ?? 0);
  const totalObserved = merged.specificProductCount + merged.genericNoiseCount;
  merged.specificProductRatio = totalObserved > 0 ? merged.specificProductCount / totalObserved : merged.specificProductRatio;
  const extractionTotal = merged.productHitCount + merged.genericNoiseCount;
  merged.productExtractionRate = extractionTotal > 0 ? merged.specificProductCount / extractionTotal : 0;
  merged.directRouteRate = merged.productHitCount > 0 ? merged.directRouteCount / Math.max(1, merged.productHitCount) : 0;
  merged.priceHitRate = merged.productHitCount > 0 ? merged.priceHitCount / Math.max(1, merged.productHitCount) : 0;
  merged.sourceQuality = calculateSourceQuality(merged);
  merged.firstSeenAt = base.firstSeenAt ?? next.firstSeenAt ?? null;
  merged.lastSeenAt = next.lastSeenAt ?? base.lastSeenAt ?? null;
  merged.lastFetchedAt = next.lastFetchedAt ?? base.lastFetchedAt ?? null;
  merged.lastUsefulAt = next.lastUsefulAt ?? base.lastUsefulAt ?? null;
  merged.consecutiveFailures = Number(next.consecutiveFailures ?? base.consecutiveFailures ?? 0);
  return merged;
}

function calculateSourceQuality(entry) {
  const totalRuns = Number(entry.successRuns ?? 0) + Number(entry.failureRuns ?? 0);
  const successRate = totalRuns > 0 ? Number(entry.successRuns ?? 0) / totalRuns : 0;
  const usefulRate = Number(entry.successRuns ?? 0) > 0 ? Number(entry.usefulRuns ?? 0) / Math.max(1, Number(entry.successRuns ?? 0)) : 0;
  const routeYield = clampNumber(Number(entry.routeHitCount ?? 0) * 5, 0, 20);
  const productYield = clampNumber(Number(entry.productHitCount ?? 0) * 2, 0, 25);
  const ratioScore = clampNumber(Math.round((Number(entry.specificProductRatio ?? 0) || 0) * 30), 0, 30);
  const directRouteScore = clampNumber(Math.round((Number(entry.directRouteRate ?? 0) || 0) * 12), 0, 12);
  const priceHitScore = clampNumber(Math.round((Number(entry.priceHitRate ?? 0) || 0) * 8), 0, 8);
  return clampNumber(Math.round(successRate * 20 + usefulRate * 15 + routeYield + productYield + ratioScore + directRouteScore + priceHitScore), 0, 100);
}

function sourceStatusShouldArchive(entry, nowIsoDate = todayIsoDate()) {
  if (entry.status !== "active") return false;
  if (!entry.lastUsefulAt) return false;
  const days = Math.floor((Date.parse(`${nowIsoDate}T00:00:00+09:00`) - Date.parse(entry.lastUsefulAt)) / 86_400_000);
  return Number.isFinite(days) && days > ARCHIVE_AFTER_IDLE_DAYS;
}

async function readSourceRegistry() {
  const registry = await readJsonFile(registryUrl, { version: 1, updatedAt: null, entries: [] });
  return {
    version: 1,
    updatedAt: registry.updatedAt ?? null,
    entries: Array.isArray(registry.entries) ? registry.entries.map(buildRegistryEntry) : [],
  };
}

async function writeSourceRegistry(registry) {
  const normalized = {
    version: 1,
    updatedAt: registry.updatedAt ?? new Date().toISOString(),
    entries: [...(registry.entries ?? [])]
      .map(buildRegistryEntry)
      .sort((a, b) => registryStatusRank(a.status) - registryStatusRank(b.status) || (b.sourceQuality ?? 0) - (a.sourceQuality ?? 0)),
  };
  await writeFile(registryUrl, `${JSON.stringify(normalized, null, 2)}\n`);
}

async function archiveFetchedDocument(record) {
  if (!record?.fetchedAt) return null;
  const month = String(record.fetchedAt).slice(0, 7);
  if (!month) return null;
  await mkdir(rawArchiveDirUrl, { recursive: true });
  const archiveUrl = new URL(`./${month}.jsonl`, rawArchiveDirUrl);
  const docId = record.docId ?? `doc:${normalizeSignalText(`${record.sourceKey ?? record.url}:${record.fetchedAt}`)}`;
  await appendFile(archiveUrl, `${JSON.stringify({ ...record, docId })}\n`);
  return docId;
}

function dedupeRepeatedProductPhrase(value) {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const repeated = text.match(/^(.{4,48}?)\s+\1$/u);
  if (repeated?.[1]) return repeated[1].trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const deduped = [];
    for (const token of tokens) {
      if (deduped[deduped.length - 1] === token) continue;
      deduped.push(token);
    }
    return deduped.join(" ").trim();
  }
  return text;
}

function looksLikeArticleBoilerplateName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  return /この記事を書いた人|スポンサーリンク|在籍メンバー数|RESALE LAB|利用規約|世界No\.?1ファッションフリマアプリ|一番くじ倶楽部またはくじ券をご確認ください|ダブルチャンスキャンペーン(?:期間)?|カートに入れる|在庫状況|お気に入り一覧|権利|コメント投稿欄|お問い合わせ|プライバシーポリシー|FAQ|追加情報や様々なブランドとのコラボレーション情報|商品抽選販売|抽選応募受付を開始致しました|発売予定$/u.test(
    text,
  );
}

function looksLikePrizeDescriptionBlob(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const prizeMatches = text.match(/(?:^|\s)(?:[A-HI]\s*賞|ラストワン賞|ダブルチャンスキャンペーン)/g) ?? [];
  if (prizeMatches.length >= 2) return true;
  return /全\d+種|約\d+(?:cm|mm)|MASTERLISE|ちょこのっこ|アクリッツ|ミニアートボード|ビジュアルポスター|フィギュア.*フィギュア|ぬいぐるみセット.*ラストワン賞/u.test(
    text,
  );
}

function looksLikeCategoryListingName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  const categoryDelimiterCount = (text.match(/・/g) ?? []).length;
  if (
    categoryDelimiterCount >= 4 &&
    /(フィギュア|プラモデル|ぬいぐるみ|マスコット|キーホルダー|ストラップ|腕時計|アクセサリー|アパレル|バッグ|ポーチ|財布|スマホ関連|キッチン雑貨|複製原画|アート|カード)/u.test(
      text,
    )
  ) {
    return true;
  }
  return /検索結果|画像一覧を表示|詳細一覧を表示|件目を表示しています|公式サイト$|フィギュアシリーズです|フィギュアとなっています/u.test(text);
}

function looksLikeNarrativeProductName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^(?:A賞からF賞は一番くじのフィギュアブランド|一番くじのフィギュアブランド|映画特典・劇場グッズ)$/u.test(text)) {
    return true;
  }
  return /A賞からF賞|一番くじのフィギュアブランド|ネタバレあり】|シリーズ完結編に込めた想い|今後の展開|史上、最もド派手なアクションムービー|愛されコンビが仲間と共にパワーアップした最新映画|フィギュアを実写化した|原作とする映画は数えきれず|フィギュアを実写版映画化|自分も映画を撮りたい|Blu-ray】映画/u.test(
    text,
  );
}

function summaryNameLooksUseful(name) {
  const cleaned = canonicalizeProductName(name);
  if (!productPhraseLooksSpecific(cleaned)) return false;
  if (looksLikeArticleBoilerplateName(cleaned)) return false;
  if (looksLikePrizeDescriptionBlob(cleaned)) return false;
  if (looksLikeCategoryListingName(cleaned)) return false;
  if (looksLikeNarrativeProductName(cleaned)) return false;
  if (looksLikeRouteLabelName(cleaned)) return false;
  if (/^(?:拡張パック|強化拡張パック|ポケモンカードゲーム|ポケモンカード|ポケカ拡張パック|ポケモンカードゲーム最新拡張パック)$/u.test(cleaned)) {
    return false;
  }
  if (/^拡張パック(?:ですら|が再販|については|はいずれも|は軒並み|を対象に)/u.test(cleaned)) return false;
  if (/公式サイト$|の日$|を記念した本イベントは$|抽選販売$|追加情報や様々なブランドとのコラボレーション情報$/u.test(cleaned)) return false;
  return true;
}

function looksLikeRouteLabelName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^[^「]{0,24}「[^」]{2,100}」(?:抽選販売|通常販売|再販|予約販売)$/u.test(text)) return true;
  if (
    /(?:DMM通販|通販|オンライン|ONLINE|タカラトミーモール|ポケモンセンターオンライン|プレミアムバンダイ|Amazon|楽天)/u.test(text) &&
    /(?:抽選販売|通常販売|再販|予約販売|販売導線|抽選ルート|抽選受付|販売受付)/u.test(text)
  ) {
    return true;
  }
  return false;
}

function looksLikeMovieArticleTitle(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const hasMovieToken = /映画|劇場版|入場者特典|来場者特典|前売券|ムビチケ|劇場限定|上映記念|パンフレット/.test(text);
  if (!hasMovieToken) return false;
  const hasConcreteMovieItem = /入場者特典|来場者特典|前売券特典|ムビチケ特典|ムビチケ前売券|前売券|劇場限定グッズ|上映記念グッズ|パンフレット|鑑賞券/.test(
    text,
  );
  if (hasConcreteMovieItem) return false;
  return /映画ニュース|インタビュー|海外ゴシップ|みたい映画|ランキング|すべての写真を見る|場面写真|予告編|ポスター|ジャパンプレミア|公開直前イベント|上映中の映画|今週公開の映画|公開予定の映画|関連作品|公開作品/.test(
    text,
  );
}

function canonicalizeProductName(name) {
  let normalized = String(name ?? "").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of PRODUCT_ALIAS_RULES) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized
    .replace(/^[□■◆◇○●▲△▶▷►]+\s*/u, "")
    .replace(/^[「『【\[]+/u, "")
    .replace(/[」』】\]]+$/u, "")
    .replace(/[|｜].*$/, "")
    .replace(/[【\[].*$/, "")
    .replace(/(?:●\s*)?(?:キャラクター一覧|ブランド一覧|店舗検索|商品検索|発売時期|発売済|すべて|ラインナップ)\b/giu, " ")
    .replace(/\blanguage\s+日本語.*$/iu, " ")
    .replace(/\b(?:English|简体中文|繁體中文|한국어)\b/giu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/(?:公式ホームページ\s*商品情報|ポケモンカードチャンネル|ポケモン公式\s*twitter|はじめての方へ|はじめよう！ポケモンカード|イベント検索|カード\s*Q&A|ウェブアクセシビリティ方針|公式facebook|公式チャンネル|閉じる\s*×|一番くじ公式ショップ)/giu, " ")
    .replace(/-->/g, " ")
    .replace(/\s*(?:スペシャルページ|各等賞一覧).*$/u, "")
    .replace(/\s*■全\d+種.*$/u, "")
    .replace(/\s*(?:価格|税込価格|販売価格|ジャンル|発売日|発売予定日|応募期間|受付期間|予約期間|販売期間|JAN|商品コード)[：:]\s*.*$/i, "")
    .replace(/\s*(?:商品説明を見る|物語の主人公|作品に欠かせない|一番くじフィギュアブランド|背景が|ザクのヘッドマスコット).*$/u, "")
    .replace(/ドラゴンクエストとは\s+タイトル一覧.*$/u, "")
    .replace(/ワンピース(?:ース)+/gu, "ワンピース")
    .replace(/^\s*\d{1,2}時(?:予約|販売|抽選)?(?:解禁|開始).*$/u, "")
    .replace(/\s+\d{1,3},?\d{2,}\s*円.*$/i, "")
    .replace(/\s*のページ$/u, "")
    .replace(/\s*ページ$/u, "")
    .replace(/\s*につきまして.*$/u, "")
    .replace(/\s*にてご案内させていただきます.*$/u, "")
    .replace(/\s*のファンの感想.*$/u, "")
    .replace(/\s*すべての写真を見る\(\d+件\).*$/u, "")
    .replace(/\s*この記事を書いた人.*$/u, "")
    .replace(/\s*スポンサーリンク.*$/u, "")
    .replace(/\s*RESALE LAB.*$/u, "")
    .replace(/\s*世界No\.?1ファッションフリマアプリ.*$/u, "")
    .replace(/\s*最新の映画ニュースならMOVIE WALKER PRESS.*$/u, "")
    .replace(/\s*映画ニュース・インタビュー・海外ゴシップ.*$/u, "")
    .replace(/\s*MOVIE WALKER会員.*$/u, "")
    .replace(/\s*公開直前イベント.*$/u, "")
    .replace(/\s*(?:一番くじでしか手に入らない|最後の1個を引くと手に入る|くじの残り数は店舗でご確認|店舗でご確認下さい|店舗でご確認ください).*$/u, "")
    .replace(/\s*一番くじ倶楽部またはくじ券をご確認ください.*$/u, "")
    .replace(/\s*一番くじ倶楽部.*$/u, "")
    .replace(/\s*ノベルティフェア\s*開催開始日.*$/u, "")
    .replace(/\s*(?:illustration\s+by|イラスト(?:レーション)?\s*[:：]?|描きおろし|描き下ろし).*$/iu, "")
    .replace(/\s*が(?:\d{1,2}\/\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日).*(?:発売|販売|開始|スタート).*$|が(?:発売|販売|開始|スタート).*$|の(?:抽選|応募|販売|予約).*$|を(?:確認|紹介).*$|の詳細.*$/iu, "")
    .replace(/\s*複数のカードがランダムに封入されている.*$/u, "")
    .replace(/[。].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return dedupeRepeatedProductPhrase(normalized);
}

function looksLikeRetailListingSnippet(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/^フィギュア\s+\d{1,3},?\d{3}\s/u.test(text) && (text.match(/\d{1,3},?\d{3}/g) ?? []).length >= 2) return true;
  if (/^\d{1,3},?\d{3}\s+.+?\s+\d{1,2}%\s+\d{1,3},?\d{3}/u.test(text)) return true;
  return false;
}

function looksLikePollutedComparableKey(key = "") {
  const text = String(key ?? "").replace(/\s+/g, "").trim();
  if (!text || text.length < 8) return true;
  if (/転売|せどり|tagstcg|tags/i.test(text) && !/vol\.?\d|第\d+弾|ga-\d|dw-\d/i.test(text)) return true;
  return false;
}

function isReliableComparableProduct(product) {
  if (!product?.canonicalName || !product?.productKey) return false;
  if (!productPhraseLooksSpecific(product.canonicalName)) return false;
  if (looksLikeSiteChromeProductName(product.canonicalName)) return false;
  if (looksLikeRetailListingSnippet(product.canonicalName)) return false;
  if (looksLikePollutedComparableKey(product.productKey)) return false;
  return true;
}

function comparableLaunchPriceFromSnapshots(priceRows = []) {
  const verifiedMarket = priceRows.find(
    (row) =>
      row.priceType === "market" &&
      Number.isFinite(row.value) &&
      (row.buyLineEligible === true || row.priceSourceRank === "manual_price"),
  );
  if (verifiedMarket) return verifiedMarket.value;
  return null;
}

function looksLikeSiteChromeProductName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^(店舗検索|商品検索|キャラクター一覧|ブランド一覧|発売時期|発売済|すべて|ラインナップ)$/i.test(text)) return true;
  if (/^(ポケモンカードゲーム公式ホームページ\s*商品情報|ポケモンカードチャンネル|公式facebook|公式チャンネル)$/i.test(text)) return true;
  if (/ポケモンカードゲーム公式ホーム$|公式ホームページ?$|公式ホーム$/u.test(text)) return true;
  if (/ご愛顧いただき/u.test(text)) return true;
  if (/^一番くじ\s+BANDAI\s*SPIRITS$/iu.test(text)) return true;
  if (/javascript\s+is\s+not\s+available/i.test(text)) return true;
  if (/https?:\/\/|(?:^|\s)t\.co\//i.test(text)) return true;
  if (looksLikeRetailListingSnippet(text)) return true;
  if (/-->/.test(text)) return true;
  if (/公式ホームページ|イベント検索|カード\s*Q&A|はじめての方へ|はじめよう！ポケモンカード|ウェブアクセシビリティ方針|スペシャルページ|各等賞一覧|一番くじ公式ショップ/.test(text)) return true;
  if (/のページ$/.test(text) && !/一番くじ\s+/.test(text)) return true;
  if (/複数のカードがランダムに封入されている|ファンの感想|ご案内させていただきます|ポイくじ|送料無料チケット|一番くじでしか手に入らない|最後の1個を引くと手に入る|くじの残り数は店舗でご確認|店舗でご確認下さい|店舗でご確認ください|一番くじ倶楽部|illustration\s+by|描きおろし|描き下ろし/.test(text)) return true;
  const chromeHits = [...text.matchAll(/一番くじ情報サイト|キャラクター一覧|ブランド一覧|店舗検索|商品検索|language\s+日本語|発売時期|発売済|すべて|ラインナップ/gi)].length;
  if (chromeHits >= 2) return true;
  if (/一番くじ情報サイト/i.test(text) && !/^一番くじ\s+/i.test(text)) return true;
  if (/ウェブアクセシビリティ方針/i.test(text)) return true;
  if (/公式ショップ$/u.test(text) && !/一番くじ\s+.+/.test(text)) return true;
  if (looksLikeMovieArticleTitle(text)) return true;
  if (looksLikeArticleBoilerplateName(text)) return true;
  if (looksLikePrizeDescriptionBlob(text)) return true;
  if (looksLikeCategoryListingName(text)) return true;
  if (looksLikeNarrativeProductName(text)) return true;
  return false;
}

function productPhraseLooksSpecific(name) {
  const cleaned = canonicalizeProductName(name);
  if (cleaned.length < 5 || cleaned.length > 96) return false;
  if (looksLikeSiteChromeProductName(cleaned)) return false;
  if (looksLikeRouteLabelName(cleaned)) return false;
  if (looksLikeGenericMovieMerchName(cleaned)) return false;
  if (looksLikeMovieArticleTitle(cleaned)) return false;
  if (looksLikeArticleBoilerplateName(cleaned)) return false;
  if (looksLikePrizeDescriptionBlob(cleaned)) return false;
  if (looksLikeCategoryListingName(cleaned)) return false;
  if (looksLikeNarrativeProductName(cleaned)) return false;
  if (/^(品薄|完売|プレ値|速報|抽選|応募|予約|再販|入荷)(?:注意報|情報|速報|まとめ)?(?:\s*\(\d+\))?$/i.test(cleaned)) return false;
  if (/^(抽選|応募|予約|再販|完売|品薄|フィギュア|グッズ|サプライ|マスコット|ぬいぐるみ|キーホルダー|フィギュア・プラモデル)$/i.test(cleaned)) {
    return false;
  }
  if (/^(?:拡張パック|強化拡張パック|ポケモンカードゲーム|ポケモンカード|ポケカ拡張パック|ポケモンカードゲーム最新拡張パック)$/u.test(cleaned)) return false;
  if (/^拡張パック(?:ですら|が再販|については|はいずれも|は軒並み|を対象に)/u.test(cleaned)) return false;
  if (/(価格|税込|ジャンル|発売日|販売開始|販売先リンク|次の記事|前の記事|一括検索|販売状況|Yahoo!ショッピング|楽天市場|Amazon|アマゾン|こちら|先取り情報|その他|[=＝]{3,}|#|★)/i.test(cleaned)) return false;
  if (/一番くじONLINE|HMV＆BOOKS限定グッズ|セブンネット限定グッズ|限定グッズ各種/i.test(cleaned)) return false;
  if (/一番くじでしか手に入らない|最後の1個を引くと手に入る|くじの残り数は店舗でご確認|店舗でご確認下さい|店舗でご確認ください|illustration\s+by|描きおろし|描き下ろし|商品説明を見る|物語の主人公|作品に欠かせない|一番くじフィギュアブランド|ドラゴンクエストとは\s+タイトル一覧|^\s*\d{1,2}時(?:予約|販売|抽選)?(?:解禁|開始)/i.test(cleaned)) return false;
  if ((cleaned.match(/一番くじ/g) ?? []).length >= 2 && !/vol\.?\s*\d+|第\d+弾/i.test(cleaned)) return false;
  return PRODUCT_SIGNAL_WORD.test(cleaned);
}

function isMonitorOnlyName(value) {
  const name = canonicalizeProductName(value);
  if (!name) return true;
  if (looksLikeSiteChromeProductName(name)) return true;
  if (/スマートウォッチ/i.test(name)) return false;
  if (/^(品薄|完売|プレ値|速報|抽選|応募|予約|再販|入荷)(?:注意報|情報|速報|まとめ)?(?:\s*\(\d+\))?$/i.test(name)) return true;
  if (/(品薄|完売).*(ウォッチ|監視)|(?:ウォッチ|監視)$/i.test(name)) return true;
  if (/^(転売はかせ|えみのせどり部屋|3度の飯よりプレミアム|しなかん|品薄完売ブログ|転売ヤーかなえ)/i.test(name)) return true;
  return false;
}

function detectSourceChannel(source, url = "") {
  if (source?.lane === "blog") return "blog";
  if (source?.lane === "sns") return "sns";
  if (source?.lane === "news") return "news";
  if (source?.lane === "market") return "market";
  if (source?.lane === "lottery" || source?.lane === "official") return "official";
  const typeText = [source?.trend?.type, source?.trend?.context, source?.candidate?.reason].join(" ");
  const host = String(tryParseUrl(url || source?.url || "")?.hostname ?? "").toLowerCase();
  if (/ブログ監視/.test(typeText)) return "blog";
  if (/sns監視/.test(typeText)) return "sns";
  if (host.includes("x.com") || host.includes("twitter.com")) return "sns";
  if (NEWS_SOURCE_HOSTS.test(host)) return "news";
  if (MARKET_SOURCE_HOSTS.test(host)) return "market";
  if (host.includes("fc2.com") || host.includes("blog") || host.includes("livedoor")) return "blog";
  return "official";
}

function sourceReliabilityLevel(source, url = "") {
  const channel = detectSourceChannel(source, url);
  if (channel === "official") return "high";
  if (channel === "news") return "medium";
  if (channel === "blog") return "medium";
  return "medium";
}

function extractIsoDatesFromText(text) {
  const found = new Set();
  const patterns = [
    /20\d{2}[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/g,
    /(\d{1,2})月(\d{1,2})日/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      if (match[0].includes("年")) {
        const converted = toIsoDateFromJapanese(match[0]);
        if (converted) found.add(converted);
      } else if (/^\d{4}[\/\-.]/.test(match[0])) {
        const ymd = match[0].replace(/[年/.]/g, "-").replace("月", "-").replace("日", "");
        const [year, month, day] = ymd.split("-").map((v) => v.trim()).filter(Boolean);
        if (year && month && day) found.add(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
      } else if (match[1] && match[2]) {
        const now = new Date();
        const year = String(now.getFullYear());
        found.add(`${year}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`);
      }
      if (found.size >= 6) break;
    }
  }
  return [...found].sort();
}

function determineStartEndDate(source, fallbackDate, textSnippet = "") {
  const isoDates = extractIsoDatesFromText(textSnippet);
  const explicitStart = source?.candidate?.startDate ?? source?.trend?.startDate ?? null;
  const explicitEnd = source?.candidate?.endDate ?? source?.trend?.endDate ?? null;
  const startDate = explicitStart ?? isoDates[0] ?? fallbackDate;
  const endDate = explicitEnd ?? isoDates[1] ?? (startDate ? addDaysToIsoDate(startDate, 14) : fallbackDate);
  return { startDate, endDate };
}

function scoreCandidateByAxes({ freshnessDays = 7, hasRoute = false, hasPeriod = false, hasPrice = false, repeatHits = 0 }) {
  const speed = clampNumber(20 - Math.max(0, freshnessDays - 1) * 2, 0, 20);
  const route = hasRoute ? 20 : 4;
  const period = hasPeriod ? 20 : 6;
  const price = hasPrice ? 20 : 5;
  const repeat = clampNumber(8 + repeatHits * 2, 0, 20);
  return {
    speed,
    route,
    period,
    price,
    repeat,
    total: clampNumber(speed + route + period + price + repeat, 35, 98),
  };
}

function extractProductPatterns(text, patterns) {
  const phrases = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) ?? [];
    for (const match of matches) {
      const cleaned = canonicalizeProductName(match.replace(/\s+/g, " ").trim());
      if (productPhraseLooksSpecific(cleaned)) phrases.push(cleaned);
    }
  }
  return phrases;
}

function extractPokemonProductPhrases(text) {
  return extractProductPatterns(text, [
    /(?:ポケモンカードゲーム|ポケモンカード|ポケカ)[^。、「」\n]{2,90}/g,
    /(?:拡張パック|強化拡張パック|ハイクラスパック)[^。、「」\n]{2,90}/g,
    /(?:デッキシールド|プレイマット|サプライ)[^。、「」\n]{2,90}/g,
  ]);
}

function extractKujiProductPhrases(text) {
  return extractProductPatterns(text, [
    /一番くじ[^。、「」\n]{4,90}/g,
    /(?:ラストワン賞|[A-H]賞)[^。、「」\n]{2,72}/g,
  ]);
}

function extractWatchProductPhrases(text) {
  return extractProductPatterns(text, [
    /G-SHOCK[^。、「」\n]{1,90}/gi,
    /GARRACK[^。、「」\n]{1,90}/gi,
    /(?:GA|DW|GW|GM|GMA|GST|MTG|MRG|GAE)-?[0-9A-Z-]{3,20}/g,
    /(?:スマートウォッチ|腕時計)[^。、「」\n]{2,72}/g,
  ]);
}

function extractFigureProductPhrases(text) {
  return extractProductPatterns(text, [
    /S\.H\.Figuarts[^。、「」\n]{2,90}/gi,
    /(?:METAL BUILD|ROBOT魂|超合金|ねんどろいど|figma|Portrait\.Of\.Pirates|P\.O\.P|MASTERLISE|SOFVICS|BUSTISAN)[^。、「」\n]{2,90}/gi,
    /(?:フィギュア|胸像)[^。、「」\n]{4,72}/g,
  ]);
}

function extractGoodsProductPhrases(text) {
  return extractProductPatterns(text, [
    /(?:ちいかわ|サンリオ|すみっコぐらし|星のカービィ|カービィ|たまごっち|お文具といっしょ)[^。、「」\n]{2,90}/g,
    /(?:メタリックモンスターズ|メタリックアイテムズ|ロト|スライム|はぐれメタル|ゴーレム)[^。、「」\n]{2,90}/g,
    /(?:ぬいぐるみ|マスコット|キーホルダー)[^。、「」\n]{2,72}/g,
  ]);
}

function extractMovieProductPhrases(text) {
  const phrases = [];
  const push = (value) => {
    const cleaned = canonicalizeProductName(value);
    if (productPhraseLooksSpecific(cleaned)) phrases.push(cleaned);
  };

  for (const match of text.matchAll(/『([^』]{2,60})』[^。、「」\n]{0,80}(ムビチケ前売券(?:\(オンライン\))?|前売券特典|ムビチケ特典|入場者特典|来場者特典|劇場限定グッズ|上映記念グッズ|パンフレット|鑑賞券)/g)) {
    push(`${match[1]} ${match[2]}`);
  }
  for (const match of text.matchAll(/『([^』]{2,60})』[^。、「」\n]{0,40}(第\d+弾|週替わり特典)/g)) {
    push(`${match[1]} ${match[2]}`);
  }
  for (const match of text.matchAll(/(?:劇場版|映画)[^。、「」\n]{2,90}(?:入場者特典|来場者特典|前売券|ムビチケ|劇場限定|パンフレット|グッズ)[^。、「」\n]{0,90}/g)) {
    push(match[0]);
  }
  for (const match of text.matchAll(/(?:入場者特典|来場者特典|前売券特典|ムビチケ特典|劇場限定グッズ|上映記念グッズ|ムビチケ前売券|パンフレット)[^。、「」\n]{2,90}/g)) {
    push(match[0]);
  }
  return [...new Set(phrases)];
}

function extractMovieLinkedProducts(title, text, links) {
  const phrases = [];
  const push = (value) => {
    const cleaned = canonicalizeProductName(value);
    if (productPhraseLooksSpecific(cleaned)) phrases.push(cleaned);
  };
  const joined = `${title} ${text}`;
  const movieTitle = [...joined.matchAll(/『([^』]{2,60})』/g)]
    .map((match) => canonicalizeProductName(match[1]))
    .find((name) => productPhraseLooksSpecific(name));
  const ticketLink = (links ?? []).find((link) => /https:\/\/(?:mvtk\.jp|ticket\.moviewalker\.jp)\/Film\//.test(String(link?.url ?? "")));
  if (movieTitle && ticketLink) {
    push(`${movieTitle} ムビチケ前売券`);
  }
  if (movieTitle && /入場者特典|来場者特典|週替わり特典/.test(joined)) {
    push(`${movieTitle} 入場者特典`);
  }
  return [...new Set(phrases)];
}

function looksLikeGenericMovieMerchName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^ムビチケ前売券(?:\(.*\))?(?:は.*)?$/u.test(text)) return true;
  if (/^(入場者特典|来場者特典|週替わり特典|前売券特典|ムビチケ特典|劇場限定グッズ|上映記念グッズ|パンフレット|鑑賞券)$/u.test(text)) {
    return true;
  }
  if (/(ムビチケ前売券|前売券|入場者特典|来場者特典)$/u.test(text)) {
    const baseTitle = text.replace(/\s*(ムビチケ前売券|前売券|入場者特典|来場者特典)$/u, "").trim();
    if (/[。！？]/u.test(baseTitle)) return true;
    if (/ような作品|したい|もらえます|無くなり次第|お見逃しなく|購入で|プレゼント|数量限定/u.test(baseTitle)) return true;
    if (baseTitle.length >= 34 && /(?:が|を|に|へ|で|から|まで|より|について|として)/u.test(baseTitle)) return true;
  }
  return false;
}

function extractGenericHobbyProductPhrases(text) {
  return extractProductPatterns(text, [
    /ドラゴンボール[^。、「」\n]{2,90}/g,
    /ワンピース[^。、「」\n]{2,90}/g,
    /ドラゴンクエスト[^。、「」\n]{2,90}/g,
    /(?:プレミアムバンダイ|プレバン)[^。、「」\n]{4,90}/g,
  ]);
}

function extractProductPhrases(text) {
  return [
    ...new Set(
      [
        ...extractPokemonProductPhrases(text),
        ...extractKujiProductPhrases(text),
        ...extractWatchProductPhrases(text),
        ...extractFigureProductPhrases(text),
        ...extractGoodsProductPhrases(text),
        ...extractMovieProductPhrases(text),
        ...extractGenericHobbyProductPhrases(text),
      ].filter(productPhraseLooksSpecific),
    ),
  ].slice(0, 18);
}

function scoreArticleLink(link, sourceHost = "") {
  const text = `${link.anchorText ?? ""} ${link.url ?? ""}`;
  const host = String(tryParseUrl(link.url)?.hostname ?? "");
  let score = 0;
  if (PRODUCT_SIGNAL_WORD.test(text)) score += 8;
  if (/抽選|再販|発売|予約|完売|品薄/.test(text)) score += 4;
  if (/\/status\/|\/archives\/|\/article|\/news\//.test(link.url)) score += 3;
  if (host && sourceHost && host === sourceHost) score += 2;
  if (/privacy|about|contact|profile|help/i.test(link.url)) score -= 8;
  return score;
}

function pickRecentArticleLinks(source, result) {
  const links = extractLinksFromHtml(result?.html ?? "", result?.url ?? source?.url ?? "");
  const sourceHost = String(tryParseUrl(result?.url ?? source?.url ?? "")?.hostname ?? "");
  const recentLimit = Number(source?.crawlBudget?.recentLimit ?? BLOG_SNS_RECENT_LIMIT);
  const scoredLinks = links
    .map((link) => ({ ...link, score: scoreArticleLink(link, sourceHost) }))
    .filter((item) => item.score >= 6)
    .sort((a, b) => b.score - a.score);
  const fallbackLinks = links
    .map((link) => ({ ...link, score: scoreArticleLink(link, sourceHost) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score);
  return [...new Map([...scoredLinks, ...fallbackLinks].map((item) => [item.url, item])).values()].slice(0, recentLimit);
}

async function expandBlogSnsCandidates(source, result, historyRuns) {
  if (!result?.ok) {
    return { trends: [], candidates: [], stats: { scanned: 0, generated: 0 }, documents: [], discoveredSources: [], llmExtractions: [] };
  }
  const channel = detectSourceChannel(source, result.url);
  if (channel !== "blog" && channel !== "sns" && channel !== "news") {
    return { trends: [], candidates: [], stats: { scanned: 0, generated: 0 }, documents: [], discoveredSources: [], llmExtractions: [] };
  }

  const links = pickRecentArticleLinks(source, result);
  const trends = [];
  const candidates = [];
  const documents = [];
  const discoveredSources = [];
  const llmExtractions = [];
  const discoveredKeys = new Set();
  const seen = new Set();
  const detailLimit = Number(source?.crawlBudget?.detailLimit ?? BLOG_SNS_DETAIL_FETCH_LIMIT);
  const scannedLinks = [
    { url: result.url ?? source.url, anchorText: source.keyword ?? source.trend?.keyword ?? "", score: 99, useFetchedResult: true },
    ...links,
  ].slice(0, detailLimit);
  const reliability = sourceReliabilityLevel(source, result.url);

  for (const [index, link] of scannedLinks.entries()) {
    const articleResult = link.useFetchedResult ? result : await fetchSource({ id: `${source.id}:article:${index}`, url: link.url });
    const articleText = `${link.anchorText ?? ""} ${articleResult.title ?? ""} ${articleResult.text ?? ""}`.slice(0, 22000);
    if (!PRODUCT_SIGNAL_WORD.test(articleText)) continue;
    const dateBase =
      toIsoDateFromJapanese(extractFirst(articleText, [/(\d{4}年\d{1,2}月\d{1,2}日)/])) ?? articleResult.fetchedAt.slice(0, 10);
    const { startDate, endDate } = determineStartEndDate(source, dateBase, articleText);
    const routeLinks = extractLinksFromHtml(articleResult.html ?? "", articleResult.url ?? link.url)
      .filter((item) => ROUTE_HOST_ALLOW.test(item.url))
      .filter((item) => !isAffiliateUrl(item.url))
      .filter((item) => !isGenericCommerceUrl(item.url))
      .slice(0, 3);
    const routeUrl = routeLinks[0]?.url ?? "";
    const extractedNames = [];
    const names = [
      canonicalizeProductName(link.anchorText ?? ""),
      ...extractProductPhrases(articleText),
    ].filter(productPhraseLooksSpecific);
    for (const rawName of names.slice(0, 6)) {
      const name = canonicalizeProductName(rawName);
      const dedupKey = normalizeSignalText(name);
      if (!dedupKey || seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      extractedNames.push(name);
      const retailPrice = extractRetailPrice(articleText, name, null);
      const support = computeHistorySupport(historyRuns, name);
      const dayDiff = Math.max(0, Math.floor((Date.now() - new Date(`${dateBase}T00:00:00+09:00`).getTime()) / 86_400_000));
      const axis = scoreCandidateByAxes({
        freshnessDays: dayDiff,
        hasRoute: Boolean(routeUrl),
        hasPeriod: Boolean(startDate && endDate),
        hasPrice: Number.isFinite(retailPrice),
        repeatHits: support.recentHits,
      });
      const confidence = axis.total >= 78 ? "高" : axis.total >= 62 ? "中" : "低";
      const monitorType = channel === "blog" ? "ブログ抽出" : channel === "sns" ? "SNS抽出" : "ニュース抽出";

      trends.push({
        keyword: name,
        context: `${monitorType} / ${source.keyword ?? source.trend?.keyword ?? "監視ソース"}`,
        score: axis.total,
        type: monitorType,
        change24h: `抽出 ${dateBase.slice(5).replace("-", "/")}`,
        source: source.trend?.source ?? source.keyword ?? "監視ソース",
        confidence,
        startDate,
        endDate,
        action: "導線・価格・期間を再確認して候補判定",
      });

      const missing = [];
      if (!startDate || !endDate) missing.push("期間情報");
      if (!routeUrl) missing.push("公式導線");
      if (!Number.isFinite(retailPrice)) missing.push("価格データ");
      candidates.push({
        name,
        trend: source.trend?.keyword ?? source.keyword ?? "監視ソース",
        stage: "追加候補",
        stageKind: "candidate",
        genreScore: axis.total,
        priceData: Number.isFinite(retailPrice) ? "取得" : "未取得",
        tradeVolume: support.recentHits >= 2 ? "上昇" : "要確認",
        marginSignal: `速報性${axis.speed}/20 導線${axis.route}/20 期間${axis.period}/20 価格${axis.price}/20 反復${axis.repeat}/20`,
        reason: `${monitorType}の最新記事から商品名を抽出。導線と価格を照合して昇格判定。`,
        confidence,
        adoptionReason: `${source.keyword ?? source.trend?.keyword ?? "監視ソース"}由来 / 記事抽出`,
        missingData: missing.length > 0 ? missing.join("、") : "発売後の成約価格、送料サイズ",
        sourceUrl: routeUrl || "",
        routeFinalUrl: routeUrl || null,
        evidenceUrl: articleResult.url || link.url,
        retailPrice: Number.isFinite(retailPrice) ? retailPrice : null,
        retailPriceLabel: Number.isFinite(retailPrice) ? `抽出価格 ${formatYen(retailPrice)}` : null,
        retailPriceSource: Number.isFinite(retailPrice) ? "blog-sns-article" : null,
        startDate,
        endDate,
        sourceChannel: channel,
        sourceReliability: reliability,
      });
    }

    if (!link.useFetchedResult) {
      const documentRecord = buildDocumentRecord(source, articleResult, {
        extractedProductCount: extractedNames.length,
        routeHitCount: routeLinks.length,
        useful: extractedNames.length > 0 || routeLinks.length > 0,
      });
      documents.push(documentRecord);
      const articleDiscovered = extractDiscoveredSourcesFromResult(source, articleResult, {
        docId: documentRecord.docId,
        productNames: extractedNames,
        routeHitCount: routeLinks.length,
      });
      for (const discovered of articleDiscovered) {
        if (discoveredKeys.has(discovered.sourceKey)) continue;
        discoveredKeys.add(discovered.sourceKey);
        discoveredSources.push(discovered);
      }
      await archiveFetchedDocument({
        ...documentRecord,
        html: articleResult.html ?? "",
        text: articleResult.text ?? "",
        outLinks: extractLinksFromHtml(articleResult.html ?? "", articleResult.url ?? link.url).slice(0, 50),
        evidenceProducts: extractedNames,
        discoveredSourceKeys: articleDiscovered.map((item) => item.sourceKey),
      });
      const structuredExtraction = await buildStructuredLlmExtraction({
        docId: documentRecord.docId,
        source,
        result: articleResult,
        evidenceProducts: extractedNames,
        extractedCandidates: candidates.filter((candidate) => extractedNames.includes(candidate.name)),
      });
      llmExtractions.push(structuredExtraction);
      const llmCandidates = buildCandidatesFromLlmExtraction(structuredExtraction, source, dateBase, reliability).filter((candidate) => {
        const key = normalizeSignalText(candidate.name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      candidates.push(...llmCandidates);
      trends.push(
        ...buildTrendsFromLlmExtraction(
          structuredExtraction,
          source,
          dateBase,
          source.trend?.source ?? source.keyword ?? "監視ソース",
        ).filter((trend) => llmCandidates.some((candidate) => normalizeProductKey(candidate.name) === normalizeProductKey(trend.keyword))),
      );
    }
  }

  return {
    trends,
    candidates,
    stats: { scanned: scannedLinks.length, generated: candidates.length },
    documents,
    discoveredSources,
    llmExtractions,
  };
}

function deriveSourceKeywordHint(url, lane, anchorText = "") {
  const parsed = tryParseUrl(url);
  const cleanAnchor = canonicalizeProductName(anchorText).slice(0, 80);
  if (cleanAnchor && cleanAnchor.length >= 2) return cleanAnchor;
  if (!parsed) return lane;
  const host = parsed.hostname.replace(/^www\./, "");
  if (lane === "sns") {
    const handle = parsed.pathname.split("/").filter(Boolean)[0];
    return handle ? `@${handle}` : host;
  }
  if (lane === "official" || lane === "lottery") return host;
  return host;
}

function detectDiscoveryPriority(lane, url = "", anchorText = "") {
  const joined = `${anchorText} ${url}`;
  if (lane === "lottery") return "high";
  if (lane === "official" && PRODUCT_SIGNAL_WORD.test(joined)) return "high";
  if (lane === "news") return "medium";
  if (lane === "blog" || lane === "sns") return "medium";
  return "low";
}

function buildDiscoverySourceCandidate({
  url,
  lane,
  anchorText = "",
  parentSource = null,
  parentDocId = null,
  fetchedAt = null,
  evidenceProducts = [],
  routeHitCount = 0,
}) {
  const canonical = canonicalizeDiscoveredSource(url, lane);
  if (!canonical) return null;
  const keywordHint = deriveSourceKeywordHint(url, lane, anchorText);
  const specificProducts = evidenceProducts.filter((name) => productPhraseLooksSpecific(name)).slice(0, 8);
  const candidate = buildRegistryEntry({
    lane,
    keywordHint,
    titleHint: anchorText,
    url,
    canonicalUrl: canonical.canonicalUrl,
    canonicalPath: canonical.canonicalPath,
    templateKind: canonical.templateKind,
    host: canonical.host,
    status: "candidate",
    priority: detectDiscoveryPriority(lane, url, anchorText),
    followDomains: [canonical.host],
    discoveredFrom: [parentSource?.sourceKey ?? parentSource?.id ?? parentSource?.url ?? ""].filter(Boolean),
    evidenceDocs: [parentDocId].filter(Boolean),
    evidenceProducts: specificProducts,
    firstSeenAt: fetchedAt,
    lastSeenAt: fetchedAt,
    discoveredCount: 1,
    productHitCount: specificProducts.length,
    routeHitCount,
    priceHitCount: 0,
    directRouteCount: routeHitCount > 0 ? 1 : 0,
    specificProductCount: specificProducts.length,
    genericNoiseCount: specificProducts.length === 0 ? 1 : 0,
    lastDecisionReason: `親documentから ${lane} ソース候補を検出`,
  });
  if (!discoveredSourceIsValid(candidate)) return null;
  candidate.specificProductRatio =
    candidate.specificProductCount + candidate.genericNoiseCount > 0
      ? candidate.specificProductCount / (candidate.specificProductCount + candidate.genericNoiseCount)
      : 0;
  candidate.sourceQuality = calculateSourceQuality(candidate);
  return candidate;
}

function extractDiscoveredSourcesFromResult(source, result, context = {}) {
  if (!result?.ok || !result?.html) return [];
  const parentLane = source?.lane ?? laneFromHostAndText(result.url || source?.url || "", "", source?.keyword ?? "") ?? "official";
  const links = extractLinksFromHtml(result.html, result.url ?? source?.url ?? "");
  const byKey = new Map();
  for (const link of links) {
    const lane = laneFromHostAndText(link.url, link.anchorText, `${source?.keyword ?? ""} ${result.title ?? ""}`);
    if (!lane) continue;
    if (lane === "market" && parentLane === "market") continue;
    const candidate = buildDiscoverySourceCandidate({
      url: link.url,
      lane,
      anchorText: link.anchorText,
      parentSource: source,
      parentDocId: context.docId ?? null,
      fetchedAt: result.fetchedAt ?? null,
      evidenceProducts: context.productNames ?? [],
      routeHitCount: context.routeHitCount ?? 0,
    });
    if (!candidate) continue;
    if (!byKey.has(candidate.sourceKey)) {
      byKey.set(candidate.sourceKey, candidate);
    }
    if (byKey.size >= DISCOVERY_SOURCE_LIMIT) break;
  }
  return [...byKey.values()];
}

function applyDiscoveryToRegistryEntry(entry, candidate) {
  const merged = buildRegistryEntry({
    ...entry,
    lane: candidate.lane,
    keywordHint: candidate.keywordHint || entry.keywordHint,
    titleHint: candidate.titleHint || entry.titleHint,
    url: candidate.url || entry.url,
    canonicalUrl: candidate.canonicalUrl || entry.canonicalUrl,
    canonicalPath: candidate.canonicalPath || entry.canonicalPath,
    templateKind: candidate.templateKind || entry.templateKind,
    host: candidate.host || entry.host,
    priority:
      sourcePriorityWeight(candidate.priority) > sourcePriorityWeight(entry.priority) ? candidate.priority : entry.priority,
    followDomains: [...new Set([...(entry.followDomains ?? []), ...(candidate.followDomains ?? [])])],
    lastSeenAt: candidate.lastSeenAt ?? entry.lastSeenAt,
    firstSeenAt: entry.firstSeenAt ?? candidate.firstSeenAt,
    discoveredFrom: [...new Set([...(entry.discoveredFrom ?? []), ...(candidate.discoveredFrom ?? [])])],
    evidenceDocs: [...new Set([...(entry.evidenceDocs ?? []), ...(candidate.evidenceDocs ?? [])])].slice(0, 24),
    evidenceProducts: [...new Set([...(entry.evidenceProducts ?? []), ...(candidate.evidenceProducts ?? [])])].slice(0, 24),
    discoveredCount: Number(entry.discoveredCount ?? 0) + 1,
    productHitCount: Number(entry.productHitCount ?? 0) + Number(candidate.productHitCount ?? 0),
    routeHitCount: Number(entry.routeHitCount ?? 0) + Number(candidate.routeHitCount ?? 0),
    priceHitCount: Number(entry.priceHitCount ?? 0) + Number(candidate.priceHitCount ?? 0),
    directRouteCount: Number(entry.directRouteCount ?? 0) + Number(candidate.directRouteCount ?? 0),
    specificProductCount: Number(entry.specificProductCount ?? 0) + Number(candidate.specificProductCount ?? 0),
    genericNoiseCount: Number(entry.genericNoiseCount ?? 0) + Number(candidate.genericNoiseCount ?? 0),
    lastDecisionReason: candidate.lastDecisionReason ?? entry.lastDecisionReason,
  });
  const totalObserved = merged.specificProductCount + merged.genericNoiseCount;
  merged.specificProductRatio = totalObserved > 0 ? merged.specificProductCount / totalObserved : 0;
  const extractionTotal = merged.productHitCount + merged.genericNoiseCount;
  merged.productExtractionRate = extractionTotal > 0 ? merged.specificProductCount / extractionTotal : 0;
  merged.directRouteRate = merged.productHitCount > 0 ? merged.directRouteCount / Math.max(1, merged.productHitCount) : 0;
  merged.priceHitRate = merged.productHitCount > 0 ? merged.priceHitCount / Math.max(1, merged.productHitCount) : 0;
  merged.sourceQuality = calculateSourceQuality(merged);
  return merged;
}

function candidateShouldPromoteToTrial(entry) {
  if (entry.status !== "candidate") return false;
  if (entry.lane === "official" || entry.lane === "lottery") {
    return Number(entry.productHitCount ?? 0) >= 1 || Number(entry.routeHitCount ?? 0) >= 1;
  }
  if (entry.lane === "blog" || entry.lane === "sns" || entry.lane === "news") {
    return (entry.evidenceDocs ?? []).length >= 2 || Number(entry.specificProductCount ?? 0) >= 3;
  }
  if (entry.lane === "market") {
    return (entry.evidenceProducts ?? []).length >= 2;
  }
  return false;
}

function trialShouldPromoteToActive(entry) {
  const totalRuns = Number(entry.successRuns ?? 0) + Number(entry.failureRuns ?? 0);
  const failRate = totalRuns > 0 ? Number(entry.failureRuns ?? 0) / totalRuns : 0;
  return (
    entry.status === "trial" &&
    Number(entry.successRuns ?? 0) >= 2 &&
    Number(entry.specificProductRatio ?? 0) >= 0.55 &&
    (Number(entry.productHitCount ?? 0) >= 4 || Number(entry.routeHitCount ?? 0) >= 2) &&
    failRate < 0.4
  );
}

function applyRunOutcomeToRegistryEntry(entry, outcome = {}) {
  const next = buildRegistryEntry({
    ...entry,
    lastFetchedAt: outcome.fetchedAt ?? entry.lastFetchedAt,
    lastSeenAt: outcome.fetchedAt ?? entry.lastSeenAt,
    keywordHint: outcome.keywordHint ?? entry.keywordHint,
    titleHint: outcome.titleHint ?? entry.titleHint,
  });
  if (outcome.success) {
    next.successRuns += 1;
    next.consecutiveFailures = 0;
  } else {
    next.failureRuns += 1;
    next.consecutiveFailures += 1;
  }
  if (outcome.useful) {
    next.usefulRuns += 1;
    next.lastUsefulAt = outcome.fetchedAt ?? next.lastUsefulAt;
  }
  next.productHitCount += Number(outcome.productHitCount ?? 0);
  next.routeHitCount += Number(outcome.routeHitCount ?? 0);
  next.priceHitCount += Number(outcome.priceHitCount ?? 0);
  next.directRouteCount += Number(outcome.directRouteCount ?? 0);
  next.specificProductCount += Number(outcome.specificProductCount ?? 0);
  next.genericNoiseCount += Number(outcome.genericNoiseCount ?? 0);
  next.evidenceDocs = [...new Set([...(next.evidenceDocs ?? []), ...(outcome.evidenceDocs ?? [])])].slice(0, 24);
  next.evidenceProducts = [...new Set([...(next.evidenceProducts ?? []), ...(outcome.evidenceProducts ?? [])])].slice(0, 24);
  const totalObserved = next.specificProductCount + next.genericNoiseCount;
  next.specificProductRatio = totalObserved > 0 ? next.specificProductCount / totalObserved : 0;
  const extractionTotal = next.productHitCount + next.genericNoiseCount;
  next.productExtractionRate = extractionTotal > 0 ? next.specificProductCount / extractionTotal : 0;
  next.directRouteRate = next.productHitCount > 0 ? next.directRouteCount / Math.max(1, next.productHitCount) : 0;
  next.priceHitRate = next.productHitCount > 0 ? next.priceHitCount / Math.max(1, next.productHitCount) : 0;
  next.sourceQuality = calculateSourceQuality(next);
  return next;
}

function promoteRegistryEntries(entries) {
  let trialPromotions = 0;
  let activePromotions = 0;
  const now = todayIsoDate();
  return entries.map((rawEntry) => {
    const entry = buildRegistryEntry(rawEntry);
    if (entry.status === "manual") {
      entry.sourceQuality = calculateSourceQuality(entry);
      return entry;
    }
    if (sourceStatusShouldArchive(entry, now)) {
      entry.status = "archived";
      entry.lastDecisionReason = "45日以上 useful hit がないため archived";
      return entry;
    }
    if (entry.status === "trial" && Number(entry.consecutiveFailures ?? 0) >= TRIAL_FAIL_LIMIT) {
      entry.status = "blocked";
      entry.lastDecisionReason = "trial source が3回連続 fail";
      return entry;
    }
    if (entry.status === "active" && Number(entry.consecutiveFailures ?? 0) >= ACTIVE_FAIL_LIMIT) {
      entry.status = "blocked";
      entry.lastDecisionReason = "active source が5回連続 fail";
      return entry;
    }
    if (candidateShouldPromoteToTrial(entry) && trialPromotions < TRIAL_PROMOTION_LIMIT) {
      entry.status = "trial";
      entry.lastDecisionReason = "candidate 条件を満たしたため trial に昇格";
      trialPromotions += 1;
      return entry;
    }
    if (trialShouldPromoteToActive(entry) && activePromotions < ACTIVE_PROMOTION_LIMIT) {
      entry.status = "active";
      entry.lastDecisionReason = "trial 条件を満たしたため active に昇格";
      activePromotions += 1;
      return entry;
    }
    return entry;
  });
}

function summarizeRegistry(entries) {
  const byStatus = {};
  const byLane = {};
  for (const entry of entries) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    byLane[entry.lane] = (byLane[entry.lane] ?? 0) + 1;
  }
  return {
    total: entries.length,
    byStatus,
    byLane,
    activeTrial: entries.filter((entry) => entry.status === "manual" || entry.status === "active" || entry.status === "trial").length,
  };
}

function runtimeSourcesFromRegistry(entries) {
  const active = entries
    .filter((entry) => entry.status === "active" && entry.lane !== "market")
    .sort((a, b) => (b.sourceQuality ?? 0) - (a.sourceQuality ?? 0));
  const trial = entries
    .filter((entry) => entry.status === "trial" && entry.lane !== "market")
    .sort((a, b) => (b.sourceQuality ?? 0) - (a.sourceQuality ?? 0))
    .slice(0, TRIAL_SOURCE_FETCH_LIMIT);
  return [...active, ...trial].map((entry) => ({
    id: `registry-${entry.sourceKey}`,
    sourceKey: entry.sourceKey,
    type: "discoveredSource",
    lane: entry.lane,
    registryStatus: entry.status,
    sourceQuality: entry.sourceQuality,
    url: entry.canonicalUrl,
    keyword: entry.keywordHint || entry.titleHint || entry.host,
    priority: entry.priority,
    seed: false,
    expansionPolicy: entry.expansionPolicy,
    crawlBudget: entry.crawlBudget,
    followDomains: entry.followDomains,
    trend: {
      keyword: entry.keywordHint || entry.titleHint || entry.host,
      type:
        entry.lane === "blog"
          ? "ブログ監視"
          : entry.lane === "sns"
            ? "SNS監視"
            : entry.lane === "news"
              ? "ニュース監視"
              : entry.lane === "lottery"
                ? "抽選監視"
                : "公式監視",
      context: `${entry.lane} / 自動発見ソース`,
      score: Math.max(55, Math.round(entry.sourceQuality || 55)),
      source: entry.keywordHint || entry.host,
    },
    candidate: {
      name: entry.keywordHint || entry.titleHint || entry.host,
      reason: `${entry.lane} の自動発見ソースを巡回`,
      stage: "追加候補",
      stageKind: "candidate",
    },
  }));
}

function buildDocumentRecord(source, result, extra = {}) {
  const docId = `doc:${normalizeSignalText(`${source.sourceKey ?? source.id}:${result.url ?? source.url}:${result.fetchedAt}`)}`;
  return {
    docId,
    sourceKey: source.sourceKey ?? source.id,
    lane: source.lane ?? detectSourceChannel(source, result.url),
    sourceType: source.type,
    seed: Boolean(source.seed),
    url: result.url ?? source.url,
    title: result.title ?? "",
    status: result.status,
    ok: Boolean(result.ok),
    fetchedAt: result.fetchedAt,
    keywordFound: Boolean(result.keywordFound),
    discoveredSourceCount: Number(extra.discoveredSourceCount ?? 0),
    extractedProductCount: Number(extra.extractedProductCount ?? 0),
    routeHitCount: Number(extra.routeHitCount ?? 0),
    useful: Boolean(extra.useful),
  };
}

function normalizeProductKey(name) {
  return normalizeSignalText(canonicalizeProductName(name));
}

function productMetaFromName(name, categoryHint = "", url = "") {
  const text = canonicalizeProductName(name);
  const lower = text.toLowerCase();
  let category = "generic_hobby";
  let productType = "generic";
  if (/一番くじ/.test(text)) {
    category = "kuji";
    productType = "kuji_lot";
  } else if (/入場者特典|来場者特典|前売券特典|ムビチケ特典|週替わり特典/.test(text)) {
    category = "movie_bonus";
    productType = "movie_bonus";
  } else if (/劇場限定|映画グッズ|上映記念グッズ|パンフレット|ムビチケ前売券|前売券|鑑賞券/.test(text)) {
    category = "movie_goods";
    productType = "movie_goods";
  } else if (/ポケモン|ポケカ|ポケモンカード/.test(text)) {
    category = "pokemon";
    productType = /プレイマット|デッキシールド|サプライ/.test(text) ? "pokemon_supply" : "pokemon_box";
  } else if (/g-shock|garrack|スマートウォッチ|腕時計|ga-\d|dw-\d|gw-\d/i.test(lower)) {
    category = "watch";
    productType = "watch";
  } else if (/s\.h\.figuarts|フィギュアーツ|metal build|robot魂|超合金|ねんどろいど|figma|portrait\.of\.pirates|p\.o\.p|masterlise|sofvics|bustisan|フィギュア/i.test(lower)) {
    category = "figure";
    productType = "figure";
  } else if (/ぬいぐるみ|マスコット|キーホルダー|メタリックモンスターズ|メタリックアイテムズ|グッズ/i.test(text)) {
    category = "goods";
    productType = "goods";
  } else if (categoryHint === "movie_bonus") {
    category = "movie_bonus";
    productType = "movie_bonus";
  } else if (categoryHint === "movie_goods") {
    category = "movie_goods";
    productType = "movie_goods";
  } else if (categoryHint === "pokemon_box") {
    category = "pokemon";
    productType = "pokemon_box";
  } else if (categoryHint === "watch") {
    category = "watch";
    productType = "watch";
  }

  let ip = "";
  if (/ポケモン|ポケカ|ポケモンカード/.test(text)) ip = "Pokemon";
  else if (/ワンピース|one piece/i.test(lower)) ip = "ONE PIECE";
  else if (/ドラゴンボール/.test(text)) ip = "Dragon Ball";
  else if (/ドラゴンクエスト|ドラクエ/.test(text)) ip = "Dragon Quest";
  else if (/ガンダム|gundam/i.test(lower)) ip = "Gundam";
  else if (/ハンター×ハンター|hunter×hunter|hunter x hunter/i.test(lower)) ip = "HUNTER×HUNTER";
  else if (/仮面ライダー/.test(text)) ip = "Kamen Rider";
  else if (/ちいかわ/.test(text)) ip = "Chiikawa";
  else if (/カービィ|星のカービィ/.test(text)) ip = "Kirby";
  else if (/映画|劇場版/.test(text)) ip = "Movie";

  let brand = "";
  const host = String(tryParseUrl(url)?.hostname ?? "").toLowerCase();
  if (/pokemon-card\.com|pokemoncenter-online\.com/.test(host) || ip === "Pokemon") brand = "Pokemon";
  else if (/1kuji\.com/.test(host) || category === "kuji") brand = "Ichiban Kuji";
  else if (/square-enix\.com/.test(host) || ip === "Dragon Quest") brand = "Square Enix";
  else if (/casio\.com/.test(host) || category === "watch") brand = "CASIO";
  else if (/one-piece\.com/.test(host) || ip === "ONE PIECE") brand = "ONE PIECE";
  else if (/p-bandai\.jp/.test(host)) brand = "Premium Bandai";
  else if (/dmm\.com/.test(host)) brand = "DMM";
  else if (category === "movie_bonus" || category === "movie_goods") brand = "Movie";

  let series = "";
  if (/一番くじ/.test(text)) {
    series = text.replace(/^一番くじ\s*/u, "").split(/[/-]/)[0]?.trim() ?? "";
  } else if (/ポケモンカードゲーム/.test(text)) {
    series = "Pokemon Card Game";
  } else if (/G-SHOCK/i.test(text)) {
    series = "G-SHOCK";
  } else if (/GARRACK/i.test(text)) {
    series = "GARRACK";
  } else if (/メタリックモンスターズ/.test(text)) {
    series = "メタリックモンスターズ";
  }

  return { category, series, ip, brand, productType };
}

function sourceConfidenceFromUrl(url, fallbackLane = "official") {
  const host = String(tryParseUrl(url)?.hostname ?? "").toLowerCase();
  if (/pokemon-card\.com|pokemoncenter-online\.com|p-bandai\.jp|bandai\.co\.jp|1kuji\.com|square-enix\.com|casio\.com|gshock\.casio\.com|one-piece\.com/.test(host)) {
    return "high";
  }
  if (fallbackLane === "blog" || fallbackLane === "sns") return "medium";
  if (fallbackLane === "news") return "medium";
  return "medium";
}

function sourceLabelFromAnyUrl(url) {
  const host = String(tryParseUrl(url)?.hostname ?? "").toLowerCase().replace(/^www\./, "");
  if (!host) return "";
  if (/pokemoncenter-online\.com/.test(host)) return "ポケモンセンター";
  if (/pokemon-card\.com/.test(host)) return "ポケモンカード公式";
  if (/membercard\.jp/.test(host)) return "membercard";
  if (/p-bandai\.jp/.test(host)) return "プレミアムバンダイ";
  if (/dmm\.com/.test(host)) return "DMM";
  if (/yellowsubmarine/.test(host)) return "イエローサブマリン";
  if (/nyuka-now/.test(host)) return "入荷Now";
  if (/square-enix\.com/.test(host)) return "スクエニ";
  if (/one-piece\.com/.test(host)) return "ONE PIECE.com";
  if (/gshock\.casio\.com|casio\.com/.test(host)) return "CASIO";
  if (/press\.moviewalker\.jp/.test(host)) return "MOVIE WALKER PRESS";
  if (/ticket\.moviewalker\.jp/.test(host)) return "MOVIE WALKER ムビチケ";
  if (/tohotheater\.jp/.test(host)) return "TOHOシネマズ";
  if (/109cinemas\.net/.test(host)) return "109シネマズ";
  if (/snkrdunk\.com/.test(host)) return "スニダン";
  if (/mercari/.test(host)) return "メルカリ";
  return host;
}

function inferDateConfidence({ lane = "official", sourceUrl = "", startDate = null, endDate = null, rolling = false }) {
  if (rolling) return "rolling";
  const host = String(tryParseUrl(sourceUrl)?.hostname ?? "").toLowerCase();
  const exact = Boolean(startDate || endDate);
  if (/pokemon-card\.com|pokemoncenter-online\.com|p-bandai\.jp|1kuji\.com|square-enix\.com|casio\.com|one-piece\.com/.test(host)) {
    return exact ? "official_exact" : "official_inferred";
  }
  if (lane === "blog" || lane === "sns" || lane === "news") {
    return exact ? "article_exact" : "article_inferred";
  }
  return exact ? "official_inferred" : "article_inferred";
}

function productNameFromCandidate(candidate) {
  return canonicalizeProductName(candidate?.name ?? "");
}

function isKujiLikeCandidate(candidate) {
  return /一番くじ/.test(String(candidate?.name ?? ""));
}

function routeShopName(route) {
  const name = String(route?.name ?? "");
  const bracket = name.match(/[（(]([^()（）]+)[)）]/u);
  if (bracket?.[1]) return bracket[1].trim();
  const source = String(route?.source ?? "");
  if (source && !["source", "blog", "sns", "market", "official", "lottery", "candidate", "news", "deal"].includes(source)) {
    return source;
  }
  const url = route?.applyUrl || route?.sourceUrl || route?.url || "";
  const host = String(tryParseUrl(url)?.hostname ?? "").replace(/^www\./, "");
  if (/emisresaleroom\.com/.test(host)) return "えみのせどり部屋";
  if (/tenbailabo\.com/.test(host)) return "転売LABO";
  if (/blog108\.fc2\.com/.test(host)) return "3度の飯よりプレミアム";
  if (/blog114\.fc2\.com/.test(host)) return "しなかん";
  if (/membercard\.jp/.test(host)) return "membercard";
  if (/pokemoncenter-online\.com/.test(host)) return "ポケモンセンター";
  if (/dmm\.com/.test(host)) return "DMM";
  if (/yellow|yellowsubmarine/.test(host)) return "イエローサブマリン";
  if (/nyuka-now/.test(host)) return "入荷Now";
  if (/press\.moviewalker\.jp/.test(host)) return "MOVIE WALKER PRESS";
  if (/tohotheater\.jp/.test(host)) return "TOHOシネマズ";
  if (/109cinemas\.net/.test(host)) return "109シネマズ";
  return host || "未設定";
}

function inferRouteType(route, fallback = "lottery") {
  const text = [route?.name, route?.note, route?.action, route?.condition, route?.applicationMethod, route?.round]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/再販|再入荷|入荷/.test(text)) return "resale";
  if (/招待/.test(text)) return "invite";
  if (/販売|sale/.test(text) && !/抽選|lottery|応募/.test(text)) return "sale";
  return fallback;
}

function inferRouteStatus(route) {
  if (route?.verification?.ended) return "ended";
  const start = String(route?.startDate ?? "").slice(0, 10);
  const end = String(route?.deadlineDate ?? "").slice(0, 10);
  const today = todayIsoDate();
  if (end && end < today) return "ended";
  if (start && start > today) return "scheduled";
  return "active";
}

function pushUniquePriceSnapshot(rows, row) {
  if (!Number.isFinite(row?.value)) return;
  if (!row?.productKey || !row?.productName) return;
  const key = `${row.productKey}|${row.priceType}|${row.condition ?? ""}|${row.source ?? ""}|${row.value}`;
  if (rows.some((item) => `${item.productKey}|${item.priceType}|${item.condition ?? ""}|${item.source ?? ""}|${item.value}` === key)) return;
  rows.push(row);
}

function priceSourceRankFromSource(source = "", priceType = "") {
  const text = String(source ?? "").toLowerCase();
  if (priceType === "predicted_market" || priceType === "predicted_profit") return "historical_prediction";
  if (/llm|heuristic|blog-sns-article/.test(text)) return "llm_mentioned_price";
  if (/history-median|comparables|learning/.test(text)) return "historical_prediction";
  if (/specialized-search/.test(text)) return "observed_market_price";
  if (/deal|pokemon-release|pokemon_release|kuji_special|manual/.test(text)) return "manual_price";
  if (/candidate|release|variant|article/.test(text)) return "specialized_estimate";
  return priceType === "retail" ? "manual_price" : "specialized_estimate";
}

function priceSourceUsageFromRank(rank = "") {
  if (rank === "manual_price" || rank === "observed_market_price") return "buyline";
  return "watch";
}

function priceFreshnessState(observedAt) {
  if (!observedAt) return "missing";
  const ts = Date.parse(observedAt);
  if (!Number.isFinite(ts)) return "missing";
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays <= 1) return "fresh";
  if (ageDays <= 7) return "normal";
  return "stale";
}

function buildNormalizedProducts(snapshot) {
  const products = new Map();
  const upsert = (name, extra = {}) => {
    const canonicalName = canonicalizeProductName(name);
    const productKey = normalizeProductKey(canonicalName);
    if (!canonicalName || !productKey || isMonitorOnlyName(canonicalName) || !productPhraseLooksSpecific(canonicalName)) return;
    const meta = productMetaFromName(canonicalName, extra.categoryHint, extra.url);
    const current = products.get(productKey) ?? {
      productKey,
      canonicalName,
      aliases: [],
      category: meta.category,
      series: meta.series,
      ip: meta.ip,
      brand: meta.brand,
      productType: meta.productType,
      sourceKinds: [],
    };
    current.aliases = [...new Set([...current.aliases, canonicalName, ...(extra.aliases ?? [])].filter(Boolean))].slice(0, 12);
    current.category = current.category || meta.category;
    current.series = current.series || meta.series;
    current.ip = current.ip || meta.ip;
    current.brand = current.brand || meta.brand;
    current.productType = current.productType || meta.productType;
    current.sourceKinds = [...new Set([...current.sourceKinds, ...(extra.sourceKinds ?? [])].filter(Boolean))].slice(0, 10);
    products.set(productKey, current);
  };

  for (const deal of snapshot.deals ?? []) {
    upsert(deal.name, { url: deal.sourceUrl || deal.releaseUrl, categoryHint: deal.category, sourceKinds: ["deal"] });
  }
  for (const release of snapshot.pokemonReleases ?? []) {
    upsert(release.name, { url: release.sourceUrl, categoryHint: "pokemon_box", sourceKinds: ["pokemon_release"] });
  }
  for (const candidate of snapshot.discoveryCandidates ?? []) {
    upsert(productNameFromCandidate(candidate), {
      url: candidate.sourceUrl,
      categoryHint: candidate.category,
      sourceKinds: [candidate.sourceChannel ?? "candidate"],
    });
  }
  for (const special of snapshot.kujiSpecials ?? []) {
    upsert(special.title, { url: special.sourceUrl, categoryHint: "kuji", sourceKinds: ["kuji_special"] });
  }
  for (const trend of snapshot.trends ?? []) {
    upsert(trend.keyword, { categoryHint: "", sourceKinds: ["trend"] });
  }
  for (const extraction of snapshot.llmExtractions ?? []) {
    for (const product of extraction.products ?? []) {
      upsert(product.name, {
        categoryHint: product.category,
        sourceKinds: [`llm:${extraction.provider ?? "heuristic"}`],
      });
    }
    for (const event of extraction.events ?? []) {
      upsert(event.productName, {
        categoryHint: "",
        url: event.applyUrl || event.sourceUrl || "",
        sourceKinds: [`llm-event:${event.eventType ?? "signal"}`],
      });
    }
    for (const price of extraction.prices ?? []) {
      upsert(price.productName, {
        categoryHint: "",
        sourceKinds: ["llm-price"],
      });
    }
  }

  return [...products.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, "ja"));
}

function buildRouteSnapshots(snapshot) {
  const rows = [];
  for (const release of snapshot.pokemonReleases ?? []) {
    if (!productPhraseLooksSpecific(release.name)) continue;
    const productKey = normalizeProductKey(release.name);
    for (const route of release.routes ?? []) {
      rows.push({
        id: `route:${normalizeSignalText(`${release.name}:${route.name}:${route.applyUrl || route.url || route.sourceUrl || ""}`)}`,
        productKey,
        productName: release.name,
        routeType: inferRouteType(route, "lottery"),
        shopName: routeShopName(route),
        routeUrl: route.url || route.sourceUrl || release.sourceUrl || "",
        applyUrl: route.applyUrl || route.url || route.sourceUrl || release.sourceUrl || "",
        startDate: String(route.startDate ?? "").slice(0, 10) || null,
        endDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
        status: inferRouteStatus(route),
        source: route.source ?? "pokemon_release",
        applicationMethod: route.applicationMethod ?? null,
        confidence: route?.verification?.kind === "verified" ? "high" : "medium",
      });
    }
  }
  for (const route of snapshot.lotteryRoutes ?? []) {
    if (!productPhraseLooksSpecific(route.name)) continue;
    const productKey = normalizeProductKey(route.name);
    rows.push({
      id: `route:${normalizeSignalText(`${route.name}:${route.applyUrl || route.sourceUrl || route.url || ""}`)}`,
      productKey,
      productName: canonicalizeProductName(route.name),
      routeType: inferRouteType(route, "lottery"),
      shopName: routeShopName(route),
      routeUrl: route.sourceUrl || route.url || "",
      applyUrl: route.applyUrl || route.sourceUrl || route.url || "",
      startDate: String(route.startDate ?? "").slice(0, 10) || null,
      endDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
      status: inferRouteStatus(route),
      source: route.source ?? "lottery",
      applicationMethod: route.condition ?? null,
      confidence: "medium",
    });
  }
  for (const deal of snapshot.deals ?? []) {
    if (!productPhraseLooksSpecific(deal.name)) continue;
    rows.push({
      id: `route:${normalizeSignalText(`${deal.name}:${deal.releaseUrl || deal.sourceUrl || ""}`)}`,
      productKey: normalizeProductKey(deal.name),
      productName: deal.name,
      routeType: "sale",
      shopName: deal.shop || routeShopName({ name: deal.shop, url: deal.releaseUrl || deal.sourceUrl }),
      routeUrl: deal.releaseUrl || deal.sourceUrl || "",
      applyUrl: deal.releaseUrl || deal.sourceUrl || "",
      startDate: String(deal.saleStartDate ?? "").slice(0, 10) || null,
      endDate: String(deal.saleEndDate ?? "").slice(0, 10) || null,
      status: !deal.saleEndDate || String(deal.saleEndDate).slice(0, 10) >= todayIsoDate() ? "active" : "ended",
      source: "deal",
      applicationMethod: "販売",
      confidence: deal.confidence === "高" ? "high" : "medium",
    });
  }
  for (const candidate of snapshot.discoveryCandidates ?? []) {
    if (!productPhraseLooksSpecific(candidate.name)) continue;
    if (!candidate.sourceUrl) continue;
    const routeUrl = candidate.routeFinalUrl || candidate.sourceUrl;
    if (!routeUrl || isAffiliateUrl(routeUrl) || isSearchLikeUrl(routeUrl) || routeTargetIsGeneric(routeUrl)) continue;
    rows.push({
      id: `route:${normalizeSignalText(`${candidate.name}:${routeUrl}`)}`,
      productKey: normalizeProductKey(candidate.name),
      productName: candidate.name,
      routeType: candidate.sourceChannel === "lottery" ? "lottery" : "signal",
      shopName: routeShopName({ name: candidate.name, url: routeUrl, source: candidate.sourceChannel }),
      routeUrl,
      applyUrl: routeUrl,
      startDate: String(candidate.startDate ?? "").slice(0, 10) || null,
      endDate: String(candidate.endDate ?? "").slice(0, 10) || null,
      status: candidate.routeAlive === false ? "review" : candidate.endDate && candidate.endDate < todayIsoDate() ? "ended" : "active",
      source: candidate.sourceChannel ?? "candidate",
      applicationMethod: candidate.sourceChannel === "lottery" ? "抽選/応募" : "確認",
      confidence: candidate.sourceReliability === "high" ? "high" : "medium",
    });
  }
  for (const extraction of snapshot.llmExtractions ?? []) {
    for (const event of extraction.events ?? []) {
      if (!productPhraseLooksSpecific(event.productName)) continue;
      const routeUrl = event.applyUrl || event.sourceUrl || "";
      if (!routeUrl || isAffiliateUrl(routeUrl) || isSearchLikeUrl(routeUrl) || routeTargetIsGeneric(routeUrl)) continue;
      rows.push({
        id: `route:llm:${normalizeSignalText(`${event.productName}:${event.eventType}:${routeUrl}`)}`,
        productKey: normalizeProductKey(event.productName),
        productName: canonicalizeProductName(event.productName),
        routeType: event.routeType || (event.eventType === "lottery_open" || event.eventType === "lottery_close" ? "lottery" : "signal"),
        shopName: event.shopName || routeShopName({ name: event.productName, url: routeUrl, source: extraction.sourceKey }),
        routeUrl: event.sourceUrl || routeUrl,
        applyUrl: routeUrl,
        startDate: safeIsoDate(event.startDate) || null,
        endDate: safeIsoDate(event.endDate) || null,
        status:
          safeIsoDate(event.endDate) && safeIsoDate(event.endDate) < todayIsoDate()
            ? "ended"
            : safeIsoDate(event.startDate) && safeIsoDate(event.startDate) > todayIsoDate()
              ? "scheduled"
              : "active",
        source: extraction.mode === "heuristic" ? "heuristic" : "llm",
        applicationMethod: routeTypeLabelJa(event.routeType || "signal"),
        confidence: confidenceToLabel(Number(extraction.confidence ?? 0.6)) === "高" ? "high" : "medium",
      });
    }
  }
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

function buildPriceSnapshots(snapshot) {
  const rows = [];
  const push = (input) => {
    const productName = canonicalizeProductName(input.productName);
    if (!productPhraseLooksSpecific(productName)) return;
    const priceSourceRank = priceSourceRankFromSource(input.source, input.priceType);
    pushUniquePriceSnapshot(rows, {
      productKey: normalizeProductKey(productName),
      productName,
      priceType: input.priceType,
      value: input.value,
      condition: input.condition ?? "",
      source: input.source ?? "",
      priceSourceRank,
      priceUsage: priceSourceUsageFromRank(priceSourceRank),
      buyLineEligible: priceSourceUsageFromRank(priceSourceRank) === "buyline",
      observedAt: input.observedAt ?? snapshot.metadata?.updatedAt ?? null,
      confidence: input.confidence ?? "medium",
      freshness: input.freshness ?? priceFreshnessState(input.observedAt ?? snapshot.metadata?.updatedAt ?? null),
    });
  };

  for (const deal of snapshot.deals ?? []) {
    push({ productName: deal.name, priceType: "retail", value: deal.buyPrice, condition: "定価/仕入基準", source: "deal", confidence: deal.confidence === "高" ? "high" : "medium" });
    push({ productName: deal.name, priceType: "market", value: deal.sellPrice, condition: "想定売価", source: "deal", confidence: deal.confidence === "高" ? "high" : "medium" });
  }

  for (const release of snapshot.pokemonReleases ?? []) {
    push({
      productName: release.name,
      priceType: "retail",
      value: release.retailPrice,
      condition: "定価",
      source: "pokemon_release",
      observedAt: release.marketUpdated ?? snapshot.metadata?.updatedAt ?? null,
      confidence: "high",
    });
    if (Number.isFinite(release.marketPrice)) {
      push({
        productName: release.name,
        priceType: "market",
        value: release.marketPrice,
        condition: "BOX参考相場",
        source: release.marketPriceSource ?? "pokemon_release",
        observedAt: release.marketUpdated ?? snapshot.metadata?.updatedAt ?? null,
        confidence: "medium",
      });
    }
    for (const variant of release.marketVariants ?? []) {
      push({
        productName: release.name,
        priceType: "market",
        value: variant.marketPrice,
        condition: variant.condition ?? "条件別",
        source: variant.source ?? "pokemon_variant",
        observedAt: release.marketUpdated ?? snapshot.metadata?.updatedAt ?? null,
        confidence: variant.priority === "primary" ? "high" : "medium",
      });
    }
  }

  for (const candidate of snapshot.discoveryCandidates ?? []) {
    push({
      productName: candidate.name,
      priceType: "retail",
      value: candidate.retailPrice,
      condition:
        candidate.category === "pokemon_box"
          ? "BOX定価"
          : candidate.category === "watch"
            ? "型番定価"
            : isKujiLikeCandidate(candidate)
              ? "1回価格/定価"
              : "定価",
      source: candidate.retailPriceSource ?? "candidate",
      confidence: candidate.confidence === "高" ? "high" : "medium",
    });
    push({
      productName: candidate.name,
      priceType: isKujiLikeCandidate(candidate) ? "predicted_market" : "market",
      value: candidate.marketPrice,
      condition:
        candidate.category === "pokemon_box"
          ? "BOX相場"
          : candidate.category === "watch"
            ? "型番相場"
            : isKujiLikeCandidate(candidate)
              ? "予測レンジ中央値"
              : "相場",
      source: candidate.marketPriceSource ?? "candidate",
      observedAt: candidate.marketObservedAt ?? snapshot.metadata?.updatedAt ?? null,
      confidence: candidate.confidence === "高" ? "high" : "medium",
    });
  }

  for (const extraction of snapshot.llmExtractions ?? []) {
    for (const price of extraction.prices ?? []) {
      const normalizedType =
        price.priceType === "market" || price.priceType === "predicted_market" || price.priceType === "mentioned_price"
          ? price.priceType
          : price.priceType === "retail"
            ? "retail"
            : null;
      if (!normalizedType) continue;
      push({
        productName: price.productName,
        priceType: normalizedType,
        value: price.value,
        condition: price.condition ?? "LLM抽出",
        source: extraction.mode === "heuristic" ? "heuristic-article" : "llm-article",
        observedAt: extraction.extractedAt ?? snapshot.metadata?.updatedAt ?? null,
        confidence: confidenceToLabel(Number(price.confidence ?? extraction.confidence ?? 0.6)) === "高" ? "high" : "medium",
      });
    }
  }

  for (const special of snapshot.kujiSpecials ?? []) {
    push({
      productName: special.title,
      priceType: "retail",
      value: special.retailPrice,
      condition: "1回価格",
      source: "kuji_special",
      confidence: "medium",
    });
    push({
      productName: special.title,
      priceType: "predicted_market",
      value: special.marketPrice,
      condition: "弾予測レンジ",
      source: "kuji_special",
      confidence: "medium",
    });
  }

  return rows;
}

function composeSelectionReasonText(parts) {
  return parts.filter(Boolean).join(" ");
}

function compactReasonText(value, fallback = "更新情報を確認") {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[。]+/g, "。")
    .trim();
  if (!text) return fallback;
  return text;
}

function eventTypeLabelJa(eventType) {
  if (eventType === "release") return "発売";
  if (eventType === "sale_open") return "販売開始";
  if (eventType === "sale_close") return "販売終了";
  if (eventType === "lottery_open") return "抽選開始";
  if (eventType === "lottery_close") return "抽選終了";
  if (eventType === "resale_open") return "再販開始";
  if (eventType === "invite_open") return "招待開始";
  if (eventType === "restock_signal") return "再販告知";
  if (eventType === "signal") return "更新";
  if (eventType === "trend_signal") return "具体反応";
  return "更新";
}

function sourceLaneLabelJa(value) {
  if (value === "official") return "公式";
  if (value === "lottery") return "抽選";
  if (value === "blog") return "ブログ";
  if (value === "sns") return "SNS";
  if (value === "news") return "ニュース";
  if (value === "market") return "相場";
  return "監視";
}

function routeTypeLabelJa(value) {
  if (value === "lottery") return "抽選";
  if (value === "resale") return "再販";
  if (value === "invite") return "招待";
  if (value === "sale") return "販売";
  return "確認";
}

function timingReasonText({ product, soonEvent, trend, candidate, activeRoutes }) {
  if (!soonEvent?.startDate) return "日付はまだ固まっていません。";
  const date = soonEvent.startDate;
  const routeNames = (activeRoutes ?? []).map((route) => route.shopName).filter(Boolean);
  if (soonEvent.eventType === "lottery_open") {
    return routeNames.length > 0
      ? `${date} までに ${routeNames.slice(0, 2).join(" / ")} の抽選を見ればよい状態です。`
      : `${date} に抽選開始の動きがあります。`;
  }
  if (soonEvent.eventType === "lottery_close") {
    return routeNames.length > 0
      ? `${date} までに ${routeNames.slice(0, 2).join(" / ")} の締切確認が必要です。`
      : `${date} に抽選締切が近づいています。`;
  }
  if (soonEvent.eventType === "sale_open") {
    return `${date} に販売開始予定です。開始前に価格と導線を固めます。`;
  }
  if (soonEvent.eventType === "sale_close") {
    return `${date} で販売終了予定です。販売期間内に判断したい対象です。`;
  }
  if (soonEvent.eventType === "release") {
    if (product?.category === "movie_bonus") return `${date} に特典配布の切り替わりがありそうです。劇場条件を先に見ます。`;
    if (product?.category === "movie_goods") return `${date} に劇場グッズの販売時期が近づいています。`;
    return `${date} に発売・配布の時期が近づいています。`;
  }
  if (soonEvent.eventType === "resale_open" || soonEvent.eventType === "restock_signal") {
    return routeNames.length > 0
      ? `${date} 前後に ${routeNames.slice(0, 2).join(" / ")} の再販・再入荷を確認したい状態です。`
      : `${date} 前後に再販・再入荷の動きがあります。`;
  }
  if (soonEvent.eventType === "invite_open") {
    return `${date} 前後に招待受付の動きがあります。`;
  }
  if (soonEvent.eventType === "trend_signal") {
    if (routeNames.length > 0) {
      return `${date} 時点で ${routeNames.slice(0, 2).join(" / ")} の具体ルートが見えています。`;
    }
    if (trend?.type === "具体反応") {
      return `${date} 時点で具体商品の反応が見えています。`;
    }
    if (trend?.type && !/検証|候補/.test(trend.type)) {
      return `${date} 時点で ${trend.type} の具体的な動きがあります。`;
    }
    if (candidate?.sourceChannel) {
      return `${date} 時点で ${sourceLaneLabelJa(candidate.sourceChannel)} 由来の具体商品の動きがあります。`;
    }
    return `${date} 時点で具体商品の反応が出ています。`;
  }
  return `${date} に更新予定があります。`;
}

function formatPriceReasonLabel(price) {
  if (!price || !Number.isFinite(price.value)) return null;
  const value = formatYen(price.value);
  switch (price.priceSourceRank) {
    case "observed_market_price":
      return `安全価格 ${value}`;
    case "manual_price":
      return `手動価格 ${value}`;
    case "historical_prediction":
      return `履歴推定 ${value}`;
    case "llm_mentioned_price":
      return `記事中価格 ${value}`;
    case "specialized_estimate":
      return `専門推定 ${value}`;
    default:
      return `参考価格 ${value}`;
  }
}

function marketCountsAsActionablePrice(price) {
  if (!price || !Number.isFinite(price.value)) return false;
  if (price.buyLineEligible === false) return false;
  return price.priceSourceRank === "observed_market_price" || price.priceSourceRank === "manual_price";
}

function normalizeReasonTopicText(value, product) {
  const text = sanitizeClaimText(String(value ?? "").replace(/\s+/g, " ").trim());
  if (!text || looksLikeSiteChromeProductName(text)) return `${product.canonicalName} を継続監視中。`;
  if (/LLM抽出|記事抽出|自動発見ソース|由来/.test(text)) {
    if (product.category === "kuji") return `${product.canonicalName} は一番くじの具体商品として拾えており、動きが出るか継続監視しています。`;
    if (product.category === "pokemon") return `${product.canonicalName} は抽選や再販が動きやすい対象として継続監視しています。`;
    if (product.category === "movie_bonus" || product.category === "movie_goods") {
      return `${product.canonicalName} は映画系の限定導線が付きやすい対象として追っています。`;
    }
    return `${product.canonicalName} は具体商品として拾えており、継続監視中です。`;
  }
  if (/由来\s*\/\s*記事抽出/.test(text)) {
    return `${product.canonicalName} は記事抽出で具体商品として拾えています。`;
  }
  if (/由来/.test(text) && !/。/.test(text)) {
    return `${text.replace(/\s*\/\s*/g, "・")} を起点に監視しています。`;
  }
  const cleaned = text.replace(/\s*\/\s*/g, "・");
  return /。$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function buildSelectionReasons(snapshot, learningMap = new Map()) {
  const routesByProduct = new Map();
  for (const route of snapshot.routeSnapshots ?? []) {
    const rows = routesByProduct.get(route.productKey) ?? [];
    rows.push(route);
    routesByProduct.set(route.productKey, rows);
  }
  const pricesByProduct = new Map();
  for (const price of snapshot.priceSnapshots ?? []) {
    const rows = pricesByProduct.get(price.productKey) ?? [];
    rows.push(price);
    pricesByProduct.set(price.productKey, rows);
  }
  const predictedByProduct = new Map();
  for (const price of snapshot.predictedPriceSnapshots ?? []) {
    const rows = predictedByProduct.get(price.productKey) ?? [];
    rows.push(price);
    predictedByProduct.set(price.productKey, rows);
  }
  const candidatesByProduct = new Map();
  for (const candidate of snapshot.discoveryCandidates ?? []) {
    const key = normalizeProductKey(candidate.name);
    const current = candidatesByProduct.get(key);
    if (!current || (candidate.genreScore ?? 0) > (current.genreScore ?? 0)) {
      candidatesByProduct.set(key, candidate);
    }
  }
  const trendsByProduct = new Map();
  for (const trend of snapshot.trends ?? []) {
    const key = normalizeProductKey(trend.keyword);
    if (!trendsByProduct.has(key)) trendsByProduct.set(key, trend);
  }
  const llmReasonsByProduct = new Map();
  for (const extraction of snapshot.llmExtractions ?? []) {
    for (const product of extraction.products ?? []) {
      const key = normalizeProductKey(product.name);
      if (!key) continue;
      const current = llmReasonsByProduct.get(key);
      if (!current || Number(extraction.confidence ?? 0) > Number(current.confidence ?? 0)) {
        llmReasonsByProduct.set(key, {
          confidence: Number(extraction.confidence ?? 0),
          reasons: extraction.reasons ?? {},
        });
      }
    }
  }

  return (snapshot.normalizedProducts ?? []).map((product) => {
    const routes = routesByProduct.get(product.productKey) ?? [];
    const prices = pricesByProduct.get(product.productKey) ?? [];
    const candidate = candidatesByProduct.get(product.productKey) ?? null;
    const trend = trendsByProduct.get(product.productKey) ?? null;
    const llmReason = llmReasonsByProduct.get(product.productKey)?.reasons ?? null;
    const learning = learningMap.get(product.productKey) ?? null;
    const retail = prices.find((price) => price.priceType === "retail" && Number.isFinite(price.value)) ?? null;
    const market =
      prices.find((price) => (price.priceType === "market" || price.priceType === "predicted_market") && Number.isFinite(price.value)) ??
      null;
    const predictedMarket = (predictedByProduct.get(product.productKey) ?? []).find((price) => price.priceType === "predicted_market") ?? null;
    const activeRoutes = routes.filter((route) => route.status === "active");
    const visibleEvents = (snapshot.productEvents ?? [])
      .filter((event) => event.productKey === product.productKey)
      .filter((event) => !event.endDate || event.endDate >= todayIsoDate())
      .sort((a, b) => String(a.startDate ?? "").localeCompare(String(b.startDate ?? "")));
    const soonEvent = visibleEvents[0] ?? null;

    const topicSeed =
      activeRoutes.length > 0
        ? `${product.canonicalName} は具体ルートが見えており、実行候補として監視しています。`
        : retail && market
          ? `${product.canonicalName} は定価と相場が揃い、価格差を判断しやすい状態です。`
          : candidate?.reason || trend?.context || llmReason?.whyTopic || candidate?.adoptionReason || `${product.ip || product.category} を継続監視中`;
    const whyTopic = normalizeReasonTopicText(topicSeed, product);
    const whyTiming = compactReasonText(
      timingReasonText({ product, soonEvent, trend, candidate, activeRoutes }) || llmReason?.whyTiming,
      "日付はまだ固まっていません。",
    );
    const deterministicRouteReason =
      activeRoutes.length > 0
        ? `${activeRoutes.slice(0, 2).map((route) => route.shopName).join(" / ")} の ${routeTypeLabelJa(activeRoutes[0].routeType)} ページへ直接飛べます。`
        : routes.length > 0
          ? "導線候補は見つかっていますが、直リンクの再確認が必要です。"
          : "応募先や販売先の直リンクがまだ取れていません。";
    const whyRoute = compactReasonText(
      deterministicRouteReason,
      compactReasonText(llmReason?.whyRoute, "応募先や販売先の直リンクがまだ取れていません。"),
    );
    const marketLabel = formatPriceReasonLabel(market);
    const deterministicPriceReason =
      retail && marketLabel
        ? `定価 ${formatYen(retail.value)} と${marketLabel}が揃っています。`
        : retail && predictedMarket
          ? `定価 ${formatYen(retail.value)} はあり、過去類似から履歴推定 ${formatYen(predictedMarket.base)} を置いています。`
          : retail
            ? `定価 ${formatYen(retail.value)} は取れていますが、参考価格が不足しています。`
            : marketLabel
              ? `${marketLabel}は取れていますが、定価が不足しています。`
              : "定価と参考価格の両方がまだ不足しています。";
    const whyPrice = compactReasonText(
      deterministicPriceReason,
      compactReasonText(llmReason?.whyPrice, "定価と相場の両方がまだ不足しています。"),
    );
    const whyHistory = llmReason?.whyHistory
      ? compactReasonText(llmReason.whyHistory, "履歴は蓄積中。")
      : learning
      ? `過去1年で ${learning.mentions} 回検知。`
      : candidate?.historyHits
        ? `履歴で ${candidate.historyHits} 回検知。`
        : "履歴は蓄積中。";

    const shortNow = composeSelectionReasonText([
      whyTopic,
      activeRoutes.length > 0 ? `${activeRoutes.slice(0, 2).map((route) => route.shopName).join(" / ")} ですぐ動けます。` : "",
      soonEvent?.startDate ? whyTiming : "",
      retail && marketCountsAsActionablePrice(market)
        ? `定価 ${formatYen(retail.value)} と${formatPriceReasonLabel(market)}が揃っているため、その場で判断できます。`
        : "価格がまだ揃い切っていないため、補完を優先します。",
    ]);
    const shortSoon = composeSelectionReasonText([
      whyTopic,
      soonEvent?.startDate ? whyTiming : "開始前の準備段階です。",
      activeRoutes.length > 0 ? "先に見るページは押さえています。" : "先に直リンクを固める段階です。",
      retail && predictedMarket && !marketCountsAsActionablePrice(market)
        ? `定価は取れており、履歴推定 ${formatYen(predictedMarket.base)} を置いています。参考価格を補完できれば上段へ上げられます。`
        : retail && !marketCountsAsActionablePrice(market)
          ? "定価は取れているので、参考価格を補完できれば上段へ上げられます。"
          : "",
    ]);
    const shortMemo = composeSelectionReasonText([
      whyTopic,
      trend?.context ? `${sourceLaneLabelJa(soonEvent?.lane ?? candidate?.sourceChannel ?? "")}起点で早めに拾っています。` : "早期監視の段階です。",
      predictedMarket && !marketCountsAsActionablePrice(market)
        ? `過去類似から履歴推定 ${formatYen(predictedMarket.base)} を置いています。観測価格と直リンクが埋まり次第、上段へ移します。`
        : !retail || !marketCountsAsActionablePrice(market)
          ? "価格や直リンクが埋まり次第、上段へ移します。"
          : "日付が近づいたら上段へ移します。",
    ]);

    let holdReason = "まだ上段に上げる決め手が足りないため、保留で追っています。";
    if (!routes.length) holdReason = "直リンクがまだ取れていないため、保留で追っています。";
    else if (!soonEvent?.startDate) holdReason = "開始日や終了日が固まっていないため、保留で追っています。";
    else if (!retail || !marketCountsAsActionablePrice(market)) holdReason = "定価か参考価格が不足しているため、価格補完待ちです。";

    return {
      productKey: product.productKey,
      productName: product.canonicalName,
      whyTopic,
      whyTiming,
      whyRoute,
      whyPrice,
      whyHistory,
      shortNow,
      shortSoon,
      shortMemo,
      holdReason,
    };
  });
}

function structuredLinkKind(url, anchorText = "") {
  const joined = `${anchorText} ${url}`;
  if (routeTargetIsGeneric(url) || isSearchLikeUrl(url)) return "generic";
  if (/応募|抽選|entry|lottery|membercard|招待/i.test(joined)) return "apply_page";
  if (/ムビチケ|前売券|鑑賞券|ticket\.moviewalker/i.test(joined)) return "product_page";
  if (/mercari|snkrdunk|相場/i.test(joined)) return "market_page";
  if (/商品|detail|product|発売|販売|購入/i.test(joined)) return "product_page";
  if (/x\.com\/[^/]+$|twitter\.com\/[^/]+$/i.test(url)) return "profile";
  if (/article|news|archives|status/i.test(url)) return "article";
  return "page";
}

function inferStructuredEventType(text = "", category = "") {
  const joined = `${text} ${category}`.toLowerCase();
  if (
    [
      "release",
      "sale_open",
      "sale_close",
      "lottery_open",
      "lottery_close",
      "resale_open",
      "invite_open",
      "restock_signal",
      "trend_signal",
    ].includes(joined.trim())
  ) {
    return joined.trim();
  }
  if (/抽選.*終了|応募締切|受付終了/.test(joined)) return "lottery_close";
  if (/招待|invite|リクエスト/.test(joined)) return "invite_open";
  if (/前売券|ムビチケ/.test(joined)) return "sale_open";
  if (/抽選|応募|エントリー|membercard/.test(joined)) return "lottery_open";
  if (/再販|再入荷|再販売|restock/.test(joined)) return "resale_open";
  if (/発売|公開|配布開始|販売開始|発売日/.test(joined)) return "release";
  return "trend_signal";
}

function llmReasonPhrases(text = "", directLinks = 0, prices = [], products = []) {
  const productCategories = new Set(products.map((product) => productMetaFromName(product, "", "").category).filter(Boolean));
  const whyTopic = productCategories.has("movie_bonus") || productCategories.has("movie_goods")
    ? "映画系の限定導線候補を検知"
    : productCategories.has("kuji")
      ? "一番くじの具体商品候補を検知"
      : productCategories.has("pokemon")
        ? "ポケカの具体商品候補を検知"
        : /一番くじ/.test(text)
          ? "一番くじ文脈を検知"
          : /ポケモン|ポケカ/.test(text)
            ? "ポケカ関連文脈を検知"
            : "具体商品らしい文脈を検知";
  const whyRoute = directLinks > 0 ? "直リンク候補あり" : "直リンク候補なし";
  const whyPrice = prices.length > 0 ? "価格語あり" : "価格語なし";
  return { whyTopic, whyRoute, whyPrice };
}

function countActiveRoutesForSnapshot(snapshot) {
  return (snapshot?.routeSnapshots ?? []).filter((route) => route.status === "active").length;
}

function buildHeuristicOverviewNarrative(snapshot, previousSnapshot = null) {
  const activeRoutes = (snapshot.routeSnapshots ?? [])
    .filter((route) => route.status === "active")
    .filter((route) => summaryNameLooksUseful(route.productName))
    .filter((route) => !looksLikeSiteChromeProductName(route.productName))
    .sort((a, b) => String(a.endDate ?? "9999-12-31").localeCompare(String(b.endDate ?? "9999-12-31")));
  const routeProducts = [];
  for (const route of activeRoutes) {
    if (!routeProducts.some((item) => item.name === route.productName)) {
      routeProducts.push({ name: route.productName, key: route.productKey });
    }
    if (routeProducts.length >= 3) break;
  }
  const activeDeals = (snapshot.deals ?? [])
    .filter((deal) => !deal.saleEndDate || String(deal.saleEndDate).slice(0, 10) >= todayIsoDate())
    .slice(0, 2);
  const soonCandidates = (snapshot.discoveryCandidates ?? [])
    .filter((candidate) => summaryNameLooksUseful(candidate.name))
    .filter((candidate) => !looksLikeSiteChromeProductName(candidate.name))
    .filter((candidate) => {
      const start = safeIsoDate(candidate.startDate);
      if (!start) return false;
      const deltaDays = Math.floor((Date.parse(`${start}T00:00:00+09:00`) - Date.now()) / 86_400_000);
      return deltaDays >= 0 && deltaDays <= 14;
    })
    .sort((a, b) => String(a.startDate ?? "").localeCompare(String(b.startDate ?? "")))
    .slice(0, 3);
  const strongKuji = (snapshot.kujiSpecials ?? [])
    .filter((special) => summaryNameLooksUseful(special.title))
    .map((special) => special.title)
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .slice(0, 2);
  const backlogTargets = (snapshot.discoveryCandidates ?? [])
    .filter((candidate) => summaryNameLooksUseful(candidate.name))
    .filter((candidate) => !looksLikeSiteChromeProductName(candidate.name))
    .filter((candidate) => /価格|相場|導線|期間/.test(String(candidate.missingData ?? "")))
    .slice(0, 2)
    .map((candidate) => candidate.name);
  const routeNames = routeProducts.map((item) => item.name);
  const focusNames = [...routeNames, ...activeDeals.map((deal) => deal.name)]
    .filter(Boolean)
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .slice(0, 4);
  const previousRouteCount = countActiveRoutesForSnapshot(previousSnapshot);
  const previousDealCount = Array.isArray(previousSnapshot?.deals) ? previousSnapshot.deals.length : 0;
  const routeDiff = activeRoutes.length - previousRouteCount;
  const dealDiff = activeDeals.length - previousDealCount;
  const basedOn = [
    ...routeProducts.map((item) => item.key),
    ...activeDeals.map((deal) => normalizeProductKey(deal.name)),
    ...soonCandidates.map((candidate) => normalizeProductKey(candidate.name)),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);
  const sentences = [];
  if (focusNames.length > 0) {
    sentences.push(`いま主に見たいのは ${focusNames.join("、")} です。`);
  } else {
    sentences.push("今日は大きな更新が少なく、次の開始枠を先回りで押さえる流れです。");
  }
  if (routeNames.length > 0) {
    sentences.push(`抽選や応募では ${routeNames.join("、")} の具体ルートが動いていて、先にリンクと締切を確認したい状態です。`);
  }
  if (soonCandidates.length > 0) {
    sentences.push(`このあと動きそうなのは ${soonCandidates.map((candidate) => candidate.name).join("、")} で、開始前のうちに日付と価格を固めたいです。`);
  }
  if (strongKuji.length > 0) {
    sentences.push(`一番くじでは ${strongKuji.join("、")} のような強い弾を先読みで追っています。`);
  }
  if (backlogTargets.length > 0) {
    sentences.push(`まだ詰め切れていないのは ${backlogTargets.join("、")} あたりで、価格や直リンクが埋まれば上段へ上げられます。`);
  }
  if (previousSnapshot) {
    const changes = [];
    if (routeDiff !== 0) changes.push(`抽選ルート ${routeDiff > 0 ? "+" : ""}${routeDiff}`);
    if (dealDiff !== 0) changes.push(`利益候補 ${dealDiff > 0 ? "+" : ""}${dealDiff}`);
    if (changes.length > 0) sentences.push(`前回からは ${changes.join("、")} の変化がありました。`);
  }
  return {
    text: sentences.slice(0, 5).join(" "),
    sourceMode: "heuristic",
    generatedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
    basedOn,
  };
}

function summarizeLlmExecution(snapshot) {
  const extractions = snapshot.llmExtractions ?? [];
  const modeCounts = {};
  const fallbackReasons = Object.fromEntries(llmExecutionStats.extractionFallbackReasons.entries());
  const eligibilityReasonCounts = {};
  for (const extraction of extractions) {
    const mode = extraction.mode || "heuristic";
    modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
    const eligibilityReason = String(extraction.geminiEligibilityReason ?? "").trim();
    if (eligibilityReason) eligibilityReasonCounts[eligibilityReason] = (eligibilityReasonCounts[eligibilityReason] ?? 0) + 1;
    const reason = String(extraction.fallbackReason ?? "").trim();
    if (reason) fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
  }
  const overviewNarrative = snapshot.overviewNarrative ?? {};
  const snapshotUpdatedAt = snapshot.metadata?.updatedAt ?? null;
  const overviewGeneratedAt = overviewNarrative.generatedAt ?? snapshotUpdatedAt ?? null;
  const overviewIsCurrentRun = Boolean(overviewGeneratedAt && snapshotUpdatedAt && overviewGeneratedAt === snapshotUpdatedAt);
  const extraction = {
    requested: llmExecutionStats.requested,
    succeeded: llmExecutionStats.succeeded,
    failed: llmExecutionStats.failed,
    skipped: llmExecutionStats.skipped,
    eligible: llmExecutionStats.eligible,
    modeCounts,
    geminiRequestedCount: configuredLlmProvider === "gemini" ? llmExecutionStats.requested : 0,
    geminiSucceededCount: configuredLlmProvider === "gemini" ? llmExecutionStats.succeeded : 0,
    geminiFailedCount: configuredLlmProvider === "gemini" ? llmExecutionStats.failed : 0,
    geminiSkippedCount: configuredLlmProvider === "gemini" ? llmExecutionStats.skipped : 0,
  };
  const overview = {
    sourceMode: overviewNarrative.sourceMode ?? "heuristic",
    generatedAt: overviewGeneratedAt,
    model: overviewNarrative.model ?? null,
    requested: llmExecutionStats.overviewRequested,
    succeeded: llmExecutionStats.overviewSucceeded,
    failed: llmExecutionStats.overviewFailed,
    fallbackReason: llmExecutionStats.overviewFallbackReason || overviewNarrative.fallbackReason || "",
    error: overviewNarrative.error ?? null,
    isCurrentRun: overviewIsCurrentRun,
  };
  return {
    configured: llmProviderConfigured(),
    provider: configuredLlmProvider,
    model: configuredLlmProvider === "gemini" ? geminiBaseModel : openAiBaseModel,
    fallbackModel: configuredLlmProvider === "gemini" ? geminiFallbackModel : "",
    actualModelUsed: [...llmExecutionStats.actualModelsUsed],
    extraction,
    overview,
    openAiCount: modeCounts.openai ?? 0,
    geminiCount: modeCounts.gemini ?? 0,
    heuristicCount: modeCounts.heuristic ?? 0,
    modeCounts,
    fallbackReasons,
    eligibilityReasonCounts,
    eligible: llmExecutionStats.eligible,
    skipped: llmExecutionStats.skipped,
    requested: llmExecutionStats.requested,
    succeeded: llmExecutionStats.succeeded,
    failed: llmExecutionStats.failed,
    extractionDocLimit: effectiveLlmExtractionDocLimit(),
    genericExtractionDocLimit: llmExtractionDocLimit,
    geminiExtractionDocLimit,
    geminiDailyCallLimit,
    geminiMonthlyCallLimit,
    aiBudgetJpy,
    geminiRequestedCount: extraction.geminiRequestedCount,
    geminiSucceededCount: extraction.geminiSucceededCount,
    geminiFailedCount: extraction.geminiFailedCount,
    geminiSkippedCount: extraction.geminiSkippedCount,
    geminiQuotaStopped,
    geminiQuotaStopReason,
    estimatedCost: 0,
    overviewFallbackReason: overview.fallbackReason,
  };
}

function snapshotCount(snapshot, field, metadataField) {
  if (!snapshot || typeof snapshot !== "object") return 0;
  if (Number.isInteger(snapshot?.metadata?.[metadataField])) return snapshot.metadata[metadataField];
  return Array.isArray(snapshot?.[field]) ? snapshot[field].length : 0;
}

function evaluateSnapshotWriteProtection(currentSnapshot, previousSnapshot, { reachableSources = 0 } = {}) {
  const currentDocuments = snapshotCount(currentSnapshot, "documents", "documentCount");
  const currentProducts = snapshotCount(currentSnapshot, "normalizedProducts", "normalizedProductCount");
  const previousDocuments = snapshotCount(previousSnapshot, "documents", "documentCount");
  const previousProducts = snapshotCount(previousSnapshot, "normalizedProducts", "normalizedProductCount");
  const reasons = [];

  if (reachableSources < minSnapshotReachableSources) reasons.push(`reachable_sources_below_min:${reachableSources}<${minSnapshotReachableSources}`);
  if (currentDocuments < minSnapshotDocumentCount) reasons.push(`documents_below_min:${currentDocuments}<${minSnapshotDocumentCount}`);
  if (currentProducts < minSnapshotProductCount) reasons.push(`products_below_min:${currentProducts}<${minSnapshotProductCount}`);

  if (previousSnapshot) {
    if (previousDocuments >= minSnapshotDocumentCount) {
      const floor = Math.max(1, Math.floor(previousDocuments * minSnapshotDocumentRetentionRatio));
      if (currentDocuments < floor) reasons.push(`documents_dropped:${currentDocuments}/${previousDocuments}`);
    }
    if (previousProducts >= minSnapshotProductCount) {
      const floor = Math.max(1, Math.floor(previousProducts * minSnapshotProductRetentionRatio));
      if (currentProducts < floor) reasons.push(`products_dropped:${currentProducts}/${previousProducts}`);
    }
  }

  return {
    allowWrite: reasons.length === 0 || !previousSnapshot,
    degraded: reasons.length > 0,
    reasons,
    current: {
      reachableSources,
      documents: currentDocuments,
      normalizedProducts: currentProducts,
    },
    previous: previousSnapshot
      ? {
          documents: previousDocuments,
          normalizedProducts: previousProducts,
        }
      : null,
    thresholds: {
      minReachableSources: minSnapshotReachableSources,
      minDocuments: minSnapshotDocumentCount,
      minProducts: minSnapshotProductCount,
      minPreviousRatio: minSnapshotPreviousRatio,
      minDocumentRetentionRatio: minSnapshotDocumentRetentionRatio,
      minProductRetentionRatio: minSnapshotProductRetentionRatio,
    },
  };
}

function marketLensOverviewSystemPrompt() {
  return [
    "あなたはホビー商材の要約編集者です。",
    "与えられた JSON だけを使って、日本語で 3〜6 文の自然な全体まとめを書いてください。",
    "箇条書き、見出し、番号、セクション分割は禁止です。",
    "signal, trend_signal, 話題化, heuristic などの内部語は使わず、抽選開始、締切接近、再販気配、具体反応など人が分かる言葉に翻訳してください。",
    "商品名は具体的に入れてください。抽象語だけで終わらせないでください。",
    "出力は JSON オブジェクトのみで、余計な説明文は書かないでください。",
  ].join("\n");
}

function marketLensOverviewPlainSystemPrompt() {
  return [
    "あなたはホビー商材の要約編集者です。",
    "与えられた JSON だけを使って、日本語で 3〜6 文の自然な全体まとめを書いてください。",
    "箇条書き、見出し、番号、セクション分割は禁止です。",
    "signal, trend_signal, 話題化, heuristic などの内部語は使わず、抽選開始、締切接近、再販気配、具体反応など人が分かる言葉に翻訳してください。",
    "商品名は具体的に入れてください。抽象語だけで終わらせないでください。",
    "JSON、Markdown、コードフェンス、前置きは使わず、自然文だけを返してください。",
  ].join("\n");
}

function marketLensOverviewUserPrompt(payload) {
  return `次の市場状況から、自然文の全体まとめを日本語で作ってください。\n${JSON.stringify(payload, null, 2)}`;
}

function pickOverviewPayload(snapshot, previousSnapshot = null) {
  const activeRoutes = (snapshot.routeSnapshots ?? [])
    .filter((route) => route.status === "active")
    .filter((route) => productPhraseLooksSpecific(route.productName))
    .filter((route) => !looksLikeSiteChromeProductName(route.productName))
    .slice(0, 6)
    .map((route) => ({
      productName: route.productName,
      shopName: route.shopName,
      routeType: route.routeType,
      startDate: route.startDate,
      endDate: route.endDate,
    }));
  const activeDeals = (snapshot.deals ?? []).slice(0, 4).map((deal) => ({
    name: deal.name,
    shop: deal.shop,
    saleStartDate: deal.saleStartDate,
    saleEndDate: deal.saleEndDate,
    buyPrice: deal.buyPrice,
    sellPrice: deal.sellPrice,
  }));
  const soonCandidates = (snapshot.discoveryCandidates ?? [])
    .filter((candidate) => productPhraseLooksSpecific(candidate.name))
    .filter((candidate) => !looksLikeSiteChromeProductName(candidate.name))
    .slice(0, 5)
    .map((candidate) => ({
      name: candidate.name,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      missingData: candidate.missingData,
      sourceChannel: candidate.sourceChannel,
    }));
  const reasons = (snapshot.selectionReasons ?? []).slice(0, 10).map((reason) => ({
    productName: reason.productName,
    whyTiming: reason.whyTiming,
    whyRoute: reason.whyRoute,
    whyPrice: reason.whyPrice,
  }));
  return {
    now: activeRoutes,
    deals: activeDeals,
    soon: soonCandidates,
    reasons,
    previous: previousSnapshot
      ? {
          activeRoutes: countActiveRoutesForSnapshot(previousSnapshot),
          deals: Array.isArray(previousSnapshot.deals) ? previousSnapshot.deals.length : 0,
        }
      : null,
  };
}

function candidateLooksSentenceLike(name) {
  const text = String(name ?? "").trim();
  if (!text) return false;
  if (text.length >= 42) return true;
  return /(発売されます|開始します|紹介|確認|まとめ|について|決定|公開|配布)/.test(text);
}

function noteLlmFallbackReason(reason) {
  if (!reason) return;
  llmExecutionStats.extractionFallbackReasons.set(reason, (llmExecutionStats.extractionFallbackReasons.get(reason) ?? 0) + 1);
}

function llmExtractionEligibility({ source, result, evidenceProducts = [], extractedCandidates = [] }) {
  if (configuredLlmProvider === "heuristic") return { eligible: false, reason: llmProviderMissingReason(configuredLlmProvider) };
  if (!llmProviderConfigured()) return { eligible: false, reason: llmProviderMissingReason(configuredLlmProvider) };
  if (configuredLlmProvider === "gemini" && geminiQuotaStopped) {
    return { eligible: false, reason: geminiQuotaStopReason || "gemini_quota_exceeded" };
  }
  if (configuredLlmProvider === "gemini" && llmExecutionStats.requested >= geminiDailyCallLimit) {
    return { eligible: false, reason: "gemini_daily_call_limit_reached" };
  }
  if (realLlmExtractionCount >= effectiveLlmExtractionDocLimit()) {
    return {
      eligible: false,
      reason: configuredLlmProvider === "gemini" ? "gemini_llm_limit_reached" : "llm_extraction_doc_limit_reached",
    };
  }
  const candidateNames = extractedCandidates.map((candidate) => candidate?.name).filter(Boolean);
  const productNames = [...evidenceProducts, ...candidateNames].map(canonicalizeProductName).filter(Boolean);
  const text = `${result?.title ?? ""} ${result?.text ?? ""}`;
  const categories = new Set(
    extractedCandidates
      .map((candidate) => candidate?.category)
      .filter(Boolean),
  );
  const genericRouteOnly =
    extractedCandidates.length > 0 &&
    extractedCandidates.every((candidate) => {
      const url = candidate?.routeFinalUrl || candidate?.sourceUrl || "";
      return !url || routeTargetIsGeneric(url) || isSearchLikeUrl(url);
    });
  const missingPrice =
    extractedCandidates.length > 0 &&
    extractedCandidates.some((candidate) => !Number.isFinite(candidate?.retailPrice) || !Number.isFinite(candidate?.marketPrice));
  const sentenceLikeName = productNames.some(candidateLooksSentenceLike);
  const movieContext = /映画|劇場版|入場者特典|来場者特典|前売券|ムビチケ|劇場限定/.test(text);
  const complexCategory = [...categories].some((category) => ["pokemon", "kuji", "movie_bonus", "movie_goods"].includes(category));
  const routeLessHighValue = source?.registryStatus === "trial" || source?.lane === "lottery";
  const looksLikeChrome =
    /コメント|問い合わせ|利用規約|プライバシー|サイトマップ|カテゴリ一覧|ブランド一覧|キャラクター一覧|商品検索|店舗検索|language|copyright|faq|footer|header/i.test(text) ||
    /�{2,}|[\uFFFD]/.test(text);
  const concreteNameCount = productNames.filter(productPhraseLooksSpecific).filter((name) => !looksLikeSiteChromeProductName(name)).length;
  const cleanCandidateCount = extractedCandidates.filter((candidate) => productPhraseLooksSpecific(canonicalizeProductName(candidate?.name ?? ""))).length;
  const categoryReason = [...categories].find((category) => ["movie_bonus", "movie_goods", "kuji", "pokemon"].includes(category));
  const eligibilityReason =
    categoryReason ? `${categoryReason}_candidate` :
      movieContext ? "movie_context" :
        missingPrice ? "price_missing_candidate" :
          genericRouteOnly ? "generic_route_candidate" :
            routeLessHighValue ? "trial_or_lottery_source" :
              sentenceLikeName ? "sentence_like_name" :
                cleanCandidateCount > 0 || concreteNameCount > 0 ? "concrete_product_candidate" :
                  `not_eligible_for_${configuredLlmProvider}`;
  const eligible =
    !looksLikeChrome &&
    (concreteNameCount > 0 || complexCategory || movieContext) &&
    (sentenceLikeName || genericRouteOnly || missingPrice || complexCategory || movieContext || routeLessHighValue);
  return { eligible, reason: eligible ? eligibilityReason : `not_eligible_for_${configuredLlmProvider}`, candidateCount: cleanCandidateCount };
}

function chooseLlmModel({ provider = configuredLlmProvider, source, text = "", extractedCandidates = [] }) {
  const categories = new Set(extractedCandidates.map((candidate) => candidate?.category).filter(Boolean));
  if (
    source?.registryStatus === "trial" ||
    /映画|劇場版|入場者特典|来場者特典|前売券|ムビチケ|劇場限定/.test(text) ||
    [...categories].some((category) => ["pokemon", "kuji", "movie_bonus", "movie_goods"].includes(category))
  ) {
    return llmProviderComplexModel(provider);
  }
  return llmProviderBaseModel(provider);
}

function summarizeDirectLinksForPrompt(links = []) {
  return links
    .slice(0, 16)
    .map((link, index) => `[${index + 1}] ${link.anchorText || "(no text)"} => ${link.url}`)
    .join("\n");
}

function marketLensLlmSystemPrompt() {
  return [
    "あなたはホビー商材の構造化抽出器です。",
    "目的は記事本文やニュース本文から、具体的な商品名・イベント・直リンク・価格語を JSON で抽出することです。",
    "抽象語や監視元名ではなく、具体商品名を優先してください。",
    "URL は入力テキストやリンク一覧に存在するものだけを採用してください。存在しない URL を作らないでください。",
    "商品名は発売説明文や監視元名を除き、商品らしい部分だけにしてください。",
    "eventType は release / sale_open / sale_close / lottery_open / lottery_close / resale_open / invite_open / restock_signal / trend_signal のいずれかにしてください。",
    "lottery や sale の routeType は、本文の意味に合うものだけを選んでください。",
    "価格は本文にある数字だけを採用し、value は数値だけにしてください。",
    "もし分かるなら aiThesis, priceThesis, explorationTasks も埋めてください。分からなければ空や省略で構いません。",
    "曖昧なら空配列や空文字にしてください。",
    "出力は JSON オブジェクトのみで、余計な説明文は書かないでください。",
  ].join("\n");
}

function marketLensLlmUserPrompt({ source, result, evidenceProducts = [], extractedCandidates = [], links = [] }) {
  const candidateHints = extractedCandidates
    .slice(0, 6)
    .map((candidate) => {
      const parts = [
        candidate.name,
        candidate.category ? `category=${candidate.category}` : "",
        candidate.startDate ? `start=${candidate.startDate}` : "",
        candidate.endDate ? `end=${candidate.endDate}` : "",
        candidate.sourceUrl ? `url=${candidate.sourceUrl}` : "",
      ].filter(Boolean);
      return `- ${parts.join(" / ")}`;
    })
    .join("\n");
  return [
    `source lane: ${source?.lane ?? ""}`,
    `source keyword: ${source?.keyword ?? ""}`,
    `source url: ${result?.url ?? source?.url ?? ""}`,
    `title: ${result?.title ?? ""}`,
    evidenceProducts.length > 0 ? `rule extracted products:\n${evidenceProducts.map((name) => `- ${name}`).join("\n")}` : "rule extracted products:\n- none",
    candidateHints ? `existing candidates:\n${candidateHints}` : "existing candidates:\n- none",
    links.length > 0 ? `available links:\n${summarizeDirectLinksForPrompt(links)}` : "available links:\n- none",
    "document text:",
    String(result?.text ?? "").slice(0, 18000),
  ].join("\n\n");
}

function extractJsonCandidatesFromPayload(value, rows = []) {
  if (typeof value === "string") {
    rows.push(value);
    return rows;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractJsonCandidatesFromPayload(item, rows);
    return rows;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "text" || key === "output_text") {
        extractJsonCandidatesFromPayload(child, rows);
        continue;
      }
      extractJsonCandidatesFromPayload(child, rows);
    }
  }
  return rows;
}

function stripCodeFence(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function tryParseJsonCandidate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = stripCodeFence(value);
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseStructuredResponsePayload(payload) {
  const candidates = extractJsonCandidatesFromPayload(payload, []);
  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

function stripMarkdownCodeFence(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const fenced = text.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  return fenced ? String(fenced[1] ?? "").trim() : text;
}

function collectTextLikeValues(value, bucket = []) {
  if (typeof value === "string") {
    const cleaned = stripMarkdownCodeFence(value);
    if (cleaned) bucket.push(cleaned);
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextLikeValues(item, bucket);
    return bucket;
  }
  if (!value || typeof value !== "object") return bucket;
  if (typeof value.text === "string") {
    const cleaned = stripMarkdownCodeFence(value.text);
    if (cleaned) bucket.push(cleaned);
  }
  for (const nested of Object.values(value)) collectTextLikeValues(nested, bucket);
  return bucket;
}

function parseOverviewNarrativePayload(payload, fallbackBasedOn = []) {
  const structured = parseStructuredResponsePayload(payload);
  if (structured?.text) {
    return {
      text: compactReasonText(structured.text, ""),
      basedOn: Array.isArray(structured.basedOn) ? structured.basedOn.filter(Boolean).slice(0, 16) : fallbackBasedOn,
    };
  }
  const textCandidates = collectTextLikeValues(payload, []);
  for (const candidate of textCandidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed?.text) {
      return {
        text: compactReasonText(parsed.text, ""),
        basedOn: Array.isArray(parsed.basedOn) ? parsed.basedOn.filter(Boolean).slice(0, 16) : fallbackBasedOn,
      };
    }
    const plain = compactReasonText(candidate, "");
    if (plain && !/^\s*[\[{]/.test(plain)) {
      return { text: plain, basedOn: fallbackBasedOn };
    }
  }
  return null;
}

async function requestOpenAiOverviewNarrative(snapshot, previousSnapshot = null) {
  if (!openAiApiKey) return null;
  const payload = {
    model: openAiBaseModel,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: marketLensOverviewSystemPrompt() }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: marketLensOverviewUserPrompt(pickOverviewPayload(snapshot, previousSnapshot)) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "marketlens_overview_narrative",
        strict: true,
        schema: overviewNarrativeSchema,
      },
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmTimeoutMs);
  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errorText.slice(0, 240)}`);
    }
    const data = await response.json();
    const parsed = parseStructuredResponsePayload(data);
    if (!parsed?.text) return null;
    return {
      text: compactReasonText(parsed.text, ""),
      sourceMode: "openai",
      generatedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
      basedOn: Array.isArray(parsed.basedOn) ? parsed.basedOn.filter(Boolean).slice(0, 16) : [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestGeminiJsonWithFallback(payload, primaryModel, { allowText = false } = {}) {
  const modelsToTry = [primaryModel];
  if (geminiFallbackModel && geminiFallbackModel !== primaryModel) modelsToTry.push(geminiFallbackModel);
  let lastError = null;

  for (let index = 0; index < modelsToTry.length; index += 1) {
    const model = modelsToTry[index];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), llmTimeoutMs);
    try {
      const response = await fetch(`${geminiBaseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          const reason = geminiFallbackReason({ kind: "quota", model, status: response.status });
          markGeminiQuotaStopped(reason);
          throw new Error(reason);
        }
        if (geminiShouldRetryWithFallback(response.status, model)) {
          const retryError = new Error(`${geminiFallbackReason({ kind: "request", model, status: response.status })}: ${errorText.slice(0, 240)}`);
          retryError.retryWithFallback = true;
          lastError = retryError;
          continue;
        }
        throw new Error(`${geminiFallbackReason({ kind: "request", model, status: response.status })}: ${errorText.slice(0, 240)}`);
      }
      const data = await response.json();
      const parsed = parseStructuredResponsePayload(data);
      if ((!parsed || typeof parsed !== "object") && !allowText) {
        throw new Error(geminiFallbackReason({ kind: "parse", model }));
      }
      noteActualModelUsed(model);
      return {
        parsed: parsed ?? data,
        actualModelUsed: model,
        usedFallbackModel: model !== primaryModel,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(geminiFallbackReason({ kind: "timeout", model }));
      }
      if (String(error?.message ?? "").includes("gemini_quota_exceeded")) throw error;
      lastError = error;
      if (!error?.retryWithFallback || index >= modelsToTry.length - 1) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("gemini_request_failed");
}

async function requestGeminiOverviewNarrative(snapshot, previousSnapshot = null) {
  if (!geminiApiKey) return null;
  if (geminiQuotaStopped) {
    throw new Error(geminiQuotaStopReason || "gemini_quota_exceeded");
  }
  const model = geminiBaseModel;
  const overviewPayload = pickOverviewPayload(snapshot, previousSnapshot);
  const fallbackBasedOn = [
    ...(overviewPayload?.now ?? []).map((item) => normalizeProductKey(item.productName ?? item.name ?? "")),
    ...(overviewPayload?.deals ?? []).map((item) => normalizeProductKey(item.name ?? "")),
    ...(overviewPayload?.soon ?? []).map((item) => normalizeProductKey(item.name ?? "")),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index).slice(0, 16);
  const payload = {
    systemInstruction: {
      parts: [{ text: marketLensOverviewPlainSystemPrompt() }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: `${marketLensOverviewUserPrompt(overviewPayload)}\n\n自然文だけを返してください。` }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };
  try {
    const { parsed, actualModelUsed } = await requestGeminiJsonWithFallback(payload, model, { allowText: true });
    const overview = parseOverviewNarrativePayload(parsed, fallbackBasedOn);
    if (!overview?.text) throw new Error(geminiFallbackReason({ kind: "parse", model: actualModelUsed || model }));
    return {
      text: overview.text,
      sourceMode: "gemini",
      model: actualModelUsed || model,
      generatedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
      basedOn: overview.basedOn,
    };
  } catch (error) {
    throw error;
  }
}

async function requestLlmOverviewNarrative(snapshot, previousSnapshot = null) {
  if (configuredLlmProvider === "gemini") return requestGeminiOverviewNarrative(snapshot, previousSnapshot);
  if (configuredLlmProvider === "openai") return requestOpenAiOverviewNarrative(snapshot, previousSnapshot);
  return null;
}

function safeIsoDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function confidenceToLabel(value) {
  if (value >= 0.78) return "高";
  if (value >= 0.58) return "中";
  return "低";
}

function normalizeLlmExtractionOutput(raw, context, fallbackExtraction) {
  const allowedUrls = new Set(context.availableUrls ?? []);
  const products = (Array.isArray(raw?.products) ? raw.products : [])
    .map((product) => {
      const name = canonicalizeProductName(product?.name ?? "");
      if (!productPhraseLooksSpecific(name)) return null;
      const meta = productMetaFromName(name, product?.category ?? "", "");
      return {
        name,
        category: product?.category && product.category !== "unknown" ? product.category : meta.category,
        productType: product?.productType || meta.productType,
        confidence: clampNumber(Number(product?.confidence ?? 0.65), 0, 1),
      };
    })
    .filter(Boolean)
    .slice(0, 10);
  const productNames = new Set(products.map((product) => product.name));
  const links = (Array.isArray(raw?.links) ? raw.links : [])
    .map((link) => {
      const url = String(link?.url ?? "").trim();
      if (!url || !allowedUrls.has(url)) return null;
      return {
        url,
        anchorText: String(link?.anchorText ?? "").trim(),
        kind: structuredLinkKind(url, String(link?.anchorText ?? "")),
        confidence: clampNumber(Number(link?.confidence ?? 0.7), 0, 1),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  const events = (Array.isArray(raw?.events) ? raw.events : [])
    .map((event) => {
      const productName = canonicalizeProductName(event?.productName ?? "");
      if (!productPhraseLooksSpecific(productName) && !productNames.has(productName)) return null;
      const applyUrl = String(event?.applyUrl ?? "").trim();
      const sourceUrl = String(event?.sourceUrl ?? "").trim();
      const safeApplyUrl = allowedUrls.has(applyUrl) ? applyUrl : "";
      const safeSourceUrl = allowedUrls.has(sourceUrl) ? sourceUrl : context.resultUrl;
      return {
        productName,
        eventType: inferStructuredEventType(String(event?.eventType ?? ""), productName),
        startDate: safeIsoDate(event?.startDate),
        endDate: safeIsoDate(event?.endDate),
        dateConfidence: ["official_exact", "official_inferred", "article_exact", "article_inferred", "rolling"].includes(event?.dateConfidence)
          ? event.dateConfidence
          : inferDateConfidence({
              lane: context.sourceLane,
              sourceUrl: safeSourceUrl || safeApplyUrl || context.resultUrl,
              startDate: safeIsoDate(event?.startDate),
              endDate: safeIsoDate(event?.endDate),
            }),
        shopName: String(event?.shopName ?? "").trim() || sourceLabelFromAnyUrl(safeApplyUrl || safeSourceUrl || context.resultUrl),
        routeType: ["lottery", "sale", "resale", "invite", "signal"].includes(event?.routeType) ? event.routeType : "signal",
        applyUrl: safeApplyUrl,
        sourceUrl: safeSourceUrl || "",
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  const prices = (Array.isArray(raw?.prices) ? raw.prices : [])
    .map((price) => {
      const productName = canonicalizeProductName(price?.productName ?? "");
      if (!productPhraseLooksSpecific(productName) && !productNames.has(productName)) return null;
      const value = Number(price?.value);
      if (!Number.isFinite(value) || value <= 0) return null;
      return {
        productName,
        priceType: ["retail", "market", "predicted_market", "mentioned_price"].includes(price?.priceType) ? price.priceType : "mentioned_price",
        value: Math.round(value),
        condition: String(price?.condition ?? "").trim() || "本文抽出",
        confidence: clampNumber(Number(price?.confidence ?? 0.65), 0, 1),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  const reasons = {
    whyTopic: String(raw?.reasons?.whyTopic ?? fallbackExtraction.reasons?.whyTopic ?? "").trim(),
    whyTiming: String(raw?.reasons?.whyTiming ?? "").trim(),
    whyRoute: String(raw?.reasons?.whyRoute ?? fallbackExtraction.reasons?.whyRoute ?? "").trim(),
    whyPrice: String(raw?.reasons?.whyPrice ?? fallbackExtraction.reasons?.whyPrice ?? "").trim(),
    whyHistory: String(raw?.reasons?.whyHistory ?? "").trim(),
  };
  const aiThesis = raw?.aiThesis && typeof raw.aiThesis === "object"
    ? {
        sourceMode: context.provider,
        whyHot: compactReasonText(raw.aiThesis.whyHot, ""),
        confidence: clampNumber(Number(raw.aiThesis.confidence ?? raw.confidence ?? 0.65), 0, 1),
        demandDrivers: (Array.isArray(raw.aiThesis.demandDrivers) ? raw.aiThesis.demandDrivers : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
        supplyConstraints: (Array.isArray(raw.aiThesis.supplyConstraints) ? raw.aiThesis.supplyConstraints : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
        comparableMarkets: (Array.isArray(raw.aiThesis.comparableMarkets) ? raw.aiThesis.comparableMarkets : [])
          .map((item) => ({
            name: String(item?.name ?? "").trim(),
            reason: compactReasonText(item?.reason, ""),
          }))
          .filter((item) => item.name && item.reason)
          .slice(0, 4),
        riskFactors: (Array.isArray(raw.aiThesis.riskFactors) ? raw.aiThesis.riskFactors : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
        nextChecks: (Array.isArray(raw.aiThesis.nextChecks) ? raw.aiThesis.nextChecks : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 6),
      }
    : null;
  const priceThesis =
    raw?.priceThesis && Number.isFinite(Number(raw.priceThesis.estimatedMarketPrice))
      ? {
          sourceMode: context.provider,
          estimatedMarketPrice: Math.round(Number(raw.priceThesis.estimatedMarketPrice)),
          confidence: clampNumber(Number(raw.priceThesis.confidence ?? raw.confidence ?? 0.65), 0, 1),
          basis: (Array.isArray(raw.priceThesis.basis) ? raw.priceThesis.basis : []).map((item) => compactReasonText(item, "")).filter(Boolean).slice(0, 4),
          priceSourceRank: "ai_estimate",
          notForBuyLineReason:
            compactReasonText(raw.priceThesis.notForBuyLineReason, "") || "AI推定価格のため、実成約確認まではBuyLineに使いません。",
        }
      : null;
  const explorationTasks = Array.isArray(raw?.explorationTasks)
    ? raw.explorationTasks
        .map((task) => ({
          query: String(task?.query ?? "").trim(),
          targetCategory: String(task?.targetCategory ?? "").trim(),
          reason: compactReasonText(task?.reason, ""),
          priority: clampNumber(Math.round(Number(task?.priority ?? 3)), 1, 5),
          expectedEvidence: (Array.isArray(task?.expectedEvidence) ? task.expectedEvidence : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
        }))
        .filter((task) => task.query && task.reason)
        .slice(0, 6)
    : [];
  return {
    docId: context.docId,
    model: context.model,
    mode: context.provider,
    provider: context.provider,
    extractedAt: context.extractedAt,
    sourceKey: context.sourceKey,
    confidence: clampNumber(Number(raw?.confidence ?? 0.72), 0, 1),
    products,
    events,
    links,
    prices,
    reasons,
    aiThesis,
    priceThesis,
    explorationTasks,
  };
}

function mergeStructuredExtractions(primary, fallback) {
  const mergeUnique = (items, keyFn) => {
    const map = new Map();
    for (const item of [...(fallback?.[items] ?? []), ...(primary?.[items] ?? [])]) {
      if (!item) continue;
      const key = keyFn(item);
      if (!key) continue;
      if (!map.has(key)) map.set(key, item);
    }
    return [...map.values()];
  };
  return {
    ...fallback,
    ...primary,
    mode: primary?.mode || fallback?.mode || "heuristic",
    products: mergeUnique("products", (item) => normalizeProductKey(item.name)),
    events: mergeUnique("events", (item) => `${normalizeProductKey(item.productName)}|${item.eventType}|${item.startDate}|${item.applyUrl || item.sourceUrl}`),
    links: mergeUnique("links", (item) => `${item.kind}|${item.url}`),
    prices: mergeUnique("prices", (item) => `${normalizeProductKey(item.productName)}|${item.priceType}|${item.condition}|${item.value}`),
    reasons: {
      whyTopic: primary?.reasons?.whyTopic || fallback?.reasons?.whyTopic || "",
      whyTiming: primary?.reasons?.whyTiming || fallback?.reasons?.whyTiming || "",
      whyRoute: primary?.reasons?.whyRoute || fallback?.reasons?.whyRoute || "",
      whyPrice: primary?.reasons?.whyPrice || fallback?.reasons?.whyPrice || "",
      whyHistory: primary?.reasons?.whyHistory || fallback?.reasons?.whyHistory || "",
    },
    aiThesis: primary?.aiThesis || fallback?.aiThesis || null,
    priceThesis: primary?.priceThesis || fallback?.priceThesis || null,
    explorationTasks: [...(primary?.explorationTasks ?? []), ...(fallback?.explorationTasks ?? [])].slice(0, 6),
    confidence: Math.max(Number(primary?.confidence ?? 0), Number(fallback?.confidence ?? 0)),
    geminiEligible: Boolean(primary?.geminiEligible ?? fallback?.geminiEligible),
    geminiEligibilityReason: primary?.geminiEligibilityReason || fallback?.geminiEligibilityReason || "",
  };
}

async function requestOpenAiStructuredExtraction({ docId, source, result, evidenceProducts = [], extractedCandidates = [] }) {
  const eligibility = llmExtractionEligibility({ source, result, evidenceProducts, extractedCandidates });
  if (!eligibility.eligible) return null;
  const links = extractLinksFromHtml(result?.html ?? "", result?.url ?? source?.url ?? "");
  const availableUrls = [...new Set([result?.url ?? source?.url ?? "", ...links.map((link) => link.url)].filter(Boolean))];
  const model = chooseLlmModel({
    provider: "openai",
    source,
    text: `${result?.title ?? ""} ${result?.text ?? ""}`,
    extractedCandidates,
  });
  llmExecutionStats.requested += 1;
  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: marketLensLlmSystemPrompt() }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: marketLensLlmUserPrompt({ source, result, evidenceProducts, extractedCandidates, links }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "marketlens_structured_extraction",
        strict: true,
        schema: structuredExtractionSchema,
      },
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmTimeoutMs);
  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errorText.slice(0, 240)}`);
    }
    const data = await response.json();
    const parsed = parseStructuredResponsePayload(data);
    if (!parsed) return null;
    realLlmExtractionCount += 1;
    llmExecutionStats.succeeded += 1;
    return normalizeLlmExtractionOutput(
      parsed,
      {
        docId,
        model,
        provider: "openai",
        extractedAt: result?.fetchedAt ?? new Date().toISOString(),
        sourceKey: source?.sourceKey ?? source?.id ?? "",
        sourceLane: source?.lane ?? "official",
        resultUrl: result?.url ?? source?.url ?? "",
        availableUrls,
      },
      buildHeuristicLlmExtraction({ docId, source, result, evidenceProducts, extractedCandidates }),
    );
  } catch (error) {
    llmExecutionStats.failed += 1;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestGeminiStructuredExtraction({ docId, source, result, evidenceProducts = [], extractedCandidates = [] }) {
  if (geminiQuotaStopped) {
    throw new Error(geminiQuotaStopReason || "gemini_quota_exceeded");
  }
  const links = extractLinksFromHtml(result?.html ?? "", result?.url ?? source?.url ?? "");
  const availableUrls = [...new Set([result?.url ?? source?.url ?? "", ...links.map((link) => link.url)].filter(Boolean))];
  const model = chooseLlmModel({
    provider: "gemini",
    source,
    text: `${result?.title ?? ""} ${result?.text ?? ""}`,
    extractedCandidates,
  });
  llmExecutionStats.requested += 1;
  const payload = {
    systemInstruction: {
      parts: [{ text: marketLensLlmSystemPrompt() }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: marketLensLlmUserPrompt({ source, result, evidenceProducts, extractedCandidates, links }),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.15,
      responseMimeType: "application/json",
    },
  };
  try {
    const { parsed, actualModelUsed } = await requestGeminiJsonWithFallback(payload, model);
    realLlmExtractionCount += 1;
    llmExecutionStats.succeeded += 1;
    return normalizeLlmExtractionOutput(
      parsed,
      {
        docId,
        model: actualModelUsed || model,
        provider: "gemini",
        extractedAt: result?.fetchedAt ?? new Date().toISOString(),
        sourceKey: source?.sourceKey ?? source?.id ?? "",
        sourceLane: source?.lane ?? "official",
        resultUrl: result?.url ?? source?.url ?? "",
        availableUrls,
      },
      buildHeuristicLlmExtraction({ docId, source, result, evidenceProducts, extractedCandidates }),
    );
  } catch (error) {
    llmExecutionStats.failed += 1;
    throw error;
  }
}

async function buildStructuredLlmExtraction({ docId, source, result, evidenceProducts = [], extractedCandidates = [] }) {
  const fallback = buildHeuristicLlmExtraction({ docId, source, result, evidenceProducts, extractedCandidates });
  const eligibility = llmExtractionEligibility({ source, result, evidenceProducts, extractedCandidates });
  const fallbackWithEligibility = {
    ...fallback,
    geminiEligible: eligibility.eligible && configuredLlmProvider === "gemini",
    geminiEligibilityReason: eligibility.reason,
  };
  if (eligibility.eligible) {
    llmExecutionStats.eligible += 1;
  } else {
    llmExecutionStats.skipped += 1;
    noteLlmFallbackReason(eligibility.reason);
    return {
      ...fallbackWithEligibility,
      fallbackReason: eligibility.reason,
    };
  }
  try {
    const structured =
      configuredLlmProvider === "gemini"
        ? await requestGeminiStructuredExtraction({ docId, source, result, evidenceProducts, extractedCandidates })
        : await requestOpenAiStructuredExtraction({ docId, source, result, evidenceProducts, extractedCandidates });
    const structuredWithEligibility = structured
      ? {
          ...structured,
          geminiEligible: eligibility.eligible && configuredLlmProvider === "gemini",
          geminiEligibilityReason: eligibility.reason,
        }
      : null;
    return structuredWithEligibility ? mergeStructuredExtractions(structuredWithEligibility, fallbackWithEligibility) : fallbackWithEligibility;
  } catch (error) {
    const fallbackReason = String(error?.message ?? error ?? `${configuredLlmProvider}_request_failed`);
    noteLlmFallbackReason(fallbackReason);
    return {
      ...fallbackWithEligibility,
      mode: "heuristic",
      provider: "heuristic-fallback",
      fallbackReason,
    };
  }
}

function llmExtractionConfidenceScore(extraction) {
  return clampNumber(Math.round(Number(extraction?.confidence ?? 0.55) * 100), 45, 97);
}

function buildTrendsFromLlmExtraction(extraction, source, fallbackDate, sourceLabel) {
  const trends = [];
  for (const product of extraction?.products ?? []) {
    const event = (extraction.events ?? []).find((item) => normalizeProductKey(item.productName) === normalizeProductKey(product.name)) ?? extraction.events?.[0] ?? null;
    const date = safeIsoDate(event?.startDate) || fallbackDate;
    const type = event ? eventTypeLabelJa(event.eventType) : "記事抽出";
    trends.push({
      keyword: product.name,
      context: extraction?.reasons?.whyTopic || `${sourceLabel} / LLM抽出`,
      score: llmExtractionConfidenceScore(extraction),
      type,
      change24h: `抽出 ${String(date).slice(5).replace("-", "/")}`,
      source: sourceLabel,
      confidence: confidenceToLabel(Number(product.confidence ?? extraction.confidence ?? 0.65)),
      startDate: safeIsoDate(event?.startDate) || fallbackDate,
      endDate: safeIsoDate(event?.endDate) || addDaysToIsoDate(fallbackDate, 14),
      action: extraction?.reasons?.whyTiming || "具体ルートと価格を確認",
    });
  }
  return trends;
}

function buildCandidatesFromLlmExtraction(extraction, source, fallbackDate, reliability) {
  const candidates = [];
  const sourceLabel = source?.keyword ?? source?.trend?.keyword ?? source?.sourceKey ?? "監視ソース";
  for (const product of extraction?.products ?? []) {
    const event = (extraction.events ?? []).find((item) => normalizeProductKey(item.productName) === normalizeProductKey(product.name)) ?? extraction.events?.[0] ?? null;
    const link =
      (extraction.links ?? []).find((item) => ["apply_page", "product_page", "market_page", "page"].includes(item.kind)) ?? null;
    const retail = (extraction.prices ?? []).find(
      (item) => normalizeProductKey(item.productName) === normalizeProductKey(product.name) && item.priceType === "retail",
    );
    const market = (extraction.prices ?? []).find(
      (item) =>
        normalizeProductKey(item.productName) === normalizeProductKey(product.name) &&
        (item.priceType === "market" || item.priceType === "predicted_market"),
    );
    const startDate = safeIsoDate(event?.startDate) || fallbackDate;
    const endDate = safeIsoDate(event?.endDate) || addDaysToIsoDate(startDate, 14);
    const directUrl = event?.applyUrl || event?.sourceUrl || link?.url || "";
    const missing = [];
    if (!startDate || !endDate) missing.push("期間情報");
    if (!directUrl) missing.push("公式導線");
    if (!Number.isFinite(retail?.value)) missing.push("公式価格");
    if (!Number.isFinite(market?.value)) missing.push("相場価格");
    candidates.push({
      name: product.name,
      trend: sourceLabel,
      stage: "追加候補",
      stageKind: "candidate",
      genreScore: llmExtractionConfidenceScore(extraction),
      priceData: Number.isFinite(retail?.value) || Number.isFinite(market?.value) ? "取得" : "未取得",
      tradeVolume: Number.isFinite(market?.value) ? "確認中" : "要確認",
      marginSignal: extraction?.reasons?.whyPrice || "LLM抽出で価格語を再整理",
      reason: extraction?.reasons?.whyTopic || `${sourceLabel} 由来の具体商品候補`,
      confidence: confidenceToLabel(Number(product.confidence ?? extraction?.confidence ?? 0.65)),
      adoptionReason: `${sourceLabel}由来 / LLM抽出`,
      missingData: missing.join("、") || "発売後の成約価格、送料サイズ",
      sourceUrl: directUrl,
      routeFinalUrl: directUrl || null,
      evidenceUrl: event?.sourceUrl || source?.url || "",
      retailPrice: Number.isFinite(retail?.value) ? retail.value : null,
      retailPriceLabel: Number.isFinite(retail?.value) ? `抽出価格 ${formatYen(retail.value)}` : null,
      retailPriceSource: Number.isFinite(retail?.value) ? "llm-article" : null,
      marketPrice: Number.isFinite(market?.value) ? market.value : null,
      marketPriceLabel: Number.isFinite(market?.value) ? `抽出相場 ${formatYen(market.value)}` : null,
      marketPriceSource: Number.isFinite(market?.value) ? "llm-article" : null,
      startDate,
      endDate,
      category: product.category,
      sourceChannel: source?.lane ?? detectSourceChannel(source, source?.url),
      sourceReliability: reliability,
    });
  }
  return candidates;
}

function buildHeuristicLlmExtraction({ docId, source, result, evidenceProducts = [], extractedCandidates = [] }) {
  const text = `${result?.title ?? ""} ${result?.text ?? ""}`.slice(0, 30000);
  const links = extractLinksFromHtml(result?.html ?? "", result?.url ?? source?.url ?? "");
  const linkedMovieProducts = extractMovieLinkedProducts(result?.title ?? "", result?.text ?? "", links);
  const products = [
    ...new Set(
      [...evidenceProducts, ...extractProductPhrases(text), ...linkedMovieProducts, ...extractedCandidates.map((candidate) => candidate.name)]
        .map((name) => canonicalizeProductName(name))
        .filter(productPhraseLooksSpecific),
    ),
  ].slice(0, 8);
  const dates = extractIsoDatesFromText(text).slice(0, 4);
  const retailPrice = extractRetailPrice(text, products[0] ?? "", null);
  const numericPrices = extractNumericPrices(text).map((row) => row.value).filter((value) => value >= 300 && value <= 300000);
  const directLinks = links
    .map((link) => ({
      url: link.url,
      anchorText: link.anchorText,
      kind: structuredLinkKind(link.url, link.anchorText),
    }))
    .filter((link) => link.kind !== "generic")
    .slice(0, 8);
  const linkKindWeight = { apply_page: 5, product_page: 4, market_page: 3, page: 2, article: 1, profile: 0 };
  const bestLink = [...directLinks].sort((a, b) => (linkKindWeight[b.kind] ?? 0) - (linkKindWeight[a.kind] ?? 0))[0] ?? null;
  const prices = [];
  if (Number.isFinite(retailPrice)) {
    prices.push({ priceType: "retail", value: retailPrice, condition: "本文抽出", confidence: 0.74 });
  }
  for (const value of numericPrices.slice(0, 4)) {
    prices.push({ priceType: "mentioned_price", value, condition: "本文価格語", confidence: 0.52 });
  }
  const eventType = inferStructuredEventType(text, products[0] ?? "");
  const dateConfidence =
    source?.lane === "official" || source?.lane === "lottery"
      ? dates[0]
        ? "official_inferred"
        : "rolling"
      : dates[0]
        ? "article_inferred"
        : "rolling";
  const reasonParts = llmReasonPhrases(text, directLinks.length, prices, products);
  return {
    docId,
    model: heuristicLlmModel,
    mode: "heuristic",
    provider: "heuristic",
    extractedAt: result?.fetchedAt ?? new Date().toISOString(),
    sourceKey: source?.sourceKey ?? source?.id ?? "",
    confidence:
      products.length >= 2 && bestLink && prices.length > 0 ? 0.82 : products.length >= 1 && (bestLink || prices.length > 0) ? 0.67 : 0.45,
    products: products.map((name) => ({
      name,
      category: productMetaFromName(name, "", bestLink?.url ?? result?.url ?? "").category,
      productType: productMetaFromName(name, "", bestLink?.url ?? result?.url ?? "").productType,
      confidence: productPhraseLooksSpecific(name) ? 0.7 : 0.45,
    })),
    events:
      products.length === 0
        ? []
        : [
            {
              productName: products[0],
              eventType,
              startDate: dates[0] ?? null,
              endDate: dates[1] ?? null,
              dateConfidence,
              shopName: bestLink ? sourceLabelFromAnyUrl(bestLink.url ?? "") : "",
              routeType: /lottery|apply/.test(eventType) ? "lottery" : /sale/.test(eventType) ? "sale" : "signal",
              applyUrl: bestLink?.kind === "apply_page" ? bestLink.url : "",
              sourceUrl: result?.url ?? source?.url ?? "",
            },
          ],
    links: directLinks,
    prices,
    reasons: reasonParts,
  };
}

function priceMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
}

function shippingProfileForProduct(product) {
  const type = product?.productType ?? "";
  const category = product?.category ?? "";
  if (type === "pokemon_box") return { category: "pokemon_box", shipping: 210 };
  if (type === "watch" || type === "figure" || category === "figure") return { category: "large", shipping: 750 };
  if (type === "movie_goods") return { category: "unknown", shipping: 750 };
  return { category: "thin", shipping: 210 };
}

function estimateProfitValue(retail, market, product) {
  if (!Number.isFinite(retail) || !Number.isFinite(market)) return null;
  const shipping = shippingProfileForProduct(product).shipping;
  const fee = Math.round(market * (defaultProfitFeeRate / 100));
  const buffer = Math.round(market * (defaultProfitBufferRate / 100));
  return market - fee - retail - shipping - defaultPackingCost - buffer;
}

function buildHistoricalComparables(snapshot, yearlyLearningMap = new Map()) {
  const priceByProduct = new Map();
  for (const price of snapshot.priceSnapshots ?? []) {
    const rows = priceByProduct.get(price.productKey) ?? [];
    rows.push(price);
    priceByProduct.set(price.productKey, rows);
  }
  const rows = [];
  for (const product of snapshot.normalizedProducts ?? []) {
    if (!isReliableComparableProduct(product)) continue;
    const peers = (snapshot.normalizedProducts ?? [])
      .filter((peer) => peer.productKey !== product.productKey)
      .filter((peer) => isReliableComparableProduct(peer))
      .map((peer) => {
        let similarity = 0;
        const basis = [];
        if (peer.category && peer.category === product.category) {
          similarity += 0.32;
          basis.push("category");
        }
        if (peer.productType && peer.productType === product.productType) {
          similarity += 0.22;
          basis.push("productType");
        }
        if (peer.ip && peer.ip === product.ip) {
          similarity += 0.2;
          basis.push("ip");
        }
        if (peer.brand && peer.brand === product.brand) {
          similarity += 0.14;
          basis.push("brand");
        }
        if (peer.series && product.series && peer.series === product.series) {
          similarity += 0.12;
          basis.push("series");
        }
        const priceRows = priceByProduct.get(peer.productKey) ?? [];
        const launchPrice = comparableLaunchPriceFromSnapshots(priceRows);
        const retailValue = priceRows.find((row) => row.priceType === "retail" && Number.isFinite(row.value))?.value ?? null;
        if (!Number.isFinite(launchPrice)) return null;
        if (similarity < 0.54 || basis.length < 2) return null;
        return {
          productKey: product.productKey,
          comparableKey: peer.productKey,
          comparableName: peer.canonicalName,
          similarity: Number(similarity.toFixed(2)),
          category: product.category,
          basis,
          prelaunchPrice: null,
          launchPrice,
          peakPrice: launchPrice,
          marginProfile: estimateProfitValue(retailValue, launchPrice, peer),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
    rows.push(...peers);
  }
  return rows;
}

function buildPredictedPriceSnapshots(snapshot, historicalComparables, yearlyLearningMap = new Map()) {
  const priceByProduct = new Map();
  for (const price of snapshot.priceSnapshots ?? []) {
    const rows = priceByProduct.get(price.productKey) ?? [];
    rows.push(price);
    priceByProduct.set(price.productKey, rows);
  }
  const comparablesByProduct = new Map();
  for (const comparable of historicalComparables) {
    const rows = comparablesByProduct.get(comparable.productKey) ?? [];
    rows.push(comparable);
    comparablesByProduct.set(comparable.productKey, rows);
  }
  const snapshots = [];
  for (const product of snapshot.normalizedProducts ?? []) {
    if (!isReliableComparableProduct(product)) continue;
    const learning =
      yearlyLearningMap.get(product.productKey) ??
      yearlyLearningMap.get(normalizeSignalText(product.productKey)) ??
      null;
    const currentPrices = priceByProduct.get(product.productKey) ?? [];
    const actualMarket = currentPrices.find(
      (row) =>
        row.priceType === "market" &&
        Number.isFinite(row.value) &&
        (row.buyLineEligible === true || row.priceSourceRank === "manual_price"),
    );
    const actualRetail = currentPrices.find((row) => row.priceType === "retail" && Number.isFinite(row.value));
    const comparables = (comparablesByProduct.get(product.productKey) ?? []).filter(
      (row) =>
        Number.isFinite(row.launchPrice) &&
        (row.basis?.length ?? 0) >= 2 &&
        (row.similarity ?? 0) >= 0.54 &&
        isReliableComparableProduct({ canonicalName: row.comparableName, productKey: row.comparableKey }),
    );
    const comparableValues = comparables.map((row) => row.launchPrice).filter(Number.isFinite);
    const base = priceMedian([
      ...comparableValues,
      ...(Number.isFinite(actualMarket?.value) ? [actualMarket.value] : []),
    ]);
    if (!Number.isFinite(base)) continue;
    if (comparableValues.length === 0 && !actualMarket) continue;
    const min = Math.round(base * 0.88);
    const max = Math.round(base * 1.15);
    snapshots.push({
      productKey: product.productKey,
      productName: product.canonicalName,
      priceType: "predicted_market",
      min,
      base,
      max,
      source: comparables.length > 0 ? "comparables" : "verified_market",
      priceSourceRank: "historical_prediction",
      priceUsage: "watch",
      buyLineEligible: false,
      confidence: comparables.length >= 3 || actualMarket ? "medium" : "low",
      observedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
      basisCount: comparables.length,
      estimateQuality: comparables.length >= 2 || actualMarket ? "specific" : "weak",
    });
    const retailValue = actualRetail?.value ?? learning?.retailMedian ?? null;
    const predictedProfit = estimateProfitValue(retailValue, base, product);
    if (Number.isFinite(predictedProfit)) {
      snapshots.push({
        productKey: product.productKey,
        productName: product.canonicalName,
        priceType: "predicted_profit",
        min: estimateProfitValue(retailValue, min, product),
        base: predictedProfit,
        max: estimateProfitValue(retailValue, max, product),
        source: comparables.length > 0 ? "comparables" : "learning",
        priceSourceRank: "historical_prediction",
        priceUsage: "watch",
        buyLineEligible: false,
        confidence: comparables.length >= 3 ? "medium" : "low",
        observedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
        basisCount: comparables.length,
      });
    }
  }
  return snapshots;
}

function buildExplorationTasks(snapshot, registryEntries, yearlyLearning) {
  const tasks = [];
  const seen = new Set();
  const expectedEvidenceForTask = (task) => {
    if (Array.isArray(task.expectedEvidence) && task.expectedEvidence.length > 0) return task.expectedEvidence.slice(0, 5);
    const text = `${task.targetCategory ?? ""} ${task.query ?? ""} ${task.reason ?? ""}`;
    if (/movie_bonus|入場者特典|来場者特典|週替わり|特典/.test(text)) return ["配布条件", "配布期間", "劇場", "公式リンク"];
    if (/movie_goods|劇場限定|パンフレット|ムビチケ/.test(text)) return ["発売日", "劇場限定", "通販有無", "購入制限", "公式リンク"];
    if (/pokemon|ポケカ|抽選|再販|招待/.test(text)) return ["抽選開始", "抽選終了", "応募リンク", "再販有無", "相場"];
    if (/kuji|一番くじ|ラストワン|A賞/.test(text)) return ["主要賞", "ラストワン", "1回価格", "賞別相場"];
    if (/相場|価格|メルカリ/.test(text)) return ["成約価格", "出品状態", "取引件数"];
    return ["公式リンク", "日付", "価格"];
  };
  const addTask = (task) => {
    const key = `${task.kind}:${normalizeSignalText(task.query || task.series || task.brand || task.topic || task.targetCategory || task.lane || task.origin || "")}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    tasks.push({
      id: key,
      status: "queued",
      dueAt: todayIsoDate(),
      targetCategory: task.targetCategory || "generic_hobby",
      sourceMode: task.sourceMode || "heuristic",
      expectedEvidence: expectedEvidenceForTask(task),
      ...task,
    });
  };

  const laneCounts = summarizeRegistry(registryEntries).byLane ?? {};
  const officialCount = Number(laneCounts.official ?? 0);
  const shortageLanes = ["blog", "sns", "news", "lottery"].filter(
    (lane) => Number(laneCounts[lane] ?? 0) < Math.max(10, Math.floor(officialCount * 0.1)),
  );
  for (const lane of shortageLanes) {
    addTask({
      kind: "source_probe",
      lane,
      priority: "high",
      targetCategory: lane,
      reason: `${lane} lane が不足しているため補完`,
      query:
        lane === "blog"
          ? "転売 プレ値 品薄 完売 ブログ"
          : lane === "sns"
            ? "抽選 再販 限定 X"
            : lane === "news"
              ? "ホビー 新作 限定 ニュース"
              : "抽選 応募 受付 会員 先着",
      origin: "lane-balance",
    });
  }

  addTask({
    kind: "query",
    topic: "映画特典",
    targetCategory: "movie_bonus",
    priority: "medium",
    query: "映画 入場者特典 来場者特典 週替わり 相場",
    origin: "movie-seed",
    reason: "映画特典カテゴリの先回り探索",
  });
  addTask({
    kind: "query",
    topic: "映画グッズ",
    targetCategory: "movie_goods",
    priority: "medium",
    query: "映画 劇場限定 グッズ パンフレット 相場",
    origin: "movie-seed",
    reason: "劇場限定グッズカテゴリの先回り探索",
  });

  const strongLearning = [...yearlyLearning]
    .sort((a, b) => Number(b.mentions ?? 0) - Number(a.mentions ?? 0))
    .slice(0, 12);
  for (const learning of strongLearning) {
    const product = (snapshot.normalizedProducts ?? []).find((item) => item.productKey === learning.key);
    if (!product) continue;
    if (product.brand) {
      addTask({
        kind: "brand_watch",
        brand: product.brand,
        targetCategory: product.category,
        priority: Number(learning.mentions ?? 0) >= 6 ? "high" : "medium",
        query: `${product.brand} 限定 抽選 再販 新作`,
        origin: "product-learning",
        reason: `${product.brand} 系列が過去1年で反復ヒット`,
      });
    }
    if (product.series) {
      addTask({
        kind: "series_watch",
        series: product.series,
        targetCategory: product.category,
        priority: "medium",
        query: `${product.series} 新作 抽選 再販 相場`,
        origin: "product-learning",
        reason: `${product.series} 系列の過去反復を監視`,
      });
    }
  }

  const notableProducts = (snapshot.normalizedProducts ?? [])
    .filter((product) => ["movie_bonus", "movie_goods", "pokemon", "kuji", "watch"].includes(product.category))
    .slice(0, 24);
  for (const product of notableProducts) {
    if (product.category === "movie_bonus" || product.category === "movie_goods") {
      addTask({
        kind: "event_watch",
        topic: product.canonicalName,
        targetCategory: product.category,
        priority: "high",
        query: `${product.canonicalName} 入場者特典 劇場限定 相場`,
        origin: "movie-category",
        reason: "映画特典・劇場限定を先回り監視",
      });
      continue;
    }
    if (product.category === "pokemon") {
      addTask({
        kind: "query",
        topic: product.canonicalName,
        targetCategory: "pokemon",
        priority: "high",
        query: `${product.canonicalName} 抽選 再販 招待 相場`,
        origin: "pokemon-watch",
        reason: "ポケカ弾の再抽選・再販を先回り監視",
      });
      continue;
    }
    if (product.category === "kuji") {
      addTask({
        kind: "query",
        topic: product.canonicalName,
        targetCategory: "kuji",
        priority: "medium",
        query: `${product.canonicalName} ラストワン A賞 相場`,
        origin: "kuji-watch",
        reason: "一番くじの主要賞相場を追う",
      });
      continue;
    }
  }

  const missingPriceCandidates = (snapshot.discoveryCandidates ?? [])
    .filter((candidate) => /相場価格|公式価格/.test(String(candidate.missingData ?? "")))
    .sort((a, b) => Number(b.genreScore ?? 0) - Number(a.genreScore ?? 0))
    .slice(0, 12);
  for (const candidate of missingPriceCandidates) {
    addTask({
      kind: "query",
      topic: candidate.name,
      targetCategory: candidate.category ?? "generic_hobby",
      priority: Number(candidate.genreScore ?? 0) >= 80 ? "high" : "medium",
      query:
        candidate.category === "pokemon_box"
          ? `${candidate.name} シュリンク 相場`
          : /一番くじ/.test(candidate.name)
            ? `${candidate.name} ラストワン 相場`
            : `${candidate.name} 相場 メルカリ`,
      origin: "missing-price",
      reason: "価格未充足の上位候補を補完",
    });
  }

  addTask({
    kind: "event_watch",
    topic: "映画特典",
    targetCategory: "movie_bonus",
    priority: "medium",
    query: "映画 入場者特典 来場者特典 週替わり",
    origin: "category-expansion",
    reason: "映画特典カテゴリを常時探索",
  });
  addTask({
    kind: "event_watch",
    topic: "映画グッズ",
    targetCategory: "movie_goods",
    priority: "medium",
    query: "劇場限定 グッズ 映画 パンフレット",
    origin: "category-expansion",
    reason: "劇場限定グッズを常時探索",
  });
  return tasks.slice(0, 48);
}

function productExplorationTasks(snapshot, product) {
  const nameKey = normalizeProductKey(product.canonicalName);
  return (snapshot.explorationTasks ?? [])
    .filter((task) => {
      const joined = `${task.query ?? ""} ${task.topic ?? ""} ${task.series ?? ""} ${task.brand ?? ""}`;
      return (
        normalizeSignalText(joined).includes(nameKey) ||
        (product.brand && joined.includes(product.brand)) ||
        (product.series && joined.includes(product.series)) ||
        task.targetCategory === product.category
      );
    })
    .slice(0, 4);
}

function movieLimitedContext(product) {
  if (product.category === "movie_bonus") return "入場者特典や週替わり配布で、短期間に需要が集中しやすい";
  if (product.category === "movie_goods") return "劇場限定や通販有無の差で、供給の偏りが出やすい";
  return "";
}

function buildAiThesisForProduct(product, snapshot, learningMap = new Map()) {
  const routes = (snapshot.routeSnapshots ?? []).filter((route) => route.productKey === product.productKey && route.status !== "ended");
  const events = (snapshot.productEvents ?? []).filter((event) => event.productKey === product.productKey);
  const reasons = (snapshot.selectionReasons ?? []).find((item) => item.productKey === product.productKey) ?? null;
  const comparables = (snapshot.historicalComparables ?? []).filter((item) => item.productKey === product.productKey).slice(0, 3);
  const learning = learningMap.get(product.productKey) ?? learningMap.get(normalizeSignalText(product.productKey)) ?? null;
  const tasks = productExplorationTasks(snapshot, product);

  const demandDrivers = new Set();
  const supplyConstraints = new Set();
  const riskFactors = new Set();
  const nextChecks = new Set();

  if (/周年|anniversary|記念/.test(`${product.canonicalName} ${reasons?.whyTopic ?? ""}`)) demandDrivers.add("周年記念");
  if (/限定|劇場限定|公式通販限定/.test(`${product.canonicalName} ${reasons?.whyTopic ?? ""}`)) demandDrivers.add("限定性");
  if (product.category === "movie_bonus") demandDrivers.add("映画特典");
  if (product.category === "movie_goods") demandDrivers.add("劇場限定グッズ");
  if (product.category === "kuji") demandDrivers.add("一番くじ上位賞");
  if (product.category === "pokemon") demandDrivers.add("再抽選・再販需要");
  if (learning?.mentions >= 4) demandDrivers.add("過去ヒット反復");
  if (/人気|キャラクター|主人公/.test(product.canonicalName)) demandDrivers.add("人気キャラクター");

  if (routes.length <= 1) supplyConstraints.add("導線が限定的");
  if (/再販未定|再入荷未定/.test(`${reasons?.whyRoute ?? ""} ${reasons?.whyTiming ?? ""}`)) supplyConstraints.add("再販未定");
  if (product.category === "movie_bonus") supplyConstraints.add("配布期間限定");
  if (product.category === "movie_goods") supplyConstraints.add("劇場限定");
  if (product.category === "kuji") supplyConstraints.add("賞構成次第で供給が偏る");
  if (product.sourceKinds?.some((kind) => /official/.test(kind))) supplyConstraints.add("公式導線ベース");

  if (!(snapshot.priceSnapshots ?? []).some((price) => price.productKey === product.productKey && price.buyLineEligible)) {
    riskFactors.add("実価格の裏取り前");
  }
  if (routes.length === 0) riskFactors.add("実ルート未確認");
  if (product.category === "movie_bonus") riskFactors.add("配布館・配布条件で取得難易度が変わる");
  if (product.category === "kuji") riskFactors.add("上位賞の相場次第で弾全体の強さがぶれやすい");
  if (product.category === "pokemon") riskFactors.add("再販量次第で相場が崩れやすい");

  for (const issue of [reasons?.holdReason, reasons?.whyRoute, reasons?.whyPrice]) {
    if (/価格/.test(issue ?? "")) nextChecks.add("成約価格確認");
    if (/導線|リンク|抽選/.test(issue ?? "")) nextChecks.add("公式導線確認");
    if (/日付|開始|終了|締切/.test(issue ?? "")) nextChecks.add("日程確認");
    if (/再販/.test(issue ?? "")) nextChecks.add("再販予定確認");
  }
  for (const task of tasks) {
    for (const evidence of task.expectedEvidence ?? []) nextChecks.add(evidence);
  }
  if (nextChecks.size === 0) nextChecks.add("販売状況確認");

  const whyHot = sanitizeClaimText(
    compactReasonText(
      reasons?.whyTopic ||
        movieLimitedContext(product) ||
        (product.category === "pokemon"
          ? `${product.canonicalName} は抽選・再販の動きが価格差に直結しやすい`
          : product.category === "kuji"
            ? `${product.canonicalName} は上位賞やラストワン次第で相場が跳ねやすい`
            : product.category === "watch"
              ? `${product.canonicalName} は型番・限定性で比較されやすい`
              : `${product.canonicalName} は限定性と需要の偏りを見たい候補です`),
      `${product.canonicalName} を継続監視中。`,
    ),
  );

  return {
    sourceMode: "heuristic",
    whyHot,
    confidence: clampNumber(0.48 + demandDrivers.size * 0.06 + supplyConstraints.size * 0.03 - riskFactors.size * 0.025, 0.35, 0.82),
    demandDrivers: [...demandDrivers].slice(0, 5),
    supplyConstraints: [...supplyConstraints].slice(0, 5),
    comparableMarkets: comparables.map((item) => ({ name: item.comparableKey, reason: item.basis ?? "過去類似商品として比較" })).slice(0, 3),
    riskFactors: [...riskFactors].slice(0, 5),
    nextChecks: [...nextChecks].slice(0, 6),
  };
}

function buildPriceThesisForProduct(product, snapshot) {
  const predicted = (snapshot.predictedPriceSnapshots ?? []).find(
    (item) => item.productKey === product.productKey && item.priceType === "predicted_market",
  );
  if (!predicted || !Number.isFinite(predicted.base)) return null;
  if (predicted.estimateQuality === "weak") return null;
  if ((predicted.basisCount ?? 0) < 2 && predicted.source !== "verified_market") return null;
  const comparables = (snapshot.historicalComparables ?? []).filter((item) => item.productKey === product.productKey).slice(0, 3);
  const basis = comparables.map((item) => `${item.comparableName ?? item.comparableKey} を比較対象に、${(item.basis ?? []).join("+") || "過去類似"}として参照`);
  if (basis.length === 0 && product.category === "movie_bonus") basis.push("配布条件が限定的で、映画特典の初動比較を優先");
  if (basis.length === 0 && product.category === "kuji") basis.push("同IPの一番くじ上位賞相場から弾全体の強さを仮置き");
  if (basis.length === 0 && product.category === "pokemon") basis.push("同弾・近弾のBOX相場と再販頻度を参照");
  return {
    sourceMode: "heuristic",
    estimatedMarketPrice: Math.round(predicted.base),
    confidence: clampNumber(Number(predicted.confidence ?? 0.62), 0, 1),
    basis: basis.slice(0, 4),
    priceSourceRank: "ai_estimate",
    notForBuyLineReason: "AI推定価格のため、実成約確認まではBuyLineに使いません。",
  };
}

function llmExtractionPriorityScore(extraction) {
  const mode = String(extraction?.mode ?? "heuristic");
  const products = Array.isArray(extraction?.products) ? extraction.products : [];
  const events = Array.isArray(extraction?.events) ? extraction.events : [];
  const prices = Array.isArray(extraction?.prices) ? extraction.prices : [];
  const concreteProducts = products
    .map((product) => canonicalizeProductName(product?.name ?? ""))
    .filter(productPhraseLooksSpecific)
    .filter((name) => !looksLikeSiteChromeProductName(name));
  const categoryBoost = products.some((product) => ["pokemon", "kuji", "movie_bonus", "movie_goods"].includes(product?.category)) ? 6 : 0;
  return (mode === "gemini" ? 20 : mode === "openai" ? 18 : 6) + concreteProducts.length * 4 + events.length * 2 + prices.length + categoryBoost;
}

function pruneLlmExtractions(extractions, limit = 20) {
  return [...(extractions ?? [])]
    .filter((extraction) => {
      const products = Array.isArray(extraction?.products) ? extraction.products : [];
      const events = Array.isArray(extraction?.events) ? extraction.events : [];
      const prices = Array.isArray(extraction?.prices) ? extraction.prices : [];
      const concreteProducts = products
        .map((product) => canonicalizeProductName(product?.name ?? ""))
        .filter(productPhraseLooksSpecific)
        .filter((name) => !looksLikeSiteChromeProductName(name));
      const hasRelevantCategory = products.some((product) => ["pokemon", "kuji", "movie_bonus", "movie_goods"].includes(product?.category));
      return concreteProducts.length > 0 || hasRelevantCategory || events.length > 0 || prices.length > 0;
    })
    .sort((a, b) => llmExtractionPriorityScore(b) - llmExtractionPriorityScore(a))
    .slice(0, limit);
}

function enrichNormalizedProductsWithAi(snapshot, learningMap = new Map()) {
  return (snapshot.normalizedProducts ?? []).map((product) => ({
    ...product,
    aiThesis: product.aiThesis?.whyHot
      ? {
          ...product.aiThesis,
          sourceMode: product.aiThesis.sourceMode || "heuristic",
        }
      : buildAiThesisForProduct(product, snapshot, learningMap),
    priceThesis: product.priceThesis?.estimatedMarketPrice
      ? {
          ...product.priceThesis,
          sourceMode: product.priceThesis.sourceMode || "heuristic",
        }
      : buildPriceThesisForProduct(product, snapshot),
    explorationTasks: productExplorationTasks(snapshot, product),
  }));
}

function deriveCandidateStatusReasons(candidate, aiThesis = null) {
  const reasons = [];
  const insufficiencyReasons = Array.isArray(candidate?.insufficiencyReasons) ? candidate.insufficiencyReasons : [];
  if (insufficiencyReasons.includes("missingPeriod")) reasons.push("date_missing");
  if (insufficiencyReasons.includes("missingRetailPrice")) reasons.push("price_missing");
  if (insufficiencyReasons.includes("missingMarketPrice")) reasons.push("market_missing", "price_missing");
  if (insufficiencyReasons.includes("missingRoute")) reasons.push("route_missing");
  if (insufficiencyReasons.some((reason) => ["genericRoute", "deadRoute"].includes(reason))) reasons.push("route_unverified");
  if (insufficiencyReasons.includes("ended")) reasons.push("ended");
  if (
    aiThesis &&
    !Number.isFinite(candidate?.marketPrice) &&
    !candidateRouteTargetUrl(candidate)
  ) {
    reasons.push("ai_only_thesis");
  }
  return [...new Set(reasons)];
}

function candidateGeminiEligibility(candidate, product = null, statusReasons = []) {
  const category = product?.category || candidate?.category || "";
  if (category === "movie_bonus" || category === "movie_goods") return { eligible: true, reason: `${category}_candidate` };
  if (category === "kuji" || /一番くじ|ラストワン|A賞/.test(candidate?.name ?? "")) return { eligible: true, reason: "kuji_candidate" };
  if (category === "pokemon" || /ポケカ|ポケモンカード|抽選|再販/.test(`${candidate?.name ?? ""} ${candidate?.reason ?? ""}`)) {
    return { eligible: true, reason: "pokemon_candidate" };
  }
  if (statusReasons.includes("price_missing") && Number(candidate?.genreScore ?? 0) >= 70) {
    return { eligible: true, reason: "price_missing_candidate" };
  }
  if (statusReasons.includes("route_unverified") && Number(candidate?.genreScore ?? 0) >= 70) {
    return { eligible: true, reason: "generic_route_candidate" };
  }
  return { eligible: false, reason: "not_eligible_for_gemini" };
}

function enrichCandidatesWithAi(snapshot) {
  return (snapshot.discoveryCandidates ?? []).map((candidate) => {
    const product = (snapshot.normalizedProducts ?? []).find((item) => item.productKey === normalizeProductKey(candidate.name)) ?? null;
    const aiThesis = product?.aiThesis ?? null;
    const priceThesis = product?.priceThesis ?? null;
    const explorationTasks = product?.explorationTasks ?? [];
    const state = deriveCandidateState(candidate);
    const candidateState = state.candidateState;
    const insufficiencyReasons = Array.isArray(candidate.insufficiencyReasons) && candidate.insufficiencyReasons.length > 0
      ? candidate.insufficiencyReasons
      : state.insufficiencyReasons;
    const statusReasons = deriveCandidateStatusReasons({ ...candidate, candidateState, insufficiencyReasons }, aiThesis);
    const geminiEligibility = candidateGeminiEligibility(candidate, product, statusReasons);
    return {
      ...candidate,
      aiThesis,
      priceThesis,
      explorationTasks,
      candidateState,
      candidateStatus: candidateState,
      status: candidateState,
      insufficiencyReasons,
      statusReasons,
      geminiEligible: geminiEligibility.eligible,
      geminiEligibilityReason: geminiEligibility.reason,
    };
  });
}

function deriveProductEvents(snapshot) {
  const events = [];
  for (const release of snapshot.pokemonReleases ?? []) {
    if (!productPhraseLooksSpecific(release.name)) continue;
    events.push({
      id: `event:release:${normalizeSignalText(release.name)}`,
      productKey: normalizeProductKey(release.name),
      productName: release.name,
      eventType: "release",
      lane: "official",
      startDate: release.saleStartDate ?? release.releaseDate ?? null,
      endDate: release.saleEndDate ?? null,
      sourceKey: sourceKeyForLaneUrl("official", release.sourceUrl ?? ""),
      sourceUrl: release.sourceUrl ?? "",
      confidence: sourceConfidenceFromUrl(release.sourceUrl ?? "", "official"),
      evidenceDocIds: [],
      dateConfidence: inferDateConfidence({
        lane: "official",
        sourceUrl: release.sourceUrl ?? "",
        startDate: release.saleStartDate ?? release.releaseDate ?? null,
        endDate: release.saleEndDate ?? null,
      }),
    });
    for (const route of release.routes ?? []) {
      const eventType = inferRouteType(route, "lottery") === "resale" ? "resale_open" : inferRouteType(route, "lottery") === "invite" ? "invite_open" : "lottery_open";
      events.push({
        id: `event:lottery:${normalizeSignalText(`${release.name}:${route.name}:${route.applyUrl || route.url}`)}`,
        productKey: normalizeProductKey(release.name),
        productName: release.name,
        eventType,
        lane: "lottery",
        startDate: String(route.startDate ?? "").slice(0, 10) || null,
        endDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
        sourceKey: sourceKeyForLaneUrl("lottery", route.applyUrl || route.url || route.sourceUrl || release.sourceUrl || ""),
        sourceUrl: route.applyUrl || route.url || "",
        confidence: route?.verification?.kind === "verified" ? "high" : "medium",
        evidenceDocIds: [],
        dateConfidence: inferDateConfidence({
          lane: "lottery",
          sourceUrl: route.applyUrl || route.url || route.sourceUrl || "",
          startDate: String(route.startDate ?? "").slice(0, 10) || null,
          endDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
          rolling: /随時|常時|再販/.test([route.name, route.note, route.condition].join(" ")),
        }),
      });
      if (String(route.deadlineDate ?? "").slice(0, 10)) {
        events.push({
          id: `event:lottery-close:${normalizeSignalText(`${release.name}:${route.name}:${route.applyUrl || route.url}`)}`,
          productKey: normalizeProductKey(release.name),
          productName: release.name,
          eventType: "lottery_close",
          lane: "lottery",
          startDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
          endDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
          sourceKey: sourceKeyForLaneUrl("lottery", route.applyUrl || route.url || route.sourceUrl || release.sourceUrl || ""),
          sourceUrl: route.applyUrl || route.url || "",
          confidence: route?.verification?.kind === "verified" ? "high" : "medium",
          evidenceDocIds: [],
          dateConfidence: inferDateConfidence({
            lane: "lottery",
            sourceUrl: route.applyUrl || route.url || route.sourceUrl || "",
            startDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
            endDate: String(route.deadlineDate ?? "").slice(0, 10) || null,
          }),
        });
      }
    }
  }
  for (const deal of snapshot.deals ?? []) {
    if (!productPhraseLooksSpecific(deal.name)) continue;
    events.push({
      id: `event:sale-open:${normalizeSignalText(`${deal.name}:${deal.releaseUrl || deal.sourceUrl || deal.shop}`)}`,
      productKey: normalizeProductKey(deal.name),
      productName: deal.name,
      eventType: "sale_open",
      lane: "official",
      startDate: deal.saleStartDate ?? null,
      endDate: deal.saleEndDate ?? null,
      sourceKey: sourceKeyForLaneUrl("official", deal.releaseUrl || deal.sourceUrl || ""),
      sourceUrl: deal.releaseUrl || deal.sourceUrl || "",
      confidence: deal.confidence === "高" ? "high" : "medium",
      evidenceDocIds: [],
      dateConfidence: inferDateConfidence({
        lane: "official",
        sourceUrl: deal.releaseUrl || deal.sourceUrl || "",
        startDate: deal.saleStartDate ?? null,
        endDate: deal.saleEndDate ?? null,
      }),
    });
    if (deal.saleEndDate) {
      events.push({
        id: `event:sale-close:${normalizeSignalText(`${deal.name}:${deal.releaseUrl || deal.sourceUrl || deal.shop}`)}`,
        productKey: normalizeProductKey(deal.name),
        productName: deal.name,
        eventType: "sale_close",
        lane: "official",
        startDate: deal.saleEndDate,
        endDate: deal.saleEndDate,
        sourceKey: sourceKeyForLaneUrl("official", deal.releaseUrl || deal.sourceUrl || ""),
        sourceUrl: deal.releaseUrl || deal.sourceUrl || "",
        confidence: deal.confidence === "高" ? "high" : "medium",
        evidenceDocIds: [],
        dateConfidence: inferDateConfidence({
          lane: "official",
          sourceUrl: deal.releaseUrl || deal.sourceUrl || "",
          startDate: deal.saleEndDate,
          endDate: deal.saleEndDate,
        }),
      });
    }
  }
  for (const candidate of snapshot.discoveryCandidates ?? []) {
    if (!productPhraseLooksSpecific(candidate.name)) continue;
    const routeType =
      candidate.sourceChannel === "lottery"
        ? "lottery_open"
        : /再販|再入荷|入荷/.test(candidate.reason ?? "")
          ? "restock_signal"
          : candidate.category === "movie_bonus" || candidate.category === "movie_goods"
            ? "release"
            : "trend_signal";
    events.push({
      id: `event:candidate:${normalizeSignalText(candidate.name)}`,
      productKey: normalizeProductKey(candidate.name),
      productName: candidate.name,
      eventType:
        candidate.category === "pokemon_box" && routeType === "lottery_open"
          ? "lottery_open"
          : candidate.category === "pokemon_box"
            ? "restock_signal"
            : routeType,
      lane: candidate.sourceChannel ?? "official",
      startDate: candidate.startDate ?? null,
      endDate: candidate.endDate ?? null,
      sourceUrl: candidate.sourceUrl ?? "",
      sourceKey: sourceKeyForLaneUrl(candidate.sourceChannel ?? "official", candidate.sourceUrl ?? ""),
      confidence: candidate.sourceReliability === "high" || candidate.confidence === "高" ? "high" : "medium",
      evidenceDocIds: [],
      dateConfidence: inferDateConfidence({
        lane: candidate.sourceChannel ?? "official",
        sourceUrl: candidate.sourceUrl ?? "",
        startDate: candidate.startDate ?? null,
        endDate: candidate.endDate ?? null,
      }),
    });
  }
  for (const special of snapshot.kujiSpecials ?? []) {
    if (!productPhraseLooksSpecific(special.title)) continue;
    events.push({
      id: `event:kuji-release:${normalizeSignalText(special.title)}`,
      productKey: normalizeProductKey(special.title),
      productName: special.title,
      eventType: "release",
      lane: "official",
      startDate: special.releaseDate ?? null,
      endDate: special.displayUntil ?? null,
      sourceKey: sourceKeyForLaneUrl("official", special.sourceUrl ?? ""),
      sourceUrl: special.sourceUrl ?? "",
      confidence: "medium",
      evidenceDocIds: [],
      dateConfidence: inferDateConfidence({
        lane: "official",
        sourceUrl: special.sourceUrl ?? "",
        startDate: special.releaseDate ?? null,
        endDate: special.displayUntil ?? null,
      }),
    });
  }
  for (const trend of snapshot.trends ?? []) {
    if (!productPhraseLooksSpecific(trend.keyword)) continue;
    events.push({
      id: `event:trend:${normalizeSignalText(`${trend.keyword}:${trend.startDate}`)}`,
      productKey: normalizeProductKey(trend.keyword),
      productName: trend.keyword,
      eventType: "trend_signal",
      lane: detectSourceChannel({ lane: trend.type === "SNS抽出" ? "sns" : trend.type === "ブログ抽出" ? "blog" : "official" }),
      startDate: trend.startDate ?? null,
      endDate: trend.endDate ?? null,
      sourceUrl: "",
      sourceKey: "",
      confidence: trend.confidence === "高" ? "high" : "medium",
      evidenceDocIds: [],
      dateConfidence: inferDateConfidence({
        lane: trend.type === "SNS抽出" ? "sns" : trend.type === "ブログ抽出" ? "blog" : "official",
        sourceUrl: "",
        startDate: trend.startDate ?? null,
        endDate: trend.endDate ?? null,
      }),
    });
  }
  for (const extraction of snapshot.llmExtractions ?? []) {
    const sourceLaneHint = String(extraction.sourceKey ?? "").split(":")[0];
    for (const event of extraction.events ?? []) {
      if (!productPhraseLooksSpecific(event.productName)) continue;
      const lane =
        ["official", "lottery", "blog", "sns", "news", "market"].includes(sourceLaneHint)
          ? sourceLaneHint
          : event.routeType === "lottery" || event.routeType === "invite" || event.routeType === "resale"
            ? "lottery"
            : "official";
      const sourceUrl = event.applyUrl || event.sourceUrl || "";
      events.push({
        id: `event:llm:${normalizeSignalText(`${event.productName}:${event.eventType}:${event.startDate}:${sourceUrl}`)}`,
        productKey: normalizeProductKey(event.productName),
        productName: event.productName,
        eventType: inferStructuredEventType(event.eventType, event.productName),
        lane,
        startDate: safeIsoDate(event.startDate),
        endDate: safeIsoDate(event.endDate),
        sourceUrl,
        sourceKey: extraction.sourceKey || sourceKeyForLaneUrl(lane, sourceUrl),
        confidence: confidenceToLabel(Number(extraction.confidence ?? 0.65)) === "高" ? "high" : "medium",
        evidenceDocIds: extraction.docId ? [extraction.docId] : [],
        dateConfidence:
          ["official_exact", "official_inferred", "article_exact", "article_inferred", "rolling"].includes(event.dateConfidence)
            ? event.dateConfidence
            : inferDateConfidence({
                lane,
                sourceUrl,
                startDate: safeIsoDate(event.startDate),
                endDate: safeIsoDate(event.endDate),
              }),
      });
    }
  }
  return Array.from(new Map(events.map((event) => [event.id, event])).values()).filter(
    (event) => event.productKey && event.productName,
  );
}

async function readJsonFile(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function parseYen(value) {
  if (!value) return null;
  const amount = value.replace(/[^\d]/g, "");
  return amount ? Number(amount) : null;
}

function formatYen(value) {
  if (!Number.isFinite(value)) return null;
  return `¥${Number(value).toLocaleString("ja-JP")}`;
}

function toIsoDateFromJapanese(value) {
  if (!value) return null;
  const japanese = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (japanese) {
    const [, year, month, day] = japanese;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const dotted = value.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dotted) {
    const [, year, month, day] = dotted;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}

function addDaysToIsoDate(value, days) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function extractFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractNumericPrices(text) {
  const matches = [];
  const pattern = /(?:¥|￥)\s*([0-9][0-9,]{2,})|([0-9][0-9,]{2,})\s*円/g;
  let match;
  while ((match = pattern.exec(text))) {
    const raw = match[1] || match[2];
    const value = parseYen(raw);
    if (!Number.isFinite(value)) continue;
    matches.push({ value, index: match.index });
  }
  return matches;
}

function extractRetailPrice(text, candidateName = "", explicitPrice = null) {
  if (Number.isFinite(explicitPrice)) return explicitPrice;

  const direct = extractFirst(text, [
    /(?:税込価格|税込)\s*[：: ]\s*[¥￥]?\s*([0-9,]{3,})\s*円?/i,
    /(?:販売価格|価格|定価)\s*[：: ]\s*[¥￥]?\s*([0-9,]{3,})\s*円?/i,
    /[¥￥]\s*([0-9,]{3,})\s*\((?:税込|税抜)\)/i,
  ]);
  const directValue = parseYen(direct);
  if (Number.isFinite(directValue)) return directValue;

  const prices = extractNumericPrices(text).filter((item) => item.value >= 500 && item.value <= 200000);
  if (prices.length === 0) return null;

  if (candidateName) {
    const markers = candidateName
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
      .slice(0, 4);
    for (const marker of markers) {
      const at = text.indexOf(marker);
      if (at === -1) continue;
      const nearby = prices
        .map((item) => ({ ...item, distance: Math.abs(item.index - at) }))
        .filter((item) => item.distance <= 180)
        .sort((a, b) => a.distance - b.distance || a.value - b.value);
      if (nearby[0]) return nearby[0].value;
    }
  }

  return prices.sort((a, b) => a.value - b.value)[0]?.value ?? null;
}

function inferCandidateCategory(candidate, signals = []) {
  const text = [candidate?.name, candidate?.trend, candidate?.marginSignal, ...signals].join(" ").toLowerCase();
  if (/box|ボックス|拡張パック|ハイクラスパック|ポケカbox|未開封box/.test(text)) return "pokemon_box";
  if (/入場者特典|来場者特典|前売券|ムビチケ|パンフレット/.test(text)) return "thin";
  if (/劇場限定|映画グッズ/.test(text)) return "unknown";
  if (/時計|watch|g-shock|garrack/.test(text)) return "large";
  if (/プレイマット/.test(text)) return "large";
  if (/シールド|スリーブ|キーホルダー|メタリックモンスターズ/.test(text)) return "thin";
  return "unknown";
}

function canUseRetailExtraction(source, candidate, signals, url) {
  const text = [source?.trend?.type, source?.trend?.context, candidate?.name, candidate?.trend, ...signals].join(" ").toLowerCase();
  if (/sns監視|ブログ監視|品薄|完売|ウォッチ|監視/.test(text)) return false;
  try {
    const host = new URL(url || source?.url || candidate?.sourceUrl || "").hostname.toLowerCase();
    if (
      host.includes("pokemon-card.com") ||
      host.includes("pokemoncenter-online.com") ||
      host.includes("one-piece.com") ||
      host.includes("square-enix.com") ||
      host.includes("p-bandai.jp") ||
      host.includes("gshock.casio.com")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return /公式ニュース|公式グッズ|限定時計|サプライ|価格差|公式/.test(text);
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseList(value) {
  return value
    ? value
        .split(/[|、]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function normalizeCategory(category) {
  if (["pokemon_box", "thin", "large", "unknown"].includes(category)) return category;
  if (category?.includes("4cm以下")) return "thin";
  if (category?.includes("4cm超")) return "large";
  if (category?.includes("ポケカ")) return "pokemon_box";
  return "unknown";
}

function toDeal(row) {
  const buyPrice = Number(row.buyPrice);
  const sellPrice = Number(row.sellPrice);
  if (!row.name || !row.shop || !Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) return null;

  return {
    id: row.id || `${row.name}-${row.shop}`.toLowerCase().replace(/\s+/g, "-"),
    name: row.name,
    shop: row.shop,
    buyPrice,
    sellPrice,
    category: normalizeCategory(row.category),
    sourceType: row.sourceType || "manual",
    saleStartDate: row.saleStartDate || new Date().toISOString().slice(0, 10),
    saleEndDate: row.saleEndDate || null,
    priceSignal: row.priceSignal || "gap",
    velocity: row.velocity || "普通",
    risk: row.risk || "中",
    tags: parseList(row.tags),
    reason: row.reason || "CSV投入候補。価格・送料・状態を確認して判断。",
    confidence: row.confidence || "中",
    evidence: parseList(row.evidence),
    releaseUrl: row.releaseUrl || row.sourceUrl || "",
    marketUrl: row.marketUrl || "",
    sourceUrl: row.releaseUrl || row.sourceUrl || "",
  };
}

async function loadDealCandidates() {
  try {
    const csv = await readFile(dealInputUrl, "utf8");
    return parseCsv(csv).map(toDeal).filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function parseSnkrdunkPokemonRelease(source, result) {
  const release = clone(source.release ?? {});
  if (!result.ok || !result.keywordFound) {
    return {
      ...release,
      sourceUrl: release.sourceUrl || source.url,
      parser: "snkrdunkPokemonRelease",
      parserStatus: "fallback",
    };
  }

  const text = result.text ?? "";
  const marketLabel = extractFirst(text, [/一般相場\s*([0-9,]+円〜?)/]);
  const retailLabel = extractFirst(text, [/定価\s*¥?([0-9,]+)\s*\(?税込?\)?/]);
  const releaseDateText = extractFirst(text, [/発売日\s*((?:\d{4}年)?\d{1,2}月\d{1,2}日(?:\([^)]*\))?|\d{4}\.\d{1,2}\.\d{1,2})/]);
  const updatedText = extractFirst(text, [/(\d{4}年\d{1,2}月\d{1,2}日)\s*更新/]);
  const parsedReleaseDate = toIsoDateFromJapanese(releaseDateText);
  const parsedUpdatedDate = toIsoDateFromJapanese(updatedText);
  const marketPrice = parseYen(marketLabel);
  const retailPrice = parseYen(retailLabel);

  return {
    ...release,
    sourceUrl: result.url || release.sourceUrl || source.url,
    marketPrice: marketPrice ?? release.marketPrice ?? null,
    marketLabel: marketLabel ? `一般相場 ${marketLabel}` : release.marketLabel ?? "BOX相場取得待ち",
    marketUpdated: parsedUpdatedDate ?? result.fetchedAt.slice(0, 10),
    retailPrice: retailPrice ?? release.retailPrice,
    releaseDate: parsedReleaseDate ?? release.releaseDate,
    saleStartDate: release.saleStartDate ?? parsedReleaseDate,
    note:
      marketPrice && release.retailPrice
        ? `${source.keyword}のスニダン相場を取得。抽選/再販ルートを優先監視。`
        : release.note,
    parser: "snkrdunkPokemonRelease",
  };
}

function cleanNewsTitle(title) {
  return (title ?? "").split("|")[0].replace(/\s+/g, " ").trim();
}

function isSearchLikeUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (host.includes("x.com") || host.includes("twitter.com")) {
      return path === "/search" || query.includes("q=");
    }
    return path.includes("/search") || query.includes("search");
  } catch {
    return true;
  }
}

function officialSourceConfidence(source, result) {
  const url = result?.url || source?.url || "";
  if (!result?.ok || !result?.keywordFound) return "低";
  if (isSearchLikeUrl(url)) return "中";
  return "高";
}

function detectOfficialSignals(text, context = {}) {
  const signalRules = [
    ["周年", /周年/],
    ["特設ページ", /特設ページ/],
    ["公式グッズ", /公式グッズ|グッズ/],
    ["コラボ", /コラボ|キャンペーン/],
    ["記念コンテンツ", /記念コンテンツ|記念/],
    ["発売予定", /発売|予約|販売/],
    ["可愛い系", /ちいかわ|すみっコ|サンリオ|カービィ|マスコット|ぬいぐるみ|キーホルダー|かわいい|可愛い/i],
  ];
  const signals = signalRules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const xLabel = resolveXSignalLabel({
    text,
    url: context.url ?? "",
    channel: context.channel ?? "",
    socialSignals: context.socialSignals ?? [],
    engagement: context.engagement ?? null,
  });
  if (xLabel) signals.push(xLabel);
  return [...new Set(signals)];
}

function calculateOfficialScore(source, result, signals, text = "") {
  if (!result.ok || !result.keywordFound) return Math.min(source.trend?.score ?? 50, 50);
  const base = source.trend?.score ?? 62;
  const bonus = Math.min(9, signals.length * 2);
  const searchPenalty = isSearchLikeUrl(result.url || source.url) ? 8 : 0;
  const socialText = [source?.trend?.type, source?.trend?.context, source?.candidate?.reason, text].join(" ");
  const xBuzzBoost = hasObservedXEvidence({
    text: socialText,
    url: result?.url || source?.url || "",
    socialSignals: source?.socialSignals ?? [],
  })
    ? 6
    : 0;
  const cuteMascotBoost = /ちいかわ|すみっコ|サンリオ|カービィ|マスコット|ぬいぐるみ|キーホルダー|かわいい|可愛い/i.test(socialText)
    ? 5
    : 0;
  return Math.min(98, Math.max(45, base + bonus + xBuzzBoost + cuteMascotBoost - searchPenalty));
}

function inferMonitoringEndDate(source, newsDate, signals) {
  const explicitTrendEnd = source?.trend?.endDate ?? null;
  const explicitCandidateEnd = source?.candidate?.endDate ?? null;
  const explicitEnd = explicitTrendEnd || explicitCandidateEnd;
  if (explicitEnd) return explicitEnd;

  const typeText = [source?.trend?.type, source?.trend?.context, source?.candidate?.stage].filter(Boolean).join(" ");
  if (/ブログ監視|SNS監視/.test(typeText)) return addDaysToIsoDate(newsDate, 14);
  if (signals.some((signal) => /発売予定|特設ページ|コラボ/.test(signal))) return addDaysToIsoDate(newsDate, 30);
  return addDaysToIsoDate(newsDate, 21);
}

function parseOfficialTrendCandidate(source, result) {
  const trend = clone(source.trend ?? {});
  const candidate = clone(source.candidate ?? {});
  const text = `${result.title ?? ""} ${result.text ?? ""}`;
  const newsTitle = cleanNewsTitle(result.title) || source.keyword;
  const shortNewsTitle = newsTitle.length > 56 ? `${newsTitle.slice(0, 56)}...` : newsTitle;
  const newsDate =
    toIsoDateFromJapanese(extractFirst(text, [/(\d{4}年\d{1,2}月\d{1,2}日)/])) ?? result.fetchedAt.slice(0, 10);
  const signals = detectOfficialSignals(text, {
    url: result.url || candidate.sourceUrl || source.url,
    channel: source?.trend?.type ?? source?.candidate?.stage ?? "",
    socialSignals: [],
  });
  const signalText = signals.length > 0 ? signals.join(" / ") : trend.context ?? "公式ニュース";
  const score = calculateOfficialScore(source, result, signals, text);
  const confidence = officialSourceConfidence(source, result);
  const endDate = inferMonitoringEndDate(source, newsDate, signals);
  const retailPrice = canUseRetailExtraction(source, candidate, signals, result.url)
    ? extractRetailPrice(text, candidate.name ?? source.keyword, candidate.retailPrice ?? null)
    : candidate.retailPrice ?? null;
  const category = candidate.category ?? inferCandidateCategory(candidate, signals);
  const nextMissing = parseList(candidate.missingData).filter((item) => {
    if (Number.isFinite(retailPrice) && /定価|価格データ/.test(item)) return false;
    return true;
  });

  return {
    trend: {
      ...trend,
      keyword: trend.keyword ?? source.keyword,
      context: signalText,
      score,
      type: trend.type ?? "公式ニュース",
      change24h: `公式 ${newsDate.slice(5).replace("-", "/")}`,
      source: "公式",
      confidence,
      startDate: trend.startDate ?? newsDate,
      endDate: trend.endDate ?? endDate,
      action: result.keywordFound
        ? `公式ニュース確認: ${candidate.name ?? source.keyword}の発売/予約導線を確認`
        : "公式ページを再取得して内容を確認",
    },
    candidate: {
      ...candidate,
      name: candidate.name ?? source.keyword,
      trend: trend.keyword ?? source.keyword,
      stage: candidate.stage ?? "追加候補",
      stageKind: candidate.stageKind ?? "candidate",
      genreScore: Math.max(candidate.genreScore ?? score, score),
      reason: result.keywordFound
        ? `${shortNewsTitle}を確認。${signalText}を検知。${isSearchLikeUrl(result.url || source.url) ? "検索系URLのため精度は中扱いで保留。" : "固定URLのため精度高で追跡。"}`
        : `${source.keyword}の公式ページ確認に失敗。次回取得まで追加候補止まり。`,
      confidence: result.keywordFound ? (candidate.confidence === "低" ? "低" : confidence) : "低",
      startDate: candidate.startDate ?? newsDate,
      endDate: candidate.endDate ?? endDate,
      retailPrice: Number.isFinite(retailPrice) ? retailPrice : candidate.retailPrice ?? null,
      retailPriceLabel: Number.isFinite(retailPrice)
        ? `公式価格 ${formatYen(retailPrice)}`
        : candidate.retailPriceLabel ?? null,
      category,
      adoptionReason: result.keywordFound
        ? `公式ニュースで${signals.slice(0, 3).join(" / ") || "関連情報"}を確認${Number.isFinite(retailPrice) ? ` / 価格 ${formatYen(retailPrice)}` : ""}。`
        : "公式ニュースの内容確認が未完了。",
      missingData: result.keywordFound
        ? nextMissing.join("、") || "発売後の成約価格、取引量、送料サイズ"
        : "公式ページ確認、価格データ、取引量",
      sourceUrl: result.url || candidate.sourceUrl || source.url,
    },
    newsTitle,
    newsDate,
    signals,
  };
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceFetchTimeoutMs);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "MarketLens/0.1 personal research collector",
      },
    });
    const html = await response.text();
    const text = stripHtml(html);
    return {
      id: source.id,
      ok: response.ok,
      status: response.status,
      url: response.url,
      html,
      title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "",
      text,
      keywordFound: source.keyword ? text.includes(source.keyword) : true,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id: source.id,
      ok: false,
      status: "fetch-error",
      url: source.url,
      title: "",
      keywordFound: false,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function makeSearchUrl(base, query) {
  return `${base}${encodeURIComponent(query)}`;
}

function makeMercariSoldLikeUrls(query) {
  return [
    makeSearchUrl("https://jp.mercari.com/search?keyword=", query),
    makeSearchUrl("https://jp.mercari.com/search?keyword=", `${query} 売り切れ`),
    makeSearchUrl("https://jp.mercari.com/search?keyword=", `${query} 成約`),
  ];
}

function extractCandidateProductLinksFromSearchHtml(html, baseUrl) {
  if (!html) return [];
  const links = extractLinksFromHtml(html, baseUrl);
  const scored = links
    .map((item) => {
      const url = String(item.url ?? "");
      let score = 0;
      if (/jp\.mercari\.com\/item\/m/i.test(url)) score += 6;
      if (/snkrdunk\.com\/products\//i.test(url)) score += 6;
      if (/sold|売り切れ|成約/.test((item.anchorText ?? "").toLowerCase())) score += 3;
      if (/search|keyword|articles/.test(url)) score -= 4;
      return { url, score };
    })
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((item) => item.url))].slice(0, 2);
}

function candidateMarketQueries(candidate) {
  const name = candidate?.name ?? "";
  const queries = [];
  if (/GARRACK|スマートウォッチ|ONE PIECE/i.test(name)) {
    queries.push(`${name} スニダン`, `${name} メルカリ`, "GARRACK ONE PIECE スマートウォッチ");
  } else if (/ポケモンカードゲーム.*(シールド|プレイマット|サプライ)/i.test(name)) {
    queries.push(`${name} スニダン`, `${name} メルカリ`, "ポケモンカード プレイマット メルカリ");
  } else if (/G-SHOCK|GA-2100|Coca-Cola/i.test(name)) {
    queries.push(`${name} スニダン`, `${name} メルカリ`, "GA-2100CC-3AJR メルカリ");
  } else if (/一番くじ|ラストワン|MASTERLISE|SOFVICS|BUSTISAN/i.test(name)) {
    queries.push(`${name} メルカリ`, `${name} ラストワン メルカリ`, `${name} 相場`);
  } else if (/ドラゴンクエスト|ドラクエ|メタリックモンスターズ|ロト|スライム|はぐれメタル|ゴーレム/i.test(name)) {
    queries.push(`${name} メルカリ`, `${name} スクエニ`, `${name} 相場`);
  } else if (/S\.H\.Figuarts|METAL BUILD|ROBOT魂|超合金|ねんどろいど|figma|Portrait\.Of\.Pirates|P\.O\.P|プレミアムバンダイ/i.test(name)) {
    queries.push(`${name} メルカリ`, `${name} プレバン`, `${name} 相場`);
  } else if (/ちいかわ|サンリオ|すみっコぐらし|カービィ|たまごっち|お文具|マスコット|ぬいぐるみ|キーホルダー/i.test(name)) {
    queries.push(`${name} メルカリ`, `${name} 完売`, `${name} 相場`);
  }
  return [...new Set(queries)];
}

function extractMarketPriceFromText(text, candidateName, sourceUrl = "") {
  const baseName = String(candidateName ?? "").toLowerCase();
  const nameTokens = baseName
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 8);
  const compact = String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/,/g, ",");
  const windows = compact
    .split(/[。！？\n\r]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5000);

  const scored = [];
  let matchedLineCount = 0;
  let totalPriceLineCount = 0;
  for (const line of windows) {
    const lower = line.toLowerCase();
    const hasMarketSignal = /相場|取引|落札|成約|販売中|出品|snkrdunk|mercari|メルカリ|スニダン/.test(lower);
    const hasSoldSignal = /売り切れ|sold|成約|取引済み|落札/.test(lower);
    const hasNoise = /定価|希望小売|手数料|送料|クーポン|ポイント|割引|off|％|レビュー/.test(lower);
    const tokenHits = nameTokens.filter((token) => lower.includes(token)).length;
    const nameHit =
      (baseName && baseName.length >= 3 && lower.includes(baseName.slice(0, Math.min(baseName.length, 12)))) || tokenHits >= 2;
    const values = extractNumericPrices(line).map((item) => item.value).filter((v) => v >= 500 && v <= 300000);
    if (values.length === 0) continue;
    totalPriceLineCount += 1;
    if (tokenHits >= 2 || nameHit) matchedLineCount += 1;
    for (const value of values) {
      let weight = 1;
      if (hasMarketSignal) weight += 2;
      if (hasSoldSignal) weight += 3;
      if (/mercari/.test(sourceUrl) && hasSoldSignal) weight += 2;
      if (nameHit) weight += 2;
      if (tokenHits >= 3) weight += 1;
      if (hasNoise) weight -= 2;
      if (tokenHits === 0 && !hasMarketSignal) weight -= 2;
      if (weight <= 0) continue;
      scored.push({ value, weight, sold: hasSoldSignal });
    }
  }

  if (scored.length === 0) return null;
  const expanded = [];
  for (const row of scored) {
    for (let i = 0; i < row.weight; i += 1) expanded.push(row.value);
  }
  expanded.sort((a, b) => a - b);
  const q1 = expanded[Math.floor(expanded.length * 0.25)];
  const q3 = expanded[Math.floor(expanded.length * 0.75)];
  const iqr = Math.max(1000, q3 - q1);
  const lowerBound = Math.max(500, q1 - iqr * 1.5);
  const upperBound = Math.min(300000, q3 + iqr * 1.5);
  const filtered = expanded.filter((v) => v >= lowerBound && v <= upperBound);
  if (filtered.length === 0) return null;
  const median = filtered[Math.floor(filtered.length / 2)];
  const tokenSupport = totalPriceLineCount > 0 ? matchedLineCount / totalPriceLineCount : 0;
  return {
    marketPrice: median,
    marketPriceLabel: `${candidateName} 相場 ${median.toLocaleString("ja-JP")}円`,
    tokenSupport,
    soldSupport: scored.filter((item) => item.sold).length / Math.max(1, scored.length),
  };
}

async function collectSpecializedCandidateMarkets(candidates) {
  const results = new Map();
  const marketTargets = candidates
    .filter((candidate) => candidateMarketQueries(candidate).length > 0)
    .sort((a, b) => (b.genreScore ?? 0) - (a.genreScore ?? 0))
    .slice(0, 16);
  for (const candidate of marketTargets) {
    const queries = candidateMarketQueries(candidate);
    const pageBuckets = [];
    for (const query of queries.slice(0, 2)) {
      const urls = [makeSearchUrl("https://snkrdunk.com/search?keyword=", query), ...makeMercariSoldLikeUrls(query)];
      for (const url of urls) {
        const result = await fetchSource({ id: `market:${candidate.name}:${url}`, url });
        if (result.ok && result.text) {
          pageBuckets.push({ url, text: result.text, fetchedAt: result.fetchedAt });
          const detailLinks = extractCandidateProductLinksFromSearchHtml(result.html, result.url || url);
          for (const detailUrl of detailLinks) {
            const detailResult = await fetchSource({ id: `market-detail:${candidate.name}:${detailUrl}`, url: detailUrl });
            if (detailResult.ok && detailResult.text) {
              pageBuckets.push({ url: detailUrl, text: detailResult.text, fetchedAt: detailResult.fetchedAt });
            }
          }
        }
      }
    }
    const extractedRows = pageBuckets
      .map((page) => ({
        ...extractMarketPriceFromText(page.text, candidate.name, page.url),
        url: page.url,
      }))
      .filter((row) => Number.isFinite(row.marketPrice));
    if (extractedRows.length > 0) {
      const supportMedian = extractedRows
        .map((row) => Number(row.tokenSupport ?? 0))
        .sort((a, b) => a - b)[Math.floor(extractedRows.length / 2)];
      if (supportMedian < 0.35) continue;
      const soldStrength = extractedRows
        .map((row) => Number(row.soldSupport ?? 0))
        .sort((a, b) => a - b)[Math.floor(extractedRows.length / 2)];
      if (soldStrength < 0.15) continue;
      const values = extractedRows.map((row) => row.marketPrice).sort((a, b) => a - b);
      const marketPrice = values[Math.floor(values.length / 2)];
      results.set(candidate.name, {
        marketPrice,
        marketPriceLabel: `${candidate.name} 実売寄り相場 ${marketPrice.toLocaleString("ja-JP")}円`,
        marketPriceSource: `specialized-search(${extractedRows.length})/sold:${soldStrength.toFixed(2)}`,
        marketPriceSourceRank: "observed_market_price",
        marketPriceUsage: "buyline",
        marketPriceBuyLineEligible: true,
        marketObservedAt: pageBuckets
          .map((item) => Date.parse(item.fetchedAt || ""))
          .filter((ts) => Number.isFinite(ts))
          .sort((a, b) => b - a)[0]
          ? new Date(
              pageBuckets
                .map((item) => Date.parse(item.fetchedAt || ""))
                .filter((ts) => Number.isFinite(ts))
                .sort((a, b) => b - a)[0],
            ).toISOString()
          : null,
      });
    }
  }
  return results;
}

function mergeCandidateRecords(base, next) {
  const scoreBase = Number(base?.genreScore ?? 0);
  const scoreNext = Number(next?.genreScore ?? 0);
  const chosen = scoreNext >= scoreBase ? { ...base, ...next } : { ...next, ...base };
  const mergedMissing = new Set(
    [String(base?.missingData ?? ""), String(next?.missingData ?? "")]
      .flatMap((value) => value.split(/[、,]/))
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const hasRetail = Number.isFinite(base?.retailPrice) || Number.isFinite(next?.retailPrice);
  const hasMarket = Number.isFinite(base?.marketPrice) || Number.isFinite(next?.marketPrice);
  if (hasRetail) {
    for (const item of [...mergedMissing]) {
      if (/定価|価格データ/.test(item)) mergedMissing.delete(item);
    }
  }
  if (hasMarket) {
    for (const item of [...mergedMissing]) {
      if (/相場|成約価格/.test(item)) mergedMissing.delete(item);
    }
  }
  return {
    ...chosen,
    genreScore: Math.max(scoreBase, scoreNext),
    confidence:
      base?.confidence === "高" || next?.confidence === "高"
        ? "高"
        : base?.confidence === "中" || next?.confidence === "中"
          ? "中"
          : "低",
    sourceUrl: next?.sourceUrl || base?.sourceUrl || "",
    missingData: [...mergedMissing].join("、"),
  };
}

function verificationDateLabel(value) {
  if (!value) return "未確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未確認";
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function routeTargetIsGeneric(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    const pathSegments = path.split("/").filter(Boolean);
    return (
      path === "" ||
      path === "/" ||
      host === "amazon.co.jp" ||
      host === "pokemoncenter-online.com" ||
      /snkrdunk\.com$/.test(host) ||
      (/^(x\.com|twitter\.com)$/.test(host) && pathSegments.length <= 1) ||
      /press\.moviewalker\.jp$/.test(host) ||
      (/tohotheater\.jp$/.test(host) && /^\/news\/?$/.test(parsed.pathname)) ||
      (/109cinemas\.net$/.test(host) && /^\/(?:news|movies)?\/?$/.test(parsed.pathname)) ||
      (/on-line\.1kuji\.com$/.test(host) && (/^\/Default\.aspx$/i.test(parsed.pathname) || /\/Form\/Product\/ProductList\.aspx$/i.test(parsed.pathname)))
    );
  } catch {
    return true;
  }
}

function routeRequiresApplyUrlExtraction(route) {
  const text = [route?.name, route?.round, route?.url, route?.applyUrl].filter(Boolean).join(" ").toLowerCase();
  return /ドラスタ|dorasuta|membercard|イエサブ|yellow\s*submarine|抽選|応募/.test(text);
}

function scoreRouteApplyCandidate(candidateUrl, route, anchorText = "") {
  let score = 0;
  const lowerUrl = String(candidateUrl ?? "").toLowerCase();
  const lowerAnchor = String(anchorText ?? "").toLowerCase();
  const routeText = [route?.name, route?.round].join(" ").toLowerCase();

  if (/dorasuta\.membercard\.jp/.test(lowerUrl)) score += 60;
  if (/yellow|yellowsubmarine|ys_/.test(lowerUrl)) score += 35;
  if (/entry|apply|lottery|campaign|reserve|membercard|poster|shop/.test(lowerUrl)) score += 20;
  if (/応募|抽選|受付|エントリー|ポスター/.test(anchorText)) score += 20;
  if (/twitter\.com\/ys_|x\.com\/ys_/.test(lowerUrl)) score += 15;
  if (routeText.includes("ドラスタ") && /dorasuta\.membercard\.jp/.test(lowerUrl)) score += 15;
  if (routeText.includes("イエサブ") && /yellow|ys_/.test(lowerUrl)) score += 15;
  if (/\/$/.test(lowerUrl)) score -= 20;
  if (routeTargetIsGeneric(candidateUrl)) score -= 18;

  return score;
}

function shouldReplaceApplyUrl(route, candidateUrl) {
  if (!candidateUrl) return false;
  const current = route.applyUrl || "";
  if (!current) return true;
  if (routeTargetIsGeneric(current) && !routeTargetIsGeneric(candidateUrl)) return true;
  return false;
}

function selectBestApplyUrl(route, pageResult) {
  if (!pageResult?.ok || !pageResult?.html) return null;
  const links = extractLinksFromHtml(pageResult.html, pageResult.url || route.url || "");
  if (links.length === 0) return null;
  const ranked = links
    .map((item) => ({ ...item, score: scoreRouteApplyCandidate(item.url, route, item.anchorText) }))
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

function buildRouteVerification(route, result) {
  const issues = [];
  const labelParts = [];
  const routeText = [route.name, route.round, route.deadlineLabel].join(" ");
  const isRolling = /常時|随時|再販|入荷|招待/.test(routeText);
  const pageText = String(result?.text ?? "");
  const endedBySource =
    /受付終了|抽選終了|応募終了|終了しました/.test(pageText) && !/受付中|応募受付中|抽選受付中/.test(pageText);

  const targetUrl = route.applyUrl || route.url || "";
  if (!targetUrl) issues.push("リンク未設定");
  if (routeTargetIsGeneric(targetUrl)) issues.push("応募直リンクではない");
  if (!route.deadlineDate && !isRolling) issues.push("終了日未確認");
  if (!route.startDate) issues.push("開始日未確認");
  if (result && !result.ok) issues.push(`接続失敗 ${result.status}`);
  if (endedBySource) issues.push("参照元で受付終了");

  if (result?.ok) labelParts.push(`接続 ${verificationDateLabel(result.fetchedAt)}`);
  if (route.deadlineDate) labelParts.push("終了日あり");
  if (isRolling) labelParts.push("常時/再販枠");
  if (endedBySource) labelParts.push("終了記載あり");

  const status = endedBySource ? "ended" : issues.length === 0 ? "verified" : result?.ok || isRolling ? "review" : "missing";
  return {
    status,
    label:
      status === "verified"
        ? "応募欄確認済み"
        : status === "ended"
          ? "受付終了"
          : status === "review"
            ? "要目視確認"
            : "要修正",
    ended: endedBySource,
    checkedAt: result?.fetchedAt ?? null,
    sourceStatus: result ? String(result.status) : "not-fetched",
    finalUrl: result?.url ?? targetUrl,
    summary: labelParts.length > 0 ? labelParts.join(" / ") : "自動確認なし",
    issues,
  };
}

function candidateRouteTargetUrl(candidate) {
  const raw = String(candidate?.sourceUrl ?? "").trim();
  if (!raw) return null;
  const parsed = tryParseUrl(raw);
  if (!parsed) return null;
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  return parsed.toString();
}

function candidateRouteIsUsable(targetUrl) {
  return Boolean(targetUrl) && !routeTargetIsGeneric(targetUrl) && !isSearchLikeUrl(targetUrl);
}

function candidateMarketFreshnessState(observedAt) {
  if (!observedAt) return "missing";
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) return "missing";
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays <= 3) return "fresh";
  return "stale";
}

function deriveCandidateInsufficiencyReasons(candidate) {
  const reasons = [];
  const periodKnown = Boolean(candidate?.startDate && candidate?.endDate);
  const periodActive = candidate?.endDate ? safeIsoDate(String(candidate.endDate).slice(0, 10)) >= todayIsoDate() : true;
  const hasRetail = Number.isFinite(candidate?.retailPrice);
  const hasMarket = Number.isFinite(candidate?.marketPrice);
  const routeTarget = candidateRouteTargetUrl(candidate);
  const routeUsable = candidate?.routeUsable !== false && candidateRouteIsUsable(routeTarget);
  const routeAlive = candidate?.routeAlive !== false;
  const marketFreshness = candidateMarketFreshnessState(candidate?.marketObservedAt);
  const retailRank = String(candidate?.retailPriceSourceRank ?? "");
  const marketRank = String(candidate?.marketPriceSourceRank ?? "");

  if (!periodKnown) reasons.push("missingPeriod");
  if (periodKnown && !periodActive) reasons.push("ended");
  if (!hasRetail) reasons.push("missingRetailPrice");
  if (!hasMarket) reasons.push("missingMarketPrice");
  if (hasRetail && retailRank && priceSourceUsageFromRank(retailRank) !== "buyline") reasons.push("retailWatchOnly");
  if (hasMarket && marketRank && priceSourceUsageFromRank(marketRank) !== "buyline") reasons.push("marketWatchOnly");
  if (!routeTarget) reasons.push("missingRoute");
  else if (!routeUsable) reasons.push("genericRoute");
  else if (!routeAlive) reasons.push("deadRoute");
  if (marketFreshness === "stale") reasons.push("staleMarketPrice");
  return [...new Set(reasons)];
}

function deriveCandidateState(candidate) {
  const insufficiencyReasons = deriveCandidateInsufficiencyReasons(candidate);
  const hasEnded = insufficiencyReasons.includes("ended");
  const hasRouteIssue = insufficiencyReasons.some((reason) => ["missingRoute", "genericRoute", "deadRoute"].includes(reason));
  const hasPriceGap = insufficiencyReasons.some((reason) =>
    ["missingRetailPrice", "missingMarketPrice", "retailWatchOnly", "marketWatchOnly", "staleMarketPrice"].includes(reason),
  );
  const hasPeriodGap = insufficiencyReasons.includes("missingPeriod");
  const score = Number(candidate?.genreScore ?? 0);
  const startIso = safeIsoDate(String(candidate?.startDate ?? "").slice(0, 10));
  const daysUntilStart = startIso ? Math.floor((Date.parse(`${startIso}T00:00:00+09:00`) - Date.now()) / 86_400_000) : Number.NaN;
  const nearWindow = Number.isFinite(daysUntilStart) ? daysUntilStart <= 14 : false;

  if (hasEnded) return { candidateState: "archive", insufficiencyReasons };
  if (!hasPeriodGap && !hasRouteIssue && !hasPriceGap) return { candidateState: "ready", insufficiencyReasons };
  if (nearWindow || score >= 78 || candidate?.sourceChannel === "lottery") {
    return { candidateState: "researchTask", insufficiencyReasons };
  }
  return { candidateState: "watchOnly", insufficiencyReasons };
}

function buildCandidateRouteVerification(candidate, result) {
  const targetUrl = candidateRouteTargetUrl(candidate);
  const issues = [];
  const labelParts = [];
  const resolvedUrl = result?.url ?? targetUrl;
  const routeUsable = candidateRouteIsUsable(resolvedUrl);
  if (!targetUrl) issues.push("導線URL未設定");
  if (targetUrl && !routeUsable) {
    issues.push("導線が汎用ページ");
  }
  if (result && !result.ok) {
    issues.push(`接続失敗 ${result.status}`);
  }
  if (result?.ok) {
    labelParts.push(`接続 ${verificationDateLabel(result.fetchedAt)}`);
  }

  const alive = Boolean(result?.ok) && routeUsable;
  const status = !targetUrl ? "missing" : alive ? (issues.length === 0 ? "verified" : "review") : "missing";
  return {
    status,
    alive,
    usable: routeUsable,
    checkedAt: result?.fetchedAt ?? null,
    sourceStatus: result ? String(result.status) : "not-fetched",
    finalUrl: resolvedUrl,
    summary: labelParts.join(" / ") || "接続未確認",
    issues,
  };
}

async function fetchUrlResults(urls, idPrefix, concurrency = routeCheckConcurrency) {
  const results = new Map();
  for (let index = 0; index < urls.length; index += concurrency) {
    const batch = urls.slice(index, index + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const result = await fetchSource({ id: `${idPrefix}:${url}`, url });
        return [url, result];
      }),
    );
    for (const [url, result] of batchResults) {
      results.set(url, result);
    }
  }
  return results;
}

async function verifyCandidateRouteTargets(candidates) {
  const targetUrls = [
    ...new Set(
      candidates
        .map((candidate) => candidateRouteTargetUrl(candidate))
        .filter(Boolean),
    ),
  ];
  const routeResults = await fetchUrlResults(targetUrls, "candidate-route");

  const enrichedCandidates = candidates.map((candidate) => {
    const targetUrl = candidateRouteTargetUrl(candidate);
    const verification = buildCandidateRouteVerification(candidate, targetUrl ? routeResults.get(targetUrl) : null);
    return {
      ...candidate,
      routeAlive: verification.alive,
      routeUsable: verification.usable,
      routeStatus: verification.sourceStatus,
      routeCheckedAt: verification.checkedAt,
      routeFinalUrl: verification.finalUrl,
      routeVerification: verification,
    };
  });

  const publicResults = [...routeResults.values()].map((result) => {
    const { text, html, ...publicResult } = result;
    return publicResult;
  });

  return { candidates: enrichedCandidates, results: publicResults };
}

function summarizeCandidateKpi(candidates) {
  const target = candidates.filter((candidate) => candidate.stageKind === "candidate");
  const total = target.length;
  let ready = 0;
  let missingPeriod = 0;
  let missingPrice = 0;
  let stalePrice = 0;
  let missingRoute = 0;
  let blogSns = 0;
  let routeChecked = 0;
  let routeAlive = 0;
  let withProductName = 0;
  const stateCounts = { ready: 0, researchTask: 0, watchOnly: 0, archive: 0 };

  for (const candidate of target) {
    const insufficiencyReasons = Array.isArray(candidate.insufficiencyReasons) ? candidate.insufficiencyReasons : deriveCandidateInsufficiencyReasons(candidate);
    const hasRoute = Boolean(candidateRouteTargetUrl(candidate));
    const isRouteAlive = candidate.routeAlive !== false;
    const isRouteUsable = candidate.routeUsable !== false && candidateRouteIsUsable(candidateRouteTargetUrl(candidate));
    const hasName = String(candidate?.name ?? "").trim().length >= 2;
    const channel = String(candidate?.sourceChannel ?? "");
    const state = ["ready", "researchTask", "watchOnly", "archive"].includes(candidate.candidateState) ? candidate.candidateState : deriveCandidateState(candidate).candidateState;

    if (channel === "blog" || channel === "sns") blogSns += 1;
    if (hasName) withProductName += 1;
    if (candidate.routeCheckedAt) routeChecked += 1;
    if (hasRoute && isRouteUsable && isRouteAlive) routeAlive += 1;
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    if (state === "ready") ready += 1;
    if (insufficiencyReasons.includes("missingPeriod")) missingPeriod += 1;
    if (insufficiencyReasons.some((reason) => ["missingRetailPrice", "missingMarketPrice", "retailWatchOnly", "marketWatchOnly"].includes(reason))) {
      missingPrice += 1;
    }
    if (insufficiencyReasons.includes("staleMarketPrice")) stalePrice += 1;
    if (insufficiencyReasons.some((reason) => ["missingRoute", "genericRoute", "deadRoute"].includes(reason))) missingRoute += 1;
  }

  return {
    total,
    ready,
    missingPeriod,
    missingPrice,
    stalePrice,
    missingRoute,
    blogSns,
    withProductName,
    routeChecked,
    routeAlive,
    stateCounts,
  };
}

async function verifyPokemonRouteTargets(releases) {
  const routeResults = new Map();
  const pageResults = new Map();

  for (const release of releases) {
    for (const route of release.routes ?? []) {
      if (!route.deadlineDate && release.saleEndDate) {
        route.deadlineDate = `${release.saleEndDate}T23:59:59+09:00`;
      }
      const baseUrl = route.url || route.applyUrl;
      if (!baseUrl) continue;
      if (!pageResults.has(baseUrl)) {
        const pageResult = await fetchSource({ id: `route-page:${baseUrl}`, url: baseUrl });
        pageResults.set(baseUrl, pageResult);
      }
      const pageResult = pageResults.get(baseUrl);
      if (routeRequiresApplyUrlExtraction(route) && shouldReplaceApplyUrl(route, pageResult?.url)) {
        const best = selectBestApplyUrl(route, pageResult);
        if (best && shouldReplaceApplyUrl(route, best.url)) {
          route.applyUrl = best.url;
          route.applySource = "auto-extracted";
          route.applyHint = best.anchorText || "";
        }
      }
    }
  }

  const targetUrls = [
    ...new Set(
      releases
        .flatMap((release) => release.routes ?? [])
        .map((route) => route.applyUrl || route.url)
        .filter(Boolean),
    ),
  ];

  for (const url of targetUrls) {
    const result = await fetchSource({ id: `route:${url}`, url });
    routeResults.set(url, result);
  }

  for (const release of releases) {
    for (const route of release.routes ?? []) {
      const targetUrl = route.applyUrl || route.url;
      route.verification = buildRouteVerification(route, targetUrl ? routeResults.get(targetUrl) : null);
    }
  }

  return [...routeResults.values()].map((result) => {
    const { text, html, ...publicResult } = result;
    return publicResult;
  });
}

function computeHistorySupport(historyRuns, trendOrName) {
  const key = normalizeSignalText(trendOrName);
  if (!key) return { hits: 0, recentHits: 0, lastSeen: null };
  let hits = 0;
  let recentHits = 0;
  let lastSeen = null;
  const recentRuns = historyRuns.slice(-7);

  for (const run of historyRuns) {
    const snap = run.snapshot ?? {};
    const found =
      (snap.trends ?? []).some((item) => normalizeSignalText(item.keyword).includes(key) || key.includes(normalizeSignalText(item.keyword))) ||
      (snap.discoveryCandidates ?? []).some(
        (item) => normalizeSignalText(item.name).includes(key) || key.includes(normalizeSignalText(item.name)),
      );
    if (found) {
      hits += 1;
      lastSeen = snap.metadata?.updatedAt ?? run.savedAt ?? lastSeen;
    }
  }
  for (const run of recentRuns) {
    const snap = run.snapshot ?? {};
    const found =
      (snap.trends ?? []).some((item) => normalizeSignalText(item.keyword).includes(key) || key.includes(normalizeSignalText(item.keyword))) ||
      (snap.discoveryCandidates ?? []).some(
        (item) => normalizeSignalText(item.name).includes(key) || key.includes(normalizeSignalText(item.name)),
      );
    if (found) recentHits += 1;
  }
  return { hits, recentHits, lastSeen };
}

function buildYearlyProductLearning(historyRuns) {
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const rows = new Map();
  for (const run of historyRuns) {
    const runTs = Date.parse(run?.snapshot?.metadata?.updatedAt ?? run?.savedAt ?? "");
    if (!Number.isFinite(runTs) || runTs < oneYearAgo) continue;
    for (const candidate of run?.snapshot?.discoveryCandidates ?? []) {
      const key = normalizeSignalText(candidate?.name);
      if (!key) continue;
      const existing = rows.get(key) ?? {
        key,
        name: candidate.name,
        mentions: 0,
        withPeriod: 0,
        withRoute: 0,
        retailValues: [],
        marketValues: [],
        firstSeen: run?.snapshot?.metadata?.updatedAt ?? run?.savedAt ?? null,
        lastSeen: run?.snapshot?.metadata?.updatedAt ?? run?.savedAt ?? null,
      };
      existing.mentions += 1;
      if (candidate?.startDate && candidate?.endDate) existing.withPeriod += 1;
      if (candidate?.sourceUrl) existing.withRoute += 1;
      if (Number.isFinite(candidate?.retailPrice)) existing.retailValues.push(candidate.retailPrice);
      if (Number.isFinite(candidate?.marketPrice)) existing.marketValues.push(candidate.marketPrice);
      existing.lastSeen = run?.snapshot?.metadata?.updatedAt ?? run?.savedAt ?? existing.lastSeen;
      rows.set(key, existing);
    }
  }
  const summarizeMedian = (values) => {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return [...rows.values()].map((row) => ({
    key: row.key,
    name: row.name,
    mentions: row.mentions,
    periodFillRate: row.mentions > 0 ? row.withPeriod / row.mentions : 0,
    routeFillRate: row.mentions > 0 ? row.withRoute / row.mentions : 0,
    retailMedian: summarizeMedian(row.retailValues),
    marketMedian: summarizeMedian(row.marketValues),
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  }));
}

function compactSnapshotForHistory(snapshot) {
  return {
    metadata: {
      updatedAt: snapshot?.metadata?.updatedAt ?? null,
      status: snapshot?.metadata?.status ?? null,
      reachableSources: snapshot?.metadata?.reachableSources ?? null,
      totalSources: snapshot?.metadata?.totalSources ?? null,
    },
    overviewNarrative: snapshot?.overviewNarrative ?? null,
    trends: snapshot?.trends ?? [],
    discoveryCandidates: snapshot?.discoveryCandidates ?? [],
    productLearning: snapshot?.productLearning ?? [],
  };
}

function compactHistoryRun(run) {
  return {
    id: run?.id,
    savedAt: run?.savedAt,
    snapshot: compactSnapshotForHistory(run?.snapshot ?? {}),
  };
}

function buildPublicHistory(historyRuns) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: historyRuns.slice(-3).map((run) => {
      const snap = run.snapshot ?? {};
      return {
        id: run.id,
        savedAt: run.savedAt,
        snapshot: {
          metadata: {
            updatedAt: snap.metadata?.updatedAt ?? null,
            status: snap.metadata?.status ?? null,
          },
          overviewNarrative: snap.overviewNarrative ?? null,
          deals: snap.deals ?? [],
          trends: snap.trends ?? [],
          discoveryCandidates: snap.discoveryCandidates ?? [],
          lotteryRoutes: snap.lotteryRoutes ?? [],
          pokemonReleases: snap.pokemonReleases ?? [],
        },
      };
    }),
  };
}

function estimateCandidateMarketPrice(snapshot, historyRuns, candidate) {
  if (Number.isFinite(candidate.marketPrice)) {
    const marketPriceSource = candidate.marketPriceSource ?? "candidate";
    const marketPriceSourceRank = priceSourceRankFromSource(marketPriceSource, "market");
    return {
      marketPrice: candidate.marketPrice,
      marketPriceLabel: candidate.marketPriceLabel ?? null,
      marketPriceSource,
      marketPriceSourceRank,
      marketPriceUsage: priceSourceUsageFromRank(marketPriceSourceRank),
      marketPriceBuyLineEligible: priceSourceUsageFromRank(marketPriceSourceRank) === "buyline",
    };
  }

  const key = normalizeSignalText(candidate.name);
  if (!key) return null;

  const matchedDeal = (snapshot.deals ?? []).find((deal) => {
    const dealKey = normalizeSignalText(deal.name);
    return dealKey && (dealKey.includes(key) || key.includes(dealKey));
  });
  if (matchedDeal && Number.isFinite(matchedDeal.sellPrice)) {
    return {
      marketPrice: matchedDeal.sellPrice,
      marketPriceLabel: `相場 ${matchedDeal.sellPrice.toLocaleString("ja-JP")}円（利益候補）`,
      marketPriceSource: "deal-sell-price",
      marketPriceSourceRank: "manual_price",
      marketPriceUsage: "buyline",
      marketPriceBuyLineEligible: true,
    };
  }

  const matchedRelease = (snapshot.pokemonReleases ?? []).find((release) => {
    const releaseKey = normalizeSignalText(release.name);
    return releaseKey && (releaseKey.includes(key) || key.includes(releaseKey));
  });
  if (matchedRelease && Number.isFinite(matchedRelease.marketPrice)) {
    return {
      marketPrice: matchedRelease.marketPrice,
      marketPriceLabel: matchedRelease.marketLabel ?? `相場 ${matchedRelease.marketPrice.toLocaleString("ja-JP")}円`,
      marketPriceSource: "pokemon-release",
      marketPriceSourceRank: "manual_price",
      marketPriceUsage: "buyline",
      marketPriceBuyLineEligible: true,
    };
  }

  const candidateProductKey = normalizeProductKey(candidate.name);
  const historyPrices = [];
  for (const run of historyRuns.slice(-30).reverse()) {
    const previous = (run.snapshot?.discoveryCandidates ?? []).find((item) => normalizeProductKey(item.name) === candidateProductKey);
    if (
      previous &&
      Number.isFinite(previous.marketPrice) &&
      (previous.marketPriceSourceRank === "manual_price" || previous.marketPriceBuyLineEligible === true)
    ) {
      historyPrices.push(previous.marketPrice);
    }
  }
  if (historyPrices.length >= 2) {
    const sorted = [...historyPrices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      marketPrice: median,
      marketPriceLabel: `売却参考 ${median.toLocaleString("ja-JP")}円（同一商品の履歴）`,
      marketPriceSource: "history-median",
      marketPriceSourceRank: "manual_price",
      marketPriceUsage: "watch",
      marketPriceBuyLineEligible: false,
    };
  }

  return null;
}

function estimateCandidateRetailPrice(snapshot, historyRuns, candidate) {
  if (Number.isFinite(candidate.retailPrice)) {
    const retailPriceSource = candidate.retailPriceSource ?? "candidate";
    const retailPriceSourceRank = priceSourceRankFromSource(retailPriceSource, "retail");
    return {
      retailPrice: candidate.retailPrice,
      retailPriceLabel: candidate.retailPriceLabel ?? null,
      retailPriceSource,
      retailPriceSourceRank,
      retailPriceUsage: priceSourceUsageFromRank(retailPriceSourceRank),
      retailPriceBuyLineEligible: priceSourceUsageFromRank(retailPriceSourceRank) === "buyline",
    };
  }

  const key = normalizeSignalText(candidate.name);
  if (!key) return null;

  const matchedDeal = (snapshot.deals ?? []).find((deal) => {
    const dealKey = normalizeSignalText(deal.name);
    return dealKey && (dealKey.includes(key) || key.includes(dealKey));
  });
  if (matchedDeal && Number.isFinite(matchedDeal.buyPrice)) {
    return {
      retailPrice: matchedDeal.buyPrice,
      retailPriceLabel: `仕入価格 ${matchedDeal.buyPrice.toLocaleString("ja-JP")}円（利益候補）`,
      retailPriceSource: "deal-buy-price",
      retailPriceSourceRank: "manual_price",
      retailPriceUsage: "buyline",
      retailPriceBuyLineEligible: true,
    };
  }

  const matchedRelease = (snapshot.pokemonReleases ?? []).find((release) => {
    const releaseKey = normalizeSignalText(release.name);
    return releaseKey && (releaseKey.includes(key) || key.includes(releaseKey));
  });
  if (matchedRelease && Number.isFinite(matchedRelease.retailPrice)) {
    return {
      retailPrice: matchedRelease.retailPrice,
      retailPriceLabel: `公式価格 ¥${matchedRelease.retailPrice.toLocaleString("ja-JP")}`,
      retailPriceSource: "pokemon-release",
      retailPriceSourceRank: "manual_price",
      retailPriceUsage: "buyline",
      retailPriceBuyLineEligible: true,
    };
  }

  const historyPrices = [];
  for (const run of historyRuns.slice(-30).reverse()) {
    const previous = (run.snapshot?.discoveryCandidates ?? []).find((item) => {
      const previousKey = normalizeSignalText(item.name);
      return previousKey && (previousKey.includes(key) || key.includes(previousKey));
    });
    if (previous && Number.isFinite(previous.retailPrice)) {
      historyPrices.push(previous.retailPrice);
    }
  }
  if (historyPrices.length > 0) {
    const sorted = [...historyPrices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      retailPrice: median,
      retailPriceLabel: `公式価格 ¥${median.toLocaleString("ja-JP")}（履歴補完）`,
      retailPriceSource: "history-median",
      retailPriceSourceRank: "historical_prediction",
      retailPriceUsage: "watch",
      retailPriceBuyLineEligible: false,
    };
  }

  return null;
}

function inferSeedLane(source) {
  if (source.lane) return source.lane;
  if (source.type === "pokemonRelease") return "official";
  return laneFromHostAndText(source.url, source.keyword ?? "", source.trend?.context ?? "") ?? "official";
}

function normalizeSeedSource(rawSource) {
  const lane = inferSeedLane(rawSource);
  const resolvedUrl = resolveSourceUrl(rawSource);
  const parsed = tryParseUrl(resolvedUrl);
  const host = String(parsed?.hostname ?? "").replace(/^www\./, "").toLowerCase();
  return {
    ...rawSource,
    seed: rawSource.seed !== false,
    lane,
    priority: rawSource.priority ?? (lane === "lottery" ? "high" : lane === "official" ? "high" : "medium"),
    expansionPolicy: rawSource.expansionPolicy ?? defaultExpansionPolicyForLane(lane),
    followDomains: rawSource.followDomains ?? [host].filter(Boolean),
    crawlBudget: { ...defaultCrawlBudgetForLane(lane), ...(rawSource.crawlBudget ?? {}) },
    sourceKey: rawSource.sourceKey ?? sourceKeyForLaneUrl(lane, resolvedUrl),
    url: resolvedUrl,
  };
}

function bootstrapManualRegistryEntries(seedSources, registry) {
  const entries = new Map((registry.entries ?? []).map((entry) => [entry.sourceKey, buildRegistryEntry(entry)]));
  for (const source of seedSources) {
    const existing = entries.get(source.sourceKey);
    const manualEntry = buildRegistryEntry({
      sourceKey: source.sourceKey,
      lane: source.lane,
      keywordHint: source.keyword,
      titleHint: source.keyword,
      url: source.url,
      canonicalUrl: source.url,
      canonicalPath: tryParseUrl(source.url)?.pathname ?? "/",
      host: String(tryParseUrl(source.url)?.hostname ?? "").replace(/^www\./, "").toLowerCase(),
      status: "manual",
      seed: true,
      priority: source.priority,
      expansionPolicy: source.expansionPolicy,
      followDomains: source.followDomains,
      crawlBudget: source.crawlBudget,
      firstSeenAt: existing?.firstSeenAt ?? null,
      lastSeenAt: existing?.lastSeenAt ?? null,
      lastFetchedAt: existing?.lastFetchedAt ?? null,
      successRuns: existing?.successRuns ?? 0,
      failureRuns: existing?.failureRuns ?? 0,
      usefulRuns: existing?.usefulRuns ?? 0,
      productHitCount: existing?.productHitCount ?? 0,
      routeHitCount: existing?.routeHitCount ?? 0,
      discoveredCount: existing?.discoveredCount ?? 0,
      specificProductCount: existing?.specificProductCount ?? 0,
      genericNoiseCount: existing?.genericNoiseCount ?? 0,
      priceHitCount: existing?.priceHitCount ?? 0,
      directRouteCount: existing?.directRouteCount ?? 0,
      specificProductRatio: existing?.specificProductRatio ?? 0,
      productExtractionRate: existing?.productExtractionRate ?? 0,
      directRouteRate: existing?.directRouteRate ?? 0,
      priceHitRate: existing?.priceHitRate ?? 0,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      lastUsefulAt: existing?.lastUsefulAt ?? null,
      lastDecisionReason: "manual seed source",
      sourceQuality: existing?.sourceQuality ?? 0,
    });
    entries.set(manualEntry.sourceKey, manualEntry);
  }
  registry.entries = [...entries.values()];
  return registry;
}

const sourceResults = [];
const seedSources = (config.sources ?? []).map(normalizeSeedSource);
let registry = await readSourceRegistry();
registry = bootstrapManualRegistryEntries(seedSources, registry);
const registryByKey = new Map(registry.entries.map((entry) => [entry.sourceKey, buildRegistryEntry(entry)]));
const registryStatusBefore = new Map([...registryByKey.values()].map((entry) => [entry.sourceKey, entry.status]));
const seedSourceKeys = new Set(seedSources.map((source) => source.sourceKey));
const registryRuntimeSources = runtimeSourcesFromRegistry([...registryByKey.values()]).filter(
  (source) => !seedSourceKeys.has(source.sourceKey),
);
const runtimeSources = [...seedSources, ...registryRuntimeSources].map(normalizeSeedSource);
const history = await readJsonFile(historyUrl, {
  version: 1,
  runs: [],
});
history.runs = (history.runs ?? []).slice(-365).map(compactHistoryRun);
const historyRuns = history.runs;
const yearlyLearning = buildYearlyProductLearning(historyRuns);
const yearlyLearningMap = new Map(yearlyLearning.map((item) => [item.key, item]));
const sourceDiscoveryResults = {
  discoveredSources: [],
  promotedToTrial: [],
  promotedToActive: [],
  blockedSources: [],
  archivedSources: [],
  trialFetched: 0,
  activeFetched: 0,
};
const snapshot = {
  metadata: {
    source: "collector",
    status: "collected",
    updatedAt: new Date().toISOString(),
  },
  deals: [],
  trends: [],
  discoveryCandidates: [],
  kujiSpecials: clone(config.kujiSpecials ?? []),
  marketMemory: clone(config.marketMemory ?? []),
  lotteryRoutes: [],
  pokemonReleases: [],
  routeVerificationResults: [],
  archivedConcreteTrends: [],
  trendCollectionPool: [],
  explorationTasks: [],
  marketplaceResearchTargets: [],
  realtimeResearchTargets: [],
  socialSearchSignals: [],
  browserObservationQueue: [],
  productLearning: [],
  documents: [],
  llmExtractions: [],
  normalizedProducts: [],
  productEvents: [],
  priceSnapshots: [],
  predictedPriceSnapshots: [],
  historicalComparables: [],
  routeSnapshots: [],
  selectionReasons: [],
  socialSignals: [],
  marketplaceSignals: [],
  marketplaceObservationQueue: [],
  overviewNarrative: null,
  sourceRegistrySummary: {},
  sourceDiscoveryResults,
  sourceResults,
  candidateRouteVerificationResults: [],
};

snapshot.deals = await loadDealCandidates();

const mergeDiscoveredSourceIntoRegistry = (candidate) => {
  if (!candidate?.sourceKey) return;
  const existing = registryByKey.get(candidate.sourceKey);
  if (existing) {
    registryByKey.set(candidate.sourceKey, applyDiscoveryToRegistryEntry(existing, candidate));
    return;
  }
  if (sourceDiscoveryResults.discoveredSources.length >= DISCOVERY_SOURCE_LIMIT) return;
  const entry = buildRegistryEntry(candidate);
  registryByKey.set(entry.sourceKey, entry);
  sourceDiscoveryResults.discoveredSources.push({
    sourceKey: entry.sourceKey,
    lane: entry.lane,
    url: entry.canonicalUrl,
    priority: entry.priority,
    discoveredFrom: entry.discoveredFrom?.[0] ?? null,
  });
};

for (const rawSource of runtimeSources) {
  const source = normalizeSeedSource(rawSource);
  const existingRegistryEntry =
    registryByKey.get(source.sourceKey) ??
    buildRegistryEntry({
      sourceKey: source.sourceKey,
      lane: source.lane,
      url: source.url,
      canonicalUrl: source.url,
      canonicalPath: tryParseUrl(source.url)?.pathname ?? "/",
      host: String(tryParseUrl(source.url)?.hostname ?? "").replace(/^www\./, "").toLowerCase(),
      status: source.seed ? "manual" : source.registryStatus ?? "candidate",
      seed: source.seed,
      priority: source.priority,
      expansionPolicy: source.expansionPolicy,
      followDomains: source.followDomains,
      crawlBudget: source.crawlBudget,
      keywordHint: source.keyword,
      titleHint: source.keyword,
      lastDecisionReason: source.seed ? "manual seed source" : "runtime source bootstrap",
    });
  const result = await fetchSource(source);
  const { text, html, ...publicResult } = result;

  if (source.registryStatus === "trial") sourceDiscoveryResults.trialFetched += 1;
  if (source.registryStatus === "active") sourceDiscoveryResults.activeFetched += 1;

  if (source.type === "pokemonRelease" && source.release) {
    snapshot.pokemonReleases.push(parseSnkrdunkPokemonRelease(source, result));
  }

  let parsed = null;
  const shouldParseSeedTrend = source.type === "trendCandidate";
  const shouldParseDiscoveredTrend =
    source.type === "discoveredSource" &&
    source.lane !== "market" &&
    source.lane !== "blog" &&
    source.lane !== "sns";
  if (shouldParseSeedTrend || shouldParseDiscoveredTrend) {
    parsed = parseOfficialTrendCandidate(source, result);
    publicResult.newsTitle = parsed.newsTitle;
    publicResult.newsDate = parsed.newsDate;
    publicResult.signals = parsed.signals;
    if (!source.hideFromTrends) {
      snapshot.trends.push(parsed.trend);
    }
    if (!source.hideFromDiscovery) {
      snapshot.discoveryCandidates.push(parsed.candidate);
    }
  }

  const expanded = await expandBlogSnsCandidates(source, result, historyRuns);
  publicResult.expandedScanned = expanded.stats.scanned;
  publicResult.expandedGenerated = expanded.stats.generated;
  publicResult.expandedSourceCandidates = expanded.discoveredSources.length;
  if (!source.hideFromTrends) {
    snapshot.trends.push(...expanded.trends);
  }
  if (!source.hideFromDiscovery) {
    snapshot.discoveryCandidates.push(...expanded.candidates);
  }
  snapshot.documents.push(...expanded.documents);
  snapshot.llmExtractions.push(...expanded.llmExtractions);

  const lotteryCandidates = extractLotteryRoutesFromSource(source, result);
  if (lotteryCandidates.length > 0) {
    snapshot.lotteryRoutes.push(...lotteryCandidates);
  }

  const productNameSet = new Set();
  if (source.type === "pokemonRelease" && source.release?.name) {
    productNameSet.add(source.release.name);
  }
  if (parsed?.candidate?.name) {
    productNameSet.add(parsed.candidate.name);
  }
  for (const candidate of expanded.candidates) {
    if (candidate?.name) productNameSet.add(candidate.name);
  }
  const specificProductNames = [...productNameSet].filter(productPhraseLooksSpecific);
  const generatedProductCount =
    (source.type === "pokemonRelease" && source.release?.name ? 1 : 0) +
    (parsed?.candidate?.name ? 1 : 0) +
    expanded.candidates.length;
  const pricedProductCount = expanded.candidates.filter(
    (candidate) => Number.isFinite(candidate.retailPrice) || Number.isFinite(candidate.marketPrice),
  ).length + (parsed?.candidate && Number.isFinite(parsed.candidate.retailPrice) ? 1 : 0);
  const directRouteCount =
    expanded.candidates.filter((candidate) => {
      const url = candidate.routeFinalUrl || candidate.sourceUrl || "";
      return Boolean(url) && !routeTargetIsGeneric(url) && !isSearchLikeUrl(url);
    }).length +
    lotteryCandidates.filter((route) => {
      const url = route.applyUrl || route.sourceUrl || route.url || "";
      return Boolean(url) && !routeTargetIsGeneric(url) && !isSearchLikeUrl(url);
    }).length;
  const genericNoiseCount = Math.max(0, generatedProductCount - specificProductNames.length);
  const rootDocument = buildDocumentRecord(source, result, {
    extractedProductCount: generatedProductCount,
    routeHitCount: lotteryCandidates.length,
    useful: result.ok && (generatedProductCount > 0 || lotteryCandidates.length > 0),
  });
  const rootDiscoveredSources = extractDiscoveredSourcesFromResult(source, result, {
    docId: rootDocument.docId,
    productNames: specificProductNames,
    routeHitCount: lotteryCandidates.length,
  });
  for (const discovered of rootDiscoveredSources) {
    mergeDiscoveredSourceIntoRegistry(discovered);
  }
  for (const discovered of expanded.discoveredSources) {
    mergeDiscoveredSourceIntoRegistry(discovered);
  }
  rootDocument.discoveredSourceCount = rootDiscoveredSources.length;
  snapshot.documents.push(rootDocument);
  const rootStructuredExtraction = await buildStructuredLlmExtraction({
    docId: rootDocument.docId,
    source,
    result,
    evidenceProducts: specificProductNames,
    extractedCandidates: expanded.candidates,
  });
  snapshot.llmExtractions.push(rootStructuredExtraction);
  const rootLlmCandidates = buildCandidatesFromLlmExtraction(
    rootStructuredExtraction,
    source,
    result.fetchedAt.slice(0, 10),
    sourceReliabilityLevel(source, result.url),
  );
  if (!source.hideFromDiscovery) {
    snapshot.discoveryCandidates.push(...rootLlmCandidates);
  }
  if (!source.hideFromTrends) {
    snapshot.trends.push(
      ...buildTrendsFromLlmExtraction(
        rootStructuredExtraction,
        source,
        result.fetchedAt.slice(0, 10),
        source.trend?.source ?? source.keyword ?? "監視ソース",
      ),
    );
  }
  await archiveFetchedDocument({
    ...rootDocument,
    html: result.html ?? "",
    text: result.text ?? "",
    outLinks: extractLinksFromHtml(result.html ?? "", result.url ?? source.url).slice(0, 50),
    evidenceProducts: specificProductNames,
    discoveredSourceKeys: rootDiscoveredSources.map((item) => item.sourceKey),
    adoptionReason: existingRegistryEntry.lastDecisionReason ?? "",
  });

  const updatedSourceEntry = applyRunOutcomeToRegistryEntry(existingRegistryEntry, {
    success: result.ok,
    useful: result.ok && (generatedProductCount > 0 || lotteryCandidates.length > 0),
    fetchedAt: result.fetchedAt,
    keywordHint: source.keyword,
    titleHint: result.title ?? source.keyword,
    productHitCount: generatedProductCount,
    routeHitCount: lotteryCandidates.length,
    priceHitCount: pricedProductCount,
    directRouteCount,
    specificProductCount: specificProductNames.length,
    genericNoiseCount,
    evidenceDocs: [rootDocument.docId, ...expanded.documents.map((document) => document.docId)],
    evidenceProducts: specificProductNames,
  });
  registryByKey.set(source.sourceKey, updatedSourceEntry);

  publicResult.sourceKey = source.sourceKey;
  publicResult.lane = source.lane;
  publicResult.seed = Boolean(source.seed);
  publicResult.registryStatus = existingRegistryEntry.status;
  publicResult.discoveredSourceCount = rootDiscoveredSources.length + expanded.discoveredSources.length;
  publicResult.extractedProductCount = generatedProductCount;
  publicResult.routeHitCount = lotteryCandidates.length;
  sourceResults.push(publicResult);
}

snapshot.documents = Array.from(new Map(snapshot.documents.map((document) => [document.docId, document])).values());
registry.entries = promoteRegistryEntries([...registryByKey.values()]);
registry.updatedAt = snapshot.metadata.updatedAt;
snapshot.sourceRegistrySummary = summarizeRegistry(registry.entries);
for (const entry of registry.entries) {
  const before = registryStatusBefore.get(entry.sourceKey) ?? (entry.seed ? "manual" : null);
  if (before !== "trial" && entry.status === "trial") {
    sourceDiscoveryResults.promotedToTrial.push({ sourceKey: entry.sourceKey, lane: entry.lane, url: entry.canonicalUrl });
  }
  if (before !== "active" && entry.status === "active") {
    sourceDiscoveryResults.promotedToActive.push({ sourceKey: entry.sourceKey, lane: entry.lane, url: entry.canonicalUrl });
  }
  if (before !== "blocked" && entry.status === "blocked") {
    sourceDiscoveryResults.blockedSources.push({ sourceKey: entry.sourceKey, lane: entry.lane, url: entry.canonicalUrl });
  }
  if (before !== "archived" && entry.status === "archived") {
    sourceDiscoveryResults.archivedSources.push({ sourceKey: entry.sourceKey, lane: entry.lane, url: entry.canonicalUrl });
  }
}
await writeSourceRegistry(registry);

snapshot.trends = Array.from(
  new Map(
    snapshot.trends.map((trend) => [normalizeSignalText(`${trend.keyword}|${trend.startDate ?? ""}`), trend]),
  ).values(),
)
  .filter((trend) => productPhraseLooksSpecific(trend.keyword))
  .filter((trend) => !isMonitorOnlyName(trend.keyword));

const mergedCandidates = new Map();
for (const candidate of snapshot.discoveryCandidates) {
  const key = normalizeSignalText(candidate.name);
  if (!key) continue;
  const previous = mergedCandidates.get(key);
  mergedCandidates.set(key, previous ? mergeCandidateRecords(previous, candidate) : candidate);
}
snapshot.discoveryCandidates = [...mergedCandidates.values()];
snapshot.discoveryCandidates = snapshot.discoveryCandidates
  .filter((candidate) => productPhraseLooksSpecific(candidate.name))
  .filter((candidate) => !isMonitorOnlyName(candidate.name));

snapshot.lotteryRoutes = Array.from(
  new Map(snapshot.lotteryRoutes.map((route) => [`${normalizeSignalText(route.name)}|${route.sourceUrl}`, route])).values(),
).filter((route) => productPhraseLooksSpecific(route.name));

snapshot.routeVerificationResults = await verifyPokemonRouteTargets(snapshot.pokemonReleases);
const specializedMarketMap = await collectSpecializedCandidateMarkets(snapshot.discoveryCandidates);

snapshot.trends = snapshot.trends.map((trend) => {
  const support = computeHistorySupport(historyRuns, trend.keyword);
  return {
    ...trend,
    historyHits: support.hits,
    historyRecentHits: support.recentHits,
    historyLastSeen: support.lastSeen,
  };
});

const nowMs = Date.now();
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const trendPool = [];
const archivedConcrete = [];
for (const trend of snapshot.trends) {
  const baseKeyword = String(trend.keyword ?? "").trim();
  if (!baseKeyword) continue;
  const startMs = trend.startDate ? Date.parse(trend.startDate) : Number.NaN;
  const isSpecific = !/品薄|完売|プレ値|新作|コラボ|話題|急上昇/i.test(baseKeyword);
  const broadKeyword = baseKeyword
    .replace(/（.*?）/g, "")
    .replace(/\s*[-/:：].*$/, "")
    .trim();
  trendPool.push({ keyword: baseKeyword, type: "specific", source: trend.source, startDate: trend.startDate ?? null });
  if (broadKeyword && broadKeyword !== baseKeyword) {
    trendPool.push({ keyword: broadKeyword, type: "broad", source: trend.source, startDate: trend.startDate ?? null });
  }
  if (Number.isFinite(startMs) && startMs < nowMs + sevenDaysMs && isSpecific) {
    archivedConcrete.push({
      keyword: baseKeyword,
      source: trend.source,
      startDate: trend.startDate ?? null,
      endDate: trend.endDate ?? null,
      reason: "急上昇表示条件外（開始まで7日未満）",
    });
  }
}
snapshot.trendCollectionPool = trendPool;
snapshot.archivedConcreteTrends = archivedConcrete;

snapshot.discoveryCandidates = snapshot.discoveryCandidates.map((candidate) => {
  const support = computeHistorySupport(historyRuns, candidate.name);
  const estimated = estimateCandidateMarketPrice(snapshot, historyRuns, candidate);
  const specialized = specializedMarketMap.get(candidate.name) ?? null;
  const retailEstimated = estimateCandidateRetailPrice(snapshot, historyRuns, candidate);
  const learning = yearlyLearningMap.get(normalizeSignalText(candidate.name)) ?? null;
  const channel = candidate.sourceChannel ?? detectSourceChannel({ trend: { type: candidate.trend, context: candidate.reason } }, candidate.sourceUrl);
  const startKnown = Boolean(candidate.startDate);
  const endKnown = Boolean(candidate.endDate);
  const hasRoute = Boolean(candidate.sourceUrl);
  const hasPrice = Boolean(specialized?.marketPrice || estimated?.marketPrice || candidate.marketPrice || retailEstimated?.retailPrice);
  const freshnessDays = candidate.startDate
    ? Math.max(0, Math.floor((Date.now() - new Date(`${String(candidate.startDate).slice(0, 10)}T00:00:00+09:00`).getTime()) / 86_400_000))
    : 7;
  const axis = scoreCandidateByAxes({
    freshnessDays,
    hasRoute,
    hasPeriod: startKnown && endKnown,
    hasPrice,
    repeatHits: support.recentHits + (learning?.mentions ? Math.min(3, Math.floor(learning.mentions / 4)) : 0),
  });
  const sourceBoost =
    /pokemon-card\.com|pokemoncenter-online\.com/.test(String(candidate.sourceUrl ?? ""))
      ? 8
      : /nyuka-now\.com|membercard\.jp|dmm\.com|p-bandai\.jp/.test(String(candidate.sourceUrl ?? ""))
        ? 5
        : channel === "official"
          ? 4
          : channel === "blog"
            ? 2
            : 1;
  const learnedBoost = learning ? clampNumber(Math.floor(learning.mentions / 3), 0, 8) : 0;
  const normalizedScore = clampNumber(
    Math.max(candidate.genreScore ?? 0, axis.total) + sourceBoost + learnedBoost,
    35,
    98,
  );
  const missingItems = String(candidate.missingData ?? "")
    .split(/[、,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !((specialized?.marketPrice || estimated?.marketPrice) && /成約価格|相場/.test(item)))
    .filter((item) => !(retailEstimated?.retailPrice && /定価|価格データ/.test(item)));
  if (!(candidate.startDate && candidate.endDate)) missingItems.push("期間情報");
  if (!hasRoute) missingItems.push("公式導線");
  if (!(specialized?.marketPrice || estimated?.marketPrice || candidate.marketPrice)) missingItems.push("相場価格");
  if (!(retailEstimated?.retailPrice || candidate.retailPrice)) missingItems.push("公式価格");
  const dedupMissing = [...new Set(missingItems)];
  const inferredConfidence =
    normalizedScore >= 84 ? "高" : normalizedScore >= 68 ? "中" : "低";
  const enrichedCandidate = {
    ...candidate,
    marketPrice: specialized?.marketPrice ?? estimated?.marketPrice ?? candidate.marketPrice ?? null,
    marketPriceLabel: specialized?.marketPriceLabel ?? estimated?.marketPriceLabel ?? candidate.marketPriceLabel ?? null,
    marketPriceSource: specialized?.marketPriceSource ?? estimated?.marketPriceSource ?? candidate.marketPriceSource ?? null,
    marketPriceSourceRank:
      specialized?.marketPriceSourceRank ?? estimated?.marketPriceSourceRank ?? candidate.marketPriceSourceRank ?? null,
    marketPriceUsage:
      specialized?.marketPriceUsage ?? estimated?.marketPriceUsage ?? candidate.marketPriceUsage ?? null,
    marketPriceBuyLineEligible:
      specialized?.marketPriceBuyLineEligible ??
      estimated?.marketPriceBuyLineEligible ??
      candidate.marketPriceBuyLineEligible ??
      false,
    marketObservedAt: specialized?.marketObservedAt ?? candidate.marketObservedAt ?? null,
    retailPrice: retailEstimated?.retailPrice ?? candidate.retailPrice ?? null,
    retailPriceLabel: retailEstimated?.retailPriceLabel ?? candidate.retailPriceLabel ?? null,
    retailPriceSource: retailEstimated?.retailPriceSource ?? candidate.retailPriceSource ?? null,
    retailPriceSourceRank: retailEstimated?.retailPriceSourceRank ?? candidate.retailPriceSourceRank ?? null,
    retailPriceUsage: retailEstimated?.retailPriceUsage ?? candidate.retailPriceUsage ?? null,
    retailPriceBuyLineEligible: retailEstimated?.retailPriceBuyLineEligible ?? candidate.retailPriceBuyLineEligible ?? false,
    missingData: dedupMissing.join("、"),
    historyHits: support.hits,
    historyRecentHits: support.recentHits,
    historyLastSeen: support.lastSeen,
    sourceChannel: channel,
    sourceReliability: candidate.sourceReliability ?? sourceReliabilityLevel({ trend: { type: candidate.trend } }, candidate.sourceUrl),
    genreScore: normalizedScore,
    scoreAxes: axis,
    confidence:
      candidate.confidence === "高" || inferredConfidence === "高"
        ? "高"
        : candidate.confidence === "中" || inferredConfidence === "中"
          ? "中"
          : "低",
    learningMentions1y: learning?.mentions ?? 0,
  };
  const state = deriveCandidateState(enrichedCandidate);
  return {
    ...enrichedCandidate,
    candidateState: state.candidateState,
    insufficiencyReasons: state.insufficiencyReasons,
  };
});

const candidateRouteVerification = await verifyCandidateRouteTargets(snapshot.discoveryCandidates);
snapshot.discoveryCandidates = candidateRouteVerification.candidates.map((candidate) => {
  const state = deriveCandidateState(candidate);
  return {
    ...candidate,
    candidateState: state.candidateState,
    insufficiencyReasons: state.insufficiencyReasons,
  };
});
snapshot.candidateRouteVerificationResults = candidateRouteVerification.results;
snapshot.normalizedProducts = buildNormalizedProducts(snapshot);
snapshot.routeSnapshots = buildRouteSnapshots(snapshot);
snapshot.priceSnapshots = buildPriceSnapshots(snapshot);
snapshot.productEvents = deriveProductEvents(snapshot);
snapshot.historicalComparables = buildHistoricalComparables(snapshot, yearlyLearningMap);
snapshot.predictedPriceSnapshots = buildPredictedPriceSnapshots(snapshot, snapshot.historicalComparables, yearlyLearningMap);
snapshot.selectionReasons = buildSelectionReasons(snapshot, yearlyLearningMap);
snapshot.explorationTasks = buildExplorationTasks(snapshot, registry.entries, yearlyLearning);
const marketplaceEnriched = applyMarketplaceResearchToSnapshot(snapshot, {
  maxSubjects: observationLimits.marketplaceSubjectLimit,
});
snapshot.marketplaceResearchTargets = marketplaceEnriched.marketplaceResearchTargets;
snapshot.realtimeResearchTargets = marketplaceEnriched.realtimeResearchTargets;
snapshot.socialSearchSignals = Array.isArray(existingSnapshotOnDisk?.socialSearchSignals)
  ? existingSnapshotOnDisk.socialSearchSignals
  : marketplaceEnriched.socialSearchSignals;
snapshot.browserObservationQueue = Array.isArray(existingSnapshotOnDisk?.browserObservationQueue)
  ? existingSnapshotOnDisk.browserObservationQueue
  : [];
snapshot.marketplaceObservationQueue = Array.isArray(existingSnapshotOnDisk?.marketplaceObservationQueue)
  ? existingSnapshotOnDisk.marketplaceObservationQueue
  : [];
snapshot.marketplaceSignals = Array.isArray(existingSnapshotOnDisk?.marketplaceSignals)
  ? existingSnapshotOnDisk.marketplaceSignals
  : marketplaceEnriched.marketplaceSignals;
snapshot.explorationTasks = marketplaceEnriched.explorationTasks;
snapshot.metadata = marketplaceEnriched.metadata;
snapshot.normalizedProducts = enrichNormalizedProductsWithAi(snapshot, yearlyLearningMap);
snapshot.discoveryCandidates = enrichCandidatesWithAi(snapshot);
snapshot.llmExtractions = pruneLlmExtractions(snapshot.llmExtractions, 20);
const previousSnapshot = historyRuns.length > 0 ? historyRuns[historyRuns.length - 1]?.snapshot ?? null : null;
const fallbackOverviewNarrative = buildHeuristicOverviewNarrative(snapshot, previousSnapshot);
snapshot.overviewNarrative = fallbackOverviewNarrative;
if (configuredLlmProvider !== "heuristic" && llmProviderConfigured()) {
  llmExecutionStats.overviewRequested = 1;
  try {
    const llmOverviewNarrative = await requestLlmOverviewNarrative(snapshot, previousSnapshot);
    if (llmOverviewNarrative?.text) {
      snapshot.overviewNarrative = llmOverviewNarrative;
      llmExecutionStats.overviewSucceeded = 1;
      llmExecutionStats.overviewFailed = 0;
      llmExecutionStats.overviewFallbackReason = "";
    } else {
      llmExecutionStats.overviewSucceeded = 0;
      llmExecutionStats.overviewFailed = 1;
      llmExecutionStats.overviewFallbackReason = `${configuredLlmProvider}_overview_empty`;
      snapshot.overviewNarrative = {
        ...fallbackOverviewNarrative,
        fallbackReason: llmExecutionStats.overviewFallbackReason,
      };
    }
  } catch (error) {
    llmExecutionStats.overviewSucceeded = 0;
    llmExecutionStats.overviewFailed = 1;
    llmExecutionStats.overviewFallbackReason = String(error?.message ?? error ?? `${configuredLlmProvider}_overview_failed`);
    snapshot.overviewNarrative = {
      ...fallbackOverviewNarrative,
      error: llmExecutionStats.overviewFallbackReason,
      fallbackReason: llmExecutionStats.overviewFallbackReason,
    };
  }
} else {
  llmExecutionStats.overviewRequested = 0;
  llmExecutionStats.overviewSucceeded = 0;
  llmExecutionStats.overviewFailed = 0;
  llmExecutionStats.overviewFallbackReason = llmProviderMissingReason(configuredLlmProvider);
  snapshot.overviewNarrative = {
    ...fallbackOverviewNarrative,
    fallbackReason: llmExecutionStats.overviewFallbackReason,
  };
}
const candidateKpi = summarizeCandidateKpi(snapshot.discoveryCandidates);

const okCount = sourceResults.filter((result) => result.ok).length;
snapshot.metadata.status = okCount === sourceResults.length ? "collected" : "partial";
snapshot.metadata.reachableSources = okCount;
snapshot.metadata.totalSources = sourceResults.length;
snapshot.metadata.manualDeals = snapshot.deals.length;
snapshot.metadata.verifiedRouteTargets = snapshot.routeVerificationResults.filter((result) => result.ok).length;
snapshot.metadata.totalRouteTargets = snapshot.routeVerificationResults.length;
snapshot.metadata.verifiedCandidateRouteTargets = snapshot.candidateRouteVerificationResults.filter((result) => result.ok).length;
snapshot.metadata.totalCandidateRouteTargets = snapshot.candidateRouteVerificationResults.length;
snapshot.metadata.candidateRouteFailures =
  snapshot.metadata.totalCandidateRouteTargets - snapshot.metadata.verifiedCandidateRouteTargets;
snapshot.metadata.candidateKpi = candidateKpi;
snapshot.metadata.documentCount = snapshot.documents.length;
snapshot.metadata.normalizedProductCount = snapshot.normalizedProducts.length;
snapshot.metadata.productEventCount = snapshot.productEvents.length;
snapshot.metadata.routeSnapshotCount = snapshot.routeSnapshots.length;
snapshot.metadata.priceSnapshotCount = snapshot.priceSnapshots.length;
snapshot.metadata.predictedPriceSnapshotCount = snapshot.predictedPriceSnapshots.length;
snapshot.metadata.historicalComparableCount = snapshot.historicalComparables.length;
snapshot.metadata.explorationTaskCount = snapshot.explorationTasks.length;
snapshot.metadata.aiThesisCount = snapshot.normalizedProducts.filter((product) => product.aiThesis?.whyHot).length;
snapshot.metadata.priceThesisCount = snapshot.normalizedProducts.filter((product) => product.priceThesis?.estimatedMarketPrice).length;
snapshot.metadata.aiThesisSourceModeCounts = snapshot.normalizedProducts.reduce((acc, product) => {
  const mode = String(product.aiThesis?.sourceMode ?? "").trim();
  if (!mode) return acc;
  acc[mode] = (acc[mode] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.priceThesisSourceModeCounts = snapshot.normalizedProducts.reduce((acc, product) => {
  const mode = String(product.priceThesis?.sourceMode ?? "").trim();
  if (!mode) return acc;
  acc[mode] = (acc[mode] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.llmExtractionCount = snapshot.llmExtractions.length;
snapshot.metadata.selectionReasonCount = snapshot.selectionReasons.length;
snapshot.metadata.registrySources = snapshot.sourceRegistrySummary.total ?? 0;
snapshot.metadata.candidateStatusCounts = snapshot.discoveryCandidates.reduce((acc, candidate) => {
  const state = String(candidate.candidateState || candidate.candidateStatus || candidate.status || "missing");
  acc[state] = (acc[state] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.candidateStateCounts = { ...snapshot.metadata.candidateStatusCounts };
snapshot.metadata.priceSourceRankCounts = snapshot.priceSnapshots.reduce((acc, price) => {
  const rank = String(price.priceSourceRank ?? "missing");
  acc[rank] = (acc[rank] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.predictedPriceSourceRankCounts = snapshot.predictedPriceSnapshots.reduce((acc, price) => {
  const rank = String(price.priceSourceRank ?? "missing");
  acc[rank] = (acc[rank] ?? 0) + 1;
  return acc;
}, {});
snapshot.productLearning = yearlyLearning;
snapshot.metadata.learningProducts1y = yearlyLearning.length;
snapshot.metadata.overviewNarrativeMode = snapshot.overviewNarrative?.sourceMode ?? "heuristic";
snapshot.metadata.overviewNarrativeError = snapshot.overviewNarrative?.error ?? null;
const browserObservationResult = await collectBrowserObservationSignals({
  snapshot,
  enabled: browserObservationEnabled,
  limit: realtimeBrowserObservationLimit,
  timeoutMs: browserObservationTimeoutMs,
});
snapshot.browserObservationQueue = browserObservationResult.browserObservationQueue;
snapshot.socialSearchSignals = browserObservationResult.socialSearchSignals;
snapshot.realtimeResearchTargets = browserObservationResult.realtimeResearchTargets;

const marketplaceObservationResult = await collectMarketplaceObservationSignals({
  snapshot,
  enabled: browserObservationEnabled,
  limit: marketplaceBrowserObservationLimit,
  timeoutMs: marketplaceObservationTimeoutMs,
});
snapshot.marketplaceObservationQueue = marketplaceObservationResult.marketplaceObservationQueue;
snapshot.marketplaceSignals = marketplaceObservationResult.marketplaceSignals;

const xReaderResult = await collectXReaderSocialSignals({
  rawArchiveDirUrl,
  snapshot,
  enabled: xReaderEnabled,
  limit: xReaderLimit,
  timeoutMs: xReaderTimeoutMs,
  maxQueueSize: xQueueLimit,
});
snapshot.xObservationQueue = xReaderResult.queue;
snapshot.socialSignals = xReaderResult.socialSignals;
snapshot.metadata = {
  ...(snapshot.metadata ?? {}),
  observationLimits,
  browserObservationQueueSummary: browserObservationResult.queueSummary,
  browserObservationExecution: {
    ...browserObservationResult.execution,
    batchLimit: browserObservationLimit,
    realtimeBatchLimit: realtimeBrowserObservationLimit,
  },
  marketplaceObservationQueueSummary: marketplaceObservationResult.queueSummary,
  marketplaceObservationExecution: {
    ...marketplaceObservationResult.execution,
    batchLimit: marketplaceBrowserObservationLimit,
    sharedBatchLimit: browserObservationLimit,
  },
  marketplaceSignalCount: snapshot.marketplaceSignals.length,
  socialSearchSignalCount: snapshot.socialSearchSignals.length,
  xObservationQueueSummary: xReaderResult.queueSummary,
  xReaderExecution: {
    ...xReaderResult.execution,
    queueLimit: xQueueLimit,
  },
};
snapshot.metadata.llmExecution = summarizeLlmExecution(snapshot);
const snapshotWriteGuard = evaluateSnapshotWriteProtection(snapshot, existingSnapshotOnDisk, { reachableSources: okCount });
snapshot.metadata.collectGuard = {
  degraded: snapshotWriteGuard.degraded,
  status: snapshotWriteGuard.allowWrite ? "ok" : "degraded",
  reasons: snapshotWriteGuard.reasons,
  current: snapshotWriteGuard.current,
  previous: snapshotWriteGuard.previous,
  thresholds: snapshotWriteGuard.thresholds,
  wroteSnapshot: snapshotWriteGuard.allowWrite,
  wrotePartialSnapshot: !snapshotWriteGuard.allowWrite && Boolean(existingSnapshotOnDisk),
};

if (!snapshotWriteGuard.allowWrite && existingSnapshotOnDisk) {
  await writeFile(partialOutputUrl, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `MarketLens partial snapshot written: ${okCount}/${sourceResults.length} sources reachable (preserved existing snapshot; reasons=${snapshotWriteGuard.reasons.join(",")})`,
  );
  process.exit(2);
}

await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`);

history.updatedAt = snapshot.metadata.updatedAt;
history.runs.push({
  id: snapshot.metadata.updatedAt,
  savedAt: new Date().toISOString(),
  snapshot: compactSnapshotForHistory(snapshot),
});

await writeFile(historyUrl, `${JSON.stringify(history, null, 2)}\n`);
await writeFile(publicHistoryUrl, `${JSON.stringify(buildPublicHistory(history.runs), null, 2)}\n`);

console.log(`MarketLens snapshot written: ${okCount}/${sourceResults.length} sources reachable`);
process.exit(0);
