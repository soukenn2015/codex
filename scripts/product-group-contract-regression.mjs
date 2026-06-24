import assert from "node:assert/strict";
import {
  AI_JUDGMENT_CONTRACT_VERSION,
  PRODUCT_GROUP_SCHEMA_VERSION,
  buildProductGroupsFromSnapshot,
  createProductGroup,
  runParallelAiJudgment,
  validateAiJudgment,
} from "./marketlens-product-groups.mjs";

function sampleJudgment(overrides = {}) {
  return {
    contractVersion: AI_JUDGMENT_CONTRACT_VERSION,
    identity: {
      canonicalName: "周年記念コレクション",
      confidence: 0.91,
      evidenceRefs: ["official-1", "social-1"],
    },
    grouping: { memberProductKeys: ["anniversary-red", "anniversary-blue"] },
    events: [
      {
        eventKey: "lottery-1",
        type: "lottery",
        priorityMoment: "end",
        startsAt: "2026-06-20T00:00:00+09:00",
        endsAt: "2026-06-24T23:59:00+09:00",
        evidenceRefs: ["official-1"],
      },
      {
        eventKey: "sale-1",
        type: "sale",
        priorityMoment: "start",
        startsAt: "2026-06-28T10:00:00+09:00",
        endsAt: null,
        evidenceRefs: ["official-1"],
      },
    ],
    tier: { value: "T1", confidence: 0.86, rationale: "抽選終了が近く公式情報で商品同定できる" },
    reason: {
      headline: "周年記念商品の抽選終了を先に確認",
      whyNow: "公式の抽選終了が近く、Xでも引用を伴う反応がある",
      evidenceRefs: ["official-1", "social-1"],
    },
    uncertainty: { level: "medium", issues: ["variant_match_unconfirmed"], counterEvidenceRefs: ["article-1"] },
    ...overrides,
  };
}

const judgment = sampleJudgment();
const group = createProductGroup({
  canonicalName: "周年記念コレクション",
  identity: { confidence: 0.91, status: "identified" },
  members: [
    { productKey: "anniversary-red", name: "周年記念コレクション 赤" },
    { productKey: "anniversary-blue", name: "周年記念コレクション 青" },
  ],
  events: judgment.events,
  judgment,
  evidence: [
    { ref: "article-1", kind: "article" },
    { ref: "social-1", kind: "social" },
    { ref: "official-1", kind: "official" },
  ],
});

assert.equal(group.schemaVersion, PRODUCT_GROUP_SCHEMA_VERSION);
assert.deepEqual(group.events.map((event) => event.priorityMoment), ["end", "start"]);
assert.deepEqual(group.events[0].memberProductKeys, ["anniversary-blue", "anniversary-red"]);
assert.deepEqual(group.evidence.map((item) => item.kind), ["official", "social", "article"]);
assert.deepEqual(group.members.map((item) => item.productKey), ["anniversary-red", "anniversary-blue"]);
assert.equal(Object.hasOwn(group, "priceSnapshots"), false);
assert.equal(Object.hasOwn(group, "buyLine"), false);

assert.throws(
  () => validateAiJudgment(sampleJudgment({ estimatedProfit: 12000 })),
  /crossed deterministic price boundary/,
  "AI judgment must never own estimated profit",
);

assert.throws(
  () => validateAiJudgment(sampleJudgment({ priceSnapshots: [] })),
  /crossed deterministic price boundary/,
  "AI judgment must never own price snapshots",
);

assert.throws(
  () => validateAiJudgment(sampleJudgment({ marketPriceEstimate: 25000 })),
  /crossed deterministic price boundary/,
  "AI judgment must reject unrecognized price-bearing fields too",
);

assert.throws(
  () =>
    createProductGroup({
      canonicalName: "周年記念コレクション",
      identity: { confidence: 0.91, status: "identified" },
      members: [{ productKey: "anniversary-red", name: "周年記念コレクション 赤" }],
      events: judgment.events,
      judgment,
      evidence: [{ ref: "official-1", kind: "official" }],
    }),
  /evidenceRefs must resolve/,
  "AI evidence references must resolve to retained evidence",
);

