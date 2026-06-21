import { createHash } from "node:crypto";

export const PRODUCT_GROUP_SCHEMA_VERSION = "marketlens.product-group.v1";
export const AI_JUDGMENT_CONTRACT_VERSION = "marketlens.ai-judgment.v1";

export const EVENT_TYPES = Object.freeze(["lottery", "sale", "restock", "resale", "preorder", "unknown"]);
export const TIER_VALUES = Object.freeze(["T1", "T2", "T3", "HOLD"]);
export const UNCERTAINTY_LEVELS = Object.freeze(["low", "medium", "high"]);
export const SOURCE_KINDS = Object.freeze(["official", "social", "article"]);

const SOURCE_TRUST = Object.freeze({ official: 3, social: 2, article: 1 });
const FORBIDDEN_AI_KEYS = new Set([
  "price",
  "prices",
  "priceSnapshots",
  "observed_market_price",
  "jpyCandidate",
  "browser_observed_candidate",
  "buyLine",
  "buyLineEligible",
  "profit",
  "estimatedProfit",
  "confirmedProfit",
  "promotion",
  "promotionGate",
]);
const FORBIDDEN_AI_KEY_PATTERN = /(price|profit|buyline|promotion|shipping|fee)/i;

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function nonEmptyString(value, path) {
  invariant(typeof value === "string" && value.trim().length > 0, `${path} must be a non-empty string`);
}

function confidence(value, path) {
  invariant(Number.isFinite(value) && value >= 0 && value <= 1, `${path} must be between 0 and 1`);
}

function uniqueStrings(values, path) {
  invariant(Array.isArray(values), `${path} must be an array`);
  values.forEach((value, index) => nonEmptyString(value, `${path}[${index}]`));
  invariant(new Set(values).size === values.length, `${path} must not contain duplicates`);
}

function assertIsoDateOrNull(value, path) {
  if (value === null) return;
  nonEmptyString(value, path);
  invariant(!Number.isNaN(Date.parse(value)), `${path} must be an ISO-compatible date or null`);
}

function collectForbiddenAiPaths(value, path = "judgment", findings = []) {
  if (!value || typeof value !== "object") return findings;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_AI_KEYS.has(key) || FORBIDDEN_AI_KEY_PATTERN.test(key)) findings.push(childPath);
    collectForbiddenAiPaths(child, childPath, findings);
  }
  return findings;
}

function stableId(prefix, parts) {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}

export function priorityMomentForEventType(type) {
  if (type === "lottery") return "end";
  if (["sale", "restock", "resale", "preorder"].includes(type)) return "start";
  return "unknown";
}

export function sortEvidenceByTrust(evidence) {
  invariant(Array.isArray(evidence), "evidence must be an array");
  return evidence
    .map((item, index) => ({ ...item, __index: index }))
    .sort((left, right) => (SOURCE_TRUST[right.kind] ?? 0) - (SOURCE_TRUST[left.kind] ?? 0) || left.__index - right.__index)
    .map(({ __index, ...item }) => item);
}

