/**
 * discovery-agent.mjs — Layer 1: 次に見るべきソース/クエリ/X を Gemini で決定
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  compactText,
  extractHandlesFromSamples,
  writeJson,
  clampNumber,
} from "./marketlens-shared.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const sourceConfigUrl = new URL("../data/source-config.json", import.meta.url);
const buzzQueriesUrl = new URL("../data/buzz-queries.json", import.meta.url);
const xAccountsUrl = new URL("../data/x-accounts.json", import.meta.url);

const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.MARKETLENS_DISCOVERY_MODEL || "gemini-2.5-pro";
const geminiBaseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");

async function callGemini(prompt) {
  if (!geminiApiKey) return null;
  const url = `${geminiBaseUrl}/models/${MODEL}:generateContent?key=${geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "You are a Japanese resale market discovery agent. Output strict JSON only.",
        }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildHeuristicPlan(snapshot = {}) {
  const tasks = (snapshot.explorationTasks ?? []).slice(0, 8);
  const buzzSamples = (snapshot.socialSearchSignals ?? [])
    .flatMap((row) => row.samples ?? [])
    .slice(0, 20);
  const handles = extractHandlesFromSamples(buzzSamples);
  const topGroups = (snapshot.productGroups ?? [])
    .filter((g) => ["T1", "T2"].includes(String(g.judgment?.tier?.value ?? g.judgment?.tier ?? "")))
    .slice(0, 5);

  return {
    newBuzzQueries: topGroups.map((g, i) => ({
      id: `agent:${i + 1}`,
      query: `${g.canonicalName} プレ値 OR 即完売`,
      label: g.canonicalName,
    })),
    newSources: tasks.slice(0, 3).map((task, i) => ({
      url: task.url ?? task.seedUrl ?? "",
      lane: task.lane ?? "blog",
      reason: task.reason ?? "exploration task",
      id: `agent-source:${i + 1}`,
    })).filter((row) => row.url),
    newXAccounts: handles.slice(0, 10),
    mercariPatrol: topGroups.map((g) => ({
      productKey: g.canonicalName,
      query: g.canonicalName,
      urgency: "this_week",
    })),
    competitorGaps: [],
    origin: "heuristic",
  };
}

async function mergePlan(plan) {
  const sourceConfig = JSON.parse(await readFile(sourceConfigUrl, "utf8"));
  let buzzData = { queries: [] };
  try {
    buzzData = JSON.parse(await readFile(buzzQueriesUrl, "utf8"));
  } catch {
    buzzData = { queries: [] };
  }
  let xData = { accounts: [] };
  try {
    xData = JSON.parse(await readFile(xAccountsUrl, "utf8"));
  } catch {
    xData = { accounts: [] };
  }

  const existingBuzz = new Set((buzzData.queries ?? []).map((q) => q.query));
  for (const row of plan.newBuzzQueries ?? []) {
    const query = compactText(row.query);
    if (!query || existingBuzz.has(query)) continue;
    buzzData.queries.push({ id: row.id ?? `agent:${existingBuzz.size + 1}`, label: row.label ?? query, query, ip: "agent" });
    existingBuzz.add(query);
  }

  const existingHandles = new Set((xData.accounts ?? []).map((h) => compactText(h).replace(/^@/, "")));
  for (const handle of plan.newXAccounts ?? []) {
    const h = compactText(handle).replace(/^@/, "");
    if (!h || existingHandles.has(h)) continue;
    xData.accounts.push(h);
    existingHandles.add(h);
  }

  const existingUrls = new Set((sourceConfig.sources ?? []).map((s) => s.url));
  for (const row of plan.newSources ?? []) {
    const url = compactText(row.url);
    if (!url || existingUrls.has(url)) continue;
    sourceConfig.sources.push({
      sourceKey: `agent-${existingUrls.size + 1}`,
      lane: row.lane ?? "blog",
      url,
      keyword: row.reason ?? "discovery agent",
      seed: false,
      priority: "medium",
    });
    existingUrls.add(url);
  }

  await writeFile(buzzQueriesUrl, `${JSON.stringify(buzzData, null, 2)}\n`, "utf8");
  await writeFile(xAccountsUrl, `${JSON.stringify(xData, null, 2)}\n`, "utf8");
  await writeFile(sourceConfigUrl, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");

  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  snapshot.discoveryAgent = {
    observedAt: new Date().toISOString(),
    plan,
    buzzQueryCount: buzzData.queries.length,
    xAccountCount: xData.accounts.length,
    sourceCount: sourceConfig.sources.length,
  };
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  let plan = null;

  if (geminiApiKey) {
    const prompt = JSON.stringify({
      task: "Suggest next discovery actions for Japanese limited goods resale.",
      topTiers: (snapshot.productGroups ?? []).slice(0, 15).map((g) => ({
        name: g.canonicalName,
        tier: g.judgment?.tier,
        events: g.events,
      })),
      explorationTasks: (snapshot.explorationTasks ?? []).slice(0, 10),
      buzzSignals: (snapshot.socialSearchSignals ?? []).slice(0, 5),
      outputSchema: {
        newBuzzQueries: [{ id: "string", query: "string", label: "string" }],
        newSources: [{ url: "string", lane: "string", reason: "string" }],
        newXAccounts: ["handle"],
        mercariPatrol: [{ productKey: "string", query: "string", urgency: "string" }],
        competitorGaps: [{ productKey: "string", note: "string" }],
      },
    });
    plan = await callGemini(prompt);
    if (plan) plan.origin = "gemini";
  }

  if (!plan) plan = buildHeuristicPlan(snapshot);
  await mergePlan(plan);
  console.log(`[discovery-agent] origin=${plan.origin} buzz+${(plan.newBuzzQueries ?? []).length} sources+${(plan.newSources ?? []).length} x+${(plan.newXAccounts ?? []).length}`);
}

main().catch((error) => {
  console.error("[discovery-agent] fatal:", error?.message ?? error);
  process.exit(1);
});
