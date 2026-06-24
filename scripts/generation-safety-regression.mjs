import assert from "node:assert/strict";
import { toGeminiResponseSchema } from "./marketlens-gemini-contract.mjs";
import { stringifyWellFormedJson } from "./marketlens-observation.mjs";

function collectKeys(value, key, rows = []) {
  if (!value || typeof value !== "object") return rows;
  for (const [entryKey, child] of Object.entries(value)) {
    if (entryKey === key) rows.push(entryKey);
    collectKeys(child, key, rows);
  }
  return rows;
}

const openAiStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
};
const geminiSchema = toGeminiResponseSchema(openAiStyleSchema);
assert.equal(collectKeys(geminiSchema, "additionalProperties").length, 0, "Gemini schema に unsupported additionalProperties が残っています");
assert.deepEqual(geminiSchema.required, ["groups"], "Gemini schema 変換で required を失っています");
assert.equal(openAiStyleSchema.additionalProperties, false, "schema 変換が入力を破壊しています");

const invalidUnicode = { title: `emoji${String.fromCharCode(0xd83d)}` };
const serialized = stringifyWellFormedJson(invalidUnicode, 2);
assert.doesNotMatch(serialized, /\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F][0-9a-fA-F]{2})/);
assert.deepEqual(JSON.parse(serialized), { title: "emoji�" });

console.log("generation-safety-regression: PASS");
