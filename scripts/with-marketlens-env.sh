#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${MARKETLENS_ENV_FILE:-$HOME/.marketlens.env}"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

needs_login_env() {
  [[ -z "${GEMINI_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if needs_login_env && [[ "${MARKETLENS_ENV_REEXECED:-0}" != "1" ]] && command -v zsh >/dev/null 2>&1; then
  printf -v REEXEC_CMD '%q ' "$SCRIPT_PATH" "$@"
  printf -v ENV_FILE_Q '%q' "$ENV_FILE"
  printf -v PWD_Q '%q' "$PWD"
  exec zsh -lic "export MARKETLENS_ENV_REEXECED=1; export MARKETLENS_ENV_FILE=$ENV_FILE_Q; cd $PWD_Q; $REEXEC_CMD"
fi

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 1
fi

exec "$@"
