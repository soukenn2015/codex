# MarketLens

ホビー転売向けのAIドリブン商品探索サイト。モバイルファースト、ダーク一択。

## 方針

プロダクト方針書: [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md)

## 起動

```bash
# データ収集
node scripts/collect-marketlens.mjs

# フルサイクル（collect → postprocess → digest）
node scripts/run-marketlens-cycle.mjs

# 回帰テスト
node scripts/regression-check.mjs
node scripts/ui-regression-check.mjs
```

## 構成

```
index.html + script.js + styles.css  — UI（書き直し予定）
scripts/*.mjs                        — データパイプライン
data/marketlens.snapshot.json        — ランタイム正本データ
docs/PRODUCT_DIRECTION.md            — プロダクト方針（正本）
```

## デプロイ

GitHub Pages。`.github/workflows/deploy-pages.yml` で自動デプロイ。
1日4回（6時間ごと）GitHub Actions が collector を実行してデータ更新。

公開URL: `https://soukenn2015.github.io/codex/`

## 技術スタック

- vanilla HTML/CSS/JS（ビルドツールなし）
- Node.js（データパイプライン）
- Gemini AI（商品分析・理由生成）
- Jina Reader + Playwright（データ取得）
