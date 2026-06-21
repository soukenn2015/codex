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

## 2026-06-19 — 6レイヤー昇格を本実装

- `scripts/marketlens-buyline.mjs` に昇格ゲートを実装
  - `observed_market_price` を正式ソース化
  - JPY 実証 / `on_sale` / fresh / itemUrl traceability / confidence / identity match / outlier 除外を必須化
  - raw `browser_observed_candidate` / `jpyCandidate` は直接 BuyLine 不可のまま維持
- `scripts/marketlens-mercari-reader.mjs` を更新
  - login_required の旧 permanent skip を browser retry へ一度だけ再投入
  - 低品質 marketplace query を `low_quality_marketplace_query` として skip
  - JPY listing に `jpyCandidate` エビデンスを付与
  - Playwright import 形を Codex runtime 互換に修正
- `scripts/collect-marketlens.mjs` / `scripts/postprocess-marketlens-snapshot.mjs` を更新
  - 終了済み候補へ `specialized-search` 価格を残さない
  - promoted observed price を再評価で毎回再構築
- current snapshot 実測
  - `reachableSources=121/128`
  - `documents=835`
  - `normalizedProducts=612`
  - `observed_market_price=24`
  - `buyLineEligibleSources={ manual_price:31, observed_market_price:24 }`
  - `marketplaceSignals=6`, `listingCandidates=45`, `JPY=40`, `USD=5`
- 検証
  - `npm run check` PASS
  - `npm test` PASS
  - `node scripts/regression-check-vnext.mjs` PASS
  - `node scripts/collect-marketlens.mjs` 完走
  - `node scripts/marketlens-status.mjs` current snapshot で整合
- 未達
  - `GEMINI_API_KEY` / `OPENAI_API_KEY` とも未設定のため、AI は current-run で heuristic fallback
  - Gemini real 発火は未検証のまま

## 2026-06-19 — current truth の補正

- recovery の正本は `/Users/user/Documents/Codex/2026-06-11/marketlens-recovery-v1`
- 旧 Documents 同期ログは historical record として残すが、現 acceptance の基準ではない
- この turn 時点で `http://localhost:8765/` は recovery tree ではない別内容を返していた
- current overview の実表示確認は `http://127.0.0.1:8876/marketlens-overview.html` で実施
- `marketlens-overview.js` / `marketlens-overview.html` / `index.html` を更新
  - `observed_market_price=24`
  - `buyLineEligibleSources=manual_price 31 / observed_market_price 24`
  - favicon 404 を除去
  - old manual-only / confirmed=0 前提を除去

## 2026-06-20 — 6レイヤー + AI current-run 成功を確認

- collector / public-share / UI 確認を current recovery tree で再実行
- `scripts/collect-marketlens.mjs` を調整
  - runtime source breadth を戻し、category / tag root の過剰 drop を解消
  - active/trial fetch limit を引き上げ、documents retention の急落を回避
  - Gemini transient retry（500/502/503 と timeout）を追加
- local Playwright を repo に導入し、`npx playwright install chromium` で browser binary を揃えた
  - これで Mercari browser fallback の実行不能状態を解消
- 最終成功サイクルの current snapshot
  - `reachableSources=98`
  - `documents=816`
  - `normalizedProducts=503`
  - `marketplaceSignals=15`
  - `listingCandidates=105`
  - `observed_market_price=31`
  - `buyLineEligibleSources={ manual_price:36, observed_market_price:31 }`
- Gemini current-run
  - `provider=gemini`
  - `configured=true`
  - `actualModelUsed=["gemini-3.1-flash-lite"]`
  - extraction `requested=1 / succeeded=1`
  - overview `sourceMode=gemini / requested=1 / succeeded=1 / freshness=current_run`
- 検証
  - `npm test` PASS
  - `bash scripts/with-marketlens-env.sh node scripts/regression-check-vnext.mjs` PASS
  - `bash scripts/with-marketlens-env.sh node scripts/marketlens-status.mjs` で snapshot / status 整合を確認
  - `http://127.0.0.1:18765/` を in-app browser で再読込し、UI の最終表示を確認

---

## 次フェーズ候補（この milestone の blocker ではない）

- [x] Gemini real 発火（キーあり環境）
- [ ] X Reader 135件の観測開始
- [ ] Yahoo!フリマ価格読み取り
- [ ] 観測価格の追加品質改善（必要なら browser fallback 成功率向上）
- [x] Documents 正本 ↔ worktree 同期（2026-06-09 実施）
- [x] observed_market_price 昇格
- [x] BuyLine への observed_market_price 接続
- [x] Mercari JPY 実データ検証

## 2026-06-21 — 商品群主役 + AI 主役の要求を正本へ反映

- 要求整理をやり直し、MarketLens の主役を item ではなく **商品群** と再定義
- 利益最優先は維持しつつ、イベント解釈を分離
  - 抽選は終了重視
  - 販売は開始重視
- 公式 > X > ブログ/ニュース の優先順位を明文化
- generic な急上昇タグや弱い理由文ではなく、市場文脈ベースの理由生成を重視する方針へ変更
- AI の位置づけを「抽出補助」から「商品同定・商品群化・Tier・理由の主判断エンジン」へ引き上げ
- ただし価格算術・BuyLine・保存昇格は決定論 safety を維持する前提で固定
- 次の新チャット実装に向けて、`AI_CONTEXT.md` と `TASK.md` を **商品群正本化 + AI ドリブン第1実装** の内容へ更新

## 2026-06-21 — 商品群 + AI 判断の独立土台を実装

- `scripts/marketlens-product-groups.mjs` を追加し、商品群と AI 判断の versioned contract を固定
- light extraction / strong identification / critic の実行境界を追加。不一致は `HOLD` と human review へ送る
- AI 契約に価格・利益・BuyLine・promotion を持ち込めない再帰ガードを追加
- `scripts/product-group-contract-regression.mjs` を `npm test` の先頭へ接続
- collector / postprocess / generated JSON / BuyLine / D6-B/C は変更せず、既存 regression と UI regression の通過を確認

## 2026-06-21 — MCP / Skills の運用方針を追加

- 新チャット実装前提で、`AGENTS.md` にツール運用方針を追加
- 先に使うものを固定
  - Memory
  - GitNexus
- 必要時だけ使うものを固定
  - in-app browser
  - Playwright
  - domain-modeling
  - diagnosing-bugs
- 不要な skill を初手で広く開かない方針を明文化
- handoff はユーザー明示時のみ、という停止条件も再確認

## 2026-06-21 — ツール棚を正規化

- `AGENTS.md` に、現在の MCP / Skills / 本体の扱いを 4分類で追加
  - 常用
  - 条件付きで使う
  - 原則後回し
  - 現時点で前提にしないもの
- `playwright` は「未導入」ではなく「条件付き利用」に修正
- `caveman` は「未導入 / 不採用」ではなく「導入済みだが補助用途」に修正
- `exa`、`context7`、`chrome-devtools`、`node_repl`、`domain-modeling`、`diagnosing-bugs` の役割を固定
- 道具の有無ではなく、**新チャットでの優先順** を運用の基準にする方針を維持
