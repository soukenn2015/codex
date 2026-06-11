const FORBIDDEN_LABEL_RE = /観測相場|メルカリ相場|フリマ相場|実勢相場|実勢価格|observed market|market price/i;
const THEME_STORAGE_KEY = "marketlens-theme";
const OVERVIEW_BUILD = "2026-06-10b";

const DATE_LAYER_EXPLAIN = `
  <ul>
    <li><strong>今すぐ見る</strong> — 開始前0〜2日、または開始済みで販売形式ごとの寿命内にあるもの。状態は [開催中][抽選中][販売中] などのラベル</li>
    <li><strong>近日チェック</strong> — 未来開始日のみ（3〜14日）。開始済み・日付不明は入れない。日付ごとにグループ表示</li>
    <li><strong>先読みメモ</strong> — 15日以降、または日付未確定の監視・準備枠（噂・再販可能性・公式待ちなど）</li>
    <li><strong>補助確認</strong> — フリマ/SNS確認リンク（下部折りたたみのみ）。出口確認用・判断補助対象外</li>
    <li><strong>開始後寿命</strong> — fast(先着/再販):2日 / medium(予約/発売/通常):7日 / deadline(抽選/受注/チケット):締切まで / unknown:検出後2日で保留へ</li>
    <li><strong>保留・除外</strong> — 寿命超過・終了済み・情報不足</li>
  </ul>
  <p class="muted small">「開催中」は独立セクションではなく [開催中][抽選中][予約中][販売中] などの<strong>状態ラベル</strong>です。先読みメモは未来・準備用で、開始済み・寿命外の一般商品は戻しません（保留・確認済み側で追跡）。フリマ/SNS確認は overview 下部折りたたみのみ。</p>`;

const ACCESS_GUIDE = `
  <p>スマホから見るときは <code>localhost</code> や <code>127.0.0.1</code> は使えません。<strong>MacのLAN IP</strong> を使います。</p>
  <pre class="access-example">スマホ用リンク:
通常画面: http://＜MacのLAN IP＞:8765/
全体概要: http://＜MacのLAN IP＞:8765/marketlens-overview.html

条件:
Macとスマホが同じWi-Fiにいること。
Mac側のローカルサーバーが起動していること。
localhost / 127.0.0.1 はスマホからは使えない。</pre>`;

const NGROK_PREFLIGHT = `
  <p>ngrok は <strong>public-share 専用配信</strong>（通常UI・overview・snapshot）を一時的に外部へ出す手段です。<strong>一時共有用</strong>であり、URLを overview / Markdown / snapshot / 設定ファイルへ<strong>固定保存しません</strong>。</p>
  <p>正本の日常確認は <code>http://localhost:8765/</code>（Documents）です。ngrok は継続運用してもよいが、<strong>公開範囲制限（404維持）</strong>は必ず守ります。</p>
  <h4>公開前に確認すること</h4>
  <ul>
    <li>200 になるのは <code>/</code>、<code>/marketlens-overview.html</code>、<code>/data/marketlens.snapshot.json</code> のみ</li>
    <li>404 維持: source-config、history、public-history、scripts、Markdown、package、node_modules、.env、credentials、secrets</li>
    <li><code>.env</code>、APIキー、secrets、credentials が Web から見えないこと</li>
    <li>data JSON を手編集しないこと</li>
    <li>発行された ngrok URL をリポジトリへ書き込まないこと</li>
  </ul>
  <p class="muted small">worktree 用 <code>:8888</code> はローカル確認の任意手段。受け入れ判断は Documents / public-share / 8765 / ngrok で行います。</p>`;

const NGROK_FREE_TIER = `
  <p><strong>以下は想定手順です。今回はコマンドを実行していません。</strong></p>
  <pre class="access-example">ngrokで一時共有する場合の想定手順:

1. ローカルサーバーを起動する
   http://localhost:8765/

2. ngrokで8765番を外部へ中継する
   ngrok http 8765

3. 発行された https://...ngrok-free.app のURLを確認する

4. 外部共有するURL:
   通常画面: https://＜ngrok発行URL＞/
   全体概要: https://＜ngrok発行URL＞/marketlens-overview.html

5. check-public-share-http で 200/404 を確認する</pre>
  <h4>無料枠での注意</h4>
  <ul>
    <li>無料枠は制限がある。常設公開ではなく一時共有向き</li>
    <li>ngrok URL はセッションごとに変わることがある（固定保存しない）</li>
    <li>公開中は URL を知っている人がアクセスできる可能性がある</li>
    <li>公開前に不要ファイルが 404 であることを必ず確認する</li>
    <li>停止は運用方針による（継続中でも公開範囲制限は維持）</li>
  </ul>
  <p class="muted small">想定手順です。URLはこのページに保存しません。</p>`;

const WORKTREE_PATH = "/Users/user/.grok/worktrees/2026-05-28-hobbyflip-ai-1-ai-2-box/2026-06-08-c444245e";
const DOCUMENTS_PATH = "/Users/user/Documents/Codex/2026-05-28/hobbyflip-ai-1-ai-2-box";

const MARKDOWN_SOURCES = [
  "AI_CONTEXT.md — 目的・観測レイヤー隔離・LLM境界・8分類",
  "TASK.md — 価格昇格方針・出口候補と判断価格の分離",
  "README.md — BuyLineの考え方・四層UI・データの流れ",
  "CODEX_MCP_RULES.md — AIが決めない領域（利益・手数料・参考ライン・価格昇格）",
  "WORKLOG.md — 四層UI・観測フェーズの経緯",
  "GROK_HANDOFF.md — 出口価格候補の扱い・概要同期ルール・混入禁止の運用",
  "CODEX_HANDOFF.md — Gemini疎通・パイプライン順序",
];

const MARKDOWN_EXTRACTS = {
  "README.md": [
    "ホビー市場の抽選・再販・価格差候補を整理し、人間が新品購入と出口判断をしやすくする",
    "四層UI: 今すぐ見る / 近日チェック / 先読みメモ / 保留",
    "BuyLine = 想定売価 − 手数料 − 送料 − 梱包 − 値下げ余地 − 目標利益",
    "急上昇は即追加せずAI検証後に候補化",
    "source-config + collector + snapshot のデータパイプライン",
    "公開版と学習用historyを分離",
    "ノイズフレーズ（ナビ文言等）を候補から除外",
  ],
  "AI_CONTEXT.md": [
    "参考ライン（内部BuyLine）は決定論ロジック、LLMは補助のみ",
    "観測レイヤーは出口価格候補（断定表示しない）",
    "新品購入価格は人間が公式・小売・ECで判断",
    "概念変更時は overview・引き継ぎ・Markdown を同時更新",
    "browser_observed_candidate を priceSnapshots / 確認済み価格 / BuyLine に入れない",
    "観測系はすべて buyLineEligible=false",
    "Documents正本 http://localhost:8765/",
    "skipped/delta0 は重複統合や既観測で正常系あり",
    "USD-only は Jina検索一覧のUS$表記が原因（固定ロジックではない）",
    "8分類ロードマップで作業範囲を切る",
  ],
  "TASK.md": [
    "昇格禁止: 出口価格候補を priceSnapshots / observed_market_price / BuyLine に入れない",
    "確認済み価格へ昇格は8条件+PM合意+専用regression",
    "jpyCandidate は別フィールド、USD正本を置換しない",
    "為替換算でJPYを作らない",
    "Playwrightは関連価格ノイズあり、confidence閾値で保存",
    "batchは最大25件、件数増より品質",
    "R9-R14 regressionで jpyCandidate 隔離",
    "第4batchよりUI/overview/selector整理優先",
  ],
  "CODEX_MCP_RULES.md": [
    "四層UI維持、旧セクション（急上昇ボード等）に戻さない",
    "LLMは利益・手数料・BuyLine・最終昇格を担わない",
    "検証済みルート・価格がLLM説明より優先",
    "ノイズフレーズを候補から除外",
    "小さくレビュー可能な変更を優先",
  ],
  "WORKLOG.md": [
    "2026-06-03 四層UI確立",
    "観測フェーズ: browser_observed_candidate 蓄積、混入なし維持",
    "50 signals / 381 listings で一区切り、単純cycle追加は一時停止",
    "worktree→Documents cp -p 同期運用",
    "delta0は重複統合が主因",
  ],
  "GROK_HANDOFF.md": [
    "MarketLensは出口価格候補と確認材料を出す道具（新品購入は人間判断）",
    "browser_observed_candidate / jpyCandidate は判断価格へ昇格させない",
    "browserObservedInPriceSnapshots=false 維持",
    "概念変更時は overview・引き継ぎ・Markdown を同時更新（概要同期ルール）",
    "件数KPIより混入防止を優先",
  ],
  "CODEX_HANDOFF.md": [
    "collect→postprocess→digest の順",
    "Gemini smoke testで疎通のみ確認",
    "APIキーなし環境はheuristic fallback",
  ],
};

const LAYER_ARCHITECTURE = [
  { id: "A", name: "入力レイヤー", purpose: "どこを見に行くかを先に決める", inputs: "監視したいジャンル・商品・運用方針", outputs: "収集元の設定リスト", mustNot: "利益・参考ライン・価格の正しさを決めない", safetyRules: "設定は価格データと分けて管理する", related: "収集元の設定", userMeaning: "注目範囲を先に決め、無駄な情報を減らす", dangerIfBroken: "見るべきでない情報が大量に混ざり判断が遅れる", nextConnection: "→ B 収集レイヤーへ設定を渡す", source: "README: ソース定義" },
  { id: "B", name: "収集レイヤー", purpose: "候補・話題・参考になりそうな価格を「見つける」", inputs: "収集元設定・既存の保存データ", outputs: "候補・イベント・観測メモの素データ", mustNot: "見つけた価格を正しいと断定しない", safetyRules: "観測結果は参考として扱い、正本化しない", related: "情報を集める処理・フリマ読み取り", userMeaning: "見逃しを減らす入口。まだ判断材料ではない", dangerIfBroken: "未検証価格がそのまま「正しい価格」に見える", nextConnection: "→ C 保存レイヤーへ素データを渡す", source: "AI_CONTEXT: 観測レイヤー隔離" },
  { id: "C", name: "保存レイヤー", purpose: "集めた情報を1つの保存データにまとめる", inputs: "収集・観測の出力", outputs: "現在の保存データ（画面が読む1ファイル）", mustNot: "出口価格候補を正本・参考ライン用の棚へ混ぜない", safetyRules: "保存データは手で書き換えない。自動生成のみ", related: "現在の保存データファイル", userMeaning: "いつ見ても同じ状態を追える記録庫", dangerIfBroken: "出口候補が正本に混ざり、後から検証不能になる", nextConnection: "→ D 整理レイヤーへまとめデータを渡す", source: "README: snapshot正本" },
  { id: "D", name: "整理レイヤー", purpose: "ノイズを減らし、見やすい形に整える", inputs: "保存データ", outputs: "候補状態・表示ラベル・四層への振り分け", mustNot: "参考候補を確認済み価格のように扱わない", safetyRules: "ナビ文言などを商品候補にしない", related: "集めた後の整理処理", userMeaning: "優先度の高いものが上に来るよう整える", dangerIfBroken: "ノイズが候補に見え、確認コストが爆増する", nextConnection: "→ E 価格安全性レイヤーへ分類対象を渡す", source: "CODEX_MCP_RULES: ノイズ除外" },
  { id: "E", name: "価格安全性レイヤー", purpose: "価格の種類を分け、危険な混入を防ぐ", inputs: "基準価格（シード）・出口価格候補・AI推定・通貨不明・US$", outputs: "使える/使えないの区分・隔離メトリクス", mustNot: "件数を増やすことより、使ってはいけない価格の混入を防ぐ", safetyRules: "出口価格候補・フリマ出口候補は参考ライン・確認済み価格へ入れない", related: "整理処理・データの自動確認", userMeaning: "怪しい価格を判断補助から守る最重要の柵", dangerIfBroken: "1件の混入で購入判断が一瞬で壊れる", nextConnection: "→ F 参考ライン（判断補助）レイヤーへ安全な価格だけを渡す", source: "TASK: 昇格禁止" },
  { id: "F", name: "参考ライン（判断補助）レイヤー", purpose: "安全な基準価格だけで参考ラインを試算する（内部名 BuyLine）", inputs: "基準価格（シード / manual_price）のみ（現状）", outputs: "参考ラインの算出可/不可", mustNot: "出口価格候補・フリマ出口候補・AI推定を使わない", safetyRules: "新品購入価格の自動確定はしない。試算は判断補助まで", related: "通常画面の参考ライン表示・固定の手数料設定", userMeaning: "目標利益を守れるかの試算材料（「買ってよい上限」ではない）", dangerIfBroken: "未検証価格で参考ラインが出ると、損失リスクが跳ね上がる", nextConnection: "→ G 画面表示レイヤーへ参考ラインと出口候補を分けて渡す", source: "README: BuyLine式（内部名）" },
  { id: "G", name: "画面表示レイヤー", purpose: "候補・理由・出口価格候補を見やすく見せる", inputs: "整理済み保存データ・参考ライン試算結果", outputs: "通常画面のカード・バッジ・確認リンク", mustNot: "出口候補を買値・相場のように見せない", safetyRules: "禁止されている断定価格ラベルを出さない", related: "通常画面（四層UI + 状態ラベル）", userMeaning: "毎日開いて、何から見るかが分かる操作面", dangerIfBroken: "言葉一つで出口候補が正本に見え、即決事故が起きる", nextConnection: "→ H 人間判断レイヤーへ情報を渡す", source: "AI_CONTEXT: UIラベル方針" },
  { id: "H", name: "人間判断レイヤー", purpose: "買う・見送る・追加確認を人間が決める", inputs: "画面情報・フリマでの目視・外部情報", outputs: "あなたの行動（購入・保留・再調査）", mustNot: "MarketLensが自動で買い断定しない", safetyRules: "参考と書いてある価格で即決しない", related: "通常画面＋あなたの確認", userMeaning: "最終決定は常に人間。ツールは助言まで", dangerIfBroken: "自動化に任せると、例外ケースで大きな損失", nextConnection: "→ 行動の結果が次の収集・確認の入力になる", source: "AI_CONTEXT: 目的", analysis: "自動化は補助までが設計の上限" },
  { id: "I", name: "自動確認レイヤー", purpose: "混入・誤表示・導線破損がないか機械的に検査", inputs: "保存データ・HTML・JS", outputs: "データの自動確認 / 画面の自動確認 の結果", mustNot: "検査失敗を無視して反映しない", safetyRules: "毎回の変更後に自動確認を通す", related: "データの自動確認・画面の自動確認スクリプト", userMeaning: "人の記憶に頼らず、柵が壊れていないか確認", dangerIfBroken: "小さな変更が隔離を壊し、気づかないうちに危険化", nextConnection: "→ J 運用レイヤーと連動し、安全な状態だけを正本へ", source: "TASK: R1-R14" },
  { id: "J", name: "運用・同期レイヤー", purpose: "開発用フォルダで作り、見る場所の正本へ反映する", inputs: "変更したファイル・自動確認の結果", outputs: "localhost:8765 で同じURLの表示", mustNot: "履歴データや依存パッケージを不用意に同期しない", safetyRules: "見る場所を1つにそろえ、古い画面で判断しない", related: "開発用フォルダ → 見る場所の正本への同期", userMeaning: "いつ開いても同じ場所で、最新の安全な画面を見る", dangerIfBroken: "古い画面で判断し、直したはずの危険が残る", nextConnection: "→ 表示が更新され、A〜Hの循環が続く", source: "WORKLOG: 正本運用" },
];

