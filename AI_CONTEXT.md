# AI_CONTEXT — MarketLens 正本コンテキスト

最終更新: 2026-06-10

## 目的

MarketLens はホビー転売向けの情報収集・候補提示 UI です。  
**新品購入価格は自動決定しない。** ユーザーは新品を公式・小売・ECで人間が判断し、MarketLens はフリマ・ヤフオク等の **出口価格候補**・需要・確認材料を提示します。  
利益試算・参考ライン（内部名 BuyLine）・最終昇格は決定論ロジックが担い、LLM は抽出・分類・要約の補助に限定します。

---

## Progress Map（全体進度）

MarketLens 全体を **8分類** で把握する。引き継ぎ時・報告時は、作業中の大分類を冒頭に示す。

### 回答時の慣習

```
現在ここ: 5→6 境界整理 › Mercari 第1蓄積フェーズ完了（50 signals / 381 listings）
```

- **冒頭 1 行** で上記形式の「現在ここ」を示す（どの AI でも同じ）
- **細かい KPI**（signals 件数・通貨分布・queue pending 等）は、検証依頼・蓄積報告・障害調査時だけ出す
- 最新 KPI の正本は `GROK_HANDOFF.md` と `node scripts/marketlens-status.mjs`

### 8分類と現状（2026-06-09 時点）

| # | 大分類 | 進度 | 要点 |
|---|--------|------|------|
| 1 | **商品候補収集・正規化** | 運用中 | collector + postprocess。~700 products、regression 通過。ノイズフィルタ継続 |
| 2 | **AI / Gemini 基盤** | 経路あり・未発火 | `gemini` provider 実装済み。`gemini_api_key_missing` で heuristic fallback。real 発火はキーあり環境待ち |
| 3 | **SNS観測** | 基盤あり・未観測 | X Reader キュー構築済み。`socialSignals` 0。Yahoo リアルタイム `socialSearchSignals` 少数観測済み |
| 4 | **フリマ確認導線** | 運用中 | `marketplaceResearchTargets` 400（検索 URL・BuyLine 未使用）。UI「フリマ確認対象」 |
| 5 | **価格観測レイヤー** | **第1フェーズ完了** | Mercari `browser_observed_candidate` **50 signals / 381 listings** で一区切り。単純 cycle 追加は一時停止 |
| 6 | **価格正本 / BuyLine** | **▶ 暫定着手** | 安全価格（`manual_price`）のみで暫定 BuyLine。Mercari / `jpyCandidate` は **BuyLine 対象外** |
| 7 | **UI / ダッシュボード** | **価格表示整理済み** | 参考ライン / 定価（新品基準）/ 出口価格候補 / 判断補助対象外。相場断定語禁止。overview 価格思想同期済み（2026-06-10）。情報充足率/欠損管理（gaps「確認材料」D4表示 + D6-AでSNS/reader詳細を下部折りたたみへ整理）も同系列で進捗。 |
| 8 | **引き継ぎ・運用** | 整備済み | `AI_CONTEXT.md` / `GROK_HANDOFF.md` / `WORKLOG.md`。固定 URL `http://localhost:8765/` |

**現在の主作業:** **ロードマップ #3 価格観測レイヤー** — Mercari 隔離維持 + `jpyCandidate` 設計整理。BuyLine 暫定（#6）は運用中。Mercari 自動正本化は P2。詳細は `TASK.md`。

---

## Scope Map（作業スコープ）

### 現在フォーカス（ロードマップ #3 — 価格観測レイヤー）

| 含む | 含まない |
|------|----------|
| Mercari `browser_observed_candidate` 隔離維持 | `priceSnapshots` への投影 |
| `jpyCandidate` 保持設計（Playwright 由来） | `jpyCandidate` の snapshot 本書込 |
| Playwright / Jina read-only probe | CAPTCHA 回避・ログイン突破 |
| 生成側・表示側の禁止相場ラベル除去 | `observed_market_price` への昇格 |
| regression R9–R14 + 生成側ゲート | BuyLine 入力ソース拡大 |
| 関連価格ノイズ分類（probe 軽微改善） | 大量巡回・本番 browser cycle |

