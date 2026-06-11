# MarketLens Agent Rules

Codex is the only operator allowed to integrate changes into the canonical branch. Grok Build and other delegated agents work only inside task-specific worktrees created by `.ai-ops/bin/run-grok-task.mjs`.

## Required behavior

- Read `AI_CONTEXT.md`, `TASK.md`, and `.ai-ops/BASELINE.md` before changing code.
- Change only paths listed in the task's `allowedPaths`.
- Do not commit, push, merge, rebase, reset, clean, checkout files, or synchronize another worktree.
- Do not edit generated JSON, raw archives, `public-share/`, credentials, environment files, or API keys.
- Do not run collectors, postprocess, public-share synchronization, or data regeneration unless the task explicitly allows them.
- Preserve unrelated user changes.
- Finish with a concise list of changed files and verification results.

## P1 invariants

- Never promote `jpyCandidate` or `browser_observed_candidate` into `priceSnapshots`, `observed_market_price`, or BuyLine.
- Observation data must keep `buyLineEligible: false`.
- Do not change the BuyLine formula or price promotion paths.
- Do not restore forbidden UI labels: 相場, 実勢価格, フリマ相場, 観測相場, メルカリ相場, 市場価格.

## D6-B/C frozen area

Do not change layer classification, ordering, limits, or supporting UI structures, including:

- `collectFlowLayerRows`, `renderLayerBoard`, `collectLayerRowsByBucket`
- `flowBucketForItem`, `isSoonLayerItem`, `appendResearchTags`
- `renderResearchDetails`, `buildProvisionalDeals`
- `periodLayer`, layer timestamps, `aux/none/hold/active`
- `validationPriority`, `statePriority`, `reasonPriority`
- candidate priority, display order, and the meaning of price assistance

Information completeness is display-only confirmation material. It must not become a score, rank, filter, sort key, layer condition, action condition, or snapshot field.
