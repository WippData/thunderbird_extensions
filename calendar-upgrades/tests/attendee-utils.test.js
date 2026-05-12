const test = require("node:test");
const assert = require("node:assert/strict");

const InlineAttendeeUtils = require("../lib/attendee-utils.js");

test("parseAttendeeInput parses a single email", () => {
  assert.deepEqual(InlineAttendeeUtils.parseAttendeeInput("person@example.com"), [
    {
      displayName: "",
      email: "person@example.com"
    }
  ]);
});

test("parseAttendeeInput parses display names", () => {
  assert.deepEqual(
    InlineAttendeeUtils.parseAttendeeInput('Jane Doe <jane@example.com>'),
    [
      {
        displayName: "Jane Doe",
        email: "jane@example.com"
      }
    ]
  );
});

test("parseAttendeeInput handles multiple delimiters", () => {
  assert.deepEqual(
    InlineAttendeeUtils.parseAttendeeInput(
      "first@example.com, second@example.com;\nThird Person <third@example.com>"
    ),
    [
      {
        displayName: "",
        email: "first@example.com"
      },
      {
        displayName: "",
        email: "second@example.com"
      },
      {
        displayName: "Third Person",
        email: "third@example.com"
      }
    ]
  );
});

test("parseAttendeeInput dedupes by email", () => {
  assert.deepEqual(
    InlineAttendeeUtils.parseAttendeeInput(
      "Person <person@example.com>, person@example.com, PERSON@example.com"
    ),
    [
      {
        displayName: "Person",
        email: "person@example.com"
      }
    ]
  );
});

test("parseAttendeeInput ignores invalid tokens", () => {
  assert.deepEqual(
    InlineAttendeeUtils.parseAttendeeInput("invalid, stillbad, valid@example.com"),
    [
      {
        displayName: "",
        email: "valid@example.com"
      }
    ]
  );
});

test("role mapping preserves required and optional values", () => {
  assert.equal(
    InlineAttendeeUtils.mapInlineRoleToThunderbird("required"),
    InlineAttendeeUtils.REQUIRED_ROLE
  );
  assert.equal(
    InlineAttendeeUtils.mapInlineRoleToThunderbird("optional"),
    InlineAttendeeUtils.OPTIONAL_ROLE
  );
  assert.equal(
    InlineAttendeeUtils.mapThunderbirdRoleToInline(InlineAttendeeUtils.OPTIONAL_ROLE),
    "optional"
  );
});
