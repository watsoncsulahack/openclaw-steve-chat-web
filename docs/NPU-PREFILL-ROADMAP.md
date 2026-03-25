# Steve Chat NPU Prefill Roadmap (Pixel 9 Pro Fold + Cross-Platform)

Last updated (UTC): 2026-03-25

## Short answer
Yes in principle, but not as a drop-in toggle in current qvac/llama.cpp runtime.
NPU-prefill requires a dedicated backend/runtime path.

## Why
Current Steve Chat runtime stack uses llama.cpp/qvac server APIs over CPU/GPU/Vulkan paths.
Pixel TPU/NPU acceleration requires model conversion + execution runtime that targets Android NNAPI/TPU-capable delegates and compatible operators.

## What else is needed
1. **NPU-capable inference backend** (not only llama.cpp Vulkan)
2. **Model conversion pipeline** for NPU target runtime
3. **Prefill-focused scheduler strategy** (long-context ingest optimization)
4. **Runtime router** in Steve Chat (choose backend by task stage/profile)
5. **Unified API contract** so web app can switch providers without UI rewrites

## llm.npu relevance
Paper direction is highly relevant for prefill-heavy tasks.
Integration implication: use similar design ideas (chunked prompt scheduling, heterogeneous dispatch) but likely via a custom backend/service layer rather than direct llama.cpp flag flips.

## Practical architecture options

### Option A — Keep qvac/llama as baseline + add NPU microservice (recommended)
- qvac/llama handles decode/general chat.
- NPU service handles prefill-accelerated embeddings/prompt processing path where supported.
- Steve runtime-router selects path per profile/device capability.

### Option B — Android-native app-level runtime bridge
- Native Android service wraps NNAPI/TPU backend.
- Web UI talks to local HTTP bridge.
- Better mobile hardware integration; more platform-specific engineering.

### Option C — Cross-platform provider abstraction (desktop + phone durability)
- Define provider interface:
  - `provider=llama_cpp|qvac|npu_backend`
  - same `/v1/models` + `/v1/chat/completions` shape
- Run provider-specific sidecars locally (desktop/laptop/phone) behind same API.

## Docker note (Android + desktop)
- Desktop/laptop: straightforward containerized sidecars.
- Android: Docker options are possible but less predictable for GPU/NPU passthrough.
- Practical mobile path today: Termux/native services + HTTP bridge, then use Docker on desktop/laptop where hardware passthrough is stable.

## MVP voice-first sequencing
1. Stabilize runtime switching + history hygiene (in progress).
2. Add local STT service (Whisper.cpp or equivalent) behind provider API.
3. Add TTS provider abstraction.
4. Add backend router profiles:
   - Balanced
   - Accuracy
   - Experimental NPU-prefill

## Success criteria
- Same Steve Chat frontend works unchanged across phone + laptop.
- Provider switch does not break chat UX.
- Measurable prefill latency reduction for long prompts on NPU-capable devices.
