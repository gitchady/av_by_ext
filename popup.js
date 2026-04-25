(function initPopup(globalScope) {
  const shared = globalScope.AvByExtShared;
  let currentSettings = shared.cloneDefaultSettings();
  let statusTimer = null;

  function setStatus(message) {
    const statusNode = document.getElementById("status");
    statusNode.textContent = message;

    if (statusTimer !== null) {
      globalScope.clearTimeout(statusTimer);
    }

    statusTimer = globalScope.setTimeout(() => {
      statusNode.textContent = "";
    }, 1800);
  }

  function render() {
    const enabledToggle = document.getElementById("enabled-toggle");
    const currencySelect = document.getElementById("currency");
    const sourceSelect = document.getElementById("rate-source");
    const manualRateInput = document.getElementById("manual-rate");
    const manualRateRow = document.getElementById("manual-rate-row");
    const controlsDisabled = !currentSettings.enabled;

    enabledToggle.textContent = currentSettings.enabled
      ? "Включено: нажмите, чтобы отключить"
      : "Отключено: нажмите, чтобы включить";
    enabledToggle.setAttribute("aria-pressed", String(currentSettings.enabled));
    enabledToggle.classList.toggle("toggle-button--enabled", currentSettings.enabled);
    enabledToggle.classList.toggle("toggle-button--disabled", !currentSettings.enabled);
    currencySelect.value = currentSettings.selectedCurrency;
    sourceSelect.value = currentSettings.rateSource;
    manualRateInput.value = currentSettings.manualRates[currentSettings.selectedCurrency] || "";
    currencySelect.disabled = controlsDisabled;
    sourceSelect.disabled = controlsDisabled;
    manualRateInput.disabled = controlsDisabled;
    manualRateRow.classList.toggle("is-hidden", currentSettings.rateSource !== "manual");
  }

  async function notifyOpenAvByTabs() {
    const tabs = await chrome.tabs.query({
      url: [
        "https://av.by/*",
        "https://*.av.by/*"
      ]
    });

    await Promise.all(
      [...new Set(
        tabs
          .filter((tab) => typeof tab.id === "number")
          .map((tab) => tab.id)
      )]
        .filter((tabId) => typeof tabId === "number")
        .map(async (tabId) => {
          try {
            await chrome.tabs.sendMessage(tabId, {
              type: "settingsUpdated"
            });
          } catch (error) {
            void error;
          }
        })
    );
  }

  async function saveAndRender(partialSettings) {
    currentSettings = await shared.saveSettings(partialSettings);
    render();

    try {
      await chrome.runtime.sendMessage({
        type: "settingsUpdated"
      });
    } catch (error) {
      void error;
    }

    await notifyOpenAvByTabs();
    setStatus("Сохранено");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    currentSettings = await shared.getSettings();
    render();

    document.getElementById("enabled-toggle").addEventListener("click", async () => {
      await saveAndRender({
        enabled: !currentSettings.enabled
      });
    });

    document.getElementById("currency").addEventListener("change", async (event) => {
      await saveAndRender({
        selectedCurrency: event.target.value
      });
    });

    document.getElementById("rate-source").addEventListener("change", async (event) => {
      await saveAndRender({
        rateSource: event.target.value
      });
    });

    document.getElementById("manual-rate").addEventListener("change", async (event) => {
      await saveAndRender({
        manualRates: {
          [currentSettings.selectedCurrency]: shared.sanitizeManualRate(event.target.value)
        }
      });
    });
  });
})(globalThis);
