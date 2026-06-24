export function toGeminiResponseSchema(schema) {
  if (Array.isArray(schema)) return schema.map((item) => toGeminiResponseSchema(item));
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== "additionalProperties")
      .map(([key, value]) => [key, toGeminiResponseSchema(value)]),
  );
}