assert.throws(
  () =>
    createProductGroup({
      canonicalName: "周年記念コレクション",
      identity: { confidence: 0.91, status: "identified" },
      members: [{ productKey: "anniversary-red", name: "周年記念コレクション 赤" }],
      events: judgment.events,
      judgment,
      evidence: [
        { ref: "official-1", kind: "official" },
        { ref: "social-1", kind: "social" },
        { ref: "article-1", kind: "article" },
      ],
    }),
  /must exactly match product-group members/,
  "AI grouping must not silently drop or invent product members",
);

const accepted = await runParallelAiJudgment({
  input: { evidenceRefs: ["official-1", "social-1"] },
  lightExtractor: async () => ({ eventCount: 2, judgment }),
  strongIdentifier: async () => ({ identityMatch: true, judgment }),
  critic: async ({ lightResult, strongResult }) => ({
    status: lightResult.eventCount === 2 && strongResult.identityMatch ? "accept" : "review",
    summary: "一致",
    disagreements: [],
    judgment,
  }),
});
assert.equal(accepted.requiresHumanReview, false);
assert.equal(accepted.judgment.tier.value, "T1");

const held = await runParallelAiJudgment({
  input: { evidenceRefs: ["official-1", "social-1"] },
  lightExtractor: async () => ({ eventCount: 1, judgment }),
  strongIdentifier: async () => ({ identityMatch: false, judgment }),
  critic: async () => ({
    status: "review",
    summary: "商品バリアントの同定が不一致",
    disagreements: [{ code: "identity_disagreement", severity: "critical" }],
    judgment,
  }),
});
assert.equal(held.requiresHumanReview, true);
assert.equal(held.judgment.tier.value, "HOLD");
assert.equal(held.judgment.uncertainty.level, "high");
assert.ok(held.judgment.uncertainty.issues.includes("identity_disagreement"));

const groupedSnapshot = {
  normalizedProducts: [
    {
      productKey: "db-goku-last-one",
      canonicalName: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空",
      aliases: ["一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空"],
      aiThesis: { confidence: 0.6 },
    },
    {
      productKey: "db-goku-gallery",
      canonicalName: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU フォトギャラリー",
      aliases: ["一番くじ ドラゴンボール THE CHRONICLE OF GOKU フォトギャラリー"],
      aiThesis: { confidence: 0.6 },
    },
    {
      productKey: "db-goku-gallery-2",
      canonicalName: "ドラゴンボール THE CHRONICLE OF GOKU フォトギャラリー",
      aliases: ["ドラゴンボール THE CHRONICLE OF GOKU フォトギャラリー"],
      aiThesis: { confidence: 0.6 },
    },
  ],
  llmExtractions: [
    {
      docId: "doc:gemini-1",
      sourceKey: "official:https://1kuji.com/products/db_goku",
      mode: "gemini",
      confidence: 0.72,
      products: [
        {
          name: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空",
        },
        {
          name: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU フォトギャラリー",
        },
        {
          name: "ドラゴンボール THE CHRONICLE OF GOKU フォトギャラリー",
        },
      ],
      events: [
        {
          productName: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空",
          eventType: "trend_signal",
          startDate: "2026-04-30",
          endDate: null,
          routeType: "signal",
        },
      ],
      prices: [],
      reasons: {
        whyTopic: "一番くじの具体商品候補を検知",
        whyTiming: "公式の更新を確認",
        whyRoute: "直リンク候補あり",
      },
    },
    {
      docId: "doc:heuristic-1",
      sourceKey: "blog:https://example.com/post",
      mode: "heuristic",
      confidence: 0.9,
      products: [{ name: "ヒューリスティック商品" }],
      events: [],
      prices: [],
      reasons: { whyTopic: "heuristic only" },
    },
  ],
  routeSnapshots: [
    {
      id: "route:db-goku",
      productKey: "db-goku-last-one",
      source: "official",
    },
  ],
  selectionReasons: [
    {
      productKey: "db-goku-last-one",
      shortWhy: "一番くじの具体商品候補を検知",
      shortNow: "公式の更新を確認",
    },
  ],
};

