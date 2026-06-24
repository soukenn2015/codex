import { createHash } from "node:crypto";

export const PRODUCT_GROUP_SCHEMA_VERSION = "marketlens.product-group.v1";
export const AI_JUDGMENT_CONTRACT_VERSION = "marketlens.ai-judgment.v1";

export const EVENT_TYPES = Object.freeze(["lottery", "sale", "restock", "resale", "preorder", "unknown"]);
export const TIER_VALUES = Object.freeze(["T1", "T2", "T3", "HOLD"]);
export const UNCERTAINTY_LEVELS = Object.freeze(["low", "medium", "high"]);
export const ATTENTION_LEVELS = Object.freeze(["high", "medium", "low", "unknown"]);
export const SOURCE_KINDS = Object.freeze(["official", "social", "article", "unverified"]);

const SOURCE_TRUST = Object.freeze({ official: 3, social: 2, article: 1, unverified: 0 });
const REAL_AI_MODES = new Set(["gemini"]);
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

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value) {
  return compactText(String(value ?? "").normalize("NFKC"))
    .toLowerCase()
    .replace(/[|/・,，:：()\[\]{}【】「」"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableTokens(value) {
  return normalizeComparableText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function nameOverlapScore(left, right) {
  const leftTokens = comparableTokens(left);
  const rightTokens = comparableTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token));
  return shared.length / Math.max(leftTokens.length, rightTokens.length);
}

function sourceKindFromExtraction(extraction = {}) {
  const sourceKey = String(extraction.sourceKey ?? "").toLowerCase();
  if (/^official:|^lottery:|^deal:/.test(sourceKey)) return "official";
  if (/^sns:|^social:|^x:/.test(sourceKey)) return "social";
  return "article";
}

function sourceKindFromProduct(product = {}) {
  const kinds = Array.isArray(product.sourceKinds) ? product.sourceKinds.map((item) => String(item).toLowerCase()) : [];
  if (kinds.some((item) => item === "official" || item.startsWith("official:") || item === "deal" || item === "lottery")) return "official";
  if (kinds.some((item) => item === "social" || item === "sns" || item === "x" || item.startsWith("social:") || item.startsWith("x:"))) return "social";
  if (kinds.some((item) => item === "article" || item === "blog" || item === "news" || item.startsWith("article:") || item.startsWith("blog:"))) return "article";
  return "unverified";
}

function groupEventTypeFromExtraction(event = {}) {
  const eventType = String(event.eventType ?? "").toLowerCase();
  const routeType = String(event.routeType ?? "").toLowerCase();
  if (eventType.includes("lottery") || routeType === "lottery") return "lottery";
  if (eventType === "resale_open" || routeType === "resale") return "resale";
  if (eventType === "restock_signal") return "restock";
  if (eventType.includes("preorder") || routeType === "preorder") return "preorder";
  if (eventType === "sale_open" || eventType === "sale_close" || eventType === "release" || routeType === "sale" || routeType === "invite") {
    return "sale";
  }
  if (eventType === "trend_signal") return "unknown";
  return "unknown";
}

function matchProductByName(name, products = [], indexedProducts = new Map()) {
  const normalizedName = normalizeComparableText(name);
  if (!normalizedName) return null;
  if (indexedProducts.has(normalizedName)) return indexedProducts.get(normalizedName);

  let best = null;
  let bestScore = 0;
  for (const product of products) {
    const score = Math.max(
      nameOverlapScore(name, product.canonicalName),
      ...(Array.isArray(product.aliases) ? product.aliases.map((alias) => nameOverlapScore(name, alias)) : [0]),
    );
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  return bestScore >= 0.72 ? best : null;
}

function buildProductIndex(products = []) {
  const index = new Map();
  for (const product of products) {
    for (const name of [product.canonicalName, ...(product.aliases ?? [])]) {
      const normalized = normalizeComparableText(name);
      if (normalized && !index.has(normalized)) index.set(normalized, product);
    }
  }
  return index;
}

function pickPrimaryMember(members = [], extraction = {}) {
  const eventNames = new Set((extraction.events ?? []).map((event) => normalizeComparableText(event.productName)));
  const directEventMatch = members.find((member) => eventNames.has(normalizeComparableText(member.name)));
  if (directEventMatch) return directEventMatch;
  return [...members].sort((left, right) => right.identityConfidence - left.identityConfidence || right.name.length - left.name.length)[0] ?? null;
}

function sourceModeFromGroup(group = {}) {
  return String(group.sourceMode ?? "");
}

function uniqueBy(items = [], getKey) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildAiContributor({ extraction, parallel, matchedMembers, strongMembers }) {
  return {
    docId: extraction?.docId ?? null,
    sourceKey: extraction?.sourceKey ?? null,
    mode: extraction?.mode ?? null,
    model: extraction?.model ?? null,
    confidence: Number(extraction?.confidence ?? 0),
    criticStatus: parallel?.critique?.status ?? null,
    criticDisagreements: (parallel?.critique?.disagreements ?? []).map((item) => item.code).filter(Boolean),
    requiresHumanReview: Boolean(parallel?.requiresHumanReview),
    matchedMemberProductKeys: uniqueBy(matchedMembers ?? [], (member) => member.productKey).map((member) => member.productKey),
    strongMemberProductKeys: uniqueBy(strongMembers ?? [], (member) => member.productKey).map((member) => member.productKey),
  };
}

function mergeAiProvenance(left = {}, right = {}) {
  const contributors = uniqueBy([...(left.contributors ?? []), ...(right.contributors ?? [])], (item) =>
    JSON.stringify([item.docId ?? "", item.sourceKey ?? "", item.mode ?? "", item.model ?? ""]),
  );
  return {
    sourceModes: uniqueBy([...(left.sourceModes ?? []), ...(right.sourceModes ?? [])], (item) => item).filter(Boolean),
    models: uniqueBy([...(left.models ?? []), ...(right.models ?? [])], (item) => item).filter(Boolean),
    contributors,
  };
}

function mergeReviewContext(left = {}, right = {}, extraReasons = []) {
  return {
    allMatchedMemberProductKeys: uniqueBy(
      [...(left.allMatchedMemberProductKeys ?? []), ...(right.allMatchedMemberProductKeys ?? [])],
      (item) => item,
    ),
    strongMemberProductKeys: uniqueBy(
      [...(left.strongMemberProductKeys ?? []), ...(right.strongMemberProductKeys ?? [])],
      (item) => item,
    ),
    droppedMemberProductKeys: uniqueBy(
      [...(left.droppedMemberProductKeys ?? []), ...(right.droppedMemberProductKeys ?? [])],
      (item) => item,
    ),
    holdReasons: uniqueBy([...(left.holdReasons ?? []), ...(right.holdReasons ?? []), ...extraReasons], (item) => item),
  };
}

function mergeGroupPayload(left, right, { membershipConflict = false } = {}) {
  const members = uniqueBy([...(left.members ?? []), ...(right.members ?? [])], (item) => item.productKey);
  const evidence = sortEvidenceByTrust(uniqueBy([...(left.evidence ?? []), ...(right.evidence ?? [])], (item) => item.ref));
  const events = uniqueBy([...(left.events ?? []), ...(right.events ?? [])], (item) => item.eventKey);
  const disagreementCodes = uniqueBy(
    [
      ...(left.criticDisagreements ?? []).map((item) => item.code).filter(Boolean),
      ...(right.criticDisagreements ?? []).map((item) => item.code).filter(Boolean),
      ...(membershipConflict ? ["membership_conflict"] : []),
    ],
    (item) => item,
  );
  const tierConflict = left.judgment?.tier?.value !== right.judgment?.tier?.value;
  if (tierConflict) disagreementCodes.push("tier_disagreement");
  const requiresHumanReview = Boolean(left.requiresHumanReview || right.requiresHumanReview || membershipConflict || tierConflict);
  const preferred = (SOURCE_TRUST[left.evidence?.[0]?.kind] ?? 0) >= (SOURCE_TRUST[right.evidence?.[0]?.kind] ?? 0) ? left : right;
  const evidenceRefs = evidence.map((item) => item.ref);
  const baseJudgment = structuredClone(preferred.judgment);
  const judgment = {
    ...baseJudgment,
    identity: {
      ...baseJudgment.identity,
      evidenceRefs: uniqueBy([...(baseJudgment.identity?.evidenceRefs ?? []), ...evidenceRefs], (item) => item),
    },
    grouping: { memberProductKeys: members.map((item) => item.productKey) },
    events: structuredClone(events),
    tier: requiresHumanReview
      ? {
          value: "HOLD",
          confidence: Math.min(Number(baseJudgment.tier?.confidence ?? 0.5), 0.5),
          rationale: membershipConflict ? "Gemini 判定間で membership が競合したため保留" : "複数判定の未解決事項があるため保留",
        }
      : baseJudgment.tier,
    reason: {
      ...baseJudgment.reason,
      evidenceRefs: uniqueBy([...(baseJudgment.reason?.evidenceRefs ?? []), ...evidenceRefs], (item) => item),
    },
    uncertainty: {
      level: requiresHumanReview ? "high" : baseJudgment.uncertainty?.level ?? "medium",
      issues: uniqueBy(
        [
          ...(left.judgment?.uncertainty?.issues ?? []),
          ...(right.judgment?.uncertainty?.issues ?? []),
          ...disagreementCodes,
          ...(requiresHumanReview ? ["critic_review_required"] : []),
        ],
        (item) => item,
      ),
      counterEvidenceRefs: uniqueBy(
        [...(left.judgment?.uncertainty?.counterEvidenceRefs ?? []), ...(right.judgment?.uncertainty?.counterEvidenceRefs ?? [])],
        (item) => item,
      ),
    },
  };
  const base = createProductGroup({
    canonicalName: preferred.canonicalName,
    identity: {
      confidence: Math.min(Number(left.identity?.confidence ?? 0.5), Number(right.identity?.confidence ?? 0.5)),
      status: requiresHumanReview ? "review" : preferred.identity?.status ?? "identified",
    },
    members,
    events,
    judgment,
    evidence,
  });
  return {
    ...base,
    sourceMode: preferred.sourceMode || left.sourceMode || right.sourceMode,
    docId: preferred.docId ?? left.docId ?? right.docId,
    sourceKey: preferred.sourceKey ?? left.sourceKey ?? right.sourceKey,
    requiresHumanReview,
    criticStatus: requiresHumanReview ? "review" : preferred.criticStatus ?? "accept",
    criticDisagreements: uniqueBy(
      [
        ...(left.criticDisagreements ?? []),
        ...(right.criticDisagreements ?? []),
        ...(membershipConflict ? [{ code: "membership_conflict", severity: "critical" }] : []),
        ...(tierConflict ? [{ code: "tier_disagreement", severity: "critical" }] : []),
      ],
      (item) => JSON.stringify([item.code ?? "", item.severity ?? ""]),
    ),
    aiProvenance: mergeAiProvenance(left.aiProvenance, right.aiProvenance),
    reviewContext: mergeReviewContext(left.reviewContext, right.reviewContext, disagreementCodes),
  };
}

function mergeGroups(left, right) {
  return mergeGroupPayload(left, right);
}

function buildPendingGroup({ product, productEvents = [], routesByProduct, reasonsByProduct }) {
  const sourceKind = sourceKindFromProduct(product);
  const productRef = `product:${product.productKey}`;
  const routeRefs = (routesByProduct.get(product.productKey) ?? [])
    .filter((route) => route?.id)
    .map((route) => ({
      ref: `route:${route.id}`,
      kind: /deal|official|lottery|pokemon_release/.test(String(route.source ?? "")) ? "official" : sourceKind,
    }));
  const evidence = sortEvidenceByTrust(uniqueBy([{ ref: productRef, kind: sourceKind }, ...routeRefs], (item) => item.ref));
  const evidenceRefs = evidence.map((item) => item.ref);
  const events = productEvents
    .filter((event) => event?.productKey === product.productKey)
    .map((event, index) => {
      const type = groupEventTypeFromExtraction(event);
      return {
        eventKey: event.id || stableId("pending_event", [product.productKey, event.eventType ?? "", String(index)]),
        type,
        priorityMoment: priorityMomentForEventType(type),
        startsAt: event.startDate || null,
        endsAt: event.endDate || null,
        evidenceRefs: [productRef],
        memberProductKeys: [product.productKey],
        title: compactText(event.productName || product.canonicalName),
      };
    });
  const reason = reasonsByProduct.get(product.productKey);
  const issues = ["ai_judgment_missing", "identity_needs_review", "price_unconfirmed"];
  if (events.length === 0 || events.some((event) => event.type === "unknown")) issues.push("event_unconfirmed");
  const identityConfidence = Math.max(
    0.2,
    Math.min(0.7, Number(product.aiThesis?.confidence ?? (sourceKind === "official" ? 0.65 : sourceKind === "social" ? 0.45 : 0.35))),
  );
  const judgment = {
    contractVersion: AI_JUDGMENT_CONTRACT_VERSION,
    decisionOrigin: "deterministic_pending",
    identity: { canonicalName: product.canonicalName, confidence: identityConfidence, evidenceRefs },
    grouping: { memberProductKeys: [product.productKey] },
    events,
    tier: { value: "HOLD", confidence: 0.2, rationale: "Gemini による商品群判断が未完了" },
    reason: {
      headline: "AI判断待ち",
      whyNow: compactText(reason?.shortNow || reason?.shortWhy || "商品同定・イベント・根拠を確認してから判断します。"),
      evidenceRefs,
    },
    uncertainty: { level: "high", issues: uniqueBy(issues, (item) => item), counterEvidenceRefs: [] },
    attention: { level: "unknown", rationale: "X反応をGeminiが未判定" },
  };
  const group = createProductGroup({
    canonicalName: product.canonicalName,
    identity: { confidence: identityConfidence, status: "review" },
    members: [{ productKey: product.productKey, name: product.canonicalName }],
    events,
    judgment,
    evidence,
  });
  return {
    ...group,
    sourceMode: "deterministic_pending",
    docId: null,
    sourceKey: null,
    requiresHumanReview: true,
    criticStatus: "review",
    criticDisagreements: [{ code: "ai_judgment_missing", severity: "critical" }],
    aiProvenance: { sourceModes: [], models: [], contributors: [] },
    reviewContext: {
      allMatchedMemberProductKeys: [product.productKey],
      strongMemberProductKeys: [],
      droppedMemberProductKeys: [],
      holdReasons: uniqueBy(issues, (item) => item),
    },
  };
}

function consolidateMembershipConflicts(groups = []) {
  const consolidated = [];
  for (const group of groups) {
    let current = group;
    let merged = true;
    while (merged) {
      merged = false;
      const currentKeys = new Set(current.members.map((member) => member.productKey));
      const conflictIndex = consolidated.findIndex((candidate) => candidate.members.some((member) => currentKeys.has(member.productKey)));
      if (conflictIndex !== -1) {
        current = mergeGroupPayload(consolidated.splice(conflictIndex, 1)[0], current, { membershipConflict: true });
        merged = true;
      }
    }
    consolidated.push(current);
  }
  return consolidated;
}

function buildEvidenceRows({ extraction, sourceKind, members, routesByProduct, reasonsByProduct }) {
  const evidence = [
    {
      ref: `doc:${extraction.docId}`,
      kind: sourceKind,
    },
  ];
  for (const member of members) {
    const route = routesByProduct.get(member.productKey)?.[0];
    if (route?.id) {
      evidence.push({
        ref: `route:${route.id}`,
        kind: /deal|official|lottery|pokemon_release/.test(String(route.source ?? "")) ? "official" : sourceKind,
      });
    }
    const reason = reasonsByProduct.get(member.productKey);
    if (reason?.productKey) {
      evidence.push({
        ref: `reason:${reason.productKey}`,
        kind: sourceKind,
      });
    }
  }
  return sortEvidenceByTrust(
    Array.from(new Map(evidence.map((item) => [item.ref, item])).values()).filter((item) => SOURCE_KINDS.includes(item.kind)),
  );
}

function judgmentRequiresHumanReview(judgment = {}) {
  const issues = new Set(Array.isArray(judgment?.uncertainty?.issues) ? judgment.uncertainty.issues : []);
  if (issues.has("ai_judgment_missing")) return true;
  if (issues.has("ai_requires_human_review")) return true;
  if (issues.has("identity_needs_review")) return true;
  if (issues.has("group_boundary_needs_review")) return true;
  if (issues.has("event_unconfirmed")) return true;
  if (issues.has("critic_review_required")) return true;
  return (Array.isArray(judgment?.events) ? judgment.events : []).some((event) => event?.type === "unknown");
}

function buildJudgmentDraft({ extraction, groupJudgment = null, members, primaryMember, evidence, routesByProduct, reasonsByProduct, strict }) {
  if (!primaryMember || members.length === 0) return null;
  const docRef = `doc:${extraction.docId}`;
  const routeRefs = members.flatMap((member) => (routesByProduct.get(member.productKey) ?? []).slice(0, 1).map((route) => `route:${route.id}`));
  const reasonRefs = members
    .map((member) => reasonsByProduct.get(member.productKey))
    .filter(Boolean)
    .map((reason) => `reason:${reason.productKey}`);
  const evidenceRefs = [...new Set([docRef, ...routeRefs, ...reasonRefs].filter((ref) => evidence.some((item) => item.ref === ref)))];
  const extractionEvents = Array.isArray(extraction.events) ? extraction.events : [];
  const explicitGroupingAccepted = Boolean(
    groupJudgment && groupJudgment.requiresHumanReview !== true && Number(groupJudgment.identityConfidence ?? 0) >= 0.8,
  );
  const filteredMembers = strict && !explicitGroupingAccepted
    ? members.filter((member) => member.productKey === primaryMember.productKey || nameOverlapScore(member.name, primaryMember.name) >= 0.55)
    : members;
  const filteredMemberKeys = filteredMembers.map((member) => member.productKey);
  const events = extractionEvents
    .map((event, index) => {
      const type = groupEventTypeFromExtraction(event);
      const eventProduct = matchProductByName(event.productName, filteredMembers, buildProductIndex(filteredMembers));
      if (strict && eventProduct && !filteredMemberKeys.includes(eventProduct.productKey)) return null;
      const refSet = [...new Set([docRef, ...routeRefs].filter((ref) => evidence.some((item) => item.ref === ref)))];
      return {
        eventKey: stableId("group_event", [extraction.docId ?? "", primaryMember.productKey, event.eventType ?? "", event.productName ?? "", String(index)]),
        type,
        priorityMoment: priorityMomentForEventType(type),
        startsAt: event.startDate || null,
        endsAt: event.endDate || null,
        evidenceRefs: refSet.length > 0 ? refSet : [docRef],
        memberProductKeys: eventProduct ? [eventProduct.productKey] : [...filteredMemberKeys],
        title: compactText(event.productName || primaryMember.name),
      };
    })
    .filter(Boolean);
  const reason = reasonsByProduct.get(primaryMember.productKey) ?? null;
  const issues = Array.isArray(groupJudgment?.uncertaintyIssues)
    ? groupJudgment.uncertaintyIssues.map((item) => compactText(item)).filter(Boolean)
    : [];
  if (!groupJudgment) issues.push("ai_judgment_missing");
  if (groupJudgment?.requiresHumanReview === true) issues.push("ai_requires_human_review");
  if (groupJudgment && Number(groupJudgment.identityConfidence ?? 0) < 0.7) issues.push("identity_needs_review");
  if (events.length === 0) issues.push("event_unconfirmed");
  if (routeRefs.length === 0) issues.push("route_unconfirmed");
  if (!Array.isArray(extraction.prices) || extraction.prices.length === 0) issues.push("price_unconfirmed");
  if ((Number(extraction.confidence ?? 0)) < 0.75) issues.push("llm_confidence_not_high");
  if (filteredMembers.length > 1 && strict && !explicitGroupingAccepted) issues.push("group_boundary_needs_review");

  const sourceKind = sourceKindFromExtraction(extraction);
  const baseTier = events.some((event) => event.type === "lottery" || event.type === "sale") && sourceKind === "official" ? "T1" : "T2";
  const tierValue = TIER_VALUES.includes(groupJudgment?.tier) ? groupJudgment.tier : issues.length >= 3 ? "T3" : baseTier;
  const inferredUncertaintyLevel = issues.length === 0 ? "low" : issues.length >= 3 ? "high" : "medium";
  const uncertaintyRank = { low: 0, medium: 1, high: 2 };
  const requestedUncertaintyLevel = UNCERTAINTY_LEVELS.includes(groupJudgment?.uncertaintyLevel)
    ? groupJudgment.uncertaintyLevel
    : inferredUncertaintyLevel;
  const uncertaintyLevel = uncertaintyRank[requestedUncertaintyLevel] >= uncertaintyRank[inferredUncertaintyLevel]
    ? requestedUncertaintyLevel
    : inferredUncertaintyLevel;

  return {
    contractVersion: AI_JUDGMENT_CONTRACT_VERSION,
    decisionOrigin: groupJudgment ? "gemini" : "legacy_extraction_pending",
    identity: {
      canonicalName: compactText(groupJudgment?.canonicalName || primaryMember.name),
      confidence: Math.max(0.2, Math.min(0.98, Number(groupJudgment?.identityConfidence ?? primaryMember.identityConfidence))),
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : [docRef],
    },
    grouping: {
      memberProductKeys: [...filteredMemberKeys],
    },
    events,
    tier: {
      value: tierValue,
      confidence: Math.max(0.2, Math.min(0.95, Number(groupJudgment?.tierConfidence ?? extraction.confidence ?? primaryMember.identityConfidence ?? 0.7))),
      rationale: groupJudgment
        ? "Gemini product-group judgment"
        : sourceKind === "official"
          ? "公式ソースを含む extraction。Gemini 商品群判断待ち"
          : "Gemini 商品群判断待ち",
    },
    reason: {
      headline: compactText(groupJudgment?.reasonHeadline || extraction.reasons?.whyTopic || reason?.shortWhy || `${primaryMember.name} の商品群判断`),
      whyNow: compactText(groupJudgment?.whyNow || extraction.reasons?.whyTiming || reason?.shortNow || extraction.reasons?.whyRoute || `${primaryMember.name} の動きが確認されたため`),
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : [docRef],
    },
    uncertainty: {
      level: uncertaintyLevel,
      issues: [...new Set(issues)],
      counterEvidenceRefs: [],
    },
    counterEvidenceNotes: Array.isArray(groupJudgment?.counterEvidenceNotes)
      ? groupJudgment.counterEvidenceNotes.map((item) => compactText(item)).filter(Boolean)
      : [],
    attention: {
      level: ATTENTION_LEVELS.includes(groupJudgment?.attentionLevel) ? groupJudgment.attentionLevel : "unknown",
      rationale: compactText(groupJudgment?.attentionRationale || "X反応は未確認"),
    },
  };
}

function buildCritique({ lightResult, strongResult }) {
  const disagreements = [];
  const lightCanonical = lightResult?.judgment?.identity?.canonicalName ?? "";
  const strongCanonical = strongResult?.judgment?.identity?.canonicalName ?? "";
  if (lightCanonical !== strongCanonical) {
    disagreements.push({ code: "identity_disagreement", severity: "critical" });
  }
  const lightMembers = JSON.stringify([...(lightResult?.judgment?.grouping?.memberProductKeys ?? [])].sort());
  const strongMembers = JSON.stringify([...(strongResult?.judgment?.grouping?.memberProductKeys ?? [])].sort());
  if (lightMembers !== strongMembers) {
    disagreements.push({ code: "grouping_disagreement", severity: "critical" });
  }
  const lightEvents = JSON.stringify((lightResult?.judgment?.events ?? []).map((event) => event.type).sort());
  const strongEvents = JSON.stringify((strongResult?.judgment?.events ?? []).map((event) => event.type).sort());
  if (lightEvents !== strongEvents) {
    disagreements.push({ code: "event_disagreement", severity: "major" });
  }
  if (judgmentRequiresHumanReview(strongResult?.judgment) || judgmentRequiresHumanReview(lightResult?.judgment)) {
    disagreements.push({ code: "boundary_review_required", severity: "critical" });
  }
  return {
    status: disagreements.length === 0 ? "accept" : "review",
    summary: disagreements.length === 0 ? "judgment aligned" : disagreements.map((item) => item.code).join(", "),
    disagreements,
    judgment: strongResult?.judgment ?? lightResult?.judgment ?? null,
  };
}

function buildExtractionGroupViews(extraction = {}) {
  const judgments = Array.isArray(extraction.groupJudgments) ? extraction.groupJudgments : [];
  if (judgments.length === 0) return [{ extraction, groupJudgment: null }];
  return judgments
    .map((groupJudgment) => {
      const memberNames = uniqueBy(
        [groupJudgment?.canonicalName, ...(Array.isArray(groupJudgment?.memberProductNames) ? groupJudgment.memberProductNames : [])]
          .map((item) => compactText(item))
          .filter(Boolean),
        (item) => normalizeComparableText(item),
      );
      if (memberNames.length === 0) return null;
      const memberNameKeys = new Set(memberNames.map((item) => normalizeComparableText(item)));
      const events = (Array.isArray(extraction.events) ? extraction.events : []).filter((event) => {
        const eventName = normalizeComparableText(event?.productName);
        return memberNameKeys.has(eventName) || memberNames.some((name) => nameOverlapScore(name, event?.productName) >= 0.72);
      });
      return {
        groupJudgment,
        extraction: {
          ...extraction,
          products: memberNames.map((name) => ({ name })),
          events,
        },
      };
    })
    .filter(Boolean);
}

export async function buildProductGroupsFromSnapshot(snapshot = {}) {
  const products = Array.isArray(snapshot.normalizedProducts) ? snapshot.normalizedProducts : [];
  const extractions = Array.isArray(snapshot.llmExtractions) ? snapshot.llmExtractions.filter((item) => REAL_AI_MODES.has(String(item?.mode ?? ""))) : [];
  const routesByProduct = new Map();
  const reasonsByProduct = new Map();
  const buildErrors = [];
  for (const route of snapshot.routeSnapshots ?? []) {
    const rows = routesByProduct.get(route.productKey) ?? [];
    rows.push(route);
    routesByProduct.set(route.productKey, rows);
  }
  for (const reason of snapshot.selectionReasons ?? []) {
    if (reason?.productKey && !reasonsByProduct.has(reason.productKey)) reasonsByProduct.set(reason.productKey, reason);
  }
  const productIndex = buildProductIndex(products);
  const groups = [];

  for (const sourceExtraction of extractions) {
    for (const view of buildExtractionGroupViews(sourceExtraction)) {
      const extraction = view.extraction;
      const groupJudgment = view.groupJudgment;
      try {
      const matchedMembers = [];
      const memberByKey = new Map();
      const names = [
        ...(Array.isArray(extraction.products) ? extraction.products.map((product) => product?.name) : []),
        ...(Array.isArray(extraction.events) ? extraction.events.map((event) => event?.productName) : []),
      ];
      for (const name of names) {
        const product = matchProductByName(name, products, productIndex);
        if (!product || memberByKey.has(product.productKey)) continue;
        const member = {
          productKey: product.productKey,
          name: product.canonicalName,
          identityConfidence: Math.max(Number(extraction.confidence ?? 0.7), Number(product.aiThesis?.confidence ?? 0.5)),
        };
        memberByKey.set(product.productKey, member);
        matchedMembers.push(member);
      }
      if (matchedMembers.length === 0) continue;
      const primaryMember = pickPrimaryMember(matchedMembers, extraction);
      const sourceKind = sourceKindFromExtraction(extraction);
      const evidence = buildEvidenceRows({ extraction, sourceKind, members: matchedMembers, routesByProduct, reasonsByProduct });
      const lightResult = {
        members: matchedMembers,
        judgment: buildJudgmentDraft({ extraction, groupJudgment, members: matchedMembers, primaryMember, evidence, routesByProduct, reasonsByProduct, strict: false }),
      };
      const strongMembers = matchedMembers.filter(
        (member) => member.productKey === primaryMember.productKey || nameOverlapScore(member.name, primaryMember.name) >= 0.55,
      );
      const strongResult = {
        members: strongMembers,
        judgment: buildJudgmentDraft({
          extraction,
          groupJudgment,
          members: strongMembers.length > 0 ? strongMembers : matchedMembers,
          primaryMember,
          evidence,
          routesByProduct,
          reasonsByProduct,
          strict: true,
        }),
      };
      if (!lightResult.judgment || !strongResult.judgment) continue;
      const critique = buildCritique({ lightResult, strongResult });
      const parallel = await runParallelAiJudgment({
        input: { extraction, groupJudgment, matchedMembers: matchedMembers.map((member) => member.productKey) },
        lightExtractor: async () => lightResult,
        strongIdentifier: async () => strongResult,
        critic: async () => critique,
      });
      const allMatchedMemberKeys = uniqueBy(matchedMembers, (member) => member.productKey).map((member) => member.productKey);
      const strongMemberKeys = uniqueBy(strongMembers, (member) => member.productKey).map((member) => member.productKey);
      const retainedMemberKeys = parallel.requiresHumanReview
        ? allMatchedMemberKeys
        : parallel.judgment.grouping.memberProductKeys;
      const memberPool = new Map([...matchedMembers, ...strongMembers].map((member) => [member.productKey, member]));
      const members = retainedMemberKeys
        .map((productKey) => memberPool.get(productKey))
        .filter(Boolean)
        .map((member) => ({ productKey: member.productKey, name: member.name }));
      if (members.length === 0) continue;
      const normalizedJudgment = structuredClone(parallel.judgment);
      normalizedJudgment.grouping.memberProductKeys = [...members.map((member) => member.productKey)];
      const group = createProductGroup({
        canonicalName: normalizedJudgment.identity.canonicalName,
        identity: {
          confidence: normalizedJudgment.identity.confidence,
          status: parallel.requiresHumanReview ? "review" : "identified",
        },
        members,
        events: normalizedJudgment.events,
        judgment: normalizedJudgment,
        evidence,
      });
      groups.push({
        ...group,
        sourceMode: extraction.mode,
        docId: extraction.docId,
        sourceKey: extraction.sourceKey,
        requiresHumanReview: parallel.requiresHumanReview,
        criticStatus: parallel.critique.status,
        criticDisagreements: parallel.critique.disagreements ?? [],
        aiProvenance: {
          sourceModes: uniqueBy([extraction.mode], (item) => item).filter(Boolean),
          models: uniqueBy([extraction.model], (item) => item).filter(Boolean),
          contributors: [buildAiContributor({ extraction, parallel, matchedMembers, strongMembers })],
        },
        reviewContext: {
          allMatchedMemberProductKeys: allMatchedMemberKeys,
          strongMemberProductKeys: strongMemberKeys,
          droppedMemberProductKeys: allMatchedMemberKeys.filter((productKey) => !strongMemberKeys.includes(productKey)),
          holdReasons: uniqueBy(
            [
              ...(parallel.critique.disagreements ?? []).map((item) => item.code).filter(Boolean),
              ...(normalizedJudgment.uncertainty?.issues ?? []),
            ],
            (item) => item,
          ),
        },
      });
      } catch (error) {
        buildErrors.push({
          docId: extraction?.docId ?? null,
          sourceKey: extraction?.sourceKey ?? null,
          mode: extraction?.mode ?? null,
          message: compactText(error instanceof Error ? error.message : String(error)).slice(0, 240),
        });
      }
    }
  }

  const sortedGroups = groups.sort(
    (left, right) => sourceModeFromGroup(right).localeCompare(sourceModeFromGroup(left)) || left.canonicalName.localeCompare(right.canonicalName, "ja"),
  );
  const dedupedGroups = [];
  for (const group of sortedGroups) {
    const existingIndex = dedupedGroups.findIndex((item) => item.groupId === group.groupId);
    if (existingIndex === -1) {
      dedupedGroups.push(group);
      continue;
    }
    dedupedGroups[existingIndex] = mergeGroups(dedupedGroups[existingIndex], group);
  }
  const consolidatedGroups = consolidateMembershipConflicts(dedupedGroups);
  const assignedProductKeys = new Set(consolidatedGroups.flatMap((group) => group.members.map((member) => member.productKey)));
  for (const product of products) {
    if (!product?.productKey || !product?.canonicalName || assignedProductKeys.has(product.productKey)) continue;
    try {
      consolidatedGroups.push(
        buildPendingGroup({
          product,
          productEvents: Array.isArray(snapshot.productEvents) ? snapshot.productEvents : [],
          routesByProduct,
          reasonsByProduct,
        }),
      );
      assignedProductKeys.add(product.productKey);
    } catch (error) {
      buildErrors.push({
        docId: null,
        sourceKey: product.productKey,
        mode: "deterministic_pending",
        message: compactText(error instanceof Error ? error.message : String(error)).slice(0, 240),
      });
    }
  }
  consolidatedGroups.sort((left, right) => {
    const leftPending = left.sourceMode === "deterministic_pending" ? 1 : 0;
    const rightPending = right.sourceMode === "deterministic_pending" ? 1 : 0;
    return leftPending - rightPending || left.canonicalName.localeCompare(right.canonicalName, "ja");
  });
  consolidatedGroups.buildErrors = buildErrors;
  return consolidatedGroups;
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
  if (judgment.attention !== undefined) {
    invariant(judgment.attention && typeof judgment.attention === "object", "judgment.attention must be an object");
    invariant(ATTENTION_LEVELS.includes(judgment.attention.level), `judgment.attention.level must be one of ${ATTENTION_LEVELS.join(", ")}`);
    nonEmptyString(judgment.attention.rationale, "judgment.attention.rationale");
  }

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
    invariant(SOURCE_KINDS.includes(item.kind), `evidence[${index}].kind must be official, social, article, or unverified`);
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
