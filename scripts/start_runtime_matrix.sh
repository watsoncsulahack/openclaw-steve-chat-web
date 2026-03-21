#!/usr/bin/env bash
set -euo pipefail

# Launch all Steve Chat runtime endpoints for side-by-side testing.
# Ports:
#   regular prebuilt  -> 18080 (GPU-capable attempt)
#   regular cpu build -> 18082 (CPU)
#   regular vulkan    -> 18083 (GPU)
#   qvac cpu          -> 18081 (CPU)
#   qvac vulkan       -> 18084 (GPU)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT_DIR/scripts/llama_cpp_local.sh"
MODEL_INDEX="${MODEL_INDEX:-1}"

REG_PREBUILT_BIN="${REG_PREBUILT_BIN:-/usr/bin/llama-server}"
REG_CPU_BIN="${REG_CPU_BIN:-/tmp/llama-b8419/build-openclaw-cpu-nossl/bin/llama-server}"
REG_VK_BIN="${REG_VK_BIN:-/tmp/llama-org-phase2b/out/llama-org-b8419-linux-arm64-vulkan/llama-server}"
QVAC_CPU_BIN="${QVAC_CPU_BIN:-/root/.openclaw/workspace/artifacts/qvac-mini-phase2a-run-23376507332/qvac-cpu/llama-server}"
QVAC_VK_BIN="${QVAC_VK_BIN:-/root/.openclaw/workspace/qvac-fabric-llm.cpp/build-vulkan-gcc/bin/llama-server}"

need_bin() {
  local label="$1"
  local path="$2"
  if [[ ! -x "$path" ]]; then
    echo "[runtime-matrix] ERROR: missing $label binary: $path" >&2
    exit 1
  fi
}

need_bin "regular prebuilt" "$REG_PREBUILT_BIN"
need_bin "regular cpu" "$REG_CPU_BIN"
need_bin "regular vulkan" "$REG_VK_BIN"
need_bin "qvac cpu" "$QVAC_CPU_BIN"
need_bin "qvac vulkan" "$QVAC_VK_BIN"

run_start() {
  local name="$1"; shift
  echo "[runtime-matrix] starting $name"
  "$@"
}

run_start "regular prebuilt (18080, gpu mode)" \
  env LLAMA_CPP_BIN="$REG_PREBUILT_BIN" LLAMA_CPP_PORT=18080 \
  "$LAUNCHER" restart --backend regular --mode gpu --index "$MODEL_INDEX"

run_start "regular cpu (18082, cpu mode)" \
  env LLAMA_CPP_BIN="$REG_CPU_BIN" LLAMA_CPP_PORT=18082 \
  "$LAUNCHER" restart --backend regular --mode cpu --index "$MODEL_INDEX"

run_start "regular vulkan (18083, gpu mode)" \
  env LLAMA_CPP_BIN="$REG_VK_BIN" LLAMA_CPP_PORT=18083 \
  "$LAUNCHER" restart --backend regular --mode gpu --index "$MODEL_INDEX"

run_start "qvac cpu (18081, cpu mode)" \
  env QVAC_LLAMA_BIN="$QVAC_CPU_BIN" QVAC_LLAMA_PORT=18081 \
  "$LAUNCHER" restart --backend qvac --mode cpu --index "$MODEL_INDEX"

run_start "qvac vulkan (18084, gpu mode)" \
  env QVAC_LLAMA_BIN="$QVAC_VK_BIN" QVAC_LLAMA_PORT=18084 \
  "$LAUNCHER" restart --backend qvac --mode gpu --index "$MODEL_INDEX"

echo "[runtime-matrix] all endpoints attempted."
for port in 18080 18082 18083 18081 18084; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/v1/models" || true)"
  echo "  - $port -> HTTP ${code:-000}"
done
