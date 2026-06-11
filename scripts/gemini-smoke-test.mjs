const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const geminiModel = process.env.MARKETLENS_GEMINI_MODEL || "gemini-3.1-flash-lite";
const geminiBaseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const timeoutMs = Number(process.env.MARKETLENS_LLM_TIMEOUT_MS ?? 30000);

function stripCodeFence(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function extractJsonCandidatesFromPayload(value, rows = []) {
  if (value == null) return rows;
  if (typeof value === "string") {
    rows.push(stripCodeFence(value));
    return rows;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractJsonCandidatesFromPayload(item, rows);
    return rows;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "text" || key === "output_text") {
        extractJsonCandidatesFromPayload(child, rows);
        continue;
      }
      extractJsonCandidatesFromPayload(child, rows);
    }
  }
  return rows;
}

function tryParseJsonCandidate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = stripCodeFence(value);
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseStructuredResponsePayload(payload) {
  const candidates = extractJsonCandidatesFromPayload(payload, []);
  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

async function main() {
  if (!geminiApiKey) {
    console.error("gemini smoke failed: missing GEMINI_API_KEY");
    process.exitCode = 1;
    return;
  }

  const payload = {
    systemInstruction: {
      parts: [
        {
          text: [
            "Return JSON only.",
            "No markdown, no prose.",
            'Schema: {"ok":boolean,"message":string,"basedOn":[string]}.',
          ].join(" "),
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Respond with a tiny JSON object confirming the smoke test is working.",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${geminiBaseUrl}/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`gemini smoke failed: status=${response.status} model=${geminiModel} ${errorText.slice(0, 240)}`);
      process.exitCode = 1;
      return;
    }

    const data = await response.json();
    const parsed = parseStructuredResponsePayload(data);
    if (!parsed || typeof parsed !== "object") {
      console.error(`gemini smoke failed: parse_failure model=${geminiModel}`);
      process.exitCode = 1;
      return;
    }

    console.log("gemini smoke ok");
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error(`gemini smoke failed: timeout model=${geminiModel}`);
      process.exitCode = 1;
      return;
    }
    console.error(`gemini smoke failed: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

await main();
