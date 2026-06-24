export function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeProductKey(value = "") {
  return compactText(value)
    .toLowerCase()
    .replace(/[「」『』【】（）()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function candidateJpyPrice(candidate = {}) {
  const value = Number(candidate.value ?? candidate.price ?? candidate.soldPriceJpy ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const currency = String(candidate.currency ?? "JPY").toUpperCase();
  if (currency !== "JPY") return null;
  return value;
}

export function computeBuzzHeatScore(sample = {}) {
  const like = Number(sample.likeCount ?? sample.likes ?? 0) || 0;
  const repost = Number(sample.repostCount ?? sample.reposts ?? 0) || 0;
  const reply = Number(sample.replyCount ?? sample.replies ?? 0) || 0;
  const quote = Number(sample.quoteCount ?? sample.quotes ?? 0) || 0;
  return like + repost * 2.5 + reply * 1.5 + quote * 2;
}

export function parseEngagementFromTweetContext(lines = [], startIndex = 0) {
  const engagement = { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 };
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 8); i += 1) {
    const line = compactText(lines[i]);
    const likeMatch = line.match(/(?:いいね|Like)[^\d]*([\d,]+)/i) ?? line.match(/([\d,]+)\s*(?:いいね|likes?)/i);
    const repostMatch = line.match(/(?:リポスト|Repost|RT)[^\d]*([\d,]+)/i);
    const replyMatch = line.match(/(?:返信|Reply)[^\d]*([\d,]+)/i);
    const quoteMatch = line.match(/(?:引用|Quote)[^\d]*([\d,]+)/i);
    if (likeMatch) engagement.likeCount = Math.max(engagement.likeCount, Number(likeMatch[1].replace(/,/g, "")) || 0);
    if (repostMatch) engagement.repostCount = Math.max(engagement.repostCount, Number(repostMatch[1].replace(/,/g, "")) || 0);
    if (replyMatch) engagement.replyCount = Math.max(engagement.replyCount, Number(replyMatch[1].replace(/,/g, "")) || 0);
    if (quoteMatch) engagement.quoteCount = Math.max(engagement.quoteCount, Number(quoteMatch[1].replace(/,/g, "")) || 0);
  }
  return engagement;
}

export function groupLookupKeys(group = {}) {
  const keys = new Set();
  if (group.groupKey) keys.add(normalizeProductKey(group.groupKey));
  if (group.productKey) keys.add(normalizeProductKey(group.productKey));
  if (group.canonicalName) keys.add(normalizeProductKey(group.canonicalName));
  for (const member of group.members ?? []) {
    if (member?.productKey) keys.add(normalizeProductKey(member.productKey));
    if (member?.canonicalName) keys.add(normalizeProductKey(member.canonicalName));
  }
  return [...keys].filter(Boolean);
}

export function mergePreservedGeminiJudgments(productGroups = [], existingGroups = []) {
  const preservedByKey = new Map();
  for (const group of existingGroups) {
    if (group?.judgment?.decisionOrigin !== "gemini") continue;
    if (!group.judgment?.rejudgedAt && !group.judgment?.reason?.detail) continue;
    for (const key of groupLookupKeys(group)) {
      preservedByKey.set(key, group.judgment);
    }
  }
  return productGroups.map((group) => {
    let preserved = null;
    for (const key of groupLookupKeys(group)) {
      if (preservedByKey.has(key)) {
        preserved = preservedByKey.get(key);
        break;
      }
    }
    if (!preserved) return group;
    return {
      ...group,
      judgment: {
        ...group.judgment,
        ...preserved,
        reason: {
          ...(group.judgment?.reason ?? {}),
          ...(preserved.reason ?? {}),
        },
      },
    };
  });
}

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export async function readJsonIfExists(url) {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(url, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeJson(url, data) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(url, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function extractHandlesFromSamples(samples = []) {
  const handles = new Set();
  for (const sample of samples) {
    if (sample?.accountHandle) handles.add(String(sample.accountHandle).replace(/^@/, ""));
    const matches = String(sample.text ?? "").match(/@([A-Za-z0-9_]{2,})/g) ?? [];
    for (const token of matches) handles.add(token.replace(/^@/, ""));
  }
  return [...handles];
}
