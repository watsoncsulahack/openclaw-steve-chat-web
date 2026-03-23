# Steve Chat Web (Prototype)

Mobile-first local chat UI prototype inspired by Allan's sketch (hamburger menu, model picker, simple message flow).

## Current scope

- Step 1: repo scaffold ✅
- Step 2: mobile shell/UI ✅
- Step 3: tap-through chat flow ✅
  - chat drawer + searchable chat history
  - model picker sheet
  - simplified settings sheet (single list with backend dropdown, model profile dropdown, chat defaults)
  - message composer + mock Steve replies + mock mic button
  - assistant metadata includes live `tokens/s` + power telemetry
  - bottom session token counters (total / prompt / completion)
  - optional live wire-up to local OpenAI-compatible endpoint (`/v1/models`, `/v1/chat/completions`)
  - foldable/wide layout: persistent left chat drawer + right chat pane
  - collapsible wide-mode sidebar rail with deterministic SHA-256 identicon artwork per chat

## Run locally

```bash
bash serve.sh 8104
```

Open:

- http://127.0.0.1:8104

## Live mode

From the **Settings** button (⚙):

1. Set base URL (default `http://127.0.0.1:18084`)
2. Pick backend from dropdown (**Regular** or **QVAC fabric**)
3. Pick local model profile (**E2B** or **E4B/4B**) and tap **Apply model**
4. Tap **Detect** to load local models
5. Tune chat sampling/perf settings in **Chat defaults**:
   - temperature, top-k, top-p, min-p, typical-p, repeat penalty, max tokens
   - optional custom JSON (advanced) merged into `/v1/chat/completions`
5. Choose mode:
   - **UI Demo** (mock Steve replies)
   - **Local Runtime** (real endpoint calls)

Default profile now prefers **QVAC Vulkan (GPU)** + **Local Runtime** for on-device acceleration testing.
You can switch back to UI Demo any time for pure UX review.

## Local llama.cpp quick start

This repo includes a helper script to run either backend:

- **regular `llama-server` prebuilt** on `127.0.0.1:18080`
- **regular local CPU build** on `127.0.0.1:18082`
- **regular local Vulkan build** on `127.0.0.1:18083`
- **qvac CPU build** on `127.0.0.1:18081`
- **qvac Vulkan build** on `127.0.0.1:18084`

```bash
./scripts/llama_cpp_local.sh list-models
./scripts/llama_cpp_local.sh start --backend regular --mode gpu --index 1
./scripts/llama_cpp_local.sh start --backend regular --mode cpu --index 1

# launch additional regular endpoints from custom binaries
LLAMA_CPP_BIN=/tmp/llama-b8419/build-openclaw-cpu/bin/llama-server LLAMA_CPP_PORT=18082 \
  ./scripts/llama_cpp_local.sh start --backend regular --mode cpu --index 1
LLAMA_CPP_BIN=/tmp/llama-b8419/build-openclaw-vulkan/bin/llama-server LLAMA_CPP_PORT=18083 \
  ./scripts/llama_cpp_local.sh start --backend regular --mode gpu --index 1
```

Switch model (example E2B → E4B):

```bash
./scripts/llama_cpp_local.sh restart --backend regular --mode gpu --index 2
```

Start qvac backend (if qvac binary is installed):

```bash
./scripts/llama_cpp_local.sh start --backend qvac --mode gpu --index 1
```

Start all runtime variants at once (high RAM use; may be unstable on constrained devices):

```bash
./scripts/start_runtime_matrix.sh
```

Recommended for phone testing: run **one target at a time** (stops others first):

```bash
./scripts/switch_runtime_target.sh reg-vulkan
./scripts/switch_runtime_target.sh qvac-vulkan
```

Then in Steve Chat Settings:
1. choose backend (Regular or QVAC)
2. choose model profile (E2B or E4B) and tap **Apply model**
3. tap **Connect local …** to set endpoint + detect models.

Build helper for upstream llama.cpp arm64 CPU/Vulkan artifacts: `scripts/phase2b_build_llama_org_arm64.sh`

Runtime packaging note: keep `libmtmd.so*` beside `llama-server` (plus `libllama.so*` / `libggml*.so*`) or launch with `LD_LIBRARY_PATH` including that folder.

Note: bundled server artifacts must include shared libs beside the binary (including `libmtmd.so*`).
`llama_cpp_local.sh` now prepends the binary directory to `LD_LIBRARY_PATH` automatically.

Detailed guide: `docs/PHASE2-LLAMA-CPP-SETUP.md`

UI naming map: `docs/UI-ELEMENT-NAMING.md`

## Next iteration ideas

- background endpoint health monitor + reconnect UX
- chat export/import
- model profile presets (ctx, temp, max tokens)
- avatar/theme customization ("Steve" personality presets)
