/**
 * curator-quality-diff.mjs — Phase 7: キュレーター基準との差分・追い越し指標
 */

import { readFile, writeFile } from "node:fs/promises";
import { compactText, normalizeProductKey } from "./marketlens-shared.mjs";
import { looksLikeCuratorNoiseName, nameOverlapScore } from "./curator-parse.mjs";

const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);
const STRICT_TIERS = new Set(["T1", "T2", "T3"]);
const CURATOR_HANDLES = ["pokecachan", "oroshinohito"];

function isStrictGroup(group = {}) {
  const tier = group.judgment?.tier ?? group.judgment?.headlineTier ?? "";
  const curatorLevel = group.curatorTrust?.level ?? "E";
  if (["A", "B"].includes(curatorLevel)) return true;
  if (group.judgment?.decisionOrigin !== "gemini") return false;
  return STRICT_TIERS.has(tier);
}

function groupMatchesMention(group = {}, mention = {}) {
  const score = nameOverlapScore(group.canonicalName ?? "", mention.productName ?? "");
  return score >= 0.55;
}

function parsePostedAt(value = "") {
  const text = compactText(value);
  if (!text) return null;
  if (/^\d+分前$/u.test(text)) return Date.now() - 5 * 60 * 1000;
  if (/^\d+時間前$/u.test(text)) return Date.now() - Number(text.replace(/\D/g, "")) * 3600 * 1000;
  if (text === "昨日") return Date.now() - 24 * 3600 * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupFirstSeenMs(group = {}, snapshot = {}) {
  const candidates = [
    group.firstSeenAt,
    group.createdAt,
    group.judgment?.rejudgedAt,
    snapshot.metadata?.updatedAt,
  ];
  for (const value of candidates) {
    const parsed = Date.parse(String(value ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function buildCuratorQualityReport(snapshot = {}) {
  const mentions = (snapshot.curatorMentions ?? []).filter(
    (row) => !looksLikeCuratorNoiseName(row.productName ?? "", CURATOR_HANDLES),
  );
  const groups = snapshot.productGroups ?? [];
  const strictGroups = groups.filter(isStrictGroup);

  const matchedMentions = [];
  const misses = [];
  for (const mention of mentions) {
    const matches = groups.filter((group) => groupMatchesMention(group, mention));
    if (matches.length) {
      matchedMentions.push({ mention, groups: matches });
    } else {
      misses.push({
        handle: mention.handle,
        productName: mention.productName,
        postUrl: mention.postUrl ?? null,
      });
    }
  }

  const recall = mentions.length ? Number((matchedMentions.length / mentions.length).toFixed(3)) : null;
  const curatorBackedStrict = strictGroups.filter((group) => ["A", "B", "C"].includes(group.curatorTrust?.level ?? "E"));
  const precision =
    strictGroups.length ? Number((curatorBackedStrict.length / strictGroups.length).toFixed(3)) : null;

  let leadCount = 0;
  for (const row of matchedMentions) {
    const postedMs = parsePostedAt(row.mention.postedAt);
    if (!postedMs) continue;
    const earliestGroupMs = Math.min(
      ...row.groups
        .map((group) => groupFirstSeenMs(group, snapshot))
        .filter((value) => Number.isFinite(value)),
    );
    if (Number.isFinite(earliestGroupMs) && earliestGroupMs <= postedMs) leadCount += 1;
  }
  const leadRate = matchedMentions.length ? Number((leadCount / matchedMentions.length).toFixed(3)) : null;

  const exclusivePicks = strictGroups
    .filter((group) => !["A", "B", "C"].includes(group.curatorTrust?.level ?? "E"))
    .map((group) => ({
      canonicalName: group.canonicalName,
      tier: group.judgment?.tier ?? null,
      productKey: normalizeProductKey(group.canonicalName ?? ""),
    }))
    .slice(0, 30);

  const overPicks = strictGroups
    .filter((group) => looksLikeCuratorNoiseName(group.canonicalName ?? "", CURATOR_HANDLES))
    .map((group) => ({ canonicalName: group.canonicalName, tier: group.judgment?.tier ?? null }));

  const surpassScore =
    recall == null && precision == null && leadRate == null
      ? null
      : Number(
          (
            (recall ?? 0) * 0.35 +
            (precision ?? 0) * 0.25 +
            (leadRate ?? 0) * 0.25 +
            Math.min(1, exclusivePicks.length / 20) * 0.15
          ).toFixed(3),
        );

  return {
    observedAt: new Date().toISOString(),
    mentionCount: mentions.length,
    strictCount: strictGroups.length,
    recall,
    precision,
    leadCount,
    leadRate,
    exclusiveCount: exclusivePicks.length,
    surpassScore,
    goal: "match_then_surpass",
    gaps: {
      misses: misses.slice(0, 40),
      overPicks: overPicks.slice(0, 20),
      exclusivePicks,
    },
  };
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  snapshot.curatorQualityReport = buildCuratorQualityReport(snapshot);
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const report = snapshot.curatorQualityReport;
  console.log(
    `[curator-quality-diff] recall=${report.recall} precision=${report.precision} leadRate=${report.leadRate} surpass=${report.surpassScore}`,
  );
}

main().catch((error) => {
  console.error("[curator-quality-diff] fatal:", error?.message ?? error);
  process.exit(1);
});
