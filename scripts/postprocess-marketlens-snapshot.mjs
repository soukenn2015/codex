import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  applyMarketplaceResearchToSnapshot,
  applyReaderObservedLabels,
  sanitizeClaimText,
  sanitizeSnapshotClaims,
} from "./marketlens-observation.mjs";
import { buildXObservationQueue } from "./marketlens-x-reader.mjs";
import { resolveObservationLimits, resolveXQueueLimit } from "./marketlens-limits.mjs";
import { isProvisionalBuyLineRank } from "./marketlens-buyline.mjs";

const snapshotPath = new URL("../data/marketlens.snapshot.json", import.meta.url);
const historyPath = new URL("../data/marketlens.history.json", import.meta.url);
const publicHistoryPath = new URL("../data/marketlens.public-history.json", import.meta.url);
const requestedLlmProvider = String(process.env.MARKETLENS_AI_PROVIDER ?? "gemini")
  .trim()
  .toLowerCase();
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const minSnapshotReachableSources = Number(process.env.MARKETLENS_MIN_REACHABLE_SOURCES ?? 1);
const minSnapshotDocumentCount = Number(process.env.MARKETLENS_MIN_DOCUMENTS ?? 100);
const minSnapshotProductCount = Number(process.env.MARKETLENS_MIN_PRODUCTS ?? 100);
const minSnapshotPreviousRatio = Number(process.env.MARKETLENS_MIN_PREVIOUS_RATIO ?? 0.35);
const minSnapshotDocumentRetentionRatio = Number(
  process.env.MARKETLENS_MIN_DOCUMENT_RETENTION_RATIO ?? process.env.MARKETLENS_MIN_PREVIOUS_RATIO ?? 0.35,
);
const minSnapshotProductRetentionRatio = Number(
  process.env.MARKETLENS_MIN_PRODUCT_RETENTION_RATIO ?? process.env.MARKETLENS_MIN_PREVIOUS_RATIO ?? 0.35,
);

const PRODUCT_ALIAS_RULES = [
  [/ドラスタ/gi, "ドラゴンスター"],
  [/イエサブ/gi, "イエローサブマリン"],
  [/ポケカbox/gi, "ポケモンカード BOX"],
  [/ワンピ/gi, "ワンピース"],
  [/フィギュアーツ/gi, "S.H.Figuarts"],
  [/プレバン/gi, "プレミアムバンダイ"],
];

const PRODUCT_SIGNAL_WORD =
  /(一番くじ|ポケモン|ポケカ|拡張パック|BOX|ドラゴンボール|ワンピース|ドラクエ|ドラゴンクエスト|G-SHOCK|GARRACK|フィギュア|S\.H\.Figuarts|METAL BUILD|ROBOT魂|超合金|ねんどろいど|figma|Portrait\.Of\.Pirates|P\.O\.P|プレミアムバンダイ|プレバン|抽選|応募|予約|再販|完売|品薄|サプライ|マスコット|ぬいぐるみ|キーホルダー|カービィ|ちいかわ|サンリオ|たまごっち|お文具|映画|劇場版|入場者特典|来場者特典|前売券|ムビチケ|劇場限定|上映記念|パンフレット)/i;

function normalizeLlmProvider(value) {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "gemini") return "gemini";
  if (provider === "heuristic") return "heuristic";
  return "openai";
}

const configuredLlmProvider = normalizeLlmProvider(requestedLlmProvider);

function llmProviderConfigured(provider = configuredLlmProvider) {
  if (provider === "gemini") return Boolean(geminiApiKey);
  if (provider === "openai") return Boolean(openAiApiKey);
  return false;
}