export function validateAiJudgment(judgment) {
  invariant(judgment && typeof judgment === "object" && !Array.isArray(judgment), "judgment must be an object");
  invariant(judgment.contractVersion === AI_JUDGMENT_CONTRACT_VERSION, "judgment.contractVersion is unsupported");

  const forbiddenPaths = collectForbiddenAiPaths(judgment);
  invariant(forbiddenPaths.length === 0, `AI judgment crossed deterministic price boundary: ${forbiddenPaths.join(", ")}`);

  invariant(judgment.identity && typeof judgment.identity === "object", "judgment.identity is required");
  nonEmptyString(judgment.identity.canonicalName, "judgment.identity.canonicalName");
  confidence(judgment.identity.confidence, "judgment.identity.confidence");
  uniqueStrings(judgment.identity.evidenceRefs, "judgment.identity.evidenceRefs");

  invariant(Array.isArray(judgment.grouping?.memberProductKeys) && judgment.grouping.memberProductKeys.length > 0, "judgment.grouping.memberProductKeys is required");
  uniqueStrings(judgment.grouping.memberProductKeys, "judgment.grouping.memberProductKeys");

  invariant(TIER_VALUES.includes(judgment.tier?.value), `judgment.tier.value must be one of ${TIER_VALUES.join(", ")}`);
  confidence(judgment.tier.confidence, "judgment.tier.confidence");
  nonEmptyString(judgment.tier.rationale, "judgment.tier.rationale");

  nonEmptyString(judgment.reason?.headline, "judgment.reason.headline");
  nonEmptyString(judgment.reason?.whyNow, "judgment.reason.whyNow");
  uniqueStrings(judgment.reason.evidenceRefs, "judgment.reason.evidenceRefs");

  invariant(UNCERTAINTY_LEVELS.includes(judgment.uncertainty?.level), `judgment.uncertainty.level must be one of ${UNCERTAINTY_LEVELS.join(", ")}`);
  invariant(Array.isArray(judgment.uncertainty.issues), "judgment.uncertainty.issues must be an array");
  invariant(Array.isArray(judgment.uncertainty.counterEvidenceRefs), "judgment.uncertainty.counterEvidenceRefs must be an array");
  if (judgment.uncertainty.level !== "low") {
    invariant(judgment.uncertainty.issues.length > 0, "non-low uncertainty requires at least one issue");
  }
  uniqueStrings(judgment.uncertainty.issues, "judgment.uncertainty.issues");
  uniqueStrings(judgment.uncertainty.counterEvidenceRefs, "judgment.uncertainty.counterEvidenceRefs");

  invariant(Array.isArray(judgment.events), "judgment.events must be an array");
  judgment.events.forEach((event, index) => {
    const path = `judgment.events[${index}]`;
    nonEmptyString(event.eventKey, `${path}.eventKey`);
    invariant(EVENT_TYPES.includes(event.type), `${path}.type must be a supported event type`);
    invariant(event.priorityMoment === priorityMomentForEventType(event.type), `${path}.priorityMoment does not match event type`);
    assertIsoDateOrNull(event.startsAt, `${path}.startsAt`);
    assertIsoDateOrNull(event.endsAt, `${path}.endsAt`);
    uniqueStrings(event.evidenceRefs, `${path}.evidenceRefs`);
  });

  return judgment;
}

