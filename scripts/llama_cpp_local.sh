#!/usr/bin/env bash
set -euo pipefail

HOST="${LLAMA_CPP_HOST:-127.0.0.1}"
CTX_SIZE="${LLAMA_CPP_CTX:-4096}"
THREADS="${LLAMA_CPP_THREADS:-$(nproc)}"
RUN_TMP_BASE="/data/data/com.termux/files/usr/tmp"
if [[ -n "${TMPDIR:-}" ]]; then
  mkdir -p "$TMPDIR" 2>/dev/null || true
  if [[ -w "$TMPDIR" ]]; then
    RUN_TMP_BASE="$TMPDIR"
  fi
fi
if [[ ! -w "$RUN_TMP_BASE" ]]; then
  RUN_TMP_BASE="/tmp"
fi
if [[ ! -w "$RUN_TMP_BASE" ]]; then
  RUN_TMP_BASE="$(pwd)/.tmp"
fi
mkdir -p "$RUN_TMP_BASE" 2>/dev/null || true
RUN_DIR="${LLAMA_CPP_RUN_DIR:-$RUN_TMP_BASE/openclaw-steve-chat-llama}"

SEARCH_DIRS=(
  "/storage/emulated/0/OpenClawHub/models"
  "/root/.openclaw/models"
  "/root/.openclaw/workspace"
)

ACTION="${1:-}"; shift || true
BACKEND="${LLAMA_BACKEND:-regular}"
MODE="${LLAMA_MODE:-gpu}"
MODEL_PATH=""
MODEL_INDEX=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)
      BACKEND="${2:-}"
      shift 2
      ;;
    --model)
      MODEL_PATH="${2:-}"
      shift 2
      ;;
    --index)
      MODEL_INDEX="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      ACTION="help"
      break
      ;;
  esac
done

find_qvac_bin() {
  local candidates=(
    "$(command -v qvac-llama-server 2>/dev/null || true)"
    "$(command -v qvac-fabric-llama-server 2>/dev/null || true)"
    "$(command -v fabric-llama-server 2>/dev/null || true)"
    "/root/.openclaw/workspace/qvac-fabric-llm.cpp/build-vulkan-gcc/bin/llama-server"
    "/root/.openclaw/workspace/qvac-fabric-llm.cpp/build/bin/llama-server"
    "/root/.openclaw/workspace/qvac-fabric-llm.cpp/build-vulkan/bin/llama-server"
  )

  local c
  for c in "${candidates[@]}"; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return 0; }
  done

  return 1
}

case "$BACKEND" in
  regular)
    BIN="${LLAMA_CPP_BIN:-$(command -v llama-server || true)}"
    PORT="${LLAMA_CPP_PORT:-18080}"
    BACKEND_LABEL="regular"
    N_GPU_LAYERS_DEFAULT="${LLAMA_CPP_N_GPU_LAYERS:-99}"
    ;;
  qvac)
    BIN="${QVAC_LLAMA_BIN:-$(find_qvac_bin || true)}"
    PORT="${QVAC_LLAMA_PORT:-18081}"
    BACKEND_LABEL="qvac"
    N_GPU_LAYERS_DEFAULT="${QVAC_N_GPU_LAYERS:-99}"
    ;;
  *)
    echo "[llama-cpp] ERROR: unknown backend '$BACKEND' (expected regular|qvac)" >&2
    exit 1
    ;;
esac

N_GPU_LAYERS="$N_GPU_LAYERS_DEFAULT"
DEVICE_ARGS=()

case "$MODE" in
  cpu)
    N_GPU_LAYERS=0
    DEVICE_ARGS=(--device none)
    ;;
  gpu)
    ;;
  auto)
    ;;
  *)
    echo "[llama-cpp] ERROR: unknown mode '$MODE' (expected cpu|gpu|auto)" >&2
    exit 1
    ;;
esac

PID_FILE="$RUN_DIR/${BACKEND_LABEL}-llama-server-$PORT.pid"
LOG_FILE="$RUN_DIR/${BACKEND_LABEL}-llama-server-$PORT.log"
MODEL_FILE="$RUN_DIR/${BACKEND_LABEL}-model-$PORT.path"
MODE_FILE="$RUN_DIR/${BACKEND_LABEL}-mode-$PORT.txt"
NGL_FILE="$RUN_DIR/${BACKEND_LABEL}-ngl-$PORT.txt"
BIN_FILE="$RUN_DIR/${BACKEND_LABEL}-bin-$PORT.path"
REASONING_FILE="$RUN_DIR/${BACKEND_LABEL}-reasoning-format-$PORT.txt"
REASONING_BUDGET_FILE="$RUN_DIR/${BACKEND_LABEL}-reasoning-budget-$PORT.txt"
EMBEDDINGS_FILE="$RUN_DIR/${BACKEND_LABEL}-embeddings-$PORT.txt"
POOLING_FILE="$RUN_DIR/${BACKEND_LABEL}-pooling-$PORT.txt"
LEGACY_PID_FILE=""
LEGACY_MODEL_FILE=""

