# UX review: the Vault area

This review covers the collector's Vault grid, the item drawer with its images, history, storage cost and service forms, holds, "Ship these", Remove commons, the Inbound screens (addresses, parcels, the parcel drawer, processing) and the Notifications page. Every screen was opened in Chromium at 390 px and 1440 px as the seeded collector `red`, with a few extra stored cards added to a local database so that sorting, picking and removing had something to work on, and walked by mouse, by keyboard alone (Tab, Enter, Escape) and through the accessibility tree. The screenshots taken before any change are in `vault/before/`, the ones after are in `vault/after/`, and each file is named after the screen and the width. The design lint (`node scripts/design-lint.mjs`) was clean before and after. The tests for every change are in `tests/ux/vault-ux-pass.test.tsx`.

Each item below is one finding, then its fix, then its state.

## Vault grid (`vault-active`, `vault-hold`, `vault-history`, `vault-search-empty`)

The grid could be searched but not sorted, so a growing vault had only the server's order. Fix: a "Sort by" control with newest first, oldest first, name and serial, kept in the address as `sort`, with a History card dated by the day it left. Done.

When the list failed to load the page showed the error without a retry and, underneath, the "Nothing in your vault yet" empty state, which told a collector with cards that they had none. Fix: the failure has a title and a "Try again" button, the cards already shown stay, and the empty state is not drawn for a failure. Done.

On a phone the "In the vault since" date ran past the right edge of the second column, because the whole sentence was one unbreakable run. Fix: only the date is kept on one line and the words before it wrap. Done.

The item count was not announced when a search changed it. Fix: the count is a polite status. Done.

A link could not open the vault on a given card, so a notification about a card could not lead to it. Fix: the search starts from `q` in the address. Done.

The success note after a service request said what happened but not where to follow it. Fix: a "Follow your requests" button beside the note opens Shipping and Services, Requests; the note no longer lingers when the scope changes. Done.

The service request messages themselves (`services.*`) still end at "requested" and do not say what comes next in words. Needs another area.

## Picking cards to ship (`vault-select`)

Nothing said which cards could be picked; the others were dimmed with the reason only in hidden text. Fix: a line above the grid says only stored cards that are not on hold can ship. Done.

Picking many cards meant pressing each one. Fix: "Pick all N that can ship" in the bar, which toggles back to none. Done.

The count in the bar was not announced as it changed. Fix: it is a polite status. Done.

## Item drawer (`vault-drawer`, `vault-drawer-lot`, `vault-drawer-hold`, `vault-drawer-history`)

There was no way to ship one card from its own drawer, only through the picker on the grid. Fix: "Ship this item" is the first action of a card that can ship and opens the shipping form with it ticked. Done.

There was no way to sell a card from its drawer, because the marketplace's Sell tab cannot be opened with a card already chosen. Needs another area (marketplace).

When the history failed to load the drawer said "Nothing has happened to this item yet", which is false. Fix: the history column says it could not be loaded, with its own retry. Done.

When the storage forecast failed the section vanished without a word. Fix: a short failure with a retry in its place. Done.

A frozen card said there was nothing to do but gave no way to ask about the hold. Fix: "Ask support about this hold" opens a new support ticket. Done.

The empty history uses the shared empty state, whose display-size title is too large for the narrow history column at desktop width. Needs another area (shared primitives and CSS).

Escape closes the drawer and returns focus to the card that opened it, and every action row is named and described for a screen reader. No change needed.

## Service forms (`vault-drawer-consign`, `vault-drawer-grading`, `vault-drawer-inspection`, `vault-drawer-custom`)

Each form moves focus to its heading, names its fields, shows the fee on the slip through the shared money formatter, and keeps the submit disabled with the reason listed beside the field. No change needed.

## Remove commons (`vault-cull`)

The submit button read "Remove 0 items" and was disabled with no reason given. Fix: while nothing is picked, a line says to tick the items and then press the button. Done.

Cards that could not go were mixed in with the ones that could. Fix: the eligible cards are listed first. Done.