### 価格観測レイヤー内の位置づけ（重要）

`browser_observed_candidate` / `jpyCandidate` は **出口価格候補**（買値・正本ではない）。

| 呼び方 | 正しい理解 |
|--------|------------|
| UI ラベル | 「出口価格候補」「フリマ出口候補」「判断補助対象外」 |
| データ上 | `listingCandidates` / `jpyCandidate` 内の売却側参考。signal 単位の観測メモ |
| 禁止表現 | 相場 / 実勢価格 / メルカリ相場 / フリマ相場 / 観測相場 / 市場価格 |
| 将来 | 品質・件数が揃っても、正本・BuyLine 昇格は **別フェーズ（大分類 6）** で明示的に決める |

### 大分類 6 との境界（再掲・厳守）

観測レイヤー（大分類 5）のデータを、価格正本（大分類 6）に **絶対に混ぜない**:

1. **`priceSnapshots`** に `browser_observed_candidate` を入れない
2. **`observed_market_price`** に browser 観測を入れない
3. **BuyLine 計算** に browser 観測を使わない（`buyLineEligible=false` 維持）

違反は regression で検出する。修正より **蓄積停止・原因切り分け** を優先。

### 詳細スコープの補足（KPI・必要時のみ）

件数・通貨・キューは **進度の補足** であり、Progress Map の主指標ではない。必要時は以下を参照:

| 補足 KPI | 参照先 |
|----------|--------|
| signals / listings / currency | `GROK_HANDOFF.md` 最新バッチ |
| queue pending / observed / failed | `node scripts/marketlens-status.mjs` → `observation` |
| 混入・禁止ラベル | regression-check / ui-regression-check |

例（2026-06-09 蓄積後・報告用）: signals **14** / listings **112** / USD only / queue pending **281** — 詳細は `GROK_HANDOFF.md`。

### 他大分類を触るとき

| 作業内容 | 該当 # | 先に読む |
|----------|--------|----------|
| collector / ノイズ / 商品正規化 | 1 | `collect-marketlens.mjs`, `CODEX_MCP_RULES.md` |
| Gemini 発火確認 | 2 | `gemini-smoke-test.mjs`, `CODEX_HANDOFF.md` |
| X Reader 観測開始 | 3 | `marketlens-x-reader.mjs` |
| targets 拡張・クエリ品質 | 4 | `marketlens-observation.mjs` |
| Mercari 蓄積・通貨 | **5** | `marketlens-mercari-reader.mjs`, `GROK_HANDOFF.md` |
| BuyLine / 価格昇格 | 6 | **現在未着手** — 明示依頼まで触らない |
| UI バッジ・表示 | 7 | `script.js`, `ui-regression-check.mjs` |
| ドキュメント・サーバー | 8 | 本ファイル, `WORKLOG.md` |

---

## 正本ディレクトリと固定 URL

| 項目 | 値 |
|------|-----|
| **正本（Documents）** | `/Users/user/Documents/Codex/2026-05-28/hobbyflip-ai-1-ai-2-box` |
| **固定 URL** | **http://localhost:8765/** |
| **起動コマンド** | `cd <正本> && python3 -m http.server 8765` |

補足: Grok/Cursor の worktree は開発用コピーです。最新スナップショット確認は worktree 上で `run-marketlens-cycle` を回した後、必要なら Documents 正本へ同期してください。worktree 単体確認は `http://127.0.0.1:8888/` など別ポートでも可。

## 全体スコープ

### コアパイプライン

1. `scripts/collect-marketlens.mjs` — ソース収集・正規化・観測レイヤー適用
2. `scripts/postprocess-marketlens-snapshot.mjs` — snapshot 後処理・補完
3. `scripts/run-marketlens-cycle.mjs` — collect → postprocess → daily-digest
4. `data/marketlens.snapshot.json` — 単一のランタイム正本データ
5. `index.html` + `script.js` + `styles.css` — 静的 UI

### 観測レイヤー（現在）

