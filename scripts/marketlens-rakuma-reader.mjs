/**
 * marketlens-rakuma-reader.mjs — ラクマ参考価格観測
 */

import { buildJinaReaderUrl } from "./marketlens-x-reader.mjs";
import { compactText } from "./marketlens-shared.mjs";

export function buildRakumaSearchUrl(query = "") {
  return `https://fril.jp/s?query=${encodeURIComponent(compactText(query))}`;
}

export function parseRakumaMarkdown(raw = "") {
  const candidates = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const priceMatch = line.match(/[¥￥]\s*([\d,]+)/);
    if (!priceMatch) continue;
    const value = Number(priceMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    candidates.push({
      value,
      currency: "JPY",
      rawPriceText: priceMatch[0],
      title: compactText(line).slice(0, 120),
      status: "on_sale",
      observedAt: new Date().toISOString(),
    });
    if (candidates.length >= 8) break;
  }
  return { listingCandidates: candidates, soldCandidates: [] };
}

export async function fetchRakumaSearch(query, timeoutMs = 15000) {
  const searchUrl = buildRakumaSearchUrl(query);
  const readerUrl = buildJinaReaderUrl(searchUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(readerUrl, {
      headers: { Accept: "text/plain", "X-Return-Format": "markdown" },
      signal: controller.signal,
    });
    return { ok: res.ok, body: await res.text(), searchUrl };
  } catch {
    return { ok: false, body: "", searchUrl };
  } finally {
    clearTimeout(timer);
  }
}
