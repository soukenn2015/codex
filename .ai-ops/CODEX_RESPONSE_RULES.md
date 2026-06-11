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