Picking many cards meant ticking each one. Fix: "Pick all N that can go", which turns into "Clear the picks". Done.

The list had no name for a screen reader. Fix: it is named after the panel. Done.

The toggle on the toolbar reads "Close" while the panel is open, which does not say what it closes, and the panel's sentences live under `cull.*`. Needs another area (the `cull.*` wording).

## Inbound, addresses (`inbound-addresses`)

When the addresses failed to load, "Try again" reloaded the parcels and not the addresses, and a parcels reload that succeeded could clear the address error a moment after it appeared. Fix: the parcels keep their own error, and the retry reloads whichever tab is open as well as the parcels. Done.

The seeded addresses read "SET REAL ADDRESS — placeholder"; that is facility configuration, not this screen. Needs another area (facility administration and the seed).

## Inbound, parcels (`inbound-parcels`, `inbound-parcel-drawer`)

On a phone the optional register form came first and pushed the collector's own parcels a full screen down. Fix: once there is a parcel the form folds behind a "Tell us a parcel is coming" button with a line saying it is optional, and it opens at once when there are none. Done.

The list of parcels could not be searched or sorted. Fix: a search over code, tracking number, carrier, contents, warehouse and status, with the newest parcel first and a "No parcels match" state with a way to clear the search. Done.

The empty list did not say what to do next. Fix: it offers "See where to send them", which opens the addresses tab. Done.

The parcel's button read "Shipment details", a word from the outbound screens. Fix: "Parcel details". Done.

A failed registration was reported at the top of the page, far from the form on a phone, and a duplicate tracking number was not tied to its field. Fix: a duplicate tracking number is shown on the tracking field and marks it invalid, any other failure is shown inside the form, and the fields stop at the lengths the API accepts. Done.

The success note did not say what comes next. Fix: "Registered parcel PKG-…. You will get a notification when the warehouse checks it in." Done.

Cancelling a registration happened on one press. Fix: a confirmation that says what cancelling means, with "Keep it" as the way back. Done.

The parcel drawer listed dates but did not say what happens next. Fix: one sentence for each status, and a processed parcel links to the vault. Done.

## Inbound, processing (`inbound-processing`)

A failure to load the queue left dashes with no message. Fix: it is reported with a retry that reloads the tab. Done.

## Notifications, feed (`notif-feed`)

The feed could not be searched or filtered, however long it grew. Fix: a search over kind, message and serial, a "Show" filter by kind (only the kinds present are offered), a count while filtering, and a "No notifications match" state that clears the filters. Done.

A notification about a card named its serial but could not take the collector to it. Fix: "Find it in my vault" opens the vault searched on that serial. Done.

Notifications about offers, parcels and shipments name nothing the page can link to, because the worker's payload carries no record id. Needs another area (notification payloads in the worker and `shared/notifications.ts`).

"Try again" reloaded only the feed even when the preferences had failed. Fix: it reloads both. Done.

## Notifications, preferences (`notif-preferences`)

The bulk buttons read "All In the app" and "None By email". Fix: each channel's buttons sit in a group named after the channel and read "All on" and "All off". Done.

A change was saved with no word to say so. Fix: every change says "Saved." with the notice and the channel, and a bulk change says what it did to the channel. Done.

The table runs to more than three phone screens with only headings to find a group. Fix: a row of buttons above it jumps to each group. Done.

The old `notifications.allOn` and `notifications.allOff` sentences are no longer used by this page and can be removed by whoever owns that prefix. Needs another area.

## Checklist

One primary action per screen holds: the grid's is opening a card, the picker's is "Ship these", the drawer's is its first action, the parcels tab's is registering. Errors sit next to what failed. The grid, the parcels and the notifications can be searched, and the grid and the parcels are sorted. Every amount on these screens goes through `formatUsd` or `priceLabel`. Every empty state says what to do next. Every fetch on these screens has a loading state and a failure with a retry. The forms work by keyboard and name their fields. Nothing a collector does not need is shown: no shelf, zone or barcode label appears on any of these screens.
