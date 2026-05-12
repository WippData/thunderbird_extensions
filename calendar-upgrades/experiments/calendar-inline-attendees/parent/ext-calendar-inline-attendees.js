/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function () {

var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);

const EVENT_DIALOG_URL = "chrome://calendar/content/calendar-event-dialog.xhtml";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const IFRAME_ID = "calendar-item-panel-iframe";
const PANEL_ID = "event-grid-tabpanel-attendees";
const TAB_ID = "event-grid-tab-attendees";
const STYLE_ID = "ext-inline-attendees-style";
const SHELL_ID = "ext-inline-attendees-shell";
const LIST_CLASS = "ext-inline-attendees-list";
const DESCRIPTION_CLASS = "ext-inline-attendees-description";
const BUTTON_CLASS = "ext-inline-attendees-button";
const PRIMARY_BUTTON_CLASS = "ext-inline-attendees-button-primary";
const SECONDARY_BUTTON_CLASS = "ext-inline-attendees-button-secondary";
const NATIVE_LIST_SELECTOR = ".item-attendees-list-container";
const STATE_PREFIX = "inline-attendee-";

function loadScriptExport(extension, path, exportName) {
  const scope = {};
  Services.scriptloader.loadSubScript(extension.rootURI.resolve(path), scope, "UTF-8");
  if (!scope[exportName]) {
    console.error(`[Calendar Inline Attendees] Failed to load ${exportName} from ${path}.`);
  }
  return scope[exportName];
}

function safeInvoke(callback) {
  try {
    callback();
  } catch (error) {
    console.error("[Calendar Inline Attendees] Cleanup failed:", error);
  }
}

