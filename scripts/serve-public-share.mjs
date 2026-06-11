#!/usr/bin/env node
/**
 * Serve public-share/ on port 8765 (localhost fixed URL).
 * Run sync-public-share.mjs first.
 */
import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PORT = Number(process.env.MARKETLENS_PORT ?? 8765);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public-share");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.includes("..")) return null;
  const abs = path.join(ROOT, normalized);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const abs = safePath(req.url ?? "/");
  if (!abs) {
    send(res, 404, "Not Found");
    return;
  }
  try {
    const st = statSync(abs);
    if (!st.isFile()) {
      send(res, 404, "Not Found");
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const body = readFileSync(abs);
    send(res, 200, body, MIME[ext] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not Found");
  }
});

function stopExistingOnPort() {
  const probe = spawnSync("lsof", ["-ti", `:${PORT}`], { encoding: "utf8" });
  const pids = (probe.stdout ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`stopped previous listener pid=${pid}`);
    } catch {
      /* ignore */
    }
  }
  if (pids.length) {
    spawnSync("sleep", ["1"]);
  }
}

stopExistingOnPort();
server.listen(PORT, () => {
  console.log(`MarketLens public-share: http://localhost:${PORT}/`);
  console.log(`root: ${ROOT}`);
});