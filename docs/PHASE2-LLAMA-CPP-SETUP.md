# Phase 2 Start: Local llama.cpp endpoint wiring

This project is wired to use local OpenAI-compatible endpoints:

- Regular llama.cpp (prebuilt): `http://127.0.0.1:18080`
- Regular llama.cpp (local CPU build): `http://127.0.0.1:18082`
- Regular llama.cpp (local Vulkan build): `http://127.0.0.1:18083`
- QVAC CPU build: `http://127.0.0.1:18081`
- QVAC Vulkan build: `http://127.0.0.1:18084`

`llama-server` (from `ggml-org/llama.cpp`) is already available on this host at:

- `/usr/bin/llama-server`

Gemma models discovered on device:

- `/storage/emulated/0/OpenClawHub/models/gemma-3n-E2B-it-UD-Q4_K_XL.gguf`
- `/storage/emulated/0/OpenClawHub/models/gemma-3n-E4B-it-UD-Q4_K_XL.gguf`

## Helper script

Use:

- `scripts/llama_cpp_local.sh list-models`
- `scripts/llama_cpp_local.sh start --backend regular --mode gpu --index 1`
- `scripts/llama_cpp_local.sh start --backend regular --mode cpu --index 1`
- `scripts/llama_cpp_local.sh restart --backend regular --mode gpu --index 2`
- `scripts/llama_cpp_local.sh start --backend qvac --mode gpu --index 1`
- `scripts/llama_cpp_local.sh start --backend qvac --mode cpu --index 1`
- `scripts/llama_cpp_local.sh status --backend regular`
- `scripts/llama_cpp_local.sh status --backend qvac`
- `scripts/llama_cpp_local.sh stop --backend regular`
- `scripts/llama_cpp_local.sh stop --backend qvac`
- `scripts/switch_runtime_target.sh <reg-prebuilt|reg-cpu|reg-vulkan|qvac-cpu|qvac-vulkan>`

Backend defaults:
- regular (prebuilt): port `18080`
- qvac cpu: port `18081`
- qvac vulkan: port `18084`

Regular runtime target ports used by the Settings picker:
- prebuilt: `18080`
- cpu build: `18082`
- vulkan build: `18083`

QVAC runtime target ports used by the Settings picker:
- qvac cpu: `18081`
- qvac vulkan: `18084`

Mode defaults:
- `--mode gpu` => `--n-gpu-layers 99`
- `--mode cpu` => `--n-gpu-layers 0 --device none`
- `--mode auto` => use env (`LLAMA_CPP_N_GPU_LAYERS` / `QVAC_N_GPU_LAYERS`)

## UI flow for endpoint test

1. Start a model server using script above.
   - On this device class, run one target at a time (use `scripts/switch_runtime_target.sh`) to avoid OOM/futex crashes from multiple concurrent servers.
2. Open Steve Chat (`http://127.0.0.1:8104`).
3. Open Settings.
4. Pick backend (**Regular llama.cpp** or **QVAC fabric llama.cpp**).
5. Pick runtime target:
   - Regular backend: **Prebuilt / CPU build / Vulkan build**
   - QVAC backend: **QVAC CPU / QVAC Vulkan**
6. Click **Connect local …**.
7. Verify model(s) detected and select in the model picker.
8. Send a test prompt in **Local Runtime** mode.

## Notes on model selection

`llama-server` serves one model per process. To switch between E2B/E4B, run script `restart` with a different model index/path.

## QVAC binary note

If qvac binary is not on PATH, set it explicitly before start:

```bash
export QVAC_LLAMA_BIN=/absolute/path/to/qvac-llama-server
./scripts/llama_cpp_local.sh start --backend qvac --mode gpu --index 1
```

## qvac release `b7336` binary selection note (important)

Checked release assets at:
- `https://github.com/tetherto/qvac-fabric-llm.cpp/releases/tag/b7336`

Result:
- ✅ Best match for phone architecture: `llama-b7336-bin-android.zip`
- ⚠️ This Android asset is an Android app artifact bundle (APKs + `.so` libs), **not** a standalone `llama-server` CLI binary.
- ⚠️ Linux prebuilt CLI assets in this release are `ubuntu-*-x64` only, so not compatible with local arm64 runtime.

Downloaded and verified digest for Android asset:

```bash
# Expected from GitHub release API: sha256:f00d6d24e83a1f7ab0614dff3e1c7076b8be34eac6b3994069c663b74e8b7504
sha256sum llama-b7336-bin-android.zip
# -> f00d6d24e83a1f7ab0614dff3e1c7076b8be34eac6b3994069c663b74e8b7504
```