const builtGroups = await buildProductGroupsFromSnapshot(groupedSnapshot);
assert.equal(builtGroups.length, 1, "real AI extraction だけが product group を生成すべきです");
assert.equal(builtGroups[0].schemaVersion, PRODUCT_GROUP_SCHEMA_VERSION);
assert.equal(builtGroups[0].sourceMode, "gemini");
assert.equal(builtGroups[0].judgment.contractVersion, AI_JUDGMENT_CONTRACT_VERSION);
assert.deepEqual(
  builtGroups[0].members.map((item) => item.productKey).sort(),
  ["db-goku-gallery", "db-goku-gallery-2", "db-goku-last-one"].sort(),
);
assert.equal(builtGroups[0].requiresHumanReview, true, "境界が曖昧な product group は HOLD に倒すべきです");
assert.equal(builtGroups[0].judgment.tier.value, "HOLD", "境界が曖昧な product group は HOLD に倒すべきです");
assert.equal(builtGroups[0].criticStatus, "review", "境界が曖昧な product group は critic review になるべきです");
assert.ok(
  builtGroups[0].criticDisagreements.some((item) => item.code === "boundary_review_required"),
  "境界が曖昧な product group は boundary_review_required を残すべきです",
);
assert.ok(
  builtGroups[0].judgment.uncertainty.issues.includes("group_boundary_needs_review"),
  "境界が曖昧な product group は boundary review issue を持つべきです",
);
assert.deepEqual(
  builtGroups[0].reviewContext?.allMatchedMemberProductKeys?.sort(),
  ["db-goku-gallery", "db-goku-gallery-2", "db-goku-last-one"].sort(),
  "HOLD group は review 用の全 matched member を保持すべきです",
);
assert.ok(
  Array.isArray(builtGroups[0].reviewContext?.droppedMemberProductKeys),
  "HOLD group は dropped member 情報を保持すべきです",
);
assert.ok(
  Array.isArray(builtGroups[0].aiProvenance?.contributors) && builtGroups[0].aiProvenance.contributors.length === 1,
  "product group は AI provenance contributors を保持すべきです",
);
assert.equal(
  builtGroups[0].aiProvenance.contributors[0].docId,
  "doc:gemini-1",
  "product group は provenance contributor に docId を保持すべきです",
);
assert.equal(
  builtGroups[0].aiProvenance.contributors[0].mode,
  "gemini",
  "product group は provenance contributor に source mode を保持すべきです",
);

const noGroupSnapshot = {
  normalizedProducts: groupedSnapshot.normalizedProducts,
  llmExtractions: groupedSnapshot.llmExtractions.filter((row) => row.mode === "heuristic"),
  routeSnapshots: [],
  selectionReasons: [],
};
const noGroups = await buildProductGroupsFromSnapshot(noGroupSnapshot);
assert.equal(noGroups.length, 3, "AI 未判定 product も singleton HOLD group に収容すべきです");
assert.ok(noGroups.every((item) => item.sourceMode === "deterministic_pending"));
assert.ok(noGroups.every((item) => item.requiresHumanReview && item.judgment.tier.value === "HOLD"));
assert.ok(noGroups.every((item) => item.aiProvenance.contributors.length === 0));
assert.equal(noGroups.buildErrors.length, 0, "heuristic extraction で build error は出ないはずです");

const duplicatedAiSnapshot = {
  ...groupedSnapshot,
  llmExtractions: [
    {
      ...groupedSnapshot.llmExtractions[0],
      model: "gemini-3.1-pro",
      confidence: 0.81,
    },
    {
      ...groupedSnapshot.llmExtractions[0],
      docId: "doc:gemini-2",
      model: "gemini-3.1-flash",
      confidence: 0.78,
    },
  ],
};
const duplicatedGroups = await buildProductGroupsFromSnapshot(duplicatedAiSnapshot);
assert.equal(duplicatedGroups.length, 1, "同一 product group は統合して1件にすべきです");
assert.deepEqual(
  duplicatedGroups[0].aiProvenance?.contributors?.map((item) => item.docId).sort(),
  ["doc:gemini-1", "doc:gemini-2"].sort(),
  "同一 groupId の複数 AI 判定は provenance contributors として保持すべきです",
);

