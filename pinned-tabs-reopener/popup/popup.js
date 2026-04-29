const activeTabCard = document.getElementById("active-tab-card");
const pinnedTabsList = document.getElementById("pinned-tabs-list");
const pinCount = document.getElementById("pin-count");
const statusMessage = document.getElementById("status-message");
const refreshButton = document.getElementById("refresh-button");
const pinnedTabTemplate = document.getElementById("pinned-tab-template");

refreshButton.addEventListener("click", () => {
  void refreshPopup();
});

document.addEventListener("click", (event) => {
  const toggleButton = event.target.closest("[data-action='toggle-active-tab']");
  if (toggleButton) {
    void runAction(toggleButton, { type: "toggleActiveTabPin" });
    return;
  }

  const unpinButton = event.target.closest("[data-action='unpin']");
  if (unpinButton) {
    void runAction(unpinButton, {
      type: "unpinById",
      pinId: unpinButton.dataset.pinId
    });
  }

  const clearAliasButton = event.target.closest("[data-action='clear-alias']");
  if (clearAliasButton) {
    const form = clearAliasButton.closest(".alias-form");
    if (!form) {
      return;
    }
    const input = form.querySelector(".alias-input");
    if (!input) {
      return;
    }
    input.value = "";
    void runAction(clearAliasButton, {
      type: "setPinAlias",
      pinId: clearAliasButton.dataset.pinId,
      alias: ""
    });
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest(".alias-form");
  if (!form) {
    return;
  }

  event.preventDefault();
  const input = form.querySelector(".alias-input");
  const saveButton = form.querySelector(".alias-save-button");
  if (!input || !saveButton) {
    return;
  }

  void runAction(saveButton, {
    type: "setPinAlias",
    pinId: form.dataset.pinId,
    alias: input.value
  });
});

document.addEventListener("DOMContentLoaded", () => {
  void refreshPopup();
});

async function refreshPopup() {
  clearStatus();

  try {
    const response = await browser.runtime.sendMessage({ type: "getPopupState" });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Could not load popup state.");
    }

    renderActiveTab(response.activeTab, response.activePinId);
    renderPinnedTabs(response.pinnedTabs || []);
  } catch (error) {
    showStatus(error.message || String(error));
    renderActiveTab(null, null);
    renderPinnedTabs([]);
  }
}

async function runAction(button, message) {
  button.disabled = true;
  clearStatus();

  try {
    const response = await browser.runtime.sendMessage(message);
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Action failed.");
    }
    await refreshPopup();
  } catch (error) {
    showStatus(error.message || String(error));
  } finally {
    button.disabled = false;
  }
}

function renderActiveTab(activeTab, activePinId) {
  activeTabCard.replaceChildren();

  if (!activeTab) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No active Thunderbird tab is available.";
    activeTabCard.append(empty);
    return;
  }

  const title = document.createElement("h3");
  title.className = "active-tab-title";
  title.textContent = activeTab.title || "Untitled tab";

  const url = document.createElement("div");
  url.className = `active-tab-url${activeTab.url ? "" : " is-missing"}`;
  url.textContent = activeTab.url || "No restorable URL exposed by Thunderbird for this tab.";

  const meta = document.createElement("div");
  meta.className = "active-tab-meta";
  meta.textContent = formatMeta(activeTab);

  const buttonRow = document.createElement("div");
  buttonRow.className = "active-tab-actions";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.dataset.action = "toggle-active-tab";
  toggleButton.textContent = activePinId ? "Unpin Active Tab" : "Pin Active Tab";
  buttonRow.append(toggleButton);

  activeTabCard.append(title, url, meta, buttonRow);
}

function renderPinnedTabs(pinnedTabs) {
  pinCount.textContent = String(pinnedTabs.length);
  pinnedTabsList.replaceChildren();

  if (pinnedTabs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No pinned tabs yet.";
    pinnedTabsList.append(empty);
    return;
  }

  for (const record of pinnedTabs) {
    const fragment = pinnedTabTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".pin-row");
    const alias = fragment.querySelector(".pin-alias");
    const title = fragment.querySelector(".pin-title");
    const type = fragment.querySelector(".pin-type");
    const url = fragment.querySelector(".pin-url");
    const meta = fragment.querySelector(".pin-meta");
    const status = fragment.querySelector(".pin-status");
    const button = fragment.querySelector(".unpin-button");
    const aliasForm = fragment.querySelector(".alias-form");
    const aliasInput = fragment.querySelector(".alias-input");
    const clearAliasButton = fragment.querySelector(".alias-clear-button");

    alias.textContent = record.alias ? `Alias: ${record.alias}` : "Alias: none";
    title.textContent = record.title || "Untitled tab";
    title.title = record.title || "Untitled tab";
    type.textContent = record.type || "unknown";
    url.textContent = record.url || "No restorable URL available.";
    if (!record.url) {
      url.classList.add("is-missing");
    }

    meta.textContent = formatMeta(record);
    status.textContent = formatStatus(record);
    if (record.lastError || !record.url) {
      status.classList.add("is-warning");
    }

    button.dataset.action = "unpin";
    button.dataset.pinId = record.pinId;
    aliasForm.dataset.pinId = record.pinId;
    aliasInput.value = record.alias || "";
    clearAliasButton.dataset.action = "clear-alias";
    clearAliasButton.dataset.pinId = record.pinId;
    row.dataset.pinId = record.pinId;
    pinnedTabsList.append(fragment);
  }
}

function formatMeta(tabLike) {
  const parts = [];
  if (tabLike.type) {
    parts.push(`type: ${tabLike.type}`);
  }
  if (typeof tabLike.windowId === "number") {
    parts.push(`window: ${tabLike.windowId}`);
  }
  if (typeof tabLike.index === "number") {
    parts.push(`index: ${tabLike.index}`);
  }
  if (typeof tabLike.tabId === "number") {
    parts.push(`tab id: ${tabLike.tabId}`);
  }
  return parts.length > 0 ? parts.join(" • ") : "Thunderbird did not expose extra tab metadata.";
}

function formatStatus(record) {
  if (record.lastError) {
    return record.lastError;
  }
  if (!record.url) {
    return "Not restorable automatically.";
  }
  if (record.lastReopenedAt) {
    return `Last reopened: ${new Date(record.lastReopenedAt).toLocaleString()}`;
  }
  return "Ready to reopen automatically after close.";
}

function showStatus(message) {
  statusMessage.hidden = false;
  statusMessage.textContent = message;
}

function clearStatus() {
  statusMessage.hidden = true;
  statusMessage.textContent = "";
}
