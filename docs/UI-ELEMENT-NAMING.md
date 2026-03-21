# UI Element Naming & Object Map

Purpose: keep naming consistent so humans/agents can refer to GUI parts unambiguously.

## Naming rules

- **IDs (`id=`):** camelCase, unique, UI action or semantic object name.
  - examples: `menuBtn`, `chatSearchInput`, `powerTrendSvg`
- **CSS classes (`class=`):** kebab-case, reusable visual grouping.
  - examples: `app-shell`, `model-sheet-card`, `power-panel`
- **JS state keys:** camelCase, grouped by domain where possible.
  - examples: `runtimeState`, `localLlamaConnected`, `power.sessionEnergyMWh`
- **Button IDs:** end with `Btn`.
- **Input IDs:** end with `Input`.
- **Toggle IDs:** end with `Toggle`.

## Core layout map

- `app-shell` — full app container
- `drawer` — left sidebar/chat list panel
- `backdrop` — modal/drawer dim layer
- `phone-frame` — main chat surface
- `topbar` — header row with menu/model/status
- `messages` — message scroll view
- `composer` — input + send controls

## High-traffic interactive IDs

### Navigation
- `menuBtn` — opens sidebar on mobile
- `closeDrawerBtn` — closes sidebar
- `settingsBtn` — opens settings modal
- `closeSettingsBtn` — closes settings modal
- `modelPickerBtn` — opens model picker
- `closeModelSheetBtn` — closes model picker

### Chat list / archive
- `chatList`, `chatListTitle`
- `chatSearchInput`, `clearChatSearchBtn`
- `newChatBtn`, `archivesBtn`, `drawerCompactBtn`
- `sidebarRail`

### Runtime controls
- `baseUrlInput`
- `saveBaseUrlBtn`, `detectModelsBtn`, `connectLocalLlamaBtn`
- `backendRegularBtn`, `backendQvacBtn`
- `runtimePrebuiltBtn`, `runtimeCpuBtn`, `runtimeVulkanBtn`
- `qvacCpuBtn`, `qvacVulkanBtn`
- `mockModeBtn`, `runtimeModeBtn`
- `streamModeToggle`, `ttsToggle`
- `runtimeStatus`, `modeHint`

### Power telemetry (phase 2)
- `powerTotalValue` — cumulative session energy (mWh/Wh)
- `powerAvgValue` — average session power (W)
- `powerTrendSvg` — sparkline over recent power samples
- `resetPowerStatsBtn` — reset telemetry counters

Note: the settings-panel power block is intentionally hidden during current design iteration, but IDs are retained in code for later re-introduction.

### Token counters
- `sessionTokenBar` — bottom token summary strip
- `sessionTokenTotal` — cumulative session token count
- `sessionPromptTokens` — cumulative prompt tokens
- `sessionCompletionTokens` — cumulative completion tokens

## Message metadata naming

Assistant message footer metadata order:
1. `tokens/s`
2. instantaneous power (`W`)
3. per-response energy (`mWh`, when available)

Rendered format example:
`12.4 tokens/s • 2.18 W • 0.42 mWh`

## Gesture policy (current)

- **Chat view horizontal edge drag** (`phone-frame`/`messages`): smoothly drags sidebar drawer on mobile.
  - supports opening from left edge (swipe right)
  - supports opening from right edge (swipe left) for one-hand use
- Message-level swipe-to-reply is disabled to avoid conflict with global navigation gesture.
