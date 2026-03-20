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
- `scripts/llama_cpp_local.sh start --backend regular --index 1`
- `scripts/llama_cpp_local.sh restart --backend regular --index 2`
- `scripts/llama_cpp_local.sh start --backend qvac --index 1`
- `scripts/llama_cpp_local.sh status --backend regular`
- `scripts/llama_cpp_local.sh status --backend qvac`
- `scripts/llama_cpp_local.sh stop --backend regular`
- `scripts/llama_cpp_local.sh stop --backend qvac`

Backend defaults:
- regular: port `18080`
- qvac: port `18081`

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
./scripts/llama_cpp_local.sh start --backend qvac --index 1
```
