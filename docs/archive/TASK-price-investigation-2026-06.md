# TASK — 商品群主役 + AI ドリブン再設計の第1実装

最終更新: 2026-06-22
対象フェーズ: 商品群正本化 / AI 判断契約 / 仕様固定

## 現在の状態

- 6レイヤー価格実装は完了済み
- `observed_market_price` は正式保存され、BuyLine 入力に接続済み
- Gemini current-run は real 発火確認済み
- current docs は 6レイヤー完成監査まで同期されたが、**商品群主役 + AI 主役** の新方針はまだ実装へ落ちていない
- `marketlens.product-group.v1` / `marketlens.ai-judgment.v1` の独立土台と契約回帰は導入済み
- collector / postprocess / UI はまだ新しい商品群正本へ接続しておらず、現行の flat な見え方と reason 生成は次段階の対象

## 2026-06-21 第1実装結果

- 商品群スキーマ: 複数 member、複数 event、source evidence、AI judgment、決定論価格への参照境界を実装
- AI 判断契約: identity / grouping / event classification / Tier / reason / uncertainty / counter evidence を検証
- 並行生成土台: light extraction + strong identification を並行実行し、critic の disagreement を `HOLD` へ安全に収束
- 安全境界: AI 出力内の price / profit / BuyLine / promotion / fee / shipping 系フィールドを再帰的に拒否
- 回帰: 商品群構造、抽選終了と販売開始の分離、公式 > X > 記事、価格境界、不一致時 review を追加

## 第1 goal で固定する最小仕様

- 商品群の membership は「同じ販売単位 / 同じ取得機会」を表すものだけを束ねる。
- シリーズ名の一致だけでは束ねない。賞違い、特典違い、フォトギャラリーのような別粒度は原則分離する。
- AI の判断が境界不明なら group は昇格しない。`HOLD` と `requiresHumanReview=true` を前提にする。
- 昇格は、同一 group と見なせる根拠が揃い、event 分類が確定し、境界疑義が残っていないときだけ行う。
- event contract は `lottery`, `sale`, `restock`, `resale`, `preorder`, `unknown` を認識するが、`unknown` は未解決状態であり昇格条件にはしない。
- `lottery` は終了時刻、`sale` / `restock` / `resale` / `preorder` は開始時刻を重要時刻として扱う。
- 価格 safety、`BuyLine`、`priceSnapshots`、`observed_market_price`、promotion gate は決定論の不変条件であり、この goal では変更しない。
- `browser_observed_candidate` / 未昇格 `jpyCandidate` / heuristic-only は BuyLine 対象にしない。

## このフェーズでやること

1. **商品群を正本単位へ上げる**
   - item 単位の flat な見え方をやめ、product group を主役にする
   - 個別イベントは group の配下へ整理する
2. **AI 判断契約を明文化してコードへ入れられる形にする**
   - 商品同定
   - 商品群化
   - 抽選 / 販売 / 再販などのイベント分類
   - Tier 判定
   - 今見るべき理由
   - 不確実性 / 反証
3. **既存安全契約を壊さずに AI 主役化の土台を作る**
   - 価格計算
   - BuyLine
   - `priceSnapshots`
   - `observed_market_price`
   - promotion gate
4. **並行生成の実装土台を作る**
   - 軽い抽出
   - 強い同定
   - critic / disagreement handling

## 第1実装のスコープ

含む:

- 正本 docs の更新
- 商品群スキーマの導入
- AI 出力契約の導入
- 商品群 / イベント / 理由 / Tier の生成土台
- 回帰追加

含まない:

- 利益計算式の変更
- BuyLine ロジック変更
- `observed_market_price` 昇格条件の変更
- 既存価格 safety の緩和
- D6-B/C の現行順位ロジックを一気に壊す大改造

## 完了条件

1. 商品群を正本単位として表現できる最小データ構造が入る
2. AI の判断出力が、商品群 / イベント / Tier / 理由 / uncertainty を返せる形で定義される
3. 価格 safety と BuyLine safety が既存回帰で守られる
4. 新実装が「AI 主役だが価格は決定論で守る」という境界を壊していない

## 実装順

1. 正本方針の固定
2. 商品群スキーマ
3. AI 判断契約
4. 並行生成の導線
5. 回帰追加
6. 次段階で UI / 並び順の再設計へ進む

## 今回の安全境界

- `manual_price` / `confirmed_price` / 昇格済み `observed_market_price` だけが BuyLine 対象
- `browser_observed_candidate` / 未昇格 `jpyCandidate` / USD-only / unknown / AI / heuristic は BuyLine 不可
- AI 推定利益は確定利益へ混ぜない
- 公式 > X > ブログ/ニュース の優先順位を崩さない

## Archive

以下は 2026-06-10 時点の設計・調査メモ。価格正本まわりの過去検討として残す。現行タスクの主眼は上記を優先する。

---

## 確定した価格概念（表示方針・2026-06-10 受け入れ済み）

**ロジック変更なし。** BuyLine 式・`buyLineEligible`・rank・jpyCandidate 保存は現状維持。

| 項目 | 確定内容 |
|------|----------|
| MarketLens の役割 | 新品購入価格を自動決定しない。出口価格候補・確認材料を出す |
| 新品購入 | 公式・小売・ECを**人間が見て判断** |
| 定価・公式・小売 | **定価（新品基準）**として表示可。自動購入判断の確定価格ではない |
| jpyCandidate / browser_observed_candidate | **出口価格候補** / **フリマ出口候補**。売却側参考。BuyLine・priceSnapshots・observed_market_price 不可 |
| BuyLine（内部名） | UI では **参考ライン**・**判断補助**。「買ってよい上限」と誤読されない表現 |
| manual_price | **基準価格（シード）**。人間確認済みフリマ価格ではない |
| 禁止 UI ラベル | 相場 / 実勢価格 / フリマ相場 / 観測相場 / メルカリ相場 / 市場価格 |
| 静的シード残件 | `script.js` deals/releases に旧語「相場」残存（P1 外）。将来「売却参考」「参考売却価格」「出口参考」へ置換候補 |

