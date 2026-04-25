importScripts("storage.js");

const shared = self.AvByExtShared;
const RATE_ALARM_NAME = "refresh-rates";
const API_BASE_URL = "https://api.nbrb.by/exrates/rates";
const AV_BY_TAB_FILTER = {
  url: [
    "https://av.by/*",
    "https://*.av.by/*"
  ]
};
const inFlightRateRequests = new Map();

async function fetchCurrencyRate(currency) {
  if (inFlightRateRequests.has(currency)) {
    return inFlightRateRequests.get(currency);
  }

  const request = (async () => {
    const response = await fetch(`${API_BASE_URL}/${currency}?parammode=2`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${currency} rate: ${response.status}`);
    }

    const payload = await response.json();

    return {
      rate: payload.Cur_OfficialRate,
      scale: payload.Cur_Scale,
      date: payload.Date,
      fetchedAt: Date.now()
    };
  })();

  inFlightRateRequests.set(currency, request);

  try {
    return await request;
  } finally {
    inFlightRateRequests.delete(currency);
  }
}

function getCurrenciesToRefresh(cache, forceRefresh = false, preferredCurrency = null) {
  const targetCurrencies = preferredCurrency && shared.isValidCurrency(preferredCurrency)
    ? [preferredCurrency]
    : shared.SUPPORTED_CURRENCIES;

  if (forceRefresh) {
    return targetCurrencies;
  }

  return targetCurrencies.filter((currency) => !shared.hasFreshRate(cache.rates[currency]));
}

async function fetchRates(currencies) {
  const results = await Promise.allSettled(
    currencies.map(async (currency) => [currency, await fetchCurrencyRate(currency)])
  );
  const successfulRates = {};
  const failedCurrencies = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const [currency, rate] = result.value;
      successfulRates[currency] = rate;
      continue;
    }

    failedCurrencies.push(String(result.reason));
  }

  return {
    successfulRates,
    failedCurrencies
  };
}

async function ensureRates(forceRefresh = false, preferredCurrency = null) {
  const cache = await shared.getRateCache();
  const currenciesToRefresh = getCurrenciesToRefresh(cache, forceRefresh, preferredCurrency);

  if (!currenciesToRefresh.length) {
    return cache;
  }

  const { successfulRates, failedCurrencies } = await fetchRates(currenciesToRefresh);
  const mergedRates = shared.mergeRates(cache.rates, successfulRates);

  if (!Object.keys(successfulRates).length) {
    if (preferredCurrency && shared.hasFreshRate(mergedRates[preferredCurrency])) {
      return {
        rates: mergedRates,
        ratesUpdatedAt: cache.ratesUpdatedAt
      };
    }

    if (Object.keys(cache.rates).length) {
      return cache;
    }

    throw new Error(`Failed to fetch rates: ${failedCurrencies.join("; ")}`);
  }

  return await shared.saveRateCache({
    rates: mergedRates,
    ratesUpdatedAt: Date.now()
  });
}

async function getEffectiveState() {
  const settings = await shared.getSettings();
  const cache = settings.enabled && settings.rateSource === "auto"
    ? await ensureRates(false, settings.selectedCurrency)
    : await shared.getRateCache();

  return {
    settings,
    rates: cache.rates,
    ratesUpdatedAt: cache.ratesUpdatedAt
  };
}

function scheduleAlarm() {
  chrome.alarms.create(RATE_ALARM_NAME, {
    periodInMinutes: 24 * 60
  });
}

async function notifyOpenAvByTabs(message) {
  const tabs = await chrome.tabs.query(AV_BY_TAB_FILTER);
  const tabIds = [...new Set(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => tab.id)
  )];

  await Promise.all(
    tabIds.map(async (tabId) => {
      try {
        await chrome.tabs.sendMessage(tabId, message);
      } catch (error) {
        void error;
      }
    })
  );
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarm();
  ensureRates(false).catch((error) => {
    console.warn("Initial rates fetch failed", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarm();
  ensureRates(false).catch((error) => {
    console.warn("Startup rates fetch failed", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RATE_ALARM_NAME) {
    return;
  }

  (async () => {
    const previousCache = await shared.getRateCache();
    const nextCache = await ensureRates(true);

    if (shared.haveRatesChanged(previousCache.rates, nextCache.rates)) {
      await notifyOpenAvByTabs({
        type: "ratesUpdated"
      });
    }
  })().catch((error) => {
    console.warn("Scheduled rates refresh failed", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  (async () => {
    if (message.type === "getEffectiveState") {
      const state = await getEffectiveState();
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === "refreshRates") {
      const cache = await ensureRates(true);
      sendResponse({ ok: true, state: cache });
      return;
    }

    if (message.type === "settingsUpdated") {
      const settings = await shared.getSettings();
      if (settings.enabled && settings.rateSource === "auto") {
        await ensureRates(false, settings.selectedCurrency);
      }

      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});
