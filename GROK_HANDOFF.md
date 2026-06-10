# GROK_HANDOFF — MarketLens 観測レイヤー引き継ぎ

最終更新: 2026-06-10（価格概念整理・表示/overview 受け入れ済み）  
担当: Grok（Mercari `browser_observed_candidate` 蓄積フェーズ + 価格表示方針維持）

---

## Grok向け次回指示の前提（必読・2026-06-10 確定）

### 確定した価格概念（ロジックは変えていない）

| 概念 | 正しい理解 |
|------|------------|
| **MarketLens の役割** | 新品購入価格を**自動決定しない**。出口価格候補・需要・確認材料を出し、人間が買う価値を判断しやすくする |
| **新品購入** | ユーザーは基本的に新品のみ購入。購入可否・場所・価格は**公式・小売・ECを人間が見て判断** |
| **定価・公式・小売** | 表示してよい。**新品側の基準価格**。自動購入判断の確定価格ではない |
| **jpyCandidate / browser_observed_candidate** | **出口価格候補**（フリマ出口候補）。買値・正本価格ではない。売却側の参考材料 |
| **BuyLine（内部名）** | 計算式・`buyLineEligible` 判定は現状維持。UI では**参考ライン**・**判断補助**と表し、「新品仕入れ上限」「買ってよい価格」と誤読されないよう関係を明示 |
| **manual_price** | 現状は**基準価格（シード）**由来。人間確認済みフリマ価格ではない |

### 旧解釈 → 新解釈（表示のみ）

| 旧（誤読しやすい） | 新（UI/overview） |
|-------------------|-------------------|
| 相場 / 実勢価格 / メルカリ相場 / 観測相場 | **売却参考** / **基準価格** / **出口価格候補**（禁止断定語は復活させない） |
| 参考価格候補（買値っぽい） | **出口価格候補** / **フリマ出口候補** |
| 許容上限 / BuyLine未算出 | **参考ライン** / **参考ライン未算出** |
| 定価 | **定価（新品基準）** |
| BuyLine不可 | **判断補助対象外** |

### P1 禁止事項（変更なし・厳守）

- `jpyCandidate` を `priceSnapshots` / `observed_market_price` / BuyLine に入れない
- `browser_observed_candidate` を正本・BuyLine に昇格しない
- `buyLineEligible:true` を観測系に付与しない
- 禁止 UI ラベル: 相場 / 実勢価格 / フリマ相場 / 観測相場 / メルカリ相場 / 市場価格

**受け入れ時 P1 確認（2026-06-10）:** `observedMarketPrice=0` / `buyLineEligibleSources={manual_price:28}` / `jpyCandidateBuyLineEligibleTrue=0` / `priceSnapshotsJpyCandidateMix=0` / `buyLineBrowserMix=false` / `forbiddenLabelDetected=false`

### Grok が誤解してはいけない点

1. **表示整理 ≠ ロジック変更** — BuyLine 式・rank・jpyCandidate 保存経路は触っていない
2. **出口価格候補は UI に出す価値が高い** — ただし正本・判断補助の参考ラインには接続しない
3. **`script.js` 静的シード** — deals/releases 説明文に旧語「相場」が残る箇所あり（現時点 P1 ではない）。将来 UI 再露出時は「売却参考」「参考売却価格」「出口参考」へ置換候補
4. **ngrok URL** — リポジトリへ固定保存しない（継続運用はユーザー側）

### まだロジック変更しない箇所

- `calculateCandidateMarketProfit` / BuyLine ゲート / `PROVISIONAL_BUYLINE_ELIGIBLE_RANKS`
- `jpyCandidate` 保存・probe パイプライン
- `priceSnapshots` / `observed_market_price` 昇格経路
- snapshot JSON 手編集

### 概要同期ルール（次回以降すべての MarketLens 作業で必須）

概念・役割・価格定義・UI 分類・公開方針・P1 境界が更新されたら、**実装の有無にかかわらず**以下を同時に更新する:

1. `marketlens-overview.html` / `marketlens-overview.js`（2026-06-10 価格思想は反映済み）
2. 本ファイル `GROK_HANDOFF.md`（特に「Grok向け次回指示の前提」）
3. 必要に応じて `TASK.md` / `AI_CONTEXT.md`
4. `WORKLOG.md` 時系列

