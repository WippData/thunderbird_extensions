const URL_FIELD_ORDER = ["url", "description", "location", "title"];
const URL_PATTERN = /\b(?:https?:\/\/|msteams:\/\/)[^\s<>"')\]]+/gi;

const ROUTE_PROVIDERS = [
  {
    id: "meet",
    label: "Google Meet",
    route: "default",
    urlPatterns: [
      /^https?:\/\/meet\.google\.com(?::\d+)?(?:\/|$)/i,
      /^https?:\/\/g\.co\/meet(?:\/|$)/i
    ]
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    route: "default",
    urlPatterns: [
      /^https?:\/\/(?:[\w-]+\.)?teams\.microsoft\.com(?::\d+)?(?:\/|$)/i,
      /^msteams:\/\//i
    ]
  },
  {
    id: "zoom",
    label: "Zoom",
    route: "default",
    urlPatterns: [/^https?:\/\/(?:[\w-]+\.)?zoom\.(?:us|com)(?::\d+)?(?:\/|$)/i]
  }
];

const PROVIDER_LABELS = Object.fromEntries(
  ROUTE_PROVIDERS.map((provider) => [provider.id, provider.label])
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

function normalizeUrl(url) {
  return normalizeText(url).trim().replace(/[),.;!?]+$/, "");
}

function getRouteForUrl(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  for (const provider of ROUTE_PROVIDERS) {
    for (const pattern of provider.urlPatterns) {
      if (pattern.test(normalizedUrl)) {
        return {
          providerId: provider.id,
          providerLabel: provider.label,
          route: provider.route,
          url: normalizedUrl
        };
      }
    }
  }

  if (/^(?:https?:\/\/|msteams:\/\/)/i.test(normalizedUrl)) {
    return {
      providerId: null,
      providerLabel: "",
      route: "default",
      url: normalizedUrl
    };
  }

  return null;
}

function extractUrlsFromText(text) {
  const normalizedText = normalizeText(text);
  const matches = normalizedText.match(URL_PATTERN) || [];
  return matches.map((match) => normalizeUrl(match)).filter(Boolean);
}

function extractLinkEntries(fields) {
  const source = fields || {};
  const seen = new Set();
  const results = [];

  for (const fieldName of URL_FIELD_ORDER) {
    const fieldText = normalizeText(source[fieldName]).trim();
    if (!fieldText) {
      continue;
    }

    const urls =
      fieldName === "url" ? [normalizeUrl(fieldText)] : extractUrlsFromText(fieldText);

    for (const url of urls) {
      const route = getRouteForUrl(url);
      const key = (route?.url || url).toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      results.push({
        fieldName,
        providerId: route?.providerId || null,
        providerLabel: route?.providerLabel || "",
        route: route?.route || "default",
        url: route?.url || url
      });
    }
  }

  return results;
}

var CalendarUrlRouting = {
  PROVIDER_LABELS,
  ROUTE_PROVIDERS,
  URL_FIELD_ORDER,
  extractLinkEntries,
  extractUrlsFromText,
  getRouteForUrl,
  normalizeText,
  normalizeUrl
};

if (typeof module === "object" && module.exports) {
  module.exports = CalendarUrlRouting;
}