function llmProviderMissingReason(provider = configuredLlmProvider) {
  if (provider === "gemini") return "gemini_api_key_missing";
  if (provider === "openai") return "openai_api_key_missing";
  return "provider_forced_heuristic";
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildLlmExecutionMetadata({
  snapshot,
  previousLlmExecution = {},
  modeCounts = {},
  fallbackReasons = {},
  eligibilityReasonCounts = {},
  inferredOverviewFallbackReason = "",
}) {
  const previousExtraction = previousLlmExecution.extraction && typeof previousLlmExecution.extraction === "object"
    ? previousLlmExecution.extraction
    : {};
  const previousOverview = previousLlmExecution.overview && typeof previousLlmExecution.overview === "object"
    ? previousLlmExecution.overview
    : {};
  const overviewNarrative = snapshot.overviewNarrative ?? {};
  const snapshotUpdatedAt = snapshot.metadata?.updatedAt ?? null;
  const overviewGeneratedAt = overviewNarrative.generatedAt ?? snapshotUpdatedAt ?? null;
  const overviewIsCurrentRun = Boolean(overviewGeneratedAt && snapshotUpdatedAt && overviewGeneratedAt === snapshotUpdatedAt);
  const extraction = {
    requested: numberOr(previousExtraction.requested, numberOr(previousLlmExecution.requested, previousLlmExecution.geminiRequestedCount)),
    succeeded: numberOr(previousExtraction.succeeded, numberOr(previousLlmExecution.succeeded, previousLlmExecution.geminiSucceededCount)),
    failed: numberOr(previousExtraction.failed, numberOr(previousLlmExecution.failed, previousLlmExecution.geminiFailedCount)),
    skipped: numberOr(previousExtraction.skipped, numberOr(previousLlmExecution.skipped, previousLlmExecution.geminiSkippedCount)),
    eligible: numberOr(previousExtraction.eligible, previousLlmExecution.eligible),
    modeCounts,
    geminiRequestedCount: numberOr(
      previousExtraction.geminiRequestedCount,
      numberOr(previousLlmExecution.geminiRequestedCount, numberOr(previousExtraction.requested, previousLlmExecution.requested)),
    ),
    geminiSucceededCount: numberOr(
      previousExtraction.geminiSucceededCount,
      numberOr(previousLlmExecution.geminiSucceededCount, numberOr(previousExtraction.succeeded, previousLlmExecution.succeeded)),
    ),
    geminiFailedCount: numberOr(
      previousExtraction.geminiFailedCount,
      numberOr(previousLlmExecution.geminiFailedCount, numberOr(previousExtraction.failed, previousLlmExecution.failed)),
    ),
    geminiSkippedCount: numberOr(
      previousExtraction.geminiSkippedCount,
      numberOr(previousLlmExecution.geminiSkippedCount, numberOr(previousExtraction.skipped, previousLlmExecution.skipped)),
    ),
  };
  let overviewRequested = numberOr(previousOverview.requested);
  let overviewSucceeded = numberOr(previousOverview.succeeded);
  let overviewFailed = numberOr(previousOverview.failed);
  if (previousOverview.requested === undefined && previousOverview.succeeded === undefined && previousOverview.failed === undefined) {
    if (["openai", "gemini"].includes(overviewNarrative.sourceMode) && overviewIsCurrentRun) {
      overviewRequested = 1;
      if (overviewNarrative.error || inferredOverviewFallbackReason) {
        overviewSucceeded = 0;
        overviewFailed = 1;
      } else {
        overviewSucceeded = 1;
        overviewFailed = 0;
      }
    }
  }
  const overview = {
    sourceMode: overviewNarrative.sourceMode ?? previousOverview.sourceMode ?? "heuristic",
    generatedAt: overviewGeneratedAt,
    model: overviewNarrative.model ?? previousOverview.model ?? null,
    requested: overviewRequested,
    succeeded: overviewSucceeded,
    failed: overviewFailed,
    fallbackReason: inferredOverviewFallbackReason,
    error: overviewNarrative.error ?? previousOverview.error ?? null,
    isCurrentRun: previousOverview.isCurrentRun ?? overviewIsCurrentRun,
  };
  const configuredFromModes =
    (modeCounts.openai ?? 0) > 0 ||
    (modeCounts.gemini ?? 0) > 0 ||
    ["openai", "gemini"].includes(overview.sourceMode);
  return {
    configured: llmProviderConfigured() || Boolean(previousLlmExecution.configured) || configuredFromModes,
    provider: previousLlmExecution.provider || configuredLlmProvider,
    model:
      previousLlmExecution.model ||
      (configuredLlmProvider === "gemini"
        ? (process.env.MARKETLENS_GEMINI_MODEL || "gemini-3.1-flash-lite")
        : previousLlmExecution.model || ""),
    fallbackModel:
      previousLlmExecution.fallbackModel ||
      (configuredLlmProvider === "gemini" ? (process.env.MARKETLENS_GEMINI_FALLBACK_MODEL || "gemini-2.5-flash") : ""),
    actualModelUsed: Array.isArray(previousLlmExecution.actualModelUsed) ? previousLlmExecution.actualModelUsed : [],
    extraction,
    overview,
    openAiCount: modeCounts.openai ?? 0,
    geminiCount: modeCounts.gemini ?? 0,
    heuristicCount: modeCounts.heuristic ?? 0,
    modeCounts,
    fallbackReasons,
    eligibilityReasonCounts,
    requested: extraction.requested,
    succeeded: extraction.succeeded,
    failed: extraction.failed,
    skipped: extraction.skipped,
    eligible: extraction.eligible,
    geminiRequestedCount: extraction.geminiRequestedCount,
    geminiSucceededCount: extraction.geminiSucceededCount,
    geminiFailedCount: extraction.geminiFailedCount,
    geminiSkippedCount: extraction.geminiSkippedCount,
    geminiQuotaStopped: Boolean(previousLlmExecution.geminiQuotaStopped),
    geminiQuotaStopReason: String(previousLlmExecution.geminiQuotaStopReason ?? ""),
    extractionDocLimit: previousLlmExecution.extractionDocLimit ?? null,
    geminiExtractionDocLimit: previousLlmExecution.geminiExtractionDocLimit ?? null,
    estimatedCost: previousLlmExecution.estimatedCost ?? 0,
    overviewFallbackReason: inferredOverviewFallbackReason,
  };
}

function normalizeSignalText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
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
  return /この記事を書いた人|スポンサーリンク|在籍メンバー数|RESALE LAB|利用規約|世界No\.?1ファッションフリマアプリ|一番くじ倶楽部またはくじ券をご確認ください|ダブルチャンスキャンペーン(?:期間)?|カートに入れる|在庫状況|お気に入り一覧|権利|コメント投稿欄|お問い合わせ|プライバシーポリシー|利用規約|FAQ|追加情報や様々なブランドとのコラボレーション情報|商品抽選販売|抽選応募受付を開始致しました|発売予定$/u.test(
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

function looksLikeSentenceLikeMovieTitle(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/[。！？]/u.test(text)) return true;
  if (/ような作品|したい|もらえます|無くなり次第|お見逃しなく|購入で|プレゼント|数量限定/u.test(text)) return true;
  if (text.length >= 34 && /(?:が|を|に|へ|で|から|まで|より|について|として)/u.test(text)) return true;
  return false;
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

function looksLikeMovieArticleContext(title = "", text = "", url = "") {
  const compactTitle = compactText(title);
  const compactLead = compactText(String(text ?? "").slice(0, 320));
  let host = "";
  try {
    host = new URL(String(url ?? "")).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (/moviewalker|mvtk|eiga|cinema/i.test(host)) return true;
  if (/(映画|劇場版|ムビチケ|前売券|上映|公開)/u.test(compactTitle)) return true;
  return /(映画|劇場版|ムビチケ|前売券|上映|公開)/u.test(compactLead) &&
    /(入場者特典|来場者特典|週替わり特典|前売券特典|ムビチケ特典|入場特典|来場特典|特典配布)/u.test(compactLead);
}

const MOVIE_CONTEXT_PATTERN = /(映画|劇場版|ムビチケ|前売券|上映|公開|劇場|来場|鑑賞|入場)/u;
const MOVIE_HEADLINE_PATTERN = /(映画|劇場版|ムビチケ|前売券|上映|公開)/u;
const MOVIE_BONUS_EXPLICIT_PATTERN =
  /(入場者特典|来場者特典|週替わり特典|前売券特典|ムビチケ特典|来場者プレゼント|入場者プレゼント|入場特典|来場特典|特典付き上映)/u;
const MOVIE_BONUS_CONTEXTUAL_PATTERN = /(先着特典|数量限定特典|ノベルティ(?:プレゼント|フェア)?|特典配布|購入特典)/u;

function movieContextParagraphWindows(text = "") {
  const paragraphs = String(text ?? "")
    .split(/\n+/)
    .map((paragraph) => compactText(paragraph))
    .filter(Boolean)
    .slice(0, 48);
  const windows = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index];
    if (current) windows.push(current);
    const next = paragraphs[index + 1];
    if (current && next) windows.push(compactText(`${current} ${next}`));
  }
  return windows;
}

function looksLikeMovieBonusContext(title = "", text = "", url = "") {
  const compactTitle = compactText(title);
  const windows = movieContextParagraphWindows(text);
  let host = "";
  try {
    host = new URL(String(url ?? "")).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const hostLooksMovie = /moviewalker|mvtk|eiga|cinema/i.test(host);
  const titleHasMovie = MOVIE_HEADLINE_PATTERN.test(compactTitle);
  const paragraphHasMovie = windows.some((windowText) => MOVIE_CONTEXT_PATTERN.test(windowText));
  if (!titleHasMovie && !(hostLooksMovie && paragraphHasMovie)) return false;
  return windows.some((windowText) => {
    const hasMovieSignal = titleHasMovie || MOVIE_CONTEXT_PATTERN.test(windowText);
    if (!hasMovieSignal) return false;
    if (MOVIE_BONUS_EXPLICIT_PATTERN.test(windowText)) return true;
    return (
      hostLooksMovie &&
      MOVIE_BONUS_CONTEXTUAL_PATTERN.test(windowText) &&
      /(来場|入場|鑑賞|劇場|上映|公開|ムビチケ|前売券)/u.test(windowText)
    );
  });
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
    .replace(/\s*この記事を書いた人.*$/u, "")
    .replace(/\s*スポンサーリンク.*$/u, "")
    .replace(/\s*RESALE LAB.*$/u, "")
    .replace(/\s*世界No\.?1ファッションフリマアプリ.*$/u, "")
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
  if (/一番くじ情報サイト/i.test(text) && !/^一番くじ\s+/i.test(text)) return true;
  if (/公式ショップ$/u.test(text) && !/一番くじ\s+.+/.test(text)) return true;
  if (looksLikeArticleBoilerplateName(text)) return true;
  if (looksLikePrizeDescriptionBlob(text)) return true;
  if (looksLikeCategoryListingName(text)) return true;
  if (looksLikeNarrativeProductName(text)) return true;
  return false;
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
    if (looksLikeSentenceLikeMovieTitle(baseTitle)) return true;
  }
  return false;
}

function looksLikeConcreteMovieBonusName(name) {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (!/(入場者特典|来場者特典|前売券特典|ムビチケ特典|入場特典|来場特典|来場者プレゼント|入場者プレゼント)/u.test(text)) {
    return false;
  }
  if (!/(映画|劇場版)/u.test(text)) return false;
  if (/^一番くじ/u.test(text)) return false;
  return true;
}

function productPhraseLooksSpecific(name) {
  const cleaned = canonicalizeProductName(name);
  if (cleaned.length < 5 || cleaned.length > 96) return false;
  if (looksLikeSiteChromeProductName(cleaned)) return false;
  if (looksLikeRouteLabelName(cleaned)) return false;
  if (looksLikeGenericMovieMerchName(cleaned)) return false;
  if (looksLikeArticleBoilerplateName(cleaned)) return false;
  if (looksLikePrizeDescriptionBlob(cleaned)) return false;
  if (looksLikeCategoryListingName(cleaned)) return false;
  if (looksLikeNarrativeProductName(cleaned)) return false;
  if (/(ムビチケ前売券|前売券|入場者特典|来場者特典)$/u.test(cleaned)) {
    const baseTitle = cleaned.replace(/\s*(ムビチケ前売券|前売券|入場者特典|来場者特典)$/u, "").trim();
    if (looksLikeSentenceLikeMovieTitle(baseTitle)) return false;
  }
  if (/^(品薄|完売|プレ値|速報|抽選|応募|予約|再販|入荷)(?:注意報|情報|速報|まとめ)?(?:\s*\(\d+\))?$/i.test(cleaned)) return false;
  if (/^(抽選|応募|予約|再販|完売|品薄|フィギュア|グッズ|サプライ|マスコット|ぬいぐるみ|キーホルダー|フィギュア・プラモデル)$/i.test(cleaned)) return false;
  if (/^(?:拡張パック|強化拡張パック|ポケモンカードゲーム|ポケモンカード|ポケカ拡張パック|ポケモンカードゲーム最新拡張パック)$/u.test(cleaned)) return false;
  if (/^拡張パック(?:ですら|が再販|については|はいずれも|は軒並み|を対象に)/u.test(cleaned)) return false;
  if (/(価格|税込|ジャンル|発売日|販売開始|販売先リンク|次の記事|前の記事|一括検索|販売状況|Yahoo!ショッピング|楽天市場|Amazon|アマゾン|こちら|先取り情報|その他|[=＝]{3,}|#|★)/i.test(cleaned)) return false;
  if (/一番くじONLINE|HMV＆BOOKS限定グッズ|セブンネット限定グッズ|限定グッズ各種/i.test(cleaned)) return false;
  if (/一番くじでしか手に入らない|最後の1個を引くと手に入る|くじの残り数は店舗でご確認|店舗でご確認下さい|店舗でご確認ください|illustration\s+by|描きおろし|描き下ろし|商品説明を見る|物語の主人公|作品に欠かせない|一番くじフィギュアブランド|ドラゴンクエストとは\s+タイトル一覧|^\s*\d{1,2}時(?:予約|販売|抽選)?(?:解禁|開始)/i.test(cleaned)) return false;
  return PRODUCT_SIGNAL_WORD.test(cleaned);
}

function normalizeProductKey(name) {
  return normalizeSignalText(canonicalizeProductName(name));
}

function safeIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim()) ? String(value).trim() : "";
}

function addDaysToIsoDate(isoDate, days) {
  const date = safeIsoDate(isoDate);
  if (!date) return "";
  const ts = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(ts)) return "";
  return new Date(ts + days * 86_400_000).toISOString().slice(0, 10);
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceModeOrHeuristic(mode) {
  const text = String(mode ?? "").trim();
  return text || "heuristic";
}

function cleanupReasonText(value) {
  return sanitizeClaimText(
    compactText(value)
      .replace(/話題化/g, "具体反応")
      .replace(/\btrend_signal\b/gi, "具体反応")
      .replace(/\bsignal\b/gi, "更新")
      .replace(/\bheuristic\b/gi, "")
      .trim(),
  );
}

function topicFallback(productName, category) {
  if (category === "kuji") return `${productName} は一番くじの具体商品として拾えており、動きが出るか継続監視しています。`;
  if (category === "pokemon") return `${productName} は抽選や再販が動きやすい対象として継続監視しています。`;
  if (category === "movie_bonus" || category === "movie_goods") return `${productName} は映画系の限定導線が付きやすい対象として追っています。`;
  return `${productName} は具体商品として拾えており、継続監視中です。`;
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
  return isProvisionalBuyLineRank(rank) ? "buyline" : "watch";
}

function provisionalCandidateBuyLineStatus(candidate = {}) {
  const marketOk =
    isProvisionalBuyLineRank(candidate.marketPriceSourceRank) && Number.isFinite(candidate.marketPrice);
  const retailOk =
    isProvisionalBuyLineRank(candidate.retailPriceSourceRank) && Number.isFinite(candidate.retailPrice);
  return marketOk && retailOk ? "available" : "unavailable";
}

function isSearchLikeUrl(url) {
  return /[?&](q|query|keyword|search|s)=/i.test(String(url ?? "")) || /\/search(\/|$)/i.test(String(url ?? ""));
}

function routeTargetIsGeneric(url) {
  const text = String(url ?? "");
  return (
    !text ||
    isSearchLikeUrl(text) ||
    /press\.moviewalker\.jp\/news\/?$/.test(text) ||
    /x\.com\/[^/]+\/?$/.test(text) ||
    /twitter\.com\/[^/]+\/?$/.test(text) ||
    /\/(category|categories|brand|brands|character|characters|list|ranking|guide|about|policy|company|privacy|contact)(\/|$)/i.test(text)
  );
}

function candidateRouteTargetUrl(candidate) {
  return String(candidate?.routeFinalUrl || candidate?.sourceUrl || "").trim();
}

function candidateMarketFreshnessState(observedAt) {
  if (!observedAt) return "missing";
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) return "missing";
  return (Date.now() - ts) / 86_400_000 <= 3 ? "fresh" : "stale";
}

