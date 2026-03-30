# Steve Chat model-switch / KV-cache status report (2026-03-30 UTC)

## Scope requested by Allan
1. Verify whether template-error behavior is caused by cross-model KV-cache reuse.
2. Force clean behavior on model switch in Steve Chat.
3. Remove BitNet models from Steve Chat and local disk.
4. Prepare a new test website using latest reverse-proxy scheme.

## Verification findings

### A) Cross-model KV-cache reuse (terminal evidence)
- Runtime switching (`POST /v0/llama_runtime_switch`) stops previous runtime and starts a new process for target model.
- Steve Chat runtime requests already send `cache_prompt: false` in `/v1/chat/completions` payload.
- Conclusion: the observed behavior is **not explained by reuse of previous model KV-cache** alone.

### B) Actual instability observed
- QVAC endpoint `/v1/models` intermittently reports an empty model id (`"id":""`) after model switch.
- During warmup, `/v1/chat/completions` frequently returns HTTP 503 `Loading model`.
- This can desync UI-selected model labels from runtime-reported model identity.

## Changes applied

### 1) Steve Chat (shared repo)
Repo: `/storage/emulated/0/OpenClawHub/web/steve-chat`

- Removed BitNet model profiles from UI/runtime profile config:
  - `index.html` model profile select now only includes Gemma E2B and Gemma E4B.
  - `src/steve-chat-app.js` removed BitNet entries from `MODEL_PROFILES`.
- Implemented **fresh-context reset on model switch**:
  - `resetActiveChatForModelSwitch(...)` now clears active chat context and starts a fresh thread note after successful profile apply.
- Hardened selected-model handling:
  - runtime preflight no longer reselects unavailable profile model from local merged list.
  - model choice now prefers models actually reported by runtime when available.

### 2) Runtime switch script hardening
File: `/storage/emulated/0/OpenClawHub/web/steve-chat/scripts/switch_runtime_target.sh`

- Switched from fragile `--index` model selection to explicit `--model <path>`.
- Added deterministic mapping for Steve profiles:
  - index `1|3` -> Gemma E2B path
  - index `2|4` -> Gemma E4B path
- Emits selected model path for traceability.

### 3) Site Supervisor runtime metadata fix
Repo: `/storage/emulated/0/OpenClawHub/tools/site-supervisor`
File: `site_supervisor.py`

- `llama_runtime_switch` response now resolves model-path metadata from both runtime run dirs and chooses newest metadata file:
  - `/data/data/com.termux/files/usr/tmp/openclaw-steve-chat-llama`
  - `/tmp/openclaw-steve-chat-llama`

### 4) BitNet removal from disk
Deleted:
- `/storage/emulated/0/OpenClawHub/models/1bitLLM-bitnet_b1_58-xl-tq1_0.gguf`
- `/storage/emulated/0/OpenClawHub/models/1bitLLM-bitnet_b1_58-xl-tq2_0.gguf`

## New reverse-proxy test website prepared

- Added new site scaffold:
  - `/storage/emulated/0/OpenClawHub/web/proxy-test-latest/`
- Added site catalog entry in `/storage/emulated/0/OpenClawHub/web/sites.json`:
  - id: `proxy-test-latest`
  - backend: `http://127.0.0.1:8110`
  - proxy route: `/site/proxy-test-latest/`
- Activation + route verification succeeded:
  - `POST /v0/activate {"id":"proxy-test-latest"}` -> running
  - `GET /v0/routes` includes `proxy-test-latest`
  - `GET /site/proxy-test-latest/` returns test HTML

## Current residual risk / follow-up
- QVAC `/v1/models` empty-id behavior and 503 warmup windows remain a runtime-level issue; this can still affect model-detection UX timing even after app hardening.
- Recommended next debugging pass: inspect qvac llama-server build/runtime flags and model metadata export path for `/v1/models` correctness.