const coverageSnapshot = {
  normalizedProducts: [
    { productKey: "alpha", canonicalName: "記念コレクション Alpha", aliases: ["記念コレクション Alpha"], sourceKinds: ["official"] },
    { productKey: "beta", canonicalName: "記念コレクション Beta", aliases: ["記念コレクション Beta"], sourceKinds: ["official"] },
    { productKey: "gamma", canonicalName: "限定フィギュア Gamma", aliases: ["限定フィギュア Gamma"], sourceKinds: ["social"] },
    { productKey: "delta", canonicalName: "予約商品 Delta", aliases: ["予約商品 Delta"], sourceKinds: ["article"] },
  ],
  llmExtractions: [
    {
      docId: "doc:gemini-coverage",
      sourceKey: "official:https://example.com/alpha",
      mode: "gemini",
      model: "gemini-primary",
      confidence: 0.9,
      products: [{ name: "記念コレクション Alpha" }, { name: "記念コレクション Beta" }],
      events: [{ productName: "記念コレクション Alpha", eventType: "lottery_close", startDate: "2026-06-20", endDate: "2026-06-24", routeType: "lottery" }],
      prices: [],
      reasons: { whyTopic: "記念商品", whyTiming: "抽選終了が近い", whyRoute: "公式" },
    },
    {
      docId: "doc:openai-must-not-promote",
      sourceKey: "social:https://example.com/gamma",
      mode: "openai",
      model: "gpt-test",
      confidence: 0.99,
      products: [{ name: "限定フィギュア Gamma" }],
      events: [],
      prices: [],
      reasons: { whyTopic: "他 provider", whyTiming: "今", whyRoute: "X" },
    },
  ],
  productEvents: [
    { id: "event:gamma", productKey: "gamma", productName: "限定フィギュア Gamma", eventType: "sale_open", startDate: "2026-06-25", endDate: null, evidenceDocIds: [] },
    { id: "event:delta", productKey: "delta", productName: "予約商品 Delta", eventType: "lottery_close", startDate: "2026-06-20", endDate: "2026-06-27", evidenceDocIds: [] },
  ],
  routeSnapshots: [],
  selectionReasons: [],
};
const coverageGroups = await buildProductGroupsFromSnapshot(coverageSnapshot);
const coverageMembership = coverageGroups.flatMap((item) => item.members.map((member) => member.productKey));
assert.deepEqual([...coverageMembership].sort(), ["alpha", "beta", "delta", "gamma"], "全 product を商品群へ収容すべきです");
assert.equal(new Set(coverageMembership).size, coverageMembership.length, "product は複数 group に重複所属してはいけません");
const gammaGroup = coverageGroups.find((item) => item.members.some((member) => member.productKey === "gamma"));
assert.equal(gammaGroup.sourceMode, "deterministic_pending", "OpenAI extraction は real AI group に昇格してはいけません");
assert.equal(gammaGroup.judgment.tier.value, "HOLD");
assert.equal(gammaGroup.events[0].type, "sale");
assert.equal(gammaGroup.events[0].priorityMoment, "start", "販売イベントは開始を重要時刻にすべきです");
const deltaGroup = coverageGroups.find((item) => item.members.some((member) => member.productKey === "delta"));
assert.equal(deltaGroup.events[0].type, "lottery");
assert.equal(deltaGroup.events[0].priorityMoment, "end", "抽選イベントは終了を重要時刻にすべきです");