function deriveCandidateInsufficiencyReasons(candidate) {
  const reasons = [];
  const periodKnown = Boolean(candidate?.startDate && candidate?.endDate);
  const periodActive = candidate?.endDate ? safeIsoDate(candidate.endDate) >= new Date().toISOString().slice(0, 10) : true;
  const hasRetail = Number.isFinite(candidate?.retailPrice);
  const hasMarket = Number.isFinite(candidate?.marketPrice);
  const routeTarget = candidateRouteTargetUrl(candidate);
  const routeAlive = candidate?.routeAlive !== false;
  const routeUsable = Boolean(routeTarget) && !routeTargetIsGeneric(routeTarget);
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
  const startIso = safeIsoDate(candidate?.startDate);
  const daysUntilStart = startIso ? Math.floor((Date.parse(`${startIso}T00:00:00+09:00`) - Date.now()) / 86_400_000) : Number.NaN;
  const nearWindow = Number.isFinite(daysUntilStart) ? daysUntilStart <= 14 : false;

  if (hasEnded) return { candidateState: "archive", insufficiencyReasons };
  if (!hasPeriodGap && !hasRouteIssue && !hasPriceGap) return { candidateState: "ready", insufficiencyReasons };
  if (nearWindow || score >= 78 || candidate?.sourceChannel === "lottery") return { candidateState: "researchTask", insufficiencyReasons };
  return { candidateState: "watchOnly", insufficiencyReasons };
}

