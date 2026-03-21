#!/usr/bin/env bash
set -euo pipefail

# Mini phase 2A local builder for qvac arm64 artifacts (CPU + Vulkan).
# Intended for native Linux arm64 host (or self-hosted runner equivalent).

QVAC_REF="${QVAC_REF:-b7336}"
VARIANT="${1:-cpu}"   # cpu | vulkan
JOBS="${JOBS:-2}"
WORKDIR="${WORKDIR:-/tmp/qvac-phase2a}"

case "$VARIANT" in
  cpu|vulkan) ;;
  *)
    echo "Usage: $0 [cpu|vulkan]"
    exit 1
    ;;
esac

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

for c in git cmake ninja tar sha256sum; do need_cmd "$c"; done

if [[ "$VARIANT" == "vulkan" ]]; then
  if [[ ! -f /usr/include/vulkan/vulkan.h ]]; then
    echo "Vulkan headers missing. Install libvulkan-dev." >&2
    exit 1
  fi
  need_cmd glslc
fi

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "[phase2a] cloning qvac ref=$QVAC_REF"
git clone --depth 1 --branch "$QVAC_REF" https://github.com/tetherto/qvac-fabric-llm.cpp.git src
cd src

echo "[phase2a] configuring variant=$VARIANT"
CMAKE_ARGS=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DGGML_NATIVE=OFF
  -DLLAMA_CURL=OFF
  -DLLAMA_BUILD_SERVER=ON
  -DLLAMA_BUILD_TOOLS=ON
  -DLLAMA_MTMD=ON
  -DLLAMA_BUILD_EXAMPLES=OFF
  -DLLAMA_BUILD_TESTS=OFF
)

if [[ "$VARIANT" == "vulkan" ]]; then
  CMAKE_ARGS+=( -DGGML_VULKAN=ON )
else
  CMAKE_ARGS+=( -DGGML_VULKAN=OFF )
fi

PATH=/usr/bin:/usr/local/bin:/bin CC=/usr/bin/gcc CXX=/usr/bin/g++ \
  cmake -S . -B build "${CMAKE_ARGS[@]}"

echo "[phase2a] building llama-server"
cmake --build build --target llama-server -j "$JOBS"

OUT="${WORKDIR}/out/qvac-${QVAC_REF}-linux-arm64-${VARIANT}"
mkdir -p "$OUT"
cp -f build/bin/llama-server "$OUT/"
for f in build/bin/libllama.so* build/bin/libggml*.so* build/bin/libggml-*.so*; do
  [[ -e "$f" ]] && cp -f "$f" "$OUT/"
done

TAR="${WORKDIR}/qvac-${QVAC_REF}-linux-arm64-${VARIANT}.tar.gz"
tar -czf "$TAR" -C "$OUT" .
sha256sum "$TAR" | tee "${TAR}.sha256"
sha256sum "$OUT/llama-server" | tee "${WORKDIR}/qvac-${QVAC_REF}-linux-arm64-${VARIANT}-llama-server.sha256"

echo "[phase2a] done"
echo "  tarball: $TAR"
echo "  folder:  $OUT"