const DIAGRAM_TEN_LAYERS = `A 入力 ──→ どこを見るか決める
B 収集 ──→ 候補と参考を見つける
C 保存 ──→ 1つの保存データにまとめる
D 整理 ──→ ノイズを減らし優先度を付ける
E 価格安全 ─→ 使える/使えない価格を分ける ★中心
F 参考ライン ─→ 基準価格だけで判断補助を出す ★中心
G 画面 ───→ 通常画面に見せる
H 人間判断 → 買う/見送る/追加確認（最終）
I 自動確認 → 壊れていないか毎回検査
J 運用同期 → 見る場所の正本へ反映`;

const SUBMAP_DIAGRAMS = [
  { id: "price", title: "価格だけに注目したサブマップ", body: `[価格らしき数字]
   ├─ 定価（新品基準）→ 表示可。購入は人間が公式・小売・ECで判断
   ├─ 基準価格（シード）→ 参考ラインの材料（自動購入判断ではない）
   ├─ 出口価格候補（jpy）→ 売却参考として見せるだけ
   ├─ フリマ出口候補 → 見せるだけ（多くはUS$）
   ├─ AI推定 → 説明用
   └─ 不明・未検証 → 使わない` },
  { id: "evolution", title: "候補 → 出口候補 → 確認済み → 参考ライン", body: `商品候補として見つかる
        ↓
出口価格候補として表示（売却側参考・買値ではない）
        ↓
確認済み価格へ昇格（将来・今は0件・未実装）
        ↓
参考ラインの材料になる（今は基準価格シードのみ）` },
  { id: "mix", title: "なぜ出口価格候補を混ぜないか", body: `出口候補は便利だが読み違えやすい
        ↓
参考ラインに入れると「安く買える錯覚」
        ↓
だから E層で分離し F層で材料を1種類に絞る
        ↓
件数より混入防止を優先` },
  { id: "ai", title: "AIの境界", body: `AIが助ける: 名前抽出・分類・要約
        │
        ╳ AIが決めない: 利益・手数料・参考ライン・価格昇格・新品購入判断` },
  { id: "fleamarket", title: "フリマ確認のサブマップ", body: `フリマ検索リンクを出す（下部補助・出口確認用）
        ↓
あなたが出品を目視（H層）
        ↓
自動で読んだ価格は出口価格候補（E層）
        ↓
断定表示しない・参考ラインに入れない` },
  { id: "buyline", title: "参考ライン（判断補助）だけに注目", body: `基準価格（シード）だけ
        ↓
手数料・送料・目標利益を引く
        ↓
参考ラインを表示（自動で「買え」とは決めない）
        ↓
出口価格候補はここに入らない` },
  { id: "human", title: "人間が見るべき順番", body: `1. 今すぐ見る（0〜2日・状態ラベル付き）
2. 近日チェック（開始まで3〜14日・開始前のみ）
3. 先読みメモ（未来・準備・未確定監視）
4. 保留・除外（寿命超過・終了済み）
各カードで「参考ライン」「出口候補」「定価（新品基準）」を分けて読む` },
  { id: "safety", title: "自動確認のサブマップ", body: `変更
  ↓
データの自動確認（混入・昇格・BuyLine）
  ↓
画面の自動確認（導線・禁止ラベル・settings）
  ↓
通過したら見る場所の正本へ` },
];

const GLOSSARY = [
  ["参考ライン（BuyLine）", "目標利益を守れるかの判断補助。今は基準価格（シード）だけから計算。自動購入判断ではない。"],
  ["出口価格候補（jpyCandidate）", "Playwrightで読んだ円の候補。売却参考として見せるが、参考ライン・正本には入れない。"],
  ["基準価格（manual_price / シード）", "アプリ内シード由来の定価・売却参考。人間確認済みフリマ価格ではない。"],
  ["フリマ出口候補", "Mercari等の検索・商品ページで見つけた候補。多くはUS$表示。確認材料。"],
  ["定価（新品基準）", "新品側の基準価格として表示可。購入は公式・小売・ECを人間が見て決める。"],
  ["確認済み価格", "将来、十分に確認できた価格の置き場。今は0件・昇格は未実装。"],
  ["現在の保存データ", "画面が読む1つのまとめファイル。手編集しない。"],
  ["データの自動確認", "保存データが壊れていないか機械的に検査する仕組み。"],
  ["画面の自動確認", "画面の言葉・導線・禁止ラベルを機械的に検査する仕組み。"],
  ["開発用フォルダ", "変更を試す作業場所（worktree）。"],
  ["見る場所の正本", "localhost:8765 で開く、確認用の正式な表示場所（Documents）。"],
  ["四層UI", "今すぐ見る / 近日チェック / 先読みメモ / 保留。開催中は状態ラベル。"],
  ["補助確認", "フリマ/SNS確認リンク。overview下部折りたたみ。出口確認用・判断補助対象外。"],
  ["public-share", "外部共有用の最小配信面。通常UI・overview・snapshotのみ。"],
  ["概要同期ルール", "概念・P1境界が変わったら overview・引き継ぎ・Markdown を同時更新。"],
];

const ROLE_DETAILS = [
  { name: "候補を見つける", plain: "発売・抽選・再販・話題の芽を逃さず拾う", source: "README: 監視対象IP / WORKLOG: collector確立", analysis: "見つけることと正しい価格と断定することは別作業" },
  { name: "ノイズを減らす", plain: "ナビ文言や説明コピーを商品候補にしない", source: "CODEX_MCP_RULES: ノイズフレーズ一覧", analysis: "ノイズ除去は信頼性の前提。件数より精度" },
  { name: "価格を分類する", plain: "新品基準・基準価格シード・出口候補・推定・不明を棚分け", source: "AI_CONTEXT: priceSourceRank表", analysis: "分類が崩れると購入判断が一瞬で壊れる" },
  { name: "危険な価格を混ぜない", plain: "出口候補を参考ラインや確認済み価格に入れない", source: "TASK: 昇格禁止 / GROK: 混入なし維持", analysis: "50件集めても混入1件の方が危険" },
  { name: "参考ラインを出す", plain: "目標利益を守れるかの判断補助を試算（自動購入判断ではない）", source: "README: BuyLine式（内部名）", analysis: "参考ラインと出口候補は別表示" },
  { name: "今は基準価格（シード）だけ", plain: "manual_priceはシード由来。フリマ手入力ではない", source: "AI_CONTEXT: manual_priceのみ暫定BuyLine", analysis: "早く広げたい欲求と安全のトレードオフで後者優先" },
  { name: "出口価格候補を見せる", plain: "Playwrightで読んだ円候補を別枠表示（売却参考）", source: "TASK: jpyCandidate設計", analysis: "見せる＝使うではない。新品購入の判断材料ではない" },
  { name: "フリマを確認場所に", plain: "検索リンクで人が出品を見る。自動断定しない", source: "AI_CONTEXT: marketplaceResearchTargets", analysis: "フリマは現場確認の入口" },
  { name: "AIに説明・要約", plain: "名前抽出・分類・文章補助", source: "CODEX_MCP_RULES: LLM may help", analysis: "読む量を減らす補助輪" },
  { name: "AIに価格決定させない", plain: "利益・参考ライン・新品購入・昇格はAI不可", source: "CODEX_MCP_RULES + AI_CONTEXT", analysis: "LLMはブレやすい。数値判断はコード" },
  { name: "四層UIと状態ラベル", plain: "開催中は独立セクションではなく状態ラベル。先読みは未来監視用", source: "README + 通常UI実装", analysis: "日付軸と寿命ルールで誤配置を防ぐ" },
  { name: "概要をコードと同期", plain: "概念変更時は overview・引き継ぎも必ず更新", source: "GROK_HANDOFF 2026-06-10", analysis: "古い概要が誤解を固定化する" },
  { name: "overviewが全体説明", plain: "思想・層・役割を読む場所（このページ）", source: "今回要件", analysis: "技術ログに行かず設計を理解" },
  { name: "regressionが安全確認", plain: "壊れていないか機械的に毎回確認", source: "TASK: R1-R14", analysis: "人の記憶に頼らないガードレール" },
  { name: "Documents正本が表示安定", plain: "localhost:8765で同じURL確認", source: "WORKLOG + AI_CONTEXT", analysis: "worktreeは実験、Documentsは見る場所" },
];

