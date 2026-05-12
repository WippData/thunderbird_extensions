# Calendar Upgrades

`Calendar Upgrades` combines the former `calendar-call-indicators` and `calendar-inline-attendees` add-ons into a single Thunderbird Experiment extension.

## What It Adds

- Call provider icons on calendar event tiles for `Google Meet`, `Microsoft Teams`, and `Zoom`
- A persistent event hover preview with clickable join links
- Inline attendee editing inside the event dialog `Attendees` tab
- `Today` refocus behavior that scrolls day/week views toward the current time
- Right-click `Open With` menus for calendar links, including `Safari`, `Google Chrome`, `Firefox`, and `Choose Application…` on macOS

## Browser Handling

- The extension no longer rewrites Thunderbird's global `launchBrowser` behavior.
- Calendar links open in the default external browser unless you explicitly choose another app from `Open With`.
- Google Meet links are no longer forced into Chrome.

## Load In Thunderbird

1. Open Thunderbird.
2. Go to `Add-ons and Themes`.
3. Open `Debug Add-ons`.
4. Choose `Load Temporary Add-on`.
5. Select [manifest.json](/Users/nathancunningham/Code/thunderbird_extensions/calendar-upgrades/manifest.json).

## Run Tests

```sh
cd /Users/nathancunningham/Code/thunderbird_extensions
node --test \
  calendar-upgrades/tests/provider-detector.test.js \
  calendar-upgrades/tests/url-routing.test.js \
  calendar-upgrades/tests/attendee-utils.test.js
```

## Package As An XPI

```sh
cd /Users/nathancunningham/Code/thunderbird_extensions/calendar-upgrades
zip -r calendar-upgrades.xpi manifest.json experiments icons lib tests README.md
```

## Manual Verification

- Event tiles still render provider icons in day and week views.
- Hover previews stay open long enough to move into them and click links.
- Right-clicking a preview link shows `Open With`.
- Right-clicking a link in the event summary dialog shows `Open With`.
- Clicking `Today` in day or week view scrolls toward the current time.
- Inline attendee editing still replaces the separate attendee dialog.
