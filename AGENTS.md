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

MarketLensに関するCodexの返答は、本文より前に必ず次の日本語ヘッダーを表示する。ラベルの英語化、省略、進度の幅表示は禁止する。

```text
【MarketLens 現在地】

現在地:
全体進度:
今回進度:
制限状況:
今回の目的:
推奨モデル:
トークン方針:
確認対象:
読まないもの:
危険度:
本体変更:
```

- 全体進度は単一の整数%で表示し、根拠が弱い場合は「推定」と明記する。
- 現在地・全体進度・今回進度は、ユーザーの例文や過去の固定値を流用せず、repo内の状態、`.ai-ops/STATUS.json`、直近の変更、git状態、今回依頼からCodexが毎回判断する。
- 今回進度は原則として「対象スコープ A% → B%」と「全体進度 A% → B%」を表示する。変化しない場合は「据え置き」とする。
- 運用整備だけで全体進度を大きく上げない。進度を変えた場合は本文で理由を1文だけ説明する。
- 制限情報がない場合は「未提示」とする。ユーザーが「現在 A,B / 実装後 C,D」と示した場合、左を週制限、右を5時間制限の残量として「週制限 A% → C%」「5時間制限 B% → D%」と減少ptを表示する。
- Grokへの指示作成と圧縮結果確認はCodex 5.5 lowを基本とする。実装採用、複数ファイル確認、`.ai-ops`挙動変更はCodex 5.5 mediumを基本とする。
- 価格、BuyLine、snapshot、public公開、AI統合、保存仕様、collect/postprocess、原因不明障害はCodex 5.5 high寄りへ上げる。5.5 low固定と毎回5.5 highの両方を禁止する。
- 5.4 mediumは範囲限定レビューや文書確認の節約枠、5.4 xhighは5.5 medium/highを使えない場合の代替に限る。
- トークン方針は「軽め」「標準」「慎重」のいずれかとし、危険度と対象領域に合わせる。
- 優先して読むものは`codex-input.txt`、`metrics.json`、必要時の`result.json`、`git diff --stat`、`git diff --shortstat`、必要なパスだけの限定diffとする。
- Grok生ログ、thought、TUI全文、成功テストログ、stderr全文、diff全文、GrokセッションJSONLは原則読まない。`STATUS: BLOCKED`または同一失敗2回目だけ、圧縮されたエラー末尾の拡張を許可する。
- 「本体変更」は、商品取得、UI、価格、AI、public公開、collect/postprocessなどMarketLens製品コードへ触るかを「あり」「なし」で明示する。

## Codex裁量モデル選択ルール

- Grokへの通常の指示作成はCodex 5.5 low。価格、public公開、AI、保存仕様を含む指示は5.5 medium以上へ上げる。
- 圧縮報告、metrics、diff stat、変更なしPASSの単純確認はCodex 5.4 lowまたは5.5 low。
- 実装採用、複数ファイル、FINDINGSあり、`.ai-ops`挙動変更、商品取得・UI分類・文書整合はCodex 5.5 medium。
- 価格、BuyLine、`priceSnapshots`、`observed_market_price`、`jpyCandidate`、`browser_observed_candidate`、public公開、AI統合・判断・要約、collect/postprocess、保存仕様、セキュリティ、原因不明障害はCodex 5.5 high寄り。残量だけを理由にlowへ落とさない。
- Codex 5.4 mediumは文書確認、`.ai-ops`小修正、1〜2ファイルの範囲限定レビューに使う。5.4 xhighは5.5 medium/highを使えない場合だけにする。
- 制限がどちらも70%以上なら通常、どちらか50〜69%ならやや節約、30〜49%なら強めに節約、30%未満なら極力節約とする。ただし危険領域の品質を下げない。
- 1回で週制限または5時間制限が5pt以上減った場合、次回は少なくとも「やや節約」とし、5.5 mediumは採用判断へ限定する。
- ユーザーがモデルを指定した場合は優先する。迷う場合は5.5 medium、明らかな単純確認は5.4 lowを選ぶ。
- 危険領域でmedium/highへ上げる場合、または制限節約でモデルを下げる場合は、理由を本文に1文だけ書く。