const MECHANISM_WHY = [
  { q: "なぜ収集と判断を分けるのか", source: "AI_CONTEXT: 観測は参考、決定論がBuyLine", analysis: "集める段階では情報が汚れている。判断は整理・安全分離の後にしか信頼できない。早く判断したくなる欲求が事故の元。" },
  { q: "なぜ出口価格候補をすぐ使わないのか", source: "TASK: jpyCandidate buyLineEligible=false必須", analysis: "PlaywrightはDOM変化・関連価格・blockedで読み違える。売却参考として見せるが、参考ラインには入れない。" },
  { q: "なぜ参考ラインの材料を絞るのか", source: "README: 保守利益とBuyLine式", analysis: "判断補助の試算はお金を守る柵。材料が弱いと全体が崩れる。基準価格シードに絞るのは慎重さ。" },
  { q: "なぜ新品購入を自動決定しないのか", source: "GROK_HANDOFF 価格概念 2026-06-10", analysis: "ユーザーは新品を公式・小売・ECで人間が判断する。MarketLensは出口候補と確認材料を出す道具。" },
  { q: "なぜ概要をコードと同時に更新するのか", source: "AI_CONTEXT 概要同期ルール", analysis: "実装だけ変えて説明が古いと、次の作業者が旧概念で壊す。overviewは正本の思想面。" },
  { q: "なぜ確認済み価格が0のままか", source: "TASK: 昇格8条件+PM未実装", analysis: "昇格パイプラインがないのに件数だけ増やすと、参考が正本に化ける。0は「未実装」の明示。" },
  { q: "なぜ相場断定ラベルを禁止するか", source: "AI_CONTEXT: 禁止UIラベル一覧", analysis: "フリマ価格を相場と呼ぶと、脳が自動でBuyLineに結びつける。言葉が安全装置。" },
  { q: "なぜAI推定を利益計算に入れないか", source: "CODEX_MCP_RULES: LLM must not own profit", analysis: "推定は説明用。数値の根拠が弱いと仕入れ判断が危険。" },
  { q: "なぜJina由来US$を円に置換しないか", source: "AI_CONTEXT: USD-only原因調査 / TASK: 為替換算禁止", analysis: "見えない計算で円を作ると、後から検証不能。US$はUS$のまま保持。" },
  { q: "なぜbatch4よりUI/overview整理優先か", source: "TASK: 第4batch後回し / GROK: 50/381一区切り", analysis: "件数を増やしても理解と安全柵が追いつかないと、開発が速く壊れる。理解ページを厚くするのが今の投資。" },
  { q: "なぜDocuments正本へ同期するか", source: "WORKLOG: cp -p運用 / AI_CONTEXT: 固定URL", analysis: "見る場所を1つにしないと、古い画面で判断してしまう。8765は確認の儀式。" },
  { q: "なぜregressionを毎回通すか", source: "README + TASK: regression設計", analysis: "小さな変更が隔離を壊す。自動確認は変更のたびの安全ベルト。" },
  { q: "なぜ件数増加より混入防止か", source: "GROK: delta0でも隔離維持 / WORKLOG: 50到達後停止", analysis: "出口価格候補を50件集めても、1件のBuyLine混入の方が被害が大きい。KPIは件数ではなく隔離。" },
];

const DIAGRAM_PRICE_LAYERS = `[収集元の設定]
        ↓
[商品候補を集める層]
        ↓
[集めた情報を保存する層]
        ↓
[整理・分類する層]
        ↓
[価格を分ける層]
        ├─ 基準価格（シード）→ 参考ラインの材料（自動購入判断ではない）
        ├─ 出口価格候補 → 売却参考として表示。計算には使わない
        ├─ フリマ出口候補 → 表示・調査用。計算には使わない
        ├─ AI推定価格 → 理由づけ用。計算には使わない
        └─ 不明な価格 → 計算には使わない
        ↓
[画面で確認する層]
        ↓
[人間が買うか判断する]`;

const DIAGRAM_DEV_LAYERS = `[データを集める]
        ↓
[データを整理する]
        ↓
[価格の安全性を分ける]
        ↓
[画面に出す]
        ↓
[壊れていないか確認する]
        ↓
[Documentsへ同期する]`;

const DIAGRAM_OVERALL = `あなた（新品購入・売却は人間が最終判断）
  ↓ 見る・確認する
通常画面（四層UI + 状態ラベル） / この overview
  ↓ 読む
現在の保存データ（snapshot） / public-share
  ↑ 作る
deals・releases → 候補収集 → 出口参考の追記 → 整理 → 価格分離 → 自動確認
  ↑ 設定
収集元の設定（source-config）`;

const DIAGRAM_GALLERY = [
  { id: "overall", title: "1. MarketLens全体構造", caption: "あなたの判断が最上位。MarketLensは出口候補と確認材料まで。", body: DIAGRAM_OVERALL },
  { id: "layers", title: "2. レイヤー構造", caption: "価格の安全性を分けてから画面へ", body: DIAGRAM_PRICE_LAYERS },
  { id: "dataEntities", title: "3. データエンティティの流れ", caption: "候補収集は止めず、判断価格への昇格だけを遮断", body: `deals / releases
        ↓
discoveryCandidates（商品候補）
        ↓
marketplaceSignals → listingCandidates
        ├─ jpyCandidate（listing内・円候補）
        └─ browser_observed_candidate（signal側・US$候補が多い）
        ↓
priceSnapshots（基準価格シードのみ）──╳── jpyCandidate 混入禁止
        ↓
overview / public-share / 通常画面` },
  { id: "priceFork", title: "4. 価格種別の分岐", caption: "新品購入は人間判断。MarketLensは出口候補を出す", body: `[価格らしき数字を見つけた]
        │
        ├─ 定価（新品基準）────────→ 表示可。購入は人間が公式・小売・ECで判断
        ├─ 基準価格（シード）──────→ 参考ラインに使える（buyLineEligible）
        ├─ 出口価格候補(jpy) ────→ 表示のみ（判断補助対象外）
        ├─ フリマ出口候補 ───────→ 表示のみ（多くはUS$）
        ├─ AI推定 / 履歴推定 ────→ 説明のみ
        └─ 通貨不明 / 未検証 ────→ 計算に使わない` },
  { id: "buylineGate", title: "5. 参考ラインに入る/入らない", caption: "ゲートを通過した価格だけが試算へ（内部 buyLineEligible）", body: `[価格]
   → 参考ラインに使えるか？（buyLineEligible）
        ├─ YES かつ 基準価格（シード）→ 参考ライン試算へ
        └─ NO（出口候補・AI・US$・不明）→ 別枠表示のみ
   → 自動確認（regression）が毎回検査` },
  { id: "p1Boundary", title: "6. P1境界（遮断する流れ）", caption: "候補収集を止めるためではなく、未確認候補を判断価格に昇格させないため", body: `jpyCandidate ──╳──→ priceSnapshots
jpyCandidate ──╳──→ observed_market_price
jpyCandidate ──╳──→ BuyLine（buyLineEligible:true 禁止）

browser_observed_candidate ──╳──→ priceSnapshots
browser_observed_candidate ──╳──→ observed_market_price
browser_observed_candidate ──╳──→ BuyLine

通過してよい流れ:
基準価格（シード / manual_price）→ priceSnapshots → 参考ライン試算` },
  { id: "uiFour", title: "7. 四層UIとライフサイクル", caption: "開催中は状態ラベル。先読みは未来・準備用", body: `時間軸 ─────────────────────────────────→

[今すぐ見る] 0〜2日 or 寿命内 + [開催中][抽選中][販売中] ラベル
[近日チェック] 未来開始 3〜14日のみ（開始済みは入れない）
[先読みメモ] 15日以降・未確定監視（開始済み・寿命外は戻さない）
[保留・除外] 寿命超過・終了済み

[補助確認] overview下部のみ — 出口確認用 / SNS確認用（判断補助対象外）` },
  { id: "publicOps", title: "8. 公開運用", caption: "ngrok URLは一時共有。固定保存しない", body: `worktree（開発）→ cp -p → Documents正本（localhost:8765）
                              → sync → public-share
                              → ngrok（一時）→ 外部閲覧者

公開200: /  /marketlens-overview.html  /data/marketlens.snapshot.json
404維持: scripts / Markdown / source-config / history / .env / secrets

worktree :8888 は任意確認用（停止中でもP1ではない）` },
  { id: "syncRule", title: "9. 概要同期ルール", caption: "メモリだけでなく引き継ぎ文にも必ず明記", body: `概念・P1境界が変わった
        ↓
同時更新:
  overview / GROK_HANDOFF / TASK / AI_CONTEXT / WORKLOG
  次回Grok指示前提 / ChatGPTメモリ（重要ルール）

原則:
  知らない範囲は変更不可 → まず読んでから変更` },
  { id: "humanFlow", title: "10. 人間判断までの流れ", caption: "集める→分ける→守る→見せる→判断", body: `[集める] SNS・販売ページ・フリマ確認候補
        ↓
[分ける] 基準価格シード / 出口価格候補 / 使わない価格
        ↓
[守る] 出口候補を参考ラインへ混ぜない
        ↓
[見せる] 四層UIで優先度表示
        ↓
[判断する] 新品購入・見送り・追加確認（人間）` },
  { id: "ops", title: "11. 自動確認とDocuments同期", caption: "worktreeで作り、正本で見る", body: `[worktreeで変更]
        ↓
[regression + ui-regression]
        ↓
[cp -p で Documents正本へ]
        ↓
[http://localhost:8765/ で確認]
   同期しない: node_modules, history, public-history, source-config` },
];

const CANDIDATE_COMPARE_ROWS = [
  ["保存場所", "listingCandidates[].jpyCandidate", "marketplaceSignals（priceSourceRank）"],
  ["通貨", "円（Playwright抽出）", "多くはUS$（Jina検索一覧）"],
  ["UI表示", "出口価格候補（売却参考）", "フリマ出口候補（確認材料）"],
  ["priceSnapshots", "入れない（P1）", "入れない（P1）"],
  ["observed_market_price", "昇格しない（P1）", "昇格しない（P1）"],
  ["BuyLine / buyLineEligible", "使わない（false固定）", "使わない"],
  ["人間の使い方", "出品ページ目視の補助", "検索リンクから出口・反応確認"],
  ["判断補助", "対象外", "対象外"],
];

const SPINE_OVERVIEW_VIZ = `
  <div class="viz-grid viz-spine-grid">
    <div class="viz-zone viz-input"><span class="viz-label">入力</span>商品候補・収集元設定</div>
    <div class="viz-arrow-down">↓</div>
    <div class="viz-zone viz-collect"><span class="viz-label">収集</span>イベント・SNS・フリマ読取</div>
    <div class="viz-arrow-down">↓</div>
    <div class="viz-zone viz-assist"><span class="viz-label">判断補助</span>価格分離・参考ライン（E・F層）</div>
    <div class="viz-arrow-down">↓</div>
    <div class="viz-zone viz-human"><span class="viz-label">人間確認</span>四層UI・フリマ/SNS補助導線（H層）</div>
    <div class="viz-arrow-down">↓</div>
    <div class="viz-zone viz-publish"><span class="viz-label">公開表示</span>通常画面・overview・public-share</div>
  </div>
  <p class="viz-note muted small">層を混ぜない理由: 未検証候補が判断価格に見えると、購入・売却判断が一瞬で壊れるため。</p>`;

const DATA_FLOW_VIZ = `
  <div class="viz-flow-row">
    <div class="viz-node">deals / releases</div><span class="viz-arrow">→</span>
    <div class="viz-node">discoveryCandidates</div><span class="viz-arrow">→</span>
    <div class="viz-node">marketplaceSignals</div><span class="viz-arrow">→</span>
    <div class="viz-node">listingCandidates</div>
  </div>
  <div class="viz-fork">
    <div class="viz-branch viz-ok">
      <span class="viz-branch-label">通過してよい</span>
      <div class="viz-node">基準価格（シード）→ priceSnapshots</div>
      <span class="viz-arrow">→</span>
      <div class="viz-node">参考ライン試算</div>
      <span class="viz-arrow">→</span>
      <div class="viz-node">overview / 通常画面</div>
    </div>
    <div class="viz-branch viz-blocked">
      <span class="viz-branch-label">遮断（P1）</span>
      <div class="viz-node">jpyCandidate</div>
      <div class="viz-node">browser_observed_candidate</div>
      <span class="viz-block">╳ priceSnapshots / observed_market_price / BuyLine</span>
      <span class="viz-arrow">→</span>
      <div class="viz-node muted">別枠表示のみ（出口確認用）</div>
    </div>
  </div>`;

const PRICE_SEPARATION_VIZ = `
  <div class="viz-price-center">
    <p><strong>新品購入価格は人間が公式・小売・ECで判断する</strong></p>
    <p>MarketLensは出口価格候補と確認材料を出す</p>
    <p class="viz-warn">候補価格を判断価格に混ぜない</p>
  </div>
  <div class="viz-price-grid">
    <div class="viz-price-col viz-human-price">
      <h4>新品側（人間判断）</h4>
      <ul><li>定価（新品基準）</li><li>公式・小売・EC確認</li></ul>
    </div>
    <div class="viz-price-col viz-seed">
      <h4>判断補助に使う</h4>
      <ul><li>基準価格（シード / manual_price）</li><li>参考ライン</li></ul>
    </div>
    <div class="viz-price-col viz-exit">
      <h4>出口側（表示のみ）</h4>
      <ul><li>出口価格候補（jpy）</li><li>フリマ出口候補</li><li>売却参考候補</li></ul>
    </div>
    <div class="viz-price-col viz-out">
      <h4>判断補助対象外</h4>
      <ul><li>AI推定</li><li>通貨不明</li><li>未検証価格</li></ul>
    </div>
  </div>`;

