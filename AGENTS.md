# MarketLens Agent Rules

> プロダクト方針の正本: `docs/PRODUCT_DIRECTION.md`
> 技術コンテキスト: `AI_CONTEXT.md`
> 本ファイルと上記が矛盾する場合、PRODUCT_DIRECTION.md が優先される。

## Required behavior

- Read `docs/PRODUCT_DIRECTION.md` and `AI_CONTEXT.md` before changing code.
- Do not commit, push, merge, rebase, reset, clean, checkout files, or synchronize another worktree.
- Do not edit generated JSON (`data/*.json`), credentials, environment files, or API keys.
- Do not run collectors or data regeneration unless the task explicitly allows them.
- Preserve unrelated user changes.
- Finish with a concise list of changed files and verification results.

## パイプライン安全ルール

- raw `browser_observed_candidate` / `jpyCandidate` を `priceSnapshots` に直接入れない
- `data/*.json` を手編集しない（collect/cycle で生成）
- USD を JPY に機械置換しない
- `.env` / secrets / API キーを読まない・出力しない

## 情報源の優先順位

公式 > 実売データ > X > ブログ/ニュース

## 新チャットでの推奨順

1. `docs/PRODUCT_DIRECTION.md` を読む
2. `AI_CONTEXT.md` を読む
3. 対象領域を探索する
4. 実装
5. browser か Playwright で UI を確認する

## MCP / Skills 運用

必要になったものだけ使う。全部一度に読まない。

| 種類 | 名前 | 使い時 |
|------|------|--------|
| MCP | GitNexus | 実装前の探索と impact 分析 |
| MCP | browser | UI表示確認 |
| Skill | playwright | UI再現確認（browserで足りない時） |
| Skill | domain-modeling | 用語を固定したい時 |
| Skill | diagnosing-bugs | 原因不明のバグ調査 |
