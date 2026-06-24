# CODEX_MCP_RULES

## Purpose
This project uses ChatGPT as a review, planning, and handoff assistant for Codex. Codex remains responsible for implementation work. This file defines the operating rules Codex should follow when changing this repository.

## Required startup checks
Before making changes, read the current project state rather than relying on memory.

Minimum checks:

```bash
git status --short
git diff --stat
```

Then inspect only the files relevant to the requested change. Do not read secrets, `.env`, credentials, API keys, `.ssh`, or production-only configuration.

Recommended files to inspect when relevant:

- `README.md`
- `CODEX_MCP_RULES.md`
- `CODEX_HANDOFF.md`
- `scripts/collect-marketlens.mjs`
- `scripts/postprocess-marketlens-snapshot.mjs`
- `script.js`
- `styles.css`
- `data/marketlens.snapshot.json` by summary/counts only, not by dumping large content
- `scripts/regression-check.mjs`
- `scripts/ui-regression-check.mjs`

## Change discipline
Prefer small, reviewable changes. Do not combine unrelated refactors, data regeneration, UI redesign, and collector logic changes unless explicitly requested.

When changing generated JSON data, summarize counts and meaning. Do not rely on massive JSON diffs as the explanation.

Avoid broad rewrites of:

- collector pipeline
- UI rendering architecture
- source registry logic
- pricing and BuyLine calculations
- route verification
- OpenAI/API key handling

unless the task explicitly requires it.

## AI / deterministic boundary
LLM may help with:

- product name extraction
- event classification
- direct-link selection assistance
- price-word extraction
- reason text material
- overview narrative generation

LLM must not own:

- profit calculation
- fees and shipping
- BuyLine calculation
- final layer promotion/demotion
- link liveness checks
- verified route replacement
- verified price replacement

Verified route and verified price always take precedence over LLM-generated explanation. LLM text is supplemental when real route or real price data exists.

## MarketLens vNext invariants
Keep these UI/data invariants unless explicitly asked to change them:

- The four layers remain: `今すぐ見る`, `近日チェック`, `先読みメモ`, `保留・除外`.
- `overviewNarrative` remains a single natural-language summary block.
- Do not return to multiple section-style summary rows.
- Do not restore old regular-display sections such as `急上昇`, `AI検証ボード`, `今日見るもの`, or `利益候補` as primary UI sections.
- Attention remains a 5-level color system:
  - 5: green
  - 4: blue
  - 3: amber
  - 2: red-orange
  - 1: slate
- Profit estimate remains visually fixed at the left edge where currently designed.
- Generic routes must not appear in `今すぐ見る`.

## Noise filtering requirements
Do not allow site chrome, navigation, or explanatory copy to become product/event/route/reason candidates.

Known rejected phrases include, but are not limited to:

- `一番くじ情報サイト`
- `店舗検索`
- `キャラクター一覧`
- `ブランド一覧`
- `商品検索`
- `language 日本語 English`
- `発売されます`
- `一番くじでしか手に入らない`
- `最後の1個を引くと手に入る`
- `くじの残り数は店舗でご確認`
- `illustration by`
- `商品説明を見る`
- `物語の主人公`
- `作品に欠かせない`
- `一番くじフィギュアブランド`
- `ドラゴンクエストとは タイトル一覧`
- repeated broken strings such as `ワンピースースース...`

After noise-filter changes, verify that the rejected phrases do not remain in:

- `normalizedProducts`
- `productEvents`
- `routeSnapshots`
- `selectionReasons`
- `discoveryCandidates`

## OpenAI / real LLM verification
Do not assume AI is working just because AI-like fields exist.

A real LLM run is only confirmed when the generated snapshot contains evidence such as:

- at least one `llmExtractions[].mode === "openai"`
- `overviewNarrative.sourceMode === "openai"`

If fallback occurs, record or expose the fallback reason where practical. Check for:

- missing `OPENAI_API_KEY`
- invalid model name
- response parse failure
- schema mismatch
- timeout
- rate limit
- `llmExtractionDocLimit` reached
- OpenAI request path not executed

Never read or print API keys. Use environment variables only.

## Verification commands
For syntax and lightweight regression checks:

```bash
node --check scripts/collect-marketlens.mjs
node --check scripts/postprocess-marketlens-snapshot.mjs
node scripts/regression-check.mjs
node scripts/ui-regression-check.mjs
```

For full API-key-enabled verification, when explicitly requested and when an environment variable is provided:

```bash
OPENAI_API_KEY=... node scripts/run-marketlens-cycle.mjs
node scripts/regression-check.mjs
node scripts/ui-regression-check.mjs
```

Do not put the API key in files. Do not echo the key.

## Required handoff
After every implementation pass, update `CODEX_HANDOFF.md` with:

- summary
- changed files
- purpose
- what changed
- what was not done
- verification commands and results
- data count changes, if JSON/snapshot changed
- risks
- next steps
- files the next agent should read

This handoff is mandatory because this repository often produces large JSON diffs that are not reviewable by inspection alone.
