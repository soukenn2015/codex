#!/usr/bin/env node
/**
 * Verify public-share HTTP surface: allowed paths 200, forbidden paths 404.
 */
const BASE = process.env.MARKETLENS_HTTP_BASE ?? "http://localhost:8765";

const MUST_200 = ["/", "/marketlens-overview.html", "/data/marketlens.snapshot.json"];

const MUST_404 = [
  "/data/source-config.json",
  "/data/marketlens.history.json",
  "/data/marketlens.public-history.json",
  "/scripts/marketlens-status.mjs",
  "/AI_CONTEXT.md",
  "/GROK_HANDOFF.md",
  "/WORKLOG.md",
  "/TASK.md",
  "/CODEX_MCP_RULES.md",
  "/package.json",
  "/package-lock.json",
  "/node_modules/",
  "/.env",
  "/credentials",
  "/secrets",
];

async function headOrGet(path) {
  const url = `${BASE}${path}`;
  let res = await fetch(url, { method: "HEAD", redirect: "manual" });
  if (res.status === 405 || res.status === 501) {
    res = await fetch(url, { method: "GET", redirect: "manual" });
  }
  return res.status;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const results = { ok200: [], ok404: [], failed: [] };

  for (const p of MUST_200) {
    const status = await headOrGet(p);
    if (status === 200) results.ok200.push({ path: p, status });
    else results.failed.push({ path: p, expected: 200, actual: status });
  }

  for (const p of MUST_404) {
    const status = await headOrGet(p);
    if (status === 404) results.ok404.push({ path: p, status });
    else results.failed.push({ path: p, expected: 404, actual: status });
  }

  if (results.failed.length) {
    console.error("public-share HTTP check FAILED:");
    for (const row of results.failed) {
      console.error(`  ${row.path}: expected ${row.expected}, got ${row.actual}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`public-share HTTP check passed (${BASE})`);
  console.log(`  200: ${results.ok200.map((r) => r.path).join(", ")}`);
  console.log(`  404: ${results.ok404.length} forbidden paths`);
}

main().catch((e) => {
  console.error(`public-share HTTP check error: ${e.message}`);
  process.exitCode = 1;
});