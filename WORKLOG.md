# WORKLOG — MarketLens 主要作業ログ

時系列の要約のみ。詳細は `GROK_HANDOFF.md` / `CODEX_HANDOFF.md` を参照。

---

## 2026-06-03 頃 — プロジェクト基盤

- MarketLens 静的 UI（`index.html`, `script.js`, `styles.css`）確立
- `scripts/collect-marketlens.mjs` によるソース収集・snapshot 生成
- 四層 UI（今すぐ見る / 近日チェック / 先読みメモ / 保留・除外）維持

---

## 2026-06-05 — Codex: baseline + Gemini 経路

- `CODEX_MCP_RULES.md` / `CODEX_HANDOFF.md` 追加（作業規約・引き継ぎテンプレ）
- `priceSourceRank` / `candidateState` / `buyLineEligible` を collector + postprocess に導入
- Gemini provider 経路追加（`MARKETLENS_AI_PROVIDER=gemini`）
- `metadata.llmExecution` で fallback 理由可視化（`gemini_api_key_missing` 等）
- `scripts/gemini-smoke-test.mjs` 追加（full crawl なし疎通確認）
- movie_goods 2件を raw archive 補完で live 化（movie_bonus は 0 のまま）

---

## 2026-06-05〜06 — 観測レイヤー基盤

- `scripts/marketlens-observation.mjs` — 観測レイヤー共通モジュール
- `marketplaceResearchTargets` 構築（mercari / yahoo_fleamarket 検索 URL）
- 禁止ラベルサニタイズ（メルカリ相場 → メルカリ確認待ち 等）
- `scripts/regression-check.mjs` / `ui-regression-check.mjs` 拡張

---

## 2026-06-06〜07 — marketplaceResearchTargets 拡張

| 段階 | subjects 上限 | targets 件数 |
|------|--------------|-------------|
| 初期 | 100 | 200 |
| 拡張1 | 200 | 400 |
| 検討 | 300 | 600（未着手） |

- `MARKETLENS_MARKETPLACE_SUBJECT_LIMIT` で制御
- クエリ品質ゲート（`query_too_generic`, `query_not_concrete`, `query_mojibake` 等）

---

## 2026-06-07〜08 — X Reader

- `scripts/marketlens-x-reader.mjs` 追加
- `xObservationQueue` — raw archive から X status URL 候補をキューイング
- Jina Reader で markdown 取得・engagement パース（未観測: pending 135）
- `socialSignals` は reader 観測後に蓄積（現状 0）

---

## 2026-06-08 — Yahoo!リアルタイム browser 観測

- `scripts/marketlens-yahoo-realtime-reader.mjs` 追加
- `realtimeResearchTargets` 200件 + `socialSearchSignals` 8件
- `browserObservationQueue` — login_required 等で skip 理由を記録
- BuyLine 未使用・badge_eligible confidence 分布

---

## 2026-06-08〜09 — Mercari browser_observed_candidate 蓄積

### Phase 1: 最小観測（LIMIT=3）

- `scripts/marketlens-mercari-reader.mjs` 新規
- メルカリ検索一覧のみ（Jina `X-Wait-For-Selector`）
- `marketplaceSignals` + `listingCandidates` 生成
- `priceSourceRank=browser_observed_candidate`, `buyLineEligible=false`

### Phase 2: 通貨対応（LIMIT=5）

- `currency` / `rawPriceText` / `priceParseConfidence` 追加
- UI: USD→`US$`, JPY→`¥`, unknown→生テキスト
- regression: USD を JPY 扱いしない・unknown に ¥ なし

### Phase 3: unknown 再取得 + メトリクス強化

- `signalNeedsCurrencyRecheck()` — 旧 unknown signal を再取得対象
- キュー `recheck_unknown_currency` 優先
- `countObservationMetrics` に通貨分布・recheck 統計追加
- `scripts/marketlens-status.mjs` 新規

### 蓄積結果（2026-06-09）

| 指標 | 値 |
|------|-----|
| marketplaceSignals | 5 → **6** |
| listingCandidates | 40 → **48** |
| 通貨 | unknown 16 → **USD 48**（recheck 2件成功） |
| 混入 | priceSnapshots / BuyLine / observed_market_price すべて **なし** |

---

## 2026-06-09 — 固定 URL 運用確立

- **正本**: `/Users/user/Documents/Codex/2026-05-28/hobbyflip-ai-1-ai-2-box`
- **固定 URL**: `http://localhost:8765/`（`python3 -m http.server 8765`）
- worktree 開発確認: `http://127.0.0.1:8888/`（最新 snapshot 用・補助）

---

## 2026-06-09 — 引き継ぎドキュメント整備

- `AI_CONTEXT.md` — 正本・安全契約・観測レイヤー全体
- `GROK_HANDOFF.md` — Grok 直近変更・件数・次ステップ
- `WORKLOG.md`（本ファイル）— 時系列ログ

---

## 2026-06-09 — worktree → Documents 正本同期（初回 23ファイル）

- worktree 最新（signals **19** / listings **152**）を Documents 正本へ反映
- 軽量 observation cycle scripts + 観測レイヤー一式を Documents に配置
- 確認 URL 固定: `http://localhost:8765/`（Documents 配信）

---

## 2026-06-09 — 軽量蓄積（19 → 22 / 152 → 176）+ Documents 同期

