# AGENTS.md

## Repository Context

- This repository is for a browser extension that converts `BYN` prices on `av.by` into `USD`, `EUR`, and `RUB`.
- The product goal is lightweight behavior, minimal permissions, resilience to DOM changes, and simple long-term maintenance.
- Use [plans.md](/d:/av_ext/plans.md) and [av_by_extension_roadmap.md](/d:/av_ext/av_by_extension_roadmap.md) as the source of truth for scope and priorities.

## Engineering Rules

- Prefer `Manifest V3`.
- Prefer `Vanilla JS` unless the user explicitly asks for a framework.
- Keep permissions minimal. Do not broaden `host_permissions` beyond `av.by` and `nbrb.by` without a clear reason.
- Prefer simple extension structure over abstraction-heavy architecture.
- Use `chrome.storage.local` for cached rates and user settings.
- Manual exchange rate from settings must override the API rate.
- Background updates should be periodic and conservative, not per-page-load.

## DOM and UI Rules

- Treat `av.by` markup as unstable. Prefer resilient selectors, text matching, and regex over deep brittle selectors.
- Avoid duplicate injections. Mark processed nodes or otherwise guard against repeated conversion.
- Preserve the original page's visual hierarchy when injecting converted prices.
- Settings changes should update prices on the page immediately when practical.
- Handle dynamic content with `MutationObserver` where needed.

## Scope Control

- MVP scope includes:
  `manifest`,
  `background worker`,
  rate caching,
  popup settings,
  price parsing,
  in-page injection,
  privacy policy,
  icons,
  manual verification.
- Do not implement roadmap v2 items unless explicitly requested:
  remote config,
  tooltip with rate date,
  customs-duty calculator.

## Working Style

- When changing behavior, keep edits small and aligned with the roadmap.
- If a selector or parsing heuristic is fragile, call that out explicitly.
- Prefer updating docs when scope or architecture changes materially.
- Before claiming the extension works, verify the main flows that exist in the repo.
