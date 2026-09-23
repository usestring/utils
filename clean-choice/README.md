# Clean Choice

A Chromium extension that finds checkout upsells where the way to decline is visually suppressed —
a big "Upgrade" button next to small, grey, underlined "Continue" text — and, when you ask, shows
both choices as equal buttons.

It only acts when you click it. It reads visible buttons, their names and their computed styles on
the current tab. It never reads what you typed into a form, never sends anything off the machine,
never chooses for you, and never invents a price.

## Install

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and pick `clean-choice/extension`.
3. Pin **Clean Choice** to the toolbar.

On a checkout page, click the toolbar icon, then **Scan page**. Each upsell/decline pair is listed
with the evidence behind its verdict. **Show on page** outlines the two original controls; **Show
both equally** replaces them with two same-size buttons; **Undo** puts the page back. **Off for
this site** stops the extension on that origin and undoes anything it changed there.

## How it decides

A pair is an offer control (upgrade, add, protect, premium, a price…) and a decline control
(continue, no thanks, skip, without…) within four levels of a shared container or the same form or
dialog. Back, Cancel, Close, "Add to cart" and "Continue shopping" are never paired, so ordinary
primary/secondary buttons are ignored.

A pair is flagged as lopsided when at least two of these hold: the offer is filled and the decline
is not; the decline is underlined like a link; the offer is at least 3× larger; the offer's text is
at least 1.25× larger or 200 weight units bolder; the decline's text contrast is below 4.5:1 or
half the offer's; the decline cannot be reached with Tab. Fewer than two is reported as balanced
and left alone.

The replacement buttons call the original elements' own `click()`, so the site's handlers, form
state and navigation stay in charge. The originals are hidden, not removed. If the site re-renders
the controls, the panel follows the new ones; if they disappear, the panel removes itself.

A price is shown only when exactly one amount appears on the offer or in the container around it.

## Limitations

- English wording only. Controls inside iframes or shadow DOM are not scanned.
- Built from an airline checkout layout, reproduced in `fixtures/asymmetric.html`. It has not been
  checked against a live checkout, which needs a real booking.
- The tests load the real extension and exercise the page logic in Chromium, but the popup → tab
  step needs a real toolbar click (`activeTab`), so that wiring is checked by hand.

## Tests

```bash
bun install
bun test tests/
```

The tests launch Playwright's Chromium (`bunx playwright-core install chromium` if it is missing).
