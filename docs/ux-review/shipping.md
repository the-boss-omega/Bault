# UX review: the Shipping and Services area

This review covers the collector's Shipping and Services page: the overview, the shipment composer and its four steps (with the addresses inside it), Tracking and the shipment drawer, In person (pickup at a show and hand delivery), Shared parcels, the service requests in Requests and History, and Not accepted. Every screen was opened in Chromium at 390 px and 1440 px as the seeded collector `red`, and Tracking with its drawer as `golden`, who owns the seeded shipment. Each was walked by mouse, by keyboard alone (Tab, Enter, Escape) and through the accessibility tree, and checked with axe for WCAG 2 A and AA, which found no violation after the changes. The screenshots taken before any change are in `shipping/before/`, the ones after are in `shipping/after/`, and each file is named after the screen and the width; `ss-in-person-hand` exists only after, since the hand delivery form now has its own view, and `ss-tracking-nomatch` only before, since the search is no longer drawn over an empty list. The design lint (`node scripts/design-lint.mjs`) was clean before and after. The tests for every change are in `tests/ux/shipping-ux-pass.test.tsx`.

Each item below is one finding, then its fix, then its state.

## The whole page

A success note stayed on screen after another tab was opened, so a pickup booking was still announced on Tracking. Fix: the note and any page error are cleared when the tab changes. Done.

An error from paying or cancelling in the shipment drawer was written on the page behind the drawer, where nobody was looking. Fix: the drawer shows its own error. Done.

## Overview (`ss-overview`)

The Tracking line said "Look up a shipment by id", but the tab lists every shipment and has no lookup. Fix: it says it lists every shipment sent, where it is and its tracking number. Done.

The Tracking line had an icon where the other two lines have a figure. Fix: it counts the shipments being packed or on the way. Done.

## The shipment composer (`ship-cards`, `ship-cards-blocked`, `ship-where`, `ship-where-new`, `ship-how`, `ship-review`)

Pressing Next left the focus on the Next button and, on a phone, the window at the bottom of the old step, so a screen reader heard nothing and the eye landed in the middle of the new step. Fix: the new step's heading takes the focus and the composer scrolls to its top. Done.

When the carrier list or the addresses failed to load, one red line said so with no retry, and the Where step then offered a new address form as if the collector had none. Fix: a failure with a title and "Try again", and the Where step waits for it. Done.

The confirmation of a booked shipment named the service but not what happens next. Fix: it says the warehouse packs it next and that the tracking number appears under Tracking. Done.

The steps show one primary action, keep every problem under its field with the reason on the bar, name every field, price every rate through `TierPrice` and the money formatter, and the address form inside the composer keeps the picked items. No change needed.

## Tracking (`ss-tracking`, `ss-tracking-golden`, `ss-tracking-nomatch`)

The search placeholder spoke of usernames and customers, words from the staff console, and was cut off on a phone. Fix: "Code, recipient, tracking number or status". Done.

The search was drawn over a list with nothing in it. Fix: it appears once there is a shipment. Done.

The list could not be sorted. Fix: a "Sort by" control with newest first, oldest first and the shipments needing the collector (unpaid or with a refused label) first, and such a row says "Waiting for your answer" under its status. Done.

Searching for "In transit" or "Awaiting payment" found nothing, because only the status key was searched. Fix: the status is also searched as it is written. Done.

The empty list gave no way forward. Fix: "Create a shipment" opens the Shipping tab, and a search with no match has "Clear the search". Done.

When the list failed to load, the error sat above "No shipments yet", which is false. Fix: a failure with a title and a retry, and no empty state. Done.

Each row took two Tab stops, the row itself and its "Details" button, and every button was named only "Details". Fix: the row is no longer a Tab stop, and the button is named with the shipment's code. Done.

A link to a shipment that is not in the list opened nothing and said nothing. Fix: a note says it is not among the collector's shipments. Done.

## The shipment drawer (`ss-tracking-drawer`)

The drawer gave the status but not what happens next. Fix: a "What happens next" sentence for each stage, from requested to delivered, cancelled or a carrier problem. Done.

The drawer gave the number of items but not which. Fix: "What is in it" lists each serial with its description. Done.

