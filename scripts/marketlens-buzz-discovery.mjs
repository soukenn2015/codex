/**
 * marketlens-buzz-discovery.mjs
 *
 * Yahoo!リアルタイム検索でバズ商品シグナルを収集する。
 * source-config.json の buzzQueries を巡回し、socialSearchSignals に buzzEligible=true で保存する。
 */

import { readFile, writeFile } from "node:fs/promises";
import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";
import { buildYahooRealtimeSearchUrl } from "./marketlens-observation.mjs";
import { parseYahooRealtimeMarkdown, socialSearchSignalKey } from "./marketlens-yahoo-realtime-reader.mjs";
import { computeBuzzHeatScore, extractHandlesFromSamples } from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const sourceConfigUrl = new URL("../data/source-config.json", import.meta.url);
const buzzQueriesFileUrl = new URL("../data/buzz-queries.json", import.meta.url);
const TIMEOUT_MS = Math.max(5000, Math.min(45000, Number(process.env.MARKETLENS_BUZZ_TIMEOUT_MS ?? 18000)));
const QUERY_LIMIT = Math.max(1, Math.min(600, Number(process.env.MARKETLENS_BUZZ_QUERY_LIMIT ?? 100)));
const BATCH_OFFSET = Math.max(0, Number(process.env.MARKETLENS_BUZZ_BATCH_OFFSET ?? 0));
const HEAT_THRESHOLD = Number(process.env.MARKETLENS_BUZZ_HEAT_THRESHOLD ?? 1000);

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function buildBuzzRealtimeTarget(queryRow = {}) {
  const query = compactText(queryRow.query ?? "");
  if (!query) return null;
  const id = compactText(queryRow.id ?? "") || `buzz:${query.slice(0, 32)}`;
  const searchUrl = buildYahooRealtimeSearchUrl(query);
  if (!searchUrl) return null;
  return {
    id: `realtime:buzz:${id}`,
    productKey: `buzz:${id}`,
    productName: compactText(queryRow.label ?? query),
    provider: "yahoo_realtime",
    query,
    observationQuery: query,
    searchUrl,
    label: "バズ検出",
    reason: "Yahoo!リアルタイム検索で一般層バズを検出",
    sourceMode: "buzz_discovery",
    status: "pending",
    buyLineEligible: false,
    buzzEligible: true,
    targetCategory: "buzz",
    origin: "buzz_discovery",
    minFaves: Number(queryRow.minFaves ?? 0) || null,
  };
}

