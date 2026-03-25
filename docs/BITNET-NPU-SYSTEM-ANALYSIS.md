# BitNet + NPU Prefill Feasibility & System Analysis (Steve Chat)

Last updated: 2026-03-25 (UTC)

## Scope
This analysis synthesizes two referenced papers:
- **BitNet b1.58** (`arXiv:2402.17764`) — 1-bit/ternary model architecture and efficiency claims.
- **llm.npu** (`arXiv:2407.05858`) — NPU-offloaded prefill acceleration on mobile.

It maps those ideas to Steve Chat's current runtime stack on-device (qvac/llama.cpp server path) and defines a practical implementation path that remains durable across phone + laptop.

---

## Executive feasibility summary

### A) Run BitNet GGUF on current qvac/llama stack
**Feasibility: PARTIAL / EXPERIMENTAL**

- Possible to load and produce outputs.
- Not reliably stable on this current phone/runtime path for all BitNet variants.
- Current observed behavior:
  - tq1: can answer but may produce template-slop style outputs.
  - tq2: can become unstable (warmup 503 -> connection refused).

**Conclusion:** usable only as an experimental lane for now.

### B) NPU prefill acceleration on Pixel-class device
**Feasibility: MEDIUM (requires backend work; not a toggle)**

- Conceptually strong and aligned with llm.npu results.
- Not directly available via existing qvac/llama.cpp configuration.
- Requires dedicated NPU-capable backend path (graph/runtime/model conversion/scheduling).

**Conclusion:** realistic R&D track, but separate from immediate MVP stabilization.

### C) Durable phone + laptop architecture
**Feasibility: HIGH**

- Use a provider-router abstraction with common API contract.
- Keep Steve Chat frontend stable while swapping backend providers.

**Conclusion:** recommended long-term architecture.

---

## Why paper results do not transfer 1:1 today

## BitNet paper implications
BitNet b1.58 benefits assume a model + kernel path aligned to ternary/integer-friendly computation.
Running BitNet-style GGUF in generic runtime paths does not guarantee paper-level behavior or quality.

## llm.npu paper implications
llm.npu gains rely on **prefill-specific system redesign**:
- fixed-size chunk graphs,
- outlier handling split across processors,
- out-of-order heterogeneous scheduling.

This is a system architecture change, not just model replacement.

---

## Current Gemma E2B failure mode (observed)

Symptom pattern in UI:
- repeated short outputs (`Hi`, `Live`, `(generation stopped)`),
- history contamination loops,
- degraded generation quality after unstable model switches.

Likely contributors:
1. Warmup/readiness race (`/v1/models` ready before `/v1/chat/completions`).
2. Aborted/failed generations polluting reusable prompt history.
3. Template/control-token contamination from unstable outputs.
4. Prompt cache interactions during rapid switch/abort cycles.

---

## Stabilization actions now encoded in Steve Chat

1. **History hygiene for runtime prompts**
   - strips template-control tokens,
   - filters low-signal assistant artifacts,
   - quarantines aborted/error outputs from future context.

2. **Corruption rescue pass**
   - if output appears corrupted, retries once with clean context (latest user input).

3. **Prompt cache safety default**
   - request body now uses `cache_prompt: false` for stability-first behavior.

4. **Bounded context for mobile stability**
   - compact history window and token budget to avoid runaway prefill/context drift.

---

## Proposed system architecture (durable)

## Control-plane
**Steve Runtime Router** (local service)
- keeps OpenAI-compatible contract (`/v1/models`, `/v1/chat/completions`)
- routes requests by profile/device capability

Profiles:
- `stable` -> Gemma via qvac/llama path
- `voice` -> STT/TTS services + stable LLM path
- `experimental-bitnet` -> BitNet provider
- `experimental-npu-prefill` -> NPU-backed prefill pipeline

## Data-plane providers
1. **Provider-Llama/QVAC** (baseline)
2. **Provider-STT/TTS** (voice MVP)
3. **Provider-NPU-Prefill** (R&D)

---

## What is needed to activate NPU prefill for real

1. NPU runtime stack (NNAPI/QNN/TFLite delegate class of path).
2. Model conversion + operator compatibility pipeline.
3. Prompt chunking executor (fixed-shape graphs).
4. Heterogeneous scheduler (NPU + CPU/GPU cooperation).
5. Accuracy guardrails + fallback routing when unsupported ops appear.
6. Unified observability (latency breakdown, prefill/decode split, energy).

---

## BitNet-on-device options

## Option 1 — Continue GGUF + qvac experiments (short-term)
- Fastest to iterate.
- Keep as experimental lane with strict health checks.
- Accept instability risk.

## Option 2 — BitNet-native backend path (mid-term)
- Aligns better with paper claims.
- Higher engineering cost but better chance of consistent gains.

---

## Recommended phased plan

### Phase 0 (now): Stabilize current UX/runtime
- Keep Gemma as default stable profile.
- Quarantine unstable outputs from context.
- Add health gate after model switch before accepting model as active.

### Phase 1: Voice MVP
- Local Whisper.cpp service endpoint (STT).
- Keep LLM generation on stable provider.
- Add TTS provider abstraction.

### Phase 2: NPU prefill prototype
- Build provider stub + router integration first.
- Prototype chunked prefill path on one Android target.
- Benchmark long-prompt tasks only (where prefill dominates).

### Phase 3: Cross-platform hardening
- Same router/provider contract on laptop (containerized sidecars).
- Device-specific provider adapters behind common API.

---

## Risks and mitigations

- **Vendor lock-in risk:** avoid Pixel-only APIs in router contract.
- **Operator coverage gaps on NPU:** enforce automatic fallback to stable provider.
- **Debug complexity:** track per-request route, model hash, prefill/decode timings.
- **Quality regression under aggressive quantization:** run regression set before promoting profile.

---

## Bottom line

- **BitNet now:** experimental; keep separated from stable production profile.
- **NPU prefill:** feasible but requires a new backend track, not a runtime flag flip.
- **Best path:** provider-router architecture so Steve works on phone and laptop with the same frontend and API shape.
