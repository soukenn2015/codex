/**
 * source-priority.mjs — 発売7日前のソース優先度UP
 */

import { readFile, writeFile } from "node:fs/promises";

const sourceConfigUrl = new URL("../data/source-config.json", import.meta.url);
const snapshotUrl = new URL("../data/marketlens.snapshot.json", import.meta.url);

async function main() {
  const [configRaw, snapshotRaw] = await Promise.all([
    readFile(sourceConfigUrl, "utf8"),
    readFile(snapshotUrl, "utf8"),
  ]);
  const config = JSON.parse(configRaw);
  const snapshot = JSON.parse(snapshotRaw);
  const now = Date.now();
  const weekMs = 7 * 86400000;

  const urgentKeywords = new Set();
  for (const group of snapshot.productGroups ?? []) {
    for (const event of group.events ?? []) {
      const t = new Date(event.startsAt ?? event.endsAt ?? 0).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = t - now;
      if (diff >= 0 && diff <= weekMs) {
        urgentKeywords.add(String(group.canonicalName ?? "").slice(0, 20));
      }
    }
  }

  let boosted = 0;
  for (const source of config.sources ?? []) {
    const keyword = String(source.keyword ?? "");
    const urgent = [...urgentKeywords].some((k) => keyword.includes(k.slice(0, 8)) || k.includes(keyword.slice(0, 8)));
    if (urgent && source.priority !== "high") {
      source.priority = "high";
      source.fetchPriority = "high";
      boosted += 1;
    } else if (!source.fetchPriority) {
      source.fetchPriority = source.priority === "high" ? "high" : "normal";
    }
  }

  snapshot.sourcePriority = {
    observedAt: new Date().toISOString(),
    urgentKeywordCount: urgentKeywords.size,
    boostedSourceCount: boosted,
  };

  await writeFile(sourceConfigUrl, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[source-priority] boosted=${boosted} urgentKeywords=${urgentKeywords.size}`);
}

main().catch((error) => {
  console.error("[source-priority] fatal:", error?.message ?? error);
  process.exit(1);
});
