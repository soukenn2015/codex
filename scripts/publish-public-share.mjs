#!/usr/bin/env node
/**
 * Rebuild public-share/ and verify localhost HTTP surface.
 * Safe to run while ngrok is active (serves same public-share root).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function run(scriptName) {
  const result = spawnSync("node", [path.join(ROOT, scriptName)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("sync-public-share.mjs");
run("check-public-share-http.mjs");
console.log("publish-public-share complete");