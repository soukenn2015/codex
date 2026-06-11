# MarketLens Recovery Baseline

Recovery starting point: `36a2b4db7a8ed2633bb503bd2720ff42aa0220a8`

Historical pre-recovery snapshot: `346a9386801a4db86a7f13a822e407a0563b4978`

The original Documents worktree and the existing Grok Build worktree are frozen evidence. Do not reset, clean, delete, or synchronize them. Recovery happens only on `marketlens-recovery-v1` and disposable Grok Build task worktrees.

## Adopted

- Collector source configuration, raw archive support, write protection, and deterministic product/event/route/reason builders.
- `.ai-ops/` delegation tooling: `bin/run-grok-task.mjs`, `contracts/task.schema.json`, `tasks/*.json`, and `README.md`.
- OpenAI/Gemini provider paths, explicit execution metadata, fallback reasons, and standalone Gemini smoke test.
- Marketplace/SNS observation modules with all observation prices excluded from BuyLine.
- `data/source-config.json` and `data/deal-candidates.csv` as active collector inputs.
- `scripts/marketlens-exploration-affinity.mjs` and the regression coverage that fixes category-only task attachment.
- `scripts/regression-check-vnext.mjs` as the broader post-recovery invariant suite for regenerated snapshots.
- D6-A display-only completeness material and auxiliary SNS placement.
- Overview and public-share helper code, including `marketlens-overview.html`, `marketlens-overview.css`, and `marketlens-overview.js`, but not generated `public-share/` copies.
- Syntax, data invariant, and UI invariant regression checks that do not freeze D6-B/C proposals.

## Frozen P1 / D6

- P1 invariants:
  `jpyCandidate` and `browser_observed_candidate` never promote into `priceSnapshots`, `observed_market_price`, or BuyLine.
  Observation data keeps `buyLineEligible: false`.
  BuyLine formula and price promotion paths do not change.
  Forbidden labels stay banned: `相場`, `実勢価格`, `フリマ相場`, `観測相場`, `メルカリ相場`, `市場価格`.
- D6-B/C frozen UI surface:
  `collectFlowLayerRows`, `renderLayerBoard`, `collectLayerRowsByBucket`,
  `flowBucketForItem`, `isSoonLayerItem`, `appendResearchTags`,
  `renderResearchDetails`, `buildProvisionalDeals`,
  `periodLayer`, layer timestamps, `aux/none/hold/active`,
  `validationPriority`, `statePriority`, `reasonPriority`,
  candidate priority, display order, and the meaning of price assistance.
- Layer-board limits, date grouping, soon-layer threshold changes, bucket rewrites, priority rewrites, and large sidebar/layer redesigns stay frozen.
- Information completeness is display-only confirmation material. It must not become a score, rank, filter, sort key, layer condition, action condition, or snapshot field.
- Completeness-derived ranking, scoring, filtering, sorting, promotion, or persistence stay frozen.

## Generated Artifacts

- `data/marketlens.snapshot.json`, `data/marketlens.history.json`, and `data/marketlens.public-history.json`.
- Historical generated outputs such as `data/source-registry.json`, `data/raw-archive/`, and partial snapshots remain generated classes even when absent from the recovery tree.
- `public-share/` and temporary publish output.
- `.ai-ops/runs/` stores delegated run logs and is Git-ignored.
- These are not regenerated during recovery reconstruction.

## Experimental

- Mercari Playwright probes and JPY candidate batch analysis.
- Yahoo realtime and X reader queue experiments.
- UI browser audit scripts such as `scripts/ui-layer-bucket-audit.mjs`, and ngrok/local sharing helpers.
- `scripts/ui-completeness-audit.mjs` is currently absent; do not assume it exists as an active check.
- Experimental code may be retained as isolated tooling but must not alter P1 or D6 behavior.

## Discard / Quarantine Candidates

- `.DS_Store`, `.tools/`, `node_modules/`, and stale preview screenshots retained only as historical evidence.
- Existing generated copies whose timestamps disagree with the snapshot or source configuration/history.
- Heuristic price output presented as resale prediction, category-only exploration-task attachment, and tests that assert frozen D6-B/C behavior.

## Known Recovery Findings

- Real LLM execution is unconfirmed; current product theses and overview are heuristic.
- The old snapshot registry summary and `data/source-registry.json` disagree.
- Most heuristic price theses collapse to the same value and are not valid resale predictions.
- The old working copy attached unrelated exploration tasks by category fallback; recovery requires exact product-name or explicit brand/series affinity.
- The old working copy had an undefined `learning` reference in `buildPredictedPriceSnapshots`; recovery commit `36a2b4d` resolves it without changing price eligibility.
- `scripts/regression-check-vnext.mjs` is intended for regenerated post-recovery snapshots and will fail against the frozen legacy snapshot until regeneration is an explicit task.
