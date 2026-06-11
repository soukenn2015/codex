#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const taskPath = path.resolve(process.argv[2] ?? "");
const resumeLatest = process.argv.includes("--resume-latest");
const grokBin = process.env.GROK_BIN || "/Users/user/.grok/bin/grok";

function fail(message, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, message, ...details }, null, 2)}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    timeout: options.timeout,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function git(args, cwd = repoRoot) {
  const result = run("git", args, { cwd });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed`, { stderr: result.stderr.trim() });
  return result.stdout.trim();
}

function validateTask(task) {
  const required = ["id", "mode", "baseCommit", "objective", "allowedPaths", "forbiddenPaths", "verification", "maxTurns"];
  for (const key of required) {
    if (!(key in task)) fail(`task is missing ${key}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(task.id)) fail("task.id is invalid");
  if (!["review", "implement"].includes(task.mode)) fail("task.mode must be review or implement");
  if (typeof task.objective !== "string" || task.objective.trim().length < 10) fail("task.objective is too short");
  for (const key of ["allowedPaths", "forbiddenPaths", "verification"]) {
    if (!Array.isArray(task[key]) || task[key].some((value) => typeof value !== "string" || !value.trim())) {
      fail(`task.${key} must be an array of non-empty strings`);
    }
  }
  if (!Number.isInteger(task.maxTurns) || task.maxTurns < 1 || task.maxTurns > 20) fail("task.maxTurns is invalid");
  for (const command of task.verification) {
    if (!/^(git|node|npm)\b/.test(command)) fail(`unsupported verification command: ${command}`);
  }
}

function globRegex(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      pattern += ".*";
      index += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => globRegex(pattern).test(file));
}

function changedFiles(cwd) {
  return git(["status", "--porcelain=v1", "--untracked-files=all"], cwd)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file);
}

