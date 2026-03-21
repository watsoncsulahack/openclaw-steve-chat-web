# Phase 2 Start: Local llama.cpp endpoint wiring

This project is wired to use local OpenAI-compatible endpoints:

- Regular llama.cpp: `http://127.0.0.1:18080`
- QVAC fabric llama.cpp: `http://127.0.0.1:18081`

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

Backend defaults:
- regular: port `18080`
- qvac: port `18081`

Mode defaults:
- `--mode gpu` => `--n-gpu-layers 99`
- `--mode cpu` => `--n-gpu-layers 0 --device none`
- `--mode auto` => use env (`LLAMA_CPP_N_GPU_LAYERS` / `QVAC_N_GPU_LAYERS`)

## UI flow for endpoint test

1. Start a model server using script above.
2. Open Steve Chat (`http://127.0.0.1:8104`).
3. Open Settings.
4. Pick backend (**Regular llama.cpp** or **QVAC fabric llama.cpp**).
5. Click **Connect local …**.
6. Verify model(s) detected and select in the model picker.
7. Send a test prompt in **Local Runtime** mode.

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
