import assert from "node:assert/strict";
import {
  computeCuratorTrustLevel,
  extractProductNamesFromCuratorPost,
  looksLikeCuratorNoiseName,
  nameOverlapScore,
  parseCuratorSample,
} from "./curator-parse.mjs";

const pokecaSample = {
  text: "【ポケカ抽選】ムニキスゼロ 📅 受付 1/9 11:00 〜 1/12 23:59 🎯 発表 1/23 11:00 🔗 https://www.itoyokado.co.jp/",
  accountHandle: "pokecachan",
  sourceUrl: "https://x.com/pokecachan/status/123",
  postedAt: "2時間前",
};

const names = extractProductNamesFromCuratorPost(pokecaSample.text, ["pokecachan"]);
assert.ok(names.some((name) => name.includes("ムニキス")), "should extract munikis product name");
assert.equal(looksLikeCuratorNoiseName("ポケカ予約速報@ポケモンカード情報 (@pokecachan) / X", ["pokecachan"]), true);

const mentions = parseCuratorSample(pokecaSample, { handle: "pokecachan" });
assert.ok(mentions.length >= 1);
assert.equal(mentions[0].handle, "pokecachan");
assert.ok(mentions[0].urls.length >= 1);

const group = {
  canonicalName: "ポケモンカード MEGA 拡張パック ムニキスゼロ",
  events: [{ sourceUrl: "https://www.itoyokado.co.jp/lottery" }],
};
assert.ok(nameOverlapScore(group.canonicalName, mentions[0].productName) >= 0.3);
assert.equal(computeCuratorTrustLevel(mentions[0], group), "B");

console.log("[curator-sync-regression] ok");
