# AI_CONTEXT — MarketLens 正本コンテキスト

最終更新: 2026-06-21

## 目的

MarketLens はホビー転売向けの **AI ドリブン市場判断 UI** です。  
新品購入価格は自動決定しません。ユーザーは新品を公式・小売・ECで人間が判断し、MarketLens はフリマ・ヤフオク等の **出口価格候補**・需要・確認材料・今見るべき順番を提示します。

## 2026-06-21 時点の正本方針

### 主役

- 主役は **商品群**。個別商品・個別イベントは商品群の下にぶら下がる
- 主役は **利益判断**。ただし未確定価格や AI 推定を確定利益として扱わない
- 主役は **AI による統合判断**。ただし価格算術・BuyLine・保存昇格・安全境界は決定論で守る

### 画面の基本思想

- まず「今どの商品群を見るべきか」が一目で分かること
- 抽選は **終了が重要**
- 販売は **開始が重要**
- 商品群の中に複数イベントがあってよく、1枚の代表時刻へ無理に潰さない
- generic な急上昇タグや弱い理由文は使わない
- 理由文は内部スコアの説明ではなく、市場文脈と今見るべき理由を出す

### 情報源の優先順位

1. 公式
2. X / リプ / 引用 / 熱量
3. ブログ / ニュース / その他記事

- ブログやニュースは参考情報には使うが、価格推定では弱く扱う
- X は注目度判断で強く使う
- 商品同定が怪しい情報は、順位も理由も強くしない

### AI と決定論の責務分離

AI が主に担うもの:

- 商品同定
- 商品群への束ね
- 抽選 / 販売 / 再販 / 受注などのイベント分類
- 「今見るべき理由」の生成
- X 熱量の読み取り
- Tier 判定
- 不確実性と反証の整理

決定論が守るもの:

- 利益計算
- 手数料 / 送料 / BuyLine
- `priceSnapshots` / `observed_market_price` / BuyLine への昇格可否
- 公式優先や禁止ラベルなどの安全境界
- confirmed / estimated の区別

### 次の実装で固定する考え方

- 商品群を正本単位にする
- 各商品群に複数イベントを持たせる
- AI を補助ではなく **判断エンジンの主役** に上げる
- ただし価格の保存・昇格・利益計算は現行安全契約を維持する
- 既存の 6レイヤー価格実装は壊さず、その上に商品群 + AI 判断を積む

### 第1実装の土台（2026-06-21）

- `scripts/marketlens-product-groups.mjs` に `marketlens.product-group.v1` と `marketlens.ai-judgment.v1` を導入
- 商品群は複数商品・複数イベントを保持し、抽選は終了、販売系は開始を重要時刻として保持する
- AI 判断は identity / grouping / events / Tier / reason / uncertainty を返し、価格・利益・BuyLine・promotion は契約上拒否する
- 軽い抽出と強い同定を並行実行し、critic の不一致時は `HOLD` + human review へ落とす導線を追加
- この段階では collector / postprocess / generated snapshot へ接続しない。価格正本と D6-B/C への影響を避けた独立土台とする

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

### 8分類と現状（2026-06-20 snapshot / 2026-06-21 audit 時点）

| # | 大分類 | 進度 | 要点 |
|---|--------|------|------|
| 1 | **商品候補収集・正規化** | 運用中 | collector + postprocess。current snapshot は `reachableSources=98` / `documents=816` / `normalizedProducts=503` |
| 2 | **AI / Gemini 基盤** | **real 発火確認済み** | `gemini` provider で current-run 成功。`configured=true`、`actualModelUsed=["gemini-3.1-flash-lite"]`、overview / extraction とも成功 |
| 3 | **SNS観測** | 基盤あり・部分観測 | X Reader キュー 278件 pending。Yahoo リアルタイム系は `socialSearchSignals=10`、current snapshot の `socialSignals` は 0 |
| 4 | **フリマ確認導線** | 運用中 | `marketplaceResearchTargets` 400（検索 URL・BuyLine 未使用）。UI「フリマ確認対象」 |
| 5 | **価格観測レイヤー** | 運用中 | Mercari `marketplaceSignals=15`、`listingCandidates=105`、JPY 84 / USD 21。低品質 query skip と stale/blocked 管理を継続 |
| 6 | **価格正本 / BuyLine** | **本実装済み** | `observed_market_price=31` を正式保存。`buyLineEligibleSources={ manual_price:36, observed_market_price:31 }` |
| 7 | **UI / ダッシュボード** | 表示整合済み | 参考ライン / 定価（新品基準）/ 出口価格候補 / 正式反映済み観測価格を分離表示。`http://127.0.0.1:18765/` で最終表示確認済み |
| 8 | **引き継ぎ・運用** | 同期中 | `AI_CONTEXT.md` / `TASK.md` / `WORKLOG.md` を current snapshot に同期し、completion audit を残す |