this.calendar_inline_attendees = class extends ExtensionAPI {
  onStartup() {
    this.ensureInitialized();

    ExtensionSupport.registerWindowListener(
      `ext-calendar-inline-attendees-${this.extension.id}`,
      {
        chromeURLs: [EVENT_DIALOG_URL],
        onLoadWindow: (window) => {
          this.installIntoWindow(window);
        }
      }
    );

    for (const window of ExtensionSupport.openWindows) {
      if (window.location.href === EVENT_DIALOG_URL) {
        this.installIntoWindow(window);
      }
    }
  }

  onShutdown(isAppShutdown) {
    ExtensionSupport.unregisterWindowListener(
      `ext-calendar-inline-attendees-${this.extension.id}`
    );

    if (this.windowStates) {
      for (const cleanup of [...this.windowStates.values()]) {
        safeInvoke(cleanup);
      }
      this.windowStates.clear();
    }

    if (!isAppShutdown) {
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }
  }

  ensureInitialized() {
    if (!this.attendeeUtils) {
      this.attendeeUtils = loadScriptExport(
        this.extension,
        "lib/attendee-utils.js",
        "InlineAttendeeUtils"
      );
    }

    if (!this.windowStates) {
      this.windowStates = new Map();
    }
  }

  installIntoWindow(window) {
    this.ensureInitialized();

    if (!window || window.closed || this.windowStates.has(window)) {
      if (window && !window.closed) {
        this.hydrateWindow(window);
      }
      return;
    }

    const cleanupFns = [];
    const state = {
      cleanupFns,
      inlineAttendees: [],
      installedFrameWindow: null,
      currentIframe: null,
      originalEditAttendees: null,
      originalUpdateAttendeeInterface: null,
      restoreFramePatch: null,
      iframeLoadHandler: null,
      frameObserver: null
    };

    this.windowStates.set(window, () => {
      this.clearWindow(window);

      if (state.restoreFramePatch) {
        safeInvoke(state.restoreFramePatch);
      }

      for (const cleanup of [...cleanupFns].reverse()) {
        safeInvoke(cleanup);
      }

      this.windowStates.delete(window);
    });

    const originalEditAttendees =
      typeof window.editAttendees === "function" ? window.editAttendees.bind(window) : null;
    state.originalEditAttendees = originalEditAttendees;

    if (originalEditAttendees) {
      window.editAttendees = () => {
        this.focusInlineAttendees(window);
      };
      cleanupFns.push(() => {
        if (window.editAttendees !== originalEditAttendees) {
          window.editAttendees = originalEditAttendees;
        }
      });
    }

    const attachIframe = () => {
      const iframe = window.document.getElementById(IFRAME_ID);
      if (!iframe || state.currentIframe === iframe) {
        return;
      }

      if (state.currentIframe && state.iframeLoadHandler) {
        state.currentIframe.removeEventListener("load", state.iframeLoadHandler);
      }

      state.currentIframe = iframe;

      if (state.iframeLoadHandler) {
        iframe.removeEventListener("load", state.iframeLoadHandler);
      }

      state.iframeLoadHandler = () => {
        this.installIntoIframe(window, iframe);
      };
      iframe.addEventListener("load", state.iframeLoadHandler);

      cleanupFns.push(() => {
        iframe.removeEventListener("load", state.iframeLoadHandler);
      });

      if (iframe.contentDocument?.readyState === "complete") {
        this.installIntoIframe(window, iframe);
      }
    };

    attachIframe();

    const observer = new window.MutationObserver(() => {
      attachIframe();
      this.hydrateWindow(window);
    });
    observer.observe(window.document.documentElement, {
      childList: true,
      subtree: true
    });
    cleanupFns.push(() => observer.disconnect());
    state.frameObserver = observer;

    this.hydrateWindow(window);
  }

  hydrateWindow(window) {
    if (!window || window.closed) {
      return;
    }

    const iframe = window.document.getElementById(IFRAME_ID);
    if (iframe?.contentDocument?.readyState === "complete") {
      this.installIntoIframe(window, iframe);
      this.renderInlineEditor(window);
    }
  }

  installIntoIframe(outerWindow, iframe) {
    const state = this.windowStates.get(outerWindow);
    const frameWindow = iframe?.contentWindow;
    const frameDocument = iframe?.contentDocument;

    if (!state || !frameWindow || !frameDocument || frameWindow.closed) {
      return;
    }

    if (state.installedFrameWindow === frameWindow) {
      this.injectStyle(frameDocument);
      this.renderInlineEditor(outerWindow);
      return;
    }

    if (state.restoreFramePatch) {
      safeInvoke(state.restoreFramePatch);
      state.restoreFramePatch = null;
    }

    this.injectStyle(frameDocument);
    state.installedFrameWindow = frameWindow;

    if (typeof frameWindow.updateAttendeeInterface === "function") {
      const originalUpdate = frameWindow.updateAttendeeInterface.bind(frameWindow);
      state.originalUpdateAttendeeInterface = originalUpdate;
      frameWindow.updateAttendeeInterface = (...args) => {
        const result = originalUpdate(...args);
        this.refreshInlineStateFromWindow(outerWindow);
        this.renderInlineEditor(outerWindow);
        return result;
      };
      state.restoreFramePatch = () => {
        if (frameWindow.updateAttendeeInterface !== originalUpdate) {
          frameWindow.updateAttendeeInterface = originalUpdate;
        }
      };
    }

    this.refreshInlineStateFromWindow(outerWindow);
    this.renderInlineEditor(outerWindow);
  }

  injectStyle(document) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElementNS(HTML_NS, "style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      #${PANEL_ID}.ext-inline-attendees-ready ${NATIVE_LIST_SELECTOR} {
        display: none !important;
      }

      #${SHELL_ID} {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-block: 8px 4px;
      }

      #${SHELL_ID} * {
        box-sizing: border-box;
      }

      .${DESCRIPTION_CLASS} {
        margin: 0;
        color: color-mix(in srgb, currentColor 72%, transparent);
        line-height: 1.4;
      }

      .ext-inline-attendees-controls {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 150px auto auto;
        gap: 8px;
        align-items: stretch;
      }

      .ext-inline-attendees-input,
      .ext-inline-attendees-select {
        min-height: 30px;
        padding: 6px 8px;
        border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, currentColor 5%, transparent);
        color: inherit;
        font: inherit;
      }

      .${BUTTON_CLASS} {
        min-height: 30px;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
        background: color-mix(in srgb, currentColor 8%, transparent);
        color: inherit;
        font: inherit;
      }

      .${PRIMARY_BUTTON_CLASS} {
        background: color-mix(in srgb, AccentColor 74%, transparent);
        color: AccentColorText;
        border-color: color-mix(in srgb, AccentColor 88%, transparent);
      }

      .${SECONDARY_BUTTON_CLASS} {
        white-space: nowrap;
      }

      .${LIST_CLASS} {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .ext-inline-attendee-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 140px auto;
        gap: 8px;
        align-items: center;
        padding: 8px 10px;
        border-radius: 8px;
        background: color-mix(in srgb, currentColor 7%, transparent);
        border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
      }

      .ext-inline-attendee-row[aria-disabled="true"] {
        grid-template-columns: minmax(0, 1fr) 140px;
      }

      .ext-inline-attendee-identity {
        min-width: 0;
      }

      .ext-inline-attendee-name,
      .ext-inline-attendee-email {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ext-inline-attendee-name {
        font-weight: 600;
      }

      .ext-inline-attendee-email {
        color: color-mix(in srgb, currentColor 68%, transparent);
      }

      .ext-inline-attendees-empty {
        margin: 0;
        padding: 12px;
        border-radius: 8px;
        background: color-mix(in srgb, currentColor 5%, transparent);
        color: color-mix(in srgb, currentColor 72%, transparent);
      }

      .ext-inline-attendees-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .ext-inline-attendees-count {
        color: color-mix(in srgb, currentColor 70%, transparent);
      }

      @media (max-width: 860px) {
        .ext-inline-attendees-controls,
        .ext-inline-attendee-row,
        .ext-inline-attendee-row[aria-disabled="true"] {
          grid-template-columns: 1fr;
        }
      }
    `;
  }

  clearWindow(window) {
    const iframe = window?.document?.getElementById(IFRAME_ID);
    const frameDocument = iframe?.contentDocument;
    if (frameDocument) {
      frameDocument.getElementById(STYLE_ID)?.remove();
      frameDocument.getElementById(SHELL_ID)?.remove();
      frameDocument.getElementById(PANEL_ID)?.classList.remove("ext-inline-attendees-ready");
    }
  }

  focusInlineAttendees(outerWindow) {
    this.hydrateWindow(outerWindow);

    const frameDocument = this.getFrameDocument(outerWindow);
    const tab = frameDocument?.getElementById(TAB_ID);
    if (tab) {
      tab.click();
      tab.focus();
    }
  }

  getFrameDocument(outerWindow) {
    return outerWindow.document.getElementById(IFRAME_ID)?.contentDocument || null;
  }

  getFrameWindow(outerWindow) {
    return outerWindow.document.getElementById(IFRAME_ID)?.contentWindow || null;
  }

  getState(outerWindow) {
    return this.windowStates.get(outerWindow) || null;
  }

  isEditable(outerWindow, frameWindow) {
    const command = outerWindow.document.getElementById("cmd_attendees");
    if (command?.hasAttribute("disabled")) {
      return false;
    }

    return !frameWindow?.calendarItem?.calendar?.readOnly;
  }

  refreshInlineStateFromWindow(outerWindow) {
    const state = this.getState(outerWindow);
    const frameWindow = this.getFrameWindow(outerWindow);
    if (!state || !frameWindow) {
      return;
    }

    const attendees = frameWindow.attendees ? [...frameWindow.attendees] : [];
    state.inlineAttendees = attendees.map((attendee, index) =>
      this.toInlineAttendee(attendee, index)
    );
  }

  toInlineAttendee(attendee, index) {
    const normalizedId = this.attendeeUtils.normalizeEmail(attendee?.id);
    const displayName = this.attendeeUtils.normalizeWhitespace(attendee?.commonName);
    const email = normalizedId;

    return {
      id: `${STATE_PREFIX}${index}-${normalizedId || "missing"}`,
      displayName,
      email,
      role: this.attendeeUtils.mapThunderbirdRoleToInline(attendee?.role),
      originalRole: attendee?.role || this.attendeeUtils.REQUIRED_ROLE,
      roleChanged: false,
      participationStatus: attendee?.participationStatus || "NEEDS-ACTION",
      isExisting: true,
      sourceAttendee: typeof attendee?.clone === "function" ? attendee.clone() : attendee || null,
      userType: attendee?.userType || "INDIVIDUAL"
    };
  }

  commitInlineState(outerWindow) {
    const state = this.getState(outerWindow);
    const frameWindow = this.getFrameWindow(outerWindow);

    if (!state || !frameWindow) {
      return;
    }

    const attendees = state.inlineAttendees
      .map((entry) => this.toThunderbirdAttendee(frameWindow, entry))
      .filter(Boolean);

    frameWindow.attendees = attendees;
    if (typeof frameWindow.updateAttendeeInterface === "function") {
      frameWindow.updateAttendeeInterface();
    }
  }

  toThunderbirdAttendee(frameWindow, entry) {
    const attendee =
      entry.sourceAttendee && typeof entry.sourceAttendee.clone === "function"
        ? entry.sourceAttendee.clone()
        : frameWindow.cal?.createAttendee?.();

    if (!attendee) {
      console.error("[Calendar Inline Attendees] Could not create attendee object.");
      return null;
    }

    attendee.id = `mailto:${this.attendeeUtils.normalizeEmail(entry.email)}`;
    attendee.commonName = this.attendeeUtils.normalizeWhitespace(entry.displayName);
    attendee.role = entry.roleChanged
      ? this.attendeeUtils.mapInlineRoleToThunderbird(entry.role)
      : entry.originalRole || this.attendeeUtils.mapInlineRoleToThunderbird(entry.role);
    attendee.participationStatus = entry.participationStatus || "NEEDS-ACTION";
    attendee.userType = entry.userType || "INDIVIDUAL";
    return attendee;
  }

  renderInlineEditor(outerWindow) {
    const state = this.getState(outerWindow);
    const frameWindow = this.getFrameWindow(outerWindow);
    const frameDocument = this.getFrameDocument(outerWindow);
    const panel = frameDocument?.getElementById(PANEL_ID);

    if (!state || !frameWindow || !frameDocument || !panel) {
      return;
    }

    panel.classList.add("ext-inline-attendees-ready");

    let shell = frameDocument.getElementById(SHELL_ID);
    if (!shell) {
      shell = frameDocument.createElementNS(HTML_NS, "section");
      shell.id = SHELL_ID;
      panel.prepend(shell);
    }

    shell.replaceChildren();

    const editable = this.isEditable(outerWindow, frameWindow);
    const title = frameDocument.createElementNS(HTML_NS, "p");
    title.className = DESCRIPTION_CLASS;
    title.textContent = editable
      ? "Add one or more attendees here. Use commas, semicolons, or new lines to add multiple addresses."
      : "Attendees are shown here. This item is read-only, so inline editing is disabled.";
    shell.appendChild(title);

    if (editable) {
      shell.appendChild(this.buildControls(outerWindow, frameDocument));
    }

    shell.appendChild(this.buildAttendeeList(outerWindow, frameDocument, editable));
    shell.appendChild(this.buildFooter(outerWindow, frameDocument, editable));
  }

  buildControls(outerWindow, document) {
    const controls = document.createElementNS(HTML_NS, "div");
    controls.className = "ext-inline-attendees-controls";

    const input = document.createElementNS(HTML_NS, "input");
    input.className = "ext-inline-attendees-input";
    input.type = "text";
    input.placeholder = "Add attendee email addresses";
    input.autocomplete = "off";

    const roleSelect = document.createElementNS(HTML_NS, "select");
    roleSelect.className = "ext-inline-attendees-select";
    roleSelect.innerHTML = `
      <option value="required">Required attendee</option>
      <option value="optional">Optional attendee</option>
    `;

    const addButton = document.createElementNS(HTML_NS, "button");
    addButton.className = `${BUTTON_CLASS} ${PRIMARY_BUTTON_CLASS}`;
    addButton.type = "button";
    addButton.textContent = "Add Attendees";

    const schedulerButton = document.createElementNS(HTML_NS, "button");
    schedulerButton.className = `${BUTTON_CLASS} ${SECONDARY_BUTTON_CLASS}`;
    schedulerButton.type = "button";
    schedulerButton.textContent = "Advanced Scheduling";

    const addAttendees = () => {
      const parsed = this.attendeeUtils.parseAttendeeInput(input.value);
      if (!parsed.length) {
        input.focus();
        return;
      }

      this.addParsedAttendees(outerWindow, parsed, roleSelect.value);
      input.value = "";
      input.focus();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addAttendees();
      }
    });

    addButton.addEventListener("click", addAttendees);
    schedulerButton.addEventListener("click", () => {
      this.openAdvancedScheduler(outerWindow);
    });

    controls.append(input, roleSelect, addButton, schedulerButton);
    return controls;
  }

  buildAttendeeList(outerWindow, document, editable) {
    const state = this.getState(outerWindow);
    const list = document.createElementNS(HTML_NS, "div");
    list.className = LIST_CLASS;

    if (!state?.inlineAttendees.length) {
      const empty = document.createElementNS(HTML_NS, "p");
      empty.className = "ext-inline-attendees-empty";
      empty.textContent = editable
        ? "No attendees yet."
        : "No attendees are attached to this event.";
      list.appendChild(empty);
      return list;
    }

    for (const attendee of state.inlineAttendees) {
      const row = document.createElementNS(HTML_NS, "div");
      row.className = "ext-inline-attendee-row";
      row.setAttribute("aria-disabled", editable ? "false" : "true");

      const identity = document.createElementNS(HTML_NS, "div");
      identity.className = "ext-inline-attendee-identity";

      const name = document.createElementNS(HTML_NS, "span");
      name.className = "ext-inline-attendee-name";
      name.textContent = attendee.displayName || attendee.email || "Unnamed attendee";

      identity.appendChild(name);

      if (attendee.displayName && attendee.email) {
        const email = document.createElementNS(HTML_NS, "span");
        email.className = "ext-inline-attendee-email";
        email.textContent = attendee.email;
        identity.appendChild(email);
      }

      row.appendChild(identity);

      const roleSelect = document.createElementNS(HTML_NS, "select");
      roleSelect.className = "ext-inline-attendees-select";
      roleSelect.disabled = !editable;
      roleSelect.innerHTML = `
        <option value="required">Required attendee</option>
        <option value="optional">Optional attendee</option>
      `;
      roleSelect.value = attendee.role;
      roleSelect.addEventListener("change", () => {
        this.updateAttendeeRole(outerWindow, attendee.id, roleSelect.value);
      });
      row.appendChild(roleSelect);

      if (editable) {
        const removeButton = document.createElementNS(HTML_NS, "button");
        removeButton.className = `${BUTTON_CLASS} ${SECONDARY_BUTTON_CLASS}`;
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
          this.removeAttendee(outerWindow, attendee.id);
        });
        row.appendChild(removeButton);
      }

      list.appendChild(row);
    }

    return list;
  }

  buildFooter(outerWindow, document, editable) {
    const state = this.getState(outerWindow);
    const footer = document.createElementNS(HTML_NS, "div");
    footer.className = "ext-inline-attendees-footer";

    const count = document.createElementNS(HTML_NS, "span");
    count.className = "ext-inline-attendees-count";
    count.textContent =
      state?.inlineAttendees.length === 1
        ? "1 attendee"
        : `${state?.inlineAttendees.length || 0} attendees`;
    footer.appendChild(count);

    return footer;
  }

  addParsedAttendees(outerWindow, parsedAttendees, role) {
    const state = this.getState(outerWindow);
    if (!state) {
      return;
    }

    const existingEmails = new Set(
      state.inlineAttendees.map((attendee) => this.attendeeUtils.normalizeEmail(attendee.email))
    );
    const nextEntries = [];

    for (const parsedAttendee of parsedAttendees) {
      const normalizedEmail = this.attendeeUtils.normalizeEmail(parsedAttendee.email);
      if (!normalizedEmail || existingEmails.has(normalizedEmail)) {
        continue;
      }

      existingEmails.add(normalizedEmail);
      nextEntries.push({
        id: `${STATE_PREFIX}${Date.now()}-${normalizedEmail}`,
        displayName: parsedAttendee.displayName,
        email: normalizedEmail,
        role,
        originalRole: this.attendeeUtils.mapInlineRoleToThunderbird(role),
        roleChanged: false,
        participationStatus: "NEEDS-ACTION",
        isExisting: false,
        sourceAttendee: null,
        userType: "INDIVIDUAL"
      });
    }

    if (!nextEntries.length) {
      return;
    }

    state.inlineAttendees = [...state.inlineAttendees, ...nextEntries];
    this.commitInlineState(outerWindow);
    this.renderInlineEditor(outerWindow);
  }

  removeAttendee(outerWindow, attendeeId) {
    const state = this.getState(outerWindow);
    if (!state) {
      return;
    }

    state.inlineAttendees = state.inlineAttendees.filter(
      (attendee) => attendee.id !== attendeeId
    );
    this.commitInlineState(outerWindow);
    this.renderInlineEditor(outerWindow);
  }

  updateAttendeeRole(outerWindow, attendeeId, role) {
    const state = this.getState(outerWindow);
    if (!state) {
      return;
    }

    state.inlineAttendees = state.inlineAttendees.map((attendee) => {
      if (attendee.id !== attendeeId) {
        return attendee;
      }

      return {
        ...attendee,
        role,
        roleChanged: role !== this.attendeeUtils.mapThunderbirdRoleToInline(attendee.originalRole)
      };
    });

    this.commitInlineState(outerWindow);
    this.renderInlineEditor(outerWindow);
  }

  openAdvancedScheduler(outerWindow) {
    const state = this.getState(outerWindow);
    const frameWindow = this.getFrameWindow(outerWindow);
    if (!state || !frameWindow) {
      return;
    }

    const openNativeScheduler =
      state.originalEditAttendees ||
      (typeof frameWindow.editAttendees === "function" ? frameWindow.editAttendees.bind(frameWindow) : null);

    if (!openNativeScheduler) {
      console.error("[Calendar Inline Attendees] Native attendee dialog is unavailable.");
      return;
    }

    openNativeScheduler();
    this.refreshInlineStateFromWindow(outerWindow);
    this.renderInlineEditor(outerWindow);
  }
};

}).call(this);