**概要同期:** 上記が変わったら `marketlens-overview.*` + `GROK_HANDOFF.md` + 本ファイル + `AI_CONTEXT.md` + `WORKLOG.md` を同時更新（`AI_CONTEXT.md` 参照）。

---

## 参考: 2026-06-10 時点の価格昇格ポリシー草案

### 基本原則

| 価格種別 | 位置づけ | 正本 / BuyLine |
|----------|----------|----------------|
| `browser_observed_candidate` | 出口価格候補（フリマ出口候補・正本ではない） | **禁止** |
| `jpyCandidate` | 出口価格候補（Playwright 円候補・売却参考） | **禁止** |
| `manual_price` | 手動・公式価格 | 可（現行） |
| `historical_prediction` / `llm_mentioned_price` / heuristic | 推定・言及価格 | 原則不可 |
| `observed_market_price` | 昇格後の実測相場（未実装） | 将来可・別条件 |
| AI価格 / browser観測 / heuristic | **別種**として混同しない | 個別ゲート |

### 昇格禁止（常時）

1. `browser_observed_candidate` をそのまま正本価格として扱わない
2. `currency: unknown` の価格は `observed_market_price` 昇格禁止・BuyLine 禁止
3. **Mercari 由来が USD-only の間は昇格禁止**（JPY 実証なし）
4. JPY 実証なしの browser 観測価格は BuyLine 禁止
5. `buyLineEligible=false` を観測レイヤーで維持
6. UI で相場断定語（メルカリ相場 / フリマ相場 / 実勢相場 / 観測相場）を出さない

### `observed_market_price` へ昇格するために必要な条件（将来）

すべて満たすこと:

| # | 条件 |
|---|------|
| 1 | 取得元が明示（mercari / yahoo 等）かつ取得経路が文書化されている |
| 2 | **通貨が実証済み**（JPY は `¥`/`円` が rawPriceText に存在、USD は意図的な場合のみ） |
| 3 | `priceParseConfidence` が閾値以上（PM 合意値） |
| 4 | 販売状態が確認済み（`on_sale` 等、sold 断定は別フェーズ） |
| 5 | 鮮度（`observedAt`）が閾値以内 |
| 6 | `marketplaceSignalKey` 重複除外済み |
| 7 | 専用 regression が通過 |
| 8 | PM 明示承認 |

### BuyLine に使える価格

- 明示的に昇格済みの正本価格（`manual_price`、将来の `observed_market_price`）
- または PM 合意済みの信頼条件を満たす価格のみ
- browser 観測候補・AI 推定・heuristic は **BuyLine 材料にしない**

### UI 表現（2026-06-10 確定）

| 状態 | 許可ラベル |
|------|-----------|
| browser / jpy 候補止まり | 出口価格候補 / フリマ出口候補 / 判断補助対象外 / 売却参考 |
| 新品基準 | 定価（新品基準）/ 基準価格（シード） |
| 判断補助 | 参考ライン / 参考ライン未算出（内部 BuyLine） |
| 補助パネル | BuyLine未使用（内部名として残置可）/ 出口確認用 |
| 正本昇格後（将来） | PM 合意ラベルのみ。相場断定語は使用しない |

---

## 専用 regression 設計（`assertBrowserObservedPromotionGates`）

実装場所: `scripts/regression-check.mjs`

### チェック項目

| ID | 確認内容 | 実装 |
|----|----------|------|
| R1 | `browser_observed_candidate` が `priceSnapshots` に存在しない | ✅ 既存 + 強化 |
| R2 | `observed_market_price` 件数 0（browser 観測からの昇格なし） | ✅ 追加 |
| R3 | `buyLineBrowserMixDetected === false` | ✅ 既存 |
| R4 | 全 `marketplaceSignals` で `buyLineEligible === false` | ✅ 既存 |
| R5 | `currency: unknown`（明示）の `priceSnapshots` は BuyLine 不可 | ✅ 追加（`manual_price` の currency 未設定は対象外） |
| R6 | Mercari USD-only 時は `observed_market_price` 昇格なし | ✅ 追加 |
| R7 | `observed_market_price === 0` 時、禁止相場ラベルなし | ✅ 拡張（実勢相場/観測相場） |
| R8 | unknown listing は USD/JPY 表示に fallback しない | ✅ 既存（format 検証） |

### 意図的に regression でやらないこと

- USD を JPY へ機械置換するテスト（禁止）
- 昇格経路の本実装（大分類 6 着手後）

---

## USD-only 調査メモ（2026-06-09 追記）

**JPY 実証: 検索一覧経路では未取得。商品ページ経路では ¥ 表記を確認。**

- Jina 検索 markdown の listing 行: `US$16.74 タイトル](https://jp.mercari.com/item/m...)` 形式
- 同一商品の Jina 商品ページ markdown: `US$ 16.74 ( ¥ 2,555 為替レート... )` — JPY は存在するが **検索一覧パーサの正規表現が拾うのは US$ 部分のみ**
- `Accept-Language: ja-JP` を付けても検索 listing 行の US$ 表記は変わらない（2026-06-09 確認）
- `parseMercariListingPrice` は US$ を USD として正しく分類。unknown → USD fallback **なし**

**次の技術調査候補（実装は別タスク）:**

1. 商品ページ深掘りで ¥ を `listingCandidates` に入れる可否
2. 検索 markdown から `(¥2,555)` ブロックを追加パースする可否
3. USD 表記を「参考」として保持し JPY を別フィールドにするスキーマ案

---

## JPY 取得経路 技術調査（2026-06-09）

調査スクリプト: `scripts/marketlens-probe-mercari-jpy.mjs`（read-only、snapshot 非更新）