**コードだけ変えて overview・引き継ぎ・次回前提が古いまま残すのは禁止。**

---

## 最新: overview 全体思想の再同期（2026-06-10 追補）

- **変更範囲:** `marketlens-overview.html` / `marketlens-overview.js` を中心に、10層説明・四層UI・public-share・概要同期ルール・価格概念の古い文言を一括整理
- **追加セクション:** 四層UIと状態ラベル / 概要同期ルール / public-share公開運用
- **旧文言除去:** 参考価格候補・買い上限・開催中専用表示・手で確認した価格（manual_price誤解）を overview から排除
- **ロジック変更なし**

## 前回: 価格概念整理（表示・overview のみ）受け入れ済み（2026-06-10）

- **変更範囲:** `script.js` / `index.html` / `marketlens-overview.*` / regression 文言のみ
- **変更なし:** BuyLine 計算・`buyLineEligible`・価格 rank・jpyCandidate 保存ロジック・snapshot 手編集
- **検証:** regression-check / ui-regression-check / check-public-share-http / ngrok 200・404 通過
- **Documents 同期:** UI + overview + regression スクリプトを正本へ `cp -p` 済み

### UI 表示方針（確定）

| 場所 | 主な文言 |
|------|----------|
| 候補カード | 参考ライン / 定価（新品基準）/ 売却参考 / 出口価格候補 |
| フリマ jpy 行 | `出口価格候補 ¥… · Playwright確認用 · 判断補助対象外 · 人間確認待ち` |
| rank ラベル | `browser_observed_candidate` → フリマ出口候補 / `manual_price` → 基準価格（シード） |
| overview | 新品は人間判断 / 出口価格候補は別棚 / 参考ラインは判断補助 |

---

## 前回: 3サイクル追加蓄積 + 50 signals 到達 + Documents 正本同期（2026-06-09）

- 軽量 observation cycle **3回追加**（43 → **50** signals / 330 → **381** listings、実装変更なし）
- cycle4-5 の delta 0 原因: 重複統合（`mergeMarketplaceSignals`）+ `already_observed` スキップ + permanent_blocked/login_required
- **worktree** → **Documents** へ 3ファイル同期: `data/marketlens.snapshot.json`, `GROK_HANDOFF.md`, `WORKLOG.md`
- Documents `http://localhost:8765/` で snapshot **50 signals / 381 listings** を参照可能に

### 現在件数（snapshot 2026-06-09T09:34:26Z）

| 指標 | 値 |
|------|-----|
| marketplaceSignals | **50** |
| listingCandidates | **381** |
| currency | USD **381** / JPY 0 / unknown 0 |
| queue pending | 237 / observed 39 / skipped 11 / failed 0 |

---

## 前回: 軽量 observation cycle 追加 + 蓄積（14 → 17 signals / 112 → 136 listings）

### 軽量コマンド

```bash
MARKETLENS_OBSERVATION_CHANNEL=mercari MARKETLENS_BROWSER_OBSERVATION_LIMIT=5 \
  node scripts/run-marketlens-observation-cycle.mjs
```

- **~30秒**（full cycle ~10–15分と比較）
- collect なし・既存 snapshot 読み込み → Mercari 観測のみ → `sanitizeSnapshotClaims` → snapshot 書き戻し

---

## 前バッチ: 蓄積継続（6 → 14 signals / 48 → 112 listings）

### 実施内容

- 実装変更なし。`MARKETLENS_BROWSER_OBSERVATION_LIMIT=5` で cycle を **3回** 実行し蓄積。
- 各 run でメルカリ sub-limit 3件/run（recheck 枯渇後は新規 pending 消化）。

### 蓄積結果（snapshot 2026-06-09T07:22:03Z）

| 指標 | 開始 | 終了 | 目標 |
|------|------|------|------|
| marketplaceSignals | 6 | **14** | ~15 ✅ |
| listingCandidates | 48 | **112** | 100+ ✅ |
| averageListingCandidatesPerSignal | 8 | 8 | — |

