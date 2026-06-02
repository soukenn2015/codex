import { readFile, writeFile } from "node:fs/promises";

const configUrl = new URL("../data/source-config.json", import.meta.url);
const dealInputUrl = new URL("../data/deal-candidates.csv", import.meta.url);
const outputUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const historyUrl = new URL("../data/marketlens.history.json", import.meta.url);
const publicHistoryUrl = new URL("../data/marketlens.public-history.json", import.meta.url);

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
  /(hb\.afl\.rakuten\.co\.jp|px\.a8\.net|al\.dmm\.com|amzn\.to|bit\.ly|t\.co|linktr\.ee|fc2\.com)$/i;
const allowedLotteryHosts =
  /(pokemoncenter-online\.com|pokemon-card\.com|membercard\.jp|p-bandai\.jp|bandai\.co\.jp|dmm\.com|amiami\.jp|yellowsubmarine\.co\.jp|joshinweb\.jp|biccamera\.com|yodobashi\.com|edion\.com|one-piece\.com|square-enix\.com|casio\.com|gshock\.casio\.com|nyuka-now\.com)$/i;

function sourceHasLotteryIntent(source) {
  if (source.type === "pokemonRelease") return true;
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

function extractLotteryRoutesFromSource(source, result) {
  if (!result?.ok || !sourceHasLotteryIntent(source)) return [];
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

const BLOG_SNS_RECENT_LIMIT = 30;
const BLOG_SNS_DETAIL_FETCH_LIMIT = 10;
const PRODUCT_ALIAS_RULES = [
  [/ドラスタ/gi, "ドラゴンスター"],
  [/イエサブ/gi, "イエローサブマリン"],
  [/ポケカbox/gi, "ポケモンカード BOX"],
  [/ワンピ/gi, "ワンピース"],
];
const PRODUCT_SIGNAL_WORD =
  /(一番くじ|ポケモン|ポケカ|拡張パック|BOX|ドラゴンボール|ワンピース|ドラクエ|ドラゴンクエスト|G-SHOCK|GARRACK|フィギュア|プレバン|抽選|再販|完売|品薄|サプライ)/i;
const ROUTE_HOST_ALLOW =
  /(pokemoncenter-online\.com|pokemon-card\.com|membercard\.jp|p-bandai\.jp|dmm\.com|amiami\.jp|yellowsubmarine\.co\.jp|joshinweb\.jp|biccamera\.com|yodobashi\.com|edion\.com|one-piece\.com|square-enix\.com|casio\.com|gshock\.casio\.com|nyuka-now\.com|7netshopping\.jp|rakuten\.co\.jp|amazon\.co\.jp)/i;

function canonicalizeProductName(name) {
  let normalized = String(name ?? "").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of PRODUCT_ALIAS_RULES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/[|｜].*$/, "").replace(/[【\[].*$/, "").trim();
}

function detectSourceChannel(source, url = "") {
  const typeText = [source?.trend?.type, source?.trend?.context, source?.candidate?.reason].join(" ");
  const host = String(tryParseUrl(url || source?.url || "")?.hostname ?? "").toLowerCase();
  if (/ブログ監視/.test(typeText)) return "blog";
  if (/sns監視/.test(typeText)) return "sns";
  if (host.includes("x.com") || host.includes("twitter.com")) return "sns";
  if (host.includes("fc2.com") || host.includes("blog") || host.includes("livedoor")) return "blog";
  return "official";
}

function sourceReliabilityLevel(source, url = "") {
  const channel = detectSourceChannel(source, url);
  if (channel === "official") return "high";
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

function extractProductPhrases(text) {
  const phrases = [];
  const patterns = [
    /一番くじ[^。、「」\n]{4,90}/g,
    /ポケモンカード[^。、「」\n]{2,90}/g,
    /ドラゴンボール[^。、「」\n]{2,90}/g,
    /ワンピース[^。、「」\n]{2,90}/g,
    /ドラゴンクエスト[^。、「」\n]{2,90}/g,
    /G-SHOCK[^。、「」\n]{1,90}/gi,
    /GARRACK[^。、「」\n]{1,90}/gi,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern) ?? [];
    for (const match of matches) {
      const cleaned = canonicalizeProductName(match.replace(/\s+/g, " ").trim());
      if (cleaned.length >= 5 && cleaned.length <= 96) phrases.push(cleaned);
    }
  }
  return [...new Set(phrases)].slice(0, 8);
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
  return links
    .map((link) => ({ ...link, score: scoreArticleLink(link, sourceHost) }))
    .filter((item) => item.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, BLOG_SNS_RECENT_LIMIT);
}

async function expandBlogSnsCandidates(source, result, historyRuns) {
  if (!result?.ok) return { trends: [], candidates: [], stats: { scanned: 0, generated: 0 } };
  const channel = detectSourceChannel(source, result.url);
  if (channel !== "blog" && channel !== "sns") return { trends: [], candidates: [], stats: { scanned: 0, generated: 0 } };

  const links = pickRecentArticleLinks(source, result);
  const trends = [];
  const candidates = [];
  const seen = new Set();
  const scannedLinks = links.slice(0, BLOG_SNS_DETAIL_FETCH_LIMIT);
  const reliability = sourceReliabilityLevel(source, result.url);

  for (const [index, link] of scannedLinks.entries()) {
    const articleResult = await fetchSource({ id: `${source.id}:article:${index}`, url: link.url });
    const articleText = `${link.anchorText ?? ""} ${articleResult.title ?? ""} ${articleResult.text ?? ""}`.slice(0, 22000);
    if (!PRODUCT_SIGNAL_WORD.test(articleText)) continue;
    const dateBase =
      toIsoDateFromJapanese(extractFirst(articleText, [/(\d{4}年\d{1,2}月\d{1,2}日)/])) ?? articleResult.fetchedAt.slice(0, 10);
    const { startDate, endDate } = determineStartEndDate(source, dateBase, articleText);
    const routeLinks = extractLinksFromHtml(articleResult.html ?? "", articleResult.url ?? link.url)
      .filter((item) => ROUTE_HOST_ALLOW.test(item.url))
      .slice(0, 3);
    const routeUrl = routeLinks[0]?.url ?? "";
    const names = [
      canonicalizeProductName(link.anchorText ?? ""),
      ...extractProductPhrases(articleText),
    ].filter((name) => PRODUCT_SIGNAL_WORD.test(name));
    for (const rawName of names.slice(0, 4)) {
      const name = canonicalizeProductName(rawName);
      const dedupKey = normalizeSignalText(name);
      if (!dedupKey || seen.has(dedupKey)) continue;
      seen.add(dedupKey);
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
      const monitorType = channel === "blog" ? "ブログ抽出" : "SNS抽出";

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
        sourceUrl: routeUrl || articleResult.url || link.url,
        retailPrice: Number.isFinite(retailPrice) ? retailPrice : null,
        retailPriceLabel: Number.isFinite(retailPrice) ? `抽出価格 ${formatYen(retailPrice)}` : null,
        retailPriceSource: Number.isFinite(retailPrice) ? "blog-sns-article" : null,
        startDate,
        endDate,
        sourceChannel: channel,
        sourceReliability: reliability,
      });
    }
  }

  return {
    trends,
    candidates,
    stats: { scanned: links.length, generated: candidates.length },
  };
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

async function fetchUrlResults(urls, idPrefix, concurrency = 6) {
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

  for (const candidate of target) {
    const periodKnown = Boolean(candidate.startDate && candidate.endDate);
    const hasPrice = Number.isFinite(candidate?.retailPrice) || Number.isFinite(candidate?.marketPrice);
    const hasRoute = Boolean(candidate?.sourceUrl);
    const isRouteAlive = candidate.routeAlive !== false;
    const isRouteUsable = candidate.routeUsable !== false && candidateRouteIsUsable(candidateRouteTargetUrl(candidate));
    const hasName = String(candidate?.name ?? "").trim().length >= 2;
    const channel = String(candidate?.sourceChannel ?? "");
    const freshnessState = candidateMarketFreshnessState(candidate.marketObservedAt);

    if (channel === "blog" || channel === "sns") blogSns += 1;
    if (hasName) withProductName += 1;
    if (candidate.routeCheckedAt) routeChecked += 1;
    if (hasRoute && isRouteUsable && isRouteAlive) routeAlive += 1;

    if (!periodKnown) {
      missingPeriod += 1;
      continue;
    }
    if (!hasPrice) {
      missingPrice += 1;
      continue;
    }
    if (!hasRoute || !isRouteUsable || !isRouteAlive) {
      missingRoute += 1;
      continue;
    }
    if (freshnessState === "stale") {
      stalePrice += 1;
      continue;
    }
    ready += 1;
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
history.runs = (history.runs ?? []).slice(-365).map(compactHistoryRun);
const historyRuns = history.runs;
const yearlyLearning = buildYearlyProductLearning(historyRuns);
const yearlyLearningMap = new Map(yearlyLearning.map((item) => [item.key, item]));
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
  productLearning: [],
  sourceResults,
};

snapshot.deals = await loadDealCandidates();

for (const rawSource of config.sources ?? []) {
  const source = { ...rawSource, url: resolveSourceUrl(rawSource) };
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
    const expanded = await expandBlogSnsCandidates(source, result, historyRuns);
    publicResult.expandedScanned = expanded.stats.scanned;
    publicResult.expandedGenerated = expanded.stats.generated;
    if (!source.hideFromTrends) {
      snapshot.trends.push(...expanded.trends);
    }
    if (!source.hideFromDiscovery) {
      snapshot.discoveryCandidates.push(...expanded.candidates);
    }
  }

  const lotteryCandidates = extractLotteryRoutesFromSource(source, result);
  if (lotteryCandidates.length > 0) {
    snapshot.lotteryRoutes.push(...lotteryCandidates);
  }

  sourceResults.push(publicResult);
}

snapshot.trends = Array.from(
  new Map(
    snapshot.trends.map((trend) => [normalizeSignalText(`${trend.keyword}|${trend.startDate ?? ""}`), trend]),
  ).values(),
);

const mergedCandidates = new Map();
for (const candidate of snapshot.discoveryCandidates) {
  const key = normalizeSignalText(candidate.name);
  if (!key) continue;
  const previous = mergedCandidates.get(key);
  mergedCandidates.set(key, previous ? mergeCandidateRecords(previous, candidate) : candidate);
}
snapshot.discoveryCandidates = [...mergedCandidates.values()];

snapshot.lotteryRoutes = Array.from(
  new Map(snapshot.lotteryRoutes.map((route) => [`${normalizeSignalText(route.name)}|${route.sourceUrl}`, route])).values(),
);

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
  return {
    ...candidate,
    marketPrice: specialized?.marketPrice ?? estimated?.marketPrice ?? candidate.marketPrice ?? null,
    marketPriceLabel: specialized?.marketPriceLabel ?? estimated?.marketPriceLabel ?? candidate.marketPriceLabel ?? null,
    marketPriceSource: specialized?.marketPriceSource ?? estimated?.marketPriceSource ?? candidate.marketPriceSource ?? null,
    marketObservedAt: specialized?.marketObservedAt ?? candidate.marketObservedAt ?? null,
    retailPrice: retailEstimated?.retailPrice ?? candidate.retailPrice ?? null,
    retailPriceLabel: retailEstimated?.retailPriceLabel ?? candidate.retailPriceLabel ?? null,
    retailPriceSource: retailEstimated?.retailPriceSource ?? candidate.retailPriceSource ?? null,
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
});

const candidateRouteVerification = await verifyCandidateRouteTargets(snapshot.discoveryCandidates);
snapshot.discoveryCandidates = candidateRouteVerification.candidates;
snapshot.candidateRouteVerificationResults = candidateRouteVerification.results;
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
snapshot.productLearning = yearlyLearning;
snapshot.metadata.learningProducts1y = yearlyLearning.length;

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
