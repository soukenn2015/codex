# Grok Build Supervision Token Audit

## Current flow before compaction

`run-grok-task.mjs` starts the headless `grok` CLI with JSON output and waits synchronously for completion. There is no TUI and no incremental Grok transcript in Codex. Grok's private session files remain under `~/.grok/sessions/` and are not read by Codex unless explicitly opened.

Before this audit, the runner printed its complete result JSON to stdout. That included the final answer, hidden `thought`, stderr, and complete verification output. Because Codex receives command stdout as tool output, all of that text entered the Codex context after every run.

Measured historical runner reports ranged from about 1.5 KB to 14.3 KB, or roughly 400 to 3,600 tokens at four UTF-8 bytes per token. Successful examples were 6.8 KB, 8.1 KB, 9.6 KB, and 14.3 KB. The largest report contained about 5.6 KB of final answer and 7.1 KB of hidden thought. These estimates are comparative only; actual tokenization varies, especially for Japanese text.

Grok session directories were much larger, about 0.6 MB to 1.4 MB each, with all sessions totaling about 7.7 MB during the audit. That volume is Grok-side state and does not itself consume Codex input tokens.

## Compacted flow

The runner now preserves full stdout, stderr, verification logs, and `result.json` as audit artifacts, but stdout contains only `codex-input.txt`. The compact handoff includes status, changed paths, path-policy violations, diff stat, verification pass/fail plus failure tails, session continuation metadata, and Grok's final report. It excludes hidden thought and successful test logs.

`metrics.json` records raw and compact byte, line, and rough token counts. `/tmp/grok-build-run.log` and `/tmp/codex-input.txt` mirror the latest run for direct comparison.

## What Codex should read

Always read the compact final report, changed file list, path-policy results, `git diff --stat`, and verification status. Read a path-limited diff for every file being adopted. Read a failing test's short tail first, then its full log only when needed to diagnose the failure.

Do not routinely read Grok hidden thought, TUI transcripts, successful test logs, full repository diffs, raw session JSONL, or repeated error history. Those artifacts remain available for exceptional diagnosis.

## Model guidance

- GPT-5.5 low: routine task dispatch, compact result checks, and deterministic acceptance gates.
- GPT-5.5 medium: default for adopting code, ambiguous review findings, and cross-file reasoning.
- GPT-5.4 low: narrow orchestration and metrics work when GPT-5.5 is unnecessary or unavailable.
- GPT-5.4 medium: constrained reviews with moderate reasoning needs.
- GPT-5.4 xhigh: only unusually difficult architecture, security, or root-cause investigations with incomplete or conflicting evidence. It adds little value to routine Grok supervision and does not compensate for oversized input.

Avoid Fast mode when the objective is minimum credit consumption. Lower reasoning effort only after the compact input and acceptance gates are in place.

## Low-token operating procedure

1. Run one tightly scoped Grok task with explicit allowed paths and verification commands.
2. Let the runner finish without live transcript polling.
3. Read only `codex-input.txt` and `metrics.json`.
4. Reject path violations immediately without reading a full diff.
5. Inspect `git diff --stat`, then a path-limited diff only for changed allowed files.
6. Read full test or Grok logs only when the compact failure tail is insufficient.
7. Record raw-to-compact size ratio per task and reduce the final-report limit or task scope when compact input grows unexpectedly.
