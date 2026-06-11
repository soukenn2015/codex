#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const taskPath = path.resolve(process.argv[2] ?? "");
const resumeLatest = process.argv.includes("--resume-latest");
const fullOutput = process.argv.includes("--full-output");
const grokBin = process.env.GROK_BIN || "/Users/user/.grok/bin/grok";
const compactOutputPath = "/tmp/codex-input.txt";
const rawOutputPath = "/tmp/grok-build-run.log";
const defaultForbiddenKeywords = [
  "git commit",
  "git push",
  "git reset",
  "git clean",
  "相場",
  "実勢価格",
  "フリマ相場",
  "観測相場",
  "メルカリ相場",
  "市場価格",
];
const defaultDoNotRead = [
  "Grok生ログ",
  "thought",
  "TUI全文",
  "成功テストログ",
  "stderr全文",
  "diff全文",
  "GrokセッションJSONL",
];

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

function textMetrics(value) {
  const text = String(value ?? "");
  return {
    bytes: Buffer.byteLength(text),
    lines: text ? text.split(/\r?\n/).length : 0,
    approxTokens: Math.ceil(Buffer.byteLength(text) / 4),
  };
}

function tail(value, maxLines = 20, maxBytes = 2_000) {
  const clean = String(value ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const lines = clean.trim().split(/\r?\n/).filter(Boolean);
  let output = lines.slice(-maxLines).join("\n");
  while (Buffer.byteLength(output) > maxBytes && output.length > 0) output = output.slice(100);
  return output;
}

function bounded(value, maxBytes = 4_000) {
  const text = String(value ?? "").trim();
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
  let output = text;
  while (Buffer.byteLength(output) > maxBytes && output.length > 0) output = output.slice(0, -100);
  return { text: `${output.trimEnd()}\n[truncated; see result.json]`, truncated: true };
}

function unique(values) {
  return [...new Set(values)];
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
  if (task.forbiddenKeywords !== undefined &&
      (!Array.isArray(task.forbiddenKeywords) ||
       task.forbiddenKeywords.some((value) => typeof value !== "string" || !value.trim()))) {
    fail("task.forbiddenKeywords must be an array of non-empty strings");
  }
  for (const key of ["read_targets", "do_not_read"]) {
    if (task[key] !== undefined &&
        (!Array.isArray(task[key]) || task[key].some((value) => typeof value !== "string" || !value.trim()))) {
      fail(`task.${key} must be an array of non-empty strings`);
    }
  }
  for (const key of ["current_location", "overall_progress", "scope_progress", "current_purpose", "recommended_model"]) {
    if (task[key] !== undefined && (typeof task[key] !== "string" || !task[key].trim())) {
      fail(`task.${key} must be a non-empty string`);
    }
  }
  if (task.limit_status !== undefined && (typeof task.limit_status !== "string" || !task.limit_status.trim())) {
    fail("task.limit_status must be a non-empty string");
  }
  if (task.token_policy !== undefined && !["軽め", "標準", "慎重"].includes(task.token_policy)) {
    fail("task.token_policy must be 軽め, 標準, or 慎重");
  }
  if (task.risk_level !== undefined && !["低", "中", "高"].includes(task.risk_level)) {
    fail("task.risk_level must be 低, 中, or 高");
  }
  if (task.marketlens_body_change !== undefined && typeof task.marketlens_body_change !== "boolean") {
    fail("task.marketlens_body_change must be boolean");
  }
  if (!Number.isInteger(task.maxTurns) || task.maxTurns < 1 || task.maxTurns > 20) fail("task.maxTurns is invalid");
  for (const command of task.verification) {
    if (!/^(git|node|npm)\b/.test(command)) fail(`unsupported verification command: ${command}`);
  }
}

function operationMetadata(task) {
  return {
    current_location: task.current_location ?? "未指定",
    overall_progress: task.overall_progress ?? "未指定",
    scope_progress: task.scope_progress ?? "対象スコープ: 据え置き\n全体進度: 据え置き",
    limit_status: task.limit_status ?? "未提示",
    current_purpose: task.current_purpose ?? task.objective,
    recommended_model: task.recommended_model ?? "未指定",
    token_policy: task.token_policy ?? "標準",
    read_targets: task.read_targets ?? ["codex-input.txt", "metrics.json", "git diff --stat", "必要時の限定diff"],
    do_not_read: task.do_not_read ?? defaultDoNotRead,
    risk_level: task.risk_level ?? "未指定",
    marketlens_body_change: task.marketlens_body_change ?? false,
  };
}

function japaneseHeader(metadata) {
  return [
    "【MarketLens 現在地】",
    "",
    "現在地:",
    metadata.current_location,
    "",
    "全体進度:",
    metadata.overall_progress,
    "",
    "今回進度:",
    metadata.scope_progress,
    "",
    "制限状況:",
    metadata.limit_status,
    "",
    "今回の目的:",
    metadata.current_purpose,
    "",
    "推奨モデル:",
    metadata.recommended_model,
    "",
    "トークン方針:",
    metadata.token_policy,
    "",
    "確認対象:",
    metadata.read_targets.join("、"),
    "",
    "読まないもの:",
    metadata.do_not_read.join("、"),
    "",
    "危険度:",
    metadata.risk_level,
    "",
    "本体変更:",
    metadata.marketlens_body_change ? "あり" : "なし",
  ].join("\n");
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

function diffFiles(cwd) {
  const trackedDiffFiles = git(["diff", "--no-renames", "--name-only", "HEAD", "--"], cwd)
    .split("\n")
    .filter(Boolean);
  return unique([...trackedDiffFiles, ...changedFiles(cwd)]).sort();
}

function addedDiffTextByFile(cwd, files) {
  const result = new Map();
  const patch = git(["diff", "--no-ext-diff", "--no-color", "--unified=0", "HEAD", "--"], cwd);
  let currentFile = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      result.set(currentFile, `${result.get(currentFile) ?? ""}${line.slice(1)}\n`);
    }
  }
  for (const file of files) {
    const tracked = run("git", ["ls-files", "--error-unmatch", "--", file], { cwd });
    if (tracked.status === 0 || result.has(file)) continue;
    try {
      result.set(file, readFileSync(path.join(cwd, file), "utf8"));
    } catch {
      // Binary, deleted, or unreadable untracked files are still covered by path checks.
    }
  }
  return result;
}