function deriveCandidateStatusReasons(candidate) {
  const insufficiencyReasons = Array.isArray(candidate?.insufficiencyReasons) ? candidate.insufficiencyReasons : deriveCandidateInsufficiencyReasons(candidate);
  const reasons = [];
  if (insufficiencyReasons.includes("missingPeriod")) reasons.push("date_missing");
  if (insufficiencyReasons.includes("missingRetailPrice")) reasons.push("price_missing");
  if (insufficiencyReasons.includes("missingMarketPrice")) reasons.push("market_missing", "price_missing");
  if (insufficiencyReasons.includes("missingRoute")) reasons.push("route_missing");
  if (insufficiencyReasons.some((reason) => ["genericRoute", "deadRoute"].includes(reason))) reasons.push("route_unverified");
  if (insufficiencyReasons.includes("ended")) reasons.push("ended");
  return [...new Set(reasons)];
}

function candidateGeminiEligibility(candidate, product = null, statusReasons = []) {
  const category = product?.category || candidate?.category || "";
  if (category === "movie_bonus" || category === "movie_goods") return { eligible: true, reason: `${category}_candidate` };
  if (category === "kuji" || /一番くじ|ラストワン|A賞/.test(candidate?.name ?? "")) return { eligible: true, reason: "kuji_candidate" };
  if (category === "pokemon" || /ポケカ|ポケモンカード|抽選|再販/.test(`${candidate?.name ?? ""} ${candidate?.reason ?? ""}`)) {
    return { eligible: true, reason: "pokemon_candidate" };
  }
  if (statusReasons.includes("price_missing") && Number(candidate?.genreScore ?? 0) >= 70) return { eligible: true, reason: "price_missing_candidate" };
  if (statusReasons.includes("route_unverified") && Number(candidate?.genreScore ?? 0) >= 70) return { eligible: true, reason: "generic_route_candidate" };
  return { eligible: false, reason: "not_eligible_for_gemini" };
}

function rewriteSelectionReason(reason, productMeta) {
  const productName = canonicalizeProductName(reason.productName);
  const category = productMeta?.category ?? "";
  const whyTopicRaw = cleanupReasonText(reason.whyTopic);
  const weakTopic =
    !whyTopicRaw ||
    looksLikeSiteChromeProductName(whyTopicRaw) ||
    /LLM抽出|記事抽出|自動発見ソース|由来/.test(whyTopicRaw);
  return {
    ...reason,
    productName,
    productKey: normalizeProductKey(productName),
    whyTopic: weakTopic ? topicFallback(productName, category) : whyTopicRaw,
    whyTiming: cleanupReasonText(reason.whyTiming),
    whyRoute: cleanupReasonText(reason.whyRoute),
    whyPrice: cleanupReasonText(reason.whyPrice),
    whyHistory: cleanupReasonText(reason.whyHistory),
    shortNow: `${weakTopic ? topicFallback(productName, category) : whyTopicRaw} ${cleanupReasonText(reason.whyRoute) || cleanupReasonText(reason.whyTiming)}`.trim(),
    shortSoon: `${weakTopic ? topicFallback(productName, category) : whyTopicRaw} ${cleanupReasonText(reason.whyTiming)} ${cleanupReasonText(reason.whyPrice)}`.trim(),
    shortMemo: `${weakTopic ? topicFallback(productName, category) : whyTopicRaw} ${cleanupReasonText(reason.whyPrice) || cleanupReasonText(reason.whyHistory)}`.trim(),
    holdReason: cleanupReasonText(reason.holdReason),
  };
}

function buildMovieSelectionReason(productName, routeUrl, articleUrl, observedAt) {
  const startDate = safeIsoDate(observedAt) || new Date().toISOString().slice(0, 10);
  return {
    productKey: normalizeProductKey(productName),
    productName,
    whyTopic: `${productName} は映画系の具体商品として拾えています。`,
    whyTiming: `${startDate} 時点でムビチケ導線が見えています。`,
    whyRoute: `MOVIE WALKER ムビチケの購入ページへ直接飛べます。`,
    whyPrice: "価格はまだ本文から十分に取れていないため、実勢確認を続けます。",
    whyHistory: "映画公開前の限定導線として継続監視します。",
    shortNow: `${productName} は MOVIE WALKER ムビチケへ直接飛べます。価格確認は残りますが、導線は押さえています。`,
    shortSoon: `${productName} はムビチケ導線が見えており、公開前の確認候補です。`,
    shortMemo: `${productName} は映画系の限定導線候補として先読みで追っています。`,
    holdReason: "価格や配布条件を補完できれば上段へ上げやすくなります。",
    sourceUrl: routeUrl,
    articleUrl,
  };
}

function buildMovieBonusSelectionReason(productName, articleUrl, observedAt) {
  const startDate = safeIsoDate(observedAt) || new Date().toISOString().slice(0, 10);
  return {
    productKey: normalizeProductKey(productName),
    productName,
    whyTopic: `${productName} は映画特典の具体候補として拾えています。`,
    whyTiming: `${startDate} 時点で特典配布の案内が見えています。`,
    whyRoute: "公式記事や劇場案内から配布条件を確認したい状態です。",
    whyPrice: "配布条件と初動相場がまだ薄いため、劇場情報と相場確認を続けます。",
    whyHistory: "映画公開前後の限定特典として継続監視します。",
    shortNow: `${productName} は配布条件の確認が必要ですが、特典案内は確認できています。`,
    shortSoon: `${productName} は映画特典候補として近い日程で確認したい対象です。`,
    shortMemo: `${productName} は映画特典の先読み候補として追っています。`,
    holdReason: "配布条件や劇場導線が埋まれば上段へ上げやすくなります。",
    sourceUrl: articleUrl,
    articleUrl,
  };
}

function extractMovieTitleFromArticle(title, text = "") {
  const patterns = [
    /『([^』]{2,60})』/g,
    /(?:劇場版|映画|入場者特典|来場者特典|前売券特典|ムビチケ特典)[^『「]{0,24}[『「]([^』」]{2,60})[』」]/g,
    /[『「]([^』」]{2,60})[』」][^。]{0,24}(?:公開|上映|特典|ムビチケ|前売券)/g,
  ];
  const source = `${String(title ?? "")}\n${String(text ?? "").slice(0, 1200)}`;
  const matches = patterns
    .flatMap((pattern) => [...source.matchAll(pattern)].map((match) => canonicalizeProductName(match[1])))
    .filter(productPhraseLooksSpecific)
    .filter((name) => !looksLikeSiteChromeProductName(name));
  return matches.find((name) => !looksLikeSentenceLikeMovieTitle(name)) ?? "";
}