Opening the cancel form left the focus on the button that opened it. Fix: the reason field takes the focus. Done.

Escape closes the drawer and the focus returns to where it was, the cancel says what it costs before it is confirmed, and every amount goes through the money formatter. No change needed.

## In person (`ss-in-person`, `ss-in-person-hand`)

Pickup at a show and hand delivery were two long forms on one page, more than three phone screens with no way to tell them apart, and the hand delivery quotes sat between them. Fix: two pressed buttons choose one of the two, kept in the address as `way`, and the quotes waiting for an answer sit above both. Done.

"Book the pickup" was disabled with no reason given. Fix: while nothing is ticked, the hint says to tick the items to bring. Done.

"Ask for a quote" was disabled with no reason given. Fix: the same, for the items to hand-deliver. Done.

When the shows failed to load, the panel said no show takes pickups, which is false. Fix: a failure with a title and a retry. Done.

The pickup booking message did not say what comes next. Fix: it says to bring ID to the table and that the booking is under Tracking. Done.

The hand delivery request message did not say where the price would appear. Fix: it says the price appears at the top of the tab to accept and that nothing is charged until then. Done.

The accepted quote said only what was charged. Fix: it says the courier's progress is under Tracking. Done.

On a phone the third field of each time window ("and") wraps under the first two, because the shared `.field-row` lays out two columns. Needs another area (shared CSS).

## Shared parcels (`ss-shared`)

The collector's own shared parcels, the part followed day to day, were the last panel. Fix: they come first. Done.

With no request free to use, the join form was still shown with an empty choice of requests, a dead end. Fix: the join form is shown only when a request is free. Done.

"No request free to use" said what to do but gave no way to do it. Fix: "Go to Shipping". Done.

While loading, the tab said there was no request free to use. Fix: it says it is loading. Done.

When the parcels failed to load, the tab said there were none. Fix: a failure with a title and a retry. Done.

"Close to new members" and "Cancel the parcel" were shown to every member, though the server refuses anyone but the payer. Fix: only the payer sees them, and the others read that only the payer can. Done.

Cancelling the parcel happened on the first press. Fix: it asks first, saying every request is kept on its own. Done.

The opened, joined, closed and cancelled messages did not say what comes next. Fix: each says it, from giving the code to the others to where the requests stay. Done.

"No shared parcels" told the collector to open or join one without saying how. Fix: it points to the tick box in step 2 of the Shipping tab. Done.

## Service requests and History (`ss-requests`, `ss-history`)

When the requests failed to load, the error had no retry and "No open requests" was drawn under it. Fix: a failure with a title and a retry, and no empty state. Done.

A row named the service but not the request's code or the card. Fix: the code and the card's serial sit under the service. Done.

A custom or buyout quote waiting for the collector read only "Approved". Fix: "Waiting for your answer" under the status. Done.

The lists could not be searched or sorted. Fix: a search by code, service, serial or summary, and newest, oldest or needing the collector first. Done.

The tables had no name for a screen reader. Fix: each is named after its panel. Done.

An empty list told the collector to open a card in the vault with no way to get there. Fix: "Open your vault". Done.

The status `in_progress` reads "Approved" for every kind of service, which is the wrong word for grading under way. Needs another area (`shared/serviceLabels.ts`).

## Not accepted (`ss-not-accepted`)

When the list failed to load, the error sat above "Nothing refused". Fix: only the failure and its retry. Done.

## Handed on from the vault area

The service request messages (`services.*`) ended at "requested" without saying what comes next. Fix: each says what the warehouse does next and that the request is followed under Shipping & Services, Service requests (a donation, under History); an accepted or declined buyout says where the item stands. Done.

## Needs another area

The time window's third field wraps on a phone (shared CSS). `in_progress` reads "Approved" for every service (`shared/serviceLabels.ts`). The keys this pass replaced, `ss.overview.trackingDesc`, `ss.tracking.searchPlaceholder`, `ff.pickupBooked`, `ff.wg.requested` and `ff.wg.accepted`, are now unused and sit outside this area's prefixes, so they are left for whoever owns `ss.*` and `ff.*` to remove.
