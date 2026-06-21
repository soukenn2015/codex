#!/usr/bin/env bash

# Copy to ~/.marketlens.env and replace placeholder values.

export MARKETLENS_AI_PROVIDER="gemini"
export GEMINI_API_KEY="replace-with-your-real-key"
export MARKETLENS_GEMINI_MODEL="gemini-3.1-flash-lite"
export MARKETLENS_GEMINI_FALLBACK_MODEL="gemini-2.5-flash"
export MARKETLENS_LLM_TIMEOUT_MS="30000"

# Optional:
# export OPENAI_API_KEY="replace-with-openai-key"
# export OPENAI_MODEL="gpt-5"
