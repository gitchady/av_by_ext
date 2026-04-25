const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("../storage.js");

test("normalizePriceText extracts numeric BYN value", () => {
  assert.equal(shared.normalizePriceText("45 000 р."), 45000);
  assert.equal(shared.normalizePriceText("3\u00a0755,60 BYN"), 3755.6);
});

test("convertBynToCurrency respects NBRB scale", () => {
  const amount = shared.convertBynToCurrency(1000, 3.7556, 100);
  assert.equal(amount.toFixed(2), "26626.90");
});

test("chooseRate prefers valid manual rate", () => {
  const freshTimestamp = Date.now() - 60_000;

  assert.deepEqual(
    shared.chooseRate({
      selectedCurrency: "USD",
      rateSource: "manual",
      manualRates: { USD: "3.2" },
      rates: { USD: { rate: 2.8, scale: 1, fetchedAt: freshTimestamp } }
    }),
    { source: "manual", rate: 3.2, scale: 1 }
  );
});

test("chooseRate returns null for invalid manual mode and uses api rate for auto mode", () => {
  const freshTimestamp = Date.now() - 60_000;
  const staleTimestamp = Date.now() - (25 * 60 * 60 * 1000);

  assert.equal(
    shared.chooseRate({
      selectedCurrency: "EUR",
      rateSource: "manual",
      manualRates: { EUR: "" },
      rates: { EUR: { rate: 3.4, scale: 1, fetchedAt: freshTimestamp } }
    }),
    null
  );

  assert.deepEqual(
    shared.chooseRate({
      selectedCurrency: "EUR",
      rateSource: "auto",
      manualRates: { EUR: "" },
      rates: { EUR: { rate: 3.4, scale: 1, fetchedAt: freshTimestamp } }
    }),
    { source: "auto", rate: 3.4, scale: 1 }
  );

  assert.equal(
    shared.chooseRate({
      selectedCurrency: "EUR",
      rateSource: "auto",
      manualRates: { EUR: "" },
      rates: { EUR: { rate: 3.4, scale: 1, fetchedAt: staleTimestamp } }
    }),
    null
  );
});

test("cache freshness and formatting helpers behave predictably", () => {
  const freshTimestamp = Date.now() - 60_000;
  const staleTimestamp = Date.now() - (25 * 60 * 60 * 1000);

  assert.equal(shared.isRateCacheFresh(freshTimestamp), true);
  assert.equal(shared.isRateCacheFresh(staleTimestamp), false);
  assert.equal(shared.formatConvertedPrice(1234.567, "USD"), "USD 1,234.57");
});

test("extractBynPriceFromText finds BYN-looking amounts", () => {
  assert.equal(shared.extractBynPriceFromText("45 000 р."), 45000);
  assert.equal(shared.extractBynPriceFromText("Цена: 52 300 BYN"), 52300);
  assert.equal(shared.extractBynPriceFromText("Пробег 120 000 км"), null);
});

test("hasFreshRate checks per-currency freshness", () => {
  const now = 1_000_000;

  assert.equal(
    shared.hasFreshRate({ rate: 2.8, scale: 1, fetchedAt: now - 60_000 }, now),
    true
  );
  assert.equal(
    shared.hasFreshRate({ rate: 2.8, scale: 1, fetchedAt: now - (25 * 60 * 60 * 1000) }, now),
    false
  );
  assert.equal(shared.hasFreshRate(null, now), false);
});

test("mergeRates preserves cached currencies during partial refresh", () => {
  const merged = shared.mergeRates(
    {
      USD: { rate: 2.8, scale: 1, fetchedAt: 1 },
      RUB: { rate: 3.7, scale: 100, fetchedAt: 1 }
    },
    {
      USD: { rate: 2.9, scale: 1, fetchedAt: 2 },
      EUR: { rate: 3.3, scale: 1, fetchedAt: 2 }
    }
  );

  assert.deepEqual(merged, {
    USD: { rate: 2.9, scale: 1, date: "", fetchedAt: 2 },
    RUB: { rate: 3.7, scale: 100, date: "", fetchedAt: 1 },
    EUR: { rate: 3.3, scale: 1, date: "", fetchedAt: 2 }
  });
});

test("haveRatesChanged ignores fetchedAt-only refreshes and detects real changes", () => {
  const previousRates = {
    USD: { rate: 2.8, scale: 1, date: "2026-04-25", fetchedAt: 10 },
    EUR: { rate: 3.3, scale: 1, date: "2026-04-25", fetchedAt: 10 }
  };

  assert.equal(
    shared.haveRatesChanged(previousRates, {
      USD: { rate: 2.8, scale: 1, date: "2026-04-25", fetchedAt: 20 },
      EUR: { rate: 3.3, scale: 1, date: "2026-04-25", fetchedAt: 20 }
    }),
    false
  );

  assert.equal(
    shared.haveRatesChanged(previousRates, {
      USD: { rate: 2.9, scale: 1, date: "2026-04-26", fetchedAt: 20 },
      EUR: { rate: 3.3, scale: 1, date: "2026-04-25", fetchedAt: 20 }
    }),
    true
  );
});
