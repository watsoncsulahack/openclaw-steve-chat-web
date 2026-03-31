# QVAC model identity flow assessment (2026-03-31 UTC)

## Purpose
Assess ChatGPT prompt/report and explicitly trace how `params_base.model_alias`, `params_base.model.name`, and `params_base.model.path` flow into `/v1/models` identity fields.

## Verdict on prior report
- The prior report was directionally correct about `/v1/models` using `ctx_server.model_name`.
- It did **not** fully trace the upstream population path and did not include readiness timing effects.

## Full data flow trace

### 1) Argument parsing into `common_params`
File: `qvac-fabric-llm.cpp/common/arg.cpp`

- `--alias` handler sets:
  - `params.model_alias = value`
  - (around `-a/--alias` option handler)
- `--model` handler sets:
  - `params.model.path = value`
  - (around `-m/--model` option handler)
- Parsing pipeline in `common_params_parse_ex(...)`:
  1. env vars -> options handlers
  2. CLI args -> options handlers (CLI overrides env)
  3. postprocess + `common_params_handle_model(...)`

### 2) Model struct normalization (`name`, `path`)
File: `qvac-fabric-llm.cpp/common/arg.cpp` (`common_params_handle_model`)

- If Docker repo is used:
  - `model.path = common_docker_resolve_model(...)`
  - `model.name = model.docker_repo`
- If HF repo is used:
  - can set `model.name = model.hf_repo`
  - resolves/downloads and fills `model.path` if empty
- If direct `--model` path is used:
  - `model.path` is set
  - `model.name` generally remains empty unless another source sets it

### 3) Server-level alias normalization
File: `qvac-fabric-llm.cpp/tools/server/server.cpp`

- After parse:
  - if `params.model_alias` empty and `params.model.name` non-empty,
    then `params.model_alias = params.model.name`
- This ensures router-mode and single-model mode naming consistency when model name is available.

### 4) Propagation into server runtime state
Files: `tools/server/server.cpp`, `tools/server/server-context.cpp`

- `ctx_server.load_model(params)` copies params into `params_base` (`params_base = params` in `load_model(...)`).
- `ctx_server.init()` computes `model_name` precedence:
  1. `params_base.model_alias`
  2. `params_base.model.name`
  3. `filename(params_base.model.path)`

### 5) `/v1/models` serialization
File: `tools/server/server-context.cpp` (`get_models` route)

- Response fields use `ctx_server.model_name` directly:
  - `models[].name`
  - `models[].model`
  - `data[].id`
- No extra fallback logic in route when `model_name` is empty.

## Why empty IDs can occur

### A) Readiness timing window (most likely)
File: `tools/server/server.cpp`

- HTTP server starts **before** model load/init, specifically to serve health.
- `ctx_http.is_ready` is set true only after load + init complete.
- `/v1/models` is still reachable during startup and route uses current `ctx_server.model_name`.
- During this window, `ctx_server.model_name` may still be default empty string.

Observed in runtime logs:
- `/v1/models` 200 responses during load/warmup and before full readiness.

### B) Legitimately empty source fields (less common)
All of the following would have to lead to no usable fallback:
- `model_alias` empty
- `model.name` empty
- `model.path` empty or filename derivation empty

In normal single-model startup with `--model /path/file.gguf`, fallback should be non-empty once `init()` runs.

## Consistency check conclusion
- Runtime initialization and `/v1/models` output are internally consistent with code.
- Empty/odd identity fields are consistent with requests served before `model_name` assignment is finalized (startup race window), not necessarily parameter parse failure.

## Practical recommendation
1. For runtime correctness checks, gate model identity reads to ready-state (or poll until non-empty id).
2. Optional hardening in server code:
   - either return 503 for `/v1/models` when not ready,
   - or derive temporary fallback directly from `params_base.model.path` when `model_name` is empty.
3. Keep passing explicit `--alias` from launcher scripts (already implemented on Steve Chat side) for stable naming after ready state.
