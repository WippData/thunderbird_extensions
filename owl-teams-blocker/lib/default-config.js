const OWL_TEAMS_BLOCKER_DEFAULT_SETTINGS = {
  globalEnabled: true,
  mode: "all",
  blockedAccountIds: [],
  hostPatterns: [
    "teams.microsoft.com",
    "*.teams.microsoft.com",
    "teams.live.com",
    "*.teams.live.com",
    "cloud.microsoft",
    "*.cloud.microsoft"
  ]
};

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMode(value) {
  return value === "selectedAccounts" ? "selectedAccounts" : "all";
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean))];
}

function normalizeHostPattern(pattern) {
  if (typeof pattern !== "string") {
    return "";
  }

  let normalized = pattern.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/^[a-z]+:\/\//, "");
  normalized = normalized.replace(/\/.*$/, "");
  normalized = normalized.replace(/^\.+|\.+$/g, "");

  if (normalized.startsWith("*.")) {
    const base = normalized.slice(2);
    return base ? `*.${base}` : "";
  }

  return normalized;
}

function normalizeHostPatterns(values) {
  const normalized = normalizeStringList(values)
    .map(normalizeHostPattern)
    .filter(Boolean);

  return normalized.length > 0
    ? normalized
    : [...OWL_TEAMS_BLOCKER_DEFAULT_SETTINGS.hostPatterns];
}

function normalizeConfig(input) {
  const source = input || {};

  return {
    globalEnabled: normalizeBoolean(
      source.globalEnabled,
      OWL_TEAMS_BLOCKER_DEFAULT_SETTINGS.globalEnabled
    ),
    mode: normalizeMode(source.mode),
    blockedAccountIds: normalizeStringList(source.blockedAccountIds),
    hostPatterns: normalizeHostPatterns(source.hostPatterns)
  };
}

var OwlTeamsBlockerDefaults = {
  DEFAULT_SETTINGS: OWL_TEAMS_BLOCKER_DEFAULT_SETTINGS,
  normalizeConfig,
  normalizeHostPattern
};

if (typeof module === "object" && module.exports) {
  module.exports = OwlTeamsBlockerDefaults;
}
