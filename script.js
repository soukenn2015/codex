const shippingRules = {
  pokemon_box: { label: "ポケカBOX", shipping: 210 },
  thin: { label: "4cm以下", shipping: 210 },
  large: { label: "4cm超え", shipping: 750 },
  unknown: { label: "不明", shipping: 750 },
};

const pokemonReleaseMaxAgeDays = 153;
const nyukaNowPokemonUrl = "https://nyuka-now.com/archives/2459";

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `deal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let initialDeals = [
  {
    id: createId(),
    name: "一番くじ HUNTER×HUNTER ZAOLDYECK FAMILY ラストワン賞 ミケ",
    shop: "駿河屋",
    buyPrice: 5400,
    sellPrice: 7900,
    category: "large",
    sourceType: "market",
    saleStartDate: "2026-05-20",
    saleEndDate: "2026-06-15",
    priceSignal: "recheck",
    velocity: "普通",
    risk: "中",
    tags: ["フィギュア", "送料750", "回転普通"],
    reason: "直近発売の一番くじ。大型賞で送料負担が重いので相場上昇の継続待ち。",
    confidence: "中",
    evidence: ["成約増", "送料750確認", "状態差あり"],
    sourceUrl: "https://www.suruga-ya.jp/",
  },
  {
    id: createId(),
    name: "S.H.Figuarts 仮面ライダーギーツ ブーストフォームマークIII",
    shop: "Yahoo!フリマ",
    buyPrice: 7200,
    sellPrice: 11200,
    category: "large",
    sourceType: "market",
    saleStartDate: "2026-05-24",
    saleEndDate: "2026-06-10",
    priceSignal: "gap",
    velocity: "普通",
    risk: "低",
    tags: ["フィギュア", "プレバン", "価格差"],
    reason: "プレミアムバンダイ商品ページを発売元として確認。フリマ相場との差額を見る候補。",
    confidence: "高",
    evidence: ["プレバン商品ページ", "出品少", "目標利益超え"],
    releaseUrl: "https://p-bandai.jp/item/item-1000216200/",
    marketUrl: "https://paypayfleamarket.yahoo.co.jp/",
    sourceUrl: "https://p-bandai.jp/item/item-1000216200/",
  },
  {
    id: createId(),
    name: "ドラゴンクエスト メタリックモンスターズギャラリー スライム ロトブルーバージョン",
    shop: "スクウェア・エニックス e-STORE",
    buyPrice: 1980,
    sellPrice: 3280,
    category: "thin",
    sourceType: "market",
    saleStartDate: "2026-05-18",
    saleEndDate: "2026-06-05",
    priceSignal: "recheck",
    velocity: "普通",
    risk: "低",
    tags: ["ドラクエ", "40周年", "4cm以下"],
    reason: "ドラクエ40周年公式シグナルから具体商品を試験投入。発売元はe-STOREの商品一覧。",
    confidence: "中",
    evidence: ["公式40周年", "送料210想定", "価格再確認"],
    releaseUrl: "https://store.jp.square-enix.com/category/DQMM_R2601/",
    marketUrl: "https://jp.mercari.com/",
    sourceUrl: "https://store.jp.square-enix.com/category/DQMM_R2601/",
  },
  {
    id: createId(),
    name: "ドラゴンクエスト メタリックモンスターズギャラリーバトル はぐれメタル",
    shop: "メルカリ",
    buyPrice: 3200,
    sellPrice: 5400,
    category: "large",
    sourceType: "market",
    saleStartDate: "2026-06-08",
    saleEndDate: "2026-06-30",
    priceSignal: "gap",
    velocity: "普通",
    risk: "中",
    tags: ["ドラクエ", "メタリックモンスターズ", "送料210"],
    reason: "e-STORE具体商品ページを発売元として確認。品切れ時は相場差を見る候補。",
    confidence: "中",
    evidence: ["e-STORE商品ページ", "送料210想定", "状態確認"],
    releaseUrl: "https://store.jp.square-enix.com/category/263/MW36259.html",
    marketUrl: "https://jp.mercari.com/",
    sourceUrl: "https://store.jp.square-enix.com/category/263/MW36259.html",
  },
];

let trends = [
  {
    keyword: "ドラゴンクエスト40周年",
    context: "公式グッズ / コラボ増加",
    score: 86,
    type: "周年",
    change24h: "+29%",
    source: "公式",
    confidence: "高",
    action: "7月発売グッズとコラボ商品の初動を確認",
  },
  {
    keyword: "一番くじ HUNTER×HUNTER ZAOLDYECK FAMILY ラストワン賞 ミケ",
    context: "セブン-イレブン / 5月22日発売 / ゾルディック家",
    score: 92,
    type: "発売中",
    change24h: "直近",
    source: "セブン-イレブン",
    confidence: "高",
    action: "ミケ、シルバ、キルア、アルカの成約と店舗残りを確認",
  },
  {
    keyword: "一番くじ 機動戦士Gundam GQuuuuuuX vol.4 ラストワン賞 赤いガンダム胸像",
    context: "一番くじONLINE / 5月22日発売 / 胸像フィギュア",
    score: 89,
    type: "発売中",
    change24h: "直近",
    source: "一番くじONLINE",
    confidence: "高",
    action: "赤いガンダム胸像と上位賞の初動成約を確認",
  },
  {
    keyword: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空",
    context: "5月8日発売 / A-F賞フィギュア / ラストワン大猿悟空",
    score: 84,
    type: "発売中",
    change24h: "継続確認",
    source: "ドラゴンボール公式",
    confidence: "高",
    action: "店頭在庫とラストワン賞の成約推移を別枠で追跡",
  },
  {
    keyword: "DMM通販 プレミアホビー商品抽選販売",
    context: "抽選販売 / BANDAI SPIRITS / プラモ・フィギュア",
    score: 79,
    type: "抽選",
    change24h: "監視追加",
    source: "HOBBY Watch",
    confidence: "中",
    action: "DMM抽選ページを定期確認ルートへ追加",
  },
  {
    keyword: "GARRACK ONE PIECE スマートウォッチ四皇モデル",
    context: "麦わらストア限定 / コラボ時計 / 数量限定ノベルティ",
    score: 83,
    type: "限定時計",
    change24h: "公式確認",
    source: "ONE PIECE.com",
    confidence: "高",
    action: "発売店舗、在庫、メルカリ成約を時計枠で確認",
  },
  {
    keyword: "G-SHOCK × Coca-Cola GA-2100CC-3AJR",
    context: "2026年5月発売 / コカ・コーラ140周年 / CasiOak",
    score: 76,
    type: "時計",
    change24h: "監視追加",
    source: "CASIO",
    confidence: "中",
    action: "公式発売日と国内流通の有無を確認",
  },
  {
    keyword: "ドラゴンクエスト メタリックモンスターズギャラリー スライム ロトブルーバージョン",
    context: "e-STORE / 送料優位",
    score: 66,
    type: "検証中",
    change24h: "+12%",
    source: "SNS",
    confidence: "中",
    action: "取引量が足りるか確認",
  },
  {
    keyword: "S.H.Figuarts 仮面ライダーギーツ ブーストフォームマークIII",
    context: "プレバン / 出品減",
    score: 81,
    type: "価格差",
    change24h: "+24%",
    source: "フリマ",
    confidence: "高",
    action: "販売中候補へ反映",
  },
  {
    keyword: "ドラゴンクエスト メタリックモンスターズギャラリーバトル はぐれメタル",
    context: "e-STORE / 品切れ確認",
    score: 58,
    type: "予定",
    change24h: "+9%",
    source: "SNS",
    confidence: "低",
    action: "発売後に価格差を確認",
  },
];

let discoveryCandidates = [
  {
    name: "ドラゴンクエスト メタリックモンスターズギャラリー スライム ロトブルーバージョン",
    trend: "ドラゴンクエスト40周年",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 86,
    priceData: "予約段階",
    tradeVolume: "発売前",
    marginSignal: "発売後に初動確認",
    reason: "40周年、記念展、コラボ、公式グッズが重なっている。ただし価格差データはまだ薄いので、即監視ではなく追加候補で様子を見る。",
    confidence: "中",
    adoptionReason: "公式イベントとグッズ発売が重なり、商材化の可能性が高い。",
    missingData: "発売後の成約価格、取引量、送料サイズ",
    sourceUrl: "https://www.dragonquest.jp/news/detail/4245/",
  },
  {
    name: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空",
    trend: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU ラストワン賞 大猿悟空",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 92,
    priceData: "あり",
    tradeVolume: "あり",
    marginSignal: "送料750円込みで再計算",
    reason: "急上昇と成約増は強いが、サイズで送料負けしやすいので利益候補に入れる前に再検証。",
    confidence: "中",
    adoptionReason: "成約増があり、ホビー関連度も高い。",
    missingData: "送料サイズ、最新成約価格、状態差",
  },
  {
    name: "一番くじ ワンピース -エルバフ編- GIANT BASH!! Vol.1 / Vol.2",
    trend: "一番くじ ワンピース -エルバフ編- GIANT BASH!!",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 94,
    priceData: "発売前",
    tradeVolume: "発売後に取得",
    marginSignal: "ラストワン賞と大型フィギュアを重点確認",
    reason: "ワンピース、エルバフ編、2か月連続発売、MASTERLISE系フィギュアが揃っていて話題化しやすい。発売前なので即利益候補ではなく、発売日と相場履歴を蓄積する。",
    confidence: "高",
    adoptionReason: "IPの強さ、公式発売時期、フィギュア中心のラインナップが揃っている。",
    missingData: "発売直後の成約価格、店舗在庫、ラストワン賞の初動",
    sourceUrl: "https://sf.1kuji.com/onep-elbaph/",
  },
  {
    name: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU",
    trend: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU",
    stage: "検証中",
    stageKind: "checking",
    genreScore: 89,
    priceData: "一部あり",
    tradeVolume: "確認中",
    marginSignal: "ラストワン賞と上位賞だけ重点",
    reason: "ドラゴンボールの一番くじは強いが、発売済みの場合は熱が落ちるのも早い。今後は発売日からの日数と成約落ちを見て通常候補か終了・保留に振り分ける。",
    confidence: "中",
    adoptionReason: "強IP、店頭販売、MASTERLISEフィギュアの組み合わせ。",
    missingData: "最新成約価格、残り店舗、発売日からの日数",
    sourceUrl: "https://sf.1kuji.com/1kuji_dragonball/portal/special/db_goku/",
  },
  {
    name: "DMM通販 プレミアホビー商品抽選販売",
    trend: "DMM通販 プレミアホビー商品抽選販売",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 82,
    priceData: "抽選開始後",
    tradeVolume: "商品別",
    marginSignal: "定価抽選の商品だけ対象",
    reason: "DMMはホビー抽選の入口として有効。対象商品が広いので、BANDAI SPIRITS、フィギュア、ガンプラ、人気IPだけに絞って見る。",
    confidence: "中",
    adoptionReason: "抽選販売は定価購入ルートになりやすく、人気商品の利益差が出やすい。",
    missingData: "対象商品一覧、応募期限、販売価格、相場",
    sourceUrl: "https://www.dmm.com/mono/hobby/",
  },
  {
    name: "GARRACK ONE PIECE スマートウォッチ四皇モデル",
    trend: "GARRACK ONE PIECE スマートウォッチ四皇モデル",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 86,
    priceData: "発売直後",
    tradeVolume: "確認中",
    marginSignal: "限定店舗とノベルティ有無を重視",
    reason: "ワンピースIPの時計コラボ。麦わらストア限定、発売日、ノベルティ条件が揃うため、通常グッズではなく時計枠で監視する。",
    confidence: "中",
    adoptionReason: "強IP、限定販売、コラボ時計、店舗限定イベントが揃っている。",
    missingData: "定価、在庫、ノベルティ残数、成約価格",
    sourceUrl: "https://one-piece.com/news/79661/index.html",
  },
  {
    name: "G-SHOCK × Coca-Cola GA-2100CC-3AJR",
    trend: "G-SHOCK × Coca-Cola GA-2100CC-3AJR",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 79,
    priceData: "2026年5月発売",
    tradeVolume: "確認中",
    marginSignal: "コカ・コーラ140周年コラボ",
    reason: "G-SHOCKとCoca-Colaの具体モデル。時計はホビー転売と相性が違うため、IP・数量限定・国内販売有無・サイズ送料を別ルールで見る。",
    confidence: "中",
    adoptionReason: "限定コラボ時計は発売直後に相場差が出ることがある。",
    missingData: "国内発売日、定価、販売数量、成約価格",
    sourceUrl: "https://gshock.casio.com/jp/products/recommend/",
  },
  {
    name: "ドラゴンクエスト メタリックモンスターズギャラリー スライム ロトブルーバージョン",
    trend: "ドラゴンクエスト メタリックモンスターズギャラリー スライム ロトブルーバージョン",
    stage: "検証中",
    stageKind: "checking",
    genreScore: 78,
    priceData: "一部あり",
    tradeVolume: "不足",
    marginSignal: "210円送料なら候補",
    reason: "小型で利益は残しやすいが、取引量がまだ弱い。追加候補止まり。",
    confidence: "低",
    adoptionReason: "小型で送料優位だが、まだ取引量が足りない。",
    missingData: "取引量、発売元、定価",
  },
  {
    name: "S.H.Figuarts 仮面ライダーギーツ ブーストフォームマークIII 出品減",
    trend: "S.H.Figuarts 仮面ライダーギーツ ブーストフォームマークIII",
    stage: "監視入り",
    stageKind: "watching",
    genreScore: 88,
    priceData: "あり",
    tradeVolume: "あり",
    marginSignal: "送料750円込みでも強い",
    reason: "利益候補の販売中枠に反映済み。出品数の減少が続くかだけ追加で見る。",
    confidence: "高",
    adoptionReason: "価格差と取引量が揃い、利益候補へ反映済み。",
    missingData: "出品数の継続推移",
  },
  {
    name: "ドラゴンクエスト メタリックモンスターズギャラリーバトル はぐれメタル",
    trend: "ドラゴンクエスト メタリックモンスターズギャラリーバトル はぐれメタル",
    stage: "追加候補",
    stageKind: "candidate",
    genreScore: 64,
    priceData: "一部あり",
    tradeVolume: "普通",
    marginSignal: "発売後に再計算",
    reason: "未発売寄りで価格差がまだ薄い。発売後の初動成約が出るまでは追加候補止まり。",
    confidence: "中",
    adoptionReason: "発売予定枠として見ておく価値がある。",
    missingData: "発売後の初動成約、送料サイズ",
  },
  {
    name: "話題ワードのみの商品不明枠",
    trend: "SNS一時バズ",
    stage: "保留",
    stageKind: "hold",
    genreScore: 34,
    priceData: "なし",
    tradeVolume: "なし",
    marginSignal: "判定不可",
    reason: "商品名としての確度が低く、価格データがないためリサーチ対象には入れない。",
    confidence: "低",
    adoptionReason: "現時点では話題ワードのみ。",
    missingData: "商品名、価格データ、取引量",
  },
];

let kujiSpecials = [
  {
    id: "kuji-onepiece-luffy-memory",
    title: "一番くじ ワンピース MONKEY.D.LUFFY－冒険の記憶と未来への航路－",
    ip: "ONE PIECE",
    status: "終了",
    releaseDate: "2026-05-02",
    displayUntil: "2026-05-16",
    releaseWindow: "2026年5月2日発売。終了から1週間超過で非表示",
    targetPrizes: "ラストワン賞、ルフィ系フィギュア",
    watchPoints: "履歴保存のみ。通常表示からは外す",
    sourceUrl: "https://magmix.jp/post/351977",
  },
  {
    id: "kuji-dragonball-goku",
    title: "一番くじ ドラゴンボール THE CHRONICLE OF GOKU",
    ip: "DRAGON BALL",
    status: "発売中/相場確認",
    releaseDate: "2026-05-08",
    displayUntil: "2026-06-05",
    releaseWindow: "2026年5月8日発売",
    targetPrizes: "ラストワン賞 大猿悟空、A-F賞フィギュア",
    watchPoints: "発売日からの日数、残り店舗、成約落ち、オンライン販売開始",
    sourceUrl: "https://sf.1kuji.com/1kuji_dragonball/portal/special/db_goku/",
  },
  {
    id: "kuji-hunter-zoldyck",
    title: "一番くじ HUNTER×HUNTER ZAOLDYECK FAMILY",
    ip: "HUNTER×HUNTER",
    status: "発売中/強化",
    releaseDate: "2026-05-22",
    displayUntil: "2026-06-12",
    releaseWindow: "2026年5月22日発売",
    targetPrizes: "ラストワン賞 ミケ、シルバ、キルア、アルカ",
    watchPoints: "セブン在庫、ラストワン賞ミケ、上位フィギュアの成約",
    sourceUrl: "https://www.sej.co.jp/products/hhkuji2605.html",
  },
  {
    id: "kuji-gundam-gquuuuuux-vol4",
    title: "一番くじ 機動戦士Gundam GQuuuuuuX（ジークアクス） vol.4",
    ip: "Gundam GQuuuuuuX",
    status: "発売中/強化",
    releaseDate: "2026-05-22",
    displayUntil: "2026-06-12",
    releaseWindow: "2026年5月22日発売",
    targetPrizes: "ラストワン賞 赤いガンダム胸像、上位胸像フィギュア",
    watchPoints: "一番くじONLINE、店頭残り、胸像フィギュアの成約",
    sourceUrl: "https://on-line.1kuji.com/Form/Product/ProductDetail.aspx?bid=IP00002109&pid=sap_0000008448",
  },
  {
    id: "kuji-onepiece-elbaph",
    title: "一番くじ ワンピース -エルバフ編- GIANT BASH!!",
    ip: "ONE PIECE",
    status: "発売前強化",
    releaseDate: "2026-07-01",
    displayUntil: "2026-09-07",
    releaseWindow: "Vol.1 2026年7月 / Vol.2 2026年8月。直近1ヶ月外なので今は非表示",
    targetPrizes: "ラストワン賞、MASTERLISE系、A-D賞フィギュア",
    watchPoints: "発売初週の成約、店舗在庫、オンライン販売開始、再販告知",
    sourceUrl: "https://sf.1kuji.com/onep-elbaph/",
  },
];

let marketMemory = [
  {
    id: "memory-onepiece-ip",
    title: "ワンピースIP監視",
    genre: "IP全体 / フィギュア / 時計 / 一番くじ",
    status: "強化",
    learnedFrom: "一番くじ、フィギュア、限定時計、公式ストア限定グッズ",
    signal: "エルバフ編、限定店舗、ノベルティ、上位フィギュア、時計コラボが重なると強い",
    history: "商品種別ごとに発売日、販売場所、成約価格、数量限定要素を保存。",
    watchNext: "ONE PIECE.com、麦わらストア、一番くじ公式、HOBBY Watch、電撃系ニュース、スニダン相場",
    sourceUrl: "https://one-piece.com/news/79661/index.html",
  },
  {
    id: "memory-dragonball-ip",
    title: "ドラゴンボールIP監視",
    genre: "IP全体 / MASTERLISE / フィギュア / 一番くじ",
    status: "強化",
    learnedFrom: "一番くじ、プライズ、フィギュアーツ、MASTERLISE、発売済み弾の相場落ち",
    signal: "悟空/ベジータ/フリーザ等の主役級、上位賞、大型フィギュアは強いが劣化も早い",
    history: "発売日、オンライン販売日、上位賞/ラストワン賞の成約価格を履歴化。古い弾は通常監視から外す。",
    watchNext: "一番くじ公式、プレバン、S.H.Figuarts、電撃オンライン、HOBBY Watch",
    sourceUrl: "https://sf.1kuji.com/1kuji_dragonball/portal/special/db_goku/",
  },
  {
    id: "memory-dmm-lottery",
    title: "DMM通販抽選",
    genre: "抽選 / プレミアホビー",
    status: "監視追加",
    learnedFrom: "DMM通販の抽選販売、HOBBY Watchの受付開始ニュース",
    signal: "定価抽選、BANDAI SPIRITS、人気IP、受付期限ありが重なると見る価値が高い",
    history: "対象商品、応募期間、販売価格、発売後相場を保存して次回抽選の優先度に反映。",
    watchNext: "DMM通販、HOBBY Watch、Up To Date、電撃ホビーウェブ",
    sourceUrl: "https://www.dmm.com/mono/hobby/",
  },
  {
    id: "memory-collab-watch",
    title: "コラボ時計監視",
    genre: "時計 / G-SHOCK / アニメIP",
    status: "監視追加",
    learnedFrom: "ONE PIECE GARRACK、G-SHOCKコラボ、限定生産時計",
    signal: "IP人気、数量限定、店舗限定、ノベルティ、国内流通少が重なると見る価値が高い",
    history: "発売日、定価、販売場所、在庫、ノベルティ有無、成約価格を時計枠で保存。",
    watchNext: "ONE PIECE.com、CASIO/G-SHOCK公式、Up To Date、HOBBY Watch、電撃ホビーウェブ",
    sourceUrl: "https://gshock.casio.com/jp/features/collaboration/",
  },
];

let lotteryRoutes = [
  {
    id: createId(),
    scope: "online",
    priority: "high",
    name: "ポケモンセンターオンライン",
    source: "公式通販",
    action: "スタッフボイスと抽選ページを定期確認",
    note: "新商品や人気BOXは抽選、第2回抽選、受注販売の対象になりやすい最優先ルート。",
    condition: "会員登録 / 1人1BOX制限に注意",
    sourceUrl: "https://snkrdunk.com/articles/20315/",
  },
  {
    id: createId(),
    scope: "online",
    priority: "high",
    name: "Amazon 招待リクエスト",
    source: "EC抽選",
    action: "対象BOXの商品ページで招待をリクエスト",
    note: "リクエスト後は長期間チャンスが残る。招待後は購入期限が短いのでメール確認重視。",
    condition: "販売元Amazon.co.jpを確認 / 当選後72時間以内",
    sourceUrl: "https://snkrdunk.com/articles/20374/",
  },
  {
    id: createId(),
    scope: "online",
    priority: "medium",
    name: "楽天ブックス / 楽天市場",
    source: "EC抽選・再販",
    action: "楽天ブックス抽選と発売後ゲリラ再販を監視",
    note: "新弾抽選と再販検知向き。定価以外の販売も混ざるので価格確認を強める。",
    condition: "定価販売のみ対象 / ポイント還元は補助扱い",
    sourceUrl: "https://snkrdunk.com/articles/20315/",
  },
  {
    id: createId(),
    scope: "online",
    priority: "medium",
    name: "イオンスタイルオンライン / キッズリパブリック",
    source: "アプリ・EC抽選",
    action: "アプリ抽選とオンライン抽選を確認",
    note: "大型新弾で抽選対象になりやすい。大阪受け取り店舗も後続で確認。",
    condition: "アプリ登録 / 受け取り店舗条件に注意",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "online",
    priority: "medium",
    name: "ジョーシンアプリ",
    source: "アプリ抽選",
    action: "会員向け抽選を確認",
    note: "関西圏の実店舗導線と相性が良い。事前抽選中心で当日販売は低めに扱う。",
    condition: "会員登録 / アプリ通知ON",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "osaka",
    priority: "high",
    name: "ポケモンセンターオーサカ / オーサカDX",
    source: "大阪店舗",
    action: "発売日前の事前入店抽選を確認",
    note: "新弾は入店抽選で購入権が決まることがある。定価BOX/パック狙いの本命枠。",
    condition: "入店抽選 / 購入上限あり",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "osaka",
    priority: "high",
    name: "ビックカメラ なんば周辺",
    source: "大阪店舗",
    action: "店舗の事前抽選と購入履歴条件を確認",
    note: "当選者のみ購入できる形式が多い。ポイントカードの購入履歴条件が重要。",
    condition: "購入履歴 / ポイントカード条件",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "osaka",
    priority: "medium",
    name: "ヨドバシカメラ 梅田",
    source: "大阪店舗",
    action: "ヨドバシ・ドット・コム抽選と店舗販売条件を確認",
    note: "事前抽選が軸。当日販売がある場合もカード条件が絡むケースがある。",
    condition: "会員条件 / ゴールドポイントカード条件に注意",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "osaka",
    priority: "medium",
    name: "ジョーシン 大阪店舗",
    source: "大阪店舗",
    action: "ジョーシンアプリ抽選を大阪受け取りで確認",
    note: "関西の店舗数が多く、アプリ抽選から拾う枠として残す。",
    condition: "会員抽選 / 受け取り店舗指定",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "osaka",
    priority: "medium",
    name: "TSUTAYA / トイザらス 大阪店舗",
    source: "大阪店舗",
    action: "店頭POP、QR抽選、公式SNSを確認",
    note: "店ごとに抽選方法が違うので、近い店舗を予定枠へ残す。",
    condition: "店舗掲示 / アプリ・ポイント条件あり",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
  {
    id: createId(),
    scope: "osaka",
    priority: "low",
    name: "カードショップ大阪枠",
    source: "大阪店舗",
    action: "カードラボ、駿河屋、ドラゴンスター等の抽選告知を確認",
    note: "カードショップは抽選ありが多い。近場だけ通知対象にするとノイズが少ない。",
    condition: "店舗別抽選 / X告知確認",
    sourceUrl: "https://snkrdunk.com/articles/28451/",
  },
];

let pokemonReleases = [
  {
    id: "abyss-eye",
    name: "アビスアイ",
    product: "拡張パック BOX",
    releaseDate: "2026-05-22",
    saleStartDate: "2026-05-22",
    saleEndDate: "2026-06-30",
    retailPrice: 6000,
    marketPrice: 13500,
    marketLabel: "一般相場 13,500円〜",
    marketUpdated: "2026-05-22",
    sourceUrl: "https://snkrdunk.com/articles/32287/",
    note: "発売直後のBOX相場が定価を大きく上回る。抽選/再販ルートを優先監視。",
    routes: [
      {
        scope: "online",
        name: "ポケモンセンターオンライン",
        round: "第2回/受注枠",
        startDate: "2026-05-22T10:00:00+09:00",
        deadlineLabel: "第2回抽選/受注: 随時確認",
        deadlineDate: null,
        priority: "high",
        url: "https://www.pokemoncenter-online.com/",
      },
      {
        scope: "online",
        name: "Amazon 招待リクエスト",
        round: "招待リクエスト",
        startDate: "2026-05-22T10:00:00+09:00",
        deadlineLabel: "招待リクエスト: 常時",
        deadlineDate: null,
        priority: "high",
        url: "https://www.amazon.co.jp/",
      },
      {
        scope: "osaka",
        name: "TSUTAYA リノアス八尾店",
        round: "5/16-5/17受付",
        deadlineLabel: "抽選終了: 5/17",
        deadlineDate: "2026-05-17T23:59:00+09:00",
        priority: "medium",
        url: "https://snkrdunk.com/articles/32030/",
      },
      {
        scope: "osaka",
        name: "MINT 梅田店",
        round: "5/15-5/18受付",
        deadlineLabel: "抽選終了: 5/18 21:00",
        deadlineDate: "2026-05-18T21:00:00+09:00",
        priority: "medium",
        url: "https://snkrdunk.com/articles/32030/",
      },
    ],
  },
  {
    id: "mega-dream-ex",
    name: "MEGAドリームex",
    product: "ハイクラスパック BOX",
    releaseDate: "2025-11-28",
    saleStartDate: "2025-11-28",
    saleEndDate: "2026-06-30",
    retailPrice: 5500,
    marketPrice: 20000,
    marketLabel: "一般相場 20,000円〜",
    marketUpdated: "2026-05-12",
    sourceUrl: "https://snkrdunk.com/articles/32203/",
    note: "再販後も即完売が続き、BOX相場が高い状態。定価購入ルートを別枠で監視。",
    routes: [
      {
        scope: "online",
        name: "MEGAドリームex 再販まとめ",
        round: "再販監視",
        startDate: "2026-05-12T10:00:00+09:00",
        deadlineLabel: "再販入荷: 随時更新",
        deadlineDate: null,
        priority: "high",
        url: "https://snkrdunk.com/articles/30701/",
      },
      {
        scope: "online",
        name: "Amazon 招待リクエスト",
        round: "招待リクエスト",
        startDate: "2025-11-28T10:00:00+09:00",
        deadlineLabel: "招待リクエスト: 常時",
        deadlineDate: null,
        priority: "high",
        url: "https://www.amazon.co.jp/",
      },
      {
        scope: "osaka",
        name: "大阪量販店 再販枠",
        round: "再販監視",
        startDate: "2026-05-12T10:00:00+09:00",
        deadlineLabel: "店頭/アプリ告知: 随時",
        deadlineDate: null,
        priority: "medium",
        url: "https://snkrdunk.com/articles/30701/",
      },
    ],
  },
  {
    id: "inferno-x",
    name: "インフェルノX",
    product: "拡張パック BOX",
    releaseDate: "2025-09-26",
    saleStartDate: "2025-09-26",
    saleEndDate: "2026-06-30",
    retailPrice: 5400,
    marketPrice: null,
    marketLabel: "BOX相場取得待ち",
    marketUpdated: "再販情報 2026-05-27",
    sourceUrl: "https://snkrdunk.com/articles/30254/",
    watchStatus: "archive",
    archiveReason: "発売から時間が経過し、主要な抽選・再販の山はほぼ終了。必要なら別枠で確認。",
    note: "通常監視からは外し、終了・保留枠で必要時のみ確認する。",
    routes: [
      {
        scope: "online",
        name: "インフェルノX 再販まとめ",
        round: "再販監視",
        startDate: "2026-05-27T10:00:00+09:00",
        deadlineLabel: "再販入荷: 随時更新",
        deadlineDate: null,
        priority: "medium",
        url: "https://snkrdunk.com/articles/30254/",
      },
      {
        scope: "osaka",
        name: "大阪カードショップ再販",
        round: "再販監視",
        startDate: "2026-05-27T10:00:00+09:00",
        deadlineLabel: "X/店頭告知: 随時",
        deadlineDate: null,
        priority: "low",
        url: "https://snkrdunk.com/articles/30254/",
      },
    ],
  },
  {
    id: "next-main-box",
    name: "次弾 予約前BOX",
    product: "拡張パック BOX",
    titleAnnounced: false,
    releaseDate: "2026-07-24",
    saleStartDate: "2026-07-24",
    saleEndDate: "2026-08-31",
    retailPrice: 5400,
    marketPrice: null,
    marketLabel: "発売前 / 相場取得待ち",
    marketUpdated: "予定枠",
    sourceUrl: "https://snkrdunk.com/articles/20315/",
    note: "未発売・未抽選期間の枠。抽選開始後に期間中へ移動する想定。",
    routes: [
      {
        scope: "online",
        name: "ポケモンセンターオンライン",
        round: "抽選開始待ち",
        startDate: "2026-07-01T10:00:00+09:00",
        deadlineLabel: "抽選前: 7月上旬想定",
        deadlineDate: "2026-07-10T23:59:00+09:00",
        priority: "medium",
        url: "https://www.pokemoncenter-online.com/",
      },
      {
        scope: "osaka",
        name: "大阪店舗 入店抽選",
        round: "抽選開始待ち",
        startDate: "2026-07-10T10:00:00+09:00",
        deadlineLabel: "抽選前: 発売2週間前想定",
        deadlineDate: "2026-07-20T23:59:00+09:00",
        priority: "low",
        url: "https://snkrdunk.com/articles/28451/",
      },
    ],
  },
];

const sourceLabels = {
  lottery: "抽選",
  restock: "再販",
  market: "フリマ",
  manual: "手動",
};

const state = {
  deals: [...initialDeals],
  filter: "all",
  routeFilter: "all",
  pokecaCollapsed: readPokecaCollapsed(),
  kujiCollapsed: readKujiCollapsed(),
  appliedRoutes: readAppliedRoutes(),
  actionDone: readActionDone(),
  query: "",
  sortMode: "profit_desc",
  theme: readInitialTheme(),
  settings: {
    feeRate: 5,
    targetProfit: 1500,
    priceBuffer: 3,
    packingCost: 80,
  },
  notifications: readNotificationSettings(),
  predictionLearning: readPredictionLearning(),
  dataMeta: {
    source: "seed",
    updatedAt: null,
    status: "seed",
  },
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function signedYen(value) {
  return `${value >= 0 ? "+" : ""}${yen.format(value)}`;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const diff = new Date(dateValue).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

function daysSinceDate(dateValue) {
  if (!dateValue) return null;
  const diff = Date.now() - new Date(`${dateValue}T00:00:00+09:00`).getTime();
  return Math.floor(diff / 86_400_000);
}

function deadlineText(dateValue, fallback = "随時") {
  const days = daysUntil(dateValue);
  if (days === null) return fallback;
  if (days < 0) return "期限超過";
  if (days === 0) return "今日まで";
  if (days === 1) return "明日まで";
  return `あと${days}日`;
}

function formatDateOnly(value, fallback = "未設定") {
  if (!value) return fallback;
  const normalized = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return value;
  const [, month, day] = normalized.split("-");
  return `${month}/${day}`;
}

function formatDateTime(value, fallback = "随時") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isKujiText(value) {
  return /一番くじ|1kuji|kuji/i.test(value ?? "");
}

function isKujiTrend(trend) {
  return isKujiText([trend.keyword, trend.type, trend.context, trend.source].join(" "));
}

function isKujiCandidate(candidate) {
  return isKujiText([candidate.name, candidate.trend].join(" "));
}

function normalizeSignalText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isDuplicateSignalCandidate(candidate) {
  const name = normalizeSignalText(candidate.name);
  const trend = normalizeSignalText(candidate.trend);
  if (!name || !trend) return false;
  return name === trend || name.includes(trend) || trend.includes(name);
}

function isVisibleDiscoveryCandidate(candidate) {
  if (candidate.confidence === "低") return false;
  const dealNames = state.deals.map((deal) => normalizeSignalText(deal.name));
  const candidateName = normalizeSignalText(candidate.name);
  const alreadyActionable = dealNames.some((name) => name && candidateName && (name.includes(candidateName) || candidateName.includes(name)));
  const visibleTrendNames = trends.filter(shouldDisplayTrend).map((trend) => normalizeSignalText(displayTrendKeyword(trend.keyword)));
  const trendMatched = visibleTrendNames.some(
    (name) => name && candidateName && (name.includes(candidateName) || candidateName.includes(name)),
  );
  return (
    candidate.stageKind === "candidate" &&
    candidate.confidence === "中" &&
    !isKujiCandidate(candidate) &&
    !isDuplicateSignalCandidate(candidate) &&
    !alreadyActionable &&
    !trendMatched
  );
}

function isOverlappingWithActionable(candidateName) {
  const key = normalizeSignalText(candidateName);
  if (!key) return false;
  const inDeals = state.deals.some((deal) => {
    const name = normalizeSignalText(deal.name);
    return name && (name.includes(key) || key.includes(name));
  });
  const inReleases = pokemonReleases.some((release) => {
    const name = normalizeSignalText(release.name);
    return name && (name.includes(key) || key.includes(name));
  });
  return inDeals || inReleases;
}

function priorityFromRoute(route, status) {
  if (status.kind === "active" && route.priority === "high") return "高";
  if (status.kind === "active") return "中";
  return route.priority === "low" ? "低" : "中";
}

function priorityFromDeal(calc, type) {
  if (type === "recheck") return "中";
  if (calc.profit >= state.settings.targetProfit * 2) return "高";
  return "中";
}

const elements = {
  actionList: document.querySelector("#actionList"),
  dealList: document.querySelector("#dealList"),
  discoveryList: document.querySelector("#discoveryList"),
  earlySignalList: document.querySelector("#earlySignalList"),
  kujiSpecialSection: document.querySelector("#kujiSpecialSection"),
  kujiSpecialList: document.querySelector("#kujiSpecialList"),
  kujiSpecialSummary: document.querySelector("#kujiSpecialSummary"),
  kujiSpecialToggle: document.querySelector("#kujiSpecialToggle"),
  marketMemoryList: document.querySelector("#marketMemoryList"),
  routeList: document.querySelector("#routeList"),
  archiveRouteList: document.querySelector("#archiveRouteList"),
  lotterySection: document.querySelector("#lotterySection"),
  lotterySummary: document.querySelector("#lotterySummary"),
  pokecaToggle: document.querySelector("#pokecaToggle"),
  trendList: document.querySelector("#trendList"),
  archiveCandidateList: document.querySelector("#archiveCandidateList"),
  template: document.querySelector("#dealTemplate"),
  routeTemplate: document.querySelector("#routeTemplate"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  themeToggle: document.querySelector("#themeToggle"),
  refreshData: document.querySelector("#refreshData"),
  dataStatus: document.querySelector("#dataStatus"),
  enableNotifications: document.querySelector("#enableNotifications"),
  testNotification: document.querySelector("#testNotification"),
  notificationStatus: document.querySelector("#notificationStatus"),
  feeRate: document.querySelector("#feeRate"),
  targetProfit: document.querySelector("#targetProfit"),
  priceBuffer: document.querySelector("#priceBuffer"),
  packingCost: document.querySelector("#packingCost"),
  sidebarFee: document.querySelector("#sidebarFee"),
  hotCount: document.querySelector("#hotCount"),
  totalProfit: document.querySelector("#totalProfit"),
  avgMargin: document.querySelector("#avgMargin"),
  trendCount: document.querySelector("#trendCount"),
  navItems: document.querySelectorAll(".nav-item"),
  routeSegments: document.querySelectorAll(".route-segment"),
  sections: {
    today: document.querySelector("#actionSection"),
    trends: document.querySelector("#marketIntelSection"),
    settings: document.querySelector("#settingsSection"),
  },
  sectionGroups: {
    today: [
      document.querySelector("#actionSection"),
      document.querySelector("#lotterySection"),
      document.querySelector("#todaySection"),
    ],
    trends: [document.querySelector("#marketIntelSection")],
    settings: [document.querySelector("#settingsSection")],
  },
};

function calculateDeal(deal) {
  const fee = Math.round(deal.sellPrice * (state.settings.feeRate / 100));
  const buffer = Math.round(deal.sellPrice * (state.settings.priceBuffer / 100));
  const shipping = shippingRules[deal.category]?.shipping ?? shippingRules.unknown.shipping;
  const packing = state.settings.packingCost;
  const netSale = deal.sellPrice - fee;
  const profit = netSale - deal.buyPrice - shipping - packing - buffer;
  const buyLine = netSale - shipping - packing - buffer - state.settings.targetProfit;
  const margin = deal.buyPrice > 0 ? (profit / deal.buyPrice) * 100 : 0;

  return { fee, buffer, shipping, packing, netSale, profit, buyLine, margin };
}

function findDealForCandidate(candidate) {
  const candidateName = normalizeSignalText(candidate?.name);
  if (!candidateName) return null;
  return (
    state.deals.find((deal) => {
      const dealName = normalizeSignalText(deal.name);
      return dealName && (dealName.includes(candidateName) || candidateName.includes(dealName));
    }) ?? null
  );
}

function findReleaseForCandidate(candidate) {
  const candidateName = normalizeSignalText(candidate?.name);
  if (!candidateName) return null;
  return (
    pokemonReleases.find((release) => {
      const releaseName = normalizeSignalText(release.name);
      return releaseName && (releaseName.includes(candidateName) || candidateName.includes(releaseName));
    }) ?? null
  );
}

function candidateProfitSummary(candidate) {
  const compactEvidence = (text) =>
    String(text ?? "")
      .replace(new RegExp(`^${String(candidate?.name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "u"), "")
      .trim();
  const candidateCalc = calculateCandidateMarketProfit(candidate);
  if (candidateCalc) {
    return {
      known: true,
      value: `想定利益 ${signedYen(candidateCalc.profit)}`,
      body: `買える上限 ${yen.format(Math.max(0, candidateCalc.buyLine))} / 公式価格 ${yen.format(candidate.retailPrice)}`,
      evidence: compactEvidence(candidate.marketPriceLabel || candidate.retailPriceLabel) || "候補データの価格から試算",
      reasons: [],
      targets: [],
    };
  }

  const matchedDeal = findDealForCandidate(candidate);
  if (matchedDeal) {
    const calc = calculateDeal(matchedDeal);
    return {
      known: true,
      value: `想定利益 ${signedYen(calc.profit)}`,
      body: `買える上限 ${yen.format(Math.max(0, calc.buyLine))} / 発売元 ${dealReleaseSourceName(matchedDeal)}`,
      evidence: "既存の利益候補データと一致",
      reasons: [],
      targets: [dealReleaseSourceName(matchedDeal), "メルカリ相場"].filter(Boolean),
    };
  }

  const matchedRelease = findReleaseForCandidate(candidate);
  if (matchedRelease) {
    const calc = calculateRelease(matchedRelease);
    if (calc.profit !== null) {
      return {
        known: true,
        value: `想定利益 ${signedYen(calc.profit)}`,
        body: `${getReleaseMarketLabel(matchedRelease)} / 定価 ${yen.format(matchedRelease.retailPrice)}`,
        evidence: "既存の弾別相場データと一致",
        reasons: [],
        targets: ["スニダン相場", "公式価格"],
      };
    }
  }

  const reasons = candidateMissingReasons(candidate);
  const targets = candidateResearchTargets(candidate);
  return {
    known: false,
    value: "利益未計算",
    body: reasons.length > 0 ? `未取得: ${reasons.join(" / ")}` : `未取得: ${candidate.priceData} / ${candidate.tradeVolume}`,
    evidence: targets.length > 0 ? `取得先: ${targets.join(" / ")}` : "定価または相場の数値が不足",
    reasons,
    targets,
  };
}

function createExternalIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M7 17 17 7M9 7h8v8");
  svg.append(path);
  return svg;
}

function setSafeLink(anchor, url, label) {
  try {
    const parsed = new URL(url, window.location.href);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      anchor.remove();
      return false;
    }
    anchor.href = parsed.href;
    anchor.target = "_self";
    anchor.rel = "noreferrer";
    if (label) anchor.setAttribute("aria-label", label);
    return true;
  } catch {
    anchor.remove();
    return false;
  }
}

function setDetailLines(element, lines) {
  element.replaceChildren();
  for (const line of lines.filter(Boolean)) {
    const row = document.createElement("div");
    row.textContent = line;
    element.append(row);
  }
}

function requestJson(path) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", `${path}?t=${Date.now()}`);
    request.responseType = "json";
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response ?? JSON.parse(request.responseText));
        return;
      }
      reject(new Error(`HTTP ${request.status}`));
    };
    request.onerror = () => reject(new Error("Snapshot request failed"));
    request.send();
  });
}

function normalizeDeal(deal) {
  return {
    ...deal,
    id: deal.id ?? createId(),
    tags: Array.isArray(deal.tags) ? deal.tags : [],
  };
}

function mergeByKey(baseItems, incomingItems, getKey) {
  const merged = new Map();
  for (const item of baseItems) {
    merged.set(getKey(item), item);
  }
  for (const item of incomingItems) {
    merged.set(getKey(item), item);
  }
  return [...merged.values()];
}

function applyResearchSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;

  if (Array.isArray(snapshot.deals)) {
    initialDeals = snapshot.deals.map(normalizeDeal);
    state.deals = [...initialDeals];
  }
  if (Array.isArray(snapshot.trends)) {
    trends = [...snapshot.trends];
  }
  if (Array.isArray(snapshot.discoveryCandidates)) {
    discoveryCandidates = [...snapshot.discoveryCandidates];
  }
  if (Array.isArray(snapshot.kujiSpecials)) {
    kujiSpecials = [...snapshot.kujiSpecials];
  }
  if (Array.isArray(snapshot.marketMemory)) {
    marketMemory = [...snapshot.marketMemory];
  }
  if (Array.isArray(snapshot.lotteryRoutes)) {
    lotteryRoutes = snapshot.lotteryRoutes.map((route) => ({ ...route, id: route.id ?? createId() }));
  }
  if (Array.isArray(snapshot.pokemonReleases)) {
    pokemonReleases = [...snapshot.pokemonReleases];
  }

  state.dataMeta = {
    source: snapshot.metadata?.source ?? "snapshot",
    updatedAt: snapshot.metadata?.updatedAt ?? new Date().toISOString(),
    status: snapshot.metadata?.status ?? "loaded",
    reachableSources: snapshot.metadata?.reachableSources ?? null,
    totalSources: snapshot.metadata?.totalSources ?? null,
    manualDeals: snapshot.metadata?.manualDeals ?? null,
  };
  return true;
}

function formatUpdatedAt(value) {
  if (!value) return "Seed data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function updateDataStatus(label) {
  if (!elements.dataStatus) return;
  const backlog = candidateValidationBacklog();
  const backlogText =
    backlog.total > 0
      ? ` / 未確定 ${backlog.total}（期間${backlog.missingPeriod} 価格${backlog.missingPrice} 鮮度${backlog.stalePrice} 導線${backlog.missingRoute}）`
      : "";
  const source =
    state.dataMeta.status === "partial" && state.dataMeta.reachableSources != null && state.dataMeta.totalSources != null
      ? `${state.dataMeta.source} partial ${state.dataMeta.reachableSources}/${state.dataMeta.totalSources}`
      : state.dataMeta.source;
  const deals = state.dataMeta.manualDeals ? ` / deals ${state.dataMeta.manualDeals}` : "";
  elements.dataStatus.textContent = label ?? `Data: ${source}${deals} / ${formatUpdatedAt(state.dataMeta.updatedAt)}${backlogText}`;
}

function candidateValidationBacklog() {
  let missingPeriod = 0;
  let missingPrice = 0;
  let stalePrice = 0;
  let missingRoute = 0;
  for (const candidate of discoveryCandidates) {
    if (candidate.stageKind !== "candidate") continue;
    const status = candidateValidationState(candidate);
    if (status === "missing_period") missingPeriod += 1;
    if (status === "missing_price") missingPrice += 1;
    if (status === "stale_price") stalePrice += 1;
    if (status === "missing_route") missingRoute += 1;
  }
  return {
    missingPeriod,
    missingPrice,
    stalePrice,
    missingRoute,
    total: missingPeriod + missingPrice + stalePrice + missingRoute,
  };
}

async function loadResearchSnapshot({ rerender = false } = {}) {
  if (elements.refreshData) elements.refreshData.disabled = true;
  updateDataStatus("Data: loading...");
  try {
    const snapshot = await requestJson("./data/marketlens.snapshot.json");
    applyResearchSnapshot(snapshot);
    updateDataStatus();
    if (rerender) renderAll();
  } catch {
    state.dataMeta = { source: "seed", updatedAt: null, status: "seed" };
    updateDataStatus("Data: seed / snapshotなし");
    if (rerender) renderAll();
  } finally {
    if (elements.refreshData) elements.refreshData.disabled = false;
  }
}

function readInitialTheme() {
  try {
    return localStorage.getItem("marketlens-theme") || "light";
  } catch {
    return "light";
  }
}

function readAppliedRoutes() {
  try {
    return JSON.parse(localStorage.getItem("marketlens-applied-routes") || "{}");
  } catch {
    return {};
  }
}

function readPokecaCollapsed() {
  try {
    return localStorage.getItem("marketlens-pokeca-collapsed") !== "false";
  } catch {
    return true;
  }
}

function readKujiCollapsed() {
  try {
    return localStorage.getItem("marketlens-kuji-collapsed") !== "false";
  } catch {
    return true;
  }
}

function saveKujiCollapsed() {
  try {
    localStorage.setItem("marketlens-kuji-collapsed", String(state.kujiCollapsed));
  } catch {
    // Collapsed state is optional.
  }
}

function savePokecaCollapsed() {
  try {
    localStorage.setItem("marketlens-pokeca-collapsed", String(state.pokecaCollapsed));
  } catch {
    // Collapsed state is optional.
  }
}

function saveAppliedRoutes() {
  try {
    localStorage.setItem("marketlens-applied-routes", JSON.stringify(state.appliedRoutes));
  } catch {
    // Applying routes still works for this session if persistence is unavailable.
  }
}

function readActionDone() {
  try {
    return JSON.parse(localStorage.getItem("marketlens-action-done") || "{}");
  } catch {
    return {};
  }
}

function saveActionDone() {
  try {
    localStorage.setItem("marketlens-action-done", JSON.stringify(state.actionDone));
  } catch {
    // Action checks still work for this session if persistence is unavailable.
  }
}

function readNotificationSettings() {
  try {
    return JSON.parse(localStorage.getItem("marketlens-notifications") || '{"enabled":false,"lastSentDate":null}');
  } catch {
    return { enabled: false, lastSentDate: null };
  }
}

function saveNotificationSettings() {
  try {
    localStorage.setItem("marketlens-notifications", JSON.stringify(state.notifications));
  } catch {
    // Notification settings still work for this session if persistence is unavailable.
  }
}

function readPredictionLearning() {
  try {
    return JSON.parse(localStorage.getItem("marketlens-prediction-learning") || '{"records":[],"offsetByKey":{}}');
  } catch {
    return { records: [], offsetByKey: {} };
  }
}

function savePredictionLearning() {
  try {
    localStorage.setItem("marketlens-prediction-learning", JSON.stringify(state.predictionLearning));
  } catch {
    // Learning persistence is optional.
  }
}

function predictionLearningKey(ip, special = null) {
  const text = [special?.title, special?.targetPrizes, special?.marketForecast, special?.pastMarketBasis].filter(Boolean).join(" ");
  const sizeBucket = /大型|SOFVICS|BUSTISAN|胸像|送料750/i.test(text) ? "large" : "standard";
  const categoryBucket = /ぬいぐるみ|マスコット|雑貨|キッチン/i.test(text)
    ? "goods"
    : /フィギュア|MASTERLISE|EXPIECE|SOFVICS|BUSTISAN|胸像/i.test(text)
      ? "figure"
      : "mixed";
  return `${ip}::${sizeBucket}::${categoryBucket}`;
}

function applyPredictionLearning(ip, baseMedian, special = null) {
  const key = predictionLearningKey(ip, special);
  const offset = Number(state.predictionLearning?.offsetByKey?.[key] ?? 0);
  return Math.max(500, Math.round(baseMedian + offset));
}

function predictionLearningSummary(ip, special = null) {
  const key = predictionLearningKey(ip, special);
  const records = Array.isArray(state.predictionLearning?.records) ? state.predictionLearning.records : [];
  const scoped = records.filter((item) => item.keyGroup === key);
  const offset = Number(state.predictionLearning?.offsetByKey?.[key] ?? 0);
  return {
    samples: scoped.length,
    offset,
    key,
  };
}

function overallPredictionMetrics() {
  const records = Array.isArray(state.predictionLearning?.records) ? state.predictionLearning.records : [];
  if (records.length === 0) return { count: 0, mae: null, mape: null };
  const mae = records.reduce((sum, item) => sum + Math.abs(item.error ?? 0), 0) / records.length;
  const mapeBase = records.filter((item) => Number.isFinite(item.predictedMedian) && item.predictedMedian > 0);
  const mape =
    mapeBase.length > 0
      ? (mapeBase.reduce((sum, item) => sum + Math.abs((item.error ?? 0) / item.predictedMedian), 0) / mapeBase.length) * 100
      : null;
  return { count: records.length, mae, mape };
}

function recordPredictionResult(special, predictedMedian, actualMarketPrice) {
  if (!special?.id || !Number.isFinite(predictedMedian) || !Number.isFinite(actualMarketPrice)) return;
  const keyGroup = predictionLearningKey(special.ip ?? "unknown", special);
  const key = `${special.id}:${special.releaseDate ?? "na"}:${actualMarketPrice}:${keyGroup}`;
  const records = Array.isArray(state.predictionLearning.records) ? state.predictionLearning.records : [];
  if (records.some((item) => item.key === key)) return;
  const error = actualMarketPrice - predictedMedian;
  records.push({
    key,
    keyGroup,
    id: special.id,
    ip: special.ip ?? "unknown",
    predictedMedian,
    actualMarketPrice,
    error,
    recordedAt: new Date().toISOString(),
  });
  const byKey = records.filter((item) => item.keyGroup === keyGroup).slice(-12);
  const avgError = byKey.length > 0 ? byKey.reduce((sum, item) => sum + item.error, 0) / byKey.length : 0;
  state.predictionLearning = {
    records: records.slice(-200),
    offsetByKey: {
      ...(state.predictionLearning?.offsetByKey ?? {}),
      [keyGroup]: Math.round(avgError),
    },
  };
  savePredictionLearning();
}

function routeApplyKey(release, route) {
  return [
    release.id,
    release.name,
    route.name,
    route.round ?? "",
    route.deadlineLabel,
    route.deadlineDate ?? "rolling",
  ].join("|");
}

function dealActionKey(deal, type) {
  return [type, deal.name, deal.shop, deal.sourceUrl ?? ""].join("|");
}

function dealDetailTargetId(deal) {
  return `deal:${deal.id ?? dealActionKey(deal, "deal")}`;
}

function releaseDetailTargetId(release) {
  return `release:${release.id ?? release.name}`;
}

function hasDetailTarget(detailTargetId) {
  if (!detailTargetId) return false;
  return Boolean(document.querySelector(`[data-detail-id="${detailTargetId.replace(/"/g, '\\"')}"]`));
}

function dealShopLabel(deal) {
  const marketCheck = /メルカリ|Yahoo!フリマ|PayPay|ラクマ|駿河屋/i.test(deal.shop);
  return `${marketCheck ? "相場確認先" : "販売元/確認先"}: ${deal.shop}`;
}

