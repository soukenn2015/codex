#!/usr/bin/env bash
set -euo pipefail

OUT_FILE="${MARKETLENS_ENV_FILE:-$HOME/.marketlens.env}"

if [[ -z "${GEMINI_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Neither GEMINI_API_KEY nor OPENAI_API_KEY is set in this shell." >&2
  echo "Run this from the terminal session where your API key is already exported." >&2
  exit 1
fi

{
  echo '#!/usr/bin/env bash'
  if [[ -n "${MARKETLENS_AI_PROVIDER:-}" ]]; then
    printf 'export MARKETLENS_AI_PROVIDER=%q\n' "$MARKETLENS_AI_PROVIDER"
  elif [[ -n "${GEMINI_API_KEY:-}" ]]; then
    printf 'export MARKETLENS_AI_PROVIDER=%q\n' "gemini"
  elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
    printf 'export MARKETLENS_AI_PROVIDER=%q\n' "openai"
  fi
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    printf 'export GEMINI_API_KEY=%q\n' "$GEMINI_API_KEY"
  fi
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    printf 'export OPENAI_API_KEY=%q\n' "$OPENAI_API_KEY"
  fi
  if [[ -n "${MARKETLENS_GEMINI_MODEL:-}" ]]; then
    printf 'export MARKETLENS_GEMINI_MODEL=%q\n' "$MARKETLENS_GEMINI_MODEL"
  fi
  if [[ -n "${MARKETLENS_GEMINI_FALLBACK_MODEL:-}" ]]; then
    printf 'export MARKETLENS_GEMINI_FALLBACK_MODEL=%q\n' "$MARKETLENS_GEMINI_FALLBACK_MODEL"
  fi
  if [[ -n "${MARKETLENS_LLM_TIMEOUT_MS:-}" ]]; then
    printf 'export MARKETLENS_LLM_TIMEOUT_MS=%q\n' "$MARKETLENS_LLM_TIMEOUT_MS"
  fi
  if [[ -n "${OPENAI_MODEL:-}" ]]; then
    printf 'export OPENAI_MODEL=%q\n' "$OPENAI_MODEL"
  fi
} > "$OUT_FILE"

chmod 600 "$OUT_FILE"
echo "Wrote $OUT_FILE"
