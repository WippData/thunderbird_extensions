# Pinned Tabs Reopener

Pinned Tabs Reopener is a local Thunderbird MailExtension that lets you pin the current Thunderbird tab and automatically tries to reopen it if you close it accidentally.

The add-on is built around Thunderbird's generic `tabs` API instead of `mailTabs`, so it can observe and manage arbitrary Thunderbird tab types when Thunderbird exposes enough metadata. That includes the target use case of content/chat-style tabs such as Discord inside Thunderbird. The main limitation is Thunderbird's restore surface: generic reopening is only available through `tabs.create({ url })` and `windows.create({ url })`, so some tab types can be pinned and tracked but not recreated automatically.

## Files

- `manifest.json` - Thunderbird MailExtension manifest targeting Thunderbird 128 ESR (Manifest V2).
- `background.js` - Pin storage, tab event listeners, and reopen logic.
- `popup/` - Popup UI for pinning, unpinning, and reviewing pinned tabs.
- `icons/` - Toolbar icons.

## Temporary Install For Development

1. Open Thunderbird.
2. Go to `Add-ons and Themes`.
3. Click the gear icon.
4. Choose `Debug Add-ons`.
5. Choose `Load Temporary Add-on`.
6. Select this extension's `manifest.json` file:
   `/Users/nathancunningham/Code/thunderbird_extensions/pinned-tabs-reopener/manifest.json`

Important: this temporary install is only for the current Thunderbird session. When Thunderbird restarts, the add-on is removed and you must load it again from `manifest.json`.

Use this mode while editing code because you can reload it quickly from the Debug Add-ons page.

## Permanent Local Install In Thunderbird

If you want the add-on to stay installed after Thunderbird restarts, install an `.xpi` package instead of using `Load Temporary Add-on`.

1. Open a terminal.
2. Change into the extension folder:
   `cd /Users/nathancunningham/Code/thunderbird_extensions/pinned-tabs-reopener`
3. Build an `.xpi` package with the extension files at the archive root:

```sh
cd /Users/nathancunningham/Code/thunderbird_extensions/pinned-tabs-reopener
zip -r pinned-tabs-reopener.xpi manifest.json background.js popup icons
```

4. In Thunderbird, open `Add-ons and Themes`.
5. Click the gear icon.
6. Choose `Install Add-on From File...`
7. Select `pinned-tabs-reopener.xpi`
8. Approve the permission prompt and finish the install.

After that, the add-on remains installed across Thunderbird restarts until you disable or remove it from the Add-ons Manager.

If you edit the code later, Thunderbird will not automatically pick up the changes from your source folder. Rebuild the `.xpi` and reinstall it, or switch back to the temporary install flow while developing.

## How To Use

1. Open any Thunderbird tab you want to keep protected.
2. Click the `Pinned Tabs Reopener` toolbar button.
3. In the popup, click `Pin Active Tab`.
4. Optional: add a `Tab name alias` in the pinned tab row if you want your own label for that tab.
5. Close the pinned tab.
6. If Thunderbird exposes a reusable URL for that tab, the extension will try to reopen it automatically and keep it pinned.

The popup also lists all pinned records, including tabs Thunderbird cannot restore automatically. Those can still be reviewed, renamed with an alias, and unpinned manually.

## Package As An XPI Later

This is the same package used for permanent local installation.

1. Change into the extension folder:
   `cd /Users/nathancunningham/Code/thunderbird_extensions/pinned-tabs-reopener`
2. Zip the extension contents so `manifest.json` is at the root of the archive.
3. Use the `.xpi` extension for the archive filename.

Example:

```sh
cd /Users/nathancunningham/Code/thunderbird_extensions/pinned-tabs-reopener
zip -r pinned-tabs-reopener.xpi manifest.json background.js popup icons
```

## Known Limitations

- Thunderbird does not expose a cancelable "before tab close" hook through the generic tabs API. The extension works by detecting `tabs.onRemoved` and then reopening the pinned tab when the tab itself is closed. It does not reopen pinned tabs when an entire Thunderbird window is closing.
- Thunderbird documents `tabs.create()` as creating a new content tab. That means some tab types, especially `chat`, `special`, or add-on-hosted tabs, may be visible in `tabs.query()` but still not recreate cleanly through `tabs.create({ url })`.
- Thunderbird does not expose a generic API to directly rename a tab title. The add-on's `Tab name alias` is only a stored label shown inside the popup; it does not change the actual Thunderbird tab caption.
- If Thunderbird does not expose a usable `url` for a pinned tab, the extension keeps the pin record visible in the popup and logs a clear restore failure, but it cannot restore the tab automatically.
- If Thunderbird refuses to create the tab in the original window, the extension falls back to another normal Thunderbird window or opens a new normal window.
- Pinned records persist in storage across restarts, but this MVP does not restore them on Thunderbird startup. Auto-reopen only runs when an individual tab close event happens while the extension is active.

## Thunderbird-Specific Notes

- The popup is the primary UI because Thunderbird `browser_action` clicks do not trigger `browserAction.onClicked` when a popup is defined.
- The toolbar button uses `allowed_spaces: []` so it can appear in all Thunderbird spaces instead of only the mail space.
- The extension logs the raw active tab metadata to Thunderbird's extension console when you pin or unpin the active tab. This helps inspect what Thunderbird exposes for unusual tab types such as embedded Discord tabs.
