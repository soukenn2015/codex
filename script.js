(() => {
  "use strict";

  const SNAPSHOT_URL = "data/marketlens.ui-snapshot.json";
  const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  let snapshot = null;
  let currentTab = "overview";
  let currentCategory = "all";
  let displayMode = "all";
  let productSearchQuery = "";
  let expandedCardId = null;
  let collapsedBundleIds = new Set();
  let groupIndexMap = new Map();

  function refreshGroupIndexMap() {
    groupIndexMap = new Map();
    (snapshot?.productGroups ?? []).forEach((g, i) => groupIndexMap.set(g, i));
  }

  function groupIdx(g) {
    return groupIndexMap.get(g) ?? -1;
  }

  const CATEGORY_LABELS = {
    pokeca: "ポケカ",
    onepiece: "ワンピカ",
    kuji: "くじ",
    figure: "フィギュア",
    limited: "限定品",
    other: "その他",
  };

  const EVENT_KIND_LABELS = {
    lottery: "抽選",
    preorder: "予約",
    release: "発売",
    sale: "販売",
    resale: "再販",
    info: "情報",
  };

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isSafeUrl(url = "") {
    return /^https?:\/\//i.test(String(url));
  }

  function normalizeKey(value = "") {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[「」『』【】（）()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function categorize(name) {
    if (!name) return "other";
    if (/ポケカ|ポケモンカード|TCG|pokemon.*card/i.test(name)) return "pokeca";
    if (/ワンピース|ワンピカ|ONE PIECE|OP-?\d/i.test(name)) return "onepiece";
    if (/一番くじ|くじ引き堂|ラストワン/i.test(name)) return "kuji";
    if (/ROBOT魂|METAL BUILD|S\.H\.Figuarts|figma|フィギュア|プラモ|ガンプラ|HG|MG|PG/i.test(name)) return "figure";
    if (/限定|コラボ|G-SHOCK|Supreme|たまごっち/i.test(name)) return "limited";
    return "other";
  }

  function isAccountOrSignalName(name) {
    if (!name) return true;
    if (/@[\w_]+|（@[\w_]+）|\(@[\w_]+\)/.test(name)) return true;
    if (/抽選・再販速報|抽選・再販まとめ|速報（@|まとめ（@|情報源|監視対象|signal/i.test(name)) return true;
    if (/^ポケカ抽選|^ポケカ.*速報|^ポケカ.*まとめ/.test(name)) return true;
    return false;
  }

  function isGenericHeadline(text) {
    if (!text) return true;
    if (text === "AI判断待ち") return true;
    if (/^(プレミアムバンダイでの予約開始|シリーズ復刻情報の公開|展示発表|公式.*公開|商品群の確認が必要)/.test(text)) return true;
    return text.length < 12;
  }

  function hasUsefulAiReason(g) {
    if (g.judgment?.decisionOrigin !== "gemini") return false;
    const reason = g.judgment?.reason || {};
    const detail = String(reason.detail || "").trim();
    const headline = String(reason.headline || "").trim();
    const action = String(reason.whyNow || "").trim();
    if (detail.length >= 24) return true;
    if (action.length >= 12) return true;
    return headline.length >= 16 && !isGenericHeadline(headline);
  }

  function isNameValid(g) {
    const name = g.canonicalName || "";
    if (name.length < 4 || name.length > 90) return false;
    if (/[<>]|https?:\/\//i.test(name)) return false;
    if (isAccountOrSignalName(name)) return false;
    if (/^(A賞|B賞|C賞|D賞|ラインナップ|対象となっている|公式サイトで|予約◆|9 20)/.test(name)) return false;
    if (/しているほか|となっている|で確認|AI判断待ち|組み換え可能な食玩/.test(name)) return false;
    if (/ミリタリー|1\/72|1\/144|再販\）$|再販\)$/.test(name)) return false;
    if (name.includes("】") && !name.includes("【")) return false;
    return true;
  }

  function isStrictDisplayable(g) {
    if (!isNameValid(g)) return false;

    if (["A", "B"].includes(getCuratorTrustLevel(g))) {
      const eventDate = getSectionEventDate(g);
      if (eventDate) {
        const daysPast = (Date.now() - eventDate) / 86400000;
        if (daysPast > 7) return false;
      }
      return true;
    }

    const tier = getTierValue(g);
    if (tier === "HOLD") return false;
    if (!["T1", "T2", "T3"].includes(tier)) return false;
    if (g.judgment?.decisionOrigin !== "gemini") return false;
    if (!hasUsefulAiReason(g)) return false;

    const reason = g.judgment?.reason || {};
    const profitMax = Number(reason.profitMax ?? 0);
    const buyPrice = getBuyPrice(g);
    if (profitMax > 0 && profitMax < 1000) return false;
    if (buyPrice > 50000) return false;

    const eventDate = getSectionEventDate(g);
    if (eventDate) {
      const daysPast = (Date.now() - eventDate) / 86400000;
      if (daysPast > 7) return false;
    }

    return true;
  }

  function isDisplayable(g) {
    return isStrictDisplayable(g);
  }

  function getCuratorTrustLevel(g) {
    return g.curatorTrust?.level ?? "E";
  }

  function hasCuratorTrust(g) {
    return ["A", "B", "C"].includes(getCuratorTrustLevel(g));
  }

  function matchesProductSearch(g, query = productSearchQuery) {
    const normalizedQuery = normalizeKey(query);
    if (!normalizedQuery) return true;
    const haystack = normalizeKey(g.canonicalName || "");
    if (haystack.includes(normalizedQuery)) return true;
    return (g.members ?? []).some((member) => normalizeKey(member.name || "").includes(normalizedQuery));
  }

  function getTierValue(g) {
    const tier = g.judgment?.tier;
    if (!tier) return "HOLD";
    if (typeof tier === "object") return tier.value || "HOLD";
    return tier;
  }

  function getNextEventDate(g) {
    const now = Date.now();
    let closest = null;
    (g.events || []).forEach(e => {
      const dateStr = e.endsAt || e.startsAt;
      if (!dateStr) return;
      const t = new Date(dateStr).getTime();
      if (t >= now - 86400000) {
        if (!closest || t < closest) closest = t;
      }
    });
    return closest;
  }

  function getSectionEventDate(g) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const pastWeekStart = todayStart - 7 * 86400000;
    let nearestFuture = null;
    let mostRecentPast = null;

    (g.events || []).forEach((event) => {
      for (const dateStr of [event.startsAt, event.endsAt]) {
        if (!dateStr) continue;
        const t = new Date(dateStr).getTime();
        if (!Number.isFinite(t)) continue;
        if (t >= todayStart - 86400000) {
          if (!nearestFuture || t < nearestFuture) nearestFuture = t;
        } else if (t >= pastWeekStart) {
          if (!mostRecentPast || t > mostRecentPast) mostRecentPast = t;
        }
      }
    });

    return nearestFuture ?? mostRecentPast ?? null;
  }

  function getTimeSection(eventDate) {
    if (!eventDate) return "undated";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.floor((eventDate - today.getTime()) / 86400000);
    if (diffDays < -1 && diffDays >= -7) return "past_week";
    if (diffDays <= 1) return "today_tomorrow";
    const endOfWeek = 7 - today.getDay();
    if (diffDays <= endOfWeek) return "this_week";
    if (diffDays <= endOfWeek + 7) return "next_week";
    return "later";
  }

  function computeScore(g) {
    let score = 0;
    const reason = g.judgment?.reason || {};
    const profitMax = reason.profitMax || 0;
    const signal = getMarketSignal(g);
    const sp = getSignalPrice(signal);

    if (sp?.type === "sold") score += 40;
    else if (sp?.type === "listing") score += 20;
    else if (profitMax > 0) score += 10;

    if (profitMax >= 10000) score += 30;
    else if (profitMax >= 5000) score += 20;
    else if (profitMax >= 2000) score += 10;
    else if (profitMax > 0) score += 5;

    const eventDate = getNextEventDate(g);
    if (eventDate) {
      const daysAway = (eventDate - Date.now()) / 86400000;
      if (daysAway <= 0) score += 20;
      else if (daysAway <= 1) score += 15;
      else if (daysAway <= 7) score += 10;
      else if (daysAway <= 14) score += 5;
    }

    if (g.judgment?.decisionOrigin === "gemini") score += 10;
    else if (g.judgment?.decisionOrigin) score += 3;

    if (categorize(g.canonicalName) === "pokeca") score += 8;

    return score;
  }

  function computeAllCandidatesScore(g) {
    let score = computeScore(g);
    const trustLevel = getCuratorTrustLevel(g);
    if (trustLevel === "B") score += 120;
    else if (trustLevel === "A") score += 100;
    else if (trustLevel === "C") score += 60;

    const tier = getTierValue(g);
    if (g.judgment?.decisionOrigin !== "gemini" && hasCuratorTrust(g)) score += 45;
    if (tier === "HOLD" && hasCuratorTrust(g)) score += 35;
    if (g.judgment?.decisionOrigin !== "gemini") score -= 10;
    if (tier === "HOLD") score -= 15;
    return score;
  }

  function getMarketSignal(g) {
    if (!snapshot?.marketplaceSignals) return null;
    const keys = new Set();
    if (g.productKey) keys.add(normalizeKey(g.productKey));
    if (g.canonicalName) keys.add(normalizeKey(g.canonicalName));
    for (const member of g.members ?? []) {
      if (member?.productKey) keys.add(normalizeKey(member.productKey));
      if (member?.canonicalName) keys.add(normalizeKey(member.canonicalName));
    }
    for (const signal of snapshot.marketplaceSignals) {
      const signalKeys = [
        normalizeKey(signal.productKey),
        normalizeKey(signal.productName),
      ].filter(Boolean);
      if (signalKeys.some((sk) => [...keys].some((k) => k && sk && (k.includes(sk) || sk.includes(k))))) {
        return signal;
      }
    }
    return null;
  }

  function getSignalPrice(signal) {
    if (!signal) return null;
    const sold = signal.soldCandidates || [];
    const listing = signal.listingCandidates || [];
    const jpyPrice = (candidate) => {
      const value = Number(candidate.value ?? candidate.price ?? candidate.soldPriceJpy ?? 0);
      if (!Number.isFinite(value) || value <= 0) return null;
      const currency = String(candidate.currency ?? "JPY").toUpperCase();
      if (currency !== "JPY") return null;
      return value;
    };
    if (sold.length > 0) {
      const prices = sold.map(jpyPrice).filter(Number.isFinite).sort((a, b) => a - b);
      if (prices.length > 0) return { price: prices[Math.floor(prices.length / 2)], type: "sold" };
    }
    if (listing.length > 0) {
      const prices = listing.map(jpyPrice).filter(Number.isFinite).sort((a, b) => a - b);
      if (prices.length > 0) return { price: prices[Math.floor(prices.length / 2)], type: "listing" };
    }
    return null;
  }

  function formatProfit(g) {
    const signal = getMarketSignal(g);
    const sp = getSignalPrice(signal);

    if (sp?.type === "sold" && sp.price > 0) {
      const buy = getBuyPrice(g);
      if (buy > 0 && sp.price > buy) {
        return {
          text: `+¥${(sp.price - buy).toLocaleString()}`,
          type: "green",
          suffix: "",
          basis: "sold",
        };
      }
      return {
        text: `¥${sp.price.toLocaleString()}`,
        type: "green",
        suffix: "",
        basis: "sold",
      };
    }

    const reason = g.judgment?.reason || {};
    const profitMin = reason.profitMin || 0;
    const profitMax = reason.profitMax || 0;

    if (profitMax > 0) {
      const display = profitMin > 0 && profitMin !== profitMax
        ? `+¥${profitMin.toLocaleString()}〜${profitMax.toLocaleString()}`
        : `+¥${profitMax.toLocaleString()}`;
      return { text: display, type: "yellow", suffix: " AI予測", basis: "ai" };
    }

    if (sp?.type === "listing" && sp.price > 0) {
      return {
        text: `¥${sp.price.toLocaleString()}`,
        type: "yellow",
        suffix: " 参考",
        basis: "listing",
      };
    }

    return null;
  }

  function getBuyPrice(g) {
    const snapshots = snapshot?.priceSnapshots || [];
    const keys = new Set([normalizeKey(g.productKey), normalizeKey(g.canonicalName)].filter(Boolean));
    const match = snapshots.find((p) => {
      const pk = normalizeKey(p.productKey);
      const pn = normalizeKey(p.productName);
      return keys.has(pk) || keys.has(pn);
    });
    return match?.buyPrice || match?.retailPrice || match?.value || 0;
  }

  function confidenceDotsHtml(g) {
    const conf = g.judgment?.reason?.profitConfidence || 0;
    const filled = Math.min(4, Math.max(0, Math.round(conf)));
    let html = '<span class="conf-dots" aria-label="確度">';
    for (let i = 0; i < 4; i += 1) {
      html += `<span class="conf-dot${i < filled ? " on" : ""}"></span>`;
    }
    html += "</span>";
    return html;
  }

  function getTierBadgeHtml(g) {
    const tier = getTierValue(g);
    if (!tier || tier === "HOLD") {
      if (hasCuratorTrust(g) && ["A", "B"].includes(getCuratorTrustLevel(g))) {
        return `<span class="tier-badge tier-hold">HOLD</span>`;
      }
      return "";
    }
    return `<span class="tier-badge tier-${tier.toLowerCase()}">${escapeHtml(tier)}</span>`;
  }

  function getCuratorBadgeHtml(g) {
    const trust = g.curatorTrust;
    if (!trust || !["A", "B", "C"].includes(trust.level)) return "";
    const handles = (trust.handles ?? []).map((handle) => `@${handle}`).join(" ");
    return `<span class="curator-badge level-${trust.level.toLowerCase()}">★ ${escapeHtml(handles || "curator")}</span>`;
  }

  function getAllModeStatusLine(g) {
    if (displayMode !== "all") return "";
    const tier = getTierValue(g);
    const trustLevel = getCuratorTrustLevel(g);
    if (["A", "B"].includes(trustLevel) && tier === "HOLD") return "キュレーター確認・AI見送り";
    if (hasCuratorTrust(g) && g.judgment?.decisionOrigin !== "gemini") return "要AI判定・キュレーター確認済";
    if (g.judgment?.decisionOrigin !== "gemini") return "AI未判定";
    if (tier === "HOLD") return "AI見送り";
    return "";
  }

  function getProductCardClass(g) {
    const classes = ["product-card"];
    if (displayMode !== "all") return classes.join(" ");

    const tier = getTierValue(g);
    const trustLevel = getCuratorTrustLevel(g);
    if (["A", "B"].includes(trustLevel)) classes.push("curator-confirmed");
    else if (tier === "HOLD" && hasCuratorTrust(g)) classes.push("hold-curator");
    else if (g.judgment?.decisionOrigin !== "gemini" && hasCuratorTrust(g)) classes.push("unjudged-curator");
    else if (g.judgment?.decisionOrigin !== "gemini" || tier === "HOLD") classes.push("dim");
    return classes.join(" ");
  }

  function getAiReasonLine(g) {
    const reason = g.judgment?.reason || {};
    if (reason.detail) {
      const first = reason.detail.split("。").find(s => s.trim().length >= 12);
      if (first) return `${first.trim()}。`;
    }
    if (reason.whyNow) return reason.whyNow;
    if (reason.headline && !isGenericHeadline(reason.headline)) return reason.headline;
    return "";
  }

  function buildClientOverview() {
    const server = snapshot?.overviewNarrative;
    if (server?.text && String(server.text).trim().length >= 24) {
      return {
        lead: String(server.text).trim(),
        sections: [],
        buzz: buildBuzzSummary(),
        trends: buildTrendSummary(),
      };
    }

    const groups = getVisibleGroups("strict");
    if (groups.length === 0) {
      return {
        lead: "現在、AI判定済みで表示基準を満たす商品がまだ少ない状態です。再判定を続けると、ここに今日の行動案が表示されます。",
        sections: [],
        buzz: buildBuzzSummary(),
        trends: buildTrendSummary(),
      };
    }

    const urgent = groups.filter(g => getTimeSection(getSectionEventDate(g)) === "today_tomorrow");
    const t1 = groups.filter(g => getTierValue(g) === "T1");
    const paragraphs = [];

    if (urgent.length > 0) {
      urgent.slice(0, 3).forEach(g => {
        const badge = formatEventBadge(g);
        const action = g.judgment?.reason?.whyNow || getAiReasonLine(g);
        const profit = formatProfit(g);
        let line = `${g.canonicalName}は`;
        if (badge) {
          line += `${badge.includes("今日") || badge.includes("明日") ? badge : `次のイベントが${badge}です`}。`;
        } else {
          line += "近日が重要です。";
        }
        if (action) line += action.endsWith("。") ? action : `${action}。`;
        if (profit) {
          line += `利益見込みは${profit.text}です。`;
          if (profit.basis === "ai") line += "これはAI予測に基づく参考値です。";
        }
        paragraphs.push(line);
      });
    }

    if (t1.length > 0) {
      const names = t1.slice(0, 3).map(g => g.canonicalName).join("、");
      const reasons = t1.slice(0, 3)
        .map(g => getAiReasonLine(g))
        .filter(Boolean)
        .join(" ");
      paragraphs.push(`優先して見るべき商品は${names}です。${reasons}`);
    }

    const upcoming = groups.filter(g => {
      const section = getTimeSection(getSectionEventDate(g));
      return section === "next_week" || section === "later";
    });
    if (upcoming.length > 0) {
      paragraphs.push(`来週以降は${upcoming.slice(0, 3).map(g => g.canonicalName).join("、")}など${upcoming.length}件が控えています。先の予定も商品タブで確認してください。`);
    }

    return {
      lead: paragraphs[0] || `${groups.length}件の候補があります。商品タブで優先順に並べています。`,
      sections: paragraphs.slice(1),
      buzz: buildBuzzSummary(),
      trends: buildTrendSummary(),
    };
  }

  function buildBuzzSummary() {
    const buzz = snapshot?.buzzDiscovery;
    const signals = (snapshot?.socialSearchSignals ?? []).filter((s) => s.buzzEligible);
    if (!signals.length && !buzz?.signalCount) return "";
    const top = signals
      .sort((a, b) => (b.maxHeatScore ?? 0) - (a.maxHeatScore ?? 0))
      .slice(0, 3)
      .map((s) => s.productName || s.query)
      .filter(Boolean);
    if (!top.length) return "X上で注目されている話題を監視しています。";
    return `X上で${top.join("、")}などが話題になっています。`;
  }

  function buildTrendSummary() {
    const alerts = snapshot?.priceTrendAlerts ?? [];
    if (!alerts.length) return "";
    const names = alerts.slice(0, 3).map((a) => a.productName).filter(Boolean);
    return `メルカリで${names.join("、")}などの参考価格が上昇しています。`;
  }

  function formatEventBadge(g) {
    const now = Date.now();
    let closestEvent = null;
    let closestTime = Infinity;
    (g.events || []).forEach(e => {
      const dateStr = e.endsAt || e.startsAt;
      if (!dateStr) return;
      const t = new Date(dateStr).getTime();
      if (t >= now - 86400000 && t < closestTime) {
        closestTime = t;
        closestEvent = e;
      }
    });
    if (!closestEvent) return "";
    const d = new Date(closestTime);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    const typeMap = {
      lottery_close: "抽選〆",
      lottery_open: "抽選開始",
      sale_open: "販売",
      release: "発売",
      sale_close: "販売終了",
    };
    const label = typeMap[closestEvent.eventType] || "イベント";
    const diffDays = Math.floor((closestTime - now) / 86400000);
    if (diffDays === 0) return `${label}今日`;
    if (diffDays === 1) return `${label}明日`;
    return `${label}${dateStr}`;
  }

  function getVisibleGroups(mode = displayMode) {
    if (!snapshot?.productGroups) return [];
    const filterFn = mode === "all" ? isNameValid : isStrictDisplayable;
    const sorter = mode === "all"
      ? (a, b) => computeAllCandidatesScore(b) - computeAllCandidatesScore(a)
      : (a, b) => computeScore(b) - computeScore(a);
    return snapshot.productGroups
      .filter(filterFn)
      .filter((g) => mode === "all" ? matchesProductSearch(g) : true)
      .sort(sorter);
  }

  function groupByTimeSection(groups) {
    const sections = {
      today_tomorrow: [],
      this_week: [],
      next_week: [],
      later: [],
      undated: [],
      past_week: [],
    };
    groups.forEach(g => {
      const eventDate = getSectionEventDate(g);
      const section = getTimeSection(eventDate);
      sections[section].push(g);
    });
    return sections;
  }

  function filterByCategory(groups, cat) {
    if (cat === "all") return groups;
    return groups.filter(g => categorize(g.canonicalName) === cat);
  }

  function nameOverlapScore(left = "", right = "") {
    const leftNorm = normalizeKey(left);
    const rightNorm = normalizeKey(right);
    if (leftNorm.length >= 4 && rightNorm.length >= 4) {
      if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) {
        return Math.max(0.72, Math.min(leftNorm.length, rightNorm.length) / Math.max(leftNorm.length, rightNorm.length));
      }
    }
    const leftTokens = leftNorm.split(/[\s　・／/]+/).filter((token) => token.length >= 2);
    const rightTokens = new Set(rightNorm.split(/[\s　・／/]+/).filter((token) => token.length >= 2));
    if (!leftTokens.length || !rightTokens.size) return 0;
    const shared = leftTokens.filter((token) => rightTokens.has(token));
    return shared.length / Math.max(leftTokens.length, rightTokens.size);
  }

  function getEventKind(g) {
    const types = (g.events ?? []).map((event) => String(event.eventType ?? event.kind ?? "")).join(" ").toLowerCase();
    if (types.includes("lottery")) return "lottery";
    if (types.includes("preorder")) return "preorder";
    if (types.includes("release")) return "release";
    if (types.includes("resale")) return "resale";
    if (types.includes("sale")) return "sale";
    return "info";
  }

  function extractIpKeyword(name = "") {
    const rules = [
      /ムニキス[^\s、。]*/u,
      /ストームエメラル[^\s、。]*/u,
      /ROBOT魂[^\s、。]*/u,
      /METAL BUILD[^\s、。]*/u,
      /S\.H\.Figuarts[^\s、。]*/u,
      /一番くじ[^\s、。]*/u,
      /30周年[^\s、。]*BOX/u,
      /ワンピース[^\s、。]*/u,
      /ポケモンカード[^\s、。]{0,12}(?:BOX|拡張パック|ブースター)/u,
    ];
    for (const rule of rules) {
      const match = name.match(rule);
      if (match) return match[0];
    }
    const cleaned = name.replace(/【[^】]+】/g, "").trim();
    return cleaned.length > 20 ? `${cleaned.slice(0, 20)}…` : cleaned;
  }

  function findCuratorMentionsForGroup(g) {
    const mentions = snapshot?.curatorMentions ?? [];
    const groupKey = normalizeKey(g.productKey ?? g.groupKey ?? g.canonicalName ?? "");
    return mentions.filter((mention) => {
      if (mention.productGroupKey && normalizeKey(mention.productGroupKey) === groupKey) return true;
      return nameOverlapScore(g.canonicalName ?? "", mention.productName ?? "") >= 0.55;
    });
  }

  function sortProductsInBundle(products = []) {
    const rank = (g) => {
      let score = 0;
      const trust = getCuratorTrustLevel(g);
      if (trust === "B") score += 120;
      else if (trust === "A") score += 100;
      else if (trust === "C") score += 60;
      if ((g.events ?? []).some((event) => event.startsAt || event.endsAt || event.sourceUrl)) score += 40;
      const tier = getTierValue(g);
      if (tier === "T1") score += 30;
      else if (tier === "T2") score += 20;
      else if (tier === "T3") score += 10;
      return score + computeAllCandidatesScore(g) / 20;
    };
    return [...products].sort((a, b) => rank(b) - rank(a));
  }

  function collectBundleInfos(products = []) {
    const infos = [];
    const seen = new Set();
    for (const product of products) {
      for (const mention of findCuratorMentionsForGroup(product)) {
        const key = `curator:${mention.postUrl ?? mention.handle}:${mention.productName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        infos.push({
          kind: "curator",
          handle: mention.handle,
          postUrl: mention.postUrl ?? null,
          text: mention.excerpt ?? mention.productName ?? "",
          dates: mention.dates ?? {},
          urls: mention.urls ?? [],
        });
      }
      const trust = product.curatorTrust;
      if (trust?.postUrl) {
        const key = `curator:${trust.postUrl}`;
        if (!seen.has(key)) {
          seen.add(key);
          infos.push({
            kind: "curator",
            handle: trust.handles?.[0] ?? "curator",
            postUrl: trust.postUrl,
            text: "",
            dates: {},
            urls: [],
          });
        }
      }
      for (const event of product.events ?? []) {
        const url = event.sourceUrl ?? event.url ?? null;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        infos.push({
          kind: "route",
          label: event.eventType ?? "公式",
          url,
        });
      }
    }
    return infos;
  }

  function buildBundleTitle(products = [], category = "other", eventKind = "info") {
    const primary = products[0];
    const trusted = products.some((product) => ["A", "B"].includes(getCuratorTrustLevel(product)));
    const handle = primary?.curatorTrust?.handles?.[0] ?? findCuratorMentionsForGroup(primary ?? {})[0]?.handle;
    const ip = extractIpKeyword(primary?.canonicalName ?? "候補");
    const catLabel = CATEGORY_LABELS[category] ?? "商品";
    const eventLabel = EVENT_KIND_LABELS[eventKind] ?? "情報";
    if (trusted && handle === "pokecachan") return `【${catLabel}${eventLabel}】${ip}`;
    if (trusted && handle === "oroshinohito") return `【物販】${ip}`;
    return `【${catLabel}${eventLabel}】${ip}`;
  }

  function getBundleClusterKey(g, sectionKey) {
    const trustLevel = getCuratorTrustLevel(g);
    if (["A", "B"].includes(trustLevel)) {
      const handle = g.curatorTrust?.handles?.[0] ?? "curator";
      return `trusted:${handle}:${normalizeKey(extractIpKeyword(g.canonicalName)).slice(0, 24)}`;
    }
    const category = categorize(g.canonicalName);
    const eventKind = getEventKind(g);
    const ip = normalizeKey(extractIpKeyword(g.canonicalName)).slice(0, 24) || normalizeKey(g.canonicalName).slice(0, 24);
    const eventDate = getSectionEventDate(g);
    const dayKey = eventDate && sectionKey !== "undated"
      ? new Date(eventDate).toISOString().slice(0, 10)
      : "na";
    return `${category}|${eventKind}|${ip}|${dayKey}`;
  }

  function assembleBundle(clusterKey, products, sectionKey) {
    const sortedProducts = sortProductsInBundle(products);
    const primary = sortedProducts[0];
    const category = categorize(primary?.canonicalName ?? "");
    const eventKind = getEventKind(primary ?? {});
    const trusted = sortedProducts.some((product) => ["A", "B"].includes(getCuratorTrustLevel(product)));
    const infos = collectBundleInfos(sortedProducts);
    const mentionDates = infos.find((info) => info.kind === "curator" && info.dates)?.dates ?? {};
    return {
      id: `bundle:${sectionKey}:${clusterKey}`,
      title: buildBundleTitle(sortedProducts, category, eventKind),
      category,
      eventKind,
      trusted,
      sectionKey,
      curatorTrust: primary?.curatorTrust ?? null,
      dates: mentionDates,
      products: sortedProducts,
      infos,
    };
  }

  function buildDigestBundles(items, sectionKey) {
    const useBundles = displayMode === "all" && (sectionKey === "undated" || sectionKey === "later" || items.length >= 8);
    if (!useBundles) {
      return { trustedBundles: [], bundles: [], unbundled: items, bundleCount: 0 };
    }

    const clusterMap = new Map();
    for (const item of items) {
      const key = getBundleClusterKey(item, sectionKey);
      if (!clusterMap.has(key)) clusterMap.set(key, []);
      clusterMap.get(key).push(item);
    }

    const trustedBundles = [];
    const bundles = [];
    const unbundled = [];

    for (const [clusterKey, products] of clusterMap.entries()) {
      const bundle = assembleBundle(clusterKey, products, sectionKey);
      if (bundle.trusted) {
        trustedBundles.push(bundle);
      } else if (products.length === 1 && sectionKey !== "undated" && sectionKey !== "later") {
        unbundled.push(...products);
      } else {
        bundles.push(bundle);
      }
    }

    const bundleScore = (bundle) => {
      let score = bundle.products.length;
      if (bundle.trusted) score += 200;
      if (bundle.infos.length) score += 20;
      return score;
    };

    trustedBundles.sort((a, b) => bundleScore(b) - bundleScore(a));
    bundles.sort((a, b) => bundleScore(b) - bundleScore(a));

    return {
      trustedBundles,
      bundles,
      unbundled,
      bundleCount: trustedBundles.length + bundles.length,
    };
  }

  function renderInfoRow(info) {
    if (info.kind === "curator") {
      const label = info.postUrl && isSafeUrl(info.postUrl)
        ? `<a class="info-row-link" href="${escapeHtml(info.postUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(info.handle)} 投稿</a>`
        : `@${escapeHtml(info.handle)}`;
      const dateBits = [
        info.dates?.reception ? `📅 ${escapeHtml(info.dates.reception)}` : "",
        info.dates?.announce ? `🎯 ${escapeHtml(info.dates.announce)}` : "",
      ].filter(Boolean);
      const firstUrl = (info.urls ?? [])[0];
      const urlBit = firstUrl && isSafeUrl(firstUrl)
        ? `<a class="info-row-link" href="${escapeHtml(firstUrl)}" target="_blank" rel="noopener noreferrer">🔗 応募/公式</a>`
        : "";
      return `<div class="info-row info-row-curator">
        <span class="info-row-label">📎 出典</span>
        <span class="info-row-body">${label}${dateBits.length ? ` · ${dateBits.join(" · ")}` : ""}${urlBit ? ` · ${urlBit}` : ""}</span>
      </div>`;
    }
    if (info.kind === "route") {
      if (!isSafeUrl(info.url)) {
        return `<div class="info-row info-row-route">
          <span class="info-row-label">🔗 ${escapeHtml(info.label || "公式")}</span>
          <span class="info-row-body">${escapeHtml(info.url)}</span>
        </div>`;
      }
      return `<div class="info-row info-row-route">
        <span class="info-row-label">🔗 ${escapeHtml(info.label || "公式")}</span>
        <a class="info-row-link" href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.url)}</a>
      </div>`;
    }
    return "";
  }

  function renderDigestBundle(bundle) {
    const collapsed = collapsedBundleIds.has(bundle.id);
    const productCount = bundle.products.length;
    const collapsible = productCount > 8;
    const visibleProducts = collapsed && collapsible ? bundle.products.slice(0, 5) : bundle.products;
    const trustedLabel = bundle.trusted
      ? `<span class="digest-bundle-trust">★ 確認済みキュレーター: @${escapeHtml(bundle.curatorTrust?.handles?.[0] ?? "curator")}</span>`
      : "";

    let headerMeta = `${productCount}件`;
    if (bundle.infos.length) headerMeta += ` · 情報${bundle.infos.length}件`;

    let html = `<div class="digest-bundle${bundle.trusted ? " trusted" : ""}" data-bundle-id="${escapeHtml(bundle.id)}">`;
    html += `<div class="digest-bundle-header${collapsible ? " digest-bundle-toggle" : ""}"${collapsible ? ` data-bundle-toggle="${escapeHtml(bundle.id)}"` : ""}>`;
    html += `<div class="digest-bundle-title">${escapeHtml(bundle.title)}</div>`;
    html += `<div class="digest-bundle-meta">${trustedLabel}<span class="digest-bundle-count">${escapeHtml(headerMeta)}</span></div>`;
    html += `</div>`;

    if (bundle.infos.length) {
      html += `<div class="digest-bundle-infos">`;
      bundle.infos.slice(0, 4).forEach((info) => {
        html += renderInfoRow(info);
      });
      html += `</div>`;
    }

    html += `<div class="digest-bundle-products">`;
    visibleProducts.forEach((product) => {
      html += renderProductCard(product, groupIdx(product));
    });
    if (collapsed && collapsible) {
      html += `<button type="button" class="digest-bundle-more" data-bundle-toggle="${escapeHtml(bundle.id)}">他 ${productCount - visibleProducts.length} 件を表示</button>`;
    } else if (collapsible && !collapsed) {
      html += `<button type="button" class="digest-bundle-more" data-bundle-toggle="${escapeHtml(bundle.id)}">束を折りたたむ</button>`;
    }
    html += `</div></div>`;
    return html;
  }

  function renderSectionItems(items, sectionKey) {
    const layout = buildDigestBundles(items, sectionKey);
    let html = "";
    for (const bundle of layout.trustedBundles) {
      html += renderDigestBundle(bundle);
    }
    for (const bundle of layout.bundles) {
      html += renderDigestBundle(bundle);
    }
    for (const product of layout.unbundled) {
      html += renderProductCard(product, groupIdx(product));
    }
    return { html, bundleCount: layout.bundleCount };
  }

  // Rendering
  function renderOverview() {
    const el = document.getElementById("overviewReport");
    const brief = buildClientOverview();
    let html = `<div class="overview-section"><p class="overview-lead">${escapeHtml(brief.lead)}</p>`;
    brief.sections.forEach(p => {
      html += `<p>${escapeHtml(p)}</p>`;
    });
    if (brief.buzz) {
      html += `<div class="overview-section"><div class="overview-section-title">Xバズ</div><p>${escapeHtml(brief.buzz)}</p></div>`;
    }
    if (brief.trends) {
      html += `<div class="overview-section"><div class="overview-section-title">メルカリ急騰</div><p>${escapeHtml(brief.trends)}</p></div>`;
    }
    html += `</div>`;

    const groups = getVisibleGroups("strict");
    const topItems = groups.slice(0, 5);
    if (topItems.length > 0) {
      html += `<div class="overview-section"><div class="overview-section-title">注目商品</div>`;
      topItems.forEach(g => {
        const profit = formatProfit(g);
        const profitStr = profit
          ? `<span class="product-profit ${profit.type}">${escapeHtml(profit.text)}${escapeHtml(profit.suffix)}</span>`
          : "";
        const reasonLine = getAiReasonLine(g);
        html += `<div class="product-card overview-card" data-goto-idx="${groupIdx(g)}">
          <div class="product-card-row1">
            ${getTierBadgeHtml(g)}
            <span class="product-name">${escapeHtml(g.canonicalName)}</span>
            ${profitStr}
          </div>
          <div class="product-card-row2">
            <span class="product-meta">${escapeHtml([formatEventBadge(g), reasonLine].filter(Boolean).join(" │ "))}</span>
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    el.innerHTML = html;
    el.querySelectorAll(".overview-card").forEach(card => {
      card.addEventListener("click", () => {
        document.querySelector('.tab-btn[data-tab="products"]')?.click();
      });
    });
  }

  function renderProducts() {
    const container = document.getElementById("productSections");
    const summaryEl = document.getElementById("productsSummary");
    const searchInput = document.getElementById("productSearch");
    if (searchInput && searchInput.value !== productSearchQuery) {
      searchInput.value = productSearchQuery;
    }
    if (searchInput) {
      searchInput.classList.toggle("hidden", displayMode !== "all");
    }

    const groups = filterByCategory(getVisibleGroups(), currentCategory);
    const sections = groupByTimeSection(groups);
    const totalNameValid = snapshot.productGroups?.filter(isNameValid).length ?? 0;

    if (summaryEl) {
      const modeLabel = displayMode === "all" ? "全候補" : "厳選";
      const searchNote = productSearchQuery ? ` · 検索「${productSearchQuery}」` : "";
      summaryEl.textContent = `${modeLabel} ${groups.length}件表示（名前正常 ${totalNameValid}件）${searchNote}`;
    }

    const sectionLabels = {
      today_tomorrow: "今日・明日",
      this_week: "今週",
      next_week: "来週",
      later: "再来週以降",
      undated: "日付未定",
      past_week: "過去1週間",
    };

    const sectionOrder = ["today_tomorrow", "past_week", "this_week", "next_week", "later", "undated"];
    const expandLargeSections = displayMode === "all";

    let html = "";
    let totalBundles = 0;
    for (const key of sectionOrder) {
      const items = sections[key] || [];
      if (items.length === 0) continue;
      const collapsedByDefault = !expandLargeSections && (key === "later" || key === "undated");
      const sectionLayout = buildDigestBundles(items, key);
      const bundleSuffix = sectionLayout.bundleCount ? ` · ${sectionLayout.bundleCount}束` : "";
      html += `<div class="time-section">`;
      if (key === "next_week" && displayMode === "strict" && items.length > 5) {
        html += `<div class="time-section-header">${sectionLabels[key]}（上位5件）</div>`;
        html += `<div class="time-section-items">`;
        items.slice(0, 5).forEach(g => {
          html += renderProductCard(g, groupIdx(g));
        });
        html += `</div>`;
        html += `<button class="time-section-toggle collapsed" data-section="${key}-more">他${items.length - 5}件</button>`;
        html += `<div class="time-section-items collapsed" id="section-${key}-more">`;
        items.slice(5).forEach(g => {
          html += renderProductCard(g, groupIdx(g));
        });
      } else if (collapsedByDefault) {
        html += `<button class="time-section-toggle collapsed" data-section="${key}">${sectionLabels[key]} (${items.length}件${bundleSuffix})</button>`;
        html += `<div class="time-section-items collapsed" id="section-${key}">`;
        const rendered = renderSectionItems(items, key);
        html += rendered.html;
        totalBundles += rendered.bundleCount;
        if (items.length > 3) {
          html += `<div class="section-preview-note">全 ${items.length} 件。展開して確認してください。</div>`;
        }
      } else {
        html += `<div class="time-section-header">${sectionLabels[key]} (${items.length}件${bundleSuffix})</div>`;
        html += `<div class="time-section-items">`;
        const rendered = renderSectionItems(items, key);
        html += rendered.html;
        totalBundles += rendered.bundleCount;
      }
      html += `</div></div>`;
    }

    if (summaryEl && totalBundles > 0 && displayMode === "all") {
      const modeLabel = "全候補";
      const searchNote = productSearchQuery ? ` · 検索「${productSearchQuery}」` : "";
      summaryEl.textContent = `${modeLabel} ${groups.length}件表示 · ${totalBundles}束（名前正常 ${totalNameValid}件）${searchNote}`;
    }

    if (!html) {
      html = `<div class="empty-state">表示できる商品がありません。<br>${displayMode === "all" ? "検索条件を変えるか、パイプライン実行後に再読み込みしてください。" : "パイプラインを実行してAI判定を増やしてください。"}</div>`;
    }

    container.innerHTML = html;
    attachCardListeners();
    attachSectionToggles();
    attachBundleToggles();
  }

  function renderProductCard(g, idx = groupIdx(g)) {
    const profit = formatProfit(g);
    const profitHtml = profit
      ? `<span class="product-profit ${profit.type}">${escapeHtml(profit.text)}${escapeHtml(profit.suffix)}</span>`
      : "";
    const badge = formatEventBadge(g);
    const reasonLine = getAiReasonLine(g);
    const statusLine = getAllModeStatusLine(g);
    const metaParts = [badge, statusLine, reasonLine].filter(Boolean).join(" │ ");
    const expanded = expandedCardId === idx;
    const cardClass = getProductCardClass(g);

    let detailHtml = "";
    if (expanded) {
      detailHtml = renderDetail(g);
    }

    return `<div class="${cardClass}${expanded ? " expanded" : ""}" data-idx="${idx}">
      <div class="product-card-row1">
        ${getCuratorBadgeHtml(g)}
        ${getTierBadgeHtml(g)}
        <span class="product-name">${escapeHtml(g.canonicalName)}</span>
        ${profitHtml}
      </div>
      <div class="product-card-row2">
        <span class="product-meta">${escapeHtml(metaParts)}</span>
        ${confidenceDotsHtml(g)}
      </div>
      <div class="product-detail">${detailHtml}</div>
    </div>`;
  }

  function renderDetail(g) {
    const reason = g.judgment?.reason || {};
    let html = "";

    if (reason.detail) {
      html += `<div class="detail-section">
        <div class="detail-label">AIの見解</div>
        <div class="detail-text">${escapeHtml(reason.detail)}</div>
      </div>`;
    }

    if (reason.profitMax > 0) {
      const minStr = reason.profitMin > 0 ? `+¥${reason.profitMin.toLocaleString()}` : "---";
      const maxStr = `+¥${reason.profitMax.toLocaleString()}`;
      html += `<div class="detail-section">
        <div class="detail-label">利益予測（AI）</div>
        <div class="detail-profit-box detail-profit-ai">
          <div class="detail-text">${minStr} 〜 ${maxStr}</div>
          <div class="detail-text detail-note">売却済み実績がないため、参考値として表示しています。</div>
          <div class="detail-text detail-note-sub">確度: ${confidenceDotsHtml(g)}</div>
        </div>
      </div>`;
    } else {
      const signal = getMarketSignal(g);
      const sp = getSignalPrice(signal);
      if (sp?.type === "listing") {
        html += `<div class="detail-section">
          <div class="detail-label">参考価格（出品中）</div>
          <div class="detail-profit-box detail-profit-listing">
            <div class="detail-text">¥${sp.price.toLocaleString()}</div>
            <div class="detail-text detail-note">未売却の出品価格です。確定利益ではありません。</div>
          </div>
        </div>`;
      }
    }

    if (reason.whyNow) {
      html += `<div class="detail-section">
        <div class="detail-label">アクション</div>
        <div class="detail-text">${escapeHtml(reason.whyNow)}</div>
      </div>`;
    }

    if (reason.risk) {
      html += `<div class="detail-section">
        <div class="detail-label">リスク</div>
        <div class="detail-risk">${escapeHtml(reason.risk)}</div>
      </div>`;
    }

    if (hasCuratorTrust(g)) {
      const trust = g.curatorTrust;
      const handles = (trust.handles ?? []).map((handle) => `@${handle}`).join(", ");
      html += `<div class="detail-section">
        <div class="detail-label">キュレーター確認</div>
        <div class="detail-text">${escapeHtml(`信頼レベル ${trust.level} · ${handles}`)}</div>
      </div>`;
    }

    const riskFactors = Array.isArray(reason.risk_factors) ? reason.risk_factors : [];
    if (riskFactors.length > 0) {
      html += `<div class="detail-section"><div class="detail-label">リスク要因</div><ul class="detail-list">`;
      riskFactors.forEach((factor) => {
        html += `<li>${escapeHtml(factor)}</li>`;
      });
      html += `</ul></div>`;
    }

    const similar = Array.isArray(reason.similar_products) ? reason.similar_products : [];
    if (similar.length > 0) {
      html += `<div class="detail-section"><div class="detail-label">類似商品の売却実績</div><ul class="detail-list">`;
      similar.forEach((row) => {
        const price = row.sold_price ?? row.soldPrice ?? row.price;
        const priceStr = Number.isFinite(Number(price)) ? `¥${Number(price).toLocaleString()}` : "";
        html += `<li>${escapeHtml(row.name || row.productName || "類似商品")}${priceStr ? ` — ${priceStr}` : ""}${row.note ? `（${escapeHtml(row.note)}）` : ""}</li>`;
      });
      html += `</ul></div>`;
    }

    const signal = getMarketSignal(g);
    const sp = getSignalPrice(signal);
    if (sp?.type === "sold") {
      html += `<div class="detail-section">
        <div class="detail-label">売却済み実績</div>
        <div class="detail-profit-box detail-profit-sold">
          <div class="detail-text">¥${sp.price.toLocaleString()}</div>
          <div class="detail-text detail-note">メルカリ等の売却済み価格です。</div>
        </div>
      </div>`;
    }

    html += `<button class="detail-ask-btn" data-product="${escapeHtml(g.canonicalName)}">この商品についてAIに聞く</button>`;
    return html;
  }

  function attachCardListeners() {
    document.querySelectorAll(".product-card[data-idx]").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".detail-ask-btn")) {
          const productName = e.target.dataset.product;
          openChatWithContext(productName);
          return;
        }
        const idx = parseInt(card.dataset.idx, 10);
        if (expandedCardId === idx) {
          expandedCardId = null;
        } else {
          expandedCardId = idx;
        }
        renderProducts();
      });
    });
  }

  function attachSectionToggles() {
    document.querySelectorAll(".time-section-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const section = btn.dataset.section;
        const items = document.getElementById(`section-${section}`);
        btn.classList.toggle("collapsed");
        items.classList.toggle("collapsed");
      });
    });
  }

  function attachBundleToggles() {
    document.querySelectorAll("[data-bundle-toggle]").forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const bundleId = btn.dataset.bundleToggle;
        if (!bundleId) return;
        if (collapsedBundleIds.has(bundleId)) collapsedBundleIds.delete(bundleId);
        else collapsedBundleIds.add(bundleId);
        renderProducts();
      });
    });
  }

  // Tab navigation
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        currentTab = tab;
        document.getElementById(tab === "overview" ? "overviewTab" : "productsTab").classList.add("active");
      });
    });

    document.querySelectorAll(".cat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentCategory = btn.dataset.cat;
        expandedCardId = null;
        collapsedBundleIds = new Set();
        renderProducts();
      });
    });

    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (!mode || mode === displayMode) return;
        displayMode = mode;
        productSearchQuery = "";
        expandedCardId = null;
        collapsedBundleIds = new Set();
        document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
        renderProducts();
      });
    });

    const searchInput = document.getElementById("productSearch");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        productSearchQuery = searchInput.value.trim();
        expandedCardId = null;
        collapsedBundleIds = new Set();
        renderProducts();
      });
    }
  }

  // Chat
  function initChat() {
    const fab = document.getElementById("chatFab");
    const overlay = document.getElementById("chatOverlay");
    const closeBtn = document.getElementById("chatClose");
    const sendBtn = document.getElementById("chatSend");
    const input = document.getElementById("chatInput");
    const keySetup = document.getElementById("chatKeySetup");
    const keySaveBtn = document.getElementById("keySave");
    const keyInput = document.getElementById("keyInput");
    const messages = document.getElementById("chatMessages");

    fab.addEventListener("click", () => {
      overlay.classList.remove("hidden");
      checkApiKey();
      input.focus();
    });

    closeBtn.addEventListener("click", () => {
      overlay.classList.add("hidden");
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });

    keySaveBtn.addEventListener("click", () => {
      const key = keyInput.value.trim();
      if (key) {
        localStorage.setItem("gemini_api_key", key);
        keySetup.classList.add("hidden");
        addMessage("ai", "APIキーを保存しました。何でも聞いてください。");
      }
    });

    sendBtn.addEventListener("click", sendMessage);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    function checkApiKey() {
      const key = localStorage.getItem("gemini_api_key");
      if (!key) {
        keySetup.classList.remove("hidden");
      } else {
        keySetup.classList.add("hidden");
      }
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      const key = localStorage.getItem("gemini_api_key");
      if (!key) {
        keySetup.classList.remove("hidden");
        return;
      }
      input.value = "";
      addMessage("user", text);

      try {
        const contextProducts = getVisibleGroups().slice(0, 10).map(g => ({
          name: g.canonicalName,
          tier: getTierValue(g),
          reason: g.judgment?.reason?.detail || g.judgment?.reason?.headline || "",
        }));

        const systemPrompt = `あなたは転売市場に詳しいAIアドバイザーです。丁寧語で答えてください。体言止めは禁止です。以下は現在の注目商品リストです:\n${JSON.stringify(contextProducts, null, 0)}`;

        const res = await fetch(GEMINI_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { temperature: 0.7 },
          }),
        });

        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "回答を取得できませんでした。";
        addMessage("ai", reply);
      } catch (err) {
        addMessage("ai", `エラーが発生しました: ${err.message}`);
      }
    }

    function addMessage(role, text) {
      const div = document.createElement("div");
      div.className = `chat-msg ${role}`;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function openChatWithContext(productName) {
    const overlay = document.getElementById("chatOverlay");
    const input = document.getElementById("chatInput");
    overlay.classList.remove("hidden");
    input.value = `${productName}について詳しく教えてください。`;
    input.focus();
  }

  // Init
  async function init() {
    initTabs();
    initChat();

    try {
      const res = await fetch(SNAPSHOT_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      snapshot = await res.json();
      refreshGroupIndexMap();
    } catch (err) {
      document.getElementById("appMain").innerHTML =
        `<div class="error-state" style="margin:20px">データの読み込みに失敗しました: ${escapeHtml(err.message)}</div>`;
      return;
    }

    const meta = snapshot.metadata;
    if (meta?.updatedAt) {
      const d = new Date(meta.updatedAt);
      document.getElementById("lastUpdated").textContent =
        `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")} 更新`;
    }

    renderOverview();
    renderProducts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