```bash
MERCARI_JPY_PROBE_LIMIT=5 node scripts/marketlens-probe-mercari-jpy.mjs
```

### A. 商品ページ深掘り方式

| 観点 | 結果（5件 probe） |
|------|-------------------|
| JPY 抽出 | **2/5** が `US$ X ( ¥ Y,YYY ... )` から JPY 取得（confidence 0.9） |
| 失敗パターン | 3/5 は fetch succeeded だが価格ブロック未検出（markdown 欠落・レイアウト差・rate limit 影響の可能性） |
| blocked / login_required | **0/5**（初回 probe） |
| http_429 | 連続 probe 時に発生（Jina rate limit）。本番は間隔・上限が必要 |
| 速度 | search ~0.4–0.6s / page ~0.4–7.5s（初回）。8件連続時は cache 寄りで ~0.2–0.3s |
| 送料混同 | `+ ¥300 手数料` を別検出。商品価格 `( ¥ 2,555` と区別可能 |
| 販売状態 | `on_sale` シグナル検出可。`sold` は今回サンプルでは未確認 |
| 価格対応 | 同一 item で search `US$16.74` ↔ page `¥2,555` が対応（為替併記ブロック） |

**将来のデータ持ち方（案・未実装）:**

| フィールド | 内容 |
|------------|------|
| `rawPriceText` | 検索一覧由来 US$（現行維持） |
| `currency` | 検索由来 USD（現行維持） |
| `jpyCandidate` | 商品ページ `( ¥ 2,555 )` からの整数 JPY（**別フィールド**） |
| `jpyRawPriceText` | 商品ページ抜粋（例: `¥ 2,555`） |
| `jpyCurrencyEvidence` | `product_page_jpy_parenthetical` 等 |
| `jpyConfidence` | 0.9（括弧併記）/ 低（standalone ¥） |
| `itemUrl` / `observedAt` | 現行維持 |

※ US$ を JPY に置換しない。JPY は **補助エビデンス** として別持ち。

### B. 検索 markdown 拡張パース方式

| 観点 | 結果 |
|------|------|
| listing 行の括弧 JPY | **0/5** — `searchParentheticalJpy` なし |
| listing 行の価格 | すべて `US$XX.XX` のみ（`LISTING_LINE_RE` が拾う部分） |
| 検索 markdown 内の ¥ | ページ下部・別セクションに `¥4,000` 等は存在するが **listing 行と item URL に紐づかない** |
| 為替換算 | **採用しない** |

**結論: 検索一覧のみでは JPY 実証不可。**

### JPY 取得経路ごとの採否判断

| 方式 | 採用する条件 | 採用しない条件 |
|------|-------------|----------------|
| **A. 商品ページ深掘り** | probe で **≥80%** が `product_page_jpy_parenthetical` を安定取得、429/blocked が許容範囲、送料と価格の分離が regression で担保できる | 成功率が低い、429/blocked/login_required が増加、JPY と USD の対応が不安定 |
| **B. 検索 markdown 拡張** | listing 行に `( ¥ X,XXX )` が **実データとして**出現し item URL と対応 | **現状該当なし** — 採用見送り |
| **為替換算** | — | **常に不採用** |
| **正本昇格（共通）** | JPY 実証 + 専用 regression + PM 合意後のみ | JPY 未実証、USD-only、unknown currency |

### 昇格ポリシーとの接続

1. **JPY 実証が取れない場合** — Mercari `browser_observed_candidate` は正本昇格禁止のまま（現行維持）
2. **JPY 実証が取れても** — 即 BuyLine / `observed_market_price` には進めない。専用 regression 拡張 + PM 合意が先
3. **第1蓄積データ（50/381 USD-only）** — 参考候補として保持。JPY 付与は **新規取得経路の別フェーズ**

### 推奨方針（調査時点）

**A（商品ページ深掘り）を次の技術検証候補とする。B は見送り。**

理由: 検索一覧は US$ のみで JPY 実証不可。商品ページは括弧併記 JPY が存在するが、成功率・rate limit・markdown 欠落があり、本実装前に probe 拡大（20–30件）とパーサ硬化が必要。

---

## Mercari JPY probe 拡大（2026-06-09 第2回）

調査スクリプト: `scripts/marketlens-probe-mercari-jpy.mjs`（read-only、snapshot 非更新）

### 環境変数（read-only オプション）

| 変数 | デフォルト | 意味 |
|------|-----------|------|
| `MERCARI_JPY_PROBE_LIMIT` | 5 | 1 バッチあたりの商品ページ件数 |
| `MERCARI_JPY_PROBE_START_INDEX` | 0 | snapshot `listingCandidates` の開始オフセット |
| `MERCARI_JPY_PROBE_DELAY_MS` | 3000 | 商品ページ fetch 間の待機（ms）。429 回避用 |
| `MERCARI_JPY_PROBE_SKIP_SEARCH` | — | `1` で検索一覧 fetch を省略（item page のみ） |
| `MERCARI_JPY_PROBE_TIMEOUT_MS` | 25000 | fetch タイムアウト |

**安全運用（今回確認済み）:**

- まず `LIMIT=5` で再実行 → 問題なければ `START_INDEX` をずらして追加バッチ
- `DELAY_MS` は **3000–4000** 推奨。`SKIP_SEARCH=1` で検索 fetch を省き 429 リスクを下げる
- 合計 **最大 15 件**まで（3 バッチ × 5）。`http_429` が出たら **即停止**（連続再試行しない）

