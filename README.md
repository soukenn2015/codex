# MarketLens

ホビー市場の抽選・再販・価格差候補を見て、BuyLineと保守利益をすぐ判断する個人用リサーチAIプロトタイプ。

## Current Rules

- 販売手数料: 5%
- ポケカBOX送料: 210円
- ポケカBOX: 抽選/再販の定価購入をメインルートにする
- ポケカBOX: 通常の価格差候補とは別枠で、弾ごとの「抽選ルート + スニダン参考相場」を表示する
- ポケカBOX: タイトル未発表の次弾は画面に出さず、発表後に弾別枠へ追加する
- ポケカBOX: 弾別枠は折りたたみ可能にし、通常時はサマリーだけ表示する
- 通常の価格差候補にはポケカを表示しない
- 抽選ルート: ネット枠と大阪店舗枠を分ける
- 抽選期限が過ぎたルートは非表示にする
- 主な発売期間が終わった弾は非表示にする
- 応募済みチェックは弾名、店舗名、応募回、期限で別管理する
- 弾カードの確認リンクはスニダン相場記事へ、各応募行のリンクは応募/参考ルートへ飛ぶ
- 通常の価格差候補にもリンクを表示し、手動追加時もURLを入力できる
- 価格差候補は「販売中」「予定」「要再確認」で分ける
- 価格差候補にも「販売中/予定」と「価格差あり/要再確認」を表示する
- ポケカ弾別カードは「発売中/未発売」と「抽選中/再販中/抽選前」を分けて表示する
- ポケカ弾別カードのフィルタは「期間中」と「予定」で切り替える
- 急上昇は即追加せず、AI検証後に「検証中」「追加候補」「監視入り」「保留」で候補化する
- ワンピース/ドラゴンボールは一番くじに限定せず、IP全体としてフィギュア、限定グッズ、時計コラボ、抽選販売を監視する
- 一番くじは特設枠を持ち、発売時期、ラストワン賞、上位賞、成約推移を別管理する
- 一番くじ特設は直近1ヶ月の発売日順で表示し、表示期限を過ぎた弾は履歴だけに残す
- 急上昇はジャンル名ではなく、ラストワン賞や具体モデル名まで出す
- Up To Date、HOBBY Watch、電撃ホビーウェブ/電撃オンライン、DMM通販抽選、一番くじ公式を参考ソースにする
- DMM通販抽選は定価抽選、BANDAI SPIRITS、人気IP、受付期限ありの商品だけを候補化する
- 時計はコラボ時計/G-SHOCK/アニメIP限定モデルを監視し、定価、販売場所、在庫、ノベルティ、成約価格を別枠で履歴化する
- 厚み4cm以下送料: 210円
- 厚み4cm超え送料: 750円
- 厚み不明送料: 750円
- ライト/ダークモード切り替えあり

## Formula

```text
保守利益 =
想定売価 - 手数料 - 送料 - 梱包費 - 値下げ余地 - 購入価格

BuyLine =
想定売価 - 手数料 - 送料 - 梱包費 - 値下げ余地 - 目標利益
```

## Open

```text
http://localhost:4173/
```

## Share With Friends

公開URL:

```text
https://soukenn2015.github.io/codex/
```

GitHub Pages は `.github/workflows/deploy-pages.yml` で自動デプロイする。
毎日 8:00 / 20:00 JST の2回、GitHub Actions が collector を実行して `data/marketlens.snapshot.json` と `data/marketlens.history.json` を更新し、公開ページへ反映する。

手動更新したい場合は GitHub Actions の `Deploy MarketLens to GitHub Pages` を `workflow_dispatch` で実行する。

ローカルで確認する場合だけ、次を実行する。

```text
node scripts/collect-marketlens.mjs
node scripts/update-cachebuster.mjs
```

## Data Pipeline

MarketLensは固定のSeed dataで起動し、存在する場合は `data/marketlens.snapshot.json` を読み込んで上書きする。

外部ソースの取得設定は `data/source-config.json` に置く。取得してスナップショットを更新する場合:

```text
node scripts/collect-marketlens.mjs
```

ブラウザ側の「更新」ボタンは、生成済みの `marketlens.snapshot.json` を再読み込みする。外部サイトへの直接アクセスはNode側のcollectorで行う。

公開版では GitHub Actions が定期的に collector を実行する。collector 実行後は cachebuster を更新し、古い `script.js` / `styles.css` が残りにくい状態でデプロイする。

`source-config.json` の `marketMemory` は、過去の話題性・相場・販売導線を蓄積する裏側の学習データ。画面には出さず、次回以降の優先度判断に使う。

collectorは毎回、最新表示用の `data/marketlens.snapshot.json` に加えて、履歴用の `data/marketlens.history.json` に取得結果を追記する。保存対象は、利益候補、急上昇、AI検証候補、一番くじ特設、学習メモ、ポケカ弾別、取得ソース結果。

フリマ/ECの価格差候補は `data/deal-candidates.csv` に追加する。collector実行時に `deals` としてsnapshotへ取り込まれ、画面側で手数料5%、送料210/750円、梱包費、値下げ余地込みの利益計算が走る。

必須列:

```text
name,shop,buyPrice,sellPrice,category,releaseUrl
```

`category` は `thin`、`large`、`pokemon_box`、`unknown` のいずれか。
`releaseUrl` は発売元・販売元の商品ページを入れる。フリマや相場確認ページは `marketUrl` に分ける。

## Daily Digest

ブラウザ側の通知は、画面を開いている間に毎朝8時以降で1日1回だけ送る。設定は計算条件の「毎朝8時通知」から許可する。

通知内容:

```text
利益候補件数 / 抽選ルート件数 / 想定利益 / 注目候補 / 急上昇
```

ブラウザを閉じていても動く定期通知は、Codex側の毎朝8時オートメーションでcollectorを実行して、このスレッドへダイジェストを返す。

手動で同じダイジェストを確認する場合:

```text
node scripts/daily-digest.mjs
```

collector失敗時に自動再開し、最後は必ずダイジェストを出す実行:

```text
node scripts/run-marketlens-cycle.mjs
```

環境変数で再試行回数を調整できます:

```text
MARKETLENS_RETRIES=5 MARKETLENS_RETRY_DELAY_MS=20000 node scripts/run-marketlens-cycle.mjs
```

## Regression Check

スナップショット整合性の軽量回帰チェック:

```text
node scripts/regression-check.mjs
```

UI判定ロジックの軽量回帰チェック:

```text
node scripts/ui-regression-check.mjs
```
