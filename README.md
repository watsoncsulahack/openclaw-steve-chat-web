# Steve Chat Web (Prototype)

Mobile-first local chat UI prototype inspired by Allan's sketch (hamburger menu, model picker, simple message flow).

## Current scope

- Step 1: repo scaffold ✅
- Step 2: mobile shell/UI ✅
- Step 3: tap-through chat flow ✅
  - chat drawer + searchable chat history
  - model picker sheet
  - settings sheet (endpoint + runtime mode)
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

1. Set base URL (default `http://127.0.0.1:18080`)
2. Tap **Detect** to load local models
3. Choose mode:
   - **UI Demo** (mock Steve replies)
   - **Local Runtime** (real endpoint calls)

UI Demo mode is default so UX flow can be reviewed without model runtime dependency (simulated bot replies + simulated TPS values).

## Local llama.cpp quick start

This repo includes a helper script to run either backend:

- **regular `llama-server`** on `127.0.0.1:18080`
- **qvac fabric llama-server** on `127.0.0.1:18081` (when qvac binary is available)

```bash
./scripts/llama_cpp_local.sh list-models
./scripts/llama_cpp_local.sh start --backend regular --mode gpu --index 1
./scripts/llama_cpp_local.sh start --backend regular --mode cpu --index 1
```

Switch model (example E2B → E4B):

```bash
./scripts/llama_cpp_local.sh restart --backend regular --mode gpu --index 2
```

Start qvac backend (if qvac binary is installed):

```bash
./scripts/llama_cpp_local.sh start --backend qvac --mode gpu --index 1
```

Then in Steve Chat Settings:
1. choose backend (Regular or QVAC)
2. tap **Connect local …** to set endpoint + detect models.

Detailed guide: `docs/PHASE2-LLAMA-CPP-SETUP.md`

UI naming map: `docs/UI-ELEMENT-NAMING.md`

## Next iteration ideas

- background endpoint health monitor + reconnect UX
- chat export/import
- model profile presets (ctx, temp, max tokens)
- avatar/theme customization ("Steve" personality presets)