**現在の主作業:** **6レイヤー + AI 完成監査**。実データ更新・Gemini real 発火・回帰通過・UI 表示確認は通っており、残りは current docs と証跡の同期です。詳細は `TASK.md`。

---

## Scope Map（作業スコープ）

### 現在フォーカス（6レイヤー + AI 完成監査）

| 含む | 含まない |
|------|----------|
| 昇格済み `observed_market_price` の品質維持 | raw `browser_observed_candidate` の直接昇格 |
| `manual_price` + `observed_market_price` の BuyLine 接続 | USD-only / unknown / AI / heuristic の BuyLine 利用 |
| low-quality query skip / outlier 除外 / ended specialized 剥離 | CAPTCHA 回避・ログイン突破 |
| regression / UI / status の current snapshot 整合 | generated JSON の手編集 |
| Gemini current-run 成功証跡の固定 | X Reader / Yahoo!フリマの次フェーズ拡張 |

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
| Gemini 発火確認 | 2 | `gemini-smoke-test.mjs` |
| X Reader 観測開始 | 3 | `marketlens-x-reader.mjs` |
| targets 拡張・クエリ品質 | 4 | `marketlens-observation.mjs` |
| Mercari 蓄積・通貨 | **5** | `marketlens-mercari-reader.mjs`, `GROK_HANDOFF.md` |
| BuyLine / 価格昇格 | 6 | **実装済み・品質継続中** — raw candidate 直接利用は禁止、昇格ゲート経由のみ |
| UI バッジ・表示 | 7 | `script.js`, `ui-regression-check.mjs` |
| ドキュメント・サーバー | 8 | 本ファイル, `WORKLOG.md` |

---

## 現行 recovery tree と確認 URL

| 項目 | 値 |
|------|-----|
| **現行 recovery tree** | `/Users/user/Documents/Codex/2026-06-11/marketlens-recovery-v1` |
| **確認 URL** | `http://127.0.0.1:18765/`（publish-public-share 後の確認先） |
| **常設サーブ例** | `cd /Users/user/Documents/Codex/2026-06-11/marketlens-recovery-v1 && node scripts/serve-public-share.mjs` → `http://127.0.0.1:8765/` |

補足:

- 旧 Documents worktree は historical evidence であり、recovery の正本ではない。
- `http://127.0.0.1:18765/` は publish-public-share の HTTP check / UI 確認で使う現在の検証先。
- `http://127.0.0.1:8765/` は `scripts/serve-public-share.mjs` を起動した時の固定サーバー。起動元が current repo であることを前提にする。

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
| **X Reader** | `xObservationQueue`, `socialSignals` | X 投稿 URL 候補のキューイング・Jina Reader 取得 | キュー 278件 pending、reader 本観測は未着手 |
| **Yahoo!リアルタイム** | `realtimeResearchTargets`, `socialSearchSignals` | Yahoo リアルタイム検索の browser 観測 | `socialSearchSignals=10`、`socialSignals` は current snapshot で 0 |
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
| `observed_market_price` | 昇格済み実測価格（Mercari JPY 実証済みのみ） | **可** |
| **`browser_observed_candidate`** | **ブラウザ観測の出口価格候補（フリマ出口候補）** | **絶対不可** |

### BuyLine

- `buyLineEligible=true` は `manual_price` 等の検証済み価格のみ
- 観測レイヤー（`marketplaceResearchTargets`, `realtimeResearchTargets`, `marketplaceSignals`, `socialSearchSignals`）は **すべて `buyLineEligible=false`**
- UI では **参考ライン**（内部 BuyLine）・**判断補助対象外** を明示。補助パネル等では `BuyLine未使用` も併記可

## 絶対に守る安全契約

1. **未昇格の `browser_observed_candidate` / `jpyCandidate` を直接昇格しない**
   - `priceSnapshots` に raw candidate を入れない
   - `observed_market_price` にする時は promotion gate を通す
   - BuyLine 計算に raw candidate を使わない
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
| `MARKETLENS_REQUIRE_GEMINI=1 node scripts/regression-check-vnext.mjs` | current-run の Gemini extraction / overview 成功を必須検証 |

### 環境変数（観測関連・キーは読まない）