export function createProductGroup({ canonicalName, identity, members, events, judgment, evidence }) {
  nonEmptyString(canonicalName, "canonicalName");
  invariant(identity && typeof identity === "object", "identity is required");
  confidence(identity.confidence, "identity.confidence");
  invariant(Array.isArray(members) && members.length > 0, "members must contain at least one product");
  members.forEach((member, index) => {
    nonEmptyString(member.productKey, `members[${index}].productKey`);
    nonEmptyString(member.name, `members[${index}].name`);
  });
  invariant(new Set(members.map((member) => member.productKey)).size === members.length, "members must have unique productKey values");
  invariant(Array.isArray(events), "events must be an array");
  invariant(Array.isArray(evidence), "evidence must be an array");
  evidence.forEach((item, index) => {
    nonEmptyString(item.ref, `evidence[${index}].ref`);
    invariant(SOURCE_KINDS.includes(item.kind), `evidence[${index}].kind must be official, social, or article`);
  });
  validateAiJudgment(judgment);

  const evidenceRefs = new Set(evidence.map((item) => item.ref));
  const judgmentEvidenceRefs = [
    ...judgment.identity.evidenceRefs,
    ...judgment.reason.evidenceRefs,
    ...judgment.uncertainty.counterEvidenceRefs,
    ...judgment.events.flatMap((event) => event.evidenceRefs),
  ];
  invariant(
    judgmentEvidenceRefs.every((ref) => evidenceRefs.has(ref)),
    "judgment evidenceRefs must resolve to product-group evidence",
  );

  const memberKeys = members.map((member) => member.productKey).sort();
  invariant(
    JSON.stringify([...judgment.grouping.memberProductKeys].sort()) === JSON.stringify(memberKeys),
    "judgment.grouping.memberProductKeys must exactly match product-group members",
  );
  const groupId = stableId("group", [canonicalName, ...memberKeys]);
  const memberKeySet = new Set(memberKeys);
  const normalizedEvents = events.map((event, index) => {
    invariant(EVENT_TYPES.includes(event.type), `events[${index}].type must be a supported event type`);
    const eventMemberProductKeys = event.memberProductKeys ?? memberKeys;
    uniqueStrings(eventMemberProductKeys, `events[${index}].memberProductKeys`);
    invariant(eventMemberProductKeys.length > 0, `events[${index}].memberProductKeys must not be empty`);
    invariant(
      eventMemberProductKeys.every((productKey) => memberKeySet.has(productKey)),
      `events[${index}].memberProductKeys must belong to the product group`,
    );
    assertIsoDateOrNull(event.startsAt ?? null, `events[${index}].startsAt`);
    assertIsoDateOrNull(event.endsAt ?? null, `events[${index}].endsAt`);
    uniqueStrings(event.evidenceRefs ?? [], `events[${index}].evidenceRefs`);
    invariant((event.evidenceRefs ?? []).every((ref) => evidenceRefs.has(ref)), `events[${index}].evidenceRefs must resolve to product-group evidence`);
    const eventKey = event.eventKey || stableId("event", [groupId, event.type, event.title ?? "", event.startsAt ?? "", event.endsAt ?? ""]);
    return {
      ...event,
      eventKey,
      memberProductKeys: [...eventMemberProductKeys],
      priorityMoment: priorityMomentForEventType(event.type),
    };
  });
  invariant(
    JSON.stringify(normalizedEvents.map((event) => event.eventKey).sort()) ===
      JSON.stringify(judgment.events.map((event) => event.eventKey).sort()),
    "judgment.events must exactly match product-group events",
  );

  return {
    schemaVersion: PRODUCT_GROUP_SCHEMA_VERSION,
    groupId,
    canonicalName,
    identity: { ...identity },
    members: members.map((member) => ({ ...member })),
    events: normalizedEvents,
    judgment: structuredClone(judgment),
    evidence: sortEvidenceByTrust(evidence),
    deterministicPriceRef: {
      joinBy: "productKey",
      note: "Price snapshots, promotion, profit, and BuyLine remain outside the AI-owned product-group contract.",
    },
  };
}

export async function runParallelAiJudgment({ input, lightExtractor, strongIdentifier, critic }) {
  invariant(typeof lightExtractor === "function", "lightExtractor must be a function");
  invariant(typeof strongIdentifier === "function", "strongIdentifier must be a function");
  invariant(typeof critic === "function", "critic must be a function");

  const [lightResult, strongResult] = await Promise.all([lightExtractor(input), strongIdentifier(input)]);
  const critique = await critic({ input, lightResult, strongResult });
  invariant(critique && typeof critique === "object", "critic must return an object");
  invariant(["accept", "review", "reject"].includes(critique.status), "critic.status must be accept, review, or reject");

  const proposedJudgment = critique.judgment ?? strongResult?.judgment ?? lightResult?.judgment;
  validateAiJudgment(proposedJudgment);

  const criticalDisagreement = critique.status !== "accept" || critique.disagreements?.some((item) => item.severity === "critical");
  const disagreementCodes = (critique.disagreements ?? []).map((item) => item.code).filter(Boolean);
  const judgment = criticalDisagreement
    ? {
        ...structuredClone(proposedJudgment),
        tier: {
          value: "HOLD",
          confidence: Math.min(proposedJudgment.tier.confidence, 0.5),
          rationale: `critic hold: ${critique.summary || "unresolved disagreement"}`,
        },
        uncertainty: {
          level: "high",
          issues: [...new Set([...(proposedJudgment.uncertainty.issues ?? []), ...disagreementCodes, "critic_review_required"])],
          counterEvidenceRefs: proposedJudgment.uncertainty.counterEvidenceRefs ?? [],
        },
      }
    : structuredClone(proposedJudgment);

  validateAiJudgment(judgment);
  return { lightResult, strongResult, critique, judgment, requiresHumanReview: criticalDisagreement };
}
