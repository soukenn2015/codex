# Codex日本語ヘッダー運用

MarketLensに関するCodex返答とGrok監督ランナーの`codex-input.txt`は、repo rootの`AGENTS.md`にある「Codex返答冒頭ルール」に従う。

監督タスクは、必要に応じてタスクJSONへ次の運用メタデータを指定する。

- `current_location`
- `overall_progress`
- `scope_progress`
- `recommended_model`
- `token_policy`
- `read_targets`
- `do_not_read`
- `risk_level`
- `marketlens_body_change`

未指定時もランナーは安全な既定値で日本語ヘッダーを生成する。これらの値は`codex-input.txt`の先頭、`result.json`、`metrics.json`へ記録する。

通常の確認対象は`codex-input.txt`、`metrics.json`、diff stat、必要な限定diffだけとする。Grok生ログ、thought、TUI全文、成功テストログ、stderr全文、diff全文、GrokセッションJSONLを通常入力へ含めない。
