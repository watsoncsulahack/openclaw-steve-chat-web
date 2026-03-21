#!/usr/bin/env bash
set -euo pipefail

# Approximate prompt-level energy usage on Android/Linux by integrating battery power samples.
# Uses:
#   /sys/class/power_supply/battery/current_now  (uA)
#   /sys/class/power_supply/battery/voltage_now  (uV)
#
# Formula:
#   power_mW = abs(current_uA * voltage_uV) / 1e9
#   energy_mWh += power_mW * dt_ms / 3_600_000

BAT_DIR="${BATTERY_SYSFS_DIR:-/sys/class/power_supply/battery}"
CUR_FILE="$BAT_DIR/current_now"
VOL_FILE="$BAT_DIR/voltage_now"
SAMPLE_MS="${SAMPLE_MS:-200}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") -- <command> [args...]

Example:
  $(basename "$0") -- curl -s http://127.0.0.1:18080/v1/models

Output:
  JSON with elapsed_ms, avg_power_mW, energy_mWh
EOF
}

[[ "${1:-}" == "--" ]] || { usage; exit 1; }
shift
[[ "$#" -gt 0 ]] || { usage; exit 1; }

[[ -r "$CUR_FILE" && -r "$VOL_FILE" ]] || {
  echo "ERROR: battery sysfs files not readable: $CUR_FILE / $VOL_FILE" >&2
  exit 2
}

sample_power_mw() {
  local cur vol
  cur="$(cat "$CUR_FILE" 2>/dev/null || echo 0)"
  vol="$(cat "$VOL_FILE" 2>/dev/null || echo 0)"

  # Some kernels expose negative current while discharging; use magnitude.
  awk -v c="$cur" -v v="$vol" 'BEGIN {
    c = (c < 0 ? -c : c);
    v = (v < 0 ? -v : v);
    p = (c * v) / 1000000000.0;
    if (p < 0) p = 0;
    printf "%.6f", p;
  }'
}

start_ms="$(date +%s%3N)"
prev_ms="$start_ms"
energy_mWh="0.0"
sum_power="0.0"
count="0"

"$@" &
CMD_PID=$!

while kill -0 "$CMD_PID" 2>/dev/null; do
  now_ms="$(date +%s%3N)"
  dt_ms=$((now_ms - prev_ms))
  (( dt_ms < 1 )) && dt_ms=1

  p_mw="$(sample_power_mw)"

  energy_mWh="$(awk -v e="$energy_mWh" -v p="$p_mw" -v dt="$dt_ms" 'BEGIN { printf "%.9f", e + (p * dt / 3600000.0) }')"
  sum_power="$(awk -v s="$sum_power" -v p="$p_mw" 'BEGIN { printf "%.9f", s + p }')"
  count=$((count + 1))

  prev_ms="$now_ms"
  sleep "$(awk -v ms="$SAMPLE_MS" 'BEGIN { printf "%.3f", ms/1000.0 }')"
done

wait "$CMD_PID"
cmd_code=$?

end_ms="$(date +%s%3N)"
elapsed_ms=$((end_ms - start_ms))

avg_power="0.0"
if (( count > 0 )); then
  avg_power="$(awk -v s="$sum_power" -v c="$count" 'BEGIN { printf "%.6f", s/c }')"
fi

cat <<JSON
{"exit_code":$cmd_code,"elapsed_ms":$elapsed_ms,"avg_power_mW":$avg_power,"energy_mWh":$energy_mWh,"samples":$count}
JSON

exit "$cmd_code"
