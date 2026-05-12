const SETTINGS_STORAGE_KEY = "settings";
const BLOCK_PAGE_PATH = "blocked/blocked.html";

let settings = OwlTeamsBlockerDefaults.normalizeConfig();
let startupWarning = "";
let initializationPromise = Promise.resolve();

browser.runtime.onInstalled.addListener(() => {
  void initializeExtension();
});

browser.runtime.onMessage.addListener((message) => handleMessage(message));
browser.storage.onChanged.addListener((changes, areaName) => {
  void handleStorageChange(changes, areaName);
});
browser.tabs.onCreated.addListener((tab) => {
  void handleTabCreated(tab);
});
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleTabUpdated(tabId, changeInfo, tab);
});

initializationPromise = initializeExtension();

function initializeExtension() {
  initializationPromise = (async () => {
    startupWarning = "";

    try {
      await loadSettings();
    } catch (error) {
      startupWarning = `Failed to load saved settings: ${error.message || error}`;
      console.error("[Owl Teams Blocker] Settings load failed:", error);
      settings = OwlTeamsBlockerDefaults.normalizeConfig();
    }

    try {
      refreshWebRequestListener();
    } catch (error) {
      startupWarning = appendWarning(
        startupWarning,
        `Failed to register Teams request blocker: ${error.message || error}`
      );
      console.error("[Owl Teams Blocker] webRequest setup failed:", error);
    }

    try {
      await reconcileOpenTabs();
    } catch (error) {
      startupWarning = appendWarning(
        startupWarning,
        `Failed to inspect existing Thunderbird tabs: ${error.message || error}`
      );
      console.error("[Owl Teams Blocker] Tab reconciliation failed:", error);
    }
  })();

  return initializationPromise;
}

function appendWarning(current, next) {
  if (!current) {
    return next;
  }

  return `${current} ${next}`;
}

async function loadSettings() {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  settings = OwlTeamsBlockerDefaults.normalizeConfig(stored[SETTINGS_STORAGE_KEY]);

  if (!stored[SETTINGS_STORAGE_KEY]) {
    await browser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: settings
    });
  }

  return settings;
}

async function saveSettings(nextSettings) {
  settings = OwlTeamsBlockerDefaults.normalizeConfig(nextSettings);
  await browser.storage.local.set({
    [SETTINGS_STORAGE_KEY]: settings
  });
  return settings;
}

async function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !(SETTINGS_STORAGE_KEY in changes)) {
    return;
  }

  settings = OwlTeamsBlockerDefaults.normalizeConfig(
    changes[SETTINGS_STORAGE_KEY].newValue
  );
  try {
    refreshWebRequestListener();
  } catch (error) {
    startupWarning = appendWarning(
      startupWarning,
      `Failed to refresh Teams request blocker: ${error.message || error}`
    );
    console.error("[Owl Teams Blocker] webRequest refresh failed:", error);
  }

  try {
    await reconcileOpenTabs();
  } catch (error) {
    startupWarning = appendWarning(
      startupWarning,
      `Failed to refresh open-tab blocking: ${error.message || error}`
    );
    console.error("[Owl Teams Blocker] Tab refresh failed:", error);
  }
}

function refreshWebRequestListener() {
  if (browser.webRequest.onBeforeRequest.hasListener(handleBeforeRequest)) {
    browser.webRequest.onBeforeRequest.removeListener(handleBeforeRequest);
  }

  browser.webRequest.onBeforeRequest.addListener(
    handleBeforeRequest,
    {
      urls: OwlTeamsHostMatcher.getWebRequestPatterns(settings.hostPatterns)
    },
    ["blocking"]
  );
}

function handleBeforeRequest(details) {
  if (!shouldBlockByConfig(details.url)) {
    return {};
  }

  if (details.type === "main_frame" && typeof details.tabId === "number" && details.tabId >= 0) {
    return {
      redirectUrl: buildBlockedPageUrl(details.url, "request")
    };
  }

  return { cancel: true };
}

async function handleTabCreated(tab) {
  await initializationPromise;
  try {
    await maybeBlockTab(tab, "created");
  } catch (error) {
    console.error("[Owl Teams Blocker] Failed during tab create handling:", error);
  }
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  await initializationPromise;

  if (!("url" in changeInfo) && changeInfo.status !== "complete") {
    return;
  }

  try {
    await maybeBlockTab(tab, "updated");
  } catch (error) {
    console.error("[Owl Teams Blocker] Failed during tab update handling:", error);
  }
}

async function reconcileOpenTabs() {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    try {
      await maybeBlockTab(tab, "reconcile");
    } catch (error) {
      console.error("[Owl Teams Blocker] Failed to inspect existing tab:", error);
    }
  }));
}

