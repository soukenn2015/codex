/**
 * rejudge-products.mjs
 *
 * 既存の productGroups を Gemini 2.5 Pro で再判定するスクリプト。
 * 「転売のプロ」視点で利益が出るかを厳しく判定し直す。
 *
 * 使い方: GEMINI_API_KEY=xxx node scripts/rejudge-products.mjs
 */

import { readFile, writeFile } from "node:fs/promises";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const geminiBaseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const MODEL = process.env.MARKETLENS_REJUDGE_MODEL || "gemini-2.5-pro";
const BATCH_SIZE = clampNumber(Number(process.env.MARKETLENS_REJUDGE_BATCH_SIZE ?? 8), 1, 12);
const MAX_BATCHES = clampNumber(Number(process.env.MARKETLENS_REJUDGE_MAX_BATCHES ?? 25), 1, 100);
const DELAY_BETWEEN_BATCHES_MS = clampNumber(Number(process.env.MARKETLENS_REJUDGE_DELAY_MS ?? 7000), 1000, 60000);
const FORCE_REJUDGE = process.argv.includes("--force");

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

if (!geminiApiKey) {
  console.error("GEMINI_API_KEY is required");
  process.exit(1);
}

const SYSTEM_PROMPT = `あなたは日本の限定品転売市場で年間売上1000万円を達成しているプロの目利きです。
以下の商品リストについて、それぞれ投資判断を行ってください。

判断基準（優先度順）:
1. 供給制約: 限定数、抽選制、受注生産、店舗限定 → 供給が絞られるほど高評価
2. 需要の確実性: ファン層の規模と熱量（ポケカ > ワンピース > ガンダム > ドラゴンボール > ニッチ）
3. 過去実績: 同シリーズ・同ジャンルの前例でプレ値がついたか
4. タイミング: 初動で利益が出るか、寝かせる必要があるか
5. リスク: 再販リスク、在庫だぶつきリスク、値崩れリスク

重要な注意:
- 「新商品が出る」だけではT1/T2にしないでください。利益が出る根拠が必要です。
- 再販品、一般流通品、供給が潤沢な商品はHOLDにしてください。
- プラモデルの再販は基本的にHOLDです（供給が十分）。
- 展示発表だけで発売日未定の商品はHOLDです。
- 定価が高すぎて利益率が低い商品もHOLDです。
- T1は「確実に利益+5,000円以上」が見込める商品だけです。
- Twitter/Xアカウント名、速報アカウント名、まとめアカウント名は商品ではありません。必ず tier=HOLD にしてください。
- 「@pokecachan」のような監視元名だけのエントリは商品名ではありません。
- 信頼キュレーター（@pokecachan / @oroshinohito）が同一商品を確認済みの場合は、HOLD 判断を慎重に。ただし根拠のない T1 は付けないでください。

出力はJSON配列で返してください。各要素:
{
  "index": 商品のインデックス番号,
  "tier": "T1" | "T2" | "T3" | "HOLD",
  "profit_min": 最低利益予測(円、不明なら0),
  "profit_max": 最高利益予測(円、不明なら0),
  "confidence": 1-5の確度,
  "reasoning": "判断理由（3文以上。具体的な根拠を含める）",
  "action": "具体的に何をいつすべきか",
  "risk": "リスク要因（1文）",
  "urgency": "immediate" | "this_week" | "next_week" | "watch",
  "risk_factors": ["リスク1", "リスク2"],
  "similar_products": [{ "name": "類似商品名", "sold_price": 数値, "note": "補足" }]
}`;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(userPrompt, retries = 5) {
  const url = `${geminiBaseUrl}/models/${MODEL}:generateContent?key=${geminiApiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 503 || res.status === 429) {
      lastError = new Error(`Gemini API error ${res.status}: rate limited`);
      const backoffMs = DELAY_BETWEEN_BATCHES_MS * attempt;
      console.log(`  retry ${attempt}/${retries} after ${backoffMs}ms (${res.status})`);
      await sleep(backoffMs);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      throw new Error(`Failed to parse Gemini response: ${text.slice(0, 200)}`);
    }
  }

  throw lastError ?? new Error("Gemini API retries exhausted");
}

function isAccountOrSignalName(name) {
  if (!name) return true;
  if (/@[\w_]+|（@[\w_]+）|\(@[\w_]+\)/.test(name)) return true;
  if (/抽選・再販速報|抽選・再販まとめ|速報（@|まとめ（@/i.test(name)) return true;
  return false;
}

function isGoodCandidate(g) {
  const name = g.canonicalName || "";
  if (name.length < 4 || name.length > 90) return false;
  if (isAccountOrSignalName(name)) return false;
  if (/[<>]|<img|src=|https?:\/\//i.test(name)) return false;
  if (/^(A賞|B賞|C賞|D賞|ラインナップ|対象となっている|公式サイトで|予約◆|9 20)/.test(name)) return false;
  if (/しているほか|となっている|で確認|AI判断待ち|組み換え可能な食玩/.test(name)) return false;
  if (name.includes("】") && !name.includes("【")) return false;
  if (!FORCE_REJUDGE && g.judgment?.decisionOrigin === "gemini" && g.judgment?.rejudgedAt) return false;
  return true;
}

function priorityScore(g) {
  const name = g.canonicalName || "";
  let score = 0;
  if (/ポケカ|ポケモンカード|TCG/i.test(name)) score += 50;
  if (/一番くじ/i.test(name)) score += 40;
  if (/限定|コラボ|抽選/i.test(name)) score += 30;
  if (/ROBOT魂|METAL BUILD|S\.H\.Figuarts/i.test(name)) score += 20;
  const hasDate = g.events?.some(e => e.startsAt || e.endsAt);
  if (hasDate) score += 15;
  if (g.judgment?.decisionOrigin === "gemini") score -= 100;
  if (["A", "B"].includes(g.curatorTrust?.level ?? "")) score += 35;
  if (g.curatorTrust?.level === "C") score += 15;
  return score;
}

function buildBatchPrompt(items) {
  const list = items.map((item, i) => {
    const g = item.group;
    const events = (g.events || []).map(e => {
      const parts = [e.eventType];
      if (e.startsAt) parts.push(`starts:${e.startsAt}`);
      if (e.endsAt) parts.push(`ends:${e.endsAt}`);
      return parts.join(" ");
    }).join("; ");
    const headline = g.judgment?.reason?.headline || "";
    const curator = g.curatorTrust?.level
      ? `curatorTrust=${g.curatorTrust.level} handles=${(g.curatorTrust.handles ?? []).join(",")}`
      : "curatorTrust=none";
    return `[${i}] ${g.canonicalName}\n  events: ${events || "なし"}\n  current_headline: ${headline}\n  ${curator}`;
  }).join("\n\n");

  return `以下の${items.length}件の商品を判定してください。\n\n${list}`;
}

async function main() {
  console.log("Loading snapshot...");
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  const groups = snapshot.productGroups || [];

  const candidates = groups
    .map((g, i) => ({ group: g, originalIndex: i }))
    .filter(item => isGoodCandidate(item.group))
    .sort((a, b) => priorityScore(b.group) - priorityScore(a.group))
    .slice(0, BATCH_SIZE * MAX_BATCHES);

  console.log(`Model: ${MODEL}`);
  console.log(`Candidates for rejudging: ${candidates.length}`);
  console.log(`Will process in ${Math.ceil(candidates.length / BATCH_SIZE)} batches of ${BATCH_SIZE}`);

  let totalJudged = 0;
  let t1Count = 0;
  let t2Count = 0;

  for (let batchIdx = 0; batchIdx < Math.ceil(candidates.length / BATCH_SIZE); batchIdx++) {
    const batch = candidates.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
    const prompt = buildBatchPrompt(batch);

    console.log(`\nBatch ${batchIdx + 1}/${Math.ceil(candidates.length / BATCH_SIZE)}...`);
    try {
      const results = await callGemini(prompt);
      if (!Array.isArray(results)) {
        console.error("  Unexpected response format, skipping batch");
        continue;
      }

      for (const result of results) {
        const idx = result.index;
        if (idx == null || idx < 0 || idx >= batch.length) continue;
        const item = batch[idx];
        const g = groups[item.originalIndex];
        let tier = ["T1", "T2", "T3", "HOLD"].includes(result.tier) ? result.tier : "HOLD";
        if (isAccountOrSignalName(g.canonicalName)) tier = "HOLD";

        g.judgment = g.judgment || {};
        g.judgment.tier = { value: tier, confidence: (result.confidence || 3) / 5 };
        g.judgment.decisionOrigin = "gemini";
        g.judgment.rejudgedAt = new Date().toISOString();
        const reasoning = String(result.reasoning || "").trim();
        const headline = reasoning ? `${reasoning.split("。")[0]}。` : "AI判定済みです。";
        g.judgment.reason = {
          headline,
          whyNow: result.action || "",
          detail: reasoning,
          risk: result.risk || "",
          risk_factors: Array.isArray(result.risk_factors) ? result.risk_factors : (result.risk ? [result.risk] : []),
          urgency: ["immediate", "this_week", "next_week", "watch"].includes(result.urgency) ? result.urgency : "watch",
          similar_products: Array.isArray(result.similar_products) ? result.similar_products : [],
          profitMin: result.profit_min || 0,
          profitMax: result.profit_max || 0,
          profitConfidence: result.confidence || 3,
        };

        totalJudged++;
        if (tier === "T1") t1Count++;
        if (tier === "T2") t2Count++;

        console.log(`  [${tier}] ${g.canonicalName.slice(0, 40)} | ${reasoning.slice(0, 50)}`);
      }
    } catch (err) {
      console.error(`  Batch ${batchIdx + 1} failed: ${err.message}`);
      if (err.message.includes("429")) {
        console.log("  Rate limited. Waiting 60s...");
        await new Promise(r => setTimeout(r, 60000));
        batchIdx--;
        continue;
      }
    }

    if (batchIdx < Math.ceil(candidates.length / BATCH_SIZE) - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  let accountHoldCount = 0;
  for (const g of groups) {
    if (!isAccountOrSignalName(g.canonicalName)) continue;
    g.judgment = g.judgment || {};
    g.judgment.tier = { value: "HOLD", confidence: 0.2 };
    g.judgment.decisionOrigin = "gemini";
    g.judgment.rejudgedAt = new Date().toISOString();
    g.judgment.reason = {
      headline: "監視元アカウント名のため商品ではありません。",
      whyNow: "",
      detail: "Twitter/Xアカウント名や速報まとめアカウントは転売対象の商品名ではないため、表示対象外です。",
      risk: "",
      profitMin: 0,
      profitMax: 0,
      profitConfidence: 1,
    };
    accountHoldCount += 1;
  }

  console.log(`\n=== Results ===`);
  console.log(`Total judged: ${totalJudged}`);
  console.log(`T1: ${t1Count}, T2: ${t2Count}`);
  console.log(`Account signals forced HOLD: ${accountHoldCount}`);

  await writeFile(snapshotUrl, JSON.stringify(snapshot, null, 2));
  console.log("Snapshot updated.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
