# MarketLens Recovery Baseline

Baseline commit: `346a9386801a4db86a7f13a822e407a0563b4978`

The original Documents worktree and the existing Grok worktree are frozen evidence. Do not reset, clean, delete, or synchronize them. Recovery happens only on `marketlens-recovery-v1` and disposable Grok task worktrees.

## Adopted

- Collector source registry, raw archive support, write protection, and deterministic product/event/route/reason builders.
- OpenAI/Gemini provider paths, explicit execution metadata, fallback reasons, and standalone Gemini smoke test.
- Marketplace/SNS observation modules with all observation prices excluded from BuyLine.
- D6-A display-only completeness material and auxiliary SNS placement.
- Overview and public-share helper code, but not generated `public-share/` copies.
- Syntax, data invariant, and UI invariant regression checks that do not freeze D6-B/C proposals.

## Frozen P1 / D6

- All price promotion paths, BuyLine formula changes, observation-price eligibility, and forbidden price labels.
- Layer-board limits, date grouping, soon-layer threshold changes, bucket rewrites, priority rewrites, and large sidebar/layer redesigns.
- Completeness-derived ranking, scoring, filtering, sorting, promotion, or persistence.

## Generated Artifacts

- `data/marketlens.snapshot.json`, `data/marketlens.history.json`, and `data/marketlens.public-history.json`.
- `data/source-registry.json`, `data/raw-archive/`, and partial snapshots.
- `public-share/` and temporary publish output.
- These are not regenerated during recovery reconstruction.

## Experimental

- Mercari Playwright probes and JPY candidate batch analysis.
- Yahoo realtime and X reader queue experiments.
- UI browser audit scripts and ngrok/local sharing helpers.
- Experimental code may be retained as isolated tooling but must not alter P1 or D6 behavior.

## Discard / Quarantine Candidates

- `.DS_Store`, `.tools/`, `node_modules/`, duplicated root `ui-regression-check.mjs`, and stale screenshots.
- Existing generated copies whose timestamps disagree with the snapshot or source registry.
- Heuristic price output presented as resale prediction, category-only exploration-task attachment, and tests that assert frozen D6-B/C behavior.

## Known Recovery Findings

- Real LLM execution is unconfirmed; current product theses and overview are heuristic.
- The old snapshot registry summary and `data/source-registry.json` disagree.
- Most heuristic price theses collapse to the same value and are not valid resale predictions.
- The old working copy attached unrelated exploration tasks by category fallback; recovery requires exact product-name or explicit brand/series affinity.
- The old working copy had an undefined `learning` reference in `buildPredictedPriceSnapshots`; recovery commit `36a2b4d` resolves it without changing price eligibility.
