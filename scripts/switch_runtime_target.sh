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
EOF
}

if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi

stop_all() {
  # regular ports
  env LLAMA_CPP_PORT=18080 "$LAUNCHER" stop --backend regular || true
  env LLAMA_CPP_PORT=18082 "$LAUNCHER" stop --backend regular || true
  env LLAMA_CPP_PORT=18083 "$LAUNCHER" stop --backend regular || true
  # qvac ports
  env QVAC_LLAMA_PORT=18081 "$LAUNCHER" stop --backend qvac || true
  env QVAC_LLAMA_PORT=18084 "$LAUNCHER" stop --backend qvac || true
}

need_bin() {
  local label="$1"
  local path="$2"
  [[ -x "$path" ]] || { echo "ERROR: missing $label binary: $path" >&2; exit 1; }
}

stop_all

case "$TARGET" in
  reg-prebuilt)
    need_bin "regular prebuilt" "$REG_PREBUILT_BIN"
    env LLAMA_CPP_BIN="$REG_PREBUILT_BIN" LLAMA_CPP_PORT=18080 \
      "$LAUNCHER" start --backend regular --mode gpu --index "$MODEL_INDEX"
    ;;
  reg-cpu)
    need_bin "regular cpu" "$REG_CPU_BIN"
    env LLAMA_CPP_BIN="$REG_CPU_BIN" LLAMA_CPP_PORT=18082 \
      "$LAUNCHER" start --backend regular --mode cpu --index "$MODEL_INDEX"
    ;;
  reg-vulkan)
    need_bin "regular vulkan" "$REG_VK_BIN"
    env LLAMA_CPP_BIN="$REG_VK_BIN" LLAMA_CPP_PORT=18083 \
      "$LAUNCHER" start --backend regular --mode gpu --index "$MODEL_INDEX"
    ;;
  qvac-cpu)
    need_bin "qvac cpu" "$QVAC_CPU_BIN"
    env QVAC_LLAMA_BIN="$QVAC_CPU_BIN" QVAC_LLAMA_PORT=18081 \
      QVAC_N_GPU_LAYERS="${QVAC_N_GPU_LAYERS:-0}" LLAMA_CPP_CTX="${LLAMA_CPP_CTX:-2048}" LLAMA_CPP_THREADS="${LLAMA_CPP_THREADS:-3}" \
      "$LAUNCHER" start --backend qvac --mode cpu --index "$MODEL_INDEX"
    ;;
  qvac-vulkan)
    need_bin "qvac vulkan" "$QVAC_VK_BIN"
    env QVAC_LLAMA_BIN="$QVAC_VK_BIN" QVAC_LLAMA_PORT=18084 \
      QVAC_N_GPU_LAYERS="${QVAC_N_GPU_LAYERS:-72}" LLAMA_CPP_CTX="${LLAMA_CPP_CTX:-2048}" LLAMA_CPP_THREADS="${LLAMA_CPP_THREADS:-3}" \
      "$LAUNCHER" start --backend qvac --mode gpu --index "$MODEL_INDEX"
    ;;
  *)
    usage
    exit 1
    ;;
esac

echo "\nActive endpoint(s):"
for p in 18080 18082 18083 18081 18084; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${p}/v1/models" || true)"
  if [[ "$code" == "200" ]]; then
    echo "  - $p (OK)"
  fi
done