```bash
MERCARI_JPY_PROBE_LIMIT=5 MERCARI_JPY_PROBE_DELAY_MS=3000 MERCARI_JPY_PROBE_SKIP_SEARCH=1 \
  node scripts/marketlens-probe-mercari-jpy.mjs

MERCARI_JPY_PROBE_LIMIT=5 MERCARI_JPY_PROBE_START_INDEX=5 MERCARI_JPY_PROBE_DELAY_MS=4000 MERCARI_JPY_PROBE_SKIP_SEARCH=1 \
  node scripts/marketlens-probe-mercari-jpy.mjs

MERCARI_JPY_PROBE_LIMIT=5 MERCARI_JPY_PROBE_START_INDEX=10 MERCARI_JPY_PROBE_DELAY_MS=4000 MERCARI_JPY_PROBE_SKIP_SEARCH=1 \
  node scripts/marketlens-probe-mercari-jpy.mjs
```

### 集計結果（15 件・3 バッチ）

| バッチ | START | DELAY | jpy_extracted | no_price_block | 429 / blocked / login |
|--------|-------|-------|---------------|----------------|------------------------|
| 1 | 0 | 3000 | 2/5 | 3/5 | 0 |
| 2 | 5 | 4000 | 2/5 | 3/5 | 0 |
| 3 | 10 | 4000 | 1/5 | 4/5 | 0 |
| **合計** | — | — | **5/15 (33%)** | **10/15** | **0** |

その他分類（今回 15 件）: `fee_only_detected` 0、`currency_note_only` 0、`sold_or_unavailable` 0、`fetch_failed` 0

**JPY 抽出成功パターン（代表）:**

- 抜粋: `US$ 16.74 ( ¥ 2,555 為替レート... )` + `+ ¥300 手数料`（手数料は商品価格と分離）
- `confidence` 0.9、`currencyEvidence` = `product_page_parenthetical_jpy`

### 失敗理由分類（`no_price_block` 代表 ≥3 件）

| itemId | 分類 | 観察（抜粋のみ） |
|--------|------|------------------|
| m25349069091 | no_price_block | HTTP 200、body ~5k 文字。`US$`/`¥` 価格ブロックなし（ナビ・サムネ止まり） |
| m82820130363 | no_price_block | 同上。markdown に価格領域が欠落（Jina レンダリング不完全） |
| m85807269120 | no_price_block | `on_sale` テキストは別行にあるが括弧 JPY ブロック未検出 |
| m69885671197 | no_price_block | 価格周辺トークンなし。正規表現以前に markdown 構造不足 |

**失敗の主因（今回サンプル）:**

1. **価格ブロック欠落** — Jina markdown が商品価格セクションまで到達していない（最多）
2. **括弧 JPY 未出現** — `¥` 単体や為替注記のみでは `jpy_extracted` にしない（混同防止）
3. **送料・手数料のみ** — 今回 15 件では `fee_only_detected` 0 だが、成功例では `+ ¥300 手数料` と `( ¥ 2,555 )` は分離可能
4. **SOLD / unavailable** — 今回 0。将来は `sold_or_unavailable` で除外候補
5. **regex 限界** — 一部は構造差ではなく **価格領域そのものが markdown に無い**

### rate limit 所見

| 条件 | 429 |
|------|-----|
| 連続 fetch・間隔なし（初回調査） | 発生あり |
| `DELAY_MS=3000–4000` + `SKIP_SEARCH=1`、15 件連続 | **0** |

本番 item page 深掘りを入れる場合は、**件数上限 + 間隔 + 429 即停止** を必須ゲートとする。

---

## `jpyCandidate` 設計草案（正本ではない・未実装）

`jpyCandidate` は **商品ページから得た JPY 補助エビデンス** を `listingCandidates` 配下に保持する案。  
`browser_observed_candidate` の USD 正本（`currency` / `rawPriceText`）は **置換しない**。

### スキーマ（案）

```json
{
  "jpyCandidate": {
    "amount": 2555,
    "currency": "JPY",
    "evidence": "product_page_parenthetical_jpy",
    "sourceUrl": "https://jp.mercari.com/item/m85365631751",
    "fetchedAt": "2026-06-09T12:00:00.000Z",
    "confidence": 0.9,
    "rawText": "US$ 16.74 ( ¥ 2,555 為替レート... )",
    "statusCandidate": "on_sale",
    "exclusionReason": null,
    "buyLineEligible": false
  }
}
```

| フィールド | 意味 |
|------------|------|
| `amount` | 整数 JPY（括弧内 `¥` から抽出） |
| `currency` | 常に `"JPY"` |
| `evidence` | 取得根拠（例: `product_page_parenthetical_jpy` / `product_page_standalone_yen`） |
| `sourceUrl` | 商品ページ URL |
| `fetchedAt` | item page fetch 時刻 |
| `confidence` | 0–1（括弧併記 0.9、standalone ¥ は低め） |
| `rawText` | 価格周辺の短い原文（全文 markdown は保持しない） |
| `statusCandidate` | `on_sale` / `sold_or_unavailable` / `unknown`（販売状態の候補・断定ではない） |
| `exclusionReason` | 昇格不可理由（例: `fee_only` / `currency_note_only` / `no_price_block`） |
| `buyLineEligible` | **初期値必ず `false`** |

### 混同リスクと除外

| リスク | 対策 |
|--------|------|
| 送料・手数料（`+ ¥300 手数料`） | `fee_only_detected` では `jpyCandidate` を作らない、または `exclusionReason: "fee_only"` |
| 為替注記（`為替レート` のみ） | `currency_note_only` — `amount` を設定しない |
| USD 正本との混同 | 検索由来 `currency: "USD"` / `rawPriceText` は維持。JPY は **別オブジェクト** のみ |
| 機械換算 | **禁止** — US$ から JPY を計算しない |
| UI 相場断定 | `jpyCandidate` を「相場」ラベルに使わない |

### 昇格条件（`observed_market_price` / BuyLine）

**初期状態:**

- `jpyCandidate.buyLineEligible === false`（必須）
- `observed_market_price` への自動昇格 **禁止**
- `priceSnapshots` への投影 **禁止**

**将来昇格する場合（すべて PM 合意 + 専用 regression 後）:**

