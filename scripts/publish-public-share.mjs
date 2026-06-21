#!/usr/bin/env node
/**
 * Rebuild public-share/ and verify localhost HTTP surface.
 * Safe to run while ngrok is active (serves same public-share root).
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ROOT, "..");
const PUBLIC_ROOT = path.join(REPO_ROOT, "public-share");
const DEFAULT_PUBLIC_PORT = process.env.MARKETLENS_PUBLIC_SHARE_CHECK_PORT || "18765";

function run(scriptName) {
  const result = spawnSync("node", [path.join(ROOT, scriptName)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("sync-public-share.mjs");

if (process.env.MARKETLENS_HTTP_BASE) {
  run("check-public-share-http.mjs");
} else {
  const checkEnv = {
    ...process.env,
    MARKETLENS_HTTP_BASE: `http://127.0.0.1:${DEFAULT_PUBLIC_PORT}`,
  };
  const existingCheck = spawnSync("node", [path.join(ROOT, "check-public-share-http.mjs")], {
    stdio: "ignore",
    env: checkEnv,
  });
  if (existingCheck.status === 0) {
    const result = spawnSync("node", [path.join(ROOT, "check-public-share-http.mjs")], {
      stdio: "inherit",
      env: checkEnv,
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  } else {
    const server = spawn("python3", ["-m", "http.server", DEFAULT_PUBLIC_PORT, "--bind", "127.0.0.1"], {
      cwd: PUBLIC_ROOT,
      stdio: ["ignore", "ignore", "inherit"],
      env: process.env,
    });
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
      const result = spawnSync("node", [path.join(ROOT, "check-public-share-http.mjs")], {
        stdio: "inherit",
        env: checkEnv,
      });
      if (result.status !== 0) process.exit(result.status ?? 1);
    } finally {
      server.kill();
    }
  }
}
console.log("publish-public-share complete");
