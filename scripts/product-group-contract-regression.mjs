import assert from "node:assert/strict";
import {
  AI_JUDGMENT_CONTRACT_VERSION,
  PRODUCT_GROUP_SCHEMA_VERSION,
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

console.log("product-group-contract-regression: PASS");