| レイヤー | データ | 役割 | 状態 |
|----------|--------|------|------|
| **X Reader** | `xObservationQueue`, `socialSignals` | X 投稿 URL 候補のキューイング・Jina Reader 取得 | キュー pending、reader 未観測（詳細は status） |
| **Yahoo!リアルタイム** | `realtimeResearchTargets`, `socialSearchSignals` | Yahoo リアルタイム検索の browser 観測 | 少数観測済み（詳細は status） |
| **marketplaceResearchTargets** | 400件（mercari/yahoo_fleamarket 各200） | フリマ確認リンク（検索 URL）。BuyLine 未使用 | 表示上限 15件 |
| **marketplaceSignals** | 蓄積中 | メルカリ検索一覧の browser 観測結果 | `browser_observed_candidate`（**出口価格候補・正本ではない**） |
| **listingCandidates** | 蓄積中 | 個別出品の参考価格（signal 内配列） | 件数・通貨は `GROK_HANDOFF.md` / status 参照 |

### priceSourceRank（価格ランク）

| rank | 意味 | BuyLine |
|------|------|---------|
| `manual_price` | 手動・公式価格 | 可 |
| `historical_prediction` | 履歴予測 | 通常不可 |
| `llm_mentioned_price` | LLM 言及価格 | 不可 |
| `specialized_estimate` | 専用見積 | 状況依存 |
| `observed_market_price` | 実測相場（昇格後） | 将来可・**現在未使用** |
| **`browser_observed_candidate`** | **ブラウザ観測の出口価格候補（フリマ出口候補）** | **絶対不可** |

### BuyLine

- `buyLineEligible=true` は `manual_price` 等の検証済み価格のみ
- 観測レイヤー（`marketplaceResearchTargets`, `realtimeResearchTargets`, `marketplaceSignals`, `socialSearchSignals`）は **すべて `buyLineEligible=false`**
- UI では **参考ライン**（内部 BuyLine）・**判断補助対象外** を明示。補助パネル等では `BuyLine未使用` も併記可

## 絶対に守る安全契約

1. **`browser_observed_candidate` を昇格しない**
   - `priceSnapshots` に入れない
   - `observed_market_price` に入れない
   - BuyLine 計算に使わない
2. **listingCandidates 品質ゲート**
   - 必須: `title`, `itemUrl`, `value`, `rawPriceText`, `currency`, `priceParseConfidence`
   - `sourceMode=browser_observed`, `priceSourceRank=browser_observed_candidate`, `buyLineEligible=false`
   - `itemUrl` は `https://jp.mercari.com/item/m\d+` のみ（検索 URL 不可）
   - `shippingIncluded=true` は通さない（`null` または `false` のみ）
3. **通貨表示**
   - JPY → `¥`、USD → `US$`、unknown → 生テキスト（円記号を付けない）
   - USD を JPY 扱いしない
4. **禁止 UI ラベル**（観測なしで出さない）
   - メルカリ相場 / フリマ相場 / 実勢相場 / 観測相場 / Xでバズ / SNS急上昇 等
5. **ブラウザ観測の境界**
   - メルカリ検索一覧のみ（Jina `X-Wait-For-Selector: a[href*='/item/']`）
   - 個別商品ページ深掘り・CAPTCHA 回避・ログイン突破はしない
   - Yahoo!フリマ価格読み取りは未着手
6. **データ操作**
   - `data/*.json` を手編集しない（collect / cycle で生成）
   - `.env` / secrets / API キー / credentials を読まない・出力しない
7. **LLM 境界**（`CODEX_MCP_RULES.md` 参照）
   - LLM は利益・手数料・BuyLine・最終昇格を担わない

## 主要スクリプト一覧