## Phase 2 mini-phase: qvac source compile + 4-way runtime report

Target comparison matrix:
1. `llama.cpp + CPU`
2. `llama.cpp + GPU`
3. `qvac-fabric-llama.cpp + CPU`
4. `qvac-fabric-llama.cpp + GPU`

For each row capture:
- load success/failure
- first-token latency
- avg tokens/s
- output quality sanity prompt
- stability notes (errors/restarts)
- optional power estimate (`tokens/s • W` in UI)

Launcher commands map directly to matrix rows:

```bash
# regular llama.cpp
./scripts/llama_cpp_local.sh start --backend regular --mode cpu --index 1
./scripts/llama_cpp_local.sh start --backend regular --mode gpu --index 1

# qvac (once qvac server binary is built/available)
./scripts/llama_cpp_local.sh start --backend qvac --mode cpu --index 1
./scripts/llama_cpp_local.sh start --backend qvac --mode gpu --index 1
```

## Mini phase 2A local-network fallback (arm64 artifacts)

If GitHub workflow pushes are blocked by PAT scope, use local-network equivalent script:

```bash
# on a native Linux arm64 builder machine
scripts/phase2a_build_qvac_arm64.sh cpu
scripts/phase2a_build_qvac_arm64.sh vulkan
```

Packaging requirement: include `libmtmd.so*` in addition to `llama-server`, `libllama.so*`, and `libggml*.so*`.
Without `libmtmd.so*`, qvac `llama-server` exits before startup.

Common CMake flags used by the script:

```bash
-G Ninja
-DCMAKE_BUILD_TYPE=Release
-DGGML_NATIVE=OFF
-DLLAMA_CURL=OFF
-DLLAMA_BUILD_SERVER=ON
-DLLAMA_BUILD_TOOLS=ON
-DLLAMA_MTMD=ON
-DLLAMA_BUILD_EXAMPLES=OFF
-DLLAMA_BUILD_TESTS=OFF
```

Per-variant delta:

```bash
# CPU
-DGGML_VULKAN=OFF

# GPU (Vulkan)
-DGGML_VULKAN=ON
```

## Mini phase 2B: upstream ggml-org/llama.cpp arm64 builds (CPU + Vulkan)

Use this script for upstream baseline artifacts:

> Packaging note: `llama-server` now depends on `libmtmd.so*` in addition to `libllama.so*` and `libggml*.so*`. Keep all of them in the same folder as the server binary (or set `LD_LIBRARY_PATH`).

```bash
scripts/phase2b_build_llama_org_arm64.sh cpu
scripts/phase2b_build_llama_org_arm64.sh vulkan
```

Runtime launch examples for all targets in the UI:

Note: `scripts/llama_cpp_local.sh` prepends `dirname(LLAMA_CPP_BIN|QVAC_LLAMA_BIN)` to `LD_LIBRARY_PATH` automatically.

```bash
# 1) prebuilt regular on 18080
LLAMA_CPP_BIN=/usr/bin/llama-server LLAMA_CPP_PORT=18080 \
  ./scripts/llama_cpp_local.sh restart --backend regular --mode cpu --index 1

# 2) local CPU build on 18082
LLAMA_CPP_BIN=/tmp/llama-b8419/build-openclaw-cpu/bin/llama-server LLAMA_CPP_PORT=18082 \
  ./scripts/llama_cpp_local.sh restart --backend regular --mode cpu --index 1

# 3) local Vulkan build on 18083
LLAMA_CPP_BIN=/tmp/llama-org-phase2b/out/llama-org-b8419-linux-arm64-vulkan/llama-server LLAMA_CPP_PORT=18083 \
  ./scripts/llama_cpp_local.sh restart --backend regular --mode gpu --index 1

# 4) qvac cpu on 18081
QVAC_LLAMA_BIN=/path/to/qvac-cpu/llama-server QVAC_LLAMA_PORT=18081 \
  ./scripts/llama_cpp_local.sh restart --backend qvac --mode cpu --index 1

# 5) qvac vulkan on 18084
QVAC_LLAMA_BIN=/path/to/qvac-vulkan/llama-server QVAC_LLAMA_PORT=18084 \
  ./scripts/llama_cpp_local.sh restart --backend qvac --mode gpu --index 1

# all at once (high RAM use; may be unstable)
./scripts/start_runtime_matrix.sh

# one target at a time (recommended on constrained devices)
./scripts/switch_runtime_target.sh reg-vulkan
./scripts/switch_runtime_target.sh qvac-vulkan
```
