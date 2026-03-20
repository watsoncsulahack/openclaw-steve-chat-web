# Phase 2 Start: Local llama.cpp endpoint wiring

This project is wired to use a local OpenAI-compatible endpoint at:

- `http://127.0.0.1:18080`

`llama-server` (from `ggml-org/llama.cpp`) is already available on this host at:

- `/usr/bin/llama-server`

Gemma models discovered on device:

- `/storage/emulated/0/OpenClawHub/models/gemma-3n-E2B-it-UD-Q4_K_XL.gguf`
- `/storage/emulated/0/OpenClawHub/models/gemma-3n-E4B-it-UD-Q4_K_XL.gguf`

## Helper script

Use:

- `scripts/llama_cpp_local.sh list-models`
- `scripts/llama_cpp_local.sh start --index 1`
- `scripts/llama_cpp_local.sh restart --index 2`
- `scripts/llama_cpp_local.sh status`
- `scripts/llama_cpp_local.sh stop`

By default it starts on port `18080`, which matches Steve Chat runtime defaults.

## UI flow for endpoint test

1. Start a model server using script above.
2. Open Steve Chat (`http://127.0.0.1:8104`).
3. Open Settings.
4. Click **Connect local llama.cpp**.
5. Verify model(s) detected and select in the model picker.
6. Send a test prompt in **Local Runtime** mode.

## Notes on model selection

`llama-server` serves one model per process. To switch between E2B/E4B, run script `restart` with a different model index/path.