**通貨分布（listing 単位）:** JPY **0** / USD **112** / unknown **0**

**signal 単位:** `signalsWithJpy=0` / `signalsWithUsdOnly=14` / `signalsWithUnknownCurrency=0`

**キュー:** pending **281** / observed **13** / failed **0** / skipped **0** / stale **1**

### 直近 run（3回目）の marketplaceObservation

| requested | succeeded | failed | skipped |
|-----------|-----------|--------|---------|
| 3 | 3 | 0 | 0 |

**byStatus:** succeeded 3 / timeout 0（累計: cycle1 で timeout 1件あり）

**Yahoo リアルタイム skip 理由（参考）:** `permanent_login_required` 6 / `realtime_query_description` 3 / `realtime_query_not_concrete` 2

### 検証（最終 run 後）

```bash
node scripts/marketlens-status.mjs          ✅
node scripts/regression-check.mjs           ✅ passed
node scripts/ui-regression-check.mjs        ✅ passed
```

- `browserObservedInPriceSnapshots`: **false**
- `buyLineBrowserMixDetected`: **false**
- `forbiddenLabelDetected`: **false**
- `observedMarketPrice`: **0**

### 次タスク

1. **15件到達** — あと 1 cycle（~3 signals）で 15〜17件見込み
2. **pending 281件** — 同設定で継続バッチ
3. **JPY スポット検証** — 出現時に `rawPriceText` / UI `¥` を確認
4. **正本同期** — worktree → Documents、`http://localhost:8765/` で UI 確認
5. **昇格はまだしない** — priceSnapshots / observed_market_price / BuyLine への混入禁止を維持

---

## 直近の変更内容（実装フェーズ）

### 1. メルカリ browser 観測パイプライン（新規）

- `scripts/marketlens-mercari-reader.mjs` — Jina でメルカリ検索一覧を取得し `listingCandidates` を生成
- `scripts/marketlens-observation.mjs` — `normalizeListingCandidate`, `countObservationMetrics`, 通貨品質集計
- `scripts/marketlens-limits.mjs` — バッチ上限（共有 5 / メルカリ sub-limit 3）
- `scripts/marketlens-status.mjs` — 観測メトリクス JSON 出力
- `scripts/collect-marketlens.mjs` — marketplace 観測呼び出し、既存 signals 保持

### 2. 通貨・品質修正

- `currency` / `rawPriceText` / `priceParseConfidence` を listing 必須フィールドに
- `parseMercariListingPrice()` — `US$` / `¥` / unknown 判定
- `formatMarketplaceListingPrice()` — UI/回帰で通貨別表示（unknown に ¥ 付けない）
- `signalNeedsCurrencyRecheck()` — 旧 unknown signal を stale/recheck 対象化
- キュー `reason: recheck_unknown_currency` を pending 優先ソート

### 3. 回帰・UI

- `scripts/regression-check.mjs` — 通貨ゲート、priceSnapshots/BuyLine 混入検査、listing 必須フィールド
- `scripts/ui-regression-check.mjs` — UI 通貨表示・禁止ラベル検査
- `script.js` — 出口価格候補 / フリマ出口候補 / 参考ライン / 判断補助対象外（2026-06-10 文言整理済み）
- 情報充足率 / 欠損管理（D3b-D6-A）: render-time gaps 導出 + research card「確認材料」表示 + D6-Aで reader/social 詳細を下部折りたたみ領域へ移動（詳細は上記専用セクション）

### 4. 静的サーバー運用確認

- 正本 Documents: `http://localhost:8765/`
- worktree 開発確認: `http://127.0.0.1:8888/`（最新 snapshot 用）

## 変更ファイル

### 新規（untracked）

- `scripts/marketlens-mercari-reader.mjs`
- `scripts/marketlens-observation.mjs`
- `scripts/marketlens-limits.mjs`
- `scripts/marketlens-status.mjs`
- `scripts/marketlens-x-reader.mjs`
- `scripts/marketlens-yahoo-realtime-reader.mjs`
- `scripts/postprocess-marketlens-snapshot.mjs`
- `scripts/gemini-smoke-test.mjs`
- `data/source-registry.json`
- `data/raw-archive/`

