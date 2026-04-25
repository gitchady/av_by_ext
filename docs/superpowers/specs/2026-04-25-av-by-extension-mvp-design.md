# AV.by Currency Converter Extension MVP Design

## Goal

Build a Chrome-first `Manifest V3` browser extension that detects `BYN` prices on `av.by` and renders a nearby converted value in `USD`, `EUR`, or `RUB` using either the official `NBRB` exchange rate or a user-provided manual rate.

## Scope

This MVP is intentionally narrow:

- local development via `chrome://extensions` and `Load unpacked`
- Chromium-first support
- `Manifest V3`
- `Vanilla JS`
- popup settings for currency and rate source
- `background` caching for exchange rates
- `content script` parsing and price injection
- static privacy policy page

Out of scope for this MVP:

- Chrome Web Store or Firefox Add-ons publication
- Firefox compatibility work
- remote selector config
- tooltip with rate date
- customs-duty calculator

## Constraints

- Keep permissions minimal.
- Limit `host_permissions` to `av.by` and `nbrb.by`.
- Prefer resilient DOM matching over brittle class-based selectors.
- Do not add frameworks or build tooling unless required to run the MVP.
- Settings changes should update visible prices without a full page reload where possible.

## Architecture

The extension is split into three simple runtime parts:

1. `background.js`
   owns exchange-rate retrieval, caching, alarm-based refresh, and runtime message handlers.
2. `content.js`
   scans `av.by` pages for `BYN` prices, converts values using current settings, injects display nodes, and re-processes dynamic content through `MutationObserver`.
3. `popup.js`
   lets the user choose target currency, switch between automatic and manual rate sources, and save a manual rate.

Shared configuration such as storage keys and default settings should live in a small helper module to avoid duplicating constants across popup, background, and content code.

## File Layout

- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.js`
- `popup.css`
- `storage.js`
- `privacy-policy.html`
- `icons/16.png`
- `icons/48.png`
- `icons/128.png`

## Data Model

### User settings

Stored in `chrome.storage.local`:

- `selectedCurrency`
  allowed values: `USD`, `EUR`, `RUB`
- `rateSource`
  allowed values: `auto`, `manual`
- `manualRates`
  object keyed by currency, for example:
  `{ "USD": 3.2, "EUR": 3.5, "RUB": 0.034 }`

### Cached API data

Stored in `chrome.storage.local`:

- `rates`
  object keyed by currency with numeric values
- `ratesUpdatedAt`
  Unix timestamp in milliseconds

## Exchange Rate Strategy

The extension should attempt to fetch rates from `NBRB` and cache them for 24 hours.

Priority order for conversion:

1. if `rateSource` is `manual` and the selected currency has a valid manual rate, use it
2. otherwise use cached API rates
3. if cache is stale or missing, request fresh rates from `background.js`
4. if no valid rate is available, do not inject a converted price

For MVP, the extension may fetch each required currency from `NBRB` individually if that is simpler than implementing a batch abstraction.

## DOM Parsing Strategy

The content script should not rely on one exact class name or one exact page layout.

Parsing rules:

- inspect likely price-bearing elements in listing cards and vehicle detail pages
- match values that look like `BYN` prices using text heuristics and regex
- normalize values by removing spaces, non-breaking spaces, punctuation noise, and currency markers
- ignore nodes that have already been processed
- avoid rewriting original text
- inject a separate sibling or adjacent element for the converted value

To prevent duplicate rendering, each processed price container should be marked with an internal attribute such as `data-av-ext-processed="true"` or equivalent state.

## Dynamic Content Strategy

`av.by` may load additional cards or rerender parts of the page. The MVP should use `MutationObserver` to watch for added nodes and process only the affected subtree instead of rescanning the entire document on every mutation.

The observer should be debounced or batched enough to avoid obvious performance issues during infinite scroll.

## UI Behavior

The popup should expose exactly these controls:

- target currency selector: `USD`, `EUR`, `RUB`
- source selector: `auto` or `manual`
- numeric input for the manual rate

Behavior rules:

- when user changes settings, save them immediately
- when popup saves a setting, notify active tabs so visible prices are recalculated
- when `manual` is selected without a valid manual rate, the page should not inject misleading values

## Display Rules

- show converted value near the original `BYN` price
- preserve the original page layout as much as possible
- use a visually secondary style so the original price remains primary
- format converted values with simple readable rounding

For MVP, two fractional digits are acceptable for all currencies if no project-specific formatting rule exists.

## Error Handling

- if `NBRB` request fails, keep existing cached value if present
- if no cached value exists and fetch fails, skip injection silently or log a debug message
- if parsing fails for a node, skip that node and continue
- if user enters an invalid manual rate, do not use it for conversion

The MVP should favor graceful degradation over hard failure.

## Testing Strategy

Because this repository currently has no test harness, MVP verification will be lightweight:

- unit-style checks for pure helper logic where practical
- manual verification in Chrome via `Load unpacked`
- manual test matrix:
  search results page,
  vehicle details page,
  account-related page if a visible price exists,
  dynamic loading scenario,
  auto rate scenario,
  manual rate scenario,
  API failure scenario

If a minimal test harness can be added cheaply without build complexity, pure functions such as price normalization and conversion selection should be tested first.

## Success Criteria

- extension loads in Chrome without build tooling
- popup saves settings successfully
- a valid `BYN` price on `av.by` gets a nearby converted value
- switching between `USD`, `EUR`, and `RUB` updates visible values
- manual rate overrides API data
- dynamic content is processed without obvious duplicate injections
- stale or missing rates do not break the page

## Implementation Recommendation

Start with a Chrome-first unpacked extension and implement the smallest working slice in this order:

1. extension scaffold and manifest
2. settings persistence in popup
3. background rate fetch and caching
4. content parsing plus injection
5. runtime updates and mutation handling
6. manual smoke-test pass

## Risks

- `av.by` DOM may vary between listing and detail pages more than expected
- `NBRB` endpoints or currency identifiers may require quick adjustment during implementation
- some price blocks may include formatting that makes naive regex matching too broad

The MVP should therefore prefer narrow, understandable heuristics that can be extended later rather than a large generic parser.