async function augmentMovieItemsFromRawArchive(snapshot) {
  const archiveDir = new URL("../data/raw-archive/", import.meta.url);
  let files = [];
  try {
    files = (await readdir(archiveDir)).filter((name) => name.endsWith(".jsonl")).sort().slice(-2);
  } catch {
    return { addedProducts: 0, addedCandidates: 0 };
  }

  const productsByKey = new Map((snapshot.normalizedProducts ?? []).map((product) => [product.productKey, product]));
  const eventIds = new Set((snapshot.productEvents ?? []).map((event) => event.id));
  const routeIds = new Set((snapshot.routeSnapshots ?? []).map((route) => route.id));
  const reasonKeys = new Set((snapshot.selectionReasons ?? []).map((reason) => reason.productKey));
  const candidateKeys = new Set((snapshot.discoveryCandidates ?? []).map((candidate) => normalizeProductKey(candidate.name)));
  let addedProducts = 0;
  let addedCandidates = 0;
  let addedBonusProducts = 0;
  let addedBonusCandidates = 0;

  for (const file of files) {
    const input = createReadStream(new URL(file, archiveDir), "utf8");
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const movieTitle = extractMovieTitleFromArticle(row.title, row.text);
      if (!movieTitle) continue;
      const startDate = safeIsoDate(String(row.fetchedAt ?? "").slice(0, 10)) || new Date().toISOString().slice(0, 10);
      const endDate = addDaysToIsoDate(startDate, 45) || startDate;
      const articleUrl = String(row.url ?? "").trim();
      const ticketLink = (row.outLinks ?? []).find((link) => /https:\/\/(?:mvtk\.jp|ticket\.moviewalker\.jp)\/Film\//.test(String(link?.url ?? "")));
      if (ticketLink) {
        const productName = canonicalizeProductName(`${movieTitle} ムビチケ前売券`);
        if (productPhraseLooksSpecific(productName)) {
          const productKey = normalizeProductKey(productName);
          const routeUrl = String(ticketLink.url ?? "").trim();
          if (!productsByKey.has(productKey)) {
            const category = "movie_goods";
            const product = {
              productKey,
              canonicalName: productName,
              aliases: [productName],
              category,
              series: movieTitle,
              ip: movieTitle,
              brand: "Movie",
              productType: "movie_goods",
              sourceKinds: ["movie_archive"],
            };
            snapshot.normalizedProducts.push(product);
            productsByKey.set(productKey, product);
            addedProducts += 1;
          }

          const eventId = `movie:raw:${productKey}:${normalizeSignalText(routeUrl)}`;
          if (!eventIds.has(eventId)) {
            snapshot.productEvents.push({
              id: eventId,
              productKey,
              productName,
              eventType: "sale_open",
              startDate,
              endDate,
              sourceKey: row.sourceKey ?? "movie_raw_archive",
              sourceUrl: articleUrl,
              confidence: "medium",
              dateConfidence: "article_inferred",
              evidenceDocIds: [row.docId].filter(Boolean),
            });
            eventIds.add(eventId);
          }

          const routeId = `movie-route:${normalizeSignalText(`${productKey}:${routeUrl}`)}`;
          if (!routeIds.has(routeId)) {
            snapshot.routeSnapshots.push({
              id: routeId,
              productKey,
              productName,
              routeType: "sale",
              shopName: "MOVIE WALKER ムビチケ",
              routeUrl,
              applyUrl: routeUrl,
              startDate,
              endDate,
              status: "active",
              source: "movie_raw_archive",
              applicationMethod: "購入",
              confidence: "medium",
            });
            routeIds.add(routeId);
          }

          if (!reasonKeys.has(productKey)) {
            snapshot.selectionReasons.push(buildMovieSelectionReason(productName, routeUrl, articleUrl, startDate));
            reasonKeys.add(productKey);
          }

          if (!candidateKeys.has(productKey)) {
            snapshot.discoveryCandidates.push({
              name: productName,
              trend: "映画特典・劇場グッズ",
              stage: "追加候補",
              stageKind: "candidate",
              genreScore: 74,
              priceData: "未取得",
              tradeVolume: "要確認",
              marginSignal: "ムビチケ導線を確認",
              reason: `${movieTitle} のムビチケ前売券ページを確認。公開前導線として監視します。`,
              confidence: "中",
              adoptionReason: "映画の前売券導線を raw archive から具体化。",
              missingData: "価格、販売終了日、購入制限",
              sourceUrl: routeUrl,
              routeFinalUrl: routeUrl,
              evidenceUrl: articleUrl,
              retailPrice: null,
              marketPrice: null,
              startDate,
              endDate,
              category: "movie_goods",
              sourceChannel: "news",
              sourceReliability: "medium",
              routeAlive: true,
              routeUsable: true,
              routeStatus: "200",
              routeCheckedAt: row.fetchedAt ?? null,
            });
            candidateKeys.add(productKey);
            addedCandidates += 1;
          }
        }
      }

      if (looksLikeMovieBonusContext(row.title, row.text, articleUrl)) {
        const bonusName = canonicalizeProductName(`${movieTitle} 入場者特典`);
        if (productPhraseLooksSpecific(bonusName) && looksLikeConcreteMovieBonusName(bonusName)) {
          const bonusKey = normalizeProductKey(bonusName);
          if (!productsByKey.has(bonusKey)) {
            snapshot.normalizedProducts.push({
              productKey: bonusKey,
              canonicalName: bonusName,
              aliases: [bonusName],
              category: "movie_bonus",
              series: movieTitle,
              ip: movieTitle,
              brand: "Movie",
              productType: "movie_bonus",
              sourceKinds: ["movie_archive"],
            });
            productsByKey.set(bonusKey, snapshot.normalizedProducts[snapshot.normalizedProducts.length - 1]);
            addedBonusProducts += 1;
          }

          const bonusEventId = `movie:bonus:${bonusKey}:${normalizeSignalText(articleUrl || row.docId || bonusName)}`;
          if (!eventIds.has(bonusEventId)) {
            snapshot.productEvents.push({
              id: bonusEventId,
              productKey: bonusKey,
              productName: bonusName,
              eventType: "release",
              startDate,
              endDate,
              sourceKey: row.sourceKey ?? "movie_raw_archive",
              sourceUrl: articleUrl,
              confidence: "medium",
              dateConfidence: "article_inferred",
              evidenceDocIds: [row.docId].filter(Boolean),
            });
            eventIds.add(bonusEventId);
          }

          if (!reasonKeys.has(bonusKey)) {
            snapshot.selectionReasons.push(buildMovieBonusSelectionReason(bonusName, articleUrl, startDate));
            reasonKeys.add(bonusKey);
          }

          if (!candidateKeys.has(bonusKey)) {
            snapshot.discoveryCandidates.push({
              name: bonusName,
              trend: "映画特典",
              stage: "追加候補",
              stageKind: "candidate",
              genreScore: 71,
              priceData: "未取得",
              tradeVolume: "要確認",
              marginSignal: "特典条件を確認",
              reason: `${movieTitle} の映画特典案内を確認。配布条件と劇場導線を監視します。`,
              confidence: "中",
              adoptionReason: "映画特典案内を raw archive から具体化。",
              missingData: "配布条件、劇場、相場",
              sourceUrl: articleUrl,
              routeFinalUrl: articleUrl,
              evidenceUrl: articleUrl,
              retailPrice: null,
              marketPrice: null,
              startDate,
              endDate,
              category: "movie_bonus",
              sourceChannel: "news",
              sourceReliability: "medium",
              routeAlive: true,
              routeUsable: false,
              routeStatus: "article",
              routeCheckedAt: row.fetchedAt ?? null,
            });
            candidateKeys.add(bonusKey);
            addedBonusCandidates += 1;
          }
        }
      }

      if (addedProducts + addedBonusProducts >= 8) break;
    }
    if (addedProducts + addedBonusProducts >= 8) break;
  }

  return { addedProducts, addedCandidates, addedBonusProducts, addedBonusCandidates };
}

