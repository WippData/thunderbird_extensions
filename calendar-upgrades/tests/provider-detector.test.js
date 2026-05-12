const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectCallProvider
} = require("../lib/provider-detector.js");

test("detects Google Meet from description URL", () => {
  const provider = detectCallProvider({
    description: "Join at https://meet.google.com/abc-defg-hij",
    location: "",
    url: "",
    title: "Weekly sync"
  });

  assert.equal(provider, "meet");
});

test("detects Microsoft Teams from description text", () => {
  const provider = detectCallProvider({
    description: "Join Microsoft Teams Meeting from the desktop app",
    location: "",
    url: "",
    title: "Internal review"
  });

  assert.equal(provider, "teams");
});

test("detects Zoom from location URL", () => {
  const provider = detectCallProvider({
    description: "",
    location: "https://company.zoom.us/j/123456789",
    url: "",
    title: "Customer call"
  });

  assert.equal(provider, "zoom");
});

test("detects Teams from an msteams protocol URL", () => {
  const provider = detectCallProvider({
    description: "",
    location: "",
    url: "msteams://teams.microsoft.com/l/meetup-join/abc",
    title: "Desktop join"
  });

  assert.equal(provider, "teams");
});

test("returns null when no provider is present", () => {
  const provider = detectCallProvider({
    description: "Conference room A",
    location: "HQ 2F",
    url: "",
    title: "Budget planning"
  });

  assert.equal(provider, null);
});

test("prefers earlier field order when multiple providers are mentioned", () => {
  const provider = detectCallProvider({
    description: "Use Zoom today",
    location: "Fallback room with Google Meet",
    url: "",
    title: "Platform choice"
  });

  assert.equal(provider, "zoom");
});

test("prefers explicit URL matches over plain text matches", () => {
  const provider = detectCallProvider({
    description: "Google Meet text appears here",
    location: "Join via https://teams.microsoft.com/l/meetup-join/xyz",
    url: "",
    title: "Mixed references"
  });

  assert.equal(provider, "teams");
});

test("handles mixed case and punctuation", () => {
  const provider = detectCallProvider({
    description: "Dial-in: ZOOM meeting, see notes.",
    location: "",
    url: "",
    title: "Ops"
  });

  assert.equal(provider, "zoom");
});