| スクリプト | 用途 |
|------------|------|
| `scripts/run-marketlens-cycle.mjs` | フルサイクル実行（本番更新・~10–15分） |
| `scripts/run-marketlens-observation-cycle.mjs` | **軽量観測のみ**（collect なし・~30秒〜数分） |
| `scripts/marketlens-observation-cycle.mjs` | 軽量観測コア（import 用） |
| `scripts/collect-marketlens.mjs` | 収集・観測レイヤー統合 |
| `scripts/postprocess-marketlens-snapshot.mjs` | snapshot 後処理 |
| `scripts/marketlens-observation.mjs` | 観測レイヤー共通（targets/signals/metrics/claim サニタイズ） |
| `scripts/marketlens-mercari-reader.mjs` | メルカリ browser 観測・キュー・通貨再取得 |
| `scripts/marketlens-yahoo-realtime-reader.mjs` | Yahoo リアルタイム browser 観測 |
| `scripts/marketlens-x-reader.mjs` | X Reader キュー・Jina 取得 |
| `scripts/marketlens-limits.mjs` | 観測バッチ上限（`MARKETLENS_BROWSER_OBSERVATION_LIMIT` 等） |
| `scripts/marketlens-status.mjs` | 観測メトリクス JSON 出力 |
| `scripts/regression-check.mjs` | データ回帰（通貨・混入・ゲート） |
| `scripts/ui-regression-check.mjs` | UI 回帰（ラベル・通貨表示） |
| `scripts/gemini-smoke-test.mjs` | Gemini 疎通のみ（full crawl 不要） |

### 環境変数（観測関連・キーは読まない）

| 変数 | デフォルト | 意味 |
|------|-----------|------|
| `MARKETLENS_BROWSER_OBSERVATION_LIMIT` | 5 | 共有 browser バッチ上限 |
| `MARKETLENS_MARKETPLACE_BROWSER_OBSERVATION_LIMIT` | 3 | メルカリ sub-limit / run |
| `MARKETPLACE_BROWSER_OBSERVATION_TIMEOUT_MS` | 25000 | メルカリ fetch タイムアウト |

### 軽量観測コマンド（蓄積フェーズ推奨）

```bash
MARKETLENS_OBSERVATION_CHANNEL=mercari MARKETLENS_BROWSER_OBSERVATION_LIMIT=5 \
  node scripts/run-marketlens-observation-cycle.mjs
node scripts/marketlens-status.mjs
node scripts/regression-check.mjs
node scripts/ui-regression-check.mjs
```

| 環境変数 | 値 | 意味 |
|----------|-----|------|
| `MARKETLENS_OBSERVATION_ONLY` | `1` | 軽量モード（CLI は自動設定） |
| `MARKETLENS_OBSERVATION_CHANNEL` | `mercari` / `realtime` / `all` | 観測チャネル |
| `MARKETLENS_BROWSER_OBSERVATION_LIMIT` | 5 | 共有バッチ上限 |

**full cycle との違い:** collect・ソース取得・LLM・history 更新なし。既存 snapshot を読み、browser observation + 最小 postprocess（`sanitizeSnapshotClaims`）のみ。

### 標準検証コマンド（full cycle）

```bash
node --check scripts/marketlens-mercari-reader.mjs
node --check scripts/marketlens-observation.mjs
node --check scripts/collect-marketlens.mjs
node --check script.js
MARKETLENS_BROWSER_OBSERVATION_LIMIT=5 node scripts/run-marketlens-cycle.mjs
node scripts/marketlens-status.mjs
node scripts/regression-check.mjs
node scripts/ui-regression-check.mjs
```

## UI ラベル（2026-06-10 確定）

| 表示 | 条件・意味 |
|------|------------|
| 出口価格候補 | `jpyCandidate` / Playwright 円候補行。売却側参考 |
| フリマ出口候補 | `browser_observed_candidate` rank 表示 |
| 参考ライン | BuyLine 試算（内部名維持）。自動購入判断ではない |
| 定価（新品基準） | 新品側基準価格。人間が公式・小売・ECで最終判断 |
| 基準価格（シード） | `manual_price` 表示。人間確認済みフリマ価格ではない |
| 売却参考 | 履歴補完等の売却側参考（禁止断定語の置換先） |
| 判断補助対象外 | 観測候補が参考ライン・正本に入らないことの明示 |
| BuyLine未使用 | 補助セクション（SNS 等）での内部ロジック名として残置可 |

**禁止 UI ラベル（復活禁止）:** 相場 / 実勢価格 / フリマ相場 / 観測相場 / メルカリ相場 / 市場価格

**静的シード注意:** `script.js` 内 deals/releases 説明文に旧語「相場」が残る箇所あり（現 P1 外）。UI 再露出時は「売却参考」「参考売却価格」「出口参考」へ置換候補。

## USD-only の原因（2026-06-09 調査 — 確定版）

