/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { openLinkExternally } = ChromeUtils.importESModule(
  "resource:///modules/LinkHelper.sys.mjs"
);

const MESSENGER_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const SUMMARY_DIALOG_URL = "chrome://calendar/content/calendar-summary-dialog.xhtml";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLE_ID = "ext-calendar-upgrades-style";
const ICON_CLASS = "ext-call-provider-icon";
const PREVIEW_PANEL_ID = "ext-calendar-hover-preview-panel";
const PREVIEW_SHELL_CLASS = "ext-calendar-hover-preview-shell";
const PREVIEW_ACTIONS_CLASS = "ext-calendar-hover-preview-actions";
const PREVIEW_ACTION_CLASS = "ext-calendar-hover-preview-action";
const PREVIEW_LINK_POPUP_ID = "ext-calendar-preview-link-popup";
const WEEK_HOURS_CONTROLS_ID = "ext-calendar-week-hours-controls";
const DESCRIPTION_POPUP_ID = "description-popup";
const LOCATION_POPUP_ID = "location-link-context-menu";
const TODAY_VIEW_BUTTON_ID = "todayViewButton";
const ITEM_SELECTOR =
  "calendar-editable-item, calendar-event-box, calendar-month-day-box-item";
const TARGET_TAGS = ["calendar-editable-item", "calendar-month-day-box-item"];
const TOOLTIP_DATA_KEY = "__extOriginalTooltip";
const HOVER_SHOW_DELAY_MS = 120;
const HOVER_HIDE_DELAY_MS = 220;
const DEFAULT_ICON_SIZES = Object.freeze({
  meet: 16,
  teams: 16,
  zoom: 16
});
const CURRENT_TIME_BAR_THICKNESS = 3;
const POPUP_LINK_ROLE = "ext-calendar-link-role";
const OPEN_LINK_ROLE = "open-link";
const OPEN_WITH_ROLE = "open-with";
const BROWSER_CHOICES = Object.freeze([
  { id: "default", label: "Default Browser", appName: "" },
  { id: "safari", label: "Safari", appName: "Safari" },
  { id: "chrome", label: "Google Chrome", appName: "Google Chrome" },
  { id: "firefox", label: "Firefox", appName: "Firefox" }
]);

function loadScriptExport(extension, path, exportName) {
  const scope = {};
  Services.scriptloader.loadSubScript(extension.rootURI.resolve(path), scope, "UTF-8");
  if (!scope[exportName]) {
    console.error(`[Calendar Upgrades] Failed to load ${exportName} from ${path}.`);
  }
  return scope[exportName];
}

function loadDetector(extension) {
  return loadScriptExport(extension, "lib/provider-detector.js", "CallProviderDetector");
}

function loadUrlRouting(extension) {
  return loadScriptExport(extension, "lib/url-routing.js", "CalendarUrlRouting");
}

function safeInvoke(callback) {
  try {
    callback();
  } catch (error) {
    console.error("[Calendar Upgrades] Cleanup failed:", error);
  }
}

