#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8104}"
STT_PORT="${STT_PORT:-18777}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STT_SCRIPT="$ROOT_DIR/scripts/stt_http_server.py"
STT_PY="/root/.openclaw/workspace/.venv-stt/bin/python"
STT_LOG="/tmp/stt_http_server.log"

stt_health_ok() {
  curl -fsS --max-time 2 "http://127.0.0.1:${STT_PORT}/health" >/dev/null 2>&1
}

start_stt_if_needed() {
  [[ -f "$STT_SCRIPT" ]] || return 0
  [[ -x "$STT_PY" ]] || return 0

  if stt_health_ok; then
    echo "[serve] STT sidecar already healthy on :${STT_PORT}"
    return 0
  fi

  # stale process cleanup (if any)
  pkill -f "[s]tt_http_server.py" >/dev/null 2>&1 || true

  echo "[serve] Starting STT sidecar on :${STT_PORT}"
  nohup "$STT_PY" "$STT_SCRIPT" >"$STT_LOG" 2>&1 &

  for _ in {1..20}; do
    if stt_health_ok; then
      echo "[serve] STT sidecar ready on :${STT_PORT}"
      return 0
    fi
    sleep 0.25
  done

  echo "[serve] WARNING: STT sidecar did not become healthy; voice fallback may fail." >&2
}

start_stt_if_needed
python3 -m http.server "$PORT"