1. 通貨実証（JPY が商品価格と紐づく）
2. 販売状態確認（sold 除外）
3. `marketplaceSignalKey` 重複除外
4. 鮮度（`fetchedAt` 閾値）
5. probe / 本番取得の成功率が PM 合意閾値（例: ≥80%）を満たす
6. 送料・手数料・為替注記の regression 分離
7. 専用 regression R9–R14 通過

---

## regression 拡張設計（`jpyCandidate` 向け）

実装場所: `scripts/regression-check.mjs`（`assertBrowserObservedPromotionGates`）

| ID | 確認内容 | 実装 |
|----|----------|------|
| R9 | `jpyCandidate` が `priceSnapshots` に存在しない | ✅ 追加 |
| R10 | `jpyCandidate.buyLineEligible !== true` | ✅ 追加 |
| R11 | `jpyCandidate.currency` があれば `JPY` のみ | ✅ 追加 |
| R12 | `jpyCandidate` 内に禁止相場ラベルなし | ✅ 追加 |
| R13 | USD-only `browser_observed_candidate` は引き続き BuyLine 不可 | ✅ 既存 R4–R6 |
| R14 | `currency: unknown` は引き続き BuyLine 不可 | ✅ 既存 R5 |

**UI regression（設計・将来）:** `scripts/ui-regression-check.mjs` に `jpyCandidate` 表示経路の grep 禁止を追加予定。現状 snapshot に `jpyCandidate` 未存在のため、script.js に `jpyCandidate` 参照が無いことで UI 相場混入なしを確認。（情報充足率/欠損管理のD-phases詳細はGROK_HANDOFF.md参照。ui-completeness-auditは不在。）

**意図的にやらないこと:**

- `jpyCandidate` の本パイプライン書き込み（大分類 6 前）
- USD → JPY 機械置換テスト
- `jpyCandidate` を使った BuyLine 計算の本実装

---

## Mercari 価格取得経路比較（Jina vs Playwright）（2026-06-09）

調査スクリプト（read-only、snapshot 非更新）:

| 経路 | スクリプト |
|------|-----------|
| Jina 商品ページ | `scripts/marketlens-probe-mercari-jpy.mjs` |
| Playwright browser | `scripts/marketlens-probe-mercari-browser-price.mjs` |

Playwright 実行例（非ログイン・headless・大量巡回なし）:

```bash
npm install playwright   # 初回のみ（worktree ローカル。Documents 正本には同梱しない）
node scripts/marketlens-probe-mercari-browser-price.mjs
```

環境変数: `MERCARI_BROWSER_PROBE_DELAY_MS`（default 4000）、`MERCARI_BROWSER_PROBE_HEADLESS`（default 1）、`MERCARI_BROWSER_PROBE_URLS`（`url|jinaResult|jinaJpy` カンマ区切り）

### 比較対象 URL（7 件）

| itemId | Jina 分類 | Jina JPY | Browser 分類 | Browser JPY |
|--------|-----------|----------|--------------|-------------|
| m85365631751 | jpy_extracted | 2555 | browser_jpy_extracted | 2555 |
| m98388895922 | jpy_extracted | 3888 | browser_jpy_extracted | 3888 |
| m90448368265 | jpy_extracted | 4000 | browser_jpy_extracted | 4000 |
| m25349069091 | no_price_block | — | browser_jpy_extracted | 2680 |
| m82820130363 | no_price_block | — | browser_no_price | — |
| m85807269120 | no_price_block | — | browser_jpy_extracted | 888 |
| m69885671197 | no_price_block | — | browser_jpy_extracted | 3333 |

### Jina vs Playwright 比較表

| 観点 | Jina 商品ページ（7件） | Playwright browser（7件） |
|------|------------------------|---------------------------|
| JPY 抽出成功率 | **3/7 = 43%** | **6/7 = 86%** |
| 価格ブロック欠落率 | **4/7 = 57%** (`no_price_block`) | **1/7 = 14%** (`browser_no_price`) |
| CAPTCHA / blocked / login_required | **0** | **0** |
| http_429 / rate limit | **0**（DELAY 3000 + SKIP_SEARCH） | 該当なし（自前 browser、今回 0 件） |
| 取得速度（平均） | ~438ms / page | ~2994ms / page（+ DELAY 4000ms） |
| 実装負荷 | 低（fetch + markdown 正規表現） | 中〜高（Playwright + Chromium + DOM 分類） |
| 運用負荷 | 低〜中（429 監視・間隔必須） | 中〜高（browser バイナリ・メモリ・遅延） |
| 正本価格へ進める見込み | **低**（欠落率高） | **中**（JPY 可視性は高いが関連価格ノイズあり） |
| 人間確認導線 | 弱い（markdown 欠落時は判断不可） | 強い（実ページと同じ可視テキスト） |

### browser 分類集計（7 件）

| 分類 | 件数 |
|------|------|
| browser_jpy_extracted | 6 |
| browser_no_price | 1 |
| browser_fee_only | 0 |
| browser_related_price_only | 0 |
| browser_sold_or_unavailable | 0 |
| browser_login_required | 0 |
| browser_blocked | 0 |
| browser_captcha_or_interstitial | 0 |
| browser_fetch_failed | 0 |

### 所見

**Jina `jpy_extracted`（3件）:** Playwright でも同一 JPY（2555 / 3888 / 4000）を取得。経路間で整合。

**Jina `no_price_block`（4件）:** Playwright は 3/4 で JPY 取得。1件（m82820130363）は可視テキストに `¥` トークンなし（`送料込み` 等の説明のみ）。Jina の markdown 欠落は **レンダリング差** が主因で、実ページには価格があるケースが多い。

**混同リスク（Playwright）:** 関連商品・「現在 ¥3,533」等の横断価格が `visible_yen_candidates` に混入。商品本体価格は多くの場合 **先頭の ¥ トークン** と一致するが、confidence は 0.45 程度に抑える（専用セレクタ硬化が必要）。