| 変数 | デフォルト | 意味 |
|------|-----------|------|
| `MARKETLENS_BROWSER_OBSERVATION_LIMIT` | 5 | 共有 browser バッチ上限 |
| `MARKETLENS_MARKETPLACE_BROWSER_OBSERVATION_LIMIT` | 3 | メルカリ sub-limit / run |
| `MARKETPLACE_BROWSER_OBSERVATION_TIMEOUT_MS` | 25000 | メルカリ fetch タイムアウト |

Gemini 実発火のローカル設定は repo 内へ key を置かず、`~/.marketlens.env` を `bash scripts/with-marketlens-env.sh ...` で読む運用を推奨する。ひな形は `scripts/marketlens-env.example.sh`。現在のシェルに key が既にある場合は `npm run marketlens:env-save` で `~/.marketlens.env` を生成できる。

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

**キュー概況（2026-06-20 snapshot 時点の目安）:** marketplace pending 315 / observed 10 / skipped 21 / stale 4、realtime pending 327 / skipped 12、X pending 278

**監視:** `node scripts/marketlens-status.mjs` の `marketplaceObservationQueueSkippedByReason` で permanent 系を区別可能。

---

## 価格境界仕様（出口価格候補 → 正本 / BuyLine 禁止）

`browser_observed_candidate` / `jpyCandidate` は **出口価格候補** であり、以下を厳守する。

| 項目 | ルール |
|------|--------|
| 蓄積先 | `marketplaceSignals` / `listingCandidates` / `jpyCandidate` のみ |
| `priceSnapshots` | **入れない** |
| `observed_market_price` | **raw candidate から直接は昇格しない** |
| BuyLine / 参考ライン | **raw candidate では使わない**（昇格済みのみ可） |
| UI ラベル | 「出口価格候補」「フリマ出口候補」「判断補助対象外」 |
| 禁止 UI | 相場 / 実勢価格 / メルカリ相場 / フリマ相場 / 観測相場 / 市場価格 |
| SNS 断定 | Xでバズ / SNS急上昇 / X話題 と断定しない |
| 価格種別の混同禁止 | AI価格・heuristic・browser観測・manual_price・observed_market_price を混同しない |
| currency 不明・不正 | BuyLine 昇格禁止。正本投影も禁止 |

**BuyLine に使える価格:** 別途定義された正本価格（現状は `manual_price` 等）のみ、または将来フェーズで明示的な信頼条件を満たした価格のみ。

---

## 大分類 6（価格正本 / BuyLine）

### 現在の正式仕様（2026-06-19）

- **使う:** `manual_price` / `confirmed_price`（将来互換） / 昇格済み `observed_market_price`
- **使わない:** `browser_observed_candidate` / 未昇格 `jpyCandidate` / USD-only / unknown / AI / heuristic
- **昇格条件:** JPY 実証、`on_sale`、fresh、traceable `itemUrl`、confidence threshold、identity match、outlier 除外
- **未算出:** 許可ソースが無い場合 `buyLineStatus: "unavailable"`
- **実装:** `scripts/marketlens-buyline.mjs`、`scripts/collect-marketlens.mjs`、`scripts/postprocess-marketlens-snapshot.mjs`、`script.js`

### AI の現状

- `gemini` provider 経路は実装済み
- current-run は Gemini real 発火成功。extraction / overview とも `gemini-3.1-flash-lite` で成功
- `llmExecution.configured=true` / `actualModelUsed=["gemini-3.1-flash-lite"]` を current snapshot / status の両方で確認済み

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

### 今やる

1. **価格正本 / BuyLine 品質固め** — promotion gate と current snapshot 整合維持
2. **AI / Gemini** — current-run real 発火の証跡維持
3. **観測レイヤー改善** — browser fallback 成功率と query 品質の継続改善
4. **混入ゼロ再確認** — regression / localhost / status

### 一時停止

- Mercari 軽量 cycle の単純追加（50 signals 到達済み）
- `recheck_unknown_currency` — 現状 0件残

### まだやらない

- Yahoo!フリマ価格読み取り
- 個別商品ページ深掘り / `soldCandidates`
- AI `resaleThesis` / UI 大改造
- real Gemini full verification の再設計（現 milestone では完了済み）

## 関連ドキュメント

| ファイル | 読者 |
|----------|------|
| `AI_CONTEXT.md`（本ファイル） | 全 AI — 正本・安全契約 |
| `GROK_HANDOFF.md` | Grok 引き継ぎ — 直近変更・件数 |
| `WORKLOG.md` | 時系列ログ |
| `CODEX_MCP_RULES.md` | Codex 作業規約 |
| `CODEX_HANDOFF.md` | Codex 過去ハンドオフ（Gemini 等） |
