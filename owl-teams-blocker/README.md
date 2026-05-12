# Owl Teams Blocker

Owl Teams Blocker is a Thunderbird MailExtension that prevents Microsoft Teams from loading inside Thunderbird. It is designed for the Owl for Exchange use case, but it does not depend on Owl internals. It simply watches Thunderbird tabs and web requests and blocks Teams hosts when they appear.

## What It Does

- Blocks Teams requests through `webRequest` with blocking enabled.
- Redirects Teams tabs to a local blocked page when Thunderbird exposes them as tabs.
- Provides a toolbar popup to:
  - enable or disable blocking
  - block for all accounts
  - choose specific accounts in a best-effort mode
- Persists settings in `storage.local`.

## Important Limitation

Per-account blocking is currently best-effort only.

Thunderbird's public APIs do let the add-on list your configured accounts, but they do not reliably expose which account caused a Teams tab or Teams request to open. When you choose `Only selected accounts`, the add-on currently falls back to global blocking if one or more accounts are selected. The popup states this explicitly.

## Files

- `manifest.json` - Thunderbird MailExtension manifest.
- `background.js` - Settings, tab interception, and request blocking.
- `lib/default-config.js` - Shared settings defaults and normalization.
- `lib/teams-hosts.js` - Shared URL and hostname matching logic.
- `popup/` - Toolbar popup UI for blocker settings.
- `blocked/` - Interstitial page shown for blocked Teams tabs.
- `icons/` - Toolbar icons.
- `tests/` - Node tests for config and host matching.

## Temporary Install For Development

1. Open Thunderbird.
2. Go to `Add-ons and Themes`.
3. Click the gear icon.
4. Choose `Debug Add-ons`.
5. Choose `Load Temporary Add-on`.
6. Select:
   `/Users/nathancunningham/Code/thunderbird_extensions/owl-teams-blocker/manifest.json`

## Run Tests

```sh
cd /Users/nathancunningham/Code/thunderbird_extensions
node --test owl-teams-blocker/tests/*.test.js
```

## Package As An XPI

```sh
cd /Users/nathancunningham/Code/thunderbird_extensions/owl-teams-blocker
zip -r owl-teams-blocker.xpi manifest.json background.js blocked icons lib popup tests README.md
```

## Manual Verification Checklist

- Enable blocking and open a Teams URL inside Thunderbird.
- Confirm the tab is redirected to the blocked page or the request is canceled.
- Confirm non-Teams Owl or Outlook pages still load normally.
- Switch between `all accounts` and `only selected accounts` and verify the popup notice changes.
- Reload the add-on and confirm settings persist.
