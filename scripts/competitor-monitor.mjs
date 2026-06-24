/**
 * competitor-monitor.mjs — Layer 6: 転売大手20アカウントの先回り判定
 */

import { readFile, writeFile } from "node:fs/promises";
import { buildYahooRealtimeSearchUrl } from "./marketlens-observation.mjs";
import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";
import { parseYahooRealtimeMarkdown } from "./marketlens-yahoo-realtime-reader.mjs";
import { compactText, normalizeProductKey } from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const competitorUrl = new URL("../data/competitor-accounts.json", import.meta.url);
const TIMEOUT_MS = Math.max(5000, Math.min(30000, Number(process.env.MARKETLENS_COMPETITOR_TIMEOUT_MS ?? 15000)));

async function fetchQuery(query) {
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

async function main() {
  const [snapshotRaw, competitorRaw] = await Promise.all([
    readFile(snapshotUrl, "utf8"),
    readFile(competitorUrl, "utf8").catch(() => '{"accounts":[]}'),
  ]);
  const snapshot = JSON.parse(snapshotRaw);
  const competitorData = JSON.parse(competitorRaw);
  const accounts = (competitorData.accounts ?? []).slice(0, 20);

  const ourProducts = new Map(
    (snapshot.productGroups ?? [])
      .filter((g) => g.judgment?.decisionOrigin === "gemini")
      .map((g) => [normalizeProductKey(g.canonicalName), g]),
  );

  const results = [];
  for (const account of accounts) {
    const handle = compactText(account.handle ?? account).replace(/^@/, "");
    if (!handle) continue;
    const query = `from:${handle} (プレ値 OR 即完売 OR 転売)`;
    const fetched = await fetchQuery(query);
    if (!fetched.ok) {
      results.push({ handle, status: "fetch_failed", beatCount: 0, missCount: 0 });
      continue;
    }
    const parsed = parseYahooRealtimeMarkdown(fetched.body, query);
    let beatCount = 0;
    let missCount = 0;
    for (const sample of parsed.samples ?? []) {
      const textKey = normalizeProductKey(sample.text ?? "");
      for (const [key, group] of ourProducts.entries()) {
        if (textKey.includes(key.slice(0, Math.min(12, key.length)))) {
          const ourAt = group.judgment?.rejudgedAt ?? snapshot.metadata?.updatedAt;
          beatCount += 1;
          break;
        }
      }
    }
    results.push({
      handle,
      status: parsed.observationStatus,
      sampleCount: parsed.samples?.length ?? 0,
      beatCount,
      missCount,
    });
  }

  const beatRate = results.length
    ? Number((results.reduce((sum, row) => sum + row.beatCount, 0) / Math.max(1, ourProducts.size)).toFixed(3))
    : 0;

  snapshot.competitorMonitor = {
    observedAt: new Date().toISOString(),
    accountCount: accounts.length,
    beatRate,
    results,
  };
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[competitor-monitor] accounts=${accounts.length} beatRate=${beatRate}`);
}

main().catch((error) => {
  console.error("[competitor-monitor] fatal:", error?.message ?? error);
  process.exit(1);
});
