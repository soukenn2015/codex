import { readFile, writeFile } from "node:fs/promises";

const configUrl = new URL("../data/source-config.json", import.meta.url);
const dealInputUrl = new URL("../data/deal-candidates.csv", import.meta.url);
const outputUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const historyUrl = new URL("../data/marketlens.history.json", import.meta.url);

const config = JSON.parse(await readFile(configUrl, "utf8"));

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSignalText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

function detectOfficialSignals(text) {
  const signalRules = [
    ["周年", /周年/],
    ["特設ページ", /特設ページ/],
    ["公式グッズ", /公式グッズ|グッズ/],
    ["コラボ", /コラボ|キャンペーン/],
    ["記念コンテンツ", /記念コンテンツ|記念/],
    ["発売予定", /発売|予約|販売/],
    ["X話題", /x\.com|twitter|ポスト|リポスト|いいね|トレンド/i],
    ["可愛い系", /ちいかわ|すみっコ|サンリオ|カービィ|マスコット|ぬいぐるみ|キーホルダー|かわいい|可愛い/i],
  ];
  return signalRules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function calculateOfficialScore(source, result, signals, text = "") {
  if (!result.ok || !result.keywordFound) return Math.min(source.trend?.score ?? 50, 50);
  const base = source.trend?.score ?? 62;
  const bonus = Math.min(9, signals.length * 2);
  const searchPenalty = isSearchLikeUrl(result.url || source.url) ? 8 : 0;
  const socialText = [source?.trend?.type, source?.trend?.context, source?.candidate?.reason, text].join(" ");
  const xBuzzBoost = /x\.com|twitter|sns監視|リアルタイム|トレンド/i.test(socialText) ? 6 : 0;
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
  const signals = detectOfficialSignals(text);
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
  const timeout = setTimeout(() => controller.abort(), 15000);
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

function candidateMarketQueries(candidate) {
  const name = candidate?.name ?? "";
  const queries = [];
  if (/GARRACK|スマートウォッチ|ONE PIECE/i.test(name)) {
    queries.push(`${name} スニダン`, `${name} メルカリ`, "GARRACK ONE PIECE スマートウォッチ");
  } else if (/ポケモンカードゲーム.*(シールド|プレイマット|サプライ)/i.test(name)) {
    queries.push(`${name} スニダン`, `${name} メルカリ`, "ポケモンカード プレイマット メルカリ");
  } else if (/G-SHOCK|GA-2100|Coca-Cola/i.test(name)) {
    queries.push(`${name} スニダン`, `${name} メルカリ`, "GA-2100CC-3AJR メルカリ");
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
  for (const candidate of candidates) {
    const queries = candidateMarketQueries(candidate);
    if (queries.length === 0) continue;
    const pageBuckets = [];
    for (const query of queries.slice(0, 2)) {
      const urls = [makeSearchUrl("https://snkrdunk.com/search?keyword=", query), ...makeMercariSoldLikeUrls(query)];
      for (const url of urls) {
        const result = await fetchSource({ id: `market:${candidate.name}:${url}`, url });
        if (result.ok && result.text) pageBuckets.push({ url, text: result.text });
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
      const values = extractedRows.map((row) => row.marketPrice).sort((a, b) => a - b);
      const marketPrice = values[Math.floor(values.length / 2)];
      results.set(candidate.name, {
        marketPrice,
        marketPriceLabel: `${candidate.name} 実売寄り相場 ${marketPrice.toLocaleString("ja-JP")}円`,
        marketPriceSource: `specialized-search(${extractedRows.length})/sold:${soldStrength.toFixed(2)}`,
      });
    }
  }
  return results;
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
    const path = parsed.pathname.replace(/\/+$/, "");
    return (
      path === "" ||
      path === "/" ||
      parsed.hostname === "www.amazon.co.jp" ||
      parsed.hostname === "www.pokemoncenter-online.com" ||
      /snkrdunk\.com$/.test(parsed.hostname)
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

function estimateCandidateMarketPrice(snapshot, historyRuns, candidate) {
  if (Number.isFinite(candidate.marketPrice)) {
    return {
      marketPrice: candidate.marketPrice,
      marketPriceLabel: candidate.marketPriceLabel ?? null,
      marketPriceSource: candidate.marketPriceSource ?? "candidate",
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
    };
  }

  const historyPrices = [];
  for (const run of historyRuns.slice(-30).reverse()) {
    const previous = (run.snapshot?.discoveryCandidates ?? []).find((item) => {
      const previousKey = normalizeSignalText(item.name);
      return previousKey && (previousKey.includes(key) || key.includes(previousKey));
    });
    if (previous && Number.isFinite(previous.marketPrice)) {
      historyPrices.push(previous.marketPrice);
    }
  }
  if (historyPrices.length > 0) {
    const sorted = [...historyPrices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      marketPrice: median,
      marketPriceLabel: `相場 ${median.toLocaleString("ja-JP")}円（履歴補完）`,
      marketPriceSource: "history-median",
    };
  }

  return null;
}

function estimateCandidateRetailPrice(snapshot, historyRuns, candidate) {
  if (Number.isFinite(candidate.retailPrice)) {
    return {
      retailPrice: candidate.retailPrice,
      retailPriceLabel: candidate.retailPriceLabel ?? null,
      retailPriceSource: candidate.retailPriceSource ?? "candidate",
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
    };
  }

  return null;
}

const sourceResults = [];
const history = await readJsonFile(historyUrl, {
  version: 1,
  runs: [],
});
const historyRuns = history.runs ?? [];
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
  sourceResults,
};

snapshot.deals = await loadDealCandidates();

for (const source of config.sources ?? []) {
  const result = await fetchSource(source);
  const { text, html, ...publicResult } = result;

  if (source.type === "pokemonRelease" && source.release) {
    snapshot.pokemonReleases.push(parseSnkrdunkPokemonRelease(source, result));
  }

  if (source.type === "trendCandidate") {
    const parsed = parseOfficialTrendCandidate(source, result);
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

  sourceResults.push(publicResult);
}

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
  const missingItems = String(candidate.missingData ?? "")
    .split(/[、,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !((specialized?.marketPrice || estimated?.marketPrice) && /成約価格|相場/.test(item)))
    .filter((item) => !(retailEstimated?.retailPrice && /定価|価格データ/.test(item)));
  return {
    ...candidate,
    marketPrice: specialized?.marketPrice ?? estimated?.marketPrice ?? candidate.marketPrice ?? null,
    marketPriceLabel: specialized?.marketPriceLabel ?? estimated?.marketPriceLabel ?? candidate.marketPriceLabel ?? null,
    marketPriceSource: specialized?.marketPriceSource ?? estimated?.marketPriceSource ?? candidate.marketPriceSource ?? null,
    retailPrice: retailEstimated?.retailPrice ?? candidate.retailPrice ?? null,
    retailPriceLabel: retailEstimated?.retailPriceLabel ?? candidate.retailPriceLabel ?? null,
    retailPriceSource: retailEstimated?.retailPriceSource ?? candidate.retailPriceSource ?? null,
    missingData: missingItems.join("、"),
    historyHits: support.hits,
    historyRecentHits: support.recentHits,
    historyLastSeen: support.lastSeen,
  };
});

const okCount = sourceResults.filter((result) => result.ok).length;
snapshot.metadata.status = okCount === sourceResults.length ? "collected" : "partial";
snapshot.metadata.reachableSources = okCount;
snapshot.metadata.totalSources = sourceResults.length;
snapshot.metadata.manualDeals = snapshot.deals.length;
snapshot.metadata.verifiedRouteTargets = snapshot.routeVerificationResults.filter((result) => result.ok).length;
snapshot.metadata.totalRouteTargets = snapshot.routeVerificationResults.length;

await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`);

history.updatedAt = snapshot.metadata.updatedAt;
history.runs.push({
  id: snapshot.metadata.updatedAt,
  savedAt: new Date().toISOString(),
  snapshot,
});

await writeFile(historyUrl, `${JSON.stringify(history, null, 2)}\n`);

console.log(`MarketLens snapshot written: ${okCount}/${sourceResults.length} sources reachable`);
