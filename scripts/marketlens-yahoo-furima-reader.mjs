/**
 * marketlens-yahoo-furima-reader.mjs — Yahoo!フリマ 売却/出品観測（参考）
 */

import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";
import { compactText, candidateJpyPrice } from "./marketlens-shared.mjs";

const JPY_PRICE_RE = /[¥￥]\s*([\d,]+)/g;

export function buildYahooFurimaSearchUrl(query = "") {
  const q = encodeURIComponent(compactText(query));
  return `https://paypayfleamarket.yahoo.co.jp/search/${q}`;
}

export function parseYahooFurimaMarkdown(raw = "", query = "") {
  const text = String(raw ?? "");
  const candidates = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/paypayfleamarket\.yahoo\.co\.jp|sold|SOLD|売り切れ/i.test(line)) continue;
    const priceMatch = line.match(/[¥￥]\s*([\d,]+)/);
    if (!priceMatch) continue;
    const value = Number(priceMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const status = /売り切れ|SOLD|sold/i.test(line) ? "sold" : "on_sale";
    candidates.push({
      value,
      currency: "JPY",
      rawPriceText: priceMatch[0],
      title: compactText(line).slice(0, 120),
      status,
      observedAt: new Date().toISOString(),
    });
    if (candidates.length >= 10) break;
  }
  return {
    query,
    listingCandidates: candidates.filter((c) => c.status === "on_sale"),
    soldCandidates: candidates.filter((c) => c.status === "sold"),
    observationStatus: candidates.length ? "succeeded" : "no_results",
  };
}

export async function fetchYahooFurimaSearch(query, timeoutMs = 15000) {
  const searchUrl = buildYahooFurimaSearchUrl(query);
  const readerUrl = buildJinaReaderUrl(searchUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(readerUrl, {
      headers: { Accept: "text/plain", "X-Return-Format": "markdown" },
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, body, searchUrl };
  } catch {
    return { ok: false, body: "", searchUrl };
  } finally {
    clearTimeout(timer);
  }
}

export async function collectYahooFurimaSignals(snapshot = {}, { limit = 5 } = {}) {
  const targets = (snapshot.marketplaceResearchTargets ?? [])
    .filter((row) => row.provider === "yahoo_furima" || row.marketplace === "yahoo_furima")
    .slice(0, limit);
  if (!targets.length) {
    const fallback = (snapshot.productGroups ?? []).slice(0, limit).map((g) => ({
      productKey: g.canonicalName,
      productName: g.canonicalName,
      query: g.canonicalName,
      provider: "yahoo_furima",
    }));
    targets.push(...fallback);
  }

  const incoming = [];
  for (const target of targets.slice(0, limit)) {
    const query = compactText(target.query ?? target.productName ?? "");
    if (!query) continue;
    const fetched = await fetchYahooFurimaSearch(query);
    const parsed = parseYahooFurimaMarkdown(fetched.body, query);
    incoming.push({
      marketplace: "yahoo_furima",
      productKey: target.productKey ?? query,
      productName: target.productName ?? query,
      query,
      searchUrl: fetched.searchUrl,
      listingCandidates: parsed.listingCandidates,
      soldCandidates: parsed.soldCandidates,
      observedAt: new Date().toISOString(),
      sourceMode: "yahoo_furima_reader",
      buyLineEligible: false,
    });
  }
  return incoming;
}
