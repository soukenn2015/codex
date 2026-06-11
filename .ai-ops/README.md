# MarketLens AI Operations

Codex is the only operator of the recovery branch. Grok Build is a delegated worker and may run only through `.ai-ops/bin/run-grok-task.mjs`. The executable is named `grok`, while the selected model is always `grok-build`.

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

Results are written under `.ai-ops/runs/<task-id>/<timestamp>/result.json` and are ignored by Git. Accept a task only when all of these are true:

- `ok` is `true`.
- `changedFiles` contains only `allowedPaths`.
- `forbiddenChanges` and `outsideAllowed` are empty.
- Every `verificationResults` entry has exit code `0` and did not time out.
- Codex has reviewed the diff before reproducing or adopting it.

For an explicit continuation, rerun the same command with `--resume-latest`. The runner reads the exact `sessionId` from the latest saved result. Never use ambiguous `-c` continuation.

Do not copy terminal JSON into Codex. After a run, tell Codex only that the task finished; Codex reads `.ai-ops/runs/<task-id>/` directly.

On invalid JSON, timeout, permission failure, or path violation, leave the disposable worktree unadopted and make no change to the recovery branch.
