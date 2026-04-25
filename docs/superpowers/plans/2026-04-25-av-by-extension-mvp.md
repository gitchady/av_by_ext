# AV.by Extension MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome-first unpacked `Manifest V3` extension that converts `BYN` prices on `av.by` into `USD`, `EUR`, or `RUB` using cached `NBRB` rates or manual user rates.

**Architecture:** The MVP uses a small `background` service worker for rates and cache, a `content` script for DOM parsing and injection, and a `popup` UI for settings. Shared storage keys and pure conversion helpers live in one small file so they can be tested separately and reused across scripts.

**Tech Stack:** Chrome Extension Manifest V3, Vanilla JavaScript, `chrome.storage.local`, `chrome.alarms`, `MutationObserver`, Node `node:test`

---

### Task 1: Scaffold the extension and shared helpers

**Files:**
- Create: `manifest.json`
- Create: `storage.js`
- Create: `package.json`
- Create: `tests/storage.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePriceText, convertBynToCurrency, chooseRate } from "../storage.js";

test("normalizePriceText extracts numeric BYN value", () => {
  assert.equal(normalizePriceText("45 000 р."), 45000);
});

test("convertBynToCurrency respects scale", () => {
  assert.equal(convertBynToCurrency(1000, 3.7556, 100), 26625.73224091916);
});

test("chooseRate prefers manual rate", () => {
  assert.deepEqual(
    chooseRate({
      selectedCurrency: "USD",
      rateSource: "manual",
      manualRates: { USD: 3.2 },
      rates: { USD: { rate: 2.8, scale: 1 } }
    }),
    { source: "manual", rate: 3.2, scale: 1 }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because `storage.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
