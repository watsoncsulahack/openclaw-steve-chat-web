#!/usr/bin/env bash
set -euo pipefail

# Stop all known runtime servers, then start exactly one target.
# Prevents OOM from running multiple 3B/4B-model servers at once.

TARGET="${1:-}"
MODEL_INDEX="${MODEL_INDEX:-1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT_DIR/scripts/llama_cpp_local.sh"

REG_PREBUILT_BIN="${REG_PREBUILT_BIN:-/data/data/com.termux/files/usr/bin/llama-server}"
REG_CPU_BIN="${REG_CPU_BIN:-/tmp/llama-b8419/build-openclaw-cpu-nossl/bin/llama-server}"
REG_VK_BIN="${REG_VK_BIN:-/tmp/llama-org-phase2b/out/llama-org-b8419-linux-arm64-vulkan/llama-server}"
QVAC_CPU_BIN="${QVAC_CPU_BIN:-/data/data/com.termux/files/home/openclaw-binaries/qvac-run-23390877295/android-bionic-cpu/llama-server-wrapper.sh}"
QVAC_VK_BIN="${QVAC_VK_BIN:-/data/data/com.termux/files/home/openclaw-binaries/qvac-run-23392440400/android-bionic-vulkan/llama-server-wrapper.sh}"


GEMMA_E2B_PATH="${GEMMA_E2B_PATH:-/storage/emulated/0/OpenClawHub/models/gemma-3n-E2B-it-UD-Q4_K_XL.gguf}"
GEMMA_E4B_PATH="${GEMMA_E4B_PATH:-/storage/emulated/0/OpenClawHub/models/gemma-3n-E4B-it-UD-Q4_K_XL.gguf}"
EMBED_MODEL_PATH="${EMBED_MODEL_PATH:-/storage/emulated/0/OpenClawHub/models/nomic-embed-text-v1.5.Q4_K_M.gguf}"
EMBED_ENABLE="${EMBED_ENABLE:-1}"
EMBED_PORT="${EMBED_PORT:-18086}"
EMBED_MODE="${EMBED_MODE:-cpu}"
EMBED_CTX="${EMBED_CTX:-1024}"
EMBED_THREADS="${EMBED_THREADS:-2}"
EMBED_N_GPU_LAYERS="${EMBED_N_GPU_LAYERS:-0}"
EMBED_POOLING="${EMBED_POOLING:-mean}"

resolve_model_path() {
  local idx="$1"
  case "$idx" in
    1|3)
      echo "$GEMMA_E2B_PATH"
      ;;
    2|4)
      echo "$GEMMA_E4B_PATH"
      ;;
    *)
      # Default to E4B profile for unknown indexes.
      echo "$GEMMA_E4B_PATH"
      ;;
  esac
}

MODEL_PATH_OVERRIDE="${MODEL_PATH_OVERRIDE:-$(resolve_model_path "$MODEL_INDEX") }"
MODEL_PATH_OVERRIDE="${MODEL_PATH_OVERRIDE%% }"

if [[ ! -f "$MODEL_PATH_OVERRIDE" ]]; then
  echo "ERROR: selected model file not found: $MODEL_PATH_OVERRIDE" >&2
  exit 1
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") <target>

Targets:
  reg-prebuilt   # regular prebuilt on 18080 (gpu mode)
  reg-cpu        # regular cpu build on 18082 (cpu mode)
  reg-vulkan     # regular vulkan build on 18083 (gpu mode)
  qvac-cpu       # qvac cpu build on 18081 (cpu mode)
  qvac-vulkan    # qvac vulkan build on 18084 (gpu mode)

Example:
  ./scripts/switch_runtime_target.sh qvac-vulkan

Embedding sidecar defaults (qvac targets):
  EMBED_ENABLE=1
  EMBED_PORT=18086
  EMBED_MODEL_PATH=/storage/emulated/0/OpenClawHub/models/nomic-embed-text-v1.5.Q4_K_M.gguf
EOF
}

if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi

stop_all() {
  # regular ports
  env LLAMA_CPP_PORT=18080 bash "$LAUNCHER" stop --backend regular || true
  env LLAMA_CPP_PORT=18082 bash "$LAUNCHER" stop --backend regular || true
  env LLAMA_CPP_PORT=18083 bash "$LAUNCHER" stop --backend regular || true
  # qvac ports
  env QVAC_LLAMA_PORT=18081 bash "$LAUNCHER" stop --backend qvac || true
  env QVAC_LLAMA_PORT=18084 bash "$LAUNCHER" stop --backend qvac || true
  env QVAC_LLAMA_PORT="$EMBED_PORT" bash "$LAUNCHER" stop --backend qvac || true
}

need_bin() {
  local label="$1"
  local path="$2"
  [[ -x "$path" ]] || { echo "ERROR: missing $label binary: $path" >&2; exit 1; }
}

