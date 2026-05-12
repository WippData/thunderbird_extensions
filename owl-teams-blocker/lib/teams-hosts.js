function safeParseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return null;
  }

  try {
    return new URL(rawUrl);
  } catch (error) {
    return null;
  }
}

function normalizePattern(pattern) {
  if (
    typeof OwlTeamsBlockerDefaults === "object" &&
    typeof OwlTeamsBlockerDefaults.normalizeHostPattern === "function"
  ) {
    return OwlTeamsBlockerDefaults.normalizeHostPattern(pattern);
  }

  if (typeof pattern !== "string") {
    return "";
  }

  return pattern.trim().toLowerCase();
}

function hostnameMatchesPattern(hostname, pattern) {
  const normalizedHost = typeof hostname === "string" ? hostname.trim().toLowerCase() : "";
  const normalizedPattern = normalizePattern(pattern);
  if (!normalizedHost || !normalizedPattern) {
    return false;
  }

  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix);
  }

  return normalizedHost === normalizedPattern;
}

function shouldBlockUrl(rawUrl, hostPatterns) {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) {
    return false;
  }

  if (parsed.protocol === "msteams:") {
    return true;
  }

  const hostname = parsed.hostname;
  const patterns = Array.isArray(hostPatterns) && hostPatterns.length > 0
    ? hostPatterns
    : OwlTeamsBlockerDefaults.DEFAULT_SETTINGS.hostPatterns;

  return patterns.some((pattern) => hostnameMatchesPattern(hostname, pattern));
}

function getWebRequestPatterns(hostPatterns) {
  const patterns = Array.isArray(hostPatterns) && hostPatterns.length > 0
    ? hostPatterns
    : OwlTeamsBlockerDefaults.DEFAULT_SETTINGS.hostPatterns;

  const urls = new Set();
  for (const pattern of patterns) {
    const normalizedPattern = normalizePattern(pattern);
    if (!normalizedPattern) {
      continue;
    }

    urls.add(`*://${normalizedPattern}/*`);
  }

  return [...urls];
}

var OwlTeamsHostMatcher = {
  hostnameMatchesPattern,
  shouldBlockUrl,
  getWebRequestPatterns,
  safeParseUrl
};

if (typeof module === "object" && module.exports) {
  module.exports = OwlTeamsHostMatcher;
}