function keywordViolations(cwd, files, keywords) {
  const addedText = addedDiffTextByFile(cwd, files);
  const violations = [];
  for (const [file, text] of addedText) {
    const lowerText = text.toLocaleLowerCase("en-US");
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLocaleLowerCase("en-US"))) violations.push({ file, keyword });
    }
  }
  return violations;
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

function latestReport(taskId) {
  const taskRunDir = path.join(repoRoot, ".ai-ops", "runs", taskId);
  try {
    const runNames = readdirSync(taskRunDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const runName of runNames) {
      try {
        return JSON.parse(readFileSync(path.join(taskRunDir, runName, "result.json"), "utf8"));
      } catch {
        // Skip the current incomplete run and malformed historical output.
      }
    }
  } catch {
    // No historical run exists.
  }
  return null;
}

function failureSignature(value) {
  const clean = String(value ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\d{4}-\d{2}-\d{2}T\S+/g, "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>");
  return unique(clean.split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => /error|forbidden|timed out|timeout/i.test(line)))
    .join("\n")
    .slice(-2_000);
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
    "Do not include reasoning, tool transcripts, raw command output, repeated instructions, or a repository file inventory.",
    "The final response must be at most 300 words and use exactly these headings:",
    "STATUS: PASS | FINDINGS | BLOCKED",
    "SUMMARY: one concise paragraph",
    "CHANGED_FILES: none, or a comma-separated list",
    "VERIFICATION: command names and pass/fail only",
    "FINDINGS: at most five concise bullets, or none",
    "RISKS: unresolved risks only, or none",
  ].join("\n\n");
}

if (!process.argv[2]) fail("usage: node .ai-ops/bin/run-grok-task.mjs <task.json> [--resume-latest] [--full-output]");

let task;
try {
  task = JSON.parse(readFileSync(taskPath, "utf8"));
} catch (error) {
  fail("task JSON could not be read", { error: String(error.message ?? error) });
}
validateTask(task);
const operation = operationMetadata(task);

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
const changedDiffFiles = diffFiles(taskCwd);
const forbiddenChanges = after.filter((file) => matchesAny(file, task.forbiddenPaths));
const outsideAllowed = after.filter((file) => !matchesAny(file, task.allowedPaths));
const forbiddenDiffFiles = changedDiffFiles.filter((file) => matchesAny(file, task.forbiddenPaths));
const outsideAllowedDiffFiles = changedDiffFiles.filter((file) => !matchesAny(file, task.allowedPaths));
const forbiddenKeywords = unique([...defaultForbiddenKeywords, ...(task.forbiddenKeywords ?? [])]);
const dangerousKeywordViolations = keywordViolations(taskCwd, changedDiffFiles, forbiddenKeywords);
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
const diffStat = git(["diff", "--stat", "HEAD", "--"], taskCwd);
const diffShortStat = git(["diff", "--shortstat", "HEAD", "--"], taskCwd);
const verificationFailed = verificationResults.some((verification) => verification.exitCode !== 0 || verification.timedOut);
const outputFailed =
  output?.type === "error" ||
  output?.type === "invalid_json" ||
  output?.subtype === "error" ||
  output?.is_error === true;
const statusBlocked = /^STATUS:\s*BLOCKED\b/im.test(String(output?.text ?? ""));
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
  forbiddenDiffFiles.length === 0 &&
  outsideAllowedDiffFiles.length === 0 &&
  dangerousKeywordViolations.length === 0 &&
  !statusBlocked &&
  !reviewChanged &&
  !verificationFailed;