start_embedding_sidecar() {
  local embed_bin="$1"

  if [[ "$EMBED_ENABLE" == "0" ]]; then
    echo "Embedding sidecar disabled (EMBED_ENABLE=0)."
    return 0
  fi

  if [[ ! -f "$EMBED_MODEL_PATH" ]]; then
    echo "Embedding model not found (skipping sidecar): $EMBED_MODEL_PATH"
    return 0
  fi

  need_bin "embedding sidecar" "$embed_bin"

  echo "Starting embedding sidecar"
  echo "  port:  $EMBED_PORT"
  echo "  model: $EMBED_MODEL_PATH"
  echo "  mode:  $EMBED_MODE"

  env QVAC_LLAMA_BIN="$embed_bin" QVAC_LLAMA_PORT="$EMBED_PORT" \
    QVAC_N_GPU_LAYERS="$EMBED_N_GPU_LAYERS" LLAMA_CPP_CTX="$EMBED_CTX" LLAMA_CPP_THREADS="$EMBED_THREADS" \
    LLAMA_REASONING_ENABLE=0 LLAMA_EMBEDDINGS_ENABLE=1 LLAMA_EMBEDDINGS_POOLING="$EMBED_POOLING" \
    LLAMA_EXTRA_ARGS="--parallel 1 --no-cont-batching --ubatch-size 1024" \
    bash "$LAUNCHER" start --backend qvac --mode "$EMBED_MODE" --model "$EMBED_MODEL_PATH"
}

stop_all

echo "Using model path: $MODEL_PATH_OVERRIDE"

NEED_EMBED_SIDECAR=0
EMBED_BIN="$QVAC_VK_BIN"

case "$TARGET" in
  reg-prebuilt)
    need_bin "regular prebuilt" "$REG_PREBUILT_BIN"
    env LLAMA_CPP_BIN="$REG_PREBUILT_BIN" LLAMA_CPP_PORT=18080 \
      LLAMA_EMBEDDINGS_ENABLE="${LLAMA_EMBEDDINGS_ENABLE:-1}" LLAMA_EMBEDDINGS_POOLING="${LLAMA_EMBEDDINGS_POOLING:-mean}" \
      bash "$LAUNCHER" start --backend regular --mode gpu --model "$MODEL_PATH_OVERRIDE"
    ;;
  reg-cpu)
    need_bin "regular cpu" "$REG_CPU_BIN"
    env LLAMA_CPP_BIN="$REG_CPU_BIN" LLAMA_CPP_PORT=18082 \
      LLAMA_EMBEDDINGS_ENABLE="${LLAMA_EMBEDDINGS_ENABLE:-1}" LLAMA_EMBEDDINGS_POOLING="${LLAMA_EMBEDDINGS_POOLING:-mean}" \
      bash "$LAUNCHER" start --backend regular --mode cpu --model "$MODEL_PATH_OVERRIDE"
    ;;
  reg-vulkan)
    need_bin "regular vulkan" "$REG_VK_BIN"
    env LLAMA_CPP_BIN="$REG_VK_BIN" LLAMA_CPP_PORT=18083 \
      LLAMA_EMBEDDINGS_ENABLE="${LLAMA_EMBEDDINGS_ENABLE:-1}" LLAMA_EMBEDDINGS_POOLING="${LLAMA_EMBEDDINGS_POOLING:-mean}" \
      bash "$LAUNCHER" start --backend regular --mode gpu --model "$MODEL_PATH_OVERRIDE"
    ;;
  qvac-cpu)
    need_bin "qvac cpu" "$QVAC_CPU_BIN"
    env QVAC_LLAMA_BIN="$QVAC_CPU_BIN" QVAC_LLAMA_PORT=18081 \
      QVAC_N_GPU_LAYERS="${QVAC_N_GPU_LAYERS:-0}" LLAMA_CPP_CTX="${LLAMA_CPP_CTX:-2048}" LLAMA_CPP_THREADS="${LLAMA_CPP_THREADS:-3}" \
      LLAMA_EMBEDDINGS_ENABLE="${LLAMA_EMBEDDINGS_ENABLE:-1}" LLAMA_EMBEDDINGS_POOLING="${LLAMA_EMBEDDINGS_POOLING:-mean}" \
      bash "$LAUNCHER" start --backend qvac --mode cpu --model "$MODEL_PATH_OVERRIDE"
    NEED_EMBED_SIDECAR=1
    EMBED_BIN="$QVAC_CPU_BIN"
    ;;
  qvac-vulkan)
    need_bin "qvac vulkan" "$QVAC_VK_BIN"
    env QVAC_LLAMA_BIN="$QVAC_VK_BIN" QVAC_LLAMA_PORT=18084 \
      QVAC_N_GPU_LAYERS="${QVAC_N_GPU_LAYERS:-72}" LLAMA_CPP_CTX="${LLAMA_CPP_CTX:-2048}" LLAMA_CPP_THREADS="${LLAMA_CPP_THREADS:-3}" \
      LLAMA_EMBEDDINGS_ENABLE="${LLAMA_EMBEDDINGS_ENABLE:-1}" LLAMA_EMBEDDINGS_POOLING="${LLAMA_EMBEDDINGS_POOLING:-mean}" \
      bash "$LAUNCHER" start --backend qvac --mode gpu --model "$MODEL_PATH_OVERRIDE"
    NEED_EMBED_SIDECAR=1
    EMBED_BIN="$QVAC_VK_BIN"
    ;;
  *)
    usage
    exit 1
    ;;
esac

if [[ "$NEED_EMBED_SIDECAR" == "1" ]]; then
  start_embedding_sidecar "$EMBED_BIN"
fi

echo "\nActive endpoint(s):"
for p in 18080 18082 18083 18081 18084 "$EMBED_PORT"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${p}/v1/models" || true)"
  if [[ "$code" == "200" ]]; then
    echo "  - $p (OK)"
  fi
done
