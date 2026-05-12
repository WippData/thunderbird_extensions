const FIELD_ORDER = ["description", "location", "url", "title"];

const PROVIDERS = [
  {
    id: "meet",
    label: "Google Meet",
    urlPatterns: [/\bmeet\.google\.com\b/i],
    textPatterns: [/\bgoogle meet\b/i]
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    urlPatterns: [/\bteams\.microsoft\.com\b/i, /\bmsteams:\/\//i, /\blync\.[\w.-]+\b/i],
    textPatterns: [/\bmicrosoft teams\b/i, /\bjoin microsoft teams meeting\b/i, /\bmsteams\b/i, /\blync\b/i]
  },
  {
    id: "zoom",
    label: "Zoom",
    urlPatterns: [/\bzoom\.(?:us|com)\b/i],
    textPatterns: [/\bzoom meeting\b/i, /\bzoom\b/i]
  }
];

const PROVIDER_LABELS = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider.label])
);

function normalizeText(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.value === "string") {
      return value.value;
    }

    if (typeof value.icalString === "string") {
      return value.icalString;
    }
  }

  return String(value);
}

function buildFieldList(fields) {
  const source = fields || {};

  return FIELD_ORDER.map((fieldName) => ({
    fieldName,
    text: normalizeText(source[fieldName]).trim()
  })).filter((entry) => entry.text);
}

function findEarliestProviderMatch(text, patternKey) {
  let bestMatch = null;

  for (const provider of PROVIDERS) {
    for (const pattern of provider[patternKey]) {
      const match = pattern.exec(text);
      if (!match) {
        continue;
      }

      if (!bestMatch || match.index < bestMatch.index) {
        bestMatch = {
          providerId: provider.id,
          index: match.index
        };
      }
    }
  }

  return bestMatch ? bestMatch.providerId : null;
}

function detectCallProvider(itemTextFields) {
  const fields = buildFieldList(itemTextFields);

  for (const field of fields) {
    const providerId = findEarliestProviderMatch(field.text, "urlPatterns");
    if (providerId) {
      return providerId;
    }
  }

  for (const field of fields) {
    const providerId = findEarliestProviderMatch(field.text, "textPatterns");
    if (providerId) {
      return providerId;
    }
  }

  return null;
}

var CallProviderDetector = {
  FIELD_ORDER,
  PROVIDERS,
  PROVIDER_LABELS,
  detectCallProvider,
  normalizeText
};

if (typeof module === "object" && module.exports) {
  module.exports = CallProviderDetector;
}