const report = {
  ok: accepted,
  ...operation,
  task,
  resolvedBase,
  taskCwd,
  branch,
  exitCode: result.status,
  timedOut: result.error?.code === "ETIMEDOUT",
  changedFiles: after,
  forbiddenChanges,
  outsideAllowed,
  diffFiles: changedDiffFiles,
  forbiddenDiffFiles,
  outsideAllowedDiffFiles,
  dangerousKeywordViolations,
  diffStat,
  diffShortStat,
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

const verificationSummary = verificationResults.map((verification, index) => {
  const stdoutFile = `verification-${index + 1}.stdout.log`;
  const stderrFile = `verification-${index + 1}.stderr.log`;
  writeFileSync(path.join(runDir, stdoutFile), verification.stdout ?? "");
  writeFileSync(path.join(runDir, stderrFile), verification.stderr ?? "");
  const failed = verification.exitCode !== 0 || verification.timedOut;
  return {
    command: verification.command,
    exitCode: verification.exitCode,
    timedOut: verification.timedOut,
    outputBytes: Buffer.byteLength(`${verification.stdout ?? ""}${verification.stderr ?? ""}`),
    failureTail: failed ? tail(`${verification.stdout}\n${verification.stderr}`) : null,
  };
});

const grokStdout = result.stdout ?? "";
const grokStderr = result.stderr ?? "";
const grokFailed = result.status !== 0 || Boolean(result.error) || outputFailed;
const previousReport = latestReport(task.id);
const currentFailureSignature = failureSignature(grokStderr);
const repeatedFailure = Boolean(
  grokFailed &&
  currentFailureSignature &&
  previousReport?.ok === false &&
  failureSignature(previousReport.stderr) === currentFailureSignature
);
const failureTailBytes = statusBlocked || repeatedFailure ? 6_000 : 1_200;
const rawCombined = [
  "===== GROK STDOUT =====",
  grokStdout,
  "===== GROK STDERR =====",
  grokStderr,
].join("\n");
writeFileSync(path.join(runDir, "grok-stdout.log"), grokStdout);
writeFileSync(path.join(runDir, "grok-stderr.log"), grokStderr);
writeFileSync(path.join(runDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(rawOutputPath, rawCombined);

const finalReport = bounded(output?.text);
const compactReport = {
  ok: accepted,
  ...operation,
  taskId: task.id,
  mode: task.mode,
  exitCode: result.status,
  timedOut: result.error?.code === "ETIMEDOUT",
  changedFiles: after,
  forbiddenChanges,
  outsideAllowed,
  diffFiles: changedDiffFiles,
  forbiddenDiffFiles,
  outsideAllowedDiffFiles,
  dangerousKeywordViolations,
  diffStat,
  diffShortStat,
  verification: verificationSummary,
  sessionId: output?.sessionId ?? output?.session_id ?? null,
  resumedSessionId: resolvedResumeSessionId,
  resumeSuggested: resumableCancelled,
  nextStep: resumableCancelled
    ? "Rerun the same task with --resume-latest; no sessionId copy is required."
    : null,
  diagnosticExpansion: statusBlocked ? "status_blocked" : repeatedFailure ? "same_failure_twice" : null,
  grokFailureTail: grokFailed || statusBlocked ? tail(grokStderr, 40, failureTailBytes) : null,
  finalReport: finalReport.text,
  finalReportTruncated: finalReport.truncated,
  runDir,
};
const headerText = japaneseHeader(operation);
const compactText = `${headerText}\n\n${JSON.stringify(compactReport, null, 2)}\n`;
const metrics = {
  taskId: task.id,
  ...operation,
  grokStdout: textMetrics(grokStdout),
  grokStderr: textMetrics(grokStderr),
  grokTotal: textMetrics(rawCombined),
  finalReport: textMetrics(compactReport.finalReport),
  hiddenThought: textMetrics(output?.thought),
  verificationStdoutTotal: textMetrics(verificationResults.map((item) => item.stdout).join("\n")),
  verificationStderrTotal: textMetrics(verificationResults.map((item) => item.stderr).join("\n")),
  codexInput: textMetrics(compactText),
  grok_total_bytes: Buffer.byteLength(rawCombined),
  codex_input_bytes: Buffer.byteLength(compactText),
  reduction_ratio: Buffer.byteLength(rawCombined) > 0
    ? Number((1 - Buffer.byteLength(compactText) / Buffer.byteLength(rawCombined)).toFixed(4))
    : 0,
  estimated_tokens: {
    grok_total: Math.ceil(Buffer.byteLength(rawCombined) / 4),
    codex_input: Math.ceil(Buffer.byteLength(compactText) / 4),
  },
  approximation: "UTF-8 bytes divided by 4; use only as a rough comparison.",
};
writeFileSync(path.join(runDir, "codex-input.txt"), compactText);
writeFileSync(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
writeFileSync(compactOutputPath, compactText);

process.stdout.write(fullOutput ? `${JSON.stringify(report, null, 2)}\n` : compactText);
process.exit(accepted ? 0 : 1);