function latestSessionId(taskId) {
  const taskRunDir = path.join(repoRoot, ".ai-ops", "runs", taskId);
  let runNames = [];
  try {
    runNames = readdirSync(taskRunDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const runName of runNames) {
    try {
      const report = JSON.parse(readFileSync(path.join(taskRunDir, runName, "result.json"), "utf8"));
      if (typeof report.sessionId === "string" && report.sessionId) return report.sessionId;
    } catch {
      // Ignore incomplete or malformed historical run output.
    }
  }
  return null;
}

function taskPrompt(task, cwd) {
  return [
    "You are Grok Build, a delegated MarketLens worker controlled by Codex.",
    `Mode: ${task.mode}`,
    `Working directory: ${cwd}`,
    `Base commit: ${task.baseCommit}`,
    "Read AGENTS.md, AI_CONTEXT.md, TASK.md, and .ai-ops/BASELINE.md first.",
    "Do not commit, push, merge, reset, clean, synchronize worktrees, regenerate data, or edit generated JSON.",
    `Allowed paths: ${task.allowedPaths.length ? task.allowedPaths.join(", ") : "none (read-only task)"}`,
    `Forbidden paths: ${task.forbiddenPaths.join(", ")}`,
    "Objective:",
    task.objective,
    "Verification commands allowed/required:",
    task.verification.length ? task.verification.join("\n") : "No commands required.",
    task.mode === "review"
      ? "Do not modify any file. Report findings only."
      : "Modify only allowed paths. Stop if the objective requires any forbidden or unlisted path.",
    "Keep the response short and finish within the turn budget.",
    "Final response must state: summary, changed files, verification, unresolved risks.",
  ].join("\n\n");
}

if (!process.argv[2]) fail("usage: node .ai-ops/bin/run-grok-task.mjs <task.json> [--resume-latest]");

let task;
try {
  task = JSON.parse(readFileSync(taskPath, "utf8"));
} catch (error) {
  fail("task JSON could not be read", { error: String(error.message ?? error) });
}
validateTask(task);

const resolvedResumeSessionId = task.resumeSessionId ?? (resumeLatest ? latestSessionId(task.id) : null);
if (resumeLatest && !resolvedResumeSessionId) fail(`no previous session found for ${task.id}`);

const resolvedBase = git(["rev-parse", "--verify", `${task.baseCommit}^{commit}`]);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(repoRoot, ".ai-ops", "runs", task.id, stamp);
mkdirSync(runDir, { recursive: true });

let taskCwd = repoRoot;
let branch = null;
if (task.mode === "implement") {
  branch = `grok/${task.id}-${stamp.toLowerCase()}`;
  taskCwd = path.resolve(repoRoot, "..", `.grok-${task.id}-${stamp}`);
  const create = run("git", ["worktree", "add", "-b", branch, taskCwd, resolvedBase], { cwd: repoRoot });
  if (create.status !== 0) fail("task worktree creation failed", { stderr: create.stderr.trim() });
}

const before = changedFiles(taskCwd);
if (before.length > 0) fail("task worktree is not clean", { taskCwd, before });

const args = [
  "-p", taskPrompt(task, taskCwd),
  "--cwd", taskCwd,
  "--model", "grok-build",
  "--output-format", "json",
  "--max-turns", String(task.maxTurns),
  "--effort", "high",
  "--sandbox", task.mode === "review" ? "read-only" : "workspace",
  "--disable-web-search",
  "--no-memory",
  "--no-plan",
  "--deny", "Bash(git commit*)",
  "--deny", "Bash(git push*)",
  "--deny", "Bash(git reset*)",
  "--deny", "Bash(git clean*)",
];
for (const pattern of task.forbiddenPaths) {
  args.push("--deny", `Edit(${pattern})`, "--deny", `Write(${pattern})`);
}
if (resolvedResumeSessionId) args.push("--resume", resolvedResumeSessionId);

const timeoutMs = task.timeoutMs ?? 1_200_000;
const result = run(grokBin, args, { cwd: taskCwd, timeout: timeoutMs });
const after = changedFiles(taskCwd);
const forbiddenChanges = after.filter((file) => matchesAny(file, task.forbiddenPaths));
const outsideAllowed = after.filter((file) => !matchesAny(file, task.allowedPaths));
const reviewChanged = task.mode === "review" && after.length > 0;

let output = null;
try {
  output = JSON.parse(result.stdout || "{}");
} catch {
  output = { type: "invalid_json", raw: result.stdout };
}

const verificationResults = task.verification.map((command) => {
  const verification = run("/bin/zsh", ["-lc", command], { cwd: taskCwd, timeout: 120_000 });
  return {
    command,
    exitCode: verification.status,
    timedOut: verification.error?.code === "ETIMEDOUT",
    stdout: verification.stdout,
    stderr: verification.stderr,
  };
});
const verificationFailed = verificationResults.some((verification) => verification.exitCode !== 0 || verification.timedOut);
const outputFailed =
  output?.type === "error" ||
  output?.type === "invalid_json" ||
  output?.subtype === "error" ||
  output?.is_error === true;
const resumableCancelled =
  output?.stopReason === "Cancelled" &&
  typeof (output?.sessionId ?? output?.session_id) === "string" &&
  String(output?.text ?? "").trim().length === 0;

const accepted =
  result.status === 0 &&
  !result.error &&
  !outputFailed &&
  forbiddenChanges.length === 0 &&
  outsideAllowed.length === 0 &&
  !reviewChanged &&
  !verificationFailed;

const report = {
  ok: accepted,
  task,
  resolvedBase,
  taskCwd,
  branch,
  exitCode: result.status,
  timedOut: result.error?.code === "ETIMEDOUT",
  changedFiles: after,
  forbiddenChanges,
  outsideAllowed,
  verificationResults,
  sessionId: output?.sessionId ?? output?.session_id ?? null,
  resumedSessionId: resolvedResumeSessionId,
  resumeSuggested: resumableCancelled,
  nextStep:
    resumableCancelled
      ? "Rerun the same task with --resume-latest; no sessionId copy is required."
      : null,
  response: output,
  stderr: result.stderr,
};
writeFileSync(path.join(runDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(accepted ? 0 : 1);