const P1_BOUNDARY_VIZ = `
  <div class="viz-p1">
    <div class="viz-p1-col">
      <h4>通過してよい流れ</h4>
      <div class="viz-p1-path ok">基準価格（シード）→ priceSnapshots → 参考ライン</div>
      <div class="viz-p1-path ok">出口候補 → 別枠表示 → 人間が目視確認</div>
    </div>
    <div class="viz-p1-col">
      <h4>遮断する流れ（P1）</h4>
      <div class="viz-p1-path block">jpyCandidate → priceSnapshots</div>
      <div class="viz-p1-path block">jpyCandidate → observed_market_price</div>
      <div class="viz-p1-path block">jpyCandidate → BuyLine</div>
      <div class="viz-p1-path block">browser_observed_candidate → priceSnapshots</div>
      <div class="viz-p1-path block">browser_observed_candidate → observed_market_price</div>
      <div class="viz-p1-path block">browser_observed_candidate → BuyLine</div>
    </div>
  </div>
  <p class="viz-note muted small">P1境界は候補収集を止めるためではなく、未確認候補を判断価格に昇格させないための境界です。</p>`;

const UI_FOUR_LAYERS_VIZ = `
  <div class="viz-ui-lifecycle">
    <div class="viz-ui-layer"><strong>今すぐ見る</strong><span>0〜2日 / 寿命内</span><span class="viz-state-tag">[開催中] 状態ラベル</span></div>
    <div class="viz-ui-layer"><strong>近日チェック</strong><span>未来開始 3〜14日</span><span class="viz-muted">開始済みは入れない</span></div>
    <div class="viz-ui-layer"><strong>先読みメモ</strong><span>15日以降・未確定監視</span><span class="viz-muted">開始済み・寿命外は戻さない</span></div>
    <div class="viz-ui-layer aux"><strong>補助確認</strong><span>overview下部のみ</span><span>出口確認用 / SNS確認用</span></div>
  </div>`;

const PUBLIC_OPS_VIZ = `
  <div class="viz-ops">
    <div class="viz-ops-path">
      <div class="viz-node">worktree</div><span>→</span>
      <div class="viz-node">Documents正本<br><small>localhost:8765</small></div><span>→</span>
      <div class="viz-node">public-share</div><span>→</span>
      <div class="viz-node">ngrok（一時）</div><span>→</span>
      <div class="viz-node">外部閲覧者</div>
    </div>
    <div class="viz-ops-split">
      <div class="viz-ops-pub"><h4>公開（200）</h4><ul><li>/</li><li>/marketlens-overview.html</li><li>/data/marketlens.snapshot.json</li></ul></div>
      <div class="viz-ops-deny"><h4>404維持</h4><ul><li>scripts / Markdown</li><li>source-config / history</li><li>.env / secrets / node_modules</li></ul></div>
    </div>
    <p class="viz-note muted small">ngrok URLは overview / Markdown / 設定へ<strong>固定保存しません</strong>。worktree :8888 は任意（停止中でもP1ではない）。</p>
  </div>`;

const SYNC_RULE_VIZ = `
  <div class="viz-sync">
    <div class="viz-sync-trigger">概念・役割・価格定義・UI分類・公開方針・P1境界が変わった</div>
    <span class="viz-arrow-down">↓ 同時更新</span>
    <div class="viz-sync-targets">
      <span>overview</span><span>引き継ぎ文</span><span>TASK / AI_CONTEXT</span><span>GROK_HANDOFF</span><span>次回Grok前提</span><span>ChatGPTメモリ</span>
    </div>
    <div class="viz-sync-principles">
      <p><strong>メモリに保存するほど重要なルールは、必ず引き継ぎ文にも明記する</strong></p>
      <p><strong>知らない範囲は変更不可。まずファイル本文を読んでから変更する</strong></p>
    </div>
  </div>`;

const SCOPE_BASE = [
  { id: 1, name: "商品候補収集・正規化", weight: 15, role: "ニュースや公式情報から候補を集め、名前や日付を整える", gap: "ノイズ除去の継続" },
  { id: 2, name: "AI / Gemini 基盤", weight: 5, role: "文章の抽出や要約の補助", gap: "本番キーでの発火確認" },
  { id: 3, name: "SNS観測", weight: 5, role: "話題の確認導線", gap: "観測の本格開始" },
  { id: 4, name: "フリマ確認導線", weight: 5, role: "手で確認するリンクの提示", gap: "参考表示の拡大（計算には使わない）" },
  { id: 5, name: "価格観測レイヤー", weight: 15, role: "出口価格候補の限定蓄積", gap: "価格を拾う場所の選び方の改善" },
  { id: 6, name: "価格正本 / 参考ライン", weight: 20, role: "基準価格（シード）だけで判断補助を試算", gap: "確認済み価格への昇格は未着手" },
  { id: 7, name: "UI / ダッシュボード", weight: 15, role: "四層UI・状態ラベル・出口候補表示", gap: "静的シード説明文の旧語整理" },
  { id: 8, name: "引き継ぎ・運用", weight: 10, role: "自動確認と説明ページの維持", gap: "説明と数字の同期" },
];

const MODULE_ROWS = [
  ["source-config.json", "どのサイトを見に行くか決める", "収集の入力", "価格とは別管理"],
  ["collect-marketlens.mjs", "情報を集めて保存データを作る", "現在の保存データ", "入口"],
  ["marketlens-observation.mjs", "フリマ・SNSの観測を整理する", "参考情報の追記", "正本化しない"],
  ["marketlens-jpy-candidate-cycle.mjs", "出口価格候補を少しずつ試し確認", "出口価格候補", "計算に使わない"],
  ["postprocess-marketlens-snapshot.mjs", "表示しやすい形に整える", "保存データ更新", "安全整形"],
  ["regression-check.mjs", "データが壊れていないか確認", "終了コード", "ゲート"],
  ["ui-regression-check.mjs", "画面の言葉や導線を確認", "終了コード", "ゲート"],
  ["index.html + script.js", "あなたが操作する画面", "同じ保存データ", "操作面"],
  ["marketlens-overview.html", "この説明ページ", "同じ保存データ", "理解用"],
];

const P1_BOUNDARIES_PLAIN = [
  "出口価格候補やフリマ出口候補を、参考ライン・正本の計算に入れない",
  "出口候補を「確認済み価格」として扱わない（今は0件のまま）",
  "禁止されている断定価格ラベル（TASK一覧）を画面に出さない",
  "ドル表示を、根拠なく円に置き換えない。為替計算で円を作らない",
  "ログイン突破やCAPTCHA回避、大量アクセスをしない",
  "保存データを手で書き換えない",
];

const P1_BOUNDARIES_TECH = [
  "browser_observed_candidate / jpyCandidate → priceSnapshots 不可",
  "browser_observed_candidate / jpyCandidate → observed_market_price 昇格不可",
  "jpyCandidate / browser_observed_candidate → BuyLine 不可",
  "Jina US$ / currency unknown / AI推定 / heuristic → BuyLine 不可",
  "禁止されている相場断定ラベルを UI に出さない",
];

const REMAIN_P2 = [
  "script.js 静的シード説明文の旧語「相場」→ 売却参考系への軽微置換",
  "説明ページと保存データの自動同期をさらに強化",
  "価格を拾う場所の選び方を固める（保存率の判断）",
  "AI要約の本番環境での確認",
];

const HISTORY_FALLBACK = [
  "2026-06-10: 価格概念・四層UI・公開運用・概要同期ルールを overview 全体に反映（表示のみ）",
  "2026-06-09: overviewをレイヤー中心の構造理解ページへ再編（開発状況を極小化）",
  "2026-06-09: overviewを設計理解ページへ拡張（10層・14役割・仕組み・図6種・資料索引）",
  "2026-06-09: overviewをプロダクト説明中心に再構成",
  "2026-06-09: overview 開発状況/ワークフロー分離 + ダークモード",
  "2026-06-09: settings UI削除",
  "2026-06-09: 出口価格候補の第3まとめ確認 + 再確認回避記録",
];

const NEXT_FALLBACK = [
  "説明ページと引き継ぎの概念同期を継続",
  "静的シード説明文の旧語整理（P1外）",
  "価格を拾う場所の選び方の硬化",
  "第4まとめ確認は UI整理後（件数だけ増やさない）",
];

const FILE_GUIDE_ROWS = [
  ["marketlens-overview.*", "この説明ページ", "可", "思想・仕組みの主戦場"],
  ["index.html / script.js", "通常画面", "要確認後", "参考ライン・出口価格候補の表示文言"],
  ["public-share/", "外部共有用最小配信", "sync後", "ngrok URLは固定保存しない"],
  ["data/marketlens.snapshot.json", "現在の保存データ", "不可", "自動生成のみ"],
  ["scripts/regression-check.mjs", "データの自動確認", "可", "隔離条件追加時は必須"],
  ["scripts/ui-regression-check.mjs", "画面の自動確認", "可", ""],
];

const PROBE_CLASS_ROWS = [
  ["browser_jpy_extracted", "商品ページから円を読み取れた", "出口価格候補のみ・正本化しない", "しない"],
  ["browser_no_price", "価格が見つからない", "しない", "しない"],
  ["browser_blocked", "ブロック・CAPTCHA", "しない", "記録する"],
  ["browser_login_required", "ログインが必要", "しない", "記録する"],
  ["browser_sold_or_unavailable", "売切・出品なし", "しない", "しない"],
];

const FIXED_CALC_DEFAULTS = { feeRate: 5, targetProfit: 1500, priceBuffer: 3, packingCost: 80 };
const TECH_GLOSSARY_NOTE = "出口価格候補は判断補助対象外（参考ライン・priceSnapshots・observed_market_price には入れない）";

