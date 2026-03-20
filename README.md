# Steve Chat Web (Prototype)

Mobile-first local chat UI prototype inspired by Allan's sketch (hamburger menu, model picker, simple message flow).

## Current scope

- Step 1: repo scaffold ✅
- Step 2: mobile shell/UI ✅
- Step 3: tap-through chat flow ✅
  - chat drawer
  - model picker sheet
  - message composer + mock Steve replies
  - optional live wire-up to local OpenAI-compatible endpoint (`/v1/models`, `/v1/chat/completions`)
  - foldable/wide layout: persistent left chat drawer + right chat pane

## Run locally

```bash
bash serve.sh 8104
```

Open:

- http://127.0.0.1:8104

## Live mode

From the drawer:

1. Set base URL (default `http://127.0.0.1:18080`)
2. Tap **Detect** to load local models
3. Choose mode:
   - **UI Demo** (mock Steve replies)
   - **Local Runtime** (real endpoint calls)

UI Demo mode is default so UX flow can be reviewed without model runtime dependency.

## Next iteration ideas

- streaming tokens
- persistent multi-chat history (IndexedDB)
- STT/TTS voice controls
- avatar/theme customization ("Steve" personality presets)