(function initShared(globalScope) {
  const DEFAULT_SETTINGS = {
    selectedCurrency: "USD",
    rateSource: "auto",
    manualRates: {
      USD: "",
      EUR: "",
      RUB: ""
    }
  };

  function normalizePriceText(text) {
    const normalized = String(text).replace(/[^\d.,]/g, "").replace(",", ".");
    const compact = normalized.replace(/\.(?=.*\.)/g, "").replace(/\s+/g, "");
    const digits = compact.replace(/[^\d.]/g, "");
    if (!digits) return null;
    return Number.parseFloat(digits);
  }

  function chooseRate({ selectedCurrency, rateSource, manualRates, rates }) {
    const manualValue = Number.parseFloat(manualRates?.[selectedCurrency]);
    if (rateSource === "manual" && Number.isFinite(manualValue) && manualValue > 0) {
      return { source: "manual", rate: manualValue, scale: 1 };
    }

    const apiRate = rates?.[selectedCurrency];
    if (apiRate && Number.isFinite(apiRate.rate) && apiRate.rate > 0) {
      return { source: "auto", rate: apiRate.rate, scale: apiRate.scale || 1 };
    }

    return null;
  }

  function convertBynToCurrency(bynAmount, officialRate, scale = 1) {
    return bynAmount / (officialRate / scale);
  }

  const api = {
    DEFAULT_SETTINGS,
    normalizePriceText,
    chooseRate,
    convertBynToCurrency
  };

  globalScope.AvByExtShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for `tests/storage.test.js`

- [ ] **Step 5: Commit**

```bash
git add manifest.json storage.js package.json tests/storage.test.js
git commit -m "feat: scaffold extension helpers"
```

### Task 2: Build the popup settings flow

**Files:**
- Create: `popup.html`
- Create: `popup.css`
- Create: `popup.js`
- Modify: `manifest.json`

- [ ] **Step 1: Write the failing test**

```js
test("DEFAULT_SETTINGS uses USD and auto source", () => {
  assert.equal(shared.DEFAULT_SETTINGS.selectedCurrency, "USD");
  assert.equal(shared.DEFAULT_SETTINGS.rateSource, "auto");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL if the exported defaults do not match the popup assumptions.

- [ ] **Step 3: Write minimal implementation**

```html
<form id="settings-form">
  <label>
    Currency
    <select id="currency">
      <option value="USD">USD</option>
      <option value="EUR">EUR</option>
      <option value="RUB">RUB</option>
    </select>
  </label>
  <label>
    Source
    <select id="rate-source">
      <option value="auto">Auto</option>
      <option value="manual">Manual</option>
    </select>
  </label>
  <label>
    Manual rate
    <input id="manual-rate" type="number" min="0" step="0.0001" />
  </label>
</form>
```

```js
document.addEventListener("DOMContentLoaded", async () => {
  const shared = globalThis.AvByExtShared;
  const settings = await shared.getSettings();
  // populate controls, persist on change, notify tabs
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS and popup assumptions remain aligned with defaults.

- [ ] **Step 5: Commit**

```bash
git add manifest.json popup.html popup.css popup.js storage.js tests/storage.test.js
git commit -m "feat: add popup settings"
```

### Task 3: Add background rate fetching and caching

**Files:**
- Create: `background.js`
- Modify: `manifest.json`
- Modify: `storage.js`
- Test: `tests/storage.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("isRateCacheFresh returns false for stale timestamp", () => {
  const stale = Date.now() - (25 * 60 * 60 * 1000);
  assert.equal(shared.isRateCacheFresh(stale), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because `isRateCacheFresh` is not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```js
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isRateCacheFresh(timestamp) {
  return Number.isFinite(timestamp) && (Date.now() - timestamp) < CACHE_TTL_MS;
}

async function fetchCurrencyRate(currency) {
  const response = await fetch(`https://api.nbrb.by/exrates/rates/${currency}?parammode=2`);
  const payload = await response.json();
  return {
    rate: payload.Cur_OfficialRate,
    scale: payload.Cur_Scale,
    date: payload.Date
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS and cache freshness helper works.

- [ ] **Step 5: Commit**

```bash
git add background.js manifest.json storage.js tests/storage.test.js
git commit -m "feat: add cached exchange rate fetching"
```

### Task 4: Implement price parsing and page injection

**Files:**
- Create: `content.js`
- Modify: `manifest.json`
- Modify: `storage.js`
- Test: `tests/storage.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("formatConvertedPrice rounds to two decimals", () => {
  assert.equal(shared.formatConvertedPrice(1234.567, "USD"), "USD 1234.57");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because `formatConvertedPrice` is not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```js
function formatConvertedPrice(amount, currency) {
  return `${currency} ${amount.toFixed(2)}`;
}

function injectConvertedPrice(targetNode, text) {
  let badge = targetNode.parentElement?.querySelector(".av-ext-converted-price");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "av-ext-converted-price";
    targetNode.insertAdjacentElement("afterend", badge);
  }
  badge.textContent = text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS and formatting helper works.

- [ ] **Step 5: Commit**

```bash
git add content.js manifest.json storage.js tests/storage.test.js
git commit -m "feat: inject converted prices on av.by"
```

### Task 5: Wire live updates, privacy policy, and verification docs

**Files:**
- Create: `privacy-policy.html`
- Create: `README.md`
- Modify: `background.js`
- Modify: `content.js`
- Modify: `popup.js`

- [ ] **Step 1: Write the failing test**

```js
test("chooseRate returns null when manual source has invalid value and cache is missing", () => {
  assert.equal(
    shared.chooseRate({
      selectedCurrency: "EUR",
      rateSource: "manual",
      manualRates: { EUR: "" },
      rates: {}
    }),
    null
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL if rate-selection edge cases are still wrong.

- [ ] **Step 3: Write minimal implementation**

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "settingsUpdated") {
    // refresh active state or cached settings
    sendResponse({ ok: true });
  }
});
```

```md
# AV.by Currency Converter Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS and setup instructions are ready for manual smoke testing.

- [ ] **Step 5: Commit**

```bash
git add README.md privacy-policy.html background.js content.js popup.js tests/storage.test.js
git commit -m "feat: finalize extension mvp"
```
