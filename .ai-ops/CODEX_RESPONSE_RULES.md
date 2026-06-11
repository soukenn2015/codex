# Codex日本語ヘッダー運用

MarketLensに関するCodex返答とGrok監督ランナーの`codex-input.txt`は、repo rootの`AGENTS.md`にある「Codex返答冒頭ルール」に従う。

監督タスクは、必要に応じてタスクJSONへ次の運用メタデータを指定する。

- `current_location`
- `overall_progress`
- `scope_progress`
- `limit_status`、または週制限・5時間制限の前後値
- `recommended_model`
- `token_policy`
- `read_targets`
- `do_not_read`
- `risk_level`
- `marketlens_body_change`

未指定時もランナーは安全な既定値で日本語ヘッダーを生成する。これらの値は`codex-input.txt`の先頭、`result.json`、`metrics.json`へ記録する。

現在地と全体進度の既定値はコードへ固定せず、Codexがrepo状態を判断して更新する`.ai-ops/STATUS.json`から読む。今回進度はタスク内容から判断して指定し、指定がなければ据え置きとする。過去の例文の進度数値を流用しない。

制限情報が未提示なら`limit_status`は「未提示」とする。前後値を記録する場合は`weekly_limit_before`、`weekly_limit_after`、`five_hour_limit_before`、`five_hour_limit_after`を残量%として指定し、ランナーが減少ptを計算する。

通常の確認対象は`codex-input.txt`、`metrics.json`、diff stat、必要な限定diffだけとする。Grok生ログ、thought、TUI全文、成功テストログ、stderr全文、diff全文、GrokセッションJSONLを通常入力へ含めない。
