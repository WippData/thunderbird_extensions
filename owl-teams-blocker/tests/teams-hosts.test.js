const test = require("node:test");
const assert = require("node:assert/strict");

global.OwlTeamsBlockerDefaults = require("../lib/default-config.js");
const HostMatcher = require("../lib/teams-hosts.js");

test("blocks teams.microsoft.com URLs", () => {
  assert.equal(
    HostMatcher.shouldBlockUrl("https://teams.microsoft.com/l/chat/0/0", [
      "teams.microsoft.com"
    ]),
    true
  );
});

test("blocks wildcard subdomains", () => {
  assert.equal(
    HostMatcher.shouldBlockUrl("https://foo.teams.microsoft.com/path", [
      "*.teams.microsoft.com"
    ]),
    true
  );
});

test("blocks msteams protocol URLs when Thunderbird exposes them", () => {
  assert.equal(
    HostMatcher.shouldBlockUrl("msteams://teams.microsoft.com/l/meetup-join/abc", [
      "teams.microsoft.com"
    ]),
    true
  );
});

test("does not block unrelated outlook URLs", () => {
  assert.equal(
    HostMatcher.shouldBlockUrl("https://outlook.office.com/mail/", [
      "teams.microsoft.com",
      "*.cloud.microsoft"
    ]),
    false
  );
});

test("builds Thunderbird webRequest URL filters from host patterns", () => {
  assert.deepEqual(HostMatcher.getWebRequestPatterns([
    "teams.live.com",
    "*.cloud.microsoft"
  ]), [
    "*://teams.live.com/*",
    "*://*.cloud.microsoft/*"
  ]);
});
