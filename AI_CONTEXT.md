# AI_CONTEXT — MarketLens 技術コンテキスト

最終更新: 2026-06-22

> プロダクト方針の正本は `docs/PRODUCT_DIRECTION.md`。本ファイルと矛盾する場合、PRODUCT_DIRECTION が優先される。

## プロジェクト概要

MarketLens はホビー転売向けの AI ドリブン商品探索サイト。モバイルファースト、ダーク一択、2タブ構成（俯瞰/商品）。

## コアパイプライン

| # | ファイル | 用途 |
|---|---------|------|
| 1 | `scripts/collect-marketlens.mjs` | ソース収集・正規化・AI処理 |
| 2 | `scripts/postprocess-marketlens-snapshot.mjs` | snapshot 後処理 |
| 3 | `scripts/run-marketlens-cycle.mjs` | collect → postprocess → digest |
| 4 | `data/marketlens.snapshot.json` | 単一のランタイム正本データ |
| 5 | `index.html` + `script.js` + `styles.css` | 静的 UI（書き直し対象） |

## 情報源の優先順位

公式 > 実売データ > X > ブログ/ニュース

## 利益表示ルール

- 確実（実売データ基づき）→ 緑
- 不確実（AI予測、データ少）→ 黄
- UIラベルに制限なし。分かりやすさ優先

## 技術的な安全ルール（パイプライン側）

1. `browser_observed_candidate` / `jpyCandidate` は「売却参考候補」であり、利益計算の確定値には使わない
2. `priceSnapshots` への書き込みは検証済みデータのみ
3. `data/*.json` を手編集しない（collect/cycle で生成）
4. `.env` / secrets / API キー / credentials を読まない・出力しない
5. USD を JPY に機械置換しない

## Gemini AI

- provider: `gemini`（gemini-3.1-flash-lite / gemini-2.5-flash / pro級）
- 月間予算内自動切替
- AI は商品同定、グルーピング、イベント分類、Tier判定、理由生成、不確実性整理を担当

## 主要スクリプト

| スクリプト | 用途 |
|-----------|------|
| `scripts/run-marketlens-cycle.mjs` | フルサイクル実行 |
| `scripts/marketlens-product-groups.mjs` | 商品群スキーマ・AI判断契約 |
| `scripts/marketlens-observation.mjs` | 観測レイヤー共通 |
| `scripts/regression-check.mjs` | データ回帰テスト |
| `scripts/ui-regression-check.mjs` | UI回帰テスト |
| `scripts/marketlens-status.mjs` | メトリクス出力 |

## 検証コマンド

```bash
node scripts/run-marketlens-cycle.mjs
node scripts/regression-check.mjs
node scripts/ui-regression-check.mjs
```

## アーカイブ

旧い詳細設計・調査メモは `docs/archive/` に移動済み:
- `AI_CONTEXT-full-2026-06-21.md` — 旧フル版
- `TASK-price-investigation-2026-06.md` — 価格昇格・JPY調査
- `GROK_HANDOFF.md` — Grok引き継ぎ
- `WORKLOG.md` — 時系列ログ
- `CODEX_MCP_RULES.md` — 旧Codex作業規約