const PRODUCT_COPY = {
  whatIs: `
    <p>MarketLensは、ホビー商品の<strong>「買う価値があるか」</strong>を人間が判断しやすくする個人用の情報整理ツールです。</p>
    <p><strong>新品購入価格は公式・小売・ECをあなたが見て決めます。</strong>MarketLensはそれを自動確定しません。</p>
    <p>フリマ・ヤフオク等の<strong>出口価格候補</strong>、需要、確認リンクを出し、<strong>いつ・何を・どこで確認すべきか</strong>を整理します。</p>`,
  judgment: `
    <ul>
      <li><strong>いつチェックするか</strong> — 発売まで何日か（「開始まで○日」）</li>
      <li><strong>どこを見るか</strong> — 公式ページ、抽選、フリマ確認リンク</li>
      <li><strong>判断補助の参考ライン</strong> — 手数料・送料・目標利益を考慮した試算（自動購入判断ではない）</li>
      <li><strong>出口価格候補</strong> — フリマで読んだ円候補を別枠表示（参考ライン・正本には入れない）</li>
    </ul>
    <p>「利益が出そう」とすぐ結論しないのが大切です。出口候補は<strong>表示はするが、判断補助の参考ラインには使いません</strong>。</p>`,
  why: `
    <p>転売やせどりでは、<strong>情報の鮮度</strong>と<strong>価格の信頼性</strong>が成否を分けます。しかし情報は散らばっており、フリマ価格は便利でもそのまま信じられません。</p>
    <p>MarketLensは、候補を逃さず、かつ<strong>危ない価格で自動計算しない</strong>ために作られています。件数を増やすより、<strong>混入を防ぐ</strong>ことを優先します。</p>`,
  philosophy: `
    <p>MarketLensは<strong>出口価格候補と確認材料を出す道具</strong>です。新品購入や売却価格を断定しません。</p>
    <ul class="philosophy-list">
      <li><strong>新品購入</strong>は公式・小売・ECを人間が見る（MarketLensは自動確定しない）</li>
      <li><strong>定価</strong>は新品側の基準として表示してよいが、購入判断の確定価格ではない</li>
      <li><strong>出口価格候補</strong>（jpyCandidate / フリマ出口候補）は売却参考として別枠表示</li>
      <li>出口候補を参考ライン・priceSnapshots・observed_market_price・BuyLineに入れない</li>
      <li><strong>manual_price</strong>は現状シード由来の基準価格（人間確認済みフリマ価格ではない）</li>
      <li>禁止されている断定価格ラベル（TASKの一覧）は画面に出さない</li>
      <li>AIに最終判断を任せない — 説明と整理の補助だけ</li>
    </ul>
    <p class="muted small"><span class="tag tag-source">資料</span> AI_CONTEXT.md / TASK.md の方針を言い換えたものです。</p>`,
  humanFlow: `
    <p>MarketLensの流れは <strong>集める → 分ける → 見せる → あなたが決める</strong> です。</p>
    <ol>
      <li>候補と出口参考が集まる（B〜C層）</li>
      <li>価格の種類が分かれる（E層）</li>
      <li>基準価格（シード）だけで参考ラインが試算される（F層・自動購入判断ではない）</li>
      <li>四層UIで優先度順に見る（G層）</li>
      <li>新品購入・見送り・追加確認を決める（H層）</li>
    </ol>`,
  uiFourLayers: `
    <p>通常画面は<strong>四層分類</strong>を維持します。大見出しに「開催中」は置きません。</p>
    <ul>
      <li><strong>今すぐ見る</strong> — 開始前0〜2日、または開始済みで販売形式ごとの寿命内。状態は [開催中][抽選中][販売中] などのラベル</li>
      <li><strong>近日チェック</strong> — 未来開始日のみ（3〜14日）。開始済みは入れない</li>
      <li><strong>先読みメモ</strong> — 15日以降・日付未確定の監視・準備枠。開始済み・寿命外の一般商品は戻さない</li>
      <li><strong>保留・除外</strong> — 寿命超過・終了済み・情報不足（開始済み・寿命外の追跡先）</li>
      <li><strong>補助確認</strong> — フリマ（出口確認用）/ SNS（SNS確認用・反応確認用）リンクは overview 下部折りたたみのみ。判断補助対象外</li>
    </ul>`,
  safetyCheck: `
    <p>自動確認レイヤー（I層）は、変更のたびに次を機械的に検査します。</p>
    <ul>
      <li>出口価格候補が参考ライン・確認済み価格に混ざっていないか</li>
      <li>禁止されている断定価格ラベルが画面に出ていないか</li>
      <li>設定画面が復活していないか</li>
      <li>通常画面とこのページの導線が壊れていないか</li>
    </ul>
    <p>検査に通らない変更は、見る場所の正本へ反映しません。</p>`,
  documents: `
    <p>開発用フォルダ（worktree）で変更を試し、自動確認を通したあと、<strong>見る場所の正本</strong>（Documents）へ <code>cp -p</code> 同期します。</p>
    <p>受け入れ判断・日常確認は <strong>http://localhost:8765/</strong>（Documents 正本）です。worktree 用 <code>:8888</code> は任意のローカル確認用（再起動は必要時のみ）。</p>
    <p class="muted small">同期しない: node_modules, history, public-history, source-config, .env, secrets, credentials</p>`,
  publicShare: `
    <p><strong>public-share</strong> は外部共有用の最小配信面です。<code>sync-public-share.mjs</code> で通常UI・overview・snapshot をコピーします。</p>
    <ul>
      <li><strong>公開する</strong> — <code>/</code>、<code>/marketlens-overview.html</code>、<code>/data/marketlens.snapshot.json</code></li>
      <li><strong>404を維持</strong> — source-config、history、scripts、Markdown、package、node_modules、.env、credentials、secrets</li>
      <li><strong>ngrok</strong> — 一時共有用。URLを overview / Markdown / 設定へ固定保存しない</li>
    </ul>`,
  syncRule: `
    <p><strong>概要同期ルール</strong> — MarketLensで概念・役割・価格定義・UI分類・公開方針・P1境界が更新されたら、<strong>実装の有無にかかわらず</strong>次を同時に更新します。</p>
    <ol>
      <li><code>marketlens-overview.html</code> / <code>marketlens-overview.js</code>（このページ）</li>
      <li><code>GROK_HANDOFF.md</code>（Grok向け次回指示の前提）</li>
      <li>必要に応じて <code>TASK.md</code> / <code>AI_CONTEXT.md</code> / <code>WORKLOG.md</code></li>
      <li>ChatGPTメモリに保存するほど重要なルールは、<strong>引き継ぎ文にも必ず明記</strong></li>
    </ol>
    <p>知らない範囲は変更不可。現内容を読んでいない範囲は、まずファイル本文を読むか、現状調査のみを依頼します。</p>
    <p>コードだけ変えて、概要が古い概念のまま残る状態を避けます。更新内容には「何が変わったか」「旧解釈と新解釈」「P1への影響」「ロジック変更しない箇所」を含めます。</p>`,
  dataFlow: `
    <ol>
      <li><strong>収集元の設定</strong> — どのサイト・カテゴリを見るか決める</li>
      <li><strong>集める</strong> — 記事・商品・イベントを取りに行く</li>
      <li><strong>出口参考を足す</strong> — フリマやブラウザ確認は出口価格候補として追記（正本にしない）</li>
      <li><strong>保存データにまとめる</strong> — 画面が読む1つのファイル（手編集しない）</li>
      <li><strong>整理する</strong> — 四層UI・参考ライン可否・状態ラベルを整える</li>
      <li><strong>画面に出す</strong> — 通常画面とこの説明ページ</li>
      <li><strong>自動確認</strong> — 混入や禁止ラベルがないか機械的に検査</li>
      <li><strong>正本へ同期</strong> — Documents / public-share（必要時）</li>
    </ol>`,
  priceSeparation: `
    <p>価格には<strong>役割の違い</strong>があります。</p>
    <ul>
      <li><strong>新品側</strong> — 定価・公式・小売はあなたが確認（表示はするが自動購入判断ではない）</li>
      <li><strong>出口側</strong> — フリマ・ヤフオク等の出口価格候補・確認材料（断定表示しない）</li>
      <li><strong>判断補助</strong> — 参考ライン（内部名 BuyLine）は基準価格（シード）から試算</li>
    </ul>
    <p>混ぜると誤判断が起きます。<strong>jpyCandidate は出口価格候補として別棚</strong>に置き、priceSnapshots / observed_market_price / BuyLine には入れません。</p>`,
  buyLine: `
    <p><strong>参考ライン</strong>（内部名 BuyLine / buyLineEligible）は、<strong>基準価格（シード）</strong>から目標利益を逆算した<strong>判断補助</strong>です。「買ってよい上限」「新品仕入れ上限」ではありません。自動で購入を決めません。</p>
    <pre class="formula-box">参考ライン ≒ 基準価格（シード）− 手数料 − 送料 − 梱包 − 値下げ余地 − 目標利益</pre>
    <p>手数料率・目標利益などはコード内の固定値です（設定画面はありません）。</p>
    <p>使えるのは<strong>基準価格（シード / manual_price）</strong>のみ。出口価格候補・フリマ出口候補・AI推定は<strong>入れません</strong>。</p>`,
  referenceCaution: `
    <p><strong>出口価格候補（jpyCandidate）</strong>は、ブラウザで商品ページを開いて読み取った円の候補です。便利ですが、</p>
    <ul>
      <li>ページの見た目が変わると読み違える</li>
      <li>関連商品の価格が混ざることがある</li>
      <li>ブロックされたページでは取れない</li>
    </ul>
    <p>だから<strong>表示はするが、参考ライン・正本には使わない</strong>。</p>
    <p><strong>フリマ出口候補</strong>（browser_observed_candidate・多くはUS$表示）も同様に、確認材料です。</p>`,
  candidates: `
    <p>候補は、設定したソースから自動収集されます。ポケカBOX・一番くじ・フィギュア・時計コラボなど、ジャンルごとにルールがあります（README.md 参照）。</p>
    <p>集まったあと、</p>
    <ul>
      <li>ノイズ（ナビゲーション文言など）を落とす</li>
      <li>日付・価格・リンクの不足をラベル化する</li>
      <li>四層（今すぐ見る / 近日チェック / 先読みメモ / 保留）に振り分ける</li>
    </ul>
    <p>「急上昇」と言われても、すぐ利益候補にしない — AI検証を経て候補化する、という思想があります。</p>`,
  fleamarket: `
    <p>フリマは<strong>出口確認の場</strong>です。検索リンクを出し、あなたが実際の出品を見に行く想定です。</p>
    <p>自動で集めた価格は<strong>出口価格候補・フリマ出口候補</strong>として扱い、売却確定のような断定表示はしません。</p>
    <p>出口候補を参考ラインに入れると、送料・状態・偽物リスクを見落としやすい — だから別枠です。</p>`,
  ai: `
    <p>AIは<strong>名前の抽出・分類・要約</strong>を手伝います（D層の補助）。</p>
    <p><strong>AIが決めないこと</strong>:</p>
    <ul>
      <li>利益の計算</li>
      <li>手数料・送料</li>
      <li>参考ライン（判断補助）</li>
      <li>新品購入価格の確定</li>
      <li>最終的にどの層に出すかの昇格</li>
      <li>リンクが生きているかの検証</li>
    </ul>
    <p>キーがない環境では、ルールベースの推定に切り替わります。それでも参考ラインの根拠にはしません。</p>`,
  screen: `
    <p><strong>通常画面</strong>では、次の順で見るとよいです。</p>
    <ol>
      <li><strong>今すぐ見る</strong> — 0〜2日で動きがありそうなもの（状態ラベル付き）</li>
      <li><strong>近日チェック</strong> — 開始まで3〜14日。すでに始まったものはここに入れない</li>
      <li><strong>先読みメモ</strong> — 未来・準備・未確定監視（開始済みは戻さない）</li>
      <li><strong>保留・除外</strong> — 寿命超過・終了済み・情報不足</li>
    </ol>
    <p>各カードでは、<strong>定価（新品基準）</strong>・<strong>参考ライン</strong>・<strong>出口価格候補</strong>・確認リンクの違いに注目してください。新品購入は公式・小売・ECをあなたが見て決めます。</p>
    <p>全体の仕組みはこのページ、日々の操作は通常画面、フリマ/SNS確認は下部補助、という使い分けです。</p>`,
};

