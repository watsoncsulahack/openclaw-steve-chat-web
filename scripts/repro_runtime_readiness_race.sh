#!/usr/bin/env bash
set -euo pipefail

# Reproduces the "models endpoint is up, first chat call still fails" race.
# Read this top-to-bottom to understand exactly what is being tested.

SUPERVISOR_BASE="${SUPERVISOR_BASE:-http://127.0.0.1:8099/v0}"
RUNTIME_BASE="${RUNTIME_BASE:-http://127.0.0.1:18084}"
SITE_ID="${SITE_ID:-steve-chat}"
TARGET="${TARGET:-qvac-vulkan}"
MODEL_INDEX="${MODEL_INDEX:-1}"
MODEL_ID="${MODEL_ID:-gemma-3n-E2B-it-UD-Q4_K_XL.gguf}"

log() { printf "\n[%s] %s\n" "$(date -u +%H:%M:%S)" "$*"; }

json_post() {
  local url="$1"
  local payload="$2"
  curl -sS -X POST "$url" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    --data "$payload"
}

chat_payload() {
  cat <<JSON
{"model":"$MODEL_ID","messages":[{"role":"user","content":"Reply with OK only."}],"max_tokens":24,"temperature":0.2,"top_p":0.95,"stream":false}
JSON
}

log "Step 1/5: restart site server (optional but useful to force a realistic lifecycle)"
json_post "$SUPERVISOR_BASE/restart" "{\"id\":\"$SITE_ID\"}" | sed -n '1,2p'

log "Step 2/5: switch runtime/profile through supervisor"
json_post "$SUPERVISOR_BASE/llama_runtime_switch" "{\"id\":\"$SITE_ID\",\"target\":\"$TARGET\",\"modelIndex\":$MODEL_INDEX}" | sed -n '1,6p'

log "Step 3/5: poll /v1/models until it responds"
for i in $(seq 1 15); do
  code=$(curl -s -o /tmp/repro-models.json -w '%{http_code}' "$RUNTIME_BASE/v1/models" || true)
  echo "models attempt $i -> HTTP $code"
  if [[ "$code" == "200" ]]; then
    head -c 180 /tmp/repro-models.json; echo
    break
  fi
  sleep 0.5
done

log "Step 4/5: immediately call /v1/chat/completions a few times"
# This is where transient 503 / fetch failures often appear right after models are visible.
for i in $(seq 1 8); do
  code=$(curl -s -o /tmp/repro-chat.json -w '%{http_code}' \
    -X POST "$RUNTIME_BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    --data "$(chat_payload)" || true)

  echo "chat attempt $i -> HTTP $code"
  if [[ "$code" == "200" ]]; then
    head -c 220 /tmp/repro-chat.json; echo
    break
  else
    head -c 220 /tmp/repro-chat.json 2>/dev/null || true
    echo
    sleep 1
  fi
done

log "Step 5/5: interpretation"
cat <<'TXT'
If models returned 200 before chat did, you reproduced the readiness race:
- /v1/models can be reachable while generation path is still warming.
- first chat calls can transiently fail (503 / fetch error), then succeed seconds later.

This is why Steve Chat now:
1) treats these as transient runtime errors,
2) does a warmup-aware retry,
3) retries stream and one-shot calls once before surfacing failure.
TXT