if [[ "$BACKEND_LABEL" == "regular" ]]; then
  LEGACY_PID_FILE="$RUN_DIR/llama-server-$PORT.pid"
  LEGACY_MODEL_FILE="$RUN_DIR/model-$PORT.path"
fi

mkdir -p "$RUN_DIR"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <action> [--backend regular|qvac] [--mode cpu|gpu|auto] [--model /path/model.gguf] [--index N]

Actions:
  list-models
  status
  stop
  start
  restart

Backend defaults:
  regular -> llama-server on port 18080
  qvac    -> qvac/fabric llama server on port 18081

Env overrides:
  LLAMA_CPP_BIN, LLAMA_CPP_PORT, LLAMA_CPP_N_GPU_LAYERS
  QVAC_LLAMA_BIN, QVAC_LLAMA_PORT, QVAC_N_GPU_LAYERS
  LLAMA_CPP_HOST, LLAMA_CPP_CTX, LLAMA_CPP_THREADS
  LLAMA_REASONING_ENABLE (default 1), LLAMA_REASONING_FORMAT (default deepseek-legacy), LLAMA_REASONING_BUDGET (default -1)
  LLAMA_EMBEDDINGS_ENABLE (default qvac=1 regular=0), LLAMA_EMBEDDINGS_POOLING (default mean)

Examples:
  $(basename "$0") list-models
  $(basename "$0") start --backend regular --mode gpu --index 1
  $(basename "$0") start --backend regular --mode cpu --index 1
  $(basename "$0") restart --backend qvac --mode gpu --index 2
EOF
}