function shouldBlockByConfig(url) {
  if (!settings.globalEnabled) {
    return false;
  }

  if (!OwlTeamsHostMatcher.shouldBlockUrl(url, settings.hostPatterns)) {
    return false;
  }

  if (settings.mode === "all") {
    return true;
  }

  return settings.blockedAccountIds.length > 0;
}

async function maybeBlockTab(tab, source) {
  if (!tab || typeof tab.id !== "number" || !shouldBlockByConfig(tab.url)) {
    return;
  }

  if (isBlockedPageUrl(tab.url)) {
    return;
  }

  const blockedPageUrl = buildBlockedPageUrl(tab.url, source);
  try {
    await browser.tabs.update(tab.id, { url: blockedPageUrl });
  } catch (error) {
    console.warn("[Owl Teams Blocker] Failed to redirect tab, closing instead:", error);

    try {
      await browser.tabs.remove(tab.id);
    } catch (removeError) {
      console.error("[Owl Teams Blocker] Failed to close tab:", removeError);
    }
  }
}

function buildBlockedPageUrl(originalUrl, source) {
  const url = new URL(browser.runtime.getURL(BLOCK_PAGE_PATH));
  url.searchParams.set("url", originalUrl || "");
  url.searchParams.set("source", source || "unknown");
  url.searchParams.set("mode", settings.mode);
  url.searchParams.set("fallback", String(isSelectedAccountFallbackActive()));
  return url.toString();
}

function isBlockedPageUrl(rawUrl) {
  return typeof rawUrl === "string" && rawUrl.startsWith(browser.runtime.getURL(BLOCK_PAGE_PATH));
}

function isSelectedAccountFallbackActive() {
  return settings.mode === "selectedAccounts" && settings.blockedAccountIds.length > 0;
}

async function handleMessage(message) {
  try {
    await initializationPromise;
  } catch (error) {
    console.error("[Owl Teams Blocker] Startup promise rejected:", error);
  }

  switch (message && message.type) {
    case "getPopupState":
      return getPopupState();
    case "setGlobalEnabled":
      return updateSettings({ globalEnabled: Boolean(message.value) });
    case "setMode":
      return updateSettings({ mode: message.value });
    case "setBlockedAccountIds":
      return updateSettings({ blockedAccountIds: message.accountIds });
    default:
      return {
        ok: false,
        error: "Unknown message type."
      };
  }
}

async function updateSettings(patch) {
  const nextSettings = OwlTeamsBlockerDefaults.normalizeConfig({
    ...settings,
    ...patch
  });
  await saveSettings(nextSettings);
  try {
    await reconcileOpenTabs();
  } catch (error) {
    startupWarning = appendWarning(
      startupWarning,
      `Failed to apply new settings to open tabs: ${error.message || error}`
    );
    console.error("[Owl Teams Blocker] Failed to apply updated settings:", error);
  }
  return getPopupState();
}

async function getPopupState() {
  const accounts = await listAccountSummaries();

  return {
    ok: true,
    settings,
    accounts,
    accountScopeAvailable: false,
    selectedAccountsFallbackActive: isSelectedAccountFallbackActive(),
    scopeNotice: getScopeNotice(accounts.length),
    startupWarning
  };
}

function getScopeNotice(accountCount) {
  if (settings.mode === "selectedAccounts") {
    if (settings.blockedAccountIds.length === 0) {
      return "Selected-account mode is active, but no accounts are selected, so Teams is not blocked.";
    }

    return "Thunderbird and Owl do not currently expose reliable account metadata for Teams tabs or requests, so selected-account mode falls back to blocking Teams globally.";
  }

  if (accountCount === 0) {
    return "No Thunderbird accounts were exposed to the extension. Global Teams blocking still works.";
  }

  return "Global mode blocks Teams loads for any account Thunderbird opens inside its tab system.";
}

async function listAccountSummaries() {
  if (!browser.accounts || typeof browser.accounts.list !== "function") {
    startupWarning = appendWarning(
      startupWarning,
      "Thunderbird did not expose the accounts API to this add-on."
    );
    return [];
  }

  let accounts;
  try {
    accounts = await browser.accounts.list();
  } catch (error) {
    startupWarning = appendWarning(
      startupWarning,
      `Failed to read Thunderbird accounts: ${error.message || error}`
    );
    console.error("[Owl Teams Blocker] Account listing failed:", error);
    return [];
  }

  return accounts.map((account) => {
    const emails = (account.identities || [])
      .map((identity) => identity.email)
      .filter(Boolean);
    const primaryEmail = emails[0] || "";
    const label = account.name && primaryEmail
      ? `${account.name} (${primaryEmail})`
      : account.name || primaryEmail || `Account ${account.id}`;

    return {
      id: account.id,
      name: account.name || "",
      label,
      type: account.type || "unknown",
      emails
    };
  });
}
