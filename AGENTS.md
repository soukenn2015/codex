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

## Codex返答冒頭ルール

MarketLensに関するCodexの返答は、本文より前に必ず次の短縮ヘッダーを表示する。ラベルの英語化、省略、進度の幅表示は禁止する。

```text
【MarketLens 状態】

現在地:
進度:
今回の扱い:
次回方針:
読むべき注意:
本体変更:
```

- 現在地は、ユーザーが読む必要のある大枠だけを書く。細かい階層番号や内部フェーズ名は原則書かない。
- 進度は、全体進度と今回スコープの変化を短く書く。変化がなければ据え置きとする。
- 今回の扱いは`軽め`、`標準`、`慎重`のいずれかとする。
- 次回方針は`自走可`、`要確認`、`停止`のいずれかとし、危険領域やdiff規模、FINDINGS/RISKSの有無で決める。
- 読むべき注意は、ユーザーが読むべきリスクだけを書く。なければ`なし`とする。
- 本体変更は、MarketLens製品コードへ触る場合だけ`あり`とし、それ以外は`なし`とする。
- 現在地と進度は、ユーザーの例文や過去の固定値を流用せず、repo内の状態、`.ai-ops/STATUS.json`、直近の変更、git状態、今回依頼からCodexが毎回判断する。
- 危険領域、停止条件、制限情報、確認対象、読まないものなどの詳細は、必要なときだけ本文または運用文書へ回す。
- ユーザーが単独で`はい`と返した場合は、直前に提案または保留していた安全な次の作業を承認して先へ進める合図として扱う。
- ユーザーから強い指示や恒久化すべき運用指示が出た場合は、忘れないように`md`へ書き残す。
- Codexは常に大局観を持って行動し、その場しのぎではなく、今どの層を進めるべきかを意識して判断する。
- 返答末尾の`次に使うモデル`は、`【モデル名 / reasoning effort】`の形で書き、理由を1文で添える。
- 返答末尾には毎回必ず次の2行を書く。

```text
次に使うモデル:
* 【モデル名】
* 理由: 【1文】
```

## Codex裁量モデル選択ルール

- Codex 5.4 mini low: 最軽量確認。`metrics`、diff stat、定型PASS、ヘッダー確認、短いmd確認。
- Codex 5.4 mini medium: 軽い判断。Cursor返答の軽確認、短いCursor指示、`AGENTS.md` / `.ai-ops` mdの軽微修正。
- Codex 5.4 mini high: 軽量深掘り。md矛盾確認、限定diffの意味確認、Cursor返答の怪しさ確認。
- Codex 5.4 mini xhigh: mini枠の最大深掘り。5.5を使う前の一次調査、本体に触らない運用ルール精査、原因候補整理、限定された非危険領域の深掘り。
- Codex 5.4 low / medium / high: miniより安定した軽量レビュー。docs整理、1〜2ファイル限定レビュー、運用md確認。
- Codex 5.4 xhigh: 5.5を温存したい時の深掘り代替。非危険領域の限定レビュー、md矛盾、原因候補整理に限る。
- Codex 5.5 low: 賢さを使う軽量判断。Cursorへの実装指示、軽い採用判断、小さい本体変更確認。
- Codex 5.5 medium: 標準の判断枠。実装採用判断、複数ファイル確認、商品取得、UI分類、`.ai-ops`実動作変更。
- Codex 5.5 high / xhigh: 危険領域・重大事故防止。価格、BuyLine、`priceSnapshots`、`observed_market_price`、`jpyCandidate`、`browser_observed_candidate`、public公開、AI統合、保存仕様、collect/postprocess、原因不明障害、セキュリティ。
- 5.4 mini xhigh は深掘り用であり、5.5 medium/high の最終採用判断の代替にしない。
- 5.4 は軽量レビュー枠、5.5 は設計判断・採用判断・中高リスク作業の本命として扱う。
- 5.5 high / xhigh は危険領域と重大事故防止に限定し、xhigh は 5.5 high でも判断が不安な時だけ使う。
- 軽い往復は 5.4 mini low/medium へ逃がし、重要判断に 5.5 を残す。mini high/xhigh は 5.5 を使う前の調査用に使う。
- 最終採用判断は原則 5.5 low / medium 以上。危険領域は 5.5 high 以上。
- PASS、小diff、危険領域なし、FINDINGS/RISKS が軽微なら自走可。中リスクは 5.5 medium で採用判断後に自走を続ける。危険領域は自走不可または停止条件付きとする。
- モデル選択に迷う場合は失敗コストで決める。容易に戻せる作業は軽くし、概念汚染、漏洩、保存事故につながる作業は重くする。
- ユーザーがモデルを指定した場合は優先する。モデルを重くした理由、または消費ペース維持のため軽くした理由は本文に 1 文だけ書く。

## 50往復運用基準

- 5時間で 50 往復を目標にし、軽い往復を 5.4 mini low / medium へ寄せて重い判断の予算を確保する。
- 5.5 medium は採用判断、中リスク、複数ファイルに限定する。5.5 high / xhigh は危険領域専用とし、連続使用を避ける。
- Cursor に実装を委任し、Codex は `codex-input.txt`、`metrics.json`、`git diff --stat`、`git diff --shortstat`、必要な限定diffを読む。
- 生ログ、thought、TUI全文、成功ログ全文、stderr全文、diff全文、GrokセッションJSONLは読まない。
- 現在の残量はヘッダーで都度扱い、恒久ルールへ固定しない。残量低下時も危険領域の判断品質は下げない。
- 5.4 mini で足りる作業は積極的に 5.4 mini を使う。ただし危険領域、本体採用判断、公開・保存事故につながる作業は軽量化理由だけで落とさない。
