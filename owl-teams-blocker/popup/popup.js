const globalEnabledInput = document.getElementById("global-enabled");
const modeAllInput = document.getElementById("mode-all");
const modeSelectedInput = document.getElementById("mode-selected");
const scopeNotice = document.getElementById("scope-notice");
const accountsList = document.getElementById("accounts-list");
const accountCount = document.getElementById("account-count");
const hostCount = document.getElementById("host-count");
const hostPatternList = document.getElementById("host-pattern-list");
const refreshButton = document.getElementById("refresh-button");
const statusMessage = document.getElementById("status-message");
const accountTemplate = document.getElementById("account-template");

let popupState = null;

refreshButton.addEventListener("click", () => {
  void refreshPopup();
});

globalEnabledInput.addEventListener("change", () => {
  void runAction({
    type: "setGlobalEnabled",
    value: globalEnabledInput.checked
  });
});

modeAllInput.addEventListener("change", () => {
  if (modeAllInput.checked) {
    void runAction({
      type: "setMode",
      value: "all"
    });
  }
});

modeSelectedInput.addEventListener("change", () => {
  if (modeSelectedInput.checked) {
    void runAction({
      type: "setMode",
      value: "selectedAccounts"
    });
  }
});

accountsList.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".account-checkbox");
  if (!checkbox || !popupState) {
    return;
  }

  const selectedIds = [...accountsList.querySelectorAll(".account-checkbox:checked")]
    .map((input) => input.dataset.accountId)
    .filter(Boolean);

  void runAction({
    type: "setBlockedAccountIds",
    accountIds: selectedIds
  });
});

document.addEventListener("DOMContentLoaded", () => {
  void refreshPopup();
});

async function refreshPopup() {
  clearStatus();

  try {
    const response = await browser.runtime.sendMessage({
      type: "getPopupState"
    });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Could not load popup state.");
    }

    popupState = response;
    renderState(response);
  } catch (error) {
    showStatus(error.message || String(error));
  }
}

async function runAction(message) {
  setBusy(true);
  clearStatus();

  try {
    const response = await browser.runtime.sendMessage(message);
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Action failed.");
    }

    popupState = response;
    renderState(response);
  } catch (error) {
    showStatus(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function renderState(state) {
  const { settings, accounts } = state;

  globalEnabledInput.checked = settings.globalEnabled;
  modeAllInput.checked = settings.mode === "all";
  modeSelectedInput.checked = settings.mode === "selectedAccounts";
  scopeNotice.textContent = state.scopeNotice || "";
  if (state.startupWarning) {
    showStatus(state.startupWarning);
  }

  renderAccounts(accounts || [], settings);
  renderHostPatterns(settings.hostPatterns || []);
}

function renderAccounts(accounts, settings) {
  accountCount.textContent = String(accounts.length);
  accountsList.replaceChildren();

  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No Thunderbird accounts were exposed to the extension.";
    accountsList.append(empty);
    return;
  }

  for (const account of accounts) {
    const fragment = accountTemplate.content.cloneNode(true);
    const checkbox = fragment.querySelector(".account-checkbox");
    const label = fragment.querySelector(".account-label");
    const meta = fragment.querySelector(".account-meta");

    checkbox.dataset.accountId = account.id;
    checkbox.checked = settings.blockedAccountIds.includes(account.id);
    checkbox.disabled = !settings.globalEnabled;
    label.textContent = account.label;
    meta.textContent = account.emails.length > 0
      ? `${account.type} • ${account.emails.join(", ")}`
      : account.type;

    accountsList.append(fragment);
  }
}

function renderHostPatterns(hostPatterns) {
  hostCount.textContent = String(hostPatterns.length);
  hostPatternList.replaceChildren();

  for (const pattern of hostPatterns) {
    const item = document.createElement("li");
    item.textContent = pattern;
    hostPatternList.append(item);
  }
}

function setBusy(isBusy) {
  refreshButton.disabled = isBusy;
  globalEnabledInput.disabled = isBusy;
  modeAllInput.disabled = isBusy;
  modeSelectedInput.disabled = isBusy;

  for (const checkbox of accountsList.querySelectorAll(".account-checkbox")) {
    checkbox.disabled = isBusy || !globalEnabledInput.checked;
  }
}

function showStatus(message) {
  statusMessage.hidden = false;
  statusMessage.textContent = message;
}

function clearStatus() {
  statusMessage.hidden = true;
  statusMessage.textContent = "";
}