**m82820130363:** Jina も browser も価格未取得。DOM 構造差・遅延レンダリング・出品形式差の調査対象（大量再試行はしない）。

---

## Mercari 価格取得 採用方針草案（2026-06-09）

現時点の推奨: **A + B 補助 + C 少量検証**。Playwright が本番で不安定なら **D を強化**。

| 案 | 内容 | 推奨度 |
|----|------|--------|
| **A** | Jina 検索一覧は **候補 URL 収集 + US$ 参考候補** に限定して継続 | ✅ 採用 |
| **B** | Jina 商品ページは **補助 probe / 括弧 JPY 確認** に限定（正本化しない） | ✅ 補助 |
| **C** | Playwright は **少量の jpyCandidate 取得検証**（非ログイン・件数上限・遅延・CAPTCHA 即停止） | ✅ 次の技術検証 |
| **D** | Mercari 価格は **自動正本化せず人間確認導線を主**（`marketplaceResearchTargets` リンク） | ✅ 並行（C が不安定時に主軸） |

**C を本パイプラインに入れる前提（未達・P2）:**

- 商品本体価格セレクタの硬化（関連商品・横断価格の除外）
- `jpyCandidate` 書き込み経路の限定実装（観測レイヤーのみ）
- 成功率・blocked 率の PM 合意閾値
- regression R9–R14 + browser 専用ゲート

**大分類 6 へは進めない（P2 ブロッカー）:**

- JPY 抽出成功率が PM 閾値未達（Jina 33–43%、Playwright は今回 86% だが 7 件のみ）
- `jpyCandidate` 本パイプライン未実装
- 本番取得ポリシー（件数・間隔・429/CAPTCHA 停止）未合意
- 関連価格混同の regression 未整備

---

## P1 / P2 分類（2026-06-09 修正）

| 区分 | 内容 |
|------|------|
| **残 P1** | **なし**（混入ゼロ・regression 通過を維持） |
| **P2（大分類 6 ブロッカー — Mercari 自動正本化）** | JPY 安定取得未達、jpyCandidate 未実装、本番取得ポリシー未合意、関連価格混同対策未整備 |
| **P2（大分類 6 着手可 — 暫定 BuyLine）** | 安全価格ソース限定の BuyLine 算出・regression 固定 |

---

## 全領域 100% へ向けた効率順ロードマップ（2026-06-09）

Mercari 自動正本化を待たず、全体を止めないための進行順。

| 順 | 大分類 | 方針 |
|----|--------|------|
| **1** | **価格正本 / BuyLine** | `manual_price` 等の安全価格のみで **暫定 BuyLine** を成立。Mercari 観測価格は対象外 |
| **2** | **UI / ダッシュボード** | BuyLine 未算出・参考候補・確認導線を誤解なく表示 |
| **3** | **価格観測レイヤー** | Mercari 参考候補・`jpyCandidate`・Playwright を隔離維持しつつ改善 |
| **4** | **フリマ確認導線** | Playwright / 人間確認を少量運用へ接続 |
| **5** | **商品候補収集・正規化** | 重複・分類・候補品質改善 |
| **6** | **AI / Gemini 基盤** | 理由説明・分類・要約・fallback 強化 |
| **7** | **SNS観測** | 断定表示を避けた参考シグナル改善 |
| **8** | **引き継ぎ・運用** | status / regression / localhost / handoff 固定化 |

**原則:** Mercari 由来の `browser_observed_candidate` / `jpyCandidate` は参考候補のまま後続改善。100% 到達時に Playwright 由来 `jpyCandidate` 昇格を検討するが、今回対象外。

---

## 暫定 BuyLine 仕様（大分類 6 — 2026-06-09 着手）

### 基本方針

| 項目 | ルール |
|------|--------|
| Mercari 自動観測 | **BuyLine に使わない** |
| 算出元 | **安全価格ソースのみ** |
| 安全価格なし | `buyLineStatus: "unavailable"`（UI は未算出表示） |
| 参考候補 | `browser_observed_candidate` / `jpyCandidate` は確認用のみ |
| UI | 「参考価格候補」「確認する」まで。相場断定語禁止 |
| Mercari 自動正本化 | 後続改善（P2）として残す |

### BuyLine 入力ソース棚卸し

**使用可（暫定）**

| ソース | rank / 経路 | 備考 |
|--------|-------------|------|
| 手動価格 | `manual_price` | deals / pokemonReleases / kuji_special / deal-sell-price 等 |
| 確認済み価格 | `confirmed_price` | 将来 rank。現状未出力。**`manual_price` と同等扱い** |
| priceSnapshots（正本） | `manual_price` + `buyLineEligible: true` | 現状 snapshot は manual のみ BuyLine 可 |

**使用不可（暫定・常時）**

| ソース | 理由 |
|--------|------|
| `browser_observed_candidate` | Mercari 参考候補。`buyLineEligible: false` 固定 |
| `jpyCandidate` | 商品ページ JPY 補助。正本・BuyLine 不可 |
| Jina 由来 US$ 価格 | 通貨実証不足。BuyLine 不可 |
| `currency: unknown` | BuyLine 不可 |
| `historical_prediction` | 履歴推定・予測 |
| `llm_mentioned_price` | 記事中価格 |
| `ai_estimate` | AI 価格仮説 |
| `specialized_estimate` | 専門推定 |
| SNS 由来の価格らしき値 | 参考のみ |
| Playwright probe 価格 | 調査用。snapshot 非書込 |

**条件付き（今回新規作成しない）**

| ソース | 将来条件 |
|--------|----------|
| `observed_market_price` | PM 合意 + 専用 regression + 通貨実証 + 販売状態 + 鮮度 + 重複除外 |

### 実装（暫定）