const overlappingSnapshot = {
  normalizedProducts: coverageSnapshot.normalizedProducts.slice(0, 3),
  llmExtractions: [
    {
      ...coverageSnapshot.llmExtractions[0],
      docId: "doc:overlap-1",
      products: [{ name: "記念コレクション Alpha" }, { name: "記念コレクション Beta" }],
    },
    {
      ...coverageSnapshot.llmExtractions[0],
      docId: "doc:overlap-2",
      sourceKey: "social:https://example.com/beta",
      products: [{ name: "記念コレクション Beta" }, { name: "限定フィギュア Gamma" }],
      events: [{ productName: "限定フィギュア Gamma", eventType: "sale_open", startDate: "2026-06-25", endDate: null, routeType: "sale" }],
    },
  ],
  routeSnapshots: [],
  selectionReasons: [],
};
const overlappingGroups = await buildProductGroupsFromSnapshot(overlappingSnapshot);
const overlappingMembership = overlappingGroups.flatMap((item) => item.members.map((member) => member.productKey));
assert.equal(new Set(overlappingMembership).size, overlappingMembership.length, "境界衝突時も product membership は一意であるべきです");
assert.equal(overlappingGroups.length, 1, "重複 membership の異なる AI 群は1つの HOLD 群へ安全統合すべきです");
assert.equal(overlappingGroups[0].requiresHumanReview, true);
assert.ok(overlappingGroups[0].criticDisagreements.some((item) => item.code === "membership_conflict"));
assert.deepEqual(
  [...new Set(overlappingGroups[0].events.map((event) => event.type))].sort(),
  ["lottery", "sale"],
  "複数 Gemini 出力の event を統合時に失ってはいけません",
);

const geminiJudgmentSnapshot = {
  normalizedProducts: coverageSnapshot.normalizedProducts.slice(0, 2),
  llmExtractions: [
    {
      ...coverageSnapshot.llmExtractions[0],
      docId: "doc:gemini-judgments",
      products: [{ name: "記念コレクション Alpha" }, { name: "記念コレクション Beta" }],
      events: [
        { productName: "記念コレクション Alpha", eventType: "lottery_close", startDate: "2026-06-20", endDate: "2026-06-24", routeType: "lottery" },
        { productName: "記念コレクション Beta", eventType: "sale_open", startDate: "2026-06-28", endDate: null, routeType: "sale" },
      ],
      groupJudgments: [
        {
          canonicalName: "記念コレクション Alpha",
          memberProductNames: ["記念コレクション Alpha"],
          identityConfidence: 0.94,
          tier: "T2",
          tierConfidence: 0.83,
          reasonHeadline: "周年記念の抽選終了を確認",
          whyNow: "公式抽選の終了が近いため今確認する",
          uncertaintyLevel: "medium",
          uncertaintyIssues: ["x_heat_unconfirmed"],
          counterEvidenceNotes: ["X反応はまだ少ない"],
          attentionLevel: "high",
          attentionRationale: "Xの引用と返信が増えている",
          requiresHumanReview: false,
        },
        {
          canonicalName: "記念コレクション Beta",
          memberProductNames: ["記念コレクション Beta"],
          identityConfidence: 0.91,
          tier: "T3",
          tierConfidence: 0.74,
          reasonHeadline: "販売開始を確認",
          whyNow: "公式販売開始前に出口確認を行う",
          uncertaintyLevel: "medium",
          uncertaintyIssues: ["price_unconfirmed"],
          counterEvidenceNotes: [],
          attentionLevel: "low",
          attentionRationale: "X反応は未確認",
          requiresHumanReview: false,
        },
      ],
    },
  ],
  routeSnapshots: [],
  selectionReasons: [],
};
const geminiJudgmentGroups = await buildProductGroupsFromSnapshot(geminiJudgmentSnapshot);
assert.equal(geminiJudgmentGroups.length, 2, "1つの Gemini extraction から複数の商品群判断を生成できるべきです");
const alphaJudgmentGroup = geminiJudgmentGroups.find((item) => item.members[0].productKey === "alpha");
assert.equal(alphaJudgmentGroup.judgment.decisionOrigin, "gemini");
assert.equal(alphaJudgmentGroup.judgment.tier.value, "T2", "Tier は Gemini judgment を採用すべきです");
assert.equal(alphaJudgmentGroup.judgment.reason.whyNow, "公式抽選の終了が近いため今確認する");
assert.ok(alphaJudgmentGroup.judgment.uncertainty.issues.includes("x_heat_unconfirmed"));
assert.deepEqual(alphaJudgmentGroup.judgment.counterEvidenceNotes, ["X反応はまだ少ない"]);
assert.deepEqual(alphaJudgmentGroup.judgment.attention, { level: "high", rationale: "Xの引用と返信が増えている" });
assert.equal(alphaJudgmentGroup.requiresHumanReview, false);

console.log("product-group-contract-regression: PASS");
