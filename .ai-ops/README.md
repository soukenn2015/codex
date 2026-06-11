# MarketLens AI Operations

Codex is the only operator of the recovery branch. Grok Build is a delegated worker and may run only through `.ai-ops/bin/run-grok-task.mjs`. The executable is named `grok`, while the selected model is always `grok-build`.

Codexの返答と`codex-input.txt`は、`AGENTS.md`の「Codex返答冒頭ルール」および`.ai-ops/CODEX_RESPONSE_RULES.md`に従い、日本語の現在地・進度・モデル・トークン方針ヘッダーから開始します。

現在のrepo全体進度と位置は`.ai-ops/STATUS.json`をCodexが判断材料として更新します。ランナーは状態・モデル・危険度・制限を推測せず、Codexがタスクへ設定した短い値を表示・保存するだけです。

## Review task

```sh
node .ai-ops/bin/run-grok-task.mjs .ai-ops/tasks/connection-smoke.json
```

Review tasks use the recovery worktree with `--sandbox read-only`. The runner rejects the result if any file changes.

## Completed-fix review

```sh
node .ai-ops/bin/run-grok-task.mjs .ai-ops/tasks/review-exploration-task-affinity.json
```

Implementation tasks, when explicitly added, create a disposable sibling worktree from `baseCommit`. The runner rejects forbidden or unlisted file changes and runs every declared verification command. Grok Build never commits, pushes, or synchronizes the recovery worktree.

## External service approval

Running Grok Build sends the task prompt and any repository files it reads to the external Grok Build service. Obtain explicit approval for that data transfer when the execution environment requires it. A rejected or unavailable connection does not authorize a workaround.

## Result handling

The runner is blocking, not a live TUI monitor. It waits for Grok Build to finish, stores the full output, and prints only a compact handoff for Codex. Results are written under `.ai-ops/runs/<task-id>/<timestamp>/` and are ignored by Git:

- `codex-input.txt`: the only file Codex should read by default; failed runs include a bounded Grok stderr tail.
- `metrics.json`: byte, line, and rough token counts.
- `grok-stdout.log` and `grok-stderr.log`: full Grok Build output for exceptional debugging only.
- `verification-*.log`: full test output for failures or targeted investigation only.
- `result.json`: complete audit record, including the raw parsed response.

The latest raw and compact outputs are also mirrored to `/tmp/grok-build-run.log` and `/tmp/codex-input.txt`. Compare them with:

```sh
node .ai-ops/bin/measure-text.mjs /tmp/grok-build-run.log /tmp/codex-input.txt
```

Do not stream or paste TUI output into Codex. Do not read `result.json`, raw logs, full test output, or Grok session files unless the compact report identifies a failure that requires them. Use `--full-output` only for runner debugging.

Accept a task only when all of these are true:

- `ok` is `true`.
- `changedFiles` contains only `allowedPaths`.
- `forbiddenChanges` and `outsideAllowed` are empty.
- `forbiddenDiffFiles`, `outsideAllowedDiffFiles`, and `dangerousKeywordViolations` are empty. These checks inspect diff targets and added lines, including untracked files.
- Every compact `verification` entry has exit code `0` and did not time out.
- Codex has reviewed `git diff --stat` and only the necessary path-limited diff before reproducing or adopting it.

For an explicit continuation, rerun the same command with `--resume-latest`. The runner reads the exact `sessionId` from the latest saved result. Never use ambiguous `-c` continuation.

Do not copy terminal JSON into Codex. After a run, tell Codex only that the task finished; Codex reads `codex-input.txt` directly.

On invalid JSON, timeout, permission failure, or path violation, leave the disposable worktree unadopted and make no change to the recovery branch.