| 場所 | 内容 |
|------|------|
| `scripts/marketlens-buyline.mjs` | 暫定 BuyLine 許可 rank・`assertProvisionalBuyLineGates` |
| `script.js` | `calculateCandidateMarketProfit` を `manual_price` / `confirmed_price` のみに限定。`buyLineStatus` 返却 |
| `scripts/regression-check.mjs` | 暫定 BuyLine ゲート追加（R15 相当） |

### regression（暫定 BuyLine — R15+）

| ID | 確認内容 |
|----|----------|
| R15 | `priceSnapshots` の BuyLine 対象は `manual_price` のみ |
| R16 | `browser_observed_candidate` / `jpyCandidate` が BuyLine に使われない |
| R17 | Jina US$ / currency unknown が BuyLine に使われない |
| R18 | AI / heuristic / predicted が BuyLine に使われない |
| R19 | 安全価格なしは BuyLine 未算出（UI 計算 null） |
| R20 | 禁止相場ラベルなし |

### TODO（大きくなるため今回未実装）

| # | 内容 | 読むべきファイル |
|---|------|------------------|
| T1 | `postprocess` で candidate の `marketPriceBuyLineEligible` を暫定 rank で再計算 | `scripts/postprocess-marketlens-snapshot.mjs` |
| T2 | Deal / Release 行に `buyLineStatus` 表示 | `script.js` — **2026-06-09 UI統一で着手済み** |
| T3 | `observed_market_price` 昇格経路（PM 合意後） | `scripts/collect-marketlens.mjs`, `TASK.md` |
| T4 | Playwright `jpyCandidate` 本パイプライン（観測レイヤーのみ） | `scripts/marketlens-probe-mercari-browser-price.mjs` |

---

## UI / ダッシュボード — BuyLine 表示統一（2026-06-09）

ロードマップ #2 着手。Deal / Release / Candidate で以下を統一。

### UI 状態

| 状態 | 表示 |
|------|------|
| `buyLineStatus: "available"` | BuyLine 金額・想定利益を表示（`manual_price` / `confirmed_price` のみ） |
| `buyLineStatus: "unavailable"` | 「BuyLine未算出」「利益未算出」。0円表示禁止 |
| `referenceCandidateOnly` | 「参考価格候補」+ 確認導線（メルカリ検索等） |

### 実装

| 場所 | 内容 |
|------|------|
| `script.js` | `formatBuyLineDisplay` / `resolve*BuyLineUiState` / `candidateReferencePriceLabel` |
| `styles.css` | `.buyline-unavailable` / `.profit-unavailable` / `.reference-candidate-only` |
| `postprocess-marketlens-snapshot.mjs` | candidate `*BuyLineEligible` を暫定 rank で再計算、`buyLineStatus` 付与 |
| `ui-regression-check.mjs` | 未算出0円禁止・禁止相場ラベル・参考候補文言 |

### 禁止 UI（維持）

メルカリ相場 / フリマ相場 / 実勢相場 / 観測相場 — `marketplaceResearchTargetLabel` から除去済み。snapshot 内旧文言は `sanitizeForbiddenMarketUiText` で表示時置換

### 実画面・postprocess 確認（2026-06-09）

- `node scripts/postprocess-marketlens-snapshot.mjs` で `buyLineStatus` 反映: available **8** / unavailable **663** / missing **0**
- localhost と Documents snapshot 一致（`updatedAt` 同一）
- 実画面: BuyLine未算出 **267**、利益未算出 **107**、参考価格候補 **196**、禁止相場ラベル表示なし（サニタイズ後）

---

## ロードマップ #3 — 価格観測レイヤー（2026-06-09 再着手）

ロードマップ #2「UI / ダッシュボード」は一区切り。#3 に戻り、Mercari 隔離維持 + `jpyCandidate` 設計整理を進める。

### 今回の到達点

| 項目 | 状態 |
|------|------|
| `browser_observed_candidate` 隔離 | ✅ 維持（priceSnapshots / observed_market_price / BuyLine 不可） |
| 生成側旧文言 | ✅ `collect-marketlens.mjs` の「観測相場」→「安全価格」「参考価格」へ置換 |
| `jpyCandidate` 設計 | ✅ 本節 + 下記スキーマ確定寄り（**snapshot 未書込**） |
| Playwright probe | ✅ 関連価格ノイズ（`現在 ¥...`）の低 confidence / 除外分類を軽微改善 |
| regression R9–R14 | ✅ 実装済み |
| regression 生成側ゲート | ✅ `collect-marketlens.mjs` 禁止ラベル grep |
| ui-regression jpyCandidate | ✅ 設計ゲート追加（script.js 非参照・priceSnapshots 非投影） |

### `jpyCandidate` 保持設計（Playwright 由来・未実装）

**位置づけ（厳守）:**

| 項目 | ルール |
|------|--------|
| 正本価格 | **ではない** |
| BuyLine | **対象外**（`buyLineEligible: false` 必須） |
| 保存先候補 | `marketplaceSignals[].listingCandidates[].jpyCandidate` または別 observation detail |
| `priceSnapshots` | **入れない** |
| `observed_market_price` | **raw candidate からは直接昇格しない** |
| UI | 「参考価格候補」「確認する」まで。相場断定語禁止 |

**候補フィールド案（Playwright `playwright_product_page` 経路）:**

```json
{
  "jpyCandidate": {
    "amount": 2555,
    "currency": "JPY",
    "source": "playwright_product_page",
    "sourceUrl": "https://jp.mercari.com/item/m85365631751",
    "fetchedAt": "2026-06-09T12:00:00.000Z",
    "rawText": "US$ 16.74 ( ¥ 2,555 為替レート... )",
    "selectorEvidence": "[data-testid='price']",
    "visibleTextSnippet": "¥2,555 送料込み",
    "statusCandidate": "on_sale",
    "confidence": 0.75,
    "exclusionReason": null,
    "buyLineEligible": false
  }
}
```

