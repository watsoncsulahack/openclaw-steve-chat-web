# QVAC /v1/models diagnostic (2026-03-31 UTC)

## Request scope
Inspect QVAC llama-server build/runtime flags and model metadata export path correctness for `/v1/models`.

## Environment observed
- Runtime launcher: `/storage/emulated/0/OpenClawHub/web/steve-chat/scripts/llama_cpp_local.sh`
- Runtime switch wrapper: `/storage/emulated/0/OpenClawHub/web/steve-chat/scripts/switch_runtime_target.sh`
- Supervisor endpoint: `POST /v0/llama_runtime_switch`

## Runtime/binary flag inspection
From qvac server help (`llama-server-wrapper.sh --help`):
- Supports: `--alias`, `--reasoning-format`, `--reasoning-budget`, `--chat-template`, `--chat-template-file`, `--cache-reuse`, `--cache-ram`, `--slot-save-path`, `--models-dir`.

Current launch profile in logs:
- `--model <gemma-path>`
- `--n-gpu-layers 72`
- `--ctx-size 2048`
- `--threads 3`
- `--reasoning-format deepseek-legacy`
- `--reasoning-budget -1`
- `--jinja`
- prompt cache is enabled by server default (`cache-ram 8192 MiB` in runtime log)

## Metadata-path inspection
- Runtime model metadata files are written under:
  - `/tmp/openclaw-steve-chat-llama/*-model-<port>.path`
  - and/or `/data/data/com.termux/files/usr/tmp/openclaw-steve-chat-llama/*-model-<port>.path`
- `site_supervisor.py` was updated to read both locations and choose newest metadata file.
- `POST /v0/llama_runtime_switch` now returns correct `modelPath` after switch.

## /v1/models correctness result
Observed repeatedly after successful Gemma switch:
- `/v1/models` returns 200 with **empty id/name** entries (`"id":""`, `"model":""`).
- This persists even when runtime is otherwise usable for `/v1/chat/completions`.

Interpretation:
- QVAC build/runtime appears to expose a regression in model-list metadata serialization for `/v1/models`.
- This is not a Steve Chat UI-only issue.

## Mitigations implemented
1. Steve Chat model picker is now restricted to explicit Gemma profiles only (E2B/E4B), so stale/invalid runtime model list cannot reintroduce BitNet options.
2. Runtime switch script now uses deterministic explicit `--model <path>` mapping for profile indices instead of generic index scanning.
3. Fresh context reset occurs after model apply to avoid cross-run prompt contamination.
4. Runtime launcher now attempts to pass `--alias` when supported (for improved model naming), but this did not fully correct `/v1/models` empty-id behavior in this QVAC build.

## Recommended next step
- Upgrade/rebuild QVAC llama-server to a revision where `/v1/models` returns non-empty model ids reliably (or patch server code path that populates model id/alias in list response).
- Until then, treat supervisor `llama_runtime_switch` metadata (`modelPath`/`modelName`) as source of truth for active model identity.
