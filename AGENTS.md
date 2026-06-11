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
- 返答末尾には毎回必ず次の2行を書く。

```text
次に使うモデル:
* 【モデル名】
* 理由: 【1文】
```

## Codex裁量モデル選択ルール

- Codex 5.4 low: metrics、ログサイズ、diff stat、ヘッダー、定型PASSなどの単純確認。最軽量で自走可だが、実装採用判断には使わない。
- Codex 5.4 medium: 文書、`AGENTS.md`、`.ai-ops`運用文書の軽微修正、1〜2ファイルの限定レビュー。自走可だが、危険領域や本体採用判断には使わない。
- Codex 5.5 low: Grokへの次スコープ指示、圧縮報告、小さいdiff、軽いPASS確認。標準の軽量枠として自走可。危険領域に入れば昇格する。
- Codex 5.5 medium: 実装採用、複数ファイル、`.ai-ops`実動作変更、商品取得・リンク同定・UI分類などの中リスク確認。条件付き自走とし、毎回常用しない。
- Codex 5.5 high寄り: 価格、BuyLine、`priceSnapshots`、`observed_market_price`、`jpyCandidate`、`browser_observed_candidate`、public公開、AI統合、保存仕様、collect/postprocess、セキュリティ、原因不明障害。危険領域専用で連発せず、原則停止条件を置く。
- Codex 5.4 xhigh: 原則使わない。5.5 medium/highを使えず、5.4 low/mediumでは不安な限定レビューの代替だけにする。消費抑制目的では常用しない。
- PASS、小diff、危険領域なし、FINDINGS/RISKSが軽微なら自走可。中リスクは5.5 mediumで採用判断後に自走を続ける。危険領域は自走不可または停止条件付きとする。
- MarketLens本体の小さいUI・文言変更はGrok実装と5.5 low確認で進め、採用判断が必要なら5.5 mediumへ上げる。商品取得・リンク同定・候補追加導線はGrok実装後に5.5 mediumで採用判断する。
- BLOCKED、原因不明、テスト失敗は5.5 medium以上とし、必要時だけ5.5 highへ上げる。
- モデル選択に迷う場合は失敗コストで決める。容易に戻せる作業は軽くし、概念汚染、漏洩、保存事故につながる作業は重くする。
- ユーザーがモデルを指定した場合は優先する。モデルを重くした理由、または消費ペース維持のため軽くした理由は本文に1文だけ書く。

## 5時間30往復の運用基準

- 5時間制限は1往復平均約3pt以内を目安とし、軽い往復を5.4 low/5.5 lowへ寄せて重い判断の予算を確保する。
- 5.5 mediumは採用判断、中リスク、複数ファイルに限定する。5.5 highは危険領域専用とし、連続使用を避ける。
- Grokに実装を委任し、Codexは`codex-input.txt`、`metrics.json`、`git diff --stat`、`git diff --shortstat`、必要な限定diffを読む。
- 生ログ、thought、TUI全文、成功ログ全文、stderr全文、diff全文、GrokセッションJSONLは読まない。
- 現在の残量はヘッダーで都度扱い、恒久ルールへ固定しない。残量低下時も危険領域の判断品質は下げない。
- 5.4で足りる作業は積極的に5.4を使う。ただし危険領域、本体採用判断、公開・保存事故につながる作業は軽量化理由だけで落とさない。
