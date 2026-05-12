const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractLinkEntries,
  getRouteForUrl
} = require("../lib/url-routing.js");

test("routes Google Meet URLs through the default browser", () => {
  assert.deepEqual(getRouteForUrl("https://meet.google.com/abc-defg-hij"), {
    providerId: "meet",
    providerLabel: "Google Meet",
    route: "default",
    url: "https://meet.google.com/abc-defg-hij"
  });
});

test("routes Zoom URLs through the default browser", () => {
  assert.deepEqual(getRouteForUrl("https://company.zoom.us/j/123456789"), {
    providerId: "zoom",
    providerLabel: "Zoom",
    route: "default",
    url: "https://company.zoom.us/j/123456789"
  });
});

test("extracts and dedupes links in field order", () => {
  assert.deepEqual(
    extractLinkEntries({
      url: "https://meet.google.com/primary-link",
      description:
        "Join here https://meet.google.com/primary-link and docs https://example.com/docs",
      location: "Backup https://teams.microsoft.com/l/meetup-join/abc",
      title: ""
    }),
    [
      {
        fieldName: "url",
        providerId: "meet",
        providerLabel: "Google Meet",
        route: "default",
        url: "https://meet.google.com/primary-link"
      },
      {
        fieldName: "description",
        providerId: null,
        providerLabel: "",
        route: "default",
        url: "https://example.com/docs"
      },
      {
        fieldName: "location",
        providerId: "teams",
        providerLabel: "Microsoft Teams",
        route: "default",
        url: "https://teams.microsoft.com/l/meetup-join/abc"
      }
    ]
  );
});

test("matches g.co meet short links", () => {
  assert.deepEqual(getRouteForUrl("https://g.co/meet/demo-room"), {
    providerId: "meet",
    providerLabel: "Google Meet",
    route: "default",
    url: "https://g.co/meet/demo-room"
  });
});

test("returns null for unsupported schemes", () => {
  assert.equal(getRouteForUrl("mailto:person@example.com"), null);
});
