(function initContent(globalScope) {
  const shared = globalScope.AvByExtShared;
  const STYLE_ELEMENT_ID = "av-ext-style";
  const BADGE_CLASS = "av-ext-converted-price";
  const BADGE_OWNER_ATTR = "data-av-ext-owner-id";
  const PRICE_NODE_ATTR = "data-av-ext-price-node-id";
  const observerQueue = new Set();
  let extensionState = {
    settings: shared.cloneDefaultSettings(),
    rates: {}
  };
  let observerTimer = null;
  let nextPriceNodeId = 1;

  function ensureStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
      .${BADGE_CLASS} {
        color: #5b6472;
        font-size: 0.92em;
        line-height: 1.35;
        margin-top: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function isShortPriceText(text) {
    const compact = String(text || "").trim();
    return compact.length > 0 && compact.length <= 24;
  }

  function isInjectedBadgeElement(element) {
    return !!element && (
      element.id === STYLE_ELEMENT_ID
      || element.classList.contains(BADGE_CLASS)
      || element.hasAttribute(BADGE_OWNER_ATTR)
    );
  }

  function isExtensionManagedNode(node) {
    const element = node && node.nodeType === Node.ELEMENT_NODE
      ? node
      : node && node.parentElement;

    return !!element && (
      isInjectedBadgeElement(element)
      || !!element.closest(`.${BADGE_CLASS}`)
    );
  }

  function collectCandidateNodes(root) {
    const nodes = new Set();
    const scanRoot = root && root.nodeType === Node.DOCUMENT_NODE ? root.body : root;

    if (!scanRoot || isExtensionManagedNode(scanRoot)) {
      return [];
    }

    const walker = document.createTreeWalker(
      scanRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          const text = node.textContent || "";

          if (!parent || isExtensionManagedNode(parent) || !isShortPriceText(text)) {
            return NodeFilter.FILTER_SKIP;
          }

          const price = shared.extractBynPriceFromText(text);
          if (!Number.isFinite(price) || price <= 0) {
            return NodeFilter.FILTER_SKIP;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode.parentElement) {
        nodes.add(currentNode.parentElement);
      }
      currentNode = walker.nextNode();
    }

    return Array.from(nodes);
  }

  function getPriceNodeId(node) {
    let nodeId = node.getAttribute(PRICE_NODE_ATTR);
    if (!nodeId) {
      nodeId = `av-ext-price-${nextPriceNodeId++}`;
      node.setAttribute(PRICE_NODE_ATTR, nodeId);
    }

    return nodeId;
  }

  function findInjectedBadge(node) {
    const parent = node.parentElement;
    if (!parent) {
      return null;
    }

    const ownerId = getPriceNodeId(node);
    return parent.querySelector(`.${BADGE_CLASS}[${BADGE_OWNER_ATTR}="${ownerId}"]`);
  }

  function removeInjectedBadge(node) {
    const badge = findInjectedBadge(node);
    if (badge) {
      badge.remove();
    }
  }

  function getBynAmount(node) {
    const sourceText = node.innerText || node.textContent || "";
    const extractedAmount = shared.extractBynPriceFromText(sourceText);
    return Number.isFinite(extractedAmount) && extractedAmount > 0
      ? extractedAmount
      : null;
  }

  function upsertConvertedBadge(node, text) {
    let badge = findInjectedBadge(node);
    if (!badge) {
      badge = document.createElement("div");
      badge.className = BADGE_CLASS;
      badge.setAttribute(BADGE_OWNER_ATTR, getPriceNodeId(node));
      node.insertAdjacentElement("afterend", badge);
    }

    badge.textContent = text;
  }

  function renderNode(node) {
    const amount = getBynAmount(node);
    if (!Number.isFinite(amount) || amount <= 0) {
      removeInjectedBadge(node);
      return;
    }

    const chosenRate = shared.chooseRate({
      selectedCurrency: extensionState.settings.selectedCurrency,
      rateSource: extensionState.settings.rateSource,
      manualRates: extensionState.settings.manualRates,
      rates: extensionState.rates
    });

    if (!chosenRate) {
      removeInjectedBadge(node);
      return;
    }

    const convertedValue = shared.convertBynToCurrency(amount, chosenRate.rate, chosenRate.scale);
    if (!Number.isFinite(convertedValue) || convertedValue <= 0) {
      removeInjectedBadge(node);
      return;
    }

    upsertConvertedBadge(
      node,
      shared.formatConvertedPrice(convertedValue, extensionState.settings.selectedCurrency)
    );
  }

  async function refreshState() {
    const response = await chrome.runtime.sendMessage({ type: "getEffectiveState" });
    if (!response || !response.ok || !response.state) {
      throw new Error(response && response.error ? response.error : "Could not load extension state");
    }

    extensionState = response.state;
  }

  function renderRoot(root) {
    collectCandidateNodes(root).forEach(renderNode);
  }

  async function refreshAndRender(root = document, syncState = true) {
    if (syncState) {
      await refreshState();
    }

    ensureStyles();
    renderRoot(root);
  }

  async function flushObserverQueue() {
    const roots = Array.from(observerQueue);
    observerQueue.clear();
    observerTimer = null;

    const selectedRate = extensionState.rates[extensionState.settings.selectedCurrency];
    if (extensionState.settings.rateSource === "auto" && !shared.hasFreshRate(selectedRate)) {
      await refreshState();
    }

    ensureStyles();

    roots.forEach((root) => {
      renderRoot(root);
    });
  }

  function scheduleRootRender(root) {
    const elementRoot = root && root.nodeType === Node.TEXT_NODE
      ? root.parentElement
      : root;

    if (!elementRoot || isExtensionManagedNode(elementRoot)) {
      return;
    }

    observerQueue.add(elementRoot);
    if (observerTimer !== null) {
      return;
    }

    observerTimer = globalScope.setTimeout(() => {
      flushObserverQueue().catch((error) => {
        console.warn("Could not refresh AV.by prices after mutation", error);
      });
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        scheduleRootRender(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
          scheduleRootRender(node);
        }
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || (message.type !== "settingsUpdated" && message.type !== "ratesUpdated")) {
      return false;
    }

    refreshAndRender(document, true)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));

    return true;
  });

  refreshAndRender(document, true).catch((error) => {
    console.warn("Could not initialize AV.by converter", error);
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
})(globalThis);
