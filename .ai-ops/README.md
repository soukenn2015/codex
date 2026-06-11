# MarketLens AI Operations

Codex is the only operator of the recovery branch. Grok is a delegated worker and may run only through `.ai-ops/bin/run-grok-task.mjs`.

## Review task

```sh
node .ai-ops/bin/run-grok-task.mjs .ai-ops/tasks/connection-smoke.json
```

Review tasks use the recovery worktree with `--sandbox read-only`. The runner rejects the result if any file changes.

## Implementation task

```sh
node .ai-ops/bin/run-grok-task.mjs .ai-ops/tasks/fix-exploration-task-affinity.json
```

Implementation tasks create a disposable sibling worktree from `baseCommit`. The runner rejects forbidden or unlisted file changes and runs every declared verification command. Grok never commits, pushes, or synchronizes the recovery worktree.

## External service approval

Running the real Grok CLI sends the task prompt and any repository files Grok reads to the external Grok service. Obtain explicit approval for that data transfer when the execution environment requires it. A rejected or unavailable connection does not authorize a workaround.

## Result handling

Results are written under `.ai-ops/runs/<task-id>/<timestamp>/result.json` and are ignored by Git. Accept a task only when all of these are true:

- `ok` is `true`.
- `changedFiles` contains only `allowedPaths`.
- `forbiddenChanges` and `outsideAllowed` are empty.
- Every `verificationResults` entry has exit code `0` and did not time out.
- Codex has reviewed the diff before reproducing or adopting it.

For an explicit continuation, copy the returned `sessionId` into the task JSON as `resumeSessionId`. Never use ambiguous `-c` continuation.

On invalid JSON, timeout, permission failure, or path violation, leave the disposable worktree unadopted and make no change to the recovery branch.