async function fetchBuzzQuery(query, timeoutMs) {
  const searchUrl = buildYahooRealtimeSearchUrl(query);
  const readerUrl = buildJinaReaderUrl(searchUrl);
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
      body,
      error: response.ok ? null : `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? "fetch_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const [snapshotRaw, sourceConfigRaw, buzzQueriesRaw] = await Promise.all([
    readFile(snapshotUrl, "utf8"),
    readFile(sourceConfigUrl, "utf8"),
    readFile(buzzQueriesFileUrl, "utf8").catch(() => ""),
  ]);
  const snapshot = JSON.parse(snapshotRaw);
  const sourceConfig = JSON.parse(sourceConfigRaw);
  let buzzQueries = [];
  if (buzzQueriesRaw) {
    try {
      const parsed = JSON.parse(buzzQueriesRaw);
      buzzQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
    } catch {
      buzzQueries = [];
    }
  }
  if (!buzzQueries.length) {
    buzzQueries = Array.isArray(sourceConfig.buzzQueries) ? sourceConfig.buzzQueries : [];
  }
  buzzQueries = buzzQueries.slice(BATCH_OFFSET, BATCH_OFFSET + QUERY_LIMIT);
  const observedAt = new Date().toISOString();

  if (!buzzQueries.length) {
    console.log("[buzz-discovery] no buzzQueries configured; skipping");
    return;
  }

  console.log(`[buzz-discovery] processing ${buzzQueries.length} queries (timeout=${TIMEOUT_MS}ms)`);

  const incomingSignals = [];
  const execution = {
    requested: buzzQueries.length,
    succeeded: 0,
    failed: 0,
    byStatus: {},
    queries: [],
  };

  for (const queryRow of buzzQueries) {
    const query = compactText(queryRow.query ?? "");
    const fetched = await fetchBuzzQuery(query, TIMEOUT_MS);
    if (!fetched.ok || !compactText(fetched.body)) {
      execution.failed += 1;
      execution.byStatus[fetched.error ?? "fetch_failed"] = (execution.byStatus[fetched.error ?? "fetch_failed"] ?? 0) + 1;
      execution.queries.push({ id: queryRow.id ?? query, query, status: fetched.error ?? "fetch_failed", sampleCount: 0 });
      continue;
    }

    const parsed = parseYahooRealtimeMarkdown(fetched.body, query);
    const status = parsed.observationStatus ?? "parse_failed";
    execution.byStatus[status] = (execution.byStatus[status] ?? 0) + 1;

    if (status === "succeeded" && (parsed.samples?.length ?? 0) > 0) {
      const maxHeat = Math.max(...(parsed.samples ?? []).map((sample) => sample.heatScore ?? computeBuzzHeatScore(sample)));
      const minFaves = Number(queryRow.minFaves ?? 0) || 0;
      const heatOk = minFaves > 0 && maxHeat > 0 ? maxHeat >= minFaves : true;
      if (!heatOk) {
        execution.failed += 1;
        execution.queries.push({ id: queryRow.id ?? query, query, status: "heat_below_threshold", sampleCount: parsed.samples.length, maxHeat });
        continue;
      }
      execution.succeeded += 1;
      incomingSignals.push({
        provider: "yahoo_realtime",
        query,
        searchUrl: buildYahooRealtimeSearchUrl(query),
        productKey: `buzz:${compactText(queryRow.id ?? query.slice(0, 24))}`,
        productName: compactText(queryRow.label ?? query),
        observedAt,
        sourceMode: "buzz_discovery",
        resultCountApprox: parsed.resultCountApprox ?? null,
        samples: parsed.samples ?? [],
        sampleTexts: (parsed.samples ?? []).map((sample) => sample.text).filter(Boolean),
        maxHeatScore: maxHeat,
        confidence: parsed.confidence ?? 0,
        parseWarnings: parsed.parseWarnings ?? [],
        observationStatus: status,
        buzzEligible: true,
      });
      execution.queries.push({
        id: queryRow.id ?? query,
        query,
        status,
        sampleCount: parsed.samples?.length ?? 0,
        resultCountApprox: parsed.resultCountApprox ?? null,
      });
    } else {
      execution.failed += 1;
      execution.queries.push({ id: queryRow.id ?? query, query, status, sampleCount: 0 });
    }
  }

  snapshot.socialSearchSignals = mergeSocialSearchSignals(snapshot.socialSearchSignals ?? [], incomingSignals);
  snapshot.buzzResearchTargets = buzzQueries.map((row) => buildBuzzRealtimeTarget(row)).filter(Boolean);
  snapshot.buzzDiscovery = {
    observedAt,
    execution,
    signalCount: incomingSignals.length,
    targetCount: snapshot.buzzResearchTargets.length,
    batchOffset: BATCH_OFFSET,
    queryLimit: QUERY_LIMIT,
    discoveredHandles: extractHandlesFromSamples(incomingSignals.flatMap((row) => row.samples ?? [])),
  };

  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(
    `[buzz-discovery] done: signals=${incomingSignals.length} targets=${snapshot.buzzResearchTargets.length} succeeded=${execution.succeeded} failed=${execution.failed}`,
  );
}

main().catch((error) => {
  console.error("[buzz-discovery] fatal:", error?.message ?? error);
  process.exit(1);
});
