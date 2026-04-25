(function initShared(globalScope) {
  const SUPPORTED_CURRENCIES = ["USD", "EUR", "RUB"];
  const STORAGE_KEYS = {
    settings: "settings",
    rateCache: "rateCache"
  };
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_SETTINGS = {
    enabled: true,
    selectedCurrency: "USD",
    rateSource: "auto",
    manualRates: {
      USD: "",
      EUR: "",
      RUB: ""
    }
  };

  function getStorageArea() {
    return globalScope.chrome && globalScope.chrome.storage && globalScope.chrome.storage.local
      ? globalScope.chrome.storage.local
      : null;
  }

  function isValidCurrency(currency) {
    return SUPPORTED_CURRENCIES.includes(currency);
  }

  function isValidRateEntry(entry) {
    return !!entry
      && Number.isFinite(entry.rate)
      && entry.rate > 0
      && Number.isFinite(entry.scale)
      && entry.scale > 0;
  }

  function cloneDefaultSettings() {
    return {
      enabled: DEFAULT_SETTINGS.enabled,
      selectedCurrency: DEFAULT_SETTINGS.selectedCurrency,
      rateSource: DEFAULT_SETTINGS.rateSource,
      manualRates: { ...DEFAULT_SETTINGS.manualRates }
    };
  }

  function sanitizeManualRate(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }

    const normalized = String(value).trim().replace(",", ".");
    const parsed = Number.parseFloat(normalized);

    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
  }

  function sanitizeSettings(rawSettings) {
    const defaults = cloneDefaultSettings();
    const candidate = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const enabled = candidate.enabled !== false;
    const selectedCurrency = isValidCurrency(candidate.selectedCurrency)
      ? candidate.selectedCurrency
      : defaults.selectedCurrency;
    const rateSource = candidate.rateSource === "manual" ? "manual" : "auto";
    const manualRates = { ...defaults.manualRates };

    for (const currency of SUPPORTED_CURRENCIES) {
      manualRates[currency] = sanitizeManualRate(candidate.manualRates && candidate.manualRates[currency]);
    }

    return {
      enabled,
      selectedCurrency,
      rateSource,
      manualRates
    };
  }

  function readStorage(defaultValue) {
    const storage = getStorageArea();

    if (!storage) {
      return Promise.resolve(defaultValue);
    }

    return new Promise((resolve, reject) => {
      storage.get(defaultValue, (result) => {
        const error = globalScope.chrome && globalScope.chrome.runtime && globalScope.chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(result);
      });
    });
  }

  function writeStorage(values) {
    const storage = getStorageArea();

    if (!storage) {
      return Promise.resolve(values);
    }

    return new Promise((resolve, reject) => {
      storage.set(values, () => {
        const error = globalScope.chrome && globalScope.chrome.runtime && globalScope.chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(values);
      });
    });
  }

  async function getSettings() {
    const stored = await readStorage({
      [STORAGE_KEYS.settings]: cloneDefaultSettings()
    });

    return sanitizeSettings(stored[STORAGE_KEYS.settings]);
  }

  async function saveSettings(partialSettings) {
    const currentSettings = await getSettings();
    const mergedManualRates = {
      ...currentSettings.manualRates,
      ...((partialSettings && partialSettings.manualRates) || {})
    };
    const nextSettings = sanitizeSettings({
      ...currentSettings,
      ...partialSettings,
      manualRates: mergedManualRates
    });

    await writeStorage({
      [STORAGE_KEYS.settings]: nextSettings
    });

    return nextSettings;
  }

  async function getRateCache() {
    const stored = await readStorage({
      [STORAGE_KEYS.rateCache]: {
        rates: {},
        ratesUpdatedAt: 0
      }
    });
    const cache = stored[STORAGE_KEYS.rateCache] || {};

    return {
      rates: mergeRates({}, cache.rates),
      ratesUpdatedAt: Number.isFinite(cache.ratesUpdatedAt) ? cache.ratesUpdatedAt : 0
    };
  }

  async function saveRateCache(rateCache) {
    const nextCache = {
      rates: mergeRates({}, rateCache && rateCache.rates),
      ratesUpdatedAt: Number.isFinite(rateCache && rateCache.ratesUpdatedAt) ? rateCache.ratesUpdatedAt : 0
    };

    await writeStorage({
      [STORAGE_KEYS.rateCache]: nextCache
    });

    return nextCache;
  }

  function normalizePriceText(text) {
    if (text === null || text === undefined) {
      return null;
    }

    const compactWhitespace = String(text).replace(/\u00A0/g, " ").trim();
    const match = compactWhitespace.match(/[\d\s.,]+/);
    if (!match) {
      return null;
    }

    let normalized = match[0].replace(/\s+/g, "");
    if (!normalized) {
      return null;
    }

    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");

    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
      } else {
        normalized = normalized.replace(/,/g, "");
      }
    } else if (lastComma !== -1) {
      const decimalDigits = normalized.length - lastComma - 1;
      normalized = decimalDigits > 0 && decimalDigits <= 2
        ? normalized.replace(",", ".")
        : normalized.replace(/,/g, "");
    } else if (lastDot !== -1) {
      const decimalDigits = normalized.length - lastDot - 1;
      if (decimalDigits > 2 || decimalDigits === 0) {
        normalized = normalized.replace(/\./g, "");
      }
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function extractBynPriceFromText(text) {
    if (text === null || text === undefined) {
      return null;
    }

    const priceMatch = String(text).match(/(\d[\d\s\u00A0.,]*)\s*(?:р\.|BYN|бел(?:орус(?:ских|ских))?\s*руб(?:лей|\.|))/iu);
    if (!priceMatch) {
      return null;
    }

    return normalizePriceText(priceMatch[1]);
  }

  function chooseRate({ selectedCurrency, rateSource, manualRates, rates }) {
    if (!isValidCurrency(selectedCurrency)) {
      return null;
    }

    const manualValue = Number.parseFloat(sanitizeManualRate(manualRates && manualRates[selectedCurrency]));
    if (rateSource === "manual") {
      if (Number.isFinite(manualValue) && manualValue > 0) {
        return {
          source: "manual",
          rate: manualValue,
          scale: 1
        };
      }

      return null;
    }

    const apiRate = rates && rates[selectedCurrency];
    if (hasFreshRate(apiRate)) {
      return {
        source: "auto",
        rate: apiRate.rate,
        scale: apiRate.scale
      };
    }

    return null;
  }

  function convertBynToCurrency(bynAmount, officialRate, scale = 1) {
    if (!Number.isFinite(bynAmount) || !Number.isFinite(officialRate) || !Number.isFinite(scale) || officialRate <= 0 || scale <= 0) {
      return null;
    }

    return bynAmount / (officialRate / scale);
  }

  function isRateCacheFresh(timestamp) {
    return Number.isFinite(timestamp) && (Date.now() - timestamp) < CACHE_TTL_MS;
  }

  function hasFreshRate(entry, now = Date.now()) {
    return isValidRateEntry(entry)
      && Number.isFinite(entry.fetchedAt)
      && (now - entry.fetchedAt) < CACHE_TTL_MS;
  }

  function mergeRates(existingRates, nextRates) {
    const merged = {};

    for (const source of [existingRates, nextRates]) {
      if (!source || typeof source !== "object") {
        continue;
      }

      for (const currency of SUPPORTED_CURRENCIES) {
        const entry = source[currency];
        if (!isValidRateEntry(entry)) {
          continue;
        }

        merged[currency] = {
          rate: entry.rate,
          scale: entry.scale,
          date: entry.date || "",
          fetchedAt: Number.isFinite(entry.fetchedAt) ? entry.fetchedAt : 0
        };
      }
    }

    return merged;
  }

  function haveRatesChanged(previousRates, nextRates) {
    const previous = mergeRates({}, previousRates);
    const next = mergeRates({}, nextRates);

    return SUPPORTED_CURRENCIES.some((currency) => {
      const previousEntry = previous[currency];
      const nextEntry = next[currency];

      if (!previousEntry && !nextEntry) {
        return false;
      }

      if (!previousEntry || !nextEntry) {
        return true;
      }

      return previousEntry.rate !== nextEntry.rate
        || previousEntry.scale !== nextEntry.scale
        || previousEntry.date !== nextEntry.date;
    });
  }

  function formatConvertedPrice(amount, currency) {
    if (!Number.isFinite(amount) || !isValidCurrency(currency)) {
      return "";
    }

    const formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return `${currency} ${formatter.format(amount)}`;
  }

  const api = {
    CACHE_TTL_MS,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    SUPPORTED_CURRENCIES,
    chooseRate,
    cloneDefaultSettings,
    convertBynToCurrency,
    extractBynPriceFromText,
    formatConvertedPrice,
    getRateCache,
    getSettings,
    hasFreshRate,
    haveRatesChanged,
    isRateCacheFresh,
    isValidRateEntry,
    isValidCurrency,
    mergeRates,
    normalizePriceText,
    sanitizeManualRate,
    sanitizeSettings,
    saveRateCache,
    saveSettings
  };

  globalScope.AvByExtShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