function buildNarrative(snapshot) {
  const activeRoutes = (snapshot.routeSnapshots ?? [])
    .filter((route) => route.status === "active")
    .filter((route) => summaryNameLooksUseful(route.productName));
  const focusNames = [...new Set(activeRoutes.map((route) => route.productName).filter(summaryNameLooksUseful))].slice(0, 3);
  const candidateNames = [];
  let routeLikeSoonCount = 0;
  for (const candidate of snapshot.discoveryCandidates ?? []) {
    const cleaned = canonicalizeProductName(candidate?.name);
    if (summaryNameLooksUseful(cleaned)) {
      if (!candidateNames.includes(cleaned)) candidateNames.push(cleaned);
      continue;
    }
    if (looksLikeRouteLabelName(cleaned)) routeLikeSoonCount += 1;
  }
  const soonNames = candidateNames.slice(0, 2);
  const kujiNames = [...new Set((snapshot.kujiSpecials ?? []).map((item) => item.title).filter(summaryNameLooksUseful))].slice(0, 2);
  const weakTargets = (snapshot.selectionReasons ?? [])
    .filter((reason) => /価格|リンク|日程/.test(`${reason.holdReason ?? ""} ${reason.shortSoon ?? ""} ${reason.shortMemo ?? ""}`))
    .map((reason) => reason.productName)
    .filter(summaryNameLooksUseful)
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .slice(0, 2);
  const parts = [];
  if (focusNames.length > 0) {
    parts.push(`いま主に見たいのは ${focusNames.join("、")} です。`);
  } else {
    parts.push("今日は大きな更新が少なく、次の開始枠を先回りで押さえる流れです。");
  }
  if (soonNames.length > 0) {
    parts.push(`近日では ${soonNames.join("、")} が動きやすく、開始前のうちに日付とリンクを固めたいです。`);
  }
  if (routeLikeSoonCount > 0) {
    parts.push(`抽選ルートや販売導線の確認候補も ${routeLikeSoonCount} 件あり、商品名が固まるまでは導線監視を優先します。`);
  }
  if (kujiNames.length > 0) {
    parts.push(`一番くじでは ${kujiNames.join("、")} を先読みで追っています。`);
  }
  if (weakTargets.length > 0) {
    parts.push(`まだ補完したいのは ${weakTargets.join("、")} あたりで、価格や直リンクが埋まれば上段へ上げやすくなります。`);
  }
  return {
    text: parts.slice(0, 4).join(" "),
    sourceMode: "heuristic",
    generatedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
    basedOn: focusNames.map(normalizeProductKey),
  };
}

function sanitizeExtraction(extraction) {
  const products = (extraction.products ?? [])
    .map((product) => ({ ...product, name: canonicalizeProductName(product.name) }))
    .filter((product) => productPhraseLooksSpecific(product.name));
  const validKeys = new Set(products.map((product) => normalizeProductKey(product.name)));
  const events = (extraction.events ?? [])
    .map((event) => ({ ...event, productName: canonicalizeProductName(event.productName) }))
    .filter((event) => validKeys.has(normalizeProductKey(event.productName)));
  const prices = (extraction.prices ?? [])
    .map((price) => ({ ...price, productName: canonicalizeProductName(price.productName) }))
    .filter((price) => validKeys.has(normalizeProductKey(price.productName)));
  if (products.length === 0 && events.length === 0 && prices.length === 0) return null;
  const category = products.find((product) => ["movie_bonus", "movie_goods", "kuji", "pokemon"].includes(product.category))?.category ?? "";
  const fallbackReason =
    extraction.geminiEligibilityReason ||
    (category ? `${category}_candidate` : extraction.mode === "gemini" ? "concrete_product_candidate" : "not_eligible_for_gemini");
  return {
    ...extraction,
    products,
    events,
    prices,
    geminiEligible: Boolean(extraction.geminiEligible ?? extraction.mode === "gemini"),
    geminiEligibilityReason: fallbackReason,
  };
}

function extractionPriorityScore(extraction) {
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

function pruneExtractions(extractions, limit = 20) {
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
    .sort((a, b) => extractionPriorityScore(b) - extractionPriorityScore(a))
    .slice(0, limit);
}

let snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));

snapshot.trends = (snapshot.trends ?? [])
  .map((trend) => ({ ...trend, keyword: canonicalizeProductName(trend.keyword), context: cleanupReasonText(trend.context) }))
  .filter((trend) => productPhraseLooksSpecific(trend.keyword));

snapshot.trendCollectionPool = (snapshot.trendCollectionPool ?? [])
  .map((item) => ({ ...item, keyword: canonicalizeProductName(item.keyword) }))
  .filter((item) => productPhraseLooksSpecific(item.keyword));

snapshot.archivedConcreteTrends = (snapshot.archivedConcreteTrends ?? [])
  .map((item) => ({
    ...item,
    keyword: canonicalizeProductName(item.keyword),
    reason: cleanupReasonText(item.reason),
  }))
  .filter((item) => productPhraseLooksSpecific(item.keyword));

snapshot.discoveryCandidates = (snapshot.discoveryCandidates ?? [])
  .map((candidate) => ({
    ...candidate,
    name: canonicalizeProductName(candidate.name),
    reason: cleanupReasonText(candidate.reason),
    adoptionReason: cleanupReasonText(candidate.adoptionReason),
  }))
  .filter((candidate) => productPhraseLooksSpecific(candidate.name));

snapshot.kujiSpecials = (snapshot.kujiSpecials ?? [])
  .map((special) => ({ ...special, title: canonicalizeProductName(special.title) }))
  .filter((special) => productPhraseLooksSpecific(special.title));

snapshot.pokemonReleases = (snapshot.pokemonReleases ?? [])
  .map((release) => ({ ...release, name: canonicalizeProductName(release.name) }))
  .filter((release) => productPhraseLooksSpecific(release.name));

snapshot.lotteryRoutes = (snapshot.lotteryRoutes ?? [])
  .map((route) => ({ ...route, name: canonicalizeProductName(route.name) }))
  .filter((route) => productPhraseLooksSpecific(route.name));

snapshot.llmExtractions = pruneExtractions((snapshot.llmExtractions ?? []).map(sanitizeExtraction).filter(Boolean), 20);

snapshot.normalizedProducts = (snapshot.normalizedProducts ?? [])
  .map((product) => ({
    ...product,
    canonicalName: canonicalizeProductName(product.canonicalName),
    productKey: normalizeProductKey(product.canonicalName),
    aliases: (product.aliases ?? []).map(canonicalizeProductName).filter(productPhraseLooksSpecific),
    aiThesis:
      product.aiThesis && typeof product.aiThesis === "object"
        ? {
            ...product.aiThesis,
            sourceMode: sourceModeOrHeuristic(product.aiThesis.sourceMode),
            confidence: Number.isFinite(Number(product.aiThesis.confidence)) ? Number(product.aiThesis.confidence) : 0.55,
            comparableMarkets: (product.aiThesis.comparableMarkets ?? []).filter((item) => summaryNameLooksUseful(item?.name)),
          }
        : product.aiThesis,
    priceThesis:
      product.priceThesis && typeof product.priceThesis === "object"
        ? {
            ...product.priceThesis,
            sourceMode: sourceModeOrHeuristic(product.priceThesis.sourceMode),
            priceSourceRank: product.priceThesis.priceSourceRank || "ai_estimate",
            notForBuyLineReason:
              product.priceThesis.notForBuyLineReason || "AI推定価格のため、実成約確認まではBuyLineに使いません。",
            comparablePrices: (product.priceThesis.comparablePrices ?? []).filter((item) => summaryNameLooksUseful(item?.name)),
          }
        : product.priceThesis,
  }))
  .filter((product) => productPhraseLooksSpecific(product.canonicalName))
  .filter((product) => (product.category === "movie_bonus" ? looksLikeConcreteMovieBonusName(product.canonicalName) : true));

snapshot.explorationTasks = (snapshot.explorationTasks ?? []).map((task) => ({
  ...task,
  targetCategory: task.targetCategory || "generic_hobby",
  sourceMode: task.sourceMode === "manual_check" ? "manual_check" : sourceModeOrHeuristic(task.sourceMode),
  buyLineEligible: task.sourceMode === "manual_check" ? false : task.buyLineEligible,
  expectedEvidence:
    Array.isArray(task.expectedEvidence) && task.expectedEvidence.length > 0
      ? task.expectedEvidence.slice(0, 7)
      : ["公式リンク", "日付", "価格"],
}));