**結論: USD 固定ロジックはない。Jina Reader が Mercari 検索一覧 markdown を `US$` 表記で返し、`LISTING_LINE_RE` がその部分だけを `rawPriceText` に取り込む。**

| 観点 | 内容 |
|------|------|
| `rawPriceText` 生成時点 | `parseMercariSearchMarkdown()` → `LISTING_LINE_RE` が listing 行の価格トークン（`match[1]`）を抽出 → `parseMercariListingPrice()` |
| Jina 検索 markdown | listing 行例: `... US$16.74 一番くじ...](https://jp.mercari.com/item/m85365631751)` — **US$ が行内に直接存在** |
| Jina 商品ページ markdown | 同一商品で `US$ 16.74 ( ¥ 2,555 為替レート... )` — **JPY は商品ページに存在**するが検索一覧パーサでは未抽出 |
| locale / Accept-Language | `Accept-Language: ja-JP` 付与でも検索 listing 行の US$ 表記は変わらず（2026-06-09  live 確認） |
| Mercari URL | `jp.mercari.com`（日本ドメイン）。region パラメータは fetch ヘッダに未指定 |
| Jina 取得条件 | `X-Return-Format: markdown`, `X-Wait-For-Selector: a[href*='/item/']`（`fetchMercariSearch`） |
| USD 固定箇所 | **なし** |
| unknown fallback | `currency: "unknown"` のみ。**USD へ自動昇格しない**（`parseMercariListingPrice` L72-78） |
| 表示 / 正本 / BuyLine | `script.js` は currency 表示のみ。`priceSnapshots` / BuyLine は観測候補を未投影 |

**JPY 実証:**

| 経路 | 結果 |
|------|------|
| 検索一覧（現行パイプライン） | **JPY 未取得**（listing 行は US$ のみ） |
| 商品ページ（Jina・probe のみ） | **¥ 表記を確認**（例: ¥2,555）。成功率 ~33%、markdown 欠落が主因。snapshot 未書込 |

**現時点の推奨:** Mercari `browser_observed_candidate` は参考候補のまま。USD-only 中は正本 / BuyLine 昇格禁止。JPY 実証経路の設計は `TASK.md` 参照。

**JPY 取得経路調査（2026-06-09）:** Jina 商品ページ 15件 **33%** / browser（Playwright）7件 **86%** JPY 可視。Jina `no_price_block` の多くは browser では取得可（markdown 欠落が主因）。**`jpyCandidate` 設計・経路比較:** `TASK.md`（正本・BuyLine 不可）

**詳細草案:** `TASK.md`（価格昇格ポリシー + 専用 regression 設計 + JPY 経路比較）

---

## skipped / delta 0 の運用ルール（2026-06-09 整理）

Mercari 軽量 cycle の `skipped` は **キュー全体の skipped 件数**（累積）も含む。`failed=0` でも signal 件数が増えないことがある。

| 分類 | 扱い | 次アクション |
|------|------|-------------|
| `already_observed` | **正常系** | `marketplaceSignalKey` 重複統合・冪等性確認。delta 0 の主因の一つ |
| `marketplaceSignalKey` 重複統合 | **正常系** | `mergeMarketplaceSignals()` により同一 query は上書き。件数は増えない |
| `permanent_blocked` | **除外対象** | 単純 cycle の優先対象から外す。CAPTCHA 回避・再試行強化はしない |
| `permanent_login_required` | **除外対象** | ログイン突破しない。単純 cycle 対象外 |
| `permanent_failed_retries` | **除外対象** | 再試行上限到達。別途調査まで pending 化しない |
| `failed=0` + delta 0 | **効率低下** | 取得失敗ではない。skipped / 重複統合 / blocked プール当たり |
| `failed>0` または `collectGuard.degraded=true` | **調査対象** | cycle 継続より原因切り分けを優先 |

**キュー概況（50/381 時点の目安）:** pending ~234 / observed ~36 / skipped ~11（permanent_blocked + permanent_login_required）/ stale ~14

**監視:** `node scripts/marketlens-status.mjs` の `marketplaceObservationQueueSkippedByReason` で permanent 系を区別可能。

---