this.calendar_upgrades = class extends ExtensionAPI {
  onStartup() {
    this.ensureInitialized();

    const chromeUrls = [MESSENGER_WINDOW_URL, SUMMARY_DIALOG_URL];
    ExtensionSupport.registerWindowListener(`ext-calendar-upgrades-${this.extension.id}`, {
      chromeURLs: chromeUrls,
      onLoadWindow: (window) => {
        this.installIntoWindow(window);
      }
    });

    for (const window of ExtensionSupport.openWindows) {
      if (chromeUrls.includes(window.location.href)) {
        this.installIntoWindow(window);
      }
    }
  }

  onShutdown(isAppShutdown) {
    ExtensionSupport.unregisterWindowListener(`ext-calendar-upgrades-${this.extension.id}`);

    if (this.windowStates) {
      for (const state of [...this.windowStates.values()]) {
        safeInvoke(() => this.cleanupWindowState(state));
      }
      this.windowStates.clear();
    }

    if (!isAppShutdown) {
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }
  }

  getAPI() {
    return {
      calendarUpgrades: {}
    };
  }

  ensureInitialized() {
    if (!this.detector) {
      this.detector = loadDetector(this.extension);
    }

    if (!this.urlRouting) {
      this.urlRouting = loadUrlRouting(this.extension);
    }

    if (!this.windowStates) {
      this.windowStates = new Map();
    }

    if (!this.iconUrls) {
      this.iconUrls = {
        meet: this.extension.getURL("icons/meet.svg"),
        teams: this.extension.getURL("icons/teams.svg"),
        zoom: this.extension.getURL("icons/zoom.svg")
      };
    }
  }

  installIntoWindow(window) {
    this.ensureInitialized();

    if (!window || window.closed) {
      return;
    }

    const existingState = this.windowStates.get(window);
    if (existingState) {
      if (window.location.href === MESSENGER_WINDOW_URL) {
        this.hydrateWindow(window);
        this.scheduleFocusNow(window, { force: false });
      }
      return;
    }

    const cleanupFns = [];
    const state = {
      activeLink: null,
      boundElements: new Set(),
      cleanup: null,
      cleanupFns,
      focusNowTimer: null,
      hoverHideTimer: null,
      lastPassiveFocusKey: "",
      hoverShowTimer: null,
      patchedTags: new Map(),
      previewAnchor: null,
      previewLinkPopup: null,
      previewPanel: null,
      window
    };

    state.cleanup = () => {
      this.cleanupWindowState(state);
    };
    this.windowStates.set(window, state);

    if (window.location.href === SUMMARY_DIALOG_URL) {
      this.installSummaryDialogLinkMenus(window, state);
      return;
    }

    this.injectStyle(window);
    cleanupFns.push(() => this.removeStyle(window));
    this.removeLegacyWeekControls(window);
    this.restoreDefaultMultidayViewHours(window);
    this.patchGoToDate(window, cleanupFns);
    this.patchSwitchToView(window, cleanupFns);
    this.patchTodayMoveViews(window, cleanupFns);
    this.patchTodayViewButton(window, cleanupFns);

    const outsideClickHandler = (event) => {
      if (this.isEventInsidePreviewPanel(window, event.target)) {
        return;
      }

      if (state.previewAnchor?.contains(event.target)) {
        return;
      }

      this.hidePreviewPanel(window);
    };
    window.document.addEventListener("mousedown", outsideClickHandler, true);
    cleanupFns.push(() =>
      window.document.removeEventListener("mousedown", outsideClickHandler, true)
    );

    const blurHandler = () => {
      this.hidePreviewPanel(window);
    };
    window.addEventListener("blur", blurHandler);
    cleanupFns.push(() => window.removeEventListener("blur", blurHandler));

    const keydownHandler = (event) => {
      if (event.key === "Escape") {
        this.hidePreviewPanel(window);
      }
    };
    window.addEventListener("keydown", keydownHandler, true);
    cleanupFns.push(() => window.removeEventListener("keydown", keydownHandler, true));

    const observer = new window.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          this.syncNode(node);
        }
      }
    });

    observer.observe(window.document.documentElement, {
      childList: true,
      subtree: true
    });
    cleanupFns.push(() => observer.disconnect());

    for (const tagName of TARGET_TAGS) {
      window.customElements.whenDefined(tagName).then(() => {
        if (!this.windowStates.has(window) || window.closed) {
          return;
        }

        const restore = this.patchOccurrenceSetter(window, tagName, state);
        if (restore) {
          cleanupFns.push(restore);
        }

        this.hydrateWindow(window);
      });
    }

    this.ensurePreviewPanel(window);
    this.ensurePreviewLinkPopup(window);
    this.hydrateWindow(window);
    this.scheduleFocusNow(window, { force: false });
  }

  cleanupWindowState(state) {
    const window = state?.window;
    if (!window) {
      return;
    }

    this.clearWindow(window);

    for (const cleanup of [...(state.cleanupFns || [])].reverse()) {
      safeInvoke(cleanup);
    }

    this.windowStates?.delete(window);
  }

  patchOccurrenceSetter(window, tagName, state) {
    if (state.patchedTags.has(tagName)) {
      return null;
    }

    const constructor = window.customElements.get(tagName);
    if (!constructor) {
      return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, "occurrence");
    if (!descriptor || typeof descriptor.set !== "function") {
      return null;
    }

    const extensionApi = this;
    const replacementDescriptor = {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        descriptor.set.call(this, value);
        extensionApi.syncElement(this);
      }
    };

    Object.defineProperty(constructor.prototype, "occurrence", replacementDescriptor);

    const restore = () => {
      const current = Object.getOwnPropertyDescriptor(constructor.prototype, "occurrence");
      if (current && current.set === replacementDescriptor.set) {
        Object.defineProperty(constructor.prototype, "occurrence", descriptor);
      }
    };

    state.patchedTags.set(tagName, restore);
    return restore;
  }

  injectStyle(window) {
    const document = window.document;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElementNS(HTML_NS, "style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    const timeBarOffset = (CURRENT_TIME_BAR_THICKNESS - 1) / 2;

    style.textContent = `
      .${ICON_CLASS} {
        width: 12px;
        height: 12px;
        min-width: 12px;
        min-height: 12px;
        margin-inline-start: 4px;
        align-self: center;
        flex: none;
        border-radius: 3px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14);
        pointer-events: none;
      }

      [data-call-provider="meet"] .${ICON_CLASS} {
        width: ${DEFAULT_ICON_SIZES.meet}px;
        height: ${DEFAULT_ICON_SIZES.meet}px;
        min-width: ${DEFAULT_ICON_SIZES.meet}px;
        min-height: ${DEFAULT_ICON_SIZES.meet}px;
      }

      [data-call-provider="teams"] .${ICON_CLASS} {
        width: ${DEFAULT_ICON_SIZES.teams}px;
        height: ${DEFAULT_ICON_SIZES.teams}px;
        min-width: ${DEFAULT_ICON_SIZES.teams}px;
        min-height: ${DEFAULT_ICON_SIZES.teams}px;
      }

      [data-call-provider="zoom"] .${ICON_CLASS} {
        width: ${DEFAULT_ICON_SIZES.zoom}px;
        height: ${DEFAULT_ICON_SIZES.zoom}px;
        min-width: ${DEFAULT_ICON_SIZES.zoom}px;
        min-height: ${DEFAULT_ICON_SIZES.zoom}px;
      }

      .timeIndicator[orient="vertical"] {
        height: ${CURRENT_TIME_BAR_THICKNESS}px !important;
        min-height: ${CURRENT_TIME_BAR_THICKNESS}px !important;
        transform: translateY(-${timeBarOffset}px);
      }

      .timeIndicator[orient="horizontal"] {
        width: ${CURRENT_TIME_BAR_THICKNESS}px !important;
        min-width: ${CURRENT_TIME_BAR_THICKNESS}px !important;
        transform: translateX(-${timeBarOffset}px);
      }

      #${PREVIEW_PANEL_ID} {
        max-width: 420px;
      }

      #${PREVIEW_PANEL_ID}::part(content),
      #${PREVIEW_PANEL_ID} .panel-arrowcontent {
        padding: 0;
      }

      .${PREVIEW_SHELL_CLASS} {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 420px;
        max-height: 460px;
        overflow: auto;
        padding: 14px;
        background: color-mix(in srgb, rgb(30, 31, 36) 88%, black);
        color: white;
      }

      .${PREVIEW_SHELL_CLASS} .tooltipBox {
        margin: 0;
      }

      .${PREVIEW_SHELL_CLASS} .tooltipHeaderTable {
        width: 100%;
        border-collapse: collapse;
      }

      .${PREVIEW_SHELL_CLASS} .tooltipHeaderLabel {
        width: 90px;
        padding: 2px 10px 2px 0;
        text-align: left;
        vertical-align: top;
        color: rgba(255, 255, 255, 0.76);
        font-weight: 600;
      }

      .${PREVIEW_SHELL_CLASS} .tooltipHeaderDescription {
        padding: 2px 0;
        vertical-align: top;
        color: white;
        word-break: break-word;
      }

      .${PREVIEW_SHELL_CLASS} .tooltipBodySeparator {
        margin-block: 10px 8px;
        opacity: 0.24;
      }

      .${PREVIEW_SHELL_CLASS} .tooltipBody {
        display: block;
        margin: 0;
        white-space: pre-wrap;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.92);
      }

      .${PREVIEW_SHELL_CLASS} .tooltipBody a {
        color: #9ccaff;
        cursor: pointer;
      }

      .${PREVIEW_ACTIONS_CLASS} {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding-top: 2px;
      }

      .${PREVIEW_ACTION_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: white;
        text-decoration: none;
        cursor: pointer;
      }
    `;
  }

  removeStyle(window) {
    window.document.getElementById(STYLE_ID)?.remove();
  }

  hydrateWindow(window) {
    if (!window || window.closed || window.location.href !== MESSENGER_WINDOW_URL) {
      return;
    }

    for (const element of window.document.querySelectorAll(ITEM_SELECTOR)) {
      this.syncElement(element);
    }

    this.scheduleFocusNow(window, { force: false });
  }

  syncNode(node) {
    if (!node || node.nodeType !== 1) {
      return;
    }

    if (node.matches(ITEM_SELECTOR)) {
      this.syncElement(node);
    }

    if (typeof node.querySelectorAll !== "function") {
      return;
    }

    for (const element of node.querySelectorAll(ITEM_SELECTOR)) {
      this.syncElement(element);
    }

    if (node.ownerGlobal?.location?.href === MESSENGER_WINDOW_URL) {
      this.scheduleFocusNow(node.ownerGlobal, { force: false });
    }
  }

  syncElement(element) {
    if (!element || typeof element.querySelector !== "function") {
      return;
    }

    const state = this.windowStates.get(element.ownerGlobal);
    const occurrence = this.getOccurrence(element);
    if (!occurrence) {
      this.removeProviderIcon(element);
      this.removeElementInteractions(element, state);
      this.restoreNativeTooltip(element);
      return;
    }

    this.installElementInteractions(element, state);
    this.disableNativeTooltip(element);

    const providerId = this.detector.detectCallProvider(this.extractItemTextFields(occurrence));
    if (!providerId) {
      this.removeProviderIcon(element);
      return;
    }

    const label = this.detector.PROVIDER_LABELS[providerId] || providerId;
    const container = element.querySelector(".calendar-item-flex") || element;

    let icon = container.querySelector(`.${ICON_CLASS}`);
    if (!icon) {
      icon = element.ownerDocument.createElementNS(HTML_NS, "img");
      icon.className = ICON_CLASS;
      icon.setAttribute("role", "img");
      icon.setAttribute("draggable", "false");
      container.appendChild(icon);
    }

    icon.setAttribute("src", this.iconUrls[providerId]);
    icon.setAttribute("alt", label);
    icon.setAttribute("title", label);
    icon.setAttribute("aria-label", label);
    element.setAttribute("data-call-provider", providerId);
  }

  installElementInteractions(element, state) {
    if (!state || state.boundElements.has(element)) {
      return;
    }

    const window = element.ownerGlobal;
    const onMouseEnter = () => {
      this.queuePreviewShow(window, element);
    };
    const onMouseLeave = () => {
      this.queuePreviewHide(window);
    };

    element.addEventListener("mouseenter", onMouseEnter);
    element.addEventListener("mouseleave", onMouseLeave);
    element.extCalendarPreviewHandlers = {
      onMouseEnter,
      onMouseLeave
    };
    state.boundElements.add(element);
  }

  removeElementInteractions(element, state) {
    if (!element?.extCalendarPreviewHandlers) {
      return;
    }

    const { onMouseEnter, onMouseLeave } = element.extCalendarPreviewHandlers;
    element.removeEventListener("mouseenter", onMouseEnter);
    element.removeEventListener("mouseleave", onMouseLeave);
    delete element.extCalendarPreviewHandlers;
    state?.boundElements.delete(element);
  }

  disableNativeTooltip(element) {
    if (!element.hasAttribute("tooltip")) {
      return;
    }

    if (!element[TOOLTIP_DATA_KEY]) {
      element[TOOLTIP_DATA_KEY] = element.getAttribute("tooltip");
    }
    element.removeAttribute("tooltip");
  }

  restoreNativeTooltip(element) {
    const originalTooltip = element?.[TOOLTIP_DATA_KEY];
    if (!originalTooltip) {
      return;
    }

    element.setAttribute("tooltip", originalTooltip);
    delete element[TOOLTIP_DATA_KEY];
  }

  ensurePreviewPanel(window) {
    const state = this.windowStates.get(window);
    if (!state || state.previewPanel) {
      return state?.previewPanel || null;
    }

    const panel = window.document.createXULElement("panel");
    panel.id = PREVIEW_PANEL_ID;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("flip", "both");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("noautohide", "true");

    const shell = window.document.createElementNS(HTML_NS, "div");
    shell.className = PREVIEW_SHELL_CLASS;
    panel.appendChild(shell);

    panel.addEventListener("mouseenter", () => {
      this.cancelPreviewHide(state);
    });
    panel.addEventListener("mouseleave", () => {
      this.queuePreviewHide(window);
    });

    window.document.documentElement.appendChild(panel);
    state.previewPanel = panel;
    state.cleanupFns.push(() => panel.remove());
    return panel;
  }

  ensurePreviewLinkPopup(window) {
    const state = this.windowStates.get(window);
    if (!state || state.previewLinkPopup) {
      return state?.previewLinkPopup || null;
    }

    const popup = window.document.createXULElement("menupopup");
    popup.id = PREVIEW_LINK_POPUP_ID;

    const openItem = window.document.createXULElement("menuitem");
    openItem.setAttribute("label", "Open Link");
    openItem.setAttribute(`data-${POPUP_LINK_ROLE}`, OPEN_LINK_ROLE);
    openItem.addEventListener("command", () => {
      this.openActiveLink(window);
    });
    popup.appendChild(openItem);

    const openWithMenu = window.document.createXULElement("menu");
    openWithMenu.setAttribute("label", "Open With");
    openWithMenu.setAttribute(`data-${POPUP_LINK_ROLE}`, OPEN_WITH_ROLE);
    const openWithPopup = window.document.createXULElement("menupopup");
    this.buildOpenWithMenuItems(window, openWithPopup);
    openWithMenu.appendChild(openWithPopup);
    popup.appendChild(openWithMenu);

    popup.addEventListener("popupshowing", () => {
      const hasLink = Boolean(this.windowStates.get(window)?.activeLink?.url);
      openItem.hidden = !hasLink;
      openWithMenu.hidden = !hasLink;
    });
    popup.addEventListener("popuphidden", () => {
      this.setActiveLink(window, null, "");
    });

    window.document.documentElement.appendChild(popup);
    state.previewLinkPopup = popup;
    state.cleanupFns.push(() => popup.remove());
    return popup;
  }

  queuePreviewShow(window, element) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }

    this.cancelPreviewHide(state);
    if (state.hoverShowTimer) {
      window.clearTimeout(state.hoverShowTimer);
    }

    state.hoverShowTimer = window.setTimeout(() => {
      state.hoverShowTimer = null;
      this.showPreviewPanel(window, element);
    }, HOVER_SHOW_DELAY_MS);
  }

  queuePreviewHide(window) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }

    this.cancelPreviewShow(state, window);
    this.cancelPreviewHide(state);
    state.hoverHideTimer = window.setTimeout(() => {
      state.hoverHideTimer = null;
      this.hidePreviewPanel(window);
    }, HOVER_HIDE_DELAY_MS);
  }

  cancelPreviewShow(state, window) {
    if (!state?.hoverShowTimer) {
      return;
    }

    window.clearTimeout(state.hoverShowTimer);
    state.hoverShowTimer = null;
  }

  cancelPreviewHide(state) {
    if (!state?.hoverHideTimer) {
      return;
    }

    state.window.clearTimeout(state.hoverHideTimer);
    state.hoverHideTimer = null;
  }

  showPreviewPanel(window, element) {
    const state = this.windowStates.get(window);
    const occurrence = this.getOccurrence(element);
    if (!state || !occurrence) {
      return;
    }

    const panel = this.ensurePreviewPanel(window);
    const shell = panel?.firstElementChild;
    if (!panel || !shell) {
      return;
    }

    shell.replaceChildren();

    const previewBox = this.buildPreviewContent(window, occurrence);
    if (previewBox) {
      shell.appendChild(previewBox);
    }

    const linkActions = this.buildPreviewActions(window, occurrence);
    if (linkActions) {
      shell.appendChild(linkActions);
    }

    this.attachPreviewLinkHandlers(window, shell);

    state.previewAnchor = element;
    if (panel.state === "open" || panel.state === "showing") {
      panel.hidePopup();
    }
    panel.openPopup(element, "after_end", 10, 0, false, false);
  }

  hidePreviewPanel(window) {
    const state = this.windowStates.get(window);
    if (!state?.previewPanel) {
      return;
    }

    this.cancelPreviewShow(state, window);
    this.cancelPreviewHide(state);
    state.previewAnchor = null;

    const panel = state.previewPanel;
    if (panel.state === "open" || panel.state === "showing") {
      panel.hidePopup();
    }
  }

  isEventInsidePreviewPanel(window, target) {
    const state = this.windowStates.get(window);
    return Boolean(state?.previewPanel?.contains(target));
  }

  buildPreviewContent(window, occurrence) {
    if (typeof window.getPreviewForItem === "function") {
      return window.getPreviewForItem(occurrence, false);
    }

    const fallback = window.document.createElementNS(HTML_NS, "div");
    fallback.textContent = occurrence.title || "Event";
    return fallback;
  }

  buildPreviewActions(window, occurrence) {
    const links = this.urlRouting.extractLinkEntries(this.extractItemTextFields(occurrence));
    if (!links.length) {
      return null;
    }

    const actions = window.document.createElementNS(HTML_NS, "div");
    actions.className = PREVIEW_ACTIONS_CLASS;

    for (const linkEntry of links.slice(0, 4)) {
      const action = window.document.createElementNS(HTML_NS, "a");
      action.className = PREVIEW_ACTION_CLASS;
      action.setAttribute("href", linkEntry.url);
      action.textContent = this.getActionLabel(linkEntry);
      actions.appendChild(action);
    }

    return actions;
  }

  getActionLabel(linkEntry) {
    if (linkEntry.providerLabel) {
      return `Open ${linkEntry.providerLabel}`;
    }

    try {
      return `Open ${new URL(linkEntry.url).hostname}`;
    } catch (error) {
      return "Open Link";
    }
  }

  attachPreviewLinkHandlers(window, container) {
    for (const link of container.querySelectorAll("a[href]")) {
      if (link.extCalendarLinkHandlers) {
        continue;
      }

      const onClick = (event) => {
        this.openCalendarLink(link.getAttribute("href"), event);
      };
      const onContextMenu = (event) => {
        this.openPreviewLinkContextMenu(window, link, event);
      };

      link.addEventListener("click", onClick);
      link.addEventListener("contextmenu", onContextMenu);
      link.extCalendarLinkHandlers = {
        onClick,
        onContextMenu
      };
    }
  }

  openCalendarLink(url, event) {
    if (!url || (event && event.button !== 0)) {
      return;
    }

    openLinkExternally(url, { addToHistory: false });
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const previewWindow = event?.target?.ownerGlobal;
    if (previewWindow) {
      this.hidePreviewPanel(previewWindow);
    }
  }

  openPreviewLinkContextMenu(window, link, event) {
    if (event.button !== 2) {
      return;
    }

    const popup = this.ensurePreviewLinkPopup(window);
    this.setActiveLink(window, link.getAttribute("href"), link.textContent);
    popup.openPopupAtScreen(event.screenX, event.screenY, true, event);
    event.preventDefault();
    event.stopPropagation();
  }

  installSummaryDialogLinkMenus(window, state) {
    const document = window.document;
    const descriptionPopup = document.getElementById(DESCRIPTION_POPUP_ID);
    const locationPopup = document.getElementById(LOCATION_POPUP_ID);

    if (descriptionPopup) {
      this.ensurePopupLinkMenu(window, descriptionPopup);
      const onDescriptionPopupShowing = () => {
        this.updateSummaryPopupLinkState(window, descriptionPopup);
      };
      const onDescriptionPopupHidden = () => {
        this.setActiveLink(window, null, "");
      };
      descriptionPopup.addEventListener("popupshowing", onDescriptionPopupShowing);
      descriptionPopup.addEventListener("popuphidden", onDescriptionPopupHidden);
      state.cleanupFns.push(() => {
        descriptionPopup.removeEventListener("popupshowing", onDescriptionPopupShowing);
        descriptionPopup.removeEventListener("popuphidden", onDescriptionPopupHidden);
      });
    }

    if (locationPopup) {
      this.ensurePopupLinkMenu(window, locationPopup);
      const onLocationPopupShowing = () => {
        this.setActiveLinkFromNode(window, locationPopup.triggerNode);
        this.updateSummaryPopupLinkState(window, locationPopup);
      };
      const onLocationPopupHidden = () => {
        this.setActiveLink(window, null, "");
      };
      locationPopup.addEventListener("popupshowing", onLocationPopupShowing);
      locationPopup.addEventListener("popuphidden", onLocationPopupHidden);
      state.cleanupFns.push(() => {
        locationPopup.removeEventListener("popupshowing", onLocationPopupShowing);
        locationPopup.removeEventListener("popuphidden", onLocationPopupHidden);
      });
    }

    if (typeof window.openDescriptionContextMenu === "function") {
      const originalOpenDescriptionContextMenu = window.openDescriptionContextMenu.bind(window);
      window.openDescriptionContextMenu = (event) => {
        this.setActiveLinkFromNode(window, event.target);
        return originalOpenDescriptionContextMenu(event);
      };
      state.cleanupFns.push(() => {
        if (window.openDescriptionContextMenu !== originalOpenDescriptionContextMenu) {
          window.openDescriptionContextMenu = originalOpenDescriptionContextMenu;
        }
      });
    }
  }

  ensurePopupLinkMenu(window, popup) {
    if (!popup || popup.querySelector(`[data-${POPUP_LINK_ROLE}="${OPEN_LINK_ROLE}"]`)) {
      return;
    }

    const openItem = window.document.createXULElement("menuitem");
    openItem.setAttribute("label", "Open Link");
    openItem.setAttribute(`data-${POPUP_LINK_ROLE}`, OPEN_LINK_ROLE);
    openItem.addEventListener("command", () => {
      this.openActiveLink(window);
    });

    const openWithMenu = window.document.createXULElement("menu");
    openWithMenu.setAttribute("label", "Open With");
    openWithMenu.setAttribute(`data-${POPUP_LINK_ROLE}`, OPEN_WITH_ROLE);
    const openWithPopup = window.document.createXULElement("menupopup");
    this.buildOpenWithMenuItems(window, openWithPopup);
    openWithMenu.appendChild(openWithPopup);

    const firstSeparator = popup.querySelector("menuseparator");
    popup.insertBefore(openItem, firstSeparator || popup.firstChild);
    popup.insertBefore(openWithMenu, firstSeparator || popup.firstChild);
  }

  updateSummaryPopupLinkState(window, popup) {
    const hasLink = Boolean(this.windowStates.get(window)?.activeLink?.url);
    const openItem = popup.querySelector(`[data-${POPUP_LINK_ROLE}="${OPEN_LINK_ROLE}"]`);
    const openWithMenu = popup.querySelector(`[data-${POPUP_LINK_ROLE}="${OPEN_WITH_ROLE}"]`);

    if (openItem) {
      openItem.hidden = !hasLink;
    }
    if (openWithMenu) {
      openWithMenu.hidden = !hasLink;
    }
  }

  buildOpenWithMenuItems(window, popup) {
    for (const choice of BROWSER_CHOICES) {
      if (choice.id !== "default" && AppConstants.platform !== "macosx") {
        continue;
      }

      const item = window.document.createXULElement("menuitem");
      item.setAttribute("label", choice.label);
      item.addEventListener("command", () => {
        this.openActiveLinkWithBrowser(window, choice.appName);
      });
      popup.appendChild(item);
    }

    if (AppConstants.platform === "macosx") {
      const separator = window.document.createXULElement("menuseparator");
      popup.appendChild(separator);

      const chooseItem = window.document.createXULElement("menuitem");
      chooseItem.setAttribute("label", "Choose Application…");
      chooseItem.addEventListener("command", () => {
        this.openActiveLinkWithSelectedApplication(window);
      });
      popup.appendChild(chooseItem);
    }
  }

  setActiveLink(window, url, label) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }

    state.activeLink = url
      ? {
          label: String(label || "").trim(),
          url: String(url)
        }
      : null;
  }

  setActiveLinkFromNode(window, node) {
    const anchor = node?.closest?.("a[href]");
    const url = anchor?.getAttribute("href") || anchor?.href || "";
    const label = anchor?.textContent || "";
    this.setActiveLink(window, url, label);
  }

  openActiveLink(window) {
    const url = this.windowStates.get(window)?.activeLink?.url;
    if (!url) {
      return;
    }

    openLinkExternally(url, { addToHistory: false });
  }

  openActiveLinkWithBrowser(window, appName) {
    const url = this.windowStates.get(window)?.activeLink?.url;
    if (!url) {
      return;
    }

    if (!appName) {
      this.openActiveLink(window);
      return;
    }

    this.openLinkWithNamedApplication(url, appName);
  }

  openActiveLinkWithSelectedApplication(window) {
    const url = this.windowStates.get(window)?.activeLink?.url;
    if (!url) {
      return;
    }

    this.openLinkWithSelectedApplication(url, window);
  }

  openLinkWithNamedApplication(url, appNameOrPath) {
    if (AppConstants.platform !== "macosx" || !appNameOrPath) {
      openLinkExternally(url, { addToHistory: false });
      return;
    }

    const openCommand = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    openCommand.initWithPath("/usr/bin/open");
    if (!openCommand.exists()) {
      openLinkExternally(url, { addToHistory: false });
      return;
    }

    try {
      const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      process.init(openCommand);
      const args = ["-a", appNameOrPath, url];
      process.runw(false, args, args.length);
    } catch (error) {
      console.error("[Calendar Upgrades] Failed to open link with application:", error);
    }
  }

  openLinkWithSelectedApplication(url, window) {
    if (AppConstants.platform !== "macosx") {
      openLinkExternally(url, { addToHistory: false });
      return;
    }

    try {
      const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      picker.init(window, "Choose Application", Ci.nsIFilePicker.modeOpen);
      if ("filterApps" in Ci.nsIFilePicker) {
        picker.appendFilters(Ci.nsIFilePicker.filterApps);
      }

      picker.open((result) => {
        if (result === Ci.nsIFilePicker.returnOK && picker.file?.path) {
          this.openLinkWithNamedApplication(url, picker.file.path);
        }
      });
    } catch (error) {
      console.error("[Calendar Upgrades] Failed to show application picker:", error);
    }
  }

  removeLegacyWeekControls(window) {
    window.document.getElementById(WEEK_HOURS_CONTROLS_ID)?.remove();
  }

  patchGoToDate(window, cleanupFns) {
    if (typeof window.goToDate !== "function") {
      return;
    }

    const originalGoToDate = window.goToDate;
    const extensionApi = this;
    const patchedGoToDate = function (...args) {
      const result = originalGoToDate.apply(this, args);
      if (extensionApi.isTodayDate(args[0])) {
        extensionApi.scheduleFocusNow(window, { force: true });
      }
      return result;
    };

    window.goToDate = patchedGoToDate;
    cleanupFns.push(() => {
      if (window.goToDate === patchedGoToDate) {
        window.goToDate = originalGoToDate;
      }
    });
  }

  patchSwitchToView(window, cleanupFns) {
    if (typeof window.switchToView !== "function") {
      return;
    }

    const originalSwitchToView = window.switchToView;
    const extensionApi = this;
    const patchedSwitchToView = function (...args) {
      const result = originalSwitchToView.apply(this, args);
      extensionApi.scheduleFocusNow(window, { force: false });
      return result;
    };

    window.switchToView = patchedSwitchToView;
    cleanupFns.push(() => {
      if (window.switchToView === patchedSwitchToView) {
        window.switchToView = originalSwitchToView;
      }
    });
  }

  patchTodayMoveViews(window, cleanupFns) {
    for (const viewId of ["day-view", "week-view"]) {
      const view = window.document.getElementById(viewId);
      if (!view || typeof view.moveView !== "function") {
        continue;
      }

      const originalMoveView = view.moveView;
      const extensionApi = this;
      const patchedMoveView = function (number) {
        const result = originalMoveView.call(this, number);
        if (!number) {
          extensionApi.scheduleFocusNow(window, { force: true });
        }
        return result;
      };

      view.moveView = patchedMoveView;
      cleanupFns.push(() => {
        if (view.moveView === patchedMoveView) {
          view.moveView = originalMoveView;
        }
      });
    }
  }

  patchTodayViewButton(window, cleanupFns) {
    const button = window.document.getElementById(TODAY_VIEW_BUTTON_ID);
    if (!button) {
      return;
    }

    const handler = () => {
      this.scheduleFocusNow(window, { force: true });
    };
    button.addEventListener("click", handler);
    cleanupFns.push(() => button.removeEventListener("click", handler));
  }

  restoreDefaultMultidayViewHours(window) {
    const startHour = Services.prefs.getIntPref("calendar.view.daystarthour", 8);
    const endHour = Services.prefs.getIntPref("calendar.view.dayendhour", 17);

    for (const viewId of ["day-view", "week-view"]) {
      const view = window.document.getElementById(viewId);
      if (typeof view?.setDayStartEndHours === "function") {
        view.setDayStartEndHours(startHour, endHour);
      }
    }
  }

  scheduleFocusNow(window, { force = false } = {}) {
    const state = this.windowStates.get(window);
    if (!state || window.location.href !== MESSENGER_WINDOW_URL) {
      return;
    }

    if (state.focusNowTimer) {
      window.clearTimeout(state.focusNowTimer);
    }

    state.focusNowTimer = window.setTimeout(() => {
      state.focusNowTimer = null;
      this.focusNowInCurrentView(window, { force });
    }, 50);
  }

  focusNowInCurrentView(window, { force = false } = {}) {
    const state = this.windowStates.get(window);
    const view = typeof window.currentView === "function" ? window.currentView() : null;
    if (!view || !["day-view", "week-view"].includes(view.id)) {
      return;
    }

    if (!this.isTodayVisibleInView(view) || typeof view.scrollToMinute !== "function") {
      return;
    }

    const focusKey = `${view.id}:${this.getViewRangeKey(view)}:${this.getTodayKey()}`;
    if (!force && state?.lastPassiveFocusKey === focusKey) {
      return;
    }

    const now = new Date();
    const visibleHours = Number.isFinite(view.visibleHours) ? view.visibleHours : 9;
    const targetMinute = Math.max(
      0,
      now.getHours() * 60 + now.getMinutes() - visibleHours * 30
    );
    view.scrollToMinute(targetMinute);

    if (!force && state) {
      state.lastPassiveFocusKey = focusKey;
    }
  }

  isTodayVisibleInView(view) {
    const today = typeof view.today === "function" ? view.today() : null;
    if (!today || !view.startDay || !view.endDay || typeof today.compare !== "function") {
      return false;
    }

    return today.compare(view.startDay) >= 0 && today.compare(view.endDay) <= 0;
  }

  isTodayDate(date) {
    if (!date) {
      return false;
    }

    const now = new Date();
    if (date instanceof Date) {
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    }

    return (
      date.year === now.getFullYear() &&
      date.month === now.getMonth() &&
      date.day === now.getDate()
    );
  }

  getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}:${now.getMonth()}:${now.getDate()}`;
  }

  getViewRangeKey(view) {
    const start = view?.startDay;
    const end = view?.endDay;
    if (!start || !end) {
      return "";
    }

    return [
      start.year,
      start.month,
      start.day,
      end.year,
      end.month,
      end.day
    ].join(":");
  }

  removeProviderIcon(element) {
    element.removeAttribute("data-call-provider");

    const container = element.querySelector?.(".calendar-item-flex") || element;
    container.querySelector?.(`.${ICON_CLASS}`)?.remove();
  }

  clearWindow(window) {
    if (!window || window.closed) {
      return;
    }

    const state = this.windowStates.get(window);
    if (state?.focusNowTimer) {
      window.clearTimeout(state.focusNowTimer);
      state.focusNowTimer = null;
    }

    if (window.location.href === MESSENGER_WINDOW_URL) {
      this.hidePreviewPanel(window);
      this.removeLegacyWeekControls(window);
      this.restoreDefaultMultidayViewHours(window);

      for (const element of state?.boundElements || []) {
        this.removeProviderIcon(element);
        this.removeElementInteractions(element, state);
        this.restoreNativeTooltip(element);
      }

      for (const element of window.document.querySelectorAll(ITEM_SELECTOR)) {
        this.removeProviderIcon(element);
        this.removeElementInteractions(element, state);
        this.restoreNativeTooltip(element);
      }
    }
  }

  getOccurrence(element) {
    try {
      return element.occurrence || element.mOccurrence || null;
    } catch (error) {
      return element.mOccurrence || null;
    }
  }

  extractItemTextFields(item) {
    return {
      description: this.readItemProperty(item, "DESCRIPTION"),
      location: this.readItemProperty(item, "LOCATION"),
      url: this.readItemProperty(item, "URL"),
      title: this.detector.normalizeText(item.title).trim()
    };
  }

  readItemProperty(item, propertyName) {
    if (!item || typeof item.getProperty !== "function") {
      return "";
    }

    try {
      return this.detector.normalizeText(item.getProperty(propertyName)).trim();
    } catch (error) {
      return "";
    }
  }
};