const movieAugmentStats = await augmentMovieItemsFromRawArchive(snapshot);

const validProducts = new Map(snapshot.normalizedProducts.map((product) => [product.productKey, product]));
const keepProductKey = (value) => validProducts.has(normalizeProductKey(value));

snapshot.productEvents = (snapshot.productEvents ?? [])
  .map((event) => ({
    ...event,
    productName: canonicalizeProductName(event.productName),
    productKey: normalizeProductKey(event.productName),
  }))
  .filter((event) => keepProductKey(event.productName));

snapshot.routeSnapshots = (snapshot.routeSnapshots ?? [])
  .map((route) => ({
    ...route,
    productName: canonicalizeProductName(route.productName),
    productKey: normalizeProductKey(route.productName),
  }))
  .filter((route) => keepProductKey(route.productName));

snapshot.priceSnapshots = (snapshot.priceSnapshots ?? [])
  .map((price) => ({
    ...price,
    productName: canonicalizeProductName(price.productName),
    productKey: normalizeProductKey(price.productName),
    priceSourceRank: price.priceSourceRank || priceSourceRankFromSource(price.source, price.priceType),
    priceUsage: price.priceUsage || priceSourceUsageFromRank(price.priceSourceRank || priceSourceRankFromSource(price.source, price.priceType)),
    buyLineEligible:
      typeof price.buyLineEligible === "boolean"
        ? price.buyLineEligible
        : priceSourceUsageFromRank(price.priceSourceRank || priceSourceRankFromSource(price.source, price.priceType)) === "buyline",
  }))
  .filter((price) => keepProductKey(price.productName));

snapshot.predictedPriceSnapshots = (snapshot.predictedPriceSnapshots ?? [])
  .map((price) => ({
    ...price,
    productName: canonicalizeProductName(price.productName),
    productKey: normalizeProductKey(price.productName),
    priceSourceRank: "historical_prediction",
    priceUsage: "watch",
    buyLineEligible: false,
  }))
  .filter((price) => keepProductKey(price.productName));

snapshot.discoveryCandidates = (snapshot.discoveryCandidates ?? []).map((candidate) => {
  const marketPriceSourceRank = candidate.marketPriceSourceRank || priceSourceRankFromSource(candidate.marketPriceSource, "market");
  const retailPriceSourceRank = candidate.retailPriceSourceRank || priceSourceRankFromSource(candidate.retailPriceSource, "retail");
  const enriched = {
    ...candidate,
    marketPriceSourceRank,
    marketPriceUsage: candidate.marketPriceUsage || priceSourceUsageFromRank(marketPriceSourceRank),
    marketPriceBuyLineEligible: isProvisionalBuyLineRank(marketPriceSourceRank),
    retailPriceSourceRank,
    retailPriceUsage: candidate.retailPriceUsage || priceSourceUsageFromRank(retailPriceSourceRank),
    retailPriceBuyLineEligible: isProvisionalBuyLineRank(retailPriceSourceRank),
    buyLineStatus: provisionalCandidateBuyLineStatus({
      marketPriceSourceRank,
      retailPriceSourceRank,
      marketPrice: candidate.marketPrice,
      retailPrice: candidate.retailPrice,
    }),
  };
  const state = deriveCandidateState(enriched);
  const product = validProducts.get(normalizeProductKey(enriched.name)) ?? null;
  const statusReasons = deriveCandidateStatusReasons({
    ...enriched,
    insufficiencyReasons: state.insufficiencyReasons,
  });
  const geminiEligibility = candidateGeminiEligibility(enriched, product, statusReasons);
  return {
    ...enriched,
    candidateState: state.candidateState,
    candidateStatus: state.candidateState,
    status: state.candidateState,
    insufficiencyReasons: state.insufficiencyReasons,
    statusReasons,
    geminiEligible: geminiEligibility.eligible,
    geminiEligibilityReason: geminiEligibility.reason,
  };
});

snapshot.historicalComparables = (snapshot.historicalComparables ?? []).filter(
  (row) => validProducts.has(row.productKey) && (!row.comparableKey || validProducts.has(row.comparableKey)),
);

snapshot.selectionReasons = (snapshot.selectionReasons ?? [])
  .map((reason) => rewriteSelectionReason(reason, validProducts.get(normalizeProductKey(reason.productName))))
  .filter((reason) => keepProductKey(reason.productName));

snapshot.productLearning = (snapshot.productLearning ?? [])
  .map((item) => ({
    ...item,
    key: normalizeProductKey(item.name),
    name: canonicalizeProductName(item.name),
  }))
  .filter((item) => productPhraseLooksSpecific(item.name));

