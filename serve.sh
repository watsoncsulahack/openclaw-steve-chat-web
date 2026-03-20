#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-8104}"
python3 -m http.server "$PORT"
