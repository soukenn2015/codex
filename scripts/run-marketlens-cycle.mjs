import { spawn } from "node:child_process";

const retries = Number(process.env.MARKETLENS_RETRIES ?? 3);
const retryDelayMs = Number(process.env.MARKETLENS_RETRY_DELAY_MS ?? 15000);
const collectDegradedExitCode = 2;

function runNodeScript(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let collectOk = false;
let collectState = "failed";
for (let attempt = 1; attempt <= retries; attempt += 1) {
  console.log(`[marketlens-cycle] collect attempt ${attempt}/${retries}`);
  const code = await runNodeScript(new URL("./collect-marketlens.mjs", import.meta.url).pathname);
  if (code === 0) {
    collectOk = true;
    collectState = "ok";
    break;
  }
  if (code === collectDegradedExitCode) {
    collectState = "degraded";
    break;
  }
  if (attempt < retries) {
    console.log(`[marketlens-cycle] collect failed (code=${code}), retry in ${retryDelayMs}ms`);
    await sleep(retryDelayMs);
  }
}

if (collectState === "failed") {
  console.log("[marketlens-cycle] collector failed. fallback to existing snapshot for digest.");
}
if (collectState === "degraded") {
  console.log("[marketlens-cycle] collector degraded. preserved existing snapshot and using previous data for postprocess/digest.");
}

const postprocessCode = await runNodeScript(new URL("./postprocess-marketlens-snapshot.mjs", import.meta.url).pathname);
if (postprocessCode !== 0) {
  console.error(`[marketlens-cycle] postprocess failed (code=${postprocessCode})`);
  process.exit(postprocessCode);
}

const digestCode = await runNodeScript(new URL("./daily-digest.mjs", import.meta.url).pathname);
if (digestCode !== 0) {
  console.error(`[marketlens-cycle] digest failed (code=${digestCode})`);
  process.exit(digestCode);
}

console.log(`[marketlens-cycle] complete (collect=${collectState === "ok" ? "ok" : collectState})`);