const existingOverview = snapshot.overviewNarrative && typeof snapshot.overviewNarrative.text === "string" ? snapshot.overviewNarrative : null;
if (existingOverview && ["openai", "gemini"].includes(existingOverview.sourceMode)) {
  snapshot.overviewNarrative = {
    ...existingOverview,
    text: compactText(existingOverview.text),
    basedOn: Array.isArray(existingOverview.basedOn) ? existingOverview.basedOn.filter(Boolean).slice(0, 24) : [],
  };
} else {
  snapshot.overviewNarrative = buildNarrative(snapshot);
}
snapshot.metadata = snapshot.metadata ?? {};
snapshot.metadata.normalizedProductCount = snapshot.normalizedProducts.length;
snapshot.metadata.productEventCount = snapshot.productEvents.length;
snapshot.metadata.routeSnapshotCount = snapshot.routeSnapshots.length;
snapshot.metadata.priceSnapshotCount = snapshot.priceSnapshots.length;
snapshot.metadata.predictedPriceSnapshotCount = snapshot.predictedPriceSnapshots.length;
snapshot.metadata.historicalComparableCount = snapshot.historicalComparables.length;
snapshot.metadata.llmExtractionCount = snapshot.llmExtractions.length;
snapshot.metadata.selectionReasonCount = snapshot.selectionReasons.length;
snapshot.metadata.aiThesisCount = snapshot.normalizedProducts.filter((product) => product.aiThesis?.whyHot).length;
snapshot.metadata.priceThesisCount = snapshot.normalizedProducts.filter((product) => product.priceThesis?.estimatedMarketPrice).length;
snapshot.metadata.aiThesisSourceModeCounts = (snapshot.normalizedProducts ?? []).reduce((acc, product) => {
  const mode = String(product.aiThesis?.sourceMode ?? "").trim();
  if (!mode) return acc;
  acc[mode] = (acc[mode] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.priceThesisSourceModeCounts = (snapshot.normalizedProducts ?? []).reduce((acc, product) => {
  const mode = String(product.priceThesis?.sourceMode ?? "").trim();
  if (!mode) return acc;
  acc[mode] = (acc[mode] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.overviewNarrativeMode = snapshot.overviewNarrative.sourceMode;
snapshot.metadata.overviewNarrativeError = snapshot.overviewNarrative?.error ?? null;
const modeCounts = {};
const fallbackReasons = {};
const eligibilityReasonCounts = {};
for (const extraction of snapshot.llmExtractions ?? []) {
  const mode = extraction.mode || "heuristic";
  modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
  const eligibilityReason = String(extraction.geminiEligibilityReason ?? "").trim();
  if (eligibilityReason) eligibilityReasonCounts[eligibilityReason] = (eligibilityReasonCounts[eligibilityReason] ?? 0) + 1;
  const reason = String(extraction.fallbackReason ?? "").trim();
  if (reason) fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
}
const previousLlmExecution = snapshot.metadata?.llmExecution ?? {};
const configuredFromModes =
  (modeCounts.openai ?? 0) > 0 ||
  (modeCounts.gemini ?? 0) > 0 ||
  ["openai", "gemini"].includes(snapshot.overviewNarrative?.sourceMode);
const inferredOverviewFallbackReason =
  snapshot.overviewNarrative?.fallbackReason ??
  snapshot.metadata?.overviewNarrativeError ??
  previousLlmExecution.overviewFallbackReason ??
  previousLlmExecution.overview?.fallbackReason ??
  (!llmProviderConfigured() && !configuredFromModes ? llmProviderMissingReason(configuredLlmProvider) : "");
snapshot.metadata.llmExecution = buildLlmExecutionMetadata({
  snapshot,
  previousLlmExecution,
  modeCounts,
  fallbackReasons,
  eligibilityReasonCounts,
  inferredOverviewFallbackReason,
});
const existingCollectGuard = snapshot.metadata.collectGuard ?? {};
const existingCollectGuardThresholds =
  existingCollectGuard.thresholds && typeof existingCollectGuard.thresholds === "object" ? existingCollectGuard.thresholds : {};
const positiveNumberOrDefault = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const collectGuardThresholds = {
  minReachableSources: positiveNumberOrDefault(existingCollectGuardThresholds.minReachableSources, minSnapshotReachableSources),
  minDocuments: positiveNumberOrDefault(existingCollectGuardThresholds.minDocuments, minSnapshotDocumentCount),
  minProducts: positiveNumberOrDefault(existingCollectGuardThresholds.minProducts, minSnapshotProductCount),
  minPreviousRatio: positiveNumberOrDefault(existingCollectGuardThresholds.minPreviousRatio, minSnapshotPreviousRatio),
  minDocumentRetentionRatio: positiveNumberOrDefault(existingCollectGuardThresholds.minDocumentRetentionRatio, minSnapshotDocumentRetentionRatio),
  minProductRetentionRatio: positiveNumberOrDefault(existingCollectGuardThresholds.minProductRetentionRatio, minSnapshotProductRetentionRatio),
};
snapshot.metadata.collectGuard = {
  degraded: Boolean(existingCollectGuard.degraded),
  reasons: Array.isArray(existingCollectGuard.reasons) ? existingCollectGuard.reasons : [],
  current:
    existingCollectGuard.current && typeof existingCollectGuard.current === "object"
      ? existingCollectGuard.current
      : {
          reachableSources: snapshot.metadata.reachableSources ?? 0,
          documents: Array.isArray(snapshot.documents) ? snapshot.documents.length : 0,
          normalizedProducts: snapshot.normalizedProducts.length,
        },
  previous: existingCollectGuard.previous ?? null,
  thresholds: collectGuardThresholds,
  wroteSnapshot: typeof existingCollectGuard.wroteSnapshot === "boolean" ? existingCollectGuard.wroteSnapshot : true,
  wrotePartialSnapshot: typeof existingCollectGuard.wrotePartialSnapshot === "boolean" ? existingCollectGuard.wrotePartialSnapshot : false,
};
if (!llmProviderConfigured() && !configuredFromModes) {
  snapshot.metadata.llmExecution.fallbackReasons[llmProviderMissingReason(configuredLlmProvider)] =
    snapshot.metadata.llmExecution.fallbackReasons[llmProviderMissingReason(configuredLlmProvider)] ?? 1;
}
snapshot.metadata.candidateStateCounts = (snapshot.discoveryCandidates ?? []).reduce((acc, candidate) => {
  const state = String(candidate.candidateState ?? "missing");
  acc[state] = (acc[state] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.candidateStatusCounts = (snapshot.discoveryCandidates ?? []).reduce((acc, candidate) => {
  const state = String(candidate.candidateStatus ?? candidate.candidateState ?? candidate.status ?? "missing");
  acc[state] = (acc[state] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.priceSourceRankCounts = (snapshot.priceSnapshots ?? []).reduce((acc, price) => {
  const rank = String(price.priceSourceRank ?? "missing");
  acc[rank] = (acc[rank] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.predictedPriceSourceRankCounts = (snapshot.predictedPriceSnapshots ?? []).reduce((acc, price) => {
  const rank = String(price.priceSourceRank ?? "missing");
  acc[rank] = (acc[rank] ?? 0) + 1;
  return acc;
}, {});
snapshot.metadata.movieAugmentStats = movieAugmentStats;

const observationLimits = resolveObservationLimits();
const rawArchiveDirUrl = new URL("../data/raw-archive/", import.meta.url);
const xObservationQueueResult = await buildXObservationQueue(rawArchiveDirUrl, snapshot, {
  maxQueueSize: resolveXQueueLimit(),
});
snapshot.xObservationQueue = xObservationQueueResult.queue;
snapshot.metadata = {
  ...(snapshot.metadata ?? {}),
  observationLimits,
  xObservationQueueSummary: xObservationQueueResult.summary,
  xReaderExecution: {
    ...(snapshot.metadata?.xReaderExecution ?? {}),
    queueLimit: observationLimits.xQueueLimit,
    xStatusUrlCandidates: xObservationQueueResult.summary.total,
    xObservationQueueTotal: xObservationQueueResult.summary.total,
    xObservationQueuePending: xObservationQueueResult.summary.pending,
    xObservationQueueObserved: xObservationQueueResult.summary.reader_observed,
    xObservationQueueFailed: xObservationQueueResult.summary.failed,
    xObservationQueueSkipped: xObservationQueueResult.summary.skipped,
    xObservationQueueStale: xObservationQueueResult.summary.stale,
  },
};

snapshot = applyMarketplaceResearchToSnapshot(snapshot, {
  maxSubjects: observationLimits.marketplaceSubjectLimit,
});
snapshot = applyReaderObservedLabels(snapshot);
snapshot = sanitizeSnapshotClaims(snapshot);

await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const history = JSON.parse(await readFile(historyPath, "utf8"));
if (Array.isArray(history.runs) && history.runs.length > 0) {
  const lastRun = history.runs[history.runs.length - 1];
  if (lastRun?.snapshot) {
    lastRun.snapshot.overviewNarrative = snapshot.overviewNarrative;
    lastRun.snapshot.normalizedProducts = snapshot.normalizedProducts.slice(0, 120);
    lastRun.snapshot.productEvents = snapshot.productEvents.slice(0, 180);
    lastRun.snapshot.selectionReasons = snapshot.selectionReasons.slice(0, 120);
  }
}
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);

const publicHistory = JSON.parse(await readFile(publicHistoryPath, "utf8"));
if (Array.isArray(publicHistory.runs) && publicHistory.runs.length > 0) {
  const lastRun = publicHistory.runs[publicHistory.runs.length - 1];
  if (lastRun) lastRun.overviewNarrative = snapshot.overviewNarrative;
}
await writeFile(publicHistoryPath, `${JSON.stringify(publicHistory, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      products: snapshot.normalizedProducts.length,
      events: snapshot.productEvents.length,
      routes: snapshot.routeSnapshots.length,
      prices: snapshot.priceSnapshots.length,
      reasons: snapshot.selectionReasons.length,
      movieAugmentStats,
      overview: snapshot.overviewNarrative?.text?.slice(0, 160),
    },
    null,
    2,
  ),
);

const __postRoot = path.dirname(fileURLToPath(import.meta.url));
const publish = spawnSync("node", [path.join(__postRoot, "publish-public-share.mjs")], {
  stdio: "inherit",
  env: process.env,
});
if (publish.status !== 0) {
  console.error(`[postprocess] publish-public-share failed (code=${publish.status})`);
  process.exit(publish.status ?? 1);
}
