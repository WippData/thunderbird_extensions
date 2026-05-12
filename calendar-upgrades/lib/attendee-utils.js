const REQUIRED_ROLE = "REQ-PARTICIPANT";
const OPTIONAL_ROLE = "OPT-PARTICIPANT";
const EMAIL_SPLIT_PATTERN = /[\n,;]+/;
const EMAIL_PATTERN = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/i;

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEmail(value) {
  return normalizeWhitespace(value).replace(/^mailto:/i, "").trim().toLowerCase();
}

function dedupeByEmail(entries) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    const key = normalizeEmail(entry.email);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function parseSingleAttendeeToken(token) {
  const cleanedToken = normalizeWhitespace(token);
  if (!cleanedToken) {
    return null;
  }

  const match = cleanedToken.match(/^(?:"?([^"]+?)"?\s*)?<([^<>]+)>$/);
  let displayName = "";
  let email = cleanedToken;

  if (match) {
    displayName = normalizeWhitespace(match[1] || "");
    email = normalizeWhitespace(match[2] || "");
  }

  email = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(email)) {
    return null;
  }

  return {
    displayName,
    email
  };
}

function parseAttendeeInput(input) {
  const rawTokens = String(input || "")
    .split(EMAIL_SPLIT_PATTERN)
    .map((token) => parseSingleAttendeeToken(token))
    .filter(Boolean);

  return dedupeByEmail(rawTokens);
}

function mapThunderbirdRoleToInline(role) {
  return role === OPTIONAL_ROLE ? "optional" : "required";
}

function mapInlineRoleToThunderbird(role) {
  return role === "optional" ? OPTIONAL_ROLE : REQUIRED_ROLE;
}

var InlineAttendeeUtils = {
  EMAIL_PATTERN,
  OPTIONAL_ROLE,
  REQUIRED_ROLE,
  dedupeByEmail,
  mapInlineRoleToThunderbird,
  mapThunderbirdRoleToInline,
  normalizeEmail,
  normalizeWhitespace,
  parseAttendeeInput,
  parseSingleAttendeeToken
};

if (typeof module === "object" && module.exports) {
  module.exports = InlineAttendeeUtils;
}