function dealReleaseSourceName(deal) {
  const url = deal.releaseUrl ?? deal.sourceUrl ?? "";
  try {
    const host = new URL(url).hostname;
    if (host.includes("p-bandai.jp")) return "プレミアムバンダイ";
    if (host.includes("square-enix.com")) return "スクエニ e-STORE";
    if (host.includes("pokemoncenter-online.com")) return "ポケモンセンターオンライン";
    if (host.includes("amazon.co.jp")) return "Amazon";
    return host.replace(/^www\./, "");
  } catch {
    return "未設定";
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const label = state.theme === "dark" ? "ライトモード" : "ダークモード";
  elements.themeToggle.title = label;
  elements.themeToggle.setAttribute("aria-label", label);
}

function getFilteredDeals() {
  return state.deals
    .filter((deal) => {
      const matchesFilter = state.filter === "all" || dealFilterState(deal).kind === state.filter;
      const haystack = [
        deal.name,
        deal.shop,
        sourceLabels[deal.sourceType] ?? "",
        deal.deadline ?? "",
        deal.tags.join(" "),
        shippingRules[deal.category].label,
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = haystack.includes(state.query.trim().toLowerCase());
      return matchesFilter && matchesQuery;
    })
    .sort((a, b) => {
      const profitA = calculateDeal(a).profit;
      const profitB = calculateDeal(b).profit;
      const buyLineA = calculateDeal(a).buyLine;
      const buyLineB = calculateDeal(b).buyLine;
      const deadlineA = a.saleEndDate ? new Date(`${a.saleEndDate}T23:59:59+09:00`).getTime() : Number.MAX_SAFE_INTEGER;
      const deadlineB = b.saleEndDate ? new Date(`${b.saleEndDate}T23:59:59+09:00`).getTime() : Number.MAX_SAFE_INTEGER;
      const stateRankA = dealStateRank(a);
      const stateRankB = dealStateRank(b);

      if (state.sortMode === "profit_asc") return profitA - profitB;
      if (state.sortMode === "buyline_desc") return buyLineB - buyLineA;
      if (state.sortMode === "deadline_asc") return stateRankA - stateRankB || deadlineA - deadlineB || profitB - profitA;
      return profitB - profitA;
    });
}

function dealAvailability(deal) {
  const hasStarted = isDateStarted(`${deal.saleStartDate ?? "2000-01-01"}T00:00:00+09:00`);
  const hasEnded = deal.saleEndDate ? !isDateActive(`${deal.saleEndDate}T23:59:59+09:00`) : false;

  if (!hasStarted) return { label: "予定", kind: "upcoming" };
  if (hasEnded) return { label: "終了", kind: "ended" };
  return { label: "販売中", kind: "active" };
}

function dealPriceSignal(deal, calc) {
  if (deal.priceSignal === "recheck") return { label: "要再確認", kind: "recheck" };
  if (calc.profit < state.settings.targetProfit) return { label: "要再確認", kind: "recheck" };
  return { label: "価格差あり", kind: "gap" };
}

function dealRecheckReason(deal, calc = calculateDeal(deal)) {
  if (deal.priceSignal === "recheck") return "手動で再確認フラグ";
  if (calc.profit < state.settings.targetProfit) {
    return `想定利益が目標 ${yen.format(state.settings.targetProfit)} を下回る`;
  }
  return "価格・状態の再確認";
}

function dealFilterState(deal) {
  const calc = calculateDeal(deal);
  const availability = dealAvailability(deal);
  if (availability.kind === "upcoming") return availability;
  const priceSignal = dealPriceSignal(deal, calc);
  if (priceSignal.kind === "recheck") return priceSignal;
  return availability;
}

function dealStateRank(deal) {
  const stateKind = dealFilterState(deal).kind;
  if (stateKind === "active") return 0;
  if (stateKind === "recheck") return 1;
  if (stateKind === "upcoming") return 2;
  return 3;
}

function isActionableDeal(deal, calc = calculateDeal(deal)) {
  return dealAvailability(deal).kind === "active" && dealPriceSignal(deal, calc).kind === "gap";
}

function countActiveLotteryRoutes() {
  return pokemonReleases.reduce((count, release) => {
    if (releaseWatchState(release).kind !== "active") return count;
    return (
      count +
      releaseRoutes(release).filter((route) => {
        if (!shouldDisplayRoute(route)) return false;
        const kind = routePeriod(route).kind;
        return kind === "active";
      }).length
    );
  }, 0);
}

function releaseRoutes(release) {
  const routes = Array.isArray(release.routes) ? [...release.routes] : [];
  const hasNyukaNow = routes.some((route) => String(route.url ?? "").includes("nyuka-now.com"));
  if (!hasNyukaNow) {
    routes.push({
      scope: "online",
      name: "入荷Now（参照元）",
      round: "情報取得",
      startDate: `${release.saleStartDate ?? release.releaseDate ?? new Date().toISOString().slice(0, 10)}T00:00:00+09:00`,
      deadlineLabel: "受付状況を自動巡回",
      deadlineDate: null,
      priority: "medium",
      url: nyukaNowPokemonUrl,
      verification: {
        status: "review",
        label: "自動確認中",
        summary: "入荷Nowを巡回",
        issues: [],
      },
    });
  }
  return routes;
}

function routeScopeLabel(route) {
  if (String(route.url ?? "").includes("nyuka-now.com") || String(route.name ?? "").includes("入荷Now")) {
    return "参照元";
  }
  return route.scope === "online" ? "ネット" : "大阪";
}

function isNyukaNowRoute(route) {
  const fromNyuka = String(route.url ?? "").includes("nyuka-now.com") || String(route.name ?? "").includes("入荷Now");
  return fromNyuka && !route.applyUrl;
}

function routeTargetUrl(route, release = null) {
  return route.applyUrl || route.url || release?.sourceUrl || "";
}

function routeEffectiveDeadline(route, release = null) {
  return route.deadlineDate || (release?.saleEndDate ? `${release.saleEndDate}T23:59:59+09:00` : null);
}

function displayRouteName(route) {
  const raw = String(route?.name ?? "").trim();
  if (!raw) return "応募ルート";
  const cleaned = raw
    .replace(/^入荷Now[ 　]*/i, "")
    .replace(/^入荷NOW[ 　]*/i, "")
    .replace(/^にゅうかNOW[ 　]*/i, "")
    .replace(/[（(]?(?:参照元|確認先)[）)]?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "応募ルート";
}

function routeApplicationMethod(route) {
  const routeText = [route?.name, route?.round, route?.deadlineLabel, route?.applyHint].filter(Boolean).join(" ");
  const applyUrl = String(route?.applyUrl ?? route?.url ?? "");

  if (/店頭抽選|店舗抽選|イエローサブマリン各店/i.test(routeText)) {
    return "応募方法 店頭ポスター / 店舗X告知";
  }
  if (/アプリ抽選/i.test(routeText)) {
    return "応募方法 アプリから応募";
  }
  if (/先着|予約/i.test(routeText)) {
    return "応募方法 先着 / 予約ページ";
  }
  if (/抽選販売|web抽選|web応募|lottery|membercard/i.test(routeText) || /membercard|lottery|apply|entry/i.test(applyUrl)) {
    return "応募方法 WEB応募";
  }
  if (/nyuka-now\.com/i.test(applyUrl)) {
    return "応募方法 参照元から確認";
  }
  return "応募方法 リンク先確認";
}

function displayTrendKeyword(keyword) {
  return String(keyword ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(?:えみのせどり部屋|3度の飯よりプレミアム|しなかん|転売ヤーかなえ)\s*/u, "")
    .replace(/^品薄完売ブログ[ 　]*/u, "")
    .replace(/^品薄・完売ブログ[ 　]*/u, "")
    .replace(/監視$/u, "")
    .trim();
}

const trendMinLeadHours = 24;
const trendImmediateWindowDays = 7;
const trendFocusWindowMinDays = 8;
const trendFocusWindowMaxDays = 30;
const trendEarlyWindowMinDays = 31;
const trendFutureWindowDays = 180;

function trendStartMs(trend) {
  if (!trend?.startDate) return null;
  const ts = new Date(`${trend.startDate}T00:00:00+09:00`).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function trendEndMs(trend) {
  if (!trend?.endDate) return null;
  const ts = new Date(`${trend.endDate}T23:59:59+09:00`).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function trendStartTimestamp(trend) {
  const ts = trendStartMs(trend);
  if (!ts || ts <= Date.now()) return null;
  return ts;
}

function trendHasMomentum(trend) {
  return (trend.score ?? 0) >= 78 || (trend.historyRecentHits ?? 0) >= 4 || (trend.historyHits ?? 0) >= 10;
}

function trendDisplayPhase(trend) {
  const startTs = trendStartMs(trend);
  const endTs = trendEndMs(trend);
  const now = Date.now();

  if (endTs && endTs < now) return null;
  if (!trendHasMomentum(trend)) return null;

  if (startTs && startTs > now) {
    const leadHours = (startTs - now) / 3_600_000;
    const leadDays = (startTs - now) / 86_400_000;
    if (leadDays < trendEarlyWindowMinDays) {
      if (leadDays >= trendFocusWindowMinDays) return "focus";
      if (leadDays >= 0) return "immediate";
      return null;
    }
    if (leadHours < trendMinLeadHours && (trend.score ?? 0) < 88 && (trend.historyRecentHits ?? 0) < 6) return null;
    if (leadDays > trendFutureWindowDays) return null;
    return "early";
  }

  if (startTs && startTs <= now) return null;

  return "watch";
}

function shouldDisplayTrend(trend) {
  if (isKujiTrend(trend)) return false;
  const title = displayTrendKeyword(trend.keyword).toLowerCase();
  if (!title) return false;
  const genericTitles = new Set(["品薄", "品薄完売", "プレ値sns", "プレ値"]);
  if (genericTitles.has(title)) return false;
  return Boolean(trendDisplayPhase(trend));
}

function trendPhaseLabel(trend) {
  const phase = trendDisplayPhase(trend);
  if (phase === "early") return "先行";
  if (phase === "focus") return "重点";
  if (phase === "immediate") return "直前";
  return "監視";
}

function isEarlySignalTrend(trend) {
  if (isKujiTrend(trend)) return false;
  const title = displayTrendKeyword(trend.keyword).toLowerCase();
  if (!title) return false;
  const genericTitles = new Set(["品薄", "品薄完売", "プレ値sns", "プレ値"]);
  if (genericTitles.has(title)) return false;
  if (!trendHasMomentum(trend)) return false;
  const startTs = trendStartMs(trend);
  const endTs = trendEndMs(trend);
  const now = Date.now();
  if (endTs && endTs < now) return false;
  if (!startTs) return false;
  const deltaDays = (startTs - now) / 86_400_000;
  return deltaDays <= trendFocusWindowMaxDays && deltaDays >= -trendImmediateWindowDays;
}

function shouldDisplayRoute(route) {
  return Boolean(route);
}

function isConcreteCandidate(candidate) {
  const name = String(candidate?.name ?? "");
  return !/(品薄|完売).*(ウォッチ|監視)|監視$|ウォッチ$/i.test(name);
}

function splitMissingParts(value) {
  return String(value ?? "")
    .split(/[、,／/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function candidateMissingReasons(candidate) {
  const reasons = new Set();
  for (const part of splitMissingParts(candidate.missingData)) {
    if (/定価|価格データ|価格/i.test(part)) reasons.add("公式価格");
    if (/成約|相場/i.test(part)) reasons.add("相場価格");
    if (/取引量|出来高/i.test(part)) reasons.add("成約件数");
    if (/送料|厚み|サイズ/i.test(part)) reasons.add("送料サイズ");
    if (/在庫|残数/i.test(part)) reasons.add("在庫状況");
    if (/ノベルティ/i.test(part)) reasons.add("特典残数");
    if (/販売期間|応募期限|発売日/i.test(part)) reasons.add("期間情報");
    if (/具体SKU|具体柄|モデル別|商品名|仕様/i.test(part)) reasons.add("商品仕様");
    if (/公式ページ確認|発売元|公式ページ/i.test(part)) reasons.add("公式導線");
  }
  if (reasons.size === 0 && candidate.sourceUrl) reasons.add("相場価格");
  return [...reasons];
}

function candidateResearchTargets(candidate) {
  const targets = [];
  const sourceName = dealReleaseSourceName({ sourceUrl: candidate.sourceUrl });
  if (!candidate.retailPrice && sourceName && sourceName !== "未設定") targets.push(`公式 ${sourceName}`);

  const text = [candidate.name, candidate.trend, candidate.reason].join(" ");
  if (/ポケモン|ポケカ/i.test(text)) {
    targets.push("スニダン相場", "メルカリ相場");
  } else if (/時計|watch|g-shock|garrack/i.test(text)) {
    targets.push("メルカリ相場", "楽天/公式在庫");
  } else if (/ドラゴンクエスト|ドラクエ/i.test(text)) {
    targets.push("スクエニ公式ニュース", "コラボ告知", "メルカリ相場", "スクエニ在庫");
  } else if (/ワンピース|フィギュア|s\\.h\\.figuarts/i.test(text)) {
    targets.push("メルカリ相場", "公式販売ページ");
  } else {
    targets.push("メルカリ相場");
  }
  return [...new Set(targets)];
}

function calculateCandidateMarketProfit(candidate) {
  if (!Number.isFinite(candidate?.retailPrice) || !Number.isFinite(candidate?.marketPrice)) return null;
  const sellPrice = candidate.marketPrice;
  const fee = Math.round(sellPrice * (state.settings.feeRate / 100));
  const buffer = Math.round(sellPrice * (state.settings.priceBuffer / 100));
  const shipping = shippingRules[candidate.category]?.shipping ?? shippingRules.unknown.shipping;
  const packing = state.settings.packingCost;
  const netSale = sellPrice - fee;
  const profit = netSale - candidate.retailPrice - shipping - packing - buffer;
  const buyLine = netSale - shipping - packing - buffer - state.settings.targetProfit;
  return { fee, shipping, buffer, packing, netSale, profit, buyLine };
}

function candidatePromotionReason(candidate, profitSummary) {
  const reasons = ["具体商品"];
  if (profitSummary.known) reasons.push("利益計算済み");
  if (candidate.startDate && !isDateStarted(`${candidate.startDate}T00:00:00+09:00`)) {
    reasons.push("開始前");
  } else {
    reasons.push("期間中");
  }
  if (candidate.confidence === "高") reasons.push("高信頼");
  if ((candidate.historyRecentHits ?? 0) >= 4) reasons.push(`履歴 ${candidate.historyRecentHits}回`);
  return reasons.join(" / ");
}

function shouldPromoteCandidateToToday(candidate) {
  if (candidate.stageKind !== "candidate") return false;
  if (!candidate.sourceUrl) return false;
  if (isKujiCandidate(candidate)) return false;
  if (candidate.endDate && !isDateActive(`${candidate.endDate}T23:59:59+09:00`)) return false;
  if (!isConcreteCandidate(candidate)) return false;
  const candidateName = normalizeSignalText(candidate.name);
  const genericNames = new Set(["品薄", "品薄完売", "プレ値", "プレ値sns"]);
  if (genericNames.has(candidateName)) return false;
  const profitSummary = candidateProfitSummary(candidate);
  if (profitSummary.known) {
    return true;
  }
  const periodKind = candidateActionPeriodKind(candidate);
  const score = candidate.genreScore ?? 0;
  const recentHits = candidate.historyRecentHits ?? 0;
  if (candidate.confidence === "高" && periodKind === "active") {
    return score >= 76 || recentHits >= 4;
  }
  if (candidate.confidence === "高" && candidate.startDate) {
    const startTs = new Date(`${candidate.startDate}T00:00:00+09:00`).getTime();
    if (Number.isFinite(startTs) && startTs - Date.now() < 14 * 86_400_000) {
      return score >= 78 || recentHits >= 4;
    }
  }
  return candidate.confidence === "中" && (score >= 90 || recentHits >= 6);
}

function candidateActionPriority(candidate) {
  if ((candidate.genreScore ?? 0) >= 90 || (candidate.historyRecentHits ?? 0) >= 4) return "高";
  return "中";
}

function candidateActionPeriodKind(candidate) {
  const started = !candidate.startDate || isDateStarted(`${candidate.startDate}T00:00:00+09:00`);
  const ended = candidate.endDate ? !isDateActive(`${candidate.endDate}T23:59:59+09:00`) : false;
  if (ended) return "ended";
  return started ? "active" : "upcoming";
}

function candidateValidationState(candidate) {
  const periodKnown = Boolean(candidate.startDate && candidate.endDate);
  const periodActive = candidate.endDate ? isDateActive(`${candidate.endDate}T23:59:59+09:00`) : true;
  const hasPrice = Number.isFinite(candidate?.retailPrice) && Number.isFinite(candidate?.marketPrice);
  const hasRoute = Boolean(candidate.sourceUrl);
  if (!periodKnown) return "missing_period";
  if (!periodActive) return "ended";
  if (!hasPrice) return "missing_price";
  if (marketFreshnessLabel(candidate.marketObservedAt) === "要更新") return "stale_price";
  if (!hasRoute) return "missing_route";
  return "ready";
}

function marketFreshnessLabel(observedAt) {
  if (!observedAt) return "未取得";
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) return "未取得";
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays <= 1) return "新しい";
  if (ageDays <= 3) return "通常";
  return "要更新";
}

function itemPeriodRank(item) {
  if (item.periodKind === "active") return 0;
  if (item.periodKind === "upcoming") return 1;
  return 2;
}

function buildActionItems() {
  const lotteryItems = [];

  for (const release of pokemonReleases) {
    if (releaseWatchState(release).kind !== "active") continue;

    const routeActions = [];

    for (const route of releaseRoutes(release)) {
      if (!shouldDisplayRoute(route)) continue;
      const routeStatus = routePeriod(route);
      const applyKey = routeApplyKey(release, route);
      if (routeStatus.kind === "ended") continue;
      const routeDeadline = routeEffectiveDeadline(route, release);
      const isDone = Boolean(state.appliedRoutes[applyKey]);
      const verification = routeVerification(route);

      routeActions.push({
        key: applyKey,
        name: displayRouteName(route),
        scope: routeScopeLabel(route),
        round: route.round ?? "通常",
        startDate: route.startDate ?? null,
        deadlineDate: routeDeadline,
        applicationMethod: routeApplicationMethod(route),
        statusKind: routeStatus.kind,
        statusLabel: routeStatus.label,
        deadlineLabel: route.deadlineLabel,
        deadline: deadlineText(route.deadlineDate, route.deadlineDate ? "期限確認" : "随時確認"),
        deadlineSort: routeDeadline ? new Date(routeDeadline).getTime() : Number.MAX_SAFE_INTEGER,
        priority: priorityFromRoute(route, routeStatus),
        confidence: route.priority === "high" ? "高" : "中",
        done: isDone,
        checkLabel: routeCheckLabel(route, routeStatus),
        verification,
        passiveReference: isNyukaNowRoute(route),
        url: routeTargetUrl(route, release),
        hasApplyUrl: Boolean(route.applyUrl),
      });
    }

    if (routeActions.length > 0) {
      const priorityWeight = { 高: 0, 中: 1, 低: 2 };
      const confidenceWeight = { 高: 0, 中: 1, 低: 2 };
      const mainRoutes = routeActions.filter((route) => !route.passiveReference);
      const routesForDisplay = mainRoutes.length > 0 ? mainRoutes : routeActions;
      const sortedRoutes = [...routesForDisplay].sort(
        (a, b) =>
          Number(a.done) - Number(b.done) ||
          (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9) ||
          a.deadlineSort - b.deadlineSort,
      );
      const activeRoutes = sortedRoutes.filter((route) => route.statusKind === "active");
      const doneCount = sortedRoutes.filter((route) => route.done).length;
      const verifiedCount = sortedRoutes.filter((route) => !route.passiveReference && route.verification.kind === "verified").length;
      const verifiableCount = sortedRoutes.filter((route) => !route.passiveReference).length;
      const bestRoute = sortedRoutes[0];
      const calc = calculateRelease(release);
      const scopes = [...new Set(sortedRoutes.map((route) => route.scope))].join(" / ");

      lotteryItems.push({
      kind: activeRoutes.length > 0 ? "lottery" : "upcoming",
      originLabel: "抽選ルート",
        label: activeRoutes.length > 0 ? `応募 ${activeRoutes.length}` : "抽選前",
        checkLabel: doneCount === sortedRoutes.length ? "全て応募済み" : "まとめて応募済み",
        actionKey: release.id,
        actionType: "lotteryGroup",
        detailTargetId: releaseDetailTargetId(release),
        periodKind: activeRoutes.length > 0 ? "active" : "upcoming",
        startSort: bestRoute.startDate ? new Date(bestRoute.startDate).getTime() : Number.MAX_SAFE_INTEGER,
        routeKeys: sortedRoutes.map((route) => route.key),
        done: doneCount === sortedRoutes.length,
        priority: sortedRoutes.reduce(
          (best, route) => ((priorityWeight[route.priority] ?? 9) < (priorityWeight[best] ?? 9) ? route.priority : best),
          "低",
        ),
        confidence: sortedRoutes.reduce(
          (best, route) =>
            (confidenceWeight[route.confidence] ?? 9) < (confidenceWeight[best] ?? 9) ? route.confidence : best,
          "低",
        ),
        evidence: `${sortedRoutes.length}ルート検出 / ${scopes} / 応募欄確認OK ${verifiedCount}/${verifiableCount || 0}`,
        deadline: bestRoute.deadline,
        why:
          activeRoutes.length > 0
            ? `応募/再販ルートが${activeRoutes.length}件動いているため`
            : "抽選開始前の仕込み枠",
        title: release.name,
        meta: `${release.product} / ${sortedRoutes.length}ルート / 参照元 ${dealReleaseSourceName({ sourceUrl: release.sourceUrl })}`,
        body: `${doneCount}/${sortedRoutes.length}ルート応募済み / ${getReleaseMarketLabel(release)} / ${
          release.conditionPolicy ?? "シュリンク有無を確認"
        }`,
        variantSummary: buildReleaseVariantSummary(release),
        value: getReleaseMarketPrice(release) ? `想定利益 ${signedYen(calc.profit)}` : "相場取得待ち",
        deadlineSort: bestRoute.deadlineSort,
        url: bestRoute.url ?? release.sourceUrl,
        routes: sortedRoutes,
        order: activeRoutes.length > 0 ? 0 : 2,
      });
    }
  }

  const dealItems = state.deals.map((deal) => {
    const calc = calculateDeal(deal);
    const availability = dealAvailability(deal);
    const priceSignal = dealPriceSignal(deal, calc);
    return {
      deal,
      calc,
      availability,
      priceSignal,
    };
  });

  const profitItems = dealItems
    .filter(({ deal, calc }) => isActionableDeal(deal, calc))
    .map(({ deal, calc }) => ({
      kind: "profit",
      originLabel: "利益候補",
      label: "利益",
      checkLabel: "確認済み",
      actionKey: dealActionKey(deal, "profit"),
      actionType: "deal",
      detailTargetId: dealDetailTargetId(deal),
      periodKind: "active",
      startSort: deal.saleStartDate ? new Date(`${deal.saleStartDate}T00:00:00+09:00`).getTime() : 0,
      done: Boolean(state.actionDone[dealActionKey(deal, "profit")]),
      priority: priorityFromDeal(calc, "profit"),
      confidence: deal.confidence ?? "中",
      evidence: deal.evidence?.join(" / ") ?? "価格差あり",
      deadline: deadlineText(deal.saleEndDate ? `${deal.saleEndDate}T23:59:59+09:00` : null, "販売中"),
      deadlineSort: deal.saleEndDate ? new Date(`${deal.saleEndDate}T23:59:59+09:00`).getTime() : Number.MAX_SAFE_INTEGER,
      why: "販売中で目標利益を超えているため",
      title: deal.name,
      meta: `期間 ${formatDateOnly(deal.saleStartDate, "随時")}-${formatDateOnly(deal.saleEndDate, "継続")} / 参照元 ${dealReleaseSourceName(
        deal,
      )}`,
      body: `買える上限 ${yen.format(Math.max(0, calc.buyLine))} / 発売元 ${dealReleaseSourceName(deal)}`,
      value: `想定利益 ${signedYen(calc.profit)}`,
      url: deal.releaseUrl ?? deal.sourceUrl,
      linkText: "発売元",
      order: 1,
    }));

  const recheckItems = dealItems
    .filter(({ availability, priceSignal }) => availability.kind === "active" && priceSignal.kind === "recheck")
    .map(({ deal, calc }) => ({
      kind: "recheck",
      originLabel: "再確認",
      label: "再確認",
      checkLabel: "確認済み",
      actionKey: dealActionKey(deal, "recheck"),
      actionType: "deal",
      detailTargetId: dealDetailTargetId(deal),
      periodKind: "active",
      startSort: deal.saleStartDate ? new Date(`${deal.saleStartDate}T00:00:00+09:00`).getTime() : 0,
      done: Boolean(state.actionDone[dealActionKey(deal, "recheck")]),
      priority: priorityFromDeal(calc, "recheck"),
      confidence: deal.confidence ?? "中",
      evidence: `${dealRecheckReason(deal, calc)} / ${(deal.evidence ?? []).join(" / ") || "再確認"}`,
      deadline: deadlineText(deal.saleEndDate ? `${deal.saleEndDate}T23:59:59+09:00` : null, "販売中"),
      deadlineSort: deal.saleEndDate ? new Date(`${deal.saleEndDate}T23:59:59+09:00`).getTime() : Number.MAX_SAFE_INTEGER,
      why: "利益の取りこぼしを防ぐため、再確認理由を潰してから判断",
      title: deal.name,
      meta: `期間 ${formatDateOnly(deal.saleStartDate, "随時")}-${formatDateOnly(deal.saleEndDate, "継続")} / 参照元 ${dealReleaseSourceName(
        deal,
      )}`,
      body: `${dealRecheckReason(deal, calc)} / 発売元 ${dealReleaseSourceName(deal)}`,
      value: `想定利益 ${signedYen(calc.profit)}`,
      url: deal.releaseUrl ?? deal.sourceUrl,
      linkText: "発売元",
      order: 3,
    }));

  const byUrgency =
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      itemPeriodRank(a) - itemPeriodRank(b) ||
      a.deadlineSort - b.deadlineSort ||
      a.startSort - b.startSort ||
      a.order - b.order;
  const pickVisibleActions = (items, limit) => {
    const sorted = [...items].sort(byUrgency);
    const doneItem = sorted.find((item) => item.done);
    if (doneItem && sorted.length >= limit) {
      return [...sorted.filter((item) => !item.done).slice(0, limit - 1), doneItem];
    }
    return sorted.slice(0, limit);
  };

  const topLotteryItems = pickVisibleActions(lotteryItems, 3);
  const topProfitItems = pickVisibleActions(profitItems, 3);
  const topRecheckItems = pickVisibleActions(recheckItems, 1);

  return [...topLotteryItems, ...topProfitItems, ...topRecheckItems]
    .filter((item) => hasDetailTarget(item.detailTargetId))
    .sort(byUrgency)
    .slice(0, 10);
}

function buildTodayEmptyReasons() {
  const now = Date.now();
  const activeDeals = state.deals.filter((deal) => {
    if (!deal.saleEndDate) return true;
    const ts = new Date(`${deal.saleEndDate}T23:59:59+09:00`).getTime();
    return !Number.isNaN(ts) && ts >= now;
  });
  const actionableDeals = activeDeals.filter((deal) => isActionableDeal(deal, calculateDeal(deal)));
  const belowProfit = activeDeals.filter((deal) => {
    const calc = calculateDeal(deal);
    return dealPriceSignal(deal, calc).kind !== "gap";
  }).length;
  const lowConfidence = activeDeals.filter((deal) => (deal.confidence ?? "中") === "低").length;
  const activeRoutes = pokemonReleases
    .flatMap((release) => releaseRoutes(release))
    .filter((route) => routePeriod(route).kind !== "ended").length;
  const staleMarket = discoveryCandidates.filter((candidate) => candidateValidationState(candidate) === "stale_price").length;
  const detailLinkedDeals = activeDeals.filter((deal) => hasDetailTarget(dealDetailTargetId(deal))).length;
  const visibleReleases = pokemonReleases.filter((release) => releaseWatchState(release).kind === "active");
  const detailLinkedReleases = visibleReleases.filter((release) => hasDetailTarget(releaseDetailTargetId(release))).length;
  return [
    `利益候補 対象 ${actionableDeals.length}/${activeDeals.length}`,
    `利益未達 ${belowProfit}`,
    `信頼度低 ${lowConfidence}`,
    `相場要更新 ${staleMarket}`,
    `抽選ルート 対象 ${activeRoutes}`,
    `詳細紐付け 利益 ${detailLinkedDeals}/${activeDeals.length} / 抽選 ${detailLinkedReleases}/${visibleReleases.length}`,
    `急上昇由来は今日見るものへ直接昇格しないルール`,
  ];
}

function buildHiddenActionReasonLines(visibleItems) {
  const visibleKeys = new Set((visibleItems ?? []).map((item) => item.actionKey));
  const lines = [];

  for (const deal of state.deals) {
    const calc = calculateDeal(deal);
    const active = dealAvailability(deal).kind === "active";
    if (!active) continue;
    const profitKey = dealActionKey(deal, "profit");
    const recheckKey = dealActionKey(deal, "recheck");
    if (visibleKeys.has(profitKey) || visibleKeys.has(recheckKey)) continue;

    const priceSignal = dealPriceSignal(deal, calc);
    let reason = "";
    if ((deal.confidence ?? "中") === "低") {
      reason = "信頼度低";
    } else if (priceSignal.kind !== "gap") {
      reason = `利益条件未達（${dealRecheckReason(deal, calc)}）`;
    } else {
      reason = "優先度外";
    }
    lines.push(`${deal.name}: ${reason}`);
  }

  for (const release of pokemonReleases) {
    if (releaseWatchState(release).kind !== "active") continue;
    const key = release.id;
    if (visibleKeys.has(key)) continue;
    const routes = getActiveRoutes(release);
    if (routes.length === 0) {
      lines.push(`${release.name}: 有効な抽選ルートなし`);
      continue;
    }
    lines.push(`${release.name}: 優先度外`);
  }

  return lines.slice(0, 6);
}

function renderActionItems() {
  elements.actionList.replaceChildren();
  const items = buildActionItems();
  const hiddenReasonLines = buildHiddenActionReasonLines(items);

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-box";
    empty.hidden = false;
    empty.textContent = `今日すぐ見るものはありません。${buildTodayEmptyReasons().join(" / ")}`;
    elements.actionList.append(empty);
    return;
  }

  const activeDeals = state.deals.filter((deal) => {
    if (!deal.saleEndDate) return true;
    const ts = new Date(`${deal.saleEndDate}T23:59:59+09:00`).getTime();
    return !Number.isNaN(ts) && ts >= Date.now();
  });
  const hiddenProfit = activeDeals.length - items.filter((item) => item.kind === "profit").length;
  const hiddenLottery =
    pokemonReleases.filter((release) => releaseWatchState(release).kind === "active").length -
    items.filter((item) => item.kind === "lottery" || item.kind === "upcoming").length;
  const status = document.createElement("div");
  status.className = "detail-box";
  status.hidden = false;
  status.textContent = `今日見る表示: 利益 ${items.filter((item) => item.kind === "profit").length} / 抽選 ${
    items.filter((item) => item.kind === "lottery" || item.kind === "upcoming").length
  } / 非表示 利益 ${Math.max(0, hiddenProfit)} / 抽選 ${Math.max(0, hiddenLottery)}`;
  elements.actionList.append(status);
  if (hiddenReasonLines.length > 0) {
    const reasonsBox = document.createElement("div");
    reasonsBox.className = "detail-box";
    reasonsBox.hidden = false;
    const title = document.createElement("strong");
    title.textContent = "非表示の主な理由";
    reasonsBox.append(title);
    for (const line of hiddenReasonLines) {
      const row = document.createElement("div");
      row.textContent = line;
      reasonsBox.append(row);
    }
    elements.actionList.append(reasonsBox);
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = `action-card ${item.kind}`;
    card.classList.toggle("done", item.done);

    const top = document.createElement("div");
    top.className = "action-top";
    const heading = document.createElement("div");
    const meta = document.createElement("p");
    meta.className = "route-source";
    meta.textContent = item.meta;
    const title = document.createElement("h3");
    title.textContent = item.title;
    const pill = document.createElement("span");
    pill.className = `status-pill ${
      item.kind === "recheck" ? "recheck" : item.kind === "upcoming" || item.kind === "signal" ? "upcoming" : "gap"
    }`;
    pill.textContent = item.label;
    heading.append(meta, title);
    top.append(heading, pill);

    const facts = document.createElement("div");
    facts.className = "action-facts";
    for (const [text, kind] of [
      [`由来 ${item.originLabel ?? "実行候補"}`, "deadline"],
      [`優先度 ${item.priority}`, item.priority === "高" ? "high" : item.priority === "中" ? "medium" : "low"],
      [`信頼度 ${item.confidence}`, item.confidence === "高" ? "high" : item.confidence === "中" ? "medium" : "low"],
      [item.deadline, "deadline"],
    ]) {
      const fact = document.createElement("span");
      fact.className = kind;
      fact.textContent = text;
      facts.append(fact);
    }

    const body = document.createElement("p");
    body.className = "route-note";
    body.textContent = item.body;

    const variantList = document.createElement("div");
    variantList.className = "action-condition-list";
    for (const variant of item.variantSummary ?? []) {
      const variantRow = document.createElement("div");
      variantRow.className = `action-condition-row ${variant.kind}`;
      const condition = document.createElement("strong");
      condition.textContent = variant.condition;
      const details = document.createElement("span");
      details.textContent = `${variant.marketText} / ${variant.profitText}`;
      variantRow.append(condition, details);
      variantList.append(variantRow);
    }

    const routeList = document.createElement("div");
    routeList.className = "action-route-list";
    for (const route of item.routes ?? []) {
      const routeRow = document.createElement("div");
      routeRow.className = "action-route-row";
      routeRow.classList.toggle("done", route.done);
      routeRow.classList.add(route.verification.kind);
      const routeText = document.createElement("div");
      routeText.className = "action-route-text";
      const routeMain = document.createElement("strong");
      routeMain.textContent = route.name;
      const routeMeta = document.createElement("span");
      const routePeriodText = `開始 ${formatDateTime(route.startDate, "日付未取得")} / 終了 ${formatDateTime(
        route.deadlineDate ?? routeEffectiveDeadline(route),
        "日付未取得",
      )}`;
      if (route.passiveReference) {
        routeMeta.textContent = `${route.scope} / ${route.applicationMethod} / ${routePeriodText} / ${route.deadlineLabel}`;
        routeText.append(routeMain, routeMeta);
        routeRow.append(routeText);
      } else {
        routeMeta.textContent = `${route.scope} / ${route.statusLabel} / ${route.applicationMethod} / ${routePeriodText} / ${route.deadlineLabel}`;
        const routeVerify = document.createElement("span");
        routeVerify.className = `action-route-verify ${route.verification.kind}`;
        routeVerify.textContent = `${route.verification.label} / ${route.verification.summary}${
          route.verification.issues.length > 0 ? ` / ${route.verification.issues.join("・")}` : ""
        }`;
        const routeCheck = document.createElement("label");
        routeCheck.className = "action-route-check";
        const routeCheckbox = document.createElement("input");
        routeCheckbox.type = "checkbox";
        routeCheckbox.checked = route.done;
        routeCheckbox.dataset.routeActionKey = route.key;
        const routeCheckText = document.createElement("span");
        routeCheckText.textContent = route.checkLabel;
        routeCheck.append(routeCheckbox, routeCheckText);
        routeText.append(routeMain, routeMeta, routeVerify);
        routeRow.append(routeCheck, routeText);
      }
      if (route.url) {
        const routeLink = document.createElement("a");
        routeLink.className = "action-route-link";
        routeLink.target = "_blank";
        routeLink.rel = "noreferrer";
        routeLink.textContent = route.hasApplyUrl || route.passiveReference ? "応募リンク" : "参照";
        if (setSafeLink(routeLink, route.url, `${route.name}を開く`)) {
          routeRow.append(routeLink);
        }
      }
      routeList.append(routeRow);
    }

    const why = document.createElement("p");
    why.className = "action-why";
    why.textContent = item.why;

    const evidence = document.createElement("p");
    evidence.className = "action-evidence";
    evidence.textContent = `根拠: ${item.evidence}`;

    const value = document.createElement("strong");
    value.className = "action-value";
    value.textContent = item.value;

    const footer = document.createElement("div");
    footer.className = "action-footer";

    const checkLabel = document.createElement("label");
    checkLabel.className = "action-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.dataset.actionKey = item.actionKey;
    checkbox.dataset.actionType = item.actionType;
    if (item.routeKeys) {
      checkbox.dataset.routeKeys = item.routeKeys.join("||");
    }
    const checkText = document.createElement("span");
    checkText.textContent = item.checkLabel;
    checkLabel.append(checkbox, checkText);
    footer.append(checkLabel);

    card.append(top, facts, body);
    if ((item.variantSummary ?? []).length > 0) {
      card.append(variantList);
    }
    if ((item.routes ?? []).length > 0) {
      card.append(routeList);
    }
    card.append(why, evidence, value);

    if (item.url) {
      const link = document.createElement("a");
      link.className = "route-link";
      link.target = "_blank";
      link.rel = "noreferrer";
      const text = document.createElement("span");
      text.textContent = item.linkText ?? "確認";
      link.append(text, createExternalIcon());
      if (setSafeLink(link, item.url, `${item.title}を確認`)) {
        footer.append(link);
      }
    }
    if (item.detailTargetId) {
      const jumpButton = document.createElement("button");
      jumpButton.type = "button";
      jumpButton.className = "ghost-button";
      jumpButton.textContent = "詳細へ";
      jumpButton.addEventListener("click", () => {
        const target = document.querySelector(`[data-detail-id="${item.detailTargetId.replace(/"/g, '\\"')}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("focus-highlight");
        setTimeout(() => target.classList.remove("focus-highlight"), 1200);
      });
      footer.append(jumpButton);
    }

    card.append(footer);
    elements.actionList.append(card);
  }
}

function buildProvisionalDeals() {
  const validationPriority = {
    missing_price: 0,
    stale_price: 1,
    missing_route: 2,
    missing_period: 3,
    ended: 9,
    ready: 9,
  };
  return discoveryCandidates
    .filter((candidate) => candidate.stageKind === "candidate")
    .filter((candidate) => !isKujiCandidate(candidate))
    .filter((candidate) => isConcreteCandidate(candidate))
    .filter((candidate) => candidate.confidence !== "低")
    .filter((candidate) => !candidate.endDate || isDateActive(`${candidate.endDate}T23:59:59+09:00`))
    .filter((candidate) => candidateValidationState(candidate) !== "ready")
    .filter((candidate) => !candidateProfitSummary(candidate).known)
    .sort((a, b) => {
      const stateDiff =
        (validationPriority[candidateValidationState(a)] ?? 9) - (validationPriority[candidateValidationState(b)] ?? 9);
      if (stateDiff !== 0) return stateDiff;
      const scoreDiff = (b.genreScore ?? 0) - (a.genreScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.startDate ?? "").localeCompare(b.startDate ?? "");
    });
}

function appendDealSection(container, titleText, captionText) {
  const section = document.createElement("section");
  section.className = "deal-section";
  const header = document.createElement("div");
  header.className = "deal-section-header";
  const title = document.createElement("h3");
  title.textContent = titleText;
  const caption = document.createElement("span");
  caption.textContent = captionText;
  header.append(title, caption);
  section.append(header);
  container.append(section);
  return section;
}

function renderDealCard(deal, container) {
  const calc = calculateDeal(deal);
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.dataset.detailId = dealDetailTargetId(deal);
  const availability = dealAvailability(deal);
  const priceSignal = dealPriceSignal(deal, calc);
  const filterState = dealFilterState(deal);

  const sourceLabel = sourceLabels[deal.sourceType] ?? "手動";
  const periodLabel = `期間 ${formatDateOnly(deal.saleStartDate, "随時")}-${formatDateOnly(deal.saleEndDate, "継続")}`;
  const deadline = deal.deadline ? ` / ${deal.deadline}` : "";
  node.querySelector(".shop-name").textContent = `${dealShopLabel(deal)} / ${sourceLabel} / ${periodLabel}${deadline}`;
  node.querySelector("h3").textContent = deal.name;

  const status = node.querySelector(".status-pill");
  status.textContent = filterState.label;
  status.classList.add(filterState.kind);

  const tags = node.querySelector(".tag-row");
  for (const tag of [availability.label, priceSignal.label, `信頼度 ${deal.confidence ?? "中"}`, ...deal.tags]) {
    const tagNode = document.createElement("span");
    tagNode.className = "tag";
    tagNode.textContent = tag;
    tags.append(tagNode);
  }

  node.querySelector(".buy-price").textContent = yen.format(deal.buyPrice);
  node.querySelector(".sell-price").textContent = yen.format(deal.sellPrice);

  const profit = node.querySelector(".profit");
  profit.textContent = signedYen(calc.profit);
  profit.classList.add(calc.profit >= 0 ? "positive" : "negative");

  node.querySelector(".buy-line").textContent = yen.format(Math.max(0, calc.buyLine));

  const rule = shippingRules[deal.category] ?? shippingRules.unknown;
  node.querySelector(".cost-line").textContent =
    `手数料 ${yen.format(calc.fee)} / 送料 ${yen.format(calc.shipping)} / 値下げ余地 ${yen.format(calc.buffer)} / ${rule.label}`;

  const dealLink = node.querySelector(".deal-link");
  if (deal.releaseUrl ?? deal.sourceUrl) {
    setSafeLink(dealLink, deal.releaseUrl ?? deal.sourceUrl, `${deal.name}の発売元を開く`);
  } else {
    dealLink.remove();
  }
  const marketLink = node.querySelector(".market-link");
  if (deal.marketUrl) {
    setSafeLink(marketLink, deal.marketUrl, `${deal.name}の相場を開く`);
  } else {
    marketLink.remove();
  }

  const detailBox = node.querySelector(".detail-box");
  setDetailLines(detailBox, [
    `回転: ${deal.velocity}`,
    `リスク: ${deal.risk}`,
    `純売上: ${yen.format(calc.netSale)}`,
    `利益率: ${calc.margin.toFixed(1)}%`,
    `販売元: ${dealReleaseSourceName(deal)}`,
    `販売状態: ${availability.label}`,
    `販売開始: ${formatDateOnly(deal.saleStartDate, "随時")}`,
    `販売終了: ${formatDateOnly(deal.saleEndDate, "継続")}`,
    `価格状態: ${priceSignal.label}`,
    priceSignal.kind === "recheck" ? `再確認理由: ${dealRecheckReason(deal, calc)}` : "",
    `信頼度: ${deal.confidence ?? "中"}`,
    `根拠: ${(deal.evidence ?? []).join(" / ") || "価格差と状態を確認"}`,
    deal.deadline ? `締切/状態: ${deal.deadline}` : "",
    `理由: ${deal.reason}`,
  ]);

  node.querySelector(".detail-toggle").addEventListener("click", () => {
    detailBox.hidden = !detailBox.hidden;
  });

  container.append(node);
}

function renderProvisionalCandidateCard(candidate, container) {
  const card = document.createElement("article");
  card.className = "deal-card provisional-card";
  card.dataset.detailId = `candidate:${candidate.name}`;

  const main = document.createElement("div");
  main.className = "deal-main";

  const titleRow = document.createElement("div");
  titleRow.className = "deal-title-row";
  const headingWrap = document.createElement("div");
  const source = document.createElement("p");
  source.className = "shop-name";
  source.textContent = `仮利益候補 / ${formatDateOnly(candidate.startDate, "開始日未取得")}-${formatDateOnly(candidate.endDate, "終了日未取得")}`;
  const title = document.createElement("h3");
  title.textContent = candidate.name;
  headingWrap.append(source, title);
  const status = document.createElement("span");
  status.className = "status-pill upcoming";
  status.textContent = candidateActionPeriodKind(candidate) === "active" ? "期間中" : "開始前";
  titleRow.append(headingWrap, status);

  const tags = document.createElement("div");
  tags.className = "tag-row";
  const validationState = candidateValidationState(candidate);
  const validationTagText =
    validationState === "missing_price"
      ? "価格不足"
      : validationState === "stale_price"
        ? "相場要更新"
        : validationState === "missing_route"
          ? "導線不足"
          : validationState === "missing_period"
            ? "期間不足"
            : "要確認";
  for (const tagText of [`信頼度 ${candidate.confidence}`, `関連度 ${candidate.genreScore}`, candidate.marginSignal]) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = tagText;
    tags.append(tag);
  }
  const validationTag = document.createElement("span");
  validationTag.className = "tag";
  validationTag.textContent = `検証 ${validationTagText}`;
  tags.append(validationTag);

  const note = document.createElement("p");
  note.className = "route-note";
  note.textContent = candidate.reason;
  main.append(titleRow, tags, note);

  const side = document.createElement("div");
  side.className = "detail-box";
  side.hidden = false;
  const profitSummary = candidateProfitSummary(candidate);
  const validationLabel =
    validationState === "missing_period"
      ? "期間不足"
      : validationState === "missing_price"
        ? "価格不足"
        : validationState === "missing_route"
          ? "導線不足"
          : validationState === "ended"
            ? "期間終了"
            : "準備完了";
  const lines = [
    `利益状態: ${profitSummary.value}`,
    candidate.retailPrice ? `公式価格: ${yen.format(candidate.retailPrice)}` : "",
    candidate.marketPrice ? `相場価格: ${yen.format(candidate.marketPrice)}` : "",
    candidate.marketPriceSource ? `相場ソース: ${candidate.marketPriceSource}` : "",
    candidate.marketObservedAt ? `相場取得: ${formatDateTime(candidate.marketObservedAt, "未取得")}` : "",
    `相場鮮度: ${marketFreshnessLabel(candidate.marketObservedAt)}`,
    `不足: ${candidateMissingReasons(candidate).join(" / ") || "数値再取得"}`,
    `取得先: ${candidateResearchTargets(candidate).join(" / ")}`,
    `検証状態: ${validationLabel}`,
  ];
  setDetailLines(side, lines);

  card.append(main, side);
  container.append(card);
}

function renderDeals() {
  const deals = getFilteredDeals();
  elements.dealList.replaceChildren();

  const activeProfitDeals = deals.filter((deal) => dealAvailability(deal).kind === "active" && dealPriceSignal(deal, calculateDeal(deal)).kind === "gap");
  const activeRecheckDeals = deals.filter((deal) => dealFilterState(deal).kind === "recheck");
  const upcomingDeals = deals.filter((deal) => dealAvailability(deal).kind === "upcoming");
  const provisionalDeals = buildProvisionalDeals().filter((candidate) => {
    if (state.filter === "active") return candidateActionPeriodKind(candidate) === "active";
    if (state.filter === "upcoming") return candidateActionPeriodKind(candidate) !== "active";
    if (state.filter === "recheck") return false;
    return true;
  });

  if (activeProfitDeals.length === 0 && activeRecheckDeals.length === 0 && upcomingDeals.length === 0 && provisionalDeals.length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-box";
    empty.hidden = false;
    empty.textContent = "表示できる候補がありません。";
    elements.dealList.append(empty);
    renderSummary(deals);
    return;
  }

  if (activeProfitDeals.length > 0) {
    const section = appendDealSection(elements.dealList, "販売中の利益確認", `${activeProfitDeals.length}件`);
    for (const deal of activeProfitDeals) {
      renderDealCard(deal, section);
    }
  }

  if (upcomingDeals.length > 0) {
    const section = appendDealSection(elements.dealList, "これからの利益候補", `${upcomingDeals.length}件`);
    for (const deal of upcomingDeals) {
      renderDealCard(deal, section);
    }
  }

  if (provisionalDeals.length > 0) {
    const section = appendDealSection(elements.dealList, "仮利益候補", `${provisionalDeals.length}件`);
    for (const candidate of provisionalDeals) {
      renderProvisionalCandidateCard(candidate, section);
    }
  }

  if (activeRecheckDeals.length > 0) {
    const section = appendDealSection(elements.dealList, "再確認待ち", `${activeRecheckDeals.length}件`);
    for (const deal of activeRecheckDeals) {
      renderDealCard(deal, section);
    }
  }

  renderSummary(deals);
}

function renderSummary(deals = getFilteredDeals()) {
  const actionableDeals = deals.filter((deal) => {
    const calc = calculateDeal(deal);
    return isActionableDeal(deal, calc);
  });
  const totals = actionableDeals.reduce(
    (acc, deal) => {
      const calc = calculateDeal(deal);
      acc.profit += calc.profit;
      acc.margin += calc.margin;
      return acc;
    },
    { profit: 0, margin: 0 },
  );

  elements.hotCount.textContent = `利益 ${actionableDeals.length} / 抽選 ${countActiveLotteryRoutes()}`;
  elements.totalProfit.textContent = yen.format(totals.profit);
  elements.avgMargin.textContent = actionableDeals.length ? `${(totals.margin / actionableDeals.length).toFixed(1)}%` : "0%";
  elements.trendCount.textContent = trends.filter(shouldDisplayTrend).length;
  elements.sidebarFee.textContent = state.settings.feeRate.toString();
}

function getActionableDeals(deals = state.deals) {
  return deals.filter((deal) => isActionableDeal(deal, calculateDeal(deal)));
}

function getDailyDigest() {
  const actionableDeals = getActionableDeals();
  const totalProfit = actionableDeals.reduce((sum, deal) => sum + calculateDeal(deal).profit, 0);
  const activeLotteryRoutes = countActiveLotteryRoutes();
  const topDeal = actionableDeals
    .map((deal) => ({ deal, profit: calculateDeal(deal).profit }))
    .sort((a, b) => b.profit - a.profit)[0];
  const topTrend = [...trends]
    .filter(shouldDisplayTrend)
    .sort((a, b) => b.score - a.score)[0];

  return {
    title: "MarketLens 朝8時ダイジェスト",
    body: `利益候補 ${actionableDeals.length}件 / 抽選ルート ${activeLotteryRoutes}件 / 想定利益 ${yen.format(totalProfit)}${
      topDeal ? ` / 注目 ${topDeal.deal.name}` : ""
    }${topTrend ? ` / 急上昇 ${topTrend.keyword}` : ""}`,
  };
}

function todayNotificationKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function updateNotificationStatus() {
  if (!elements.notificationStatus) return;
  if (!("Notification" in window)) {
    elements.notificationStatus.textContent = "このブラウザでは通知に対応していません";
    return;
  }
  if (Notification.permission === "granted" && state.notifications.enabled) {
    const sent = state.notifications.lastSentDate ? ` / 最終通知 ${state.notifications.lastSentDate}` : "";
    elements.notificationStatus.textContent = `通知ON / 毎朝8時にダイジェスト${sent}`;
    return;
  }
  if (Notification.permission === "denied") {
    elements.notificationStatus.textContent = "通知がブラウザ側でブロックされています";
    return;
  }
  elements.notificationStatus.textContent = "通知OFF / 許可すると朝8時にダイジェスト";
}

function showDigestNotification({ test = false } = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    updateNotificationStatus();
    return false;
  }
  const digest = getDailyDigest();
  const title = test ? "MarketLens テスト通知" : digest.title;
  new Notification(title, {
    body: digest.body,
    tag: test ? "marketlens-test" : "marketlens-daily-digest",
    renotify: true,
  });
  if (!test) {
    state.notifications.lastSentDate = todayNotificationKey();
    saveNotificationSettings();
  }
  updateNotificationStatus();
  return true;
}

function checkMorningNotification() {
  if (!state.notifications.enabled) return;
  const now = new Date();
  const today = todayNotificationKey();
  if (now.getHours() < 8 || state.notifications.lastSentDate === today) return;
  showDigestNotification();
}

async function enableBrowserNotifications() {
  if (!("Notification" in window)) {
    updateNotificationStatus();
    return;
  }
  const permission = await Notification.requestPermission();
  state.notifications.enabled = permission === "granted";
  saveNotificationSettings();
  updateNotificationStatus();
}

function renderTrends() {
  elements.trendList.replaceChildren();

  const visibleTrends = trends
    .filter(shouldDisplayTrend)
    .filter((trend) => !isOverlappingWithActionable(displayTrendKeyword(trend.keyword)))
    .sort((a, b) => (trendStartTimestamp(a) ?? Number.MAX_SAFE_INTEGER) - (trendStartTimestamp(b) ?? Number.MAX_SAFE_INTEGER));

  for (const trend of visibleTrends) {
    const node = document.createElement("article");
    node.className = "trend-item";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const action = document.createElement("small");
    const score = document.createElement("div");
    const scoreLabel = document.createElement("span");
    const scoreValue = document.createElement("strong");

    title.textContent = displayTrendKeyword(trend.keyword);
    meta.textContent = `フェーズ ${trendPhaseLabel(trend)} / 信頼度 ${trend.confidence} / ${trend.type} / 開始 ${formatDateOnly(
      trend.startDate,
      "開始日未取得",
    )} / 終了 ${formatDateOnly(trend.endDate, "終了日未取得")} / ${trend.context}`;
    action.textContent =
      trend.confidence === "低" ? "監視中: 他ソースと突合してから候補判定します" : trend.action;
    score.className = "trend-score";
    scoreLabel.textContent = "上昇度";
    scoreValue.textContent = trend.score;
    score.append(scoreLabel, scoreValue);

    content.append(title, meta, action);
    node.append(content, score);
    elements.trendList.append(node);
  }
}

function archiveReasonForCandidate(candidate) {
  const state = candidateValidationState(candidate);
  if (state === "ended") return "期間終了";
  if (state === "missing_period") return "期間不足";
  if (state === "missing_price") return "価格不足";
  if (state === "stale_price") return "相場鮮度不足";
  if (state === "missing_route") return "導線不足";
  if (candidate.confidence === "低") return "信頼度低";
  return "優先度外";
}

function archiveRecoveryHint(candidate) {
  const state = candidateValidationState(candidate);
  if (state === "ended") return "復帰なし（新規シグナル待ち）";
  if (state === "missing_period") return "開始日/終了日の取得で復帰";
  if (state === "missing_price") return "定価/相場の取得で復帰";
  if (state === "stale_price") return "相場の再取得で復帰";
  if (state === "missing_route") return "応募/販売導線の取得で復帰";
  if (candidate.confidence === "低") return "他ソース一致で復帰";
  return "条件再充足で復帰";
}

function renderArchivedCandidates() {
  if (!elements.archiveCandidateList) return;
  elements.archiveCandidateList.replaceChildren();

  const recoveryPriority = {
    missing_price: 0,
    stale_price: 1,
    missing_route: 2,
    missing_period: 3,
    ended: 9,
  };
  const archived = discoveryCandidates
    .filter((candidate) => {
      const validationState = candidateValidationState(candidate);
      return (
        validationState === "ended" ||
        validationState === "missing_period" ||
        validationState === "missing_price" ||
        validationState === "stale_price" ||
        validationState === "missing_route" ||
        candidate.confidence === "低"
      );
    })
    .sort((a, b) => {
      const p = (recoveryPriority[candidateValidationState(a)] ?? 9) - (recoveryPriority[candidateValidationState(b)] ?? 9);
      if (p !== 0) return p;
      return (b.historyRecentHits ?? 0) - (a.historyRecentHits ?? 0);
    })
    .slice(0, 10);

  const summaryCounts = {
    ended: 0,
    missingPeriod: 0,
    missingPrice: 0,
    stalePrice: 0,
    missingRoute: 0,
    lowConfidence: 0,
  };
  for (const candidate of discoveryCandidates) {
    const state = candidateValidationState(candidate);
    if (state === "ended") summaryCounts.ended += 1;
    if (state === "missing_period") summaryCounts.missingPeriod += 1;
    if (state === "missing_price") summaryCounts.missingPrice += 1;
    if (state === "stale_price") summaryCounts.stalePrice += 1;
    if (state === "missing_route") summaryCounts.missingRoute += 1;
    if (candidate.confidence === "低") summaryCounts.lowConfidence += 1;
  }

  const summary = document.createElement("div");
  summary.className = "detail-box";
  summary.hidden = false;
  summary.textContent = `内訳: 期間終了 ${summaryCounts.ended} / 期間不足 ${summaryCounts.missingPeriod} / 価格不足 ${summaryCounts.missingPrice} / 相場鮮度不足 ${summaryCounts.stalePrice} / 導線不足 ${summaryCounts.missingRoute} / 信頼度低 ${summaryCounts.lowConfidence}`;
  elements.archiveCandidateList.append(summary);

  if (archived.length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-box";
    empty.hidden = false;
    empty.textContent = "外れた候補はありません。";
    elements.archiveCandidateList.append(empty);
    return;
  }

  for (const candidate of archived) {
    const node = document.createElement("article");
    node.className = "trend-item";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const action = document.createElement("small");
    const recovery = document.createElement("small");
    title.textContent = candidate.name;
    meta.textContent = `開始 ${formatDateOnly(candidate.startDate, "未取得")} / 終了 ${formatDateOnly(
      candidate.endDate,
      "未取得",
    )} / 信頼度 ${candidate.confidence}`;
    action.textContent = `除外理由: ${archiveReasonForCandidate(candidate)}`;
    recovery.textContent = `復帰条件: ${archiveRecoveryHint(candidate)}`;
    content.append(title, meta, action, recovery);
    node.append(content);
    elements.archiveCandidateList.append(node);
  }
}

function renderDiscoveryCandidates() {
  elements.earlySignalList.replaceChildren();
  const earlySignals = trends
    .filter(isEarlySignalTrend)
    .sort((a, b) => (trendStartMs(a) ?? Number.MAX_SAFE_INTEGER) - (trendStartMs(b) ?? Number.MAX_SAFE_INTEGER));
  if (earlySignals.length > 0) {
    const box = document.createElement("div");
    box.className = "detail-box";
    box.hidden = false;
    const heading = document.createElement("strong");
    heading.textContent = "開始直後シグナル（急上昇には未掲載）";
    box.append(heading);
    for (const trend of earlySignals.slice(0, 8)) {
      const line = document.createElement("p");
      line.textContent = `${displayTrendKeyword(trend.keyword)} / 開始 ${formatDateOnly(
        trend.startDate,
        "開始日未取得",
      )} / 終了 ${formatDateOnly(trend.endDate, "終了日未取得")}`;
      box.append(line);
    }
    elements.earlySignalList.append(box);
  }

  elements.discoveryList.replaceChildren();

  const visibleCandidates = discoveryCandidates.filter(isVisibleDiscoveryCandidate);
  const laneFilteredCandidates = visibleCandidates.filter((candidate) => !isOverlappingWithActionable(candidate.name));

  if (laneFilteredCandidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-box";
    empty.hidden = false;
    empty.textContent =
      "追加候補はありません。期間が始まっているものは今日見るもの・利益候補・専用枠へ移し、急上昇と同名のものはここに重複表示しません。";
    elements.discoveryList.append(empty);
    return;
  }

  for (const candidate of laneFilteredCandidates) {
    const node = document.createElement("article");
    node.className = "discovery-card";

    const top = document.createElement("div");
    top.className = "discovery-top";
    const headingGroup = document.createElement("div");
    const source = document.createElement("p");
    source.className = "route-source";
    source.textContent = `検出元: ${candidate.trend}`;
    const title = document.createElement("h3");
    title.textContent = candidate.name;
    const stage = document.createElement("span");
    stage.className = `discovery-pill ${candidate.stageKind}`;
    stage.textContent = candidate.stage;
    headingGroup.append(source, title);
    top.append(headingGroup, stage);

    const reason = document.createElement("p");
    reason.className = "route-note";
    reason.textContent = candidate.reason;

    const proof = document.createElement("div");
    proof.className = "discovery-proof";
    for (const [label, value] of [
      ["信頼度", candidate.confidence],
      ["開始日", formatDateOnly(candidate.startDate, "開始日未取得")],
      ["終了日", formatDateOnly(candidate.endDate, "終了日未取得")],
      ["採用理由", candidate.adoptionReason],
      ["不足データ", candidate.missingData],
    ]) {
      const row = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      row.append(strong, document.createTextNode(value));
      proof.append(row);
    }

    const scores = document.createElement("div");
    scores.className = "discovery-scores";
    for (const [label, value] of [
      ["ホビー関連度", candidate.genreScore],
      ["価格データ", candidate.priceData],
      ["取引量", candidate.tradeVolume],
      ["利益シグナル", candidate.marginSignal],
      [
        "履歴一致",
        candidate.historyHits > 0
          ? `${candidate.historyHits}回（直近${candidate.historyRecentHits ?? 0}回）`
          : "新規シグナル",
      ],
    ]) {
      const item = document.createElement("span");
      const strong = document.createElement("strong");
      item.append(document.createTextNode(`${label} `));
      strong.textContent = value;
      item.append(strong);
      scores.append(item);
    }

    node.append(top, reason, proof, scores);

    if (candidate.sourceUrl) {
      const link = document.createElement("a");
      link.className = "route-link discovery-link";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "確認する";
      if (setSafeLink(link, candidate.sourceUrl, `${candidate.name}の確認リンクを開く`)) {
        node.append(link);
      }
    }

    elements.discoveryList.append(node);
  }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function matchKujiRule(text, rules) {
  return rules.find((rule) => rule.pattern.test(text));
}

function collectKujiRules(text, rules) {
  return rules.filter((rule) => rule.pattern.test(text));
}

function buildKujiPrediction(special) {
  const releaseAge = daysSinceDate(special.releaseDate);
  const isPreRelease = releaseAge !== null && releaseAge < 0;
  const text = [
    special.title,
    special.ip,
    special.status,
    special.targetPrizes,
    special.watchPoints,
    special.marketForecast,
    special.pastMarketBasis,
    ...(Array.isArray(special.officialLineup) ? special.officialLineup : []),
  ]
    .filter(Boolean)
    .join(" ");

  const ipRules = [
    { pattern: /ONE PIECE|ワンピース|赤髪|シャンクス/i, points: 23, label: "ONE PIECE強IP" },
    { pattern: /DRAGON BALL|ドラゴンボール|悟空|ベジータ/i, points: 23, label: "ドラゴンボール強IP" },
    { pattern: /HUNTER|キルア|ゾルディック/i, points: 19, label: "HUNTER人気キャラ軸" },
    { pattern: /BLEACH|ブリーチ/i, points: 16, label: "ジャンプ系バトルIP" },
    { pattern: /ヒーローアカデミア|ヒロアカ|爆豪|轟|デク/i, points: 16, label: "ヒロアカ主要キャラ軸" },
    { pattern: /Gundam|ガンダム|ジークアクス/i, points: 15, label: "ガンダム立体物需要" },
    { pattern: /星のカービィ|カービィ/i, points: 13, label: "カービィ安定回転" },
    { pattern: /アイカツ|アイドルマスター|学園アイドル/i, points: 11, label: "推し需要IP" },
    { pattern: /薬屋のひとりごと|おジャ魔女/i, points: 9, label: "固定ファンIP" },
    { pattern: /サッカー|日本代表/i, points: 2, label: "短期話題型" },
  ];
  const prizeRules = [
    { pattern: /MASTERLISE|EXPIECE|SOFVICS|BUSTISAN/i, points: 14, label: "上位立体賞" },
    { pattern: /ラストワン/i, points: 12, label: "ラストワン賞" },
    { pattern: /フィギュア|胸像|ソフビ/i, points: 10, label: "立体物中心" },
    { pattern: /シャンクス|大猿|ミケ|キルア|爆豪|轟|デク|孫悟空|ベジータ/i, points: 8, label: "人気キャラ賞" },
    { pattern: /上位|A-F賞|A-D賞/i, points: 6, label: "上位賞あり" },
  ];
  const reactionRules = [
    { pattern: /発売前強化|強化/i, points: 8, label: "発売前から監視強化" },
    { pattern: /成約|初動|店舗在庫|オンライン販売|残り店舗/i, points: 7, label: "成約/在庫の確認材料あり" },
    { pattern: /公式|HOBBY Watch|一番くじONLINE|セブン|ONE PIECE公式/i, points: 4, label: "公式/専門媒体で確認" },
    { pattern: /発売7日以内|発売中/i, points: 3, label: "初動確認期間" },
  ];
  const riskRules = [
    { pattern: /スポーツ|サッカー/i, points: -12, label: "ホビー相場とズレやすい" },
    { pattern: /雑貨|実用|キッチン|グッズ/i, points: -7, label: "雑貨中心は伸びにくい" },
    { pattern: /下位賞|まとめ売り/i, points: -6, label: "下位賞は利益に入れない" },
    { pattern: /単価550|薄利/i, points: -6, label: "薄利になりやすい" },
    { pattern: /ぬいぐるみ/i, points: /カービィ|ミケ|HUNTER/i.test(text) ? -2 : -5, label: "状態差とサイズに注意" },
    { pattern: /大型|送料750/i, points: -4, label: "大型賞は送料750円前提" },
  ];

  const ipMatch = matchKujiRule(text, ipRules);
  const prizeMatches = collectKujiRules(text, prizeRules);
  const reactionMatches = collectKujiRules(text, reactionRules);
  const riskMatches = collectKujiRules(text, riskRules);
  const scoreParts = {
    ip: ipMatch?.points ?? 4,
    prize: clampNumber(prizeMatches.reduce((sum, rule) => sum + rule.points, 0), 0, 24),
    reaction: clampNumber(reactionMatches.reduce((sum, rule) => sum + rule.points, 0), 0, 18),
    risk: clampNumber(riskMatches.reduce((sum, rule) => sum + rule.points, 0), -18, 0),
    timing: isPreRelease ? 6 : releaseAge !== null && releaseAge <= 7 ? 4 : 0,
  };
  const score = clampNumber(36 + scoreParts.ip + scoreParts.prize + scoreParts.reaction + scoreParts.risk + scoreParts.timing, 25, 98);
  const grade = score >= 80 ? "強い" : score >= 64 ? "要確認" : "薄い";
  const kind = score >= 80 ? "strong" : score >= 64 ? "watch" : "weak";
  const topPrize = prizeMatches[0]?.label ?? "賞構成待ち";
  const riskLabel = riskMatches[0]?.label ?? "大きな減点なし";
  const reactionLabel = reactionMatches[0]?.label ?? (isPreRelease ? "発売前の反応待ち" : "初動データ待ち");
  const pastLabel = ipMatch?.label ?? "過去相場は個別確認";
  const conclusion =
    grade === "強い"
      ? "発売前から上位賞とラストワンを優先監視。初動成約が出たら価格差候補へ上げる。"
      : grade === "要確認"
        ? "候補には残す。賞構成と初動成約が揃うまで買い判断は保留。"
        : "今は薄い。話題化か完売シグナルが出るまで通常監視で十分。";

  const basePredictedMedian = Math.round(1800 + score * 95);
  const predictedMedian = applyPredictionLearning(special.ip ?? "unknown", basePredictedMedian, special);
  const learning = predictionLearningSummary(special.ip ?? "unknown", special);
  const predictedLow = Math.max(500, Math.round(predictedMedian * 0.82));
  const predictedHigh = Math.round(predictedMedian * 1.18);
  const actualMarketPrice = Number.isFinite(special.actualMarketPrice)
    ? special.actualMarketPrice
    : Number.isFinite(special.marketPrice)
      ? special.marketPrice
      : null;
  const error = Number.isFinite(actualMarketPrice) ? actualMarketPrice - predictedMedian : null;
  const errorRate = Number.isFinite(error) && predictedMedian > 0 ? (error / predictedMedian) * 100 : null;

  return {
    score,
    grade,
    kind,
    conclusion,
    predictedLow,
    basePredictedMedian,
    predictedMedian,
    learningSamples: learning.samples,
    learningOffset: learning.offset,
    predictedHigh,
    actualMarketPrice,
    error,
    errorRate,
    factors: [
      ["過去相場", pastLabel],
      ["現在反応", reactionLabel],
      ["賞構成", topPrize],
      ["送料/リスク", riskLabel],
    ],
  };
}

function createKujiPredictionBox(prediction) {
  const box = document.createElement("div");
  box.className = `kuji-prediction ${prediction.kind}`;

  const top = document.createElement("div");
  top.className = "kuji-prediction-top";
  const title = document.createElement("p");
  title.textContent = "発売前利益予想";
  const score = document.createElement("span");
  score.textContent = `${prediction.grade} ${prediction.score}`;
  top.append(title, score);

  const grid = document.createElement("div");
  grid.className = "kuji-prediction-grid";
  for (const [label, value] of prediction.factors) {
    const item = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = label;
    item.append(strong, document.createTextNode(value));
    grid.append(item);
  }

  const conclusion = document.createElement("p");
  conclusion.className = "kuji-prediction-conclusion";
  const predicted = `予想レンジ ${yen.format(prediction.predictedLow)} - ${yen.format(prediction.predictedHigh)}（中央値 ${yen.format(
    prediction.predictedMedian,
  )}）`;
  const learning = ` / 学習補正 ${prediction.learningOffset >= 0 ? "+" : ""}${yen.format(
    prediction.learningOffset,
  )} / 学習件数 ${prediction.learningSamples}`;
  const actual = Number.isFinite(prediction.actualMarketPrice)
    ? ` / 実測 ${yen.format(prediction.actualMarketPrice)} / 誤差 ${prediction.error >= 0 ? "+" : ""}${yen.format(
        prediction.error,
      )} (${prediction.errorRate >= 0 ? "+" : ""}${prediction.errorRate.toFixed(1)}%)`
    : " / 実測待ち";
  conclusion.textContent = `${prediction.conclusion} ${predicted}${learning}${actual}`;

  box.append(top, grid, conclusion);
  return box;
}

function renderKujiSpecials() {
  if (!elements.kujiSpecialList) return;
  elements.kujiSpecialList.replaceChildren();

  const now = Date.now();
  const dayMs = 86_400_000;
  const pastGraceMs = 7 * dayMs;
  const futureWindowMs = 35 * dayMs;
  const visibleSpecials = kujiSpecials
    .filter((special) => {
      const releaseTime = special.releaseDate ? new Date(`${special.releaseDate}T00:00:00+09:00`).getTime() : now;
      return releaseTime >= now - pastGraceMs && releaseTime <= now + futureWindowMs;
    })
    .sort((a, b) => {
      const aTime = a.releaseDate ? new Date(`${a.releaseDate}T00:00:00+09:00`).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.releaseDate ? new Date(`${b.releaseDate}T00:00:00+09:00`).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

  elements.kujiSpecialSection?.classList.toggle("collapsed", state.kujiCollapsed);
  if (elements.kujiSpecialSummary) {
    const activeCount = visibleSpecials.filter((special) => {
      const releaseTime = special.releaseDate ? new Date(`${special.releaseDate}T00:00:00+09:00`).getTime() : now;
      return releaseTime <= now;
    }).length;
    const upcomingCount = visibleSpecials.filter((special) => {
      const releaseTime = special.releaseDate ? new Date(`${special.releaseDate}T00:00:00+09:00`).getTime() : now;
      return releaseTime > now;
    }).length;
    const hiddenCount = kujiSpecials.length - visibleSpecials.length;
    const metrics = overallPredictionMetrics();
    elements.kujiSpecialSummary.textContent = [
      `表示 ${visibleSpecials.length}件`,
      activeCount ? `発売7日以内 ${activeCount}件` : "",
      upcomingCount ? `1ヶ月先まで ${upcomingCount}件` : "",
      metrics.count > 0 ? `予想精度 MAE ${yen.format(Math.round(metrics.mae ?? 0))}` : "",
      metrics.count > 0 && Number.isFinite(metrics.mape) ? `MAPE ${metrics.mape.toFixed(1)}%` : "",
      hiddenCount ? `期間外 ${hiddenCount}件は非表示` : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (elements.kujiSpecialToggle) {
    elements.kujiSpecialToggle.textContent = state.kujiCollapsed ? "展開" : "閉じる";
    elements.kujiSpecialToggle.setAttribute("aria-expanded", String(!state.kujiCollapsed));
  }
  if (state.kujiCollapsed) return;

  for (const special of visibleSpecials) {
    const node = document.createElement("article");
    node.className = "kuji-special-card";

    const top = document.createElement("div");
    top.className = "kuji-special-top";
    const heading = document.createElement("div");
    const meta = document.createElement("p");
    meta.className = "route-source";
    meta.textContent = special.ip;
    const title = document.createElement("h3");
    title.textContent = special.title;
    heading.append(meta, title);
    const status = document.createElement("span");
    status.className = "kuji-special-status";
    status.textContent = special.status;
    top.append(heading, status);

    const predictionData = buildKujiPrediction(special);
    if (Number.isFinite(predictionData.actualMarketPrice)) {
      recordPredictionResult(special, predictionData.predictedMedian, predictionData.actualMarketPrice);
    }
    const prediction = createKujiPredictionBox(predictionData);

    const rows = document.createElement("div");
    rows.className = "kuji-special-rows";
    const lineup = Array.isArray(special.officialLineup) ? special.officialLineup.slice(0, 7).join(" / ") : "";
    for (const [label, value] of [
      ["発売日", formatDateOnly(special.releaseDate)],
      ["開始日", formatDateOnly(special.salesStartDate ?? special.releaseDate, "発売開始")],
      ["終了日", formatDateOnly(special.salesEndDate ?? special.displayUntil, "継続")],
      ["公式ラインナップ", lineup],
      ["見る賞", special.targetPrizes],
      ["相場予想", special.marketForecast],
      ["過去相場メモ", special.pastMarketBasis],
      ["判断材料", special.watchPoints],
    ]) {
      if (!value) continue;
      const row = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      row.append(strong, document.createTextNode(value));
      rows.append(row);
    }

    node.append(top, prediction, rows);

    if (special.sourceUrl) {
      const link = document.createElement("a");
      link.className = "route-link kuji-special-link";
      link.textContent = "特設を見る";
      if (setSafeLink(link, special.sourceUrl, `${special.title}の特設を開く`)) {
        node.append(link);
      }
    }

    elements.kujiSpecialList.append(node);
  }
}

function renderMarketMemory() {
  if (!elements.marketMemoryList) return;
  elements.marketMemoryList.replaceChildren();

  for (const memory of marketMemory) {
    const node = document.createElement("article");
    node.className = "memory-card";

    const top = document.createElement("div");
    top.className = "memory-top";
    const heading = document.createElement("div");
    const genre = document.createElement("p");
    genre.className = "route-source";
    genre.textContent = memory.genre;
    const title = document.createElement("h3");
    title.textContent = memory.title;
    heading.append(genre, title);
    const status = document.createElement("span");
    status.className = "memory-status";
    status.textContent = memory.status;
    top.append(heading, status);

    const rows = document.createElement("div");
    rows.className = "memory-rows";
    for (const [label, value] of [
      ["学習元", memory.learnedFrom],
      ["強い条件", memory.signal],
      ["履歴化", memory.history],
      ["次に見る", memory.watchNext],
    ]) {
      const row = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      row.append(strong, document.createTextNode(value));
      rows.append(row);
    }

    node.append(top, rows);

    if (memory.sourceUrl) {
      const link = document.createElement("a");
      link.className = "route-link memory-link";
      link.textContent = "参照元";
      if (setSafeLink(link, memory.sourceUrl, `${memory.title}の参照元を開く`)) {
        node.append(link);
      }
    }

    elements.marketMemoryList.append(node);
  }
}

function priorityLabel(priority) {
  if (priority === "high") return "最優先";
  if (priority === "medium") return "確認";
  return "低頻度";
}

function getPrimaryMarketVariant(release) {
  const variants = Array.isArray(release.marketVariants) ? release.marketVariants : [];
  return (
    variants.find((variant) => variant.priority === "primary" && variant.marketPrice) ??
    variants.find((variant) => variant.marketPrice) ??
    null
  );
}

function getReleaseMarketPrice(release) {
  return getPrimaryMarketVariant(release)?.marketPrice ?? release.marketPrice ?? null;
}

function getReleaseMarketLabel(release) {
  return getPrimaryMarketVariant(release)?.marketLabel ?? release.marketLabel ?? "BOX相場取得待ち";
}

function variantProfit(release, variant) {
  if (!variant?.marketPrice) return null;
  const fee = Math.round(variant.marketPrice * (state.settings.feeRate / 100));
  const buffer = Math.round(variant.marketPrice * (state.settings.priceBuffer / 100));
  const shipping = shippingRules.pokemon_box.shipping;
  const packing = state.settings.packingCost;
  return variant.marketPrice - fee - release.retailPrice - shipping - packing - buffer;
}

function buildReleaseVariantSummary(release) {
  const variants = Array.isArray(release.marketVariants) ? release.marketVariants : [];
  return variants.slice(0, 2).map((variant) => {
    const profit = variantProfit(release, variant);
    return {
      condition: variant.condition,
      kind: variant.priority === "primary" ? "primary" : "caution",
      marketText: variant.marketPrice ? `相場 ${yen.format(variant.marketPrice)}` : "相場 取得待ち",
      profitText: profit === null ? "利益 -" : `利益 ${signedYen(profit)}`,
    };
  });
}

function calculateRelease(release) {
  const marketPrice = getReleaseMarketPrice(release);
  if (!marketPrice) {
    return {
      fee: 0,
      buffer: 0,
      shipping: shippingRules.pokemon_box.shipping,
      profit: null,
      buyLine: null,
      margin: null,
    };
  }

  const fee = Math.round(marketPrice * (state.settings.feeRate / 100));
  const buffer = Math.round(marketPrice * (state.settings.priceBuffer / 100));
  const shipping = shippingRules.pokemon_box.shipping;
  const packing = state.settings.packingCost;
  const netSale = marketPrice - fee;
  const profit = netSale - release.retailPrice - shipping - packing - buffer;
  const buyLine = netSale - shipping - packing - buffer - state.settings.targetProfit;
  const margin = release.retailPrice > 0 ? (profit / release.retailPrice) * 100 : 0;
  return { fee, buffer, shipping, packing, netSale, profit, buyLine, margin };
}

function isDateActive(dateValue) {
  if (!dateValue) return true;
  return new Date(dateValue).getTime() >= Date.now();
}

function isDateStarted(dateValue) {
  if (!dateValue) return true;
  return new Date(dateValue).getTime() <= Date.now();
}

function releasePeriod(release) {
  const hasStarted = isDateStarted(`${release.saleStartDate ?? release.releaseDate}T00:00:00+09:00`);
  const hasEnded = !isDateActive(`${release.saleEndDate}T23:59:59+09:00`);

  if (!hasStarted) {
    return { label: "未発売", kind: "upcoming" };
  }

  if (hasEnded) {
    return { label: "発売終了", kind: "ended" };
  }

  return { label: "発売中", kind: "active" };
}

function isReleaseTitleAnnounced(release) {
  return release.titleAnnounced !== false;
}

function releaseWatchState(release) {
  if (!isReleaseTitleAnnounced(release)) {
    return {
      label: "タイトル未発表",
      kind: "hidden",
      reason: "弾名が発表されるまで画面には出さず、裏側の履歴だけで保持します。",
    };
  }
  const period = releasePeriod(release);
  if (release.watchStatus === "archive") {
    return {
      label: "終了・保留",
      kind: "archive",
      reason: release.archiveReason ?? "通常監視から外した弾です。必要な時だけ確認します。",
    };
  }
  if (period.kind === "ended") {
    return {
      label: "発売終了",
      kind: "archive",
      reason: "主な発売期間が終了したため、通常監視から外しました。",
    };
  }
  const ageDays = daysSinceDate(release.releaseDate);
  if (ageDays !== null && ageDays > pokemonReleaseMaxAgeDays) {
    return {
      label: "5ヶ月経過",
      kind: "archive",
      reason: "ポケカBOXは発売から5ヶ月を超えたため、通常監視から外しました。",
    };
  }
  return {
    label: period.label,
    kind: "active",
    reason: "",
  };
}

function routePeriod(route) {
  if (routeVerification(route).kind === "ended" || route.verification?.ended) {
    return { label: "抽選終了", kind: "ended" };
  }
  const hasStarted = isDateStarted(route.startDate);
  const hasEnded = route.deadlineDate ? !isDateActive(route.deadlineDate) : false;
  const routeText = [route.name, route.round, route.deadlineLabel].join(" ");

  if (!hasStarted) {
    return { label: "抽選前", kind: "upcoming" };
  }

  if (hasEnded) {
    return { label: "抽選終了", kind: "ended" };
  }

  if (!route.deadlineDate) {
    return {
      label: routeText.includes("再販") ? "再販中" : "抽選中",
      kind: "active",
    };
  }

  return { label: "抽選中", kind: "active" };
}

function isRollingRoute(route) {
  return /常時|随時|再販|入荷|招待/.test([route.name, route.round, route.deadlineLabel].join(" "));
}

function routeTargetIsGeneric(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return (
      path === "" ||
      path === "/" ||
      parsed.hostname === "www.amazon.co.jp" ||
      parsed.hostname === "www.pokemoncenter-online.com" ||
      /snkrdunk\.com$/.test(parsed.hostname)
    );
  } catch {
    return true;
  }
}

function routeVerification(route) {
  const stored = route.verification;
  const issues = [...(stored?.issues ?? [])];
  const rolling = isRollingRoute(route);
  const targetUrl = routeTargetUrl(route);

  if (!targetUrl && !issues.includes("リンク未設定")) issues.push("リンク未設定");
  if (routeTargetIsGeneric(targetUrl) && !issues.includes("応募直リンクではない")) issues.push("応募直リンクではない");
  if (!route.deadlineDate && !rolling && !issues.includes("終了日未確認")) issues.push("終了日未確認");
  if (!route.startDate && !issues.includes("開始日未確認")) issues.push("開始日未確認");

  const status = stored?.status ?? (issues.length === 0 ? "verified" : rolling ? "review" : "missing");
  const kind =
    status === "ended" || stored?.ended
      ? "ended"
      : status === "verified" && issues.length === 0
        ? "verified"
        : status === "missing"
          ? "missing"
          : "review";
  return {
    kind,
    label: kind === "verified" ? "応募欄OK" : kind === "ended" ? "受付終了" : kind === "review" ? "目視確認" : "要修正",
    summary: stored?.summary ?? (rolling ? "常時/再販枠" : "自動確認待ち"),
    issues,
  };
}

function routeCheckLabel(route, status) {
  if (status.kind === "upcoming") return "開始前確認済み";
  if (isRollingRoute(route) || routeVerification(route).kind !== "verified") return "確認済み";
  return "応募済み";
}

function routeMatchesPeriodFilter(route) {
  if (state.routeFilter === "all") return true;
  const kind = routePeriod(route).kind;
  if (state.routeFilter === "active") return kind === "active";
  return kind === state.routeFilter;
}

function getActiveRoutes(release) {
  if (releaseWatchState(release).kind !== "active") return [];
  return releaseRoutes(release).filter((route) => {
    return shouldDisplayRoute(route) && routeMatchesPeriodFilter(route) && routePeriod(route).kind !== "ended";
  });
}

function renderArchivedRoutes() {
  if (!elements.archiveRouteList) return;
  elements.archiveRouteList.replaceChildren();

  const archivedReleases = pokemonReleases
    .map((release) => ({ release, watchState: releaseWatchState(release) }))
    .filter(({ watchState }) => watchState.kind === "archive");

  if (archivedReleases.length === 0) return;

  const panel = document.createElement("div");
  panel.className = "archive-panel";
  const header = document.createElement("div");
  header.className = "archive-header";
  const titleGroup = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "panel-kicker";
  kicker.textContent = "Hold";
  const title = document.createElement("h3");
  title.textContent = "終了・保留";
  const note = document.createElement("p");
  note.className = "route-note";
  note.textContent = "ほぼ終わった弾や相場待ちの古い弾は、通常監視から外してここに残します。";
  titleGroup.append(kicker, title, note);
  header.append(titleGroup);
  panel.append(header);

  for (const { release, watchState } of archivedReleases) {
    const item = document.createElement("article");
    item.className = "archive-item";
    const content = document.createElement("div");
    const meta = document.createElement("p");
    meta.className = "route-source";
    meta.textContent = `${release.product} / 発売 ${formatDateOnly(release.releaseDate)} / 販売 ${formatDateOnly(
      release.saleStartDate ?? release.releaseDate,
    )}-${formatDateOnly(release.saleEndDate)} / ${getReleaseMarketLabel(release)}`;
    const name = document.createElement("strong");
    name.textContent = release.name;
    const reason = document.createElement("p");
    reason.textContent = watchState.reason;
    content.append(meta, name, reason);

    const link = document.createElement("a");
    link.className = "route-link";
    link.textContent = "確認";
    if (setSafeLink(link, release.sourceUrl, `${release.name}を確認`)) {
      item.append(content, link);
    } else {
      item.append(content);
    }
    panel.append(item);
  }

  elements.archiveRouteList.append(panel);
}

function getVisiblePokemonReleases() {
  return pokemonReleases.filter((release) => releaseWatchState(release).kind === "active");
}

function updatePokecaSummary() {
  if (!elements.lotterySummary) return;
  const visibleReleases = getVisiblePokemonReleases();
  const activeRoutes = visibleReleases.reduce((count, release) => {
    return (
      count +
      releaseRoutes(release).filter((route) => {
        if (!shouldDisplayRoute(route)) return false;
        const kind = routePeriod(route).kind;
        return kind === "active";
      }).length
    );
  }, 0);
  const upcomingRoutes = visibleReleases.reduce((count, release) => {
    return count + releaseRoutes(release).filter((route) => shouldDisplayRoute(route) && routePeriod(route).kind === "upcoming").length;
  }, 0);
  const hiddenCount = pokemonReleases.filter((release) => releaseWatchState(release).kind === "hidden").length;
  const parts = [
    `発表済み ${visibleReleases.length}弾`,
    `応募/再販 ${activeRoutes}件`,
    upcomingRoutes ? `予定 ${upcomingRoutes}件` : "",
    hiddenCount ? `未発表 ${hiddenCount}件は非表示` : "",
  ].filter(Boolean);
  elements.lotterySummary.textContent = parts.join(" / ");
  if (elements.pokecaToggle) {
    elements.pokecaToggle.textContent = state.pokecaCollapsed ? "展開" : "閉じる";
    elements.pokecaToggle.setAttribute("aria-expanded", String(!state.pokecaCollapsed));
  }
}

function renderRoutes() {
  elements.lotterySection?.classList.toggle("collapsed", state.pokecaCollapsed);
  updatePokecaSummary();
  if (state.pokecaCollapsed) {
    elements.routeList.replaceChildren();
    elements.archiveRouteList?.replaceChildren();
    return;
  }
  const releases = pokemonReleases.filter((release) => {
    const period = releasePeriod(release);
    const matchesFilter = state.routeFilter === "all" || period.kind === state.routeFilter || getActiveRoutes(release).length > 0;
    return period.kind !== "ended" && matchesFilter && getActiveRoutes(release).length > 0;
  });
  elements.routeList.replaceChildren();
  renderArchivedRoutes();

  for (const release of releases) {
    const routes = getActiveRoutes(release);
    const calc = calculateRelease(release);
    const node = elements.routeTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.detailId = releaseDetailTargetId(release);
    const releaseStatus = releasePeriod(release);
    node.querySelector(".route-source").textContent =
      `${release.product} / 発売 ${formatDateOnly(release.releaseDate)} / 販売 ${formatDateOnly(
        release.saleStartDate ?? release.releaseDate,
      )}-${formatDateOnly(release.saleEndDate)} / 相場更新 ${release.marketUpdated}`;
    node.querySelector("h3").textContent = release.name;

    const pill = node.querySelector(".route-pill");
    pill.textContent = releaseStatus.label;
    pill.classList.add(releaseStatus.kind);

    node.querySelector(".route-note").textContent = release.note;
    node.querySelector(".release-retail").textContent = yen.format(release.retailPrice);
    const marketPrice = getReleaseMarketPrice(release);
    node.querySelector(".release-market").textContent = marketPrice ? yen.format(marketPrice) : "取得待ち";
    const profit = node.querySelector(".release-profit");
    profit.textContent = calc.profit === null ? "-" : signedYen(calc.profit);
    profit.classList.toggle("positive", calc.profit !== null && calc.profit >= 0);
    profit.classList.toggle("negative", calc.profit !== null && calc.profit < 0);
    node.querySelector(".release-buyline").textContent = calc.buyLine === null ? "-" : yen.format(Math.max(0, calc.buyLine));

    const meta = node.querySelector(".route-meta");
    const variants = Array.isArray(release.marketVariants) ? release.marketVariants : [];
    const variantLabels = variants
      .map((variant) => {
        const profit = variantProfit(release, variant);
        const profitText = profit === null ? "利益-" : `利益${signedYen(profit)}`;
        return `${variant.condition}: ${variant.marketPrice ? yen.format(variant.marketPrice) : "取得待ち"} / ${profitText}`;
      })
      .slice(0, 2);
    for (const item of [
      releaseStatus.label,
      getReleaseMarketLabel(release),
      `送料 ${yen.format(shippingRules.pokemon_box.shipping)}`,
      `発売 ${formatDateOnly(release.releaseDate)}`,
      `販売終了 ${formatDateOnly(release.saleEndDate, "継続")}`,
      ...variantLabels,
      release.conditionPolicy,
    ].filter(Boolean)) {
      const tag = document.createElement("span");
      tag.textContent = item;
      meta.append(tag);
    }

    const routeList = node.querySelector(".release-routes");
    for (const route of routes) {
      const applyKey = routeApplyKey(release, route);
      const inputId = `apply-${applyKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const routeStatus = routePeriod(route);
      const routeItem = document.createElement("div");
      routeItem.className = "release-route";
      routeItem.classList.add(routeStatus.kind);
      routeItem.classList.toggle("applied", Boolean(state.appliedRoutes[applyKey]));

      const checkLabel = document.createElement("label");
      checkLabel.className = "applied-check";
      checkLabel.setAttribute("for", inputId);
      const checkbox = document.createElement("input");
      checkbox.id = inputId;
      checkbox.type = "checkbox";
      checkbox.dataset.applyKey = applyKey;
      checkbox.checked = Boolean(state.appliedRoutes[applyKey]);
      const hiddenLabel = document.createElement("span");
      checkLabel.append(checkbox, hiddenLabel);

      const routeText = document.createElement("div");
      const routeName = document.createElement("strong");
      routeName.textContent = route.name;
      const routeMeta = document.createElement("span");
      const routeState = document.createElement("b");
      routeState.textContent = routeStatus.label;
      routeMeta.append(
        routeState,
        document.createTextNode(
          ` / ${routeScopeLabel(route)} / ${route.round ?? "通常"} / ${routeApplicationMethod(route)} / 開始 ${formatDateTime(
            route.startDate,
            "随時",
          )} / 終了 ${formatDateTime(routeEffectiveDeadline(route, release), route.deadlineLabel ?? "継続")} / ${route.deadlineLabel}`,
        ),
      );
      routeText.append(routeName, routeMeta);

      const routeLink = document.createElement("a");
      routeLink.className = "route-row-link";
      routeLink.target = "_blank";
      routeLink.rel = "noreferrer";
      routeLink.append(createExternalIcon());

      routeItem.append(checkLabel, routeText);
      if (setSafeLink(routeLink, routeTargetUrl(route, release), `${release.name} ${route.name}を開く`)) {
        routeItem.append(routeLink);
      }
      routeList.append(routeItem);
    }

    const link = node.querySelector(".route-link");
    setSafeLink(link, release.sourceUrl, `${release.name}のスニダン情報を確認`);

    elements.routeList.append(node);
  }
}

function readSettings() {
  state.settings.feeRate = Number(elements.feeRate.value) || 0;
  state.settings.targetProfit = Number(elements.targetProfit.value) || 0;
  state.settings.priceBuffer = Number(elements.priceBuffer.value) || 0;
  state.settings.packingCost = Number(elements.packingCost.value) || 0;
  renderDeals();
  renderActionItems();
}

function handleNav(event) {
  const section = event.currentTarget.dataset.section;
  elements.navItems.forEach((item) => item.classList.toggle("active", item === event.currentTarget));

  const groupedSections = [...new Set(Object.values(elements.sectionGroups).flat().filter(Boolean))];
  if (window.matchMedia("(max-width: 1120px)").matches) {
    const visibleSections = new Set(elements.sectionGroups[section] ?? []);
    groupedSections.forEach((node) => {
      node.classList.toggle("hidden-by-nav", !visibleSections.has(node));
    });
  } else {
    groupedSections.forEach((node) => node.classList.remove("hidden-by-nav"));
  }

  elements.sections[section]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderDeals();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sortMode = event.target.value;
    renderDeals();
  });

  elements.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("marketlens-theme", state.theme);
    } catch {
      // Theme persistence is optional.
    }
    applyTheme();
  });

  elements.refreshData?.addEventListener("click", () => {
    loadResearchSnapshot({ rerender: true });
  });

  elements.enableNotifications?.addEventListener("click", () => {
    enableBrowserNotifications();
  });

  elements.testNotification?.addEventListener("click", () => {
    showDigestNotification({ test: true });
  });

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".segment").forEach((item) => item.classList.toggle("active", item === button));
      renderDeals();
    });
  });

  elements.routeSegments.forEach((button) => {
    button.addEventListener("click", () => {
      state.routeFilter = button.dataset.routeFilter;
      elements.routeSegments.forEach((item) => item.classList.toggle("active", item === button));
      renderRoutes();
    });
  });

  elements.pokecaToggle?.addEventListener("click", () => {
    state.pokecaCollapsed = !state.pokecaCollapsed;
    savePokecaCollapsed();
    renderRoutes();
  });

  elements.kujiSpecialToggle?.addEventListener("click", () => {
    state.kujiCollapsed = !state.kujiCollapsed;
    saveKujiCollapsed();
    renderKujiSpecials();
  });

  elements.routeList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-apply-key]");
    if (!checkbox) return;
    state.appliedRoutes[checkbox.dataset.applyKey] = checkbox.checked;
    saveAppliedRoutes();
    checkbox.closest(".release-route")?.classList.toggle("applied", checkbox.checked);
    renderActionItems();
  });

  elements.actionList.addEventListener("change", (event) => {
    const routeCheckbox = event.target.closest("[data-route-action-key]");
    if (routeCheckbox) {
      state.appliedRoutes[routeCheckbox.dataset.routeActionKey] = routeCheckbox.checked;
      saveAppliedRoutes();
      renderRoutes();
      renderActionItems();
      return;
    }

    const checkbox = event.target.closest("[data-action-key]");
    if (!checkbox) return;

    if (checkbox.dataset.actionType === "lotteryGroup") {
      const routeKeys = (checkbox.dataset.routeKeys ?? "").split("||").filter(Boolean);
      for (const routeKey of routeKeys) {
        state.appliedRoutes[routeKey] = checkbox.checked;
      }
      saveAppliedRoutes();
      renderRoutes();
    } else if (checkbox.dataset.actionType === "lottery") {
      state.appliedRoutes[checkbox.dataset.actionKey] = checkbox.checked;
      saveAppliedRoutes();
      renderRoutes();
    } else {
      state.actionDone[checkbox.dataset.actionKey] = checkbox.checked;
      saveActionDone();
    }

    renderActionItems();
  });

  for (const input of [elements.feeRate, elements.targetProfit, elements.priceBuffer, elements.packingCost]) {
    input.addEventListener("input", readSettings);
  }

  elements.navItems.forEach((item) => item.addEventListener("click", handleNav));
}

function renderAll() {
  renderRoutes();
  renderTrends();
  renderArchivedCandidates();
  renderKujiSpecials();
  renderDiscoveryCandidates();
  renderMarketMemory();
  renderDeals();
  renderActionItems();
  updateNotificationStatus();
}

async function init() {
  applyTheme();
  bindEvents();
  await loadResearchSnapshot();
  renderAll();
  checkMorningNotification();
  setInterval(checkMorningNotification, 60_000);
}

init();
