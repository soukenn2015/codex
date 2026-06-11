# Codex日本語ヘッダー運用

MarketLensに関するCodex返答とGrok監督ランナーの`codex-input.txt`は、repo rootの`AGENTS.md`にある「Codex返答冒頭ルール」に従う。

監督タスクは、必要に応じてタスクJSONへ次の運用メタデータを指定する。

- `current_location`
- `overall_progress`
- `scope_progress`
- `limit_status`
- `recommended_model`
- `token_policy`
- `read_targets`
- `do_not_read`
- `risk_level`
- `marketlens_body_change`

Codexがrepo状態と今回依頼を判断してこれらをタスク入力へ設定する。ランナーは値を推測せず、短い日本語ヘッダーとして表示・保存するだけにする。未指定項目は「未指定」「未提示」または「据え置き」と表示する。

`.ai-ops/STATUS.json`はCodexが判断時に参照する状態記録であり、ランナーの実行制御や必須入力には使わない。過去の例文の進度数値を流用しない。

制限情報が未提示なら`limit_status`は「未提示」とする。残量と増減ptの解釈・計算はCodexが行い、完成した短い文字列を渡す。

通常の確認対象は`codex-input.txt`、`metrics.json`、diff stat、必要な限定diffだけとする。Grok生ログ、thought、TUI全文、成功テストログ、stderr全文、diff全文、GrokセッションJSONLを通常入力へ含めない。

## モデルと消費ペース

モデル選択は「最安」ではなく、5時間で約30往復、平均約3pt以内を維持しながら完成速度と事故防止を最大化するために行う。

| 作業 | 推奨モデル | 採用・自走 |
|---|---|---|
| metrics、diff stat、定型PASS、ヘッダー確認 | Codex 5.4 low | 自走可、採用判断不可 |
| 文書、運用md、1〜2ファイル限定レビュー | Codex 5.4 medium | 自走可、本体採用不可 |
| Grok指示、圧縮報告、小diff | Codex 5.5 low | 危険領域なしなら自走可 |
| 実装採用、複数ファイル、監督ランナー実動作、中リスク | Codex 5.5 medium | 採用判断後に自走可 |
| 価格、public、AI、保存、collect/postprocess、原因不明障害、セキュリティ | Codex 5.5 high | 危険領域専用、停止条件付き |
| 5.5 medium/highが使えない限定レビュー | Codex 5.4 xhigh | 例外のみ、常用不可 |

軽い作業は0〜1pt、標準作業は1〜3pt、重い判断は3〜6ptを目安とする。戻せる作業は軽くし、概念汚染・漏洩・保存事故につながる作業は重くする。ランナーはモデルを推測せず、Codexが決めた`recommended_model`と`token_policy`を表示・保存するだけとする。