| フィールド | 意味 |
|------------|------|
| `amount` | 整数 JPY（商品本体価格候補） |
| `currency` | 常に `"JPY"` |
| `source` | `"playwright_product_page"`（Jina 経路は `"product_page_parenthetical_jpy"` 等で区別） |
| `sourceUrl` | 商品ページ URL |
| `fetchedAt` | Playwright fetch 時刻 |
| `rawText` | 価格周辺の短い原文 |
| `selectorEvidence` | DOM セレクタ根拠（probe 由来） |
| `visibleTextSnippet` | 可視テキスト抜粋（人間確認用） |
| `statusCandidate` | `on_sale` / `sold_or_unavailable` / `unknown` |
| `confidence` | 0–1（括弧併記 0.9、関連価格ノイズありは ≤0.4） |
| `exclusionReason` | `related_price_noise` / `fee_only` / `browser_no_price` 等 |
| `buyLineEligible` | **必ず `false`** |

**将来 `observed_market_price` / BuyLine へ昇格する場合（すべて必須）:**

1. PM 明示合意
2. 通貨実証（JPY が商品価格と紐づく）
3. 販売状態確認（sold 除外）
4. 鮮度（`fetchedAt` 閾値）
5. `marketplaceSignalKey` 重複除外
6. 関連価格ノイズ除外（`現在 ¥...` 等）の regression 通過
7. 専用 regression R9–R14 + 昇格ゲート通過

### Playwright probe — 本パイプライン接続の残条件（P2）

| 条件 | 現状 |
|------|------|
| 商品本体 vs 関連価格分類 | 軽微改善済み（`現在 ¥` ノイズ除外）。専用セレクタ硬化は未 |
| `browser_no_price` | confidence 0、`browserJpyCandidate: null` で返却。本パイプライン未接続 |
| CAPTCHA / login / blocked | 分類済み。検出時は probe 即停止 |
| snapshot 書込 | **未実装**（read-only probe のまま） |
| 件数上限・遅延・429 停止 | probe 環境変数のみ。本番ポリシー未合意 |
| regression（関連価格混同） | probe 内分類のみ。本番データ向け R は未 |

### Mercari probe スキップレジストリ（2026-06-09）

`metadata.mercariProbeSkipRegistry` に blocked / CAPTCHA / login_required URL を記録し、**7日TTL** で再probeを抑制。

| 項目 | 方針 |
|------|------|
| 保存先 | `snapshot.metadata.mercariProbeSkipRegistry` |
| 対象 | `browser_blocked` / `browser_captcha_or_interstitial` / `browser_login_required` |
| listing側 | `playwrightProbeStatus`（`exclusionReason` + `buyLineEligible:false`）。**jpyCandidate にはしない** |
| 選定 | `selectMercariProbeTargets` が skip URL を除外 |
| 集計 | `marketlens-status` → `observation.jpyCandidate.mercariProbeSkip` |
| 禁止 | CAPTCHA回避・ログイン突破・大量巡回 |
| 効果測定 | `targetSelection.reprobeSuppressedCount` / `skipUrls` を各バッチで記録。`jpyCandidateProbeHistory` に batch1–3 を保持 |
| 通常UI参考表示 | `marketplaceJpyReferenceLine` — 「出口価格候補 ¥X · Playwright確認用 · 判断補助対象外 · 人間確認待ち」。利益計算・BuyLine非連動 |

### settings削除 + overview全面増強（2026-06-09）

| 項目 | 内容 |
|------|------|
| settings | UI・ナビ・DOM・localStorage・イベントを削除。計算は `state.settings` 固定値 |
| 固定設定 | feeRate=5% / targetProfit=¥1500 / priceBuffer=3% / packingCost=¥80 |
| overview | プロダクト理解用に全面増強（モジュール表・データフロー・BuyLine境界・ライブ指標・P1一覧） |
| 第4バッチ | UI/overview整理後に再開（今回は未実施） |

### UI導線・settings・近日チェック修正（2026-06-09）

| 項目 | 内容 |
|------|------|
| settings不具合原因 | vnext `index.html` から `#lotterySection` / `#feeRate` 等の settings DOM が欠落。ナビ `data-section="settings"` が `hidden`。`readSettings` の入力先が null |
| settings修正 | `#lotterySection` 復旧、ナビ表示、`applySettingsToDom` + `marketlens-settings` localStorage |
| ページ切替 | 通常画面・overview 双方に `site-nav`（通常画面 / 全体概要） |
| 近日チェック日付 | `startDate` / `startTs` を snapshot 候補・trend・route から `parseFlexibleTs` で取得。基準日は `startOfTodayTokyoTs()`（Asia/Tokyo）でロジック計算 |
| 近日チェック仕様 | `startDayIndex > 0` かつ 3〜14日のみ「近日チェック」。表示は「開始まで○日」。今日以前開始は「開催中」で今すぐ見る側。日付不明は「開始日未確認」 |
| 開始済み混入原因 | `periodKind === "active"` を無条件に `soon` へ落とす分岐と、絶対時刻 `Date.now()` 比較（「あと○日」）が開始前/開始済みを混同 |

### TODO（大きくなるため今回未実装）

| # | 内容 |
|---|------|
| T5 | ~~Playwright `jpyCandidate` 観測レイヤー限定書込~~ | **2026-06-09 実装** — `marketlens-jpy-candidate-cycle.mjs`（LIMIT=25/バッチ） |
| T8 | `marketlens-overview.html` 追加 | **2026-06-09 実装** |
| T6 | 関連価格ノイズ専用 regression（snapshot 内 `jpyCandidate` サンプル向け） |
| T7 | ~~`selectionReasons` 旧文言除去~~ | **2026-06-09 完了** — `postprocess` → `sanitizeSnapshotClaims` で `観測相場`→`参考価格`（458→0件）。次回 collect は生成側新文言で再構築 |