require_bin() {
  if [[ -z "$BIN" || ! -x "$BIN" ]]; then
    if [[ "$BACKEND" == "qvac" ]]; then
      echo "[llama-cpp] ERROR: qvac backend binary not found." >&2
      echo "Set QVAC_LLAMA_BIN to your qvac fabric llama-server binary path." >&2
    else
      echo "[llama-cpp] ERROR: regular llama-server binary not found." >&2
      echo "Install from https://github.com/ggml-org/llama.cpp or set LLAMA_CPP_BIN." >&2
    fi
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

find_pid_by_port() {
  ss -ltnp "sport = :$PORT" 2>/dev/null | awk -F'pid=' '/pid=/{split($2,a,","); print a[1]; exit}'
}

is_running() {
  local pid

  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi

  if [[ -n "$LEGACY_PID_FILE" && -f "$LEGACY_PID_FILE" ]]; then
    pid="$(cat "$LEGACY_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi

  local pid_by_port
  pid_by_port="$(find_pid_by_port || true)"
  [[ -n "$pid_by_port" ]]
}

status() {
  local pid model source="pid-file"
  local run_mode run_ngl run_bin run_reasoning run_reasoning_budget run_embeddings run_pooling

  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" || true)"
  fi

  if [[ -z "${pid:-}" ]] || ! kill -0 "$pid" 2>/dev/null; then
    if [[ -n "$LEGACY_PID_FILE" && -f "$LEGACY_PID_FILE" ]]; then
      pid="$(cat "$LEGACY_PID_FILE" || true)"
      source="legacy-pid-file"
    fi
  fi

  if [[ -z "${pid:-}" ]] || ! kill -0 "$pid" 2>/dev/null; then
    pid="$(find_pid_by_port || true)"
    source="port-scan"
  fi

  if [[ -n "${pid:-}" ]]; then
    model="$(cat "$MODEL_FILE" 2>/dev/null || true)"
    if [[ -z "$model" && -n "$LEGACY_MODEL_FILE" ]]; then
      model="$(cat "$LEGACY_MODEL_FILE" 2>/dev/null || true)"
    fi
    echo "[llama-cpp] running"
    echo "  backend: $BACKEND_LABEL"
    echo "  pid:     $pid ($source)"
    echo "  host:    $HOST"
    echo "  port:    $PORT"
    run_mode="$(cat "$MODE_FILE" 2>/dev/null || true)"
    run_ngl="$(cat "$NGL_FILE" 2>/dev/null || true)"
    run_bin="$(cat "$BIN_FILE" 2>/dev/null || true)"
    run_reasoning="$(cat "$REASONING_FILE" 2>/dev/null || true)"
    run_reasoning_budget="$(cat "$REASONING_BUDGET_FILE" 2>/dev/null || true)"
    run_embeddings="$(cat "$EMBEDDINGS_FILE" 2>/dev/null || true)"
    run_pooling="$(cat "$POOLING_FILE" 2>/dev/null || true)"

    echo "  mode:    ${run_mode:-$MODE}"
    echo "  ngl:     ${run_ngl:-$N_GPU_LAYERS}"
    [[ -n "$run_reasoning" ]] && echo "  reasoning_format: ${run_reasoning}"
    [[ -n "$run_reasoning_budget" ]] && echo "  reasoning_budget: ${run_reasoning_budget}"
    [[ -n "$run_embeddings" ]] && echo "  embeddings: ${run_embeddings}"
    [[ -n "$run_pooling" ]] && echo "  pooling: ${run_pooling}"
    [[ -n "$run_bin" ]] && echo "  bin:     $run_bin"
    [[ -n "$model" ]] && echo "  model:   $model"
    echo "  log:     $LOG_FILE"
  else
    echo "[llama-cpp] stopped ($BACKEND_LABEL)"
    return 1
  fi
}

wait_ready() {
  local tries=90
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
  local model_alias
  model_alias="${LLAMA_MODEL_ALIAS:-$(basename "$model_path") }"
  model_alias="${model_alias%% }"
  model_alias="${model_alias%.gguf}"

  if is_running; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || find_pid_by_port || true)"
    echo "[llama-cpp] already running (backend=$BACKEND_LABEL pid ${existing_pid:-unknown}); stopping first..."
    stop
  fi

  echo "$model_path" > "$MODEL_FILE"
  echo "$MODE" > "$MODE_FILE"
  echo "$N_GPU_LAYERS" > "$NGL_FILE"
  echo "$BIN" > "$BIN_FILE"
  if [[ -n "$LEGACY_MODEL_FILE" ]]; then
    echo "$model_path" > "$LEGACY_MODEL_FILE"
  fi

  local reasoning_enable reasoning_format reasoning_budget bin_help
  local embeddings_enable embedding_pooling
  local -a reasoning_args=()
  local -a alias_args=()
  local -a embedding_args=()
  reasoning_enable="${LLAMA_REASONING_ENABLE:-1}"
  reasoning_format="${LLAMA_REASONING_FORMAT:-deepseek-legacy}"
  reasoning_budget="${LLAMA_REASONING_BUDGET:--1}"
  if [[ "$BACKEND_LABEL" == "qvac" ]]; then
    embeddings_enable="${LLAMA_EMBEDDINGS_ENABLE:-1}"
  else
    embeddings_enable="${LLAMA_EMBEDDINGS_ENABLE:-0}"
  fi
  embedding_pooling="${LLAMA_EMBEDDINGS_POOLING:-mean}"
  echo "disabled" > "$REASONING_FILE"
  echo "" > "$REASONING_BUDGET_FILE"
  echo "disabled" > "$EMBEDDINGS_FILE"
  echo "" > "$POOLING_FILE"

  if [[ "$reasoning_enable" != "0" ]]; then
    bin_help="$($BIN --help 2>/dev/null || true)"

    if grep -q -- "--reasoning-format" <<<"$bin_help"; then
      reasoning_args+=(--reasoning-format "$reasoning_format")
      echo "$reasoning_format" > "$REASONING_FILE"
    else
      echo "unsupported" > "$REASONING_FILE"
      echo "[llama-cpp] NOTE: this server build does not expose --reasoning-format; continuing without explicit reasoning flag."
    fi

    if grep -q -- "--reasoning-budget" <<<"$bin_help"; then
      reasoning_args+=(--reasoning-budget "$reasoning_budget")
      echo "$reasoning_budget" > "$REASONING_BUDGET_FILE"
    fi
  fi

  if [[ -z "$bin_help" ]]; then
    bin_help="$($BIN --help 2>/dev/null || true)"
  fi

  if [[ "$embeddings_enable" != "0" ]]; then
    if grep -Eq -- "--embedding, --embeddings|--embeddings" <<<"$bin_help"; then
      embedding_args+=(--embeddings)
      echo "enabled" > "$EMBEDDINGS_FILE"

      if grep -q -- "--pooling" <<<"$bin_help"; then
        embedding_args+=(--pooling "$embedding_pooling")
        echo "$embedding_pooling" > "$POOLING_FILE"
      fi
    else
      echo "unsupported" > "$EMBEDDINGS_FILE"
      echo "[llama-cpp] NOTE: this server build does not expose --embeddings; continuing without embeddings endpoint."
    fi
  fi

  if grep -q -- "--alias" <<<"$bin_help"; then
    alias_args+=(--alias "$model_alias")
  fi

  echo "[llama-cpp] starting server"
  echo "  backend: $BACKEND_LABEL"
  echo "  bin:     $BIN"
  echo "  host:    $HOST"
  echo "  port:    $PORT"
  echo "  mode:    $MODE"
  echo "  ngl:     $N_GPU_LAYERS"
  [[ -s "$REASONING_FILE" ]] && echo "  reasoning_format: $(cat "$REASONING_FILE")"
  [[ -s "$REASONING_BUDGET_FILE" ]] && echo "  reasoning_budget: $(cat "$REASONING_BUDGET_FILE")"
  [[ -s "$EMBEDDINGS_FILE" ]] && echo "  embeddings: $(cat "$EMBEDDINGS_FILE")"
  [[ -s "$POOLING_FILE" ]] && echo "  pooling: $(cat "$POOLING_FILE")"
  echo "  model:   $model_path"
  [[ ${#alias_args[@]} -gt 0 ]] && echo "  alias:   $model_alias"

  local bin_dir ld_library_path unresolved
  bin_dir="$(dirname "$BIN")"
  ld_library_path="${LD_LIBRARY_PATH:-}"
  if [[ -n "$bin_dir" && -d "$bin_dir" ]]; then
    if [[ -n "$ld_library_path" ]]; then
      ld_library_path="$bin_dir:$ld_library_path"
    else
      ld_library_path="$bin_dir"
    fi
  fi

  if command -v ldd >/dev/null 2>&1; then
    # ldd exits non-zero for scripts/wrappers; tolerate that and only fail on actual missing libs.
    unresolved="$(LD_LIBRARY_PATH="$ld_library_path" ldd "$BIN" 2>/dev/null | awk '/=> not found/{print $1}' || true)"
    if [[ -n "$unresolved" ]]; then
      echo "[llama-cpp] ERROR: unresolved shared libs for $BIN" >&2
      echo "$unresolved" | sed 's/^/  - /' >&2
      echo "Tip: ensure bundled libs are present beside the binary (including libmtmd.so*), or set LD_LIBRARY_PATH." >&2
      exit 1
    fi
  fi

  nohup env LD_LIBRARY_PATH="$ld_library_path" "$BIN" \
    --host "$HOST" \
    --port "$PORT" \
    --model "$model_path" \
    "${alias_args[@]}" \
    --ctx-size "$CTX_SIZE" \
    --threads "$THREADS" \
    --n-gpu-layers "$N_GPU_LAYERS" \
    "${DEVICE_ARGS[@]}" \
    "${reasoning_args[@]}" \
    "${embedding_args[@]}" \
    --jinja \
    > "$LOG_FILE" 2>&1 &

  local pid=$!
  echo "$pid" > "$PID_FILE"
  if [[ -n "$LEGACY_PID_FILE" ]]; then
    echo "$pid" > "$LEGACY_PID_FILE"
  fi

  if wait_ready; then
    echo "[llama-cpp] ready at http://$HOST:$PORT ($BACKEND_LABEL)"

    if grep -Eqi 'no usable GPU found|compiled without GPU support|gpu-layers option will be ignored' "$LOG_FILE"; then
      echo "[llama-cpp] NOTE: GPU offload not active; this backend is running CPU-only on current binary."
    fi

    curl -fsS "http://$HOST:$PORT/v1/models" | sed -n '1,80p'
  else
    echo "[llama-cpp] ERROR: server did not become ready. See $LOG_FILE" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    exit 1
  fi
}

stop() {
  if ! is_running; then
    echo "[llama-cpp] already stopped ($BACKEND_LABEL)"
    rm -f "$PID_FILE" "$MODE_FILE" "$NGL_FILE" "$BIN_FILE" "$REASONING_FILE" "$REASONING_BUDGET_FILE" "$EMBEDDINGS_FILE" "$POOLING_FILE"
    if [[ -n "$LEGACY_PID_FILE" ]]; then
      rm -f "$LEGACY_PID_FILE"
    fi
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    pid="$(find_pid_by_port || true)"
  fi

  if [[ -z "$pid" ]]; then
    echo "[llama-cpp] could not resolve pid for backend=$BACKEND_LABEL (port $PORT)"
    rm -f "$PID_FILE" "$MODE_FILE" "$NGL_FILE" "$BIN_FILE" "$REASONING_FILE" "$REASONING_BUDGET_FILE" "$EMBEDDINGS_FILE" "$POOLING_FILE"
    return 1
  fi

  echo "[llama-cpp] stopping backend=$BACKEND_LABEL pid $pid"
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

  rm -f "$PID_FILE" "$MODE_FILE" "$NGL_FILE" "$BIN_FILE" "$REASONING_FILE" "$REASONING_BUDGET_FILE" "$EMBEDDINGS_FILE" "$POOLING_FILE"
  if [[ -n "$LEGACY_PID_FILE" ]]; then
    rm -f "$LEGACY_PID_FILE"
  fi
}

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
  help|""|-h|--help)
    usage
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage
    exit 1
    ;;
esac
