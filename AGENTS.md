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

- Never project raw `jpyCandidate` or `browser_observed_candidate` directly into `priceSnapshots`, `observed_market_price`, or BuyLine.
- Only gated, promoted `observed_market_price` may enter `priceSnapshots` and BuyLine.
- Observation data must keep `buyLineEligible: false`.
- Do not bypass the promotion gate or weaken the BuyLine source-order rules.
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

## MCP / Skills 運用

新チャットで最初に全部使うのではなく、役割ごとに使い分ける。

### 先に使うもの

- **Memory**: まず過去の方針を再確認する。商品群主役、利益最優先、抽選終了 / 販売開始重視、公式 > X > ブログ/ニュースの順を取り違えないため
- **GitNexus**: 実装前の探索と impact 分析に使う。関数・メソッド変更前は必ず blast radius を確認する

### 実装中に使うもの

- **browser:control-in-app-browser**: `http://127.0.0.1:18765/` などの現表示確認に使う。見た目・文言・導線確認を優先し、長時間の手動監視には使わない
- **playwright / playwright-interactive**: UI の再現確認や操作再現が必要な時だけ使う。まず in-app browser で足りるかを確認してから使う
- **mattpocock-skills:domain-modeling**: 商品群、イベント、Tier、理由、uncertainty などの用語をぶらさず定義したい時に使う
- **mattpocock-skills:diagnosing-bugs**: 原因不明の壊れ方、回帰落ち、実行フロー不整合の調査時に使う

### 原則使わないもの

- Figma / Canva / documents / presentations / spreadsheets 系: 今回の MarketLens 実装では通常不要
- OpenAI docs / Agents SDK / plugin-creator 系: OpenAI 製品実装や外部連携を明示的に進める時だけ使う
- GitHub / Linear 系: PR、issue、CI、外部管理が必要になった時だけ使う

### 新チャットでの推奨順

1. `AI_CONTEXT.md` / `TASK.md` / `.ai-ops/BASELINE.md` を読む
2. Memory で直近方針を再確認する
3. GitNexus で対象領域を探索する
4. 必要なら domain-modeling で語彙を固定する
5. 実装
6. browser か Playwright で UI を確認する

### 注意

- skill は多いが、**必要になったものだけ読む**
- UI 確認は browser 優先、Playwright は必要時だけ
- 設計用 skill を読んでも、価格 safety や BuyLine safety を AI 側へ移さない
- handoff はユーザーが明示した時だけ作る

## 現在の道具棚

新チャットで混乱しないように、MarketLens での扱いを固定する。

### 常用

| 種類 | 名前 | 扱い | 役割 |
|------|------|------|------|
| 本体 | Codex desktop / Codex CLI | 使用 | 主作業の本体。通常はこのスレッドと repo 内 shell を使う |
| MCP | GitNexus | 使用 | repo 構造、依存、impact、execution flow の確認 |
| MCP | codex_apps / browser / workspace / shell | 使用 | in-app browser、workspace shell、アプリ内確認 |
| MCP | node_repl | 使用 | JS 実行、補助スクリプト、必要時の browser 連携 |
| Skill | domain-modeling | 使用 | 商品群、イベント、Tier、理由、uncertainty の語彙固定 |
| Skill | diagnosing-bugs | 使用 | 原因不明の回帰や壊れ方の調査 |

### 条件付きで使う

| 種類 | 名前 | 扱い | 役割 |
|------|------|------|------|
| MCP | context7 | 条件付き | ライブラリや SDK の最新 docs が必要な時だけ使う |
| MCP | exa | 条件付き | Web 検索や URL 収集が必要な時だけ使う |
| MCP | chrome-devtools | 条件付き | Chrome の console、network、page 状態確認が必要な時だけ使う |
| Skill | caveman | 条件付き | 発想拡張、別視点出し、粗い代替案出しに使う。正本判断や安全境界の最終採用判断は任せない |
| Skill | grill-me | 条件付き | 実装前に仕様や設計の穴を詰めたい時だけ使う |
| Skill | tdd | 条件付き | テスト先行で進める時だけ使う |
| Skill | handoff | 条件付き | ユーザーが明示的に引き継ぎを求めた時だけ使う |
| Skill | playwright / playwright-interactive | 条件付き | in-app browser で足りない UI 再現、E2E、操作再現が必要な時だけ使う |

### 原則後回し

| 種類 | 名前 | 扱い | 理由 |
|------|------|------|------|
| MCP | openai-api-key-local-confirmation | 後回し | OpenAI key のローカル確認が必要な時だけ。MarketLens の通常実装では優先しない |
| MCP / Skill | GitHub / Linear 系 | 後回し | PR、issue、CI、外部ワークフローが必要な時だけ |
| Skill | Figma / Canva / documents / presentations / spreadsheets | 後回し | 今回の MarketLens 本体実装では通常不要 |

### 現時点で前提にしないもの

| 名前 | 扱い | メモ |
|------|------|------|
| firecrawl | 未導入前提 | 必要になったら後で追加検討 |
| browsermcp | 不採用 | ログイン済みブラウザ依存が強く、通常運用では避ける |
| serena | 後回し | GitNexus を優先する |
| superpowers | 後回し | 重いので必要になるまで入れない |

### 明示修正

- `playwright` は **未導入扱いにしない**。この環境では利用可能だが、常用ではなく条件付き
- `caveman` は **未導入扱いにしない**。導入済み前提だが、補助発想用であり、最終判断や安全境界の採用主体にはしない
- `exa` や一部 app 連携は常時前面に出さず、必要時だけ lazy に使う
- 道具の有無よりも、**どの順で使うか**を優先する

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **codex** (2178 symbols, 6246 relationships, 194 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/codex/context` | Codebase overview, check index freshness |
| `gitnexus://repo/codex/clusters` | All functional areas |
| `gitnexus://repo/codex/processes` | All execution flows |
| `gitnexus://repo/codex/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