- 実装変更なし。`MARKETLENS_BROWSER_OBSERVATION_LIMIT=5` で軽量 observation cycle 1回（~19s）
- marketplaceSignals **19 → 22**、listingCandidates **152 → 176**
- 安全契約維持: priceSnapshots / BuyLine / observed_market_price 混入なし、forbiddenLabel なし
- worktree → Documents へ 3ファイル `cp -p` 同期: snapshot + GROK_HANDOFF + WORKLOG
- 確認 URL: `http://localhost:8765/`（Documents 正本）

---

## 2026-06-09 — 軽量蓄積（22 → 25 / 176 → 200）+ Documents 同期

- 実装変更なし。`MARKETLENS_BROWSER_OBSERVATION_LIMIT=5` で軽量 observation cycle 1回（~40s）
- marketplaceSignals **22 → 25**、listingCandidates **176 → 200**
- marketplaceObservation: requested 3 / succeeded 3 / failed 0 / skipped 0
- 安全契約維持: priceSnapshots / BuyLine / observed_market_price 混入なし、forbiddenLabel なし
- worktree → Documents へ 3ファイル `cp -p` 同期: snapshot + GROK_HANDOFF + WORKLOG
- 確認 URL: `http://localhost:8765/`（Documents 正本）

---

## 2026-06-09 — 3サイクル連続蓄積（28 → 35 / 224 → 275）+ Documents 同期

- 実装変更なし。`MARKETLENS_BROWSER_OBSERVATION_LIMIT=5` で軽量 observation cycle **3回連続**
- 開始 28/224 → 終了 **35/275**（+7 signals / +51 listings）
- 各サイクル: requested 3 / succeeded 3 / failed 0 / skipped 0（cycle3 は delta +1/+3、重複統合の可能性）
- 安全契約維持: priceSnapshots / BuyLine / observed_market_price 混入なし、forbiddenLabel なし
- worktree → Documents へ 3ファイル `cp -p` 同期: snapshot + GROK_HANDOFF + WORKLOG
- 確認 URL: `http://localhost:8765/`（Documents 正本）

---

## 2026-06-09 — 5サイクル連続蓄積（35 → 43 / 275 → 330）+ Documents 同期

- 実装変更なし。50 signals 目標で `MARKETLENS_BROWSER_OBSERVATION_LIMIT=5` 軽量 cycle **5回連続**
- 開始 35/275 → 終了 **43/330**（+8 signals / +55 listings）、50 signals 未到達
- cycle4-5: delta 0（skipped 増加、重複統合または新規候補枯渇）
- 安全契約維持: priceSnapshots / BuyLine / observed_market_price 混入なし、forbiddenLabel なし
- worktree → Documents へ 3ファイル `cp -p` 同期: snapshot + GROK_HANDOFF + WORKLOG
- 確認 URL: `http://localhost:8765/`（Documents 正本）

---

## 2026-06-09 — 3サイクル追加蓄積（43 → 50 / 330 → 381）+ Documents 同期

- skipped/delta0 原因調査: 重複統合（同一 query key）、`already_observed` キュー整理、permanent_blocked/login_required（9件）
- 実装変更なし。3サイクル追加で **50 signals 到達**
- 開始 43/330 → 終了 **50/381**（+7 signals / +51 listings）
- 安全契約維持: priceSnapshots / BuyLine / observed_market_price 混入なし、forbiddenLabel なし
- worktree → Documents へ 3ファイル `cp -p` 同期: snapshot + GROK_HANDOFF + WORKLOG
- 確認 URL: `http://localhost:8765/`（Documents 正本）

---

## 2026-06-10 — overview 全体思想の再同期（追補）

- **範囲:** `marketlens-overview.html` / `marketlens-overview.js` 中心（10層・図・用語・メトリクス表示の古い文言一括更新）
- **追加:** 四層UIセクション、概要同期ルール、public-share公開運用、ngrok運用説明の更新
- **除去:** overview内の「参考価格候補」「買い上限」「開催中専用表示」「手で確認した価格」誤解文言
- **検証:** regression / ui-regression に概要同期・四層UIアサーション追加

## 2026-06-10 — 価格概念整理（表示・overview のみ）受け入れ

- **範囲:** `script.js` / `index.html` / `marketlens-overview.*` / regression 文言のみ
- **変更なし:** BuyLine 計算・`buyLineEligible`・価格 rank・jpyCandidate 保存・snapshot 手編集
- **確定概念:** 新品購入は人間判断 / 出口価格候補は売却側参考 / 定価は新品基準表示 / 参考ラインは判断補助
- **P1 維持:** observedMarketPrice=0 / buyLineEligibleSources=manual_price のみ / jpyCandidate BuyLine 混入 0
- **検証:** regression-check / ui-regression-check / check-public-share-http / ngrok 200・404 通過
- **ドキュメント:** `GROK_HANDOFF.md` / `AI_CONTEXT.md` / `TASK.md` に価格概念・概要同期ルールを反映
- **Documents 同期:** UI + overview + regression + 引き継ぎ Markdown を正本へ `cp -p`
- **残タスク（P1 外）:** `script.js` 静的シード説明文の旧語「相場」→ 売却参考系への軽微置換（将来）

---

## 未完了（継続トラッキング）

- [ ] Mercari pending 275件の継続消化
- [ ] JPY 実データ検証
- [ ] X Reader 135件の観測開始
- [ ] Yahoo!フリマ価格読み取り
- [ ] observed_market_price 昇格（意図的に保留）
- [ ] real Gemini 発火（キーあり環境）
- [x] Documents 正本 ↔ worktree 同期（2026-06-09 実施）