### 更新（modified）

- `scripts/collect-marketlens.mjs`
- `scripts/regression-check.mjs`
- `scripts/ui-regression-check.mjs`
- `scripts/run-marketlens-cycle.mjs`
- `script.js`, `index.html`, `styles.css`
- `data/marketlens.snapshot.json`（cycle 生成）
- `data/marketlens.history.json`, `data/marketlens.public-history.json`
- `data/source-config.json`

## 現在の件数（snapshot 2026-06-09T07:22:03Z）

| 指標 | 件数 |
|------|------|
| xObservationQueueTotal | 146 |
| xObservationQueuePending | 146 |
| socialSignals | 0 |
| socialSearchSignals | 11 |
| marketplaceResearchTargets | 400 |
| marketplaceSignals | **14** |
| listingCandidates | **112** |
| averageListingCandidatesPerSignal | 8 |

### 通貨分布（listing 単位）

| JPY | USD | unknown |
|-----|-----|---------|
| 0 | **112** | **0** |

### signal 単位

| signalsWithJpy | signalsWithUsdOnly | signalsWithUnknownCurrency |
|----------------|-------------------|---------------------------|
| 0 | 14 | 0 |

### marketplace 観測キュー

| pending | observed | failed | skipped | stale |
|---------|----------|--------|---------|-------|
| 281 | 13 | 0 | 0 | 1 |

### unknown 通貨再取得

| recheckPending | recheckSucceeded | recheckStillUnknown |
|----------------|------------------|---------------------|
| 0 | （完了済み） | 0 |

## 検証結果

### run-marketlens-cycle

```bash
MARKETLENS_BROWSER_OBSERVATION_LIMIT=5 node scripts/run-marketlens-cycle.mjs
```

- collect: **ok**（241/241 sources reachable）
- marketplaceObservation: requested **3**, succeeded **3**, failed **0**, skipped **0**

### marketlens-status

- `browserObservedInPriceSnapshots`: **false**
- `buyLineBrowserMixDetected`: **false**
- `forbiddenLabelDetected`: **false**

### regression-check

```
Regression checks passed: trends=1219, candidates=714, products=749, docs=1005,
events=2475, registry=4107, tasks=428, marketplace=400, llm=20, predicted=1381
```

### ui-regression-check

```
UI regression checks passed: {"researchTask":164,"archive":550}
```

**現役UI系確認（D6-A時点）:** `node scripts/ui-regression-check.mjs` / `node scripts/ui-layer-bucket-audit.mjs`（`ui-completeness-audit.mjs` は不在のため現役コマンド一覧には含めない）。

### node --check

- `scripts/marketlens-mercari-reader.mjs` ✅
- `scripts/marketlens-observation.mjs` ✅
- `scripts/collect-marketlens.mjs` ✅
- `script.js` ✅

## 混入チェック（直近）

| チェック | 結果 |
|----------|------|
| priceSnapshots に browser_observed_candidate | なし |
| observed_market_price に browser 観測 | なし（0件） |
| BuyLine に browser 観測 | なし |
| 禁止ラベル（メルカリ相場等） | なし |

## JPY 実データ

- **今回なし**（失敗扱いではない）
- 出現時は `rawPriceText` / `value` / `currency=JPY` と UI `¥` 表示をスポット検証すること

## UI 表示例

```
US$16.74 一番くじちょこっと いぬとの暮らし A賞 くま
```

- ラベル: フリマ出口候補 / 出口価格候補（jpyCandidate 行）
- メタ: `browser_observed` · 判断補助対象外（補助パネルでは BuyLine未使用 も併記可）

## 情報充足率 / 欠損管理 (D6-A完了)