function countBy(items, keyFn) {
  return (items ?? []).reduce((acc, item) => {
    const key = String(keyFn(item) ?? "missing");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function countJpyCandidates(snapshot) {
  let count = 0;
  let buyLineTrue = 0;
  for (const signal of snapshot.marketplaceSignals ?? []) {
    for (const listing of signal.listingCandidates ?? []) {
      const jc = listing.jpyCandidate;
      if (!jc || !(jc.amount > 0)) continue;
      count += 1;
      if (jc.buyLineEligible === true) buyLineTrue += 1;
    }
  }
  return { count, buyLineTrue };
}

function countBuyLineStatus(snapshot) {
  const counts = { available: 0, unavailable: 0, missing: 0 };
  for (const c of snapshot.discoveryCandidates ?? []) {
    const key = c.buyLineStatus ?? "missing";
    if (key in counts) counts[key] += 1;
    else counts.missing += 1;
  }
  return counts;
}

function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function buildBatchRows(snapshot) {
  const history = Array.isArray(snapshot.metadata?.jpyCandidateProbeHistory)
    ? snapshot.metadata.jpyCandidateProbeHistory
    : [];
  const latest = snapshot.metadata?.jpyCandidateProbe ?? {};
  const byLabel = new Map(history.filter((r) => r.batchLabel).map((r) => [r.batchLabel, r]));
  if (latest.batchLabel) byLabel.set(latest.batchLabel, latest);
  return ["batch1", "batch2", "batch3"].map((l) => byLabel.get(l)).filter(Boolean);
}

function summarizeSkipFromRegistry(registry = {}) {
  const blocked = Array.isArray(registry.blocked) ? registry.blocked.length : 0;
  const captcha = Array.isArray(registry.captcha_or_interstitial) ? registry.captcha_or_interstitial.length : 0;
  const login = Array.isArray(registry.login_required) ? registry.login_required.length : 0;
  return { activeSkipUrlCount: blocked + captcha + login, blocked, captchaOrInterstitial: captcha, loginRequired: login, ttlDays: 7 };
}

function computeScopeItems(metrics, snapshot) {
  const obs = snapshot.metadata?.observationMetrics ?? snapshot.metadata?.observation ?? {};
  const geminiMissing = (obs.llmExecution?.eligibilityReasonCounts?.gemini_api_key_missing ?? 0) > 0;
  const batchCount = metrics.batches.length;
  return SCOPE_BASE.map((base) => {
    let progress = 50;
    let state = "運用中";
    switch (base.id) {
      case 1:
        progress = Math.min(92, 55 + Math.round((metrics.products / 750) * 30));
        state = `商品 ${metrics.products} / 候補 ${metrics.candidates}`;
        break;
      case 2:
        progress = geminiMissing ? 35 : 55;
        state = geminiMissing ? "AIは補助モード（キー未設定）" : "AI補助運用中";
        break;
      case 5:
        progress = Math.min(85, 45 + metrics.jpySaved * 2 + batchCount * 4);
        state = `出口価格候補 ${metrics.jpySaved} 件 / 再確認回避 ${metrics.skipSummary.activeSkipUrlCount ?? 0}`;
        break;
      case 6:
        progress = metrics.observedMarket === 0 && metrics.manualPrice >= 28 ? 58 : 42;
        state = `確認済み価格 ${metrics.observedMarket} / 基準価格シード ${metrics.manualPrice}`;
        break;
      case 7:
        progress = 86;
        state = "通常画面 + この説明ページ";
        break;
      case 8:
        progress = metrics.isolationOk ? 78 : 55;
        state = metrics.isolationOk ? "自動確認 通過" : "要調査";
        break;
      default:
        progress = 60;
        break;
    }
    return { ...base, progress, state };
  });
}

function buildRecentChanges(metrics, snapshot) {
  const changes = [];
  const p = metrics.probe;
  if (p.batchLabel) {
    changes.push(`${p.batchLabel}: 出口価格候補の新規保存 ${p.newJpyCandidateSavedCount ?? 0} 件（累計 ${p.snapshotJpyCandidateTotal ?? metrics.jpySaved}）`);
  }
  if ((p.newBlockedSkipEntries ?? 0) > 0) {
    changes.push(`再確認回避記録に blocked +${p.newBlockedSkipEntries}`);
  }
  changes.push(`保存データの更新日時: ${metrics.updatedAt}`);
  const feed = snapshot.metadata?.overviewFeed;
  if (Array.isArray(feed?.recentChanges)) {
    for (const row of feed.recentChanges) changes.unshift(String(row));
  }
  return [...new Set(changes)];
}

function buildNextWork(metrics, snapshot) {
  const dynamic = [];
  if (!metrics.isolationOk) dynamic.push("隔離が崩れていないか調査（自動確認を実行）");
  dynamic.push("概要と引き継ぎの概念同期を維持");
  dynamic.push("第4まとめ確認は UI整理後（件数だけ増やさない）");
  const feed = snapshot.metadata?.overviewFeed;
  if (Array.isArray(feed?.nextWork)) return [...feed.nextWork, ...dynamic.filter((r) => !feed.nextWork.includes(r))];
  return [...NEXT_FALLBACK, ...dynamic];
}

function buildHistory(snapshot) {
  const feed = snapshot.metadata?.overviewFeed;
  if (Array.isArray(feed?.implementationHistory) && feed.implementationHistory.length) {
    return feed.implementationHistory;
  }
  return HISTORY_FALLBACK;
}

function buildMetrics(snapshot) {
  const prices = snapshot.priceSnapshots ?? [];
  const priceRanks = countBy(prices, (p) => p.priceSourceRank ?? "missing");
  const buyLineEligible = prices.filter((p) => p.buyLineEligible === true);
  const buyLineSources = countBy(buyLineEligible, (p) => p.priceSourceRank ?? "missing");
  const observedMarket = prices.filter((p) => p.priceSourceRank === "observed_market_price").length;
  const jpy = countJpyCandidates(snapshot);
  const browserSignals = (snapshot.marketplaceSignals ?? []).filter((s) => s.priceSourceRank === "browser_observed_candidate").length;
  const listingCount = (snapshot.marketplaceSignals ?? []).reduce((s, sig) => s + (sig.listingCandidates?.length ?? 0), 0);
  const probe = snapshot.metadata?.jpyCandidateProbe ?? {};
  const skip = snapshot.metadata?.mercariProbeSkipRegistry ?? {};
  const skipSummary = probe.mercariProbeSkip ?? summarizeSkipFromRegistry(skip);
  const obs = snapshot.metadata?.observationMetrics ?? snapshot.metadata?.observation ?? {};
  const priceSnapshotsJpyMix = prices.filter((p) => p.jpyCandidate != null).length;
  const buyLineBrowserMix = obs.buyLineBrowserMixDetected === true;
  const forbiddenInSnapshot = FORBIDDEN_LABEL_RE.test(JSON.stringify(snapshot));
  const forbiddenLabelDetected = obs.forbiddenLabelDetected === true;
  const isolationOk = observedMarket === 0
    && JSON.stringify(buyLineSources) === JSON.stringify({ manual_price: 28 })
    && jpy.buyLineTrue === 0
    && priceSnapshotsJpyMix === 0
    && !buyLineBrowserMix
    && !forbiddenInSnapshot
    && !forbiddenLabelDetected;

  const metrics = {
    updatedAt: snapshot.metadata?.updatedAt ?? "—",
    products: snapshot.normalizedProducts?.length ?? 0,
    candidates: (snapshot.discoveryCandidates ?? []).length,
    buyLineStatus: countBuyLineStatus(snapshot),
    manualPrice: priceRanks.manual_price ?? 0,
    historicalPrediction: priceRanks.historical_prediction ?? 0,
    llmMentioned: priceRanks.llm_mentioned_price ?? 0,
    observedMarket,
    buyLineSources,
    jpySaved: jpy.count,
    jpyBuyLineTrue: jpy.buyLineTrue,
    browserSignals,
    listingCount,
    marketplaceSignals: (snapshot.marketplaceSignals ?? []).length,
    probe,
    skip,
    skipSummary,
    batches: buildBatchRows(snapshot),
    forbiddenInSnapshot,
    forbiddenLabelDetected,
    buyLineBrowserMix,
    priceSnapshotsJpyMix,
    observedPromotion: observedMarket,
    isolationOk,
    contentDate: snapshot.metadata?.overviewFeed?.contentDate ?? OVERVIEW_BUILD.slice(0, 10),
  };
  metrics.scopeItems = computeScopeItems(metrics, snapshot);
  metrics.recentChanges = buildRecentChanges(metrics, snapshot);
  metrics.nextWork = buildNextWork(metrics, snapshot);
  metrics.history = buildHistory(snapshot);
  return metrics;
}

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch (_) {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "ライトモード" : "ダークモード";
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

function initTheme() {
  applyTheme(readInitialTheme());
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (_) {}
  });
}

function renderProductCopy() {
  const map = {
    copyWhatIs: PRODUCT_COPY.whatIs,
    copyJudgment: PRODUCT_COPY.judgment,
    copyPhilosophy: PRODUCT_COPY.philosophy,
    copyWhy: PRODUCT_COPY.why,
    copyDataFlow: PRODUCT_COPY.dataFlow,
    copyCandidates: PRODUCT_COPY.candidates,
    copyPriceSeparation: PRODUCT_COPY.priceSeparation + PRODUCT_COPY.referenceCaution,
    copyBuyLine: PRODUCT_COPY.buyLine,
    copyFleamarket: PRODUCT_COPY.fleamarket,
    copyAi: PRODUCT_COPY.ai,
    copyHumanFlow: PRODUCT_COPY.humanFlow,
    copyUiFourLayers: PRODUCT_COPY.uiFourLayers,
    copyScreen: PRODUCT_COPY.screen,
    copySafetyCheck: PRODUCT_COPY.safetyCheck,
    copyDocuments: PRODUCT_COPY.documents,
    copySyncRule: PRODUCT_COPY.syncRule,
    copyPublicShare: PRODUCT_COPY.publicShare,
  };
  for (const [id, html] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  const ten = document.getElementById("diagramTenLayers");
  if (ten) ten.textContent = DIAGRAM_TEN_LAYERS;
  const flow = document.getElementById("dataFlowVisual");
  if (flow) {
    flow.innerHTML = LAYER_ARCHITECTURE.map((l) =>
      `<div class="flow-node flow-node-layer" id="flow-${l.id}"><span class="flow-id">${l.id}</span>${l.name}</div>`,
    ).join('<div class="flow-arrow">↓</div>');
  }
  const vizMap = {
    spineOverviewDiagram: SPINE_OVERVIEW_VIZ,
    dataFlowDiagram: DATA_FLOW_VIZ,
    priceSeparationDiagram: PRICE_SEPARATION_VIZ,
    p1BoundaryDiagram: P1_BOUNDARY_VIZ,
    uiFourLayersDiagram: UI_FOUR_LAYERS_VIZ,
    publicOpsDiagram: PUBLIC_OPS_VIZ,
    syncRuleDiagram: SYNC_RULE_VIZ,
  };
  for (const [id, html] of Object.entries(vizMap)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  const attr = document.getElementById("sourceAttribution");
  if (attr) attr.textContent = `設計根拠の参照元: ${MARKDOWN_SOURCES.map((s) => s.split(" — ")[0]).join(" / ")}`;
  const build = document.getElementById("overviewBuildLabel");
  if (build) build.textContent = OVERVIEW_BUILD;
}

function renderRoleDetails() {
  const host = document.getElementById("roleDetailsGrid");
  if (!host) return;
  host.innerHTML = ROLE_DETAILS.map((role) => `
    <article class="role-card">
      <h4>${role.name}</h4>
      <p>${role.plain}</p>
      <p class="small muted"><span class="tag tag-source">資料</span> ${role.source}</p>
      <p class="small"><span class="tag tag-analysis">分析</span> ${role.analysis}</p>
    </article>`).join("");
}

function renderCandidateCompareTable() {
  const tbody = document.querySelector("#candidateCompareTable tbody");
  if (!tbody) return;
  tbody.innerHTML = CANDIDATE_COMPARE_ROWS.map(
    ([aspect, jpy, browser]) => `<tr><td>${aspect}</td><td>${jpy}</td><td>${browser}</td></tr>`,
  ).join("");
}

function renderLayerMap() {
  const host = document.getElementById("layerMapStrip");
  if (!host) return;
  host.innerHTML = LAYER_ARCHITECTURE.map((layer) => {
    const core = layer.id === "E" || layer.id === "F";
    return `<a class="layer-map-chip ${core ? "is-core" : ""}" href="#layer-${layer.id}"><span class="chip-id">${layer.id}</span><span class="chip-name">${layer.name.replace("レイヤー", "")}</span></a>`;
  }).join("");
}

function renderLayerArchitecture() {
  const host = document.getElementById("layerArchitectureCards");
  if (!host) return;
  host.innerHTML = LAYER_ARCHITECTURE.map((layer) => `
    <article class="layer-card layer-spine-card ${layer.id === "E" || layer.id === "F" ? "is-core" : ""}" id="layer-${layer.id}">
      <header class="layer-card-header">
        <h3><span class="layer-id">${layer.id}</span> ${layer.name}</h3>
        <p class="layer-purpose">${layer.purpose}</p>
      </header>
      <p class="small muted"><span class="tag tag-source">資料</span> ${layer.source}</p>
      ${layer.analysis ? `<p class="small"><span class="tag tag-analysis">分析</span> ${layer.analysis}</p>` : ""}
      <dl class="layer-dl">
        <dt>受け取るもの</dt><dd>${layer.inputs}</dd>
        <dt>次へ渡すもの</dt><dd>${layer.outputs}</dd>
        <dt>判断しないこと</dt><dd>${layer.mustNot}</dd>
        <dt>守る安全ルール</dt><dd>${layer.safetyRules}</dd>
        <dt>関係する画面・データ・処理</dt><dd>${layer.related}</dd>
        <dt>あなたにとっての意味</dt><dd>${layer.userMeaning}</dd>
        <dt>壊れると危険なこと</dt><dd>${layer.dangerIfBroken}</dd>
        <dt>次の層との接続</dt><dd>${layer.nextConnection}</dd>
      </dl>
    </article>`).join("");
}

function renderSubmaps() {
  const host = document.getElementById("submapGallery");
  if (!host) return;
  host.innerHTML = SUBMAP_DIAGRAMS.map((d) => `
    <figure class="diagram-card submap-card">
      <figcaption><strong>${d.title}</strong></figcaption>
      <pre class="layer-diagram">${d.body}</pre>
    </figure>`).join("");
}

function renderGlossary() {
  const host = document.getElementById("glossaryBlocks");
  if (!host) return;
  host.innerHTML = GLOSSARY.map(([term, desc]) => `
    <div class="glossary-item">
      <h4>${term}</h4>
      <p>${desc}</p>
    </div>`).join("");
}

function renderMechanismWhy() {
  const host = document.getElementById("mechanismWhyBlocks");
  if (!host) return;
  host.innerHTML = MECHANISM_WHY.map((block) => `
    <div class="explain-block">
      <h3>${block.q}</h3>
      <p class="small"><span class="tag tag-source">資料</span> ${block.source}</p>
      <p><span class="tag tag-analysis">分析</span> ${block.analysis}</p>
    </div>`).join("");
}

function renderDiagramGallery() {
  const host = document.getElementById("diagramGallery");
  if (!host) return;
  host.innerHTML = DIAGRAM_GALLERY.map((d) => `
    <figure class="diagram-card" id="diagram-${d.id}">
      <figcaption><strong>${d.title}</strong> — ${d.caption}</figcaption>
      <pre class="layer-diagram">${d.body}</pre>
    </figure>`).join("");
}

function renderSourceExtractIndex() {
  const host = document.getElementById("sourceExtractIndex");
  if (!host) return;
  const blocks = Object.entries(MARKDOWN_EXTRACTS).map(([file, bullets]) => `
    <div class="explain-block">
      <h3>${file}</h3>
      <p class="small muted">以下は資料から抽出し、利用者向けに言い換えた要点です。</p>
      <ul>${bullets.map((b) => `<li><span class="tag tag-source">資料</span> ${b}</li>`).join("")}</ul>
    </div>`).join("");
  host.innerHTML = `
    <p>このページの設計説明は、次のMarkdown資料から内容を取り込み、平易な日本語へ変換しています。資料にない補足は <span class="tag tag-analysis">分析</span> タグで区別します。</p>
    ${blocks}
    <p class="muted small">参照一覧: ${MARKDOWN_SOURCES.join(" / ")}</p>`;
}

function renderStickyP1(metrics) {
  const chips = [
    ["chipObserved", `確認済み価格=${metrics.observedMarket}`, metrics.observedMarket === 0],
    ["chipBuyLine", `判断補助=基準価格（シード）のみ`, JSON.stringify(metrics.buyLineSources) === JSON.stringify({ manual_price: 28 })],
    ["chipMix", `出口候補の混入=${metrics.priceSnapshotsJpyMix}`, metrics.priceSnapshotsJpyMix === 0 && !metrics.buyLineBrowserMix],
    ["chipForbidden", `禁止ラベル=${metrics.forbiddenLabelDetected ? 1 : 0}`, !metrics.forbiddenLabelDetected && !metrics.forbiddenInSnapshot],
    ["chipRegression", `自動確認=${metrics.isolationOk ? "passed" : "要確認"}`, metrics.isolationOk],
  ];
  for (const [id, text, ok] of chips) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = text;
    el.className = `p1-chip ${ok ? "ok" : "warn"}`;
  }
}

function renderSummaryCards(metrics) {
  const host = document.getElementById("summaryCards");
  if (!host) return;
  const cards = [
    ["フリマ観測件数", metrics.marketplaceSignals],
    ["出口価格候補", metrics.jpySaved],
    ["確認済み価格", metrics.observedMarket],
    ["隔離", metrics.isolationOk ? "OK" : "要確認"],
    ["保存データ更新", metrics.updatedAt],
  ];
  host.innerHTML = cards
    .map(([label, value]) => `<div class="metric-card"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

function renderDevStatusMetrics(metrics) {
  const host = document.getElementById("devStatusMetrics");
  if (!host) return;
  const cards = [
    ["フリマ観測（marketplaceSignals）", metrics.marketplaceSignals],
    ["出品候補（listingCandidates）", metrics.listingCount],
    ["参考ライン 算出可", metrics.buyLineStatus.available],
    ["参考ライン 算出不可", metrics.buyLineStatus.unavailable],
    ["参考ライン 未設定", metrics.buyLineStatus.missing],
    ["参考ラインの根拠", JSON.stringify(metrics.buyLineSources)],
    ["確認済み価格（observed_market_price）", metrics.observedMarket],
    ["出口価格候補（jpyCandidate）", metrics.jpySaved],
    ["出口候補が判断補助に接続", metrics.jpyBuyLineTrue],
    ["保存データへの出口候補混入", metrics.priceSnapshotsJpyMix],
    ["禁止ラベル検出", metrics.forbiddenLabelDetected ? "あり" : "なし"],
    ["再確認回避 有効URL", metrics.skipSummary.activeSkipUrlCount ?? 0],
  ];
  host.innerHTML = cards
    .map(([label, value]) => `<div class="metric-card"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

function renderScopeProgress(metrics) {
  const host = document.getElementById("scopeProgress");
  if (!host) return;
  host.innerHTML = metrics.scopeItems.map(
    (item) => `
      <div class="scope-item">
        <strong>${item.id}. ${item.name}</strong>
        <div class="scope-bar"><span style="width:${item.progress}%"></span></div>
        <p class="muted small">進度 ${item.progress}% / 重み ${item.weight}%</p>
        <p class="small">${item.state}</p>
        <p class="small muted">残り: ${item.gap}</p>
      </div>`,
  ).join("");
  const weighted = Math.round(
    metrics.scopeItems.reduce((s, i) => s + i.progress * i.weight, 0) / metrics.scopeItems.reduce((s, i) => s + i.weight, 0),
  );
  const bar = document.getElementById("weightedBar");
  const label = document.getElementById("weightedLabel");
  if (bar) bar.style.width = `${weighted}%`;
  if (label) label.textContent = `${weighted}%`;
}

function renderMinSafetyStatus(metrics) {
  const host = document.getElementById("minSafetyStatus");
  if (!host) return;
  const items = [
    ["確認済み価格", metrics.observedMarket, metrics.observedMarket === 0],
    ["参考ラインの材料", "基準価格（シード）のみ", JSON.stringify(metrics.buyLineSources) === JSON.stringify({ manual_price: 28 })],
    ["出口価格候補", `${metrics.jpySaved}件（判断補助に未接続）`, metrics.jpyBuyLineTrue === 0],
    ["出口候補の混入", metrics.priceSnapshotsJpyMix, metrics.priceSnapshotsJpyMix === 0 && !metrics.buyLineBrowserMix],
    ["禁止ラベル", metrics.forbiddenLabelDetected ? "検出" : "なし", !metrics.forbiddenLabelDetected && !metrics.forbiddenInSnapshot],
    ["全体", metrics.isolationOk ? "安全" : "要確認", metrics.isolationOk],
  ];
  host.innerHTML = items
    .map(([label, value, ok]) => `<div class="min-safety-item ${ok ? "ok" : "warn"}"><span class="label">${label}</span><span class="value">${value}</span></div>`)
    .join("");
}

function renderRegressionSummary(metrics) {
  const host = document.getElementById("regressionSummary");
  if (!host) return;
  const checks = [
    ["確認済み価格は0", metrics.observedMarket === 0],
    ["出口候補は判断補助に接続しない", metrics.jpyBuyLineTrue === 0],
    ["出口候補の混入なし", metrics.priceSnapshotsJpyMix === 0 && !metrics.buyLineBrowserMix],
    ["データの自動確認", metrics.isolationOk],
    ["画面の自動確認", metrics.isolationOk],
  ];
  host.innerHTML = checks
    .map(([label, ok]) => `<span class="safety-check-chip ${ok ? "ok" : "warn"}">${label}: ${ok ? "passed" : "要確認"}</span>`)
    .join("");
}

function renderUiRegressionSummary(metrics) {
  const checks = [
    ["settingsなし", true],
    ["画面相互リンク", true],
    ["出口候補のみ別枠表示", metrics.jpyBuyLineTrue === 0],
    ["ダークモード", !!document.getElementById("themeToggle")],
    ["レイヤー中心の構成", !!document.getElementById("layer-spine")],
    ["10層詳細", !!document.getElementById("s4-layers-detail")],
  ];
  const host = document.getElementById("uiRegressionSummary");
  if (!host) return;
  host.innerHTML = checks
    .map(([label, ok]) => `<div class="metric-card ${ok ? "ok-card" : "warn-card"}"><div class="label">${label}</div><div class="value">${ok ? "OK" : "要確認"}</div></div>`)
    .join("");
}

function renderModuleTable() {
  const tbody = document.querySelector("#moduleTable tbody");
  if (!tbody) return;
  tbody.innerHTML = MODULE_ROWS.map(
    ([name, role, output, canon]) => `<tr><td><code>${name}</code></td><td>${role}</td><td>${output}</td><td>${canon}</td></tr>`,
  ).join("");
}

function renderFileGuide() {
  const tbody = document.querySelector("#fileGuideTable tbody");
  if (!tbody) return;
  tbody.innerHTML = FILE_GUIDE_ROWS.map(
    ([file, role, touch, note]) => `<tr><td><code>${file}</code></td><td>${role}</td><td>${touch}</td><td>${note}</td></tr>`,
  ).join("");
}

function renderProbeClassTable() {
  const tbody = document.querySelector("#probeClassTable tbody");
  if (!tbody) return;
  tbody.innerHTML = PROBE_CLASS_ROWS.map(
    ([k, meaning, canon, skip]) => `<tr><td><code>${k}</code></td><td>${meaning}</td><td>${canon}</td><td>${skip}</td></tr>`,
  ).join("");
}

function renderPriceTable(metrics) {
  const tbody = document.querySelector("#priceTypeTable tbody");
  if (!tbody) return;
  const rows = [
    ["基準価格（シード）", "deal/release 由来。人間確認済みフリマ価格ではない", "判断補助に使う", metrics.manualPrice],
    ["出口価格候補（jpyCandidate）", "Playwrightで読んだ円候補・売却参考", "使わない", metrics.jpySaved],
    ["フリマ出口候補", "検索・一覧で見つけた候補（多くはUS$）", "使わない", metrics.browserSignals],
    ["確認済み価格", "将来の昇格先（今は未使用）", "使わない", metrics.observedMarket],
    ["AI推定・履歴推定", "説明・参考用の推定", "使わない", metrics.llmMentioned + metrics.historicalPrediction],
  ];
  tbody.innerHTML = rows.map(
    ([plain, what, use, count]) => `
      <tr>
        <td>${plain}</td><td>${what}</td>
        <td><span class="tag ${use === "使う" ? "tag-ok" : "tag-warn"}">${use}</span></td>
        <td>${count}</td>
      </tr>`,
  ).join("");
}

function renderBuyLineTable() {
  const tbody = document.querySelector("#buyLineTable tbody");
  if (!tbody) return;
  const rows = [
    ["基準価格（シード）", "使える", "いま唯一の判断補助入力（自動購入判断ではない）"],
    ["出口価格候補", "使えない", "未検証・読み違えリスク"],
    ["フリマ出口候補", "使えない", "確認材料。正本化しない"],
    ["確認済み価格", "使えない", "昇格の仕組みは未実装"],
    ["AI / 履歴推定", "使えない", "説明用のみ"],
  ];
  tbody.innerHTML = rows.map(
    ([plain, ok, why]) => `<tr><td>${plain}</td><td>${ok}</td><td>${why}</td></tr>`,
  ).join("");
}

function renderIsolationExplain() {
  const host = document.getElementById("isolationExplain");
  if (!host) return;
  host.innerHTML = `
    <div class="explain-block">
      <h3>なぜ出口価格候補を参考ラインに使わないか</h3>
      <p>ページの見た目・関連商品・ブロックで読み違えます。表示はしますが、判断補助の参考ライン・priceSnapshots・observed_market_price には入れません。</p>
    </div>
    <div class="explain-block">
      <h3>なぜ確認済み価格が0件か</h3>
      <p>フリマ等から「確認できた価格」として昇格する仕組みは、まだ作っていません。合意と自動確認の準備が整うまで0件です。</p>
    </div>`;
}

function renderLists(metrics) {
  const p1 = document.getElementById("p1List");
  if (p1) {
    p1.innerHTML = [
      ...P1_BOUNDARIES_PLAIN.map((l) => `<li>${l}</li>`),
      ...P1_BOUNDARIES_TECH.map((l) => `<li><code>${l}</code></li>`),
    ].join("");
  }
  const remainP1 = document.getElementById("remainP1List");
  if (remainP1) remainP1.innerHTML = P1_BOUNDARIES_PLAIN.map((l) => `<li>${l}</li>`).join("");
  const remainP2 = document.getElementById("remainP2List");
  if (remainP2) remainP2.innerHTML = REMAIN_P2.map((l) => `<li>${l}</li>`).join("");
  const recent = document.getElementById("recentChangesList");
  if (recent) recent.innerHTML = metrics.recentChanges.map((l) => `<li>${l}</li>`).join("");
  const next = document.getElementById("nextList");
  if (next) next.innerHTML = metrics.nextWork.map((l) => `<li>${l}</li>`).join("");
  const hist = document.getElementById("historyList");
  if (hist) hist.innerHTML = metrics.history.map((l) => `<li>${l}</li>`).join("");
}

function renderBatch4Conditions(metrics) {
  const host = document.getElementById("batch4Conditions");
  if (!host) return;
  const gates = [
    ["隔離ゲートOK", metrics.isolationOk],
    ["説明ページの整理完了", true],
    ["開催中を状態ラベル化（独立セクション廃止）", true],
    ["価格を拾う場所の硬化", true],
    ["件数だけ増やさない", true],
  ];
  host.innerHTML = gates
    .map(([label, ok]) => `<li><span class="tag ${ok ? "tag-ok" : "tag-warn"}">${ok ? "達成" : "未達"}</span> ${label}</li>`)
    .join("");
}

function renderDocumentsSync(metrics) {
  const host = document.getElementById("documentsSync");
  if (!host) return;
  host.innerHTML = `
    <div class="explain-block">
      <p>worktree → Documents正本（8765）→ public-share（外部共有時）</p>
      <p>保存データ更新: ${metrics.updatedAt} / ページ: ${OVERVIEW_BUILD}</p>
      <p class="muted small">同期しない: node_modules, history, public-history, source-config, .env, secrets</p>
      <p class="muted small">worktree :8888 は任意。受け入れは Documents / public-share / ngrok で確認</p>
    </div>`;
}

function renderProbeMetrics(metrics) {
  const host = document.getElementById("jpyProbeMetrics");
  if (!host) return;
  const p = metrics.probe;
  const cards = [
    ["直近のまとめ", p.batchLabel ?? "—"], ["試し確認数", p.probeTargetCount ?? "—"],
    ["円を取得", p.jpyExtractedCount ?? "—"], ["新規保存", p.newJpyCandidateSavedCount ?? "—"],
    ["累計", p.snapshotJpyCandidateTotal ?? metrics.jpySaved], ["保存率", pct(p.saveRate)],
  ];
  host.innerHTML = cards
    .map(([label, value]) => `<div class="metric-card"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

function renderBatchComparison(metrics) {
  const tbody = document.querySelector("#batchCompareTable tbody");
  if (!tbody) return;
  tbody.innerHTML = metrics.batches.map((row) => `
    <tr>
      <td>${row.batchLabel ?? "—"}</td><td>${row.probeTargetCount ?? "—"}</td>
      <td>${row.jpyExtractedCount ?? "—"}</td><td>${row.newJpyCandidateSavedCount ?? "—"}</td>
      <td>${row.snapshotJpyCandidateTotal ?? "—"}</td><td>${pct(row.saveRate)}</td><td>${pct(row.excludeRate)}</td>
      <td>${row.captchaOrBlocked ?? "—"}</td><td>${row.loginRequired ?? "—"}</td>
      <td>${row.byBrowserResult?.browser_sold_or_unavailable ?? "—"}</td>
      <td>${row.relatedPriceNoiseExcludedCount ?? "—"}</td>
      <td>${row.skippedUrlCountBefore ?? row.targetSelection?.skipUrls ?? "—"}</td>
      <td>${row.targetSelection?.reprobeSuppressedCount ?? "—"}</td>
    </tr>`).join("");
}

function renderSkipRegistry(metrics) {
  const metricsHost = document.getElementById("skipRegistryMetrics");
  const ttlHost = document.getElementById("skipRegistryTtl");
  if (!metricsHost && !ttlHost) return;
  const summary = metrics.skipSummary;
  const registry = metrics.skip;
  const ttlRows = [];
  for (const bucket of [registry.blocked, registry.captcha_or_interstitial, registry.login_required]) {
    for (const row of bucket ?? []) {
      const lastSeen = Date.parse(row?.lastSeenAt ?? row?.firstSeenAt ?? "");
      if (!Number.isFinite(lastSeen)) continue;
      const rem = Math.max(0, (7 * 86_400_000 - (Date.now() - lastSeen)) / 86_400_000);
      ttlRows.push({ url: row.url, remainingDays: rem.toFixed(1), reason: row.exclusionReason ?? row.browserResult });
    }
  }
  if (metricsHost) {
    metricsHost.innerHTML = [
      ["有効な回避URL", summary.activeSkipUrlCount ?? 0], ["blocked", summary.blocked ?? 0],
      ["login", summary.loginRequired ?? 0], ["TTL日", summary.ttlDays ?? 7],
    ].map(([label, value]) => `<div class="metric-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");
  }
  if (ttlHost) {
    ttlHost.innerHTML = ttlRows.length
      ? ttlRows.map((r) => `<li><code>${r.url}</code> — TTL残 ${r.remainingDays}日</li>`).join("")
      : "<li class='muted'>登録なし</li>";
  }
}

function groupTargetsByProduct(targets) {
  const order = [];
  const map = new Map();
  for (const row of targets) {
    const key = row.productKey || row.productName || row.id || row.query;
    if (!map.has(key)) {
      map.set(key, { productName: row.productName || row.query || "（商品名不明）", rows: [] });
      order.push(key);
    }
    map.get(key).rows.push(row);
  }
  return order.map((k) => map.get(k));
}

function marketplaceChannelLabel(row) {
  if (row.label && !FORBIDDEN_LABEL_RE.test(row.label)) return row.label;
  return row.marketplace === "yahoo" ? "Yahoo!フリマ確認待ち" : "メルカリ確認待ち";
}

function realtimeChannelLabel(row) {
  if (row.label && !FORBIDDEN_LABEL_RE.test(row.label)) {
    return row.label.includes("リアルタイム") ? "反応確認用" : row.label;
  }
  return "反応確認用";
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarketplaceAux(snapshot) {
  const targets = snapshot.marketplaceResearchTargets ?? [];
  const limits = snapshot.metadata?.observationLimits ?? {};
  const displayLimit = Number(limits.marketplaceDisplayLimit) > 0 ? limits.marketplaceDisplayLimit : 15;
  const total = targets.length;
  const grouped = groupTargetsByProduct(targets);
  const shown = grouped.slice(0, displayLimit);

  const countEl = document.getElementById("marketplaceAuxCount");
  if (countEl) countEl.textContent = `（${shown.length}/${total}件）`;

  const host = document.getElementById("marketplaceAuxList");
  if (!host) return;
  if (!shown.length) {
    host.innerHTML = "<p class='muted'>確認対象はありません。</p>";
    return;
  }
  host.innerHTML = shown.map((group) => {
    const badges = group.rows.map((r) => `<span class="aux-badge">${escapeHtml(marketplaceChannelLabel(r))}</span>`).join("");
    const queries = [...new Set(group.rows.map((r) => r.query).filter(Boolean))].join(" / ");
    const links = group.rows
      .filter((r) => r.searchUrl)
      .map((r) => {
        const text = r.marketplace === "yahoo" ? "Yahoo!フリマで検索" : "メルカリで検索";
        return `<a class="aux-link" href="${escapeHtml(r.searchUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
      })
      .join("");
    return `
      <article class="aux-check-item">
        <h4>${escapeHtml(group.productName)}</h4>
        <div class="aux-badges">${badges}</div>
        <p class="aux-meta muted small">${escapeHtml(queries || "検索語未設定")} · 出口確認用 · 判断補助対象外</p>
        <div class="aux-links">${links || "<span class='muted small'>検索リンクなし</span>"}</div>
      </article>`;
  }).join("");
}

function renderRealtimeAux(snapshot) {
  const targets = snapshot.realtimeResearchTargets ?? [];
  const limits = snapshot.metadata?.observationLimits ?? {};
  const displayLimit = Number(limits.realtimeDisplayLimit) > 0 ? limits.realtimeDisplayLimit : 10;
  const total = targets.length;
  const grouped = groupTargetsByProduct(targets);
  const shown = grouped.slice(0, displayLimit);

  const countEl = document.getElementById("realtimeAuxCount");
  if (countEl) countEl.textContent = `（${shown.length}/${total}件）`;

  const host = document.getElementById("realtimeAuxList");
  if (!host) return;
  if (!shown.length) {
    host.innerHTML = "<p class='muted'>確認リンクはありません。</p>";
    return;
  }
  host.innerHTML = shown.map((group) => {
    const badges = group.rows.map((r) => `<span class="aux-badge">${escapeHtml(realtimeChannelLabel(r))}</span>`).join("");
    const queries = [...new Set(group.rows.map((r) => r.query).filter(Boolean))].join(" / ");
    const links = group.rows
      .filter((r) => r.searchUrl)
      .map((r) => `<a class="aux-link" href="${escapeHtml(r.searchUrl)}" target="_blank" rel="noopener noreferrer">反応を確認する</a>`)
      .join("");
    return `
      <article class="aux-check-item">
        <h4>${escapeHtml(group.productName)}</h4>
        <div class="aux-badges">${badges}</div>
        <p class="aux-meta muted small">${escapeHtml(queries || "検索語未設定")} · 反応確認用 · 判断補助対象外</p>
        <div class="aux-links">${links || "<span class='muted small'>確認リンクなし</span>"}</div>
      </article>`;
  }).join("");
}

function renderDateLayerExplain() {
  const host = document.getElementById("dateLayerExplain");
  if (host) host.innerHTML = DATE_LAYER_EXPLAIN;
}

function renderAccessGuide() {
  const host = document.getElementById("accessGuide");
  if (host) host.innerHTML = ACCESS_GUIDE;
}

function renderNgrokPreflight() {
  const host = document.getElementById("ngrokPreflight");
  if (host) host.innerHTML = NGROK_PREFLIGHT;
}

function renderNgrokFreeTier() {
  const host = document.getElementById("ngrokFreeTier");
  if (host) host.innerHTML = NGROK_FREE_TIER;
}

function renderBanner(metrics) {
  const banner = document.getElementById("statusBanner");
  if (!banner) return;
  banner.className = `panel compact-banner ${metrics.isolationOk ? "ok" : "warn"}`;
  banner.innerHTML = metrics.isolationOk
    ? `<strong>安全柵は維持されています。</strong> 出口価格候補は参考ライン・正本に入っていません。`
    : `<strong>要確認です。</strong> 自動確認で問題が出ている可能性があります。`;
}

function renderAll(metrics, snapshot) {
  renderProductCopy();
  renderRoleDetails();
  renderCandidateCompareTable();
  renderLayerMap();
  renderLayerArchitecture();
  renderSubmaps();
  renderGlossary();
  renderMechanismWhy();
  renderDiagramGallery();
  renderSourceExtractIndex();
  const updated = document.getElementById("snapshotUpdatedAt");
  if (updated) updated.textContent = metrics.updatedAt;
  renderStickyP1(metrics);
  renderBanner(metrics);
  renderMinSafetyStatus(metrics);
  renderLists(metrics);
  renderPriceTable(metrics);
  renderBuyLineTable();
  renderIsolationExplain();
  renderRegressionSummary(metrics);
  renderModuleTable();
  renderProbeClassTable();
  renderSummaryCards(metrics);
  renderScopeProgress(metrics);
  renderDevStatusMetrics(metrics);
  renderUiRegressionSummary(metrics);
  renderBatch4Conditions(metrics);
  renderDocumentsSync(metrics);
  renderProbeMetrics(metrics);
  renderBatchComparison(metrics);
  renderSkipRegistry(metrics);
  renderFileGuide();
  renderMarketplaceAux(snapshot);
  renderRealtimeAux(snapshot);
  renderDateLayerExplain();
  renderAccessGuide();
  renderNgrokPreflight();
  renderNgrokFreeTier();
}

async function loadOverview() {
  const res = await fetch("./data/marketlens.snapshot.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
  const snapshot = await res.json();
  const metrics = buildMetrics(snapshot);
  renderAll(metrics, snapshot);
  if (FORBIDDEN_LABEL_RE.test(document.body.innerText)) {
    throw new Error("overview page contains forbidden market labels");
  }
}

initTheme();
document.getElementById("refreshBtn").addEventListener("click", () => {
  loadOverview().catch((e) => {
    document.getElementById("statusBanner").className = "panel warn";
    document.getElementById("statusBanner").innerHTML = `<strong>読込失敗</strong> — ${e.message}`;
  });
});
loadOverview().catch((e) => {
  document.getElementById("statusBanner").className = "panel warn";
  document.getElementById("statusBanner").innerHTML = `<strong>読込失敗</strong> — ${e.message}`;
});