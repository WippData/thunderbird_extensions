const test = require("node:test");
const assert = require("node:assert/strict");

const Defaults = require("../lib/default-config.js");

test("normalizes invalid settings back to defaults", () => {
  const config = Defaults.normalizeConfig({
    globalEnabled: "yes",
    mode: "bad-mode",
    blockedAccountIds: ["acc-1", "acc-1", "", null],
    hostPatterns: ["", "TEAMS.MICROSOFT.COM", "https://*.cloud.microsoft/path"]
  });

  assert.deepEqual(config, {
    globalEnabled: true,
    mode: "all",
    blockedAccountIds: ["acc-1"],
    hostPatterns: ["teams.microsoft.com", "*.cloud.microsoft"]
  });
});

test("preserves selected account mode when valid", () => {
  const config = Defaults.normalizeConfig({
    globalEnabled: false,
    mode: "selectedAccounts",
    blockedAccountIds: ["acc-2"],
    hostPatterns: ["teams.live.com"]
  });

  assert.deepEqual(config, {
    globalEnabled: false,
    mode: "selectedAccounts",
    blockedAccountIds: ["acc-2"],
    hostPatterns: ["teams.live.com"]
  });
});
