#!/usr/bin/env bash
set -euo pipefail

# Mini phase 2B local builder for upstream ggml-org/llama.cpp arm64 artifacts (CPU + Vulkan).

LLAMA_REF="${LLAMA_REF:-b8419}"
VARIANT="${1:-cpu}"   # cpu | vulkan
JOBS="${JOBS:-2}"
WORKDIR="${WORKDIR:-/tmp/llama-org-phase2b}"

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
  [[ -f /usr/include/vulkan/vulkan.h ]] || { echo "Vulkan headers missing. Install libvulkan-dev." >&2; exit 1; }
  need_cmd glslc
fi

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "[phase2b] cloning ggml-org/llama.cpp ref=$LLAMA_REF"
git clone --depth 1 --branch "$LLAMA_REF" https://github.com/ggml-org/llama.cpp.git src
cd src

echo "[phase2b] configuring variant=$VARIANT"
CMAKE_ARGS=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DGGML_NATIVE=OFF
  -DLLAMA_CURL=OFF
  -DLLAMA_BUILD_SERVER=ON
  -DLLAMA_BUILD_TOOLS=ON
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

echo "[phase2b] building llama-server"
cmake --build build --target llama-server -j "$JOBS"

OUT="${WORKDIR}/out/llama-org-${LLAMA_REF}-linux-arm64-${VARIANT}"
mkdir -p "$OUT"
cp -f build/bin/llama-server "$OUT/"
for f in build/bin/libllama.so* build/bin/libggml*.so* build/bin/libggml-*.so* build/bin/libmtmd.so*; do
  [[ -e "$f" ]] && cp -f "$f" "$OUT/"
done

TAR="${WORKDIR}/llama-org-${LLAMA_REF}-linux-arm64-${VARIANT}.tar.gz"
tar -czf "$TAR" -C "$OUT" .
sha256sum "$TAR" | tee "${TAR}.sha256"
sha256sum "$OUT/llama-server" | tee "${WORKDIR}/llama-org-${LLAMA_REF}-linux-arm64-${VARIANT}-llama-server.sha256"

echo "[phase2b] done"
echo "  tarball: $TAR"
echo "  folder:  $OUT"