- 現在フェーズ: 情報充足率 / 欠損管理 は D6-A まで完了。全体進捗目安 95%。
- 現在仕様: `deriveCompletenessForView(item)` が render-time に `{gaps, basis, caveats}` を返す。item破壊なし、snapshot保存なし。priceRows / BuyLine / priceSnapshots / observed_market_price / jpyCandidate / browser_observed_candidate に接続しない。now/memo昇格条件、item.layer、層分類に使わない。
- D4表示: research card 内の確認ポイント直後に「確認材料」を research-note として最小表示。表示対象は最大4種（出口参考不足、出口候補不足、理由不足、次確認不足）。score / % / rank / grade / 価格信頼度ではない。
- D5逸脱修正: `completeness.gaps.length <= 2` による layer board / buildFlowIndexItems filter は不採用・無効化済み（703件中703件が >2 gaps で layer board 空欄化リスクのため）。層内フィルタはD6以降の候補であり、採用するならUIトグル必須。
- D6-A: `renderSocialSignalsList` の詳細X/SNS確認リストは layerFlowList 直下ではなく `#auxRealtimeChecks .fold-body` に寄せた。dataStatus には短い reader 要約のみ許容。layerFlowList には詳細social listを出さない。D6-B/Cは凍結。
- ui-completeness-audit.mjs の現状: `scripts/ui-completeness-audit.mjs` は現在存在しない。現在実行可能な確認は `node --check script.js`、`node scripts/ui-layer-bucket-audit.mjs`、`node scripts/ui-regression-check.mjs` のみ。ui-completeness-audit.mjs は現役検証コマンドとして書かない（将来必要なら復旧または再作成を別タスクとする）。
- 既知状態: ui-layer-bucket-audit.mjs は環境により `playwright_not_installed` を出すことがある。ui-regression-check.mjs は今回 passed。D6-B/Cは未採用（collectFlowLayerRows rewrite、renderLayerBoard limit変更、periodLayer / priority周辺調整、buildProvisionalDeals priority変更）。

## 未完

- marketplaceSignals **14/15**（あと 1 cycle で到達見込み）
- marketplaceObservationQueue pending **281件**（小バッチ継続が必要）
- JPY 実データ未出現
- X Reader（146 pending、未観測）
- Yahoo!フリマ価格読み取り
- `observed_market_price` 昇格 / priceSnapshots 投影 / BuyLine 反映
- real Gemini 発火確認（`gemini_api_key_missing` で heuristic fallback 中）
- Documents 正本への worktree 変更同期（未確認）

## 次にやるべきこと

1. **15 signals 到達** — あと 1 cycle（`MARKETLENS_BROWSER_OBSERVATION_LIMIT=5 node scripts/run-marketlens-cycle.mjs`）
2. **Mercari 蓄積継続** — pending 281件を同設定で消化
3. **status 監視** — 各 run 後に regression 3本セットを実行
4. **JPY スポット検証** — JPY が出た run で regression + UI 目視
5. **正本同期** — worktree → Documents、`http://localhost:8765/` で確認

## 次に触るべきファイル

| 優先 | ファイル | 理由 |
|------|----------|------|
| 高 | `scripts/marketlens-mercari-reader.mjs` | キュー消化・価格パース・recheck |
| 高 | `scripts/marketlens-observation.mjs` | 正規化・メトリクス |
| 高 | `scripts/regression-check.mjs` | ゲート追加時の検証 |
| 中 | `scripts/collect-marketlens.mjs` | 観測呼び出し統合 |
| 中 | `script.js` | UI 表示・バッジ |
| 低 | `scripts/marketlens-yahoo-realtime-reader.mjs` | Yahoo リアルタイム（別系統） |

## 触らない方がよい箇所

- `priceSnapshots` への `browser_observed_candidate` 投影ロジック（未実装・追加禁止）
- BuyLine 計算本体（`calculateCandidateMarketProfit` 等）への観測価格混入
- `observed_market_price` 昇格経路
- Yahoo!フリマ価格パーサー（未着手フェーズ）
- 個別商品ページ fetch / CAPTCHA・ログイン突破
- `data/*.json` 手編集
- `.env` / API キー / credentials
- collector パイプライン全体の大規模リファクタ

## 自己レビュー（蓄積バッチ 2026-06-09）

| 重要度 | 内容 |
|--------|------|
| P1 | なし — 昇格経路・BuyLine・priceSnapshots 混入なし、regression 全通過 |
| P2 | signals 14/15（目標ほぼ達成）。cycle1 で timeout 1件（全体影響は軽微） |
| P3 | 全 listing が USD（Jina 経由）。JPY 出現時の実検証は未実施 |