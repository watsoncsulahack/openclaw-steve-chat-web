#!/usr/bin/env bash
set -euo pipefail

BIN="${LLAMA_CPP_BIN:-$(command -v llama-server || true)}"
HOST="${LLAMA_CPP_HOST:-127.0.0.1}"
PORT="${LLAMA_CPP_PORT:-18080}"
CTX_SIZE="${LLAMA_CPP_CTX:-4096}"
THREADS="${LLAMA_CPP_THREADS:-$(nproc)}"
RUN_DIR="${LLAMA_CPP_RUN_DIR:-/tmp/openclaw-steve-chat-llama}"
PID_FILE="$RUN_DIR/llama-server-$PORT.pid"
LOG_FILE="$RUN_DIR/llama-server-$PORT.log"
MODEL_FILE="$RUN_DIR/model-$PORT.path"

SEARCH_DIRS=(
  "/storage/emulated/0/OpenClawHub/models"
  "/root/.openclaw/models"
  "/root/.openclaw/workspace"
)

mkdir -p "$RUN_DIR"

require_bin() {
  if [[ -z "$BIN" || ! -x "$BIN" ]]; then
    echo "[llama-cpp] ERROR: llama-server binary not found." >&2
    echo "Install from https://github.com/ggml-org/llama.cpp or set LLAMA_CPP_BIN." >&2
    exit 1
  fi
}

collect_models() {
  local dir
  for dir in "${SEARCH_DIRS[@]}"; do
    [[ -d "$dir" ]] || continue
    find "$dir" -maxdepth 5 -type f -iname '*.gguf' 2>/dev/null || true
  done | awk '!seen[$0]++' | sort
}

collect_candidate_models() {
  local filtered
  filtered="$(collect_models | grep -Eiv 'ggml-vocab|tokenizer|embed|embedding|bge|rerank' || true)"
  if [[ -n "$filtered" ]]; then
    printf "%s\n" "$filtered"
  else
    collect_models
  fi
}

list_models() {
  local i=0
  while IFS= read -r path; do
    i=$((i + 1))
    printf "%2d) %s\n" "$i" "$path"
  done < <(collect_candidate_models)

  if [[ "$i" -eq 0 ]]; then
    echo "[llama-cpp] No GGUF models found in configured search dirs." >&2
    return 1
  fi
}

pick_model() {
  local explicit="${1:-}"
  local index="${2:-}"

  if [[ -n "$explicit" ]]; then
    [[ -f "$explicit" ]] || {
      echo "[llama-cpp] ERROR: model path not found: $explicit" >&2
      exit 1
    }
    echo "$explicit"
    return
  fi

  mapfile -t models < <(collect_candidate_models)
  if [[ "${#models[@]}" -eq 0 ]]; then
    echo "[llama-cpp] ERROR: no GGUF models discovered." >&2
    exit 1
  fi

  if [[ -n "$index" ]]; then
    local idx=$((index - 1))
    if (( idx < 0 || idx >= ${#models[@]} )); then
      echo "[llama-cpp] ERROR: invalid model index: $index" >&2
      exit 1
    fi
    echo "${models[$idx]}"
    return
  fi

  local m
  for m in "${models[@]}"; do
    if [[ "$m" =~ [Gg]emma ]]; then
      echo "$m"
      return
    fi
  done

  echo "${models[0]}"
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

status() {
  if is_running; then
    local pid model
    pid="$(cat "$PID_FILE")"
    model="$(cat "$MODEL_FILE" 2>/dev/null || true)"
    echo "[llama-cpp] running"
    echo "  pid:   $pid"
    echo "  host:  $HOST"
    echo "  port:  $PORT"
    [[ -n "$model" ]] && echo "  model: $model"
    echo "  log:   $LOG_FILE"
  else
    echo "[llama-cpp] stopped"
    return 1
  fi
}

wait_ready() {
  local tries=60
  local url="http://$HOST:$PORT/v1/models"
  while (( tries > 0 )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    tries=$((tries - 1))
  done
  return 1
}

start() {
  require_bin

  local model_path="$1"

  if is_running; then
    echo "[llama-cpp] already running (pid $(cat "$PID_FILE")); stopping first..."
    stop
  fi

  echo "$model_path" > "$MODEL_FILE"
  echo "[llama-cpp] starting llama-server"
  echo "  bin:   $BIN"
  echo "  host:  $HOST"
  echo "  port:  $PORT"
  echo "  model: $model_path"

  nohup "$BIN" \
    --host "$HOST" \
    --port "$PORT" \
    --model "$model_path" \
    --ctx-size "$CTX_SIZE" \
    --threads "$THREADS" \
    --jinja \
    > "$LOG_FILE" 2>&1 &

  local pid=$!
  echo "$pid" > "$PID_FILE"

  if wait_ready; then
    echo "[llama-cpp] ready at http://$HOST:$PORT"
    curl -fsS "http://$HOST:$PORT/v1/models" | sed -n '1,80p'
  else
    echo "[llama-cpp] ERROR: server did not become ready. See $LOG_FILE" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    exit 1
  fi
}

stop() {
  if ! is_running; then
    echo "[llama-cpp] already stopped"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  echo "[llama-cpp] stopping pid $pid"
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if kill -0 "$pid" 2>/dev/null; then
      sleep 0.25
    else
      break
    fi
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
}

usage() {
  cat <<EOF
Usage:
  $(basename "$0") list-models
  $(basename "$0") status
  $(basename "$0") stop
  $(basename "$0") start [--model /path/to/model.gguf] [--index N]
  $(basename "$0") restart [--model /path/to/model.gguf] [--index N]

Notes:
  - Defaults to llama-server discovered on PATH.
  - Defaults to port 18080 (same as Steve Chat local runtime default).
  - Model auto-picks first Gemma GGUF if no --model/--index is supplied.
EOF
}

ACTION="${1:-}"; shift || true
MODEL_PATH=""
MODEL_INDEX=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL_PATH="${2:-}"
      shift 2
      ;;
    --index)
      MODEL_INDEX="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$ACTION" in
  list-models)
    list_models
    ;;
  status)
    status
    ;;
  stop)
    stop
    ;;
  start)
    start "$(pick_model "$MODEL_PATH" "$MODEL_INDEX")"
    ;;
  restart)
    stop
    start "$(pick_model "$MODEL_PATH" "$MODEL_INDEX")"
    ;;
  *)
    usage
    exit 1
    ;;
esac
