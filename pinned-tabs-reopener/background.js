const STORAGE_KEY = "pinnedTabs";
const REOPEN_DEDUP_MS = 2500;

let pinnedTabs = {};
const reopenInProgress = new Set();
const recentRemovals = new Map();

const initialization = loadPinnedTabs();

browser.runtime.onInstalled.addListener(async () => {
  await initialization;
  console.log("[Pinned Tabs Reopener] Installed and ready.");
});

browser.runtime.onMessage.addListener((message) => handleMessage(message));
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleTabUpdated(tabId, changeInfo, tab);
});
browser.tabs.onMoved.addListener((tabId, moveInfo) => {
  void handleTabMoved(tabId, moveInfo);
});
browser.tabs.onAttached.addListener((tabId, attachInfo) => {
  void handleTabAttached(tabId, attachInfo);
});
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void handleTabRemoved(tabId, removeInfo);
});

async function loadPinnedTabs() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  pinnedTabs = stored[STORAGE_KEY] || {};
}

async function savePinnedTabs() {
  await browser.storage.local.set({ [STORAGE_KEY]: pinnedTabs });
}

function createPinId() {
  return `pin-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildMetadata(tab) {
  return {
    tabId: typeof tab.id === "number" ? tab.id : null,
    title: normalizeOptionalString(tab.title) || "Untitled tab",
    url: normalizeOptionalString(tab.url),
    windowId: typeof tab.windowId === "number" ? tab.windowId : undefined,
    index: typeof tab.index === "number" ? tab.index : undefined,
    type: normalizeOptionalString(tab.type),
    favIconUrl: normalizeOptionalString(tab.favIconUrl),
    cookieStoreId: normalizeOptionalString(tab.cookieStoreId),
    spaceId: typeof tab.spaceId === "number" ? tab.spaceId : undefined,
    status: normalizeOptionalString(tab.status)
  };
}

function cloneRecord(record) {
  return { ...record };
}

function listPinnedRecords() {
  return Object.values(pinnedTabs)
    .map(cloneRecord)
    .sort((a, b) => {
      const leftLabel = (a.alias || a.title || "").toLocaleLowerCase();
      const rightLabel = (b.alias || b.title || "").toLocaleLowerCase();
      if (leftLabel !== rightLabel) {
        return leftLabel.localeCompare(rightLabel);
      }
      const leftWindow = typeof a.windowId === "number" ? a.windowId : Number.MAX_SAFE_INTEGER;
      const rightWindow = typeof b.windowId === "number" ? b.windowId : Number.MAX_SAFE_INTEGER;
      if (leftWindow !== rightWindow) {
        return leftWindow - rightWindow;
      }
      const leftIndex = typeof a.index === "number" ? a.index : Number.MAX_SAFE_INTEGER;
      const rightIndex = typeof b.index === "number" ? b.index : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return a.title.localeCompare(b.title);
    });
}

function getPinnedRecordByTabId(tabId) {
  return Object.values(pinnedTabs).find((record) => record.tabId === tabId) || null;
}

function isTabRestorable(record) {
  return Boolean(record.url);
}

function buildRestoreFailure(record, reason) {
  return `${reason} Thunderbird only exposes generic restoration through tabs.create()/windows.create({ url }), and this tab type may not provide a reusable URL.`;
}

function rememberRecentRemoval(pinId, removedTabId) {
  recentRemovals.set(pinId, {
    tabId: removedTabId,
    until: Date.now() + REOPEN_DEDUP_MS
  });
}

function hasRecentRemoval(pinId, removedTabId) {
  const recent = recentRemovals.get(pinId);
  if (!recent) {
    return false;
  }
  if (recent.until < Date.now()) {
    recentRemovals.delete(pinId);
    return false;
  }
  return recent.tabId === removedTabId;
}

async function queryActiveTab() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0] || null;
}

async function handleMessage(message) {
  await initialization;

  switch (message && message.type) {
    case "getPopupState":
      return getPopupState();
    case "toggleActiveTabPin":
      return toggleActiveTabPin();
    case "setPinAlias":
      return setPinAlias(message.pinId, message.alias);
    case "unpinById":
      return unpinById(message.pinId);
    default:
      return {
        ok: false,
        error: "Unknown message type."
      };
  }
}

async function getPopupState() {
  const activeTab = await queryActiveTab();
  const activePin = activeTab && typeof activeTab.id === "number"
    ? getPinnedRecordByTabId(activeTab.id)
    : null;

  return {
    ok: true,
    activeTab: activeTab ? buildMetadata(activeTab) : null,
    activePinId: activePin ? activePin.pinId : null,
    pinnedTabs: listPinnedRecords()
  };
}

async function toggleActiveTabPin() {
  const activeTab = await queryActiveTab();
  if (!activeTab || typeof activeTab.id !== "number") {
    return {
      ok: false,
      error: "No active Thunderbird tab is available to pin."
    };
  }

  console.log("[Pinned Tabs Reopener] Active tab metadata:", activeTab);

  const existing = getPinnedRecordByTabId(activeTab.id);
  if (existing) {
    delete pinnedTabs[existing.pinId];
    await savePinnedTabs();
    return {
      ok: true,
      action: "unpinned",
      pinId: existing.pinId,
      pinnedTabs: listPinnedRecords()
    };
  }

  const record = {
    pinId: createPinId(),
    ...buildMetadata(activeTab),
    alias: "",
    lastError: null,
    lastReopenedAt: null
  };

  pinnedTabs[record.pinId] = record;
  await savePinnedTabs();

  return {
    ok: true,
    action: "pinned",
    pinId: record.pinId,
    pinnedTabs: listPinnedRecords()
  };
}

async function unpinById(pinId) {
  await initialization;

  if (!pinId || !pinnedTabs[pinId]) {
    return {
      ok: false,
      error: "Pinned tab record not found."
    };
  }

  delete pinnedTabs[pinId];
  reopenInProgress.delete(pinId);
  recentRemovals.delete(pinId);
  await savePinnedTabs();

  return {
    ok: true,
    action: "unpinned",
    pinId,
    pinnedTabs: listPinnedRecords()
  };
}

async function setPinAlias(pinId, alias) {
  await initialization;

  if (!pinId || !pinnedTabs[pinId]) {
    return {
      ok: false,
      error: "Pinned tab record not found."
    };
  }

  const normalizedAlias = typeof alias === "string" ? alias.trim() : "";
  await updateRecord(pinId, {
    alias: normalizedAlias
  });

  return {
    ok: true,
    action: "alias-updated",
    pinId,
    alias: normalizedAlias,
    pinnedTabs: listPinnedRecords()
  };
}

async function updateRecord(pinId, patch) {
  const current = pinnedTabs[pinId];
  if (!current) {
    return;
  }

  pinnedTabs[pinId] = {
    ...current,
    ...patch
  };
  await savePinnedTabs();
}

async function refreshPinnedRecordFromTab(pinId, tab, extraPatch = {}) {
  const current = pinnedTabs[pinId];
  if (!current) {
    return;
  }

  pinnedTabs[pinId] = {
    ...current,
    ...buildMetadata(tab),
    ...extraPatch
  };
  await savePinnedTabs();
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  await initialization;

  const record = getPinnedRecordByTabId(tabId);
  if (!record) {
    return;
  }

  const patch = {};
  if ("title" in changeInfo && normalizeOptionalString(tab.title)) {
    patch.title = tab.title;
  }
  if ("url" in changeInfo) {
    patch.url = normalizeOptionalString(tab.url);
  }
  if ("favIconUrl" in changeInfo) {
    patch.favIconUrl = normalizeOptionalString(tab.favIconUrl);
  }
  if ("status" in changeInfo) {
    patch.status = normalizeOptionalString(tab.status);
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  await updateRecord(record.pinId, patch);
}

async function handleTabMoved(tabId, moveInfo) {
  await initialization;

  const record = getPinnedRecordByTabId(tabId);
  if (!record) {
    return;
  }

  await updateRecord(record.pinId, {
    index: moveInfo.toIndex,
    windowId: moveInfo.windowId
  });
}

async function handleTabAttached(tabId, attachInfo) {
  await initialization;

  const record = getPinnedRecordByTabId(tabId);
  if (!record) {
    return;
  }

  try {
    const tab = await browser.tabs.get(tabId);
    await refreshPinnedRecordFromTab(record.pinId, tab, {
      windowId: attachInfo.newWindowId,
      index: attachInfo.newPosition
    });
  } catch (error) {
    console.warn("[Pinned Tabs Reopener] Could not refresh attached pinned tab:", error);
  }
}

async function handleTabRemoved(tabId, removeInfo) {
  await initialization;

  const record = getPinnedRecordByTabId(tabId);
  if (!record) {
    return;
  }

  if (reopenInProgress.has(record.pinId) || hasRecentRemoval(record.pinId, tabId)) {
    return;
  }

  rememberRecentRemoval(record.pinId, tabId);
  reopenInProgress.add(record.pinId);

  try {
    // Thunderbird's generic tabs API does not offer a cancelable "before close"
    // hook, so the extension restores pinned tabs after onRemoved fires.
    const restored = await reopenPinnedTab(record, removeInfo);
    if (!restored) {
      await updateRecord(record.pinId, {
        tabId: null
      });
    }
  } finally {
    reopenInProgress.delete(record.pinId);
  }
}

async function reopenPinnedTab(record, removeInfo) {
  if (!isTabRestorable(record)) {
    const message = buildRestoreFailure(
      record,
      "Pinned tab cannot be reopened automatically because Thunderbird did not expose a restorable URL."
    );
    console.warn("[Pinned Tabs Reopener]", message, record);
    await updateRecord(record.pinId, {
      tabId: null,
      lastError: message
    });
    return false;
  }

  const restoreAttempts = [];
  if (!removeInfo.isWindowClosing && typeof record.windowId === "number") {
    restoreAttempts.push(() =>
      browser.tabs.create({
        url: record.url,
        windowId: record.windowId,
        index: record.index,
        active: true
      })
    );
  }

  // Thunderbird documents tabs.create() as creating content tabs. We still try
  // the generic path for chat/add-on/content tabs because that is the only
  // restore surface available without falling back to mailTabs-specific APIs.
  restoreAttempts.push(async () => {
    const fallbackWindowId = await findFallbackWindowId(record.windowId);
    if (typeof fallbackWindowId === "number") {
      return browser.tabs.create({
        url: record.url,
        windowId: fallbackWindowId,
        index: record.index,
        active: true
      });
    }
    const createdWindow = await browser.windows.create({
      type: "normal",
      url: record.url
    });
    if (createdWindow.tabs && createdWindow.tabs.length > 0) {
      return createdWindow.tabs[0];
    }
    const tabs = await browser.tabs.query({
      active: true,
      windowId: createdWindow.id
    });
    return tabs[0] || null;
  });

  let lastError = null;

  for (const attempt of restoreAttempts) {
    try {
      const reopenedTab = await attempt();
      if (!reopenedTab) {
        continue;
      }

      await refreshPinnedRecordFromTab(record.pinId, reopenedTab, {
        lastError: null,
        lastReopenedAt: Date.now()
      });

      console.log("[Pinned Tabs Reopener] Reopened pinned tab:", reopenedTab);
      return true;
    } catch (error) {
      lastError = error;
      console.warn("[Pinned Tabs Reopener] Reopen attempt failed:", error);
    }
  }

  const message = buildRestoreFailure(
    record,
    `Pinned tab could not be reopened automatically.${lastError ? ` Last Thunderbird error: ${lastError.message || String(lastError)}` : ""}`
  );
  console.warn("[Pinned Tabs Reopener]", message, record);
  await updateRecord(record.pinId, {
    tabId: null,
    lastError: message
  });
  return false;
}

async function findFallbackWindowId(preferredWindowId) {
  try {
    const windows = await browser.windows.getAll({
      populate: false,
      windowTypes: ["normal"]
    });

    const preferred = windows.find((windowInfo) => windowInfo.id === preferredWindowId);
    if (preferred) {
      return preferred.id;
    }

    return windows.length > 0 ? windows[0].id : null;
  } catch (error) {
    console.warn("[Pinned Tabs Reopener] Could not enumerate Thunderbird windows:", error);
    return null;
  }
}
