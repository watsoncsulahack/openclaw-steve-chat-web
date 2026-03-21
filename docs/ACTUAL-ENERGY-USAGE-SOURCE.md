# Actual energy usage source (candidate)

This is a **real measurement candidate** (not currently wired into UI):

- File: `scripts/energy_probe_android.sh`
- Method: sample battery current/voltage from Android/Linux sysfs and integrate over time.

## Source formula

Given samples from:
- `current_now` (microamps, uA)
- `voltage_now` (microvolts, uV)

Power:

```text
power_mW = abs(current_uA * voltage_uV) / 1e9
```

Energy integration per sample interval `dt_ms`:

```text
energy_mWh += power_mW * dt_ms / 3_600_000
```

## Example usage

```bash
# Measure energy while calling a prompt
scripts/energy_probe_android.sh -- \
  curl -s http://127.0.0.1:18080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"/storage/emulated/0/OpenClawHub/models/gemma-3n-E2B-it-UD-Q4_K_XL.gguf","messages":[{"role":"user","content":"hello"}],"max_tokens":64}'
```

Example output:

```json
{"exit_code":0,"elapsed_ms":8421,"avg_power_mW":3124.215332,"energy_mWh":7.309997321,"samples":42}
```

## Notes

- This estimates **device battery-side energy**, not model-only SoC energy.
- Accuracy depends on kernel sensor quality and sample rate.
- If sysfs files are unavailable, script exits with a readable error.
