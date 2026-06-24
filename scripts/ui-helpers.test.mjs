/**
 * UI helper behavioral tests.
 * These functions are duplicated from script.js because script.js is an IIFE
 * that depends on the DOM and cannot be imported directly in Node.
 */

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeKey(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[「」『』【】（）()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function categorize(name) {
  if (!name) return "other";
  if (/ポケカ|ポケモンカード|TCG|pokemon.*card/i.test(name)) return "pokeca";
  if (/ワンピース|ワンピカ|ONE PIECE|OP-?\d/i.test(name)) return "onepiece";
  if (/一番くじ|くじ引き堂|ラストワン/i.test(name)) return "kuji";
  if (/ROBOT魂|METAL BUILD|S\.H\.Figuarts|figma|フィギュア|プラモ|ガンプラ|HG|MG|PG/i.test(name)) return "figure";
  if (/限定|コラボ|G-SHOCK|Supreme|たまごっち/i.test(name)) return "limited";
  return "other";
}

function nameOverlapScore(left = "", right = "") {
  const leftNorm = normalizeKey(left);
  const rightNorm = normalizeKey(right);
  if (leftNorm.length >= 4 && rightNorm.length >= 4) {
    if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) {
      return Math.max(0.72, Math.min(leftNorm.length, rightNorm.length) / Math.max(leftNorm.length, rightNorm.length));
    }
  }
  const leftTokens = leftNorm.split(/[\s　・／/]+/).filter((token) => token.length >= 2);
  const rightTokens = new Set(rightNorm.split(/[\s　・／/]+/).filter((token) => token.length >= 2));
  if (!leftTokens.length || !rightTokens.size) return 0;
  const shared = leftTokens.filter((token) => rightTokens.has(token));
  return shared.length / Math.max(leftTokens.length, rightTokens.size);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  // escapeHtml
  assert(escapeHtml("<script>alert('xss')</script>") === "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;", "escapeHtml should escape HTML");
  assert(escapeHtml('"quoted"') === "&quot;quoted&quot;", "escapeHtml should escape quotes");
  assert(escapeHtml(null) === "", "escapeHtml should handle null");

  // normalizeKey
  assert(normalizeKey("  【ポケカ】 高騰  (BOX)  ") === "ポケカ 高騰 box", "normalizeKey should clean brackets and spaces");
  assert(normalizeKey("ROBOT魂 ズワァース") === "robot魂 ズワァース", "normalizeKey should lowercase");

  // categorize
  assert(categorize("ポケモンカードゲーム スカーレット&バイオレット") === "pokeca", "categorize should detect pokemon card");
  assert(categorize("ワンピースカードゲーム 新弾") === "onepiece", "categorize should detect one piece");
  assert(categorize("一番くじ ドラゴンボール") === "kuji", "categorize should detect kuji");
  assert(categorize("ROBOT魂 ガンダム") === "figure", "categorize should detect figure");
  assert(categorize("限定コラボ Tシャツ") === "limited", "categorize should detect limited");
  assert(categorize("普通の商品") === "other", "categorize should fallback to other");

  // nameOverlapScore
  assert(nameOverlapScore("ポケモンカード BOX", "ポケカ box") >= 0.5, "nameOverlapScore should match pokemon card box");
  assert(nameOverlapScore("ROBOT魂 ズワァース", "ROBOT魂 ズワァース") === 1, "nameOverlapScore should match identical names");
  assert(nameOverlapScore("ポケモンカード", "ワンピースカード") < 0.3, "nameOverlapScore should be low for unrelated names");
  assert(nameOverlapScore("a", "b") === 0, "nameOverlapScore should be zero for short names");

  console.log("ui-helpers behavioral tests passed");
}

run();
