const params = new URLSearchParams(window.location.search);

const originalUrlNode = document.getElementById("original-url");
const sourceValueNode = document.getElementById("source-value");
const modeValueNode = document.getElementById("mode-value");
const fallbackNoteNode = document.getElementById("fallback-note");

const originalUrl = params.get("url") || "Unknown";
const source = params.get("source") || "unknown";
const mode = params.get("mode") || "all";
const fallback = params.get("fallback") === "true";

originalUrlNode.textContent = originalUrl;
sourceValueNode.textContent = source;
modeValueNode.textContent = mode === "selectedAccounts"
  ? "selected accounts"
  : "all accounts";

if (fallback) {
  fallbackNoteNode.hidden = false;
  fallbackNoteNode.textContent =
    "Selected-account mode is currently running in global fallback mode because Thunderbird and Owl did not expose reliable account context for this Teams load.";
}