## 価格境界仕様（出口価格候補 → 正本 / BuyLine 禁止）

`browser_observed_candidate` / `jpyCandidate` は **出口価格候補** であり、以下を厳守する。

| 項目 | ルール |
|------|--------|
| 蓄積先 | `marketplaceSignals` / `listingCandidates` / `jpyCandidate` のみ |
| `priceSnapshots` | **入れない** |
| `observed_market_price` | **昇格しない** |
| BuyLine / 参考ライン | **使わない**（`buyLineEligible=false` 維持） |
| UI ラベル | 「出口価格候補」「フリマ出口候補」「判断補助対象外」 |
| 禁止 UI | 相場 / 実勢価格 / メルカリ相場 / フリマ相場 / 観測相場 / 市場価格 |
| SNS 断定 | Xでバズ / SNS急上昇 / X話題 と断定しない |
| 価格種別の混同禁止 | AI価格・heuristic・browser観測・manual_price・observed_market_price を混同しない |
| currency 不明・不正 | BuyLine 昇格禁止。正本投影も禁止 |

**BuyLine に使える価格:** 別途定義された正本価格（現状は `manual_price` 等）のみ、または将来フェーズで明示的な信頼条件を満たした価格のみ。

---

## 大分類 6（価格正本 / BuyLine）

### 暫定 BuyLine（着手済み・2026-06-09）

- **使う:** `manual_price` / 将来 `confirmed_price`（deals / releases / 手動正本）
- **使わない:** `browser_observed_candidate` / `jpyCandidate` / Jina US$ / unknown / AI / heuristic / Playwright probe
- **未算出:** 安全価格がない場合 `buyLineStatus: "unavailable"`
- **実装:** `scripts/marketlens-buyline.mjs` + `script.js` + `regression-check.mjs`

### Mercari 自動正本化（まだ進めない — P2）

観測候補の正本投影・Mercari 価格での BuyLine 反映は、JPY 安定取得・PM 合意・専用 regression 後まで **実施しない**。

**P1 / P2:** 残 **P1 なし**。Mercari 自動正本化は **P2**。暫定 BuyLine（安全価格限定）は **着手可**。

---

## 概要同期ルール（全 AI 共通・2026-06-10 確定）

概念・役割・価格定義・UI 分類・公開方針・P1 境界が更新されたら、実装変更の有無にかかわらず以下を同時更新する:

1. `marketlens-overview.html` / `marketlens-overview.js`
2. `GROK_HANDOFF.md`（Grok向け次回指示の前提）
3. 必要に応じて `TASK.md` / 本ファイル
4. `WORKLOG.md`

更新内容に含めること: 何が変わったか / 旧解釈と新解釈 / UI 表示方針 / P1 への影響 / 誤解禁止点 / ロジック変更しない箇所。

---

## 次フェーズ方針

### 今やる（効率順ロードマップ 3）

1. **価格観測レイヤー** — Mercari 参考候補隔離維持 + jpyCandidate / Playwright 改善
2. **フリマ確認導線** — 人間確認と少量 Playwright の接続
3. Mercari 観測レイヤー改善（参考候補隔離維持）
4. 混入ゼロ再確認（regression / localhost / status）

### 一時停止（第1蓄積完了まで実施済み）

- Mercari 軽量 cycle の単純追加（50 signals 到達済み）
- `recheck_unknown_currency` — 現状 0件残

### まだやらない

- Yahoo!フリマ価格読み取り
- 個別商品ページ深掘り / `soldCandidates`
- `observed_market_price` 昇格 / `priceSnapshots` 投影 / BuyLine 反映
- AI `resaleThesis` / UI 大改造
- real Gemini full verification（キーあり環境が必要）

## 関連ドキュメント

| ファイル | 読者 |
|----------|------|
| `AI_CONTEXT.md`（本ファイル） | 全 AI — 正本・安全契約 |
| `GROK_HANDOFF.md` | Grok 引き継ぎ — 直近変更・件数 |
| `WORKLOG.md` | 時系列ログ |
| `CODEX_MCP_RULES.md` | Codex 作業規約 |
| `CODEX_HANDOFF.md` | Codex 過去ハンドオフ（Gemini 等） |