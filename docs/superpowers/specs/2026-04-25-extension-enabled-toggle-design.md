# Extension Enabled Toggle Design

## Goal

Add a single global toggle in the popup that lets the user disable or re-enable price conversion without unloading the extension.

## Scope

- Store a persistent `enabled` flag inside extension settings in `chrome.storage.local`.
- Expose a toggle control in the popup UI.
- When disabled, remove all injected converted prices from open `av.by` pages.
- While disabled, do not inject new converted prices on dynamic DOM updates.
- When re-enabled, re-render prices on open `av.by` pages using the existing settings and rate flow.

## Design

### Settings model

- Extend the settings object with `enabled: true` by default.
- Sanitize stored values so missing or invalid settings fall back to `enabled: true`.

### Popup behavior

- Add a dedicated button-like toggle near the top of the popup.
- The toggle text and visual state must clearly show `Включено` or `Отключено`.
- When disabled, currency and rate controls remain visible but are disabled.

### Content script behavior

- On every full refresh, if `enabled === false`, remove extension-injected badges and stop rendering.
- Ignore mutation-driven render work while disabled.
- On re-enable, perform a full document render so existing prices become visible again.

### Background behavior

- Include the new `enabled` flag in the effective state returned to content scripts.
- Skip unnecessary auto-rate refresh on `settingsUpdated` when the extension is disabled.

## Testing

- Add unit coverage for settings sanitization/defaults with the new `enabled` flag.
- Extend the Playwright smoke test to verify that the popup toggle removes injected prices and blocks new injections while disabled.
