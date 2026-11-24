# UX review: the Warehouse area

This review covers the warehouse console as the seeded operator `hermon` uses it: the overview with its shelf map and shelf contents, receiving an arrival, the inbound parcel queue, the receive bench with its OCR review and label print sheet, the store sales to shelve, the inventory tab (to shelve, move, hold, lots, arrivals not accepted, the inventory report), packing shipments, the shelves on Locations, the service requests with grading batches, and the support queue. It also covers the one item handed over from the vault pass that belongs here: a facility still on the install's stand-in address, on the admin Facilities screen (seen as the seeded admin `eldar`) and on the receiving bench. Every screen was opened in Chromium at 390 px and 1440 px, walked by mouse, by keyboard alone (Tab, Enter, Escape, the arrow keys on the tabs) and through the accessibility tree, with good and bad input in every form and OCR running on the sandbox reader. The screenshots taken before any change are in `warehouse/before/`, the ones after are in `warehouse/after/`, each named after the screen and the width. The design lint (`node scripts/design-lint.mjs`) was clean before and after. The tests for the changes are in `tests/ux/warehouse-ux-pass.test.tsx`, with the admin banner in `tests/ux/facilities.test.tsx`, the inbound address flag in `tests/integration/adm-facilities.test.ts` and the requester's username in `tests3/integration/sec-collector-views.test.ts`.

Each item below is one finding, then its fix, then its state. Of the 65 problems found, 62 are fixed here and 3 are listed as needing another area; four screens or parts that needed no change are said so.

## Overview (`overview`)

Once a parcel had waited, the backlog card showed only how long and lost its link to the parcels. Fix: the hint and the link are both shown. Done.

The tray of items on no shelf was drawn on the shelf map but led nowhere. Fix: it is a button, named with its count, that opens Inventory, where those items wait under To shelve. Done.

The log of what the operator did was shown only on the overview and the receiving tab, so retiring a shelf or packing a shipment left no visible trace where it was done. Fix: the log follows the operator to every tab once it has a line, and is a polite live region. Done.

The shelf slots are buttons named after the shelf, open the shelf's contents with Enter, and Escape returns focus to the slot. No change needed.

## Shelf contents (`shelf-contents`)

A full shelf could not be searched. Fix: a search with a count once a shelf holds more than five items. Done.

An empty shelf said only that it was empty. Fix: it says how to stow something there. Done.

A failed load said only the server's words. Fix: it has a title saying what could not be loaded, with the retry. Done.

## Receive an arrival (`receiving`)

The bench never showed the address of the building chosen. Fix: the building's address is written under the select. Done.

A building still on the install's stand-in address looked like any other (handed over from the vault pass). Fix: it is marked "(address not set)" in the list, "Address not set" on the docket, and a note above the form says parcels can be received there but customers are not shown it and nothing ships from it until an administrator sets the address under Management, Facilities. Done.

In production `GET /me/inbound-addresses` hides a placeholder building, so a warehouse whose buildings all still had the stand-in would have shown the operator an empty select and a dead Receive button. Fix: the smallest change in the `inv` module, a `placeholder` flag on each inbound address and every active building for a `warehouse_operator` or an `admin`; collectors still see only real addresses in production. Done.

When the list of buildings failed to load the select was silently empty. Fix: an error with a retry. Done.

Receive parcel was greyed out with no reason. Fix: a line says what is still needed (the building, something to trace it by, a valid username). Done.

The success line showed the raw status, "received" or "unclaimed". Fix: the status in words. Done.

The success did not say what comes next. Fix: it says to open and check the parcel below, or to attribute it once it is known whose it is. Done.

The receiving tab is close to nine phone screens and had no sections to move between. Fix: a "Jump to" row of Receive, Inbound parcels, Receive bench and Store sales, which scrolls to the panel and puts focus on its heading. Done.

## Inbound parcels (`receiving`)

The queue could not be searched or sorted. Fix: a search by parcel, tracking number, name or building, sorted oldest first, newest first or by what needs doing, with a live count. Done.

On a phone the table scrolled sideways and the status and actions were off the screen. Fix: each row becomes a card, every cell named. Done.

A failed load showed the error and then the empty state, which said there were no parcels. Fix: the failure has a title and a retry and the empty state is not drawn for it. Done.

Attributing a parcel to an account showed no error for a mistyped username, and its field was labelled as the name on the parcel. Fix: the field is "Whose account it is (username)", its hint repeats what the label reads, and a username that cannot be one is shown at the field. Done.

Opening a parcel said "All fields are required" although its photos are optional. Fix: it says to write what the check found, photos optional. Done.

After opening, nothing said what to do next. Fix: the success says to book what is inside on the Receive bench. Done.

The queue's other success words (`parcelQueue.claimed`, `parcelQueue.forwarded`) still end at what happened. Needs another area (the `parcelQueue.*` keys are outside this area's i18n prefixes).

## Receive bench and its labels (`receiving`, `label-sheet`)

The serial field's placeholder was a real seeded serial, `SN-EVS194-0009`, which reads as a filled-in value. Fix: `SN-…`. Done.

Intake was greyed out with no reason. Fix: a line lists what is missing: a valid owner, a unit described, a shelf or the reason it is decided later. Done.

Closing a parcel out charged the owner on one press and said so only in the log. Fix: it asks first, with the count booked in and that it is charged, and afterwards says the parcel is closed and to choose the next one. Errors show beside the button. Done.

A failed load of the open parcels left the parcel select silently empty. Fix: an error with a retry. Done.

The printer instructions were printed in full under every booking and in every shelf's drawer, pushing the labels down. Fix: they are folded under "How to set the printer". Done.

The OCR review, when no reading came in time, said so with no way to look again. Fix: "Look for a reading again" polls once more, beside "Not now". Done.

The OCR fields are named, the marks are announced, and the save stays disabled until every read field is checked. No change needed.

## Store sales to label and shelve (`receiving`)

The panel said there were none while it was still loading. Fix: a skeleton while it loads. Done.

A failure was bare red text with no retry. Fix: an error with a title and a retry. Done.

The empty state did not say what would appear there. Fix: it says a store sale shows up here to be labelled and shelved. Done.

## Inventory (`inventory`)

The tab is six phone screens of six panels with no way between them. Fix: a "Jump to" row for To shelve, Move, Hold, Lots, Not accepted and the report. Done.

To shelve could not be searched. Fix: a search by serial, item, parcel, owner or reason. Done.

To shelve's empty state did not say how items get there. Fix: it says items booked in with the shelf decided later wait there. Done.

A failed load of the open lots went to the log and the panel said there were no lots. Fix: an error with a retry in the panel. Done.

Breaking a lot, which cannot be undone, happened on one press. Fix: it asks first with the number of items it becomes. Done.

The result of breaking a lot was only in the log. Fix: it is shown in the panel with the next step. Done.

The not-accepted form marked a mistyped owner only with `aria-invalid`, no words. Fix: the error is shown at the field and read with it. Done.

The not-accepted form said "All fields are required" while its button was disabled. Fix: it lists what is still needed. Done.

The inventory report, which by owner grows with the customers, could not be searched. Fix: a search with a count. Done.

A failed report load had no title. Fix: a title saying the report could not be loaded. Done.

Move and Hold read the shelf back before anything moves and take a scanner's Enter. No change needed.

## Packing a shipment (`shipments`)

The bench asked for the shipment's internal id; scanning its code (`SHP-…`) answered "That identifier is not in a valid format", and nothing listed what was waiting to be packed. Fix: a list of shipments waiting to be packed (going by carrier, `rates_selected` or `labeled`) from the staff list `GET /shipping/shipments`, each with a Pack button, and a typed or scanned code is looked up in that list. Done.

A code that is not waiting gave the server's format error. Fix: it says no shipment waiting to be packed has that code. Done.

The carrier was prefilled with "DHL" and the weight with 500 grams, values made up and sent to the carrier. Fix: the carrier comes from the shipment and the weight starts empty. Done.

"All fields are required" did not say which. Fix: it lists what is still needed. Done.

## Shelves (`locations`)

The shelves could not be searched. Fix: a search by serial, barcode, zone or building. Done.

On a phone the shelves table scrolled sideways. Fix: each shelf becomes a card. Done.

Taking a shelf out of service or back gave no visible confirmation on that tab. Fix: a success note in the panel and the log. Done.

Every row's button was named "Take out of service", the same for each shelf to a screen reader. Fix: each names its shelf. Done.

## Service requests (`services`)

On a phone the table was unreadable: the item column was squeezed to a few letters a line and the forms were off the screen. Fix: each request becomes a card, every cell named. Done.

The buyout offer started at $100.00, the custom price at $25.00 and the consignment sale at $1,000.00, so a quote could go out at an amount nobody chose. Fix: every money field starts empty. Done.

A typed amount was not read back. Fix: it is read back through the shared money formatter, and text that is not an amount is said to be one. Done.

Decline and Cancel and refund, both of which move money, acted on one press. Fix: each asks first and names the request. Done.

A custom quote's hint asked to confirm a verification it has no box for. Fix: a form without the box says "Fill every field." Done.

A failed load had no retry. Fix: a titled error with a retry, and no false empty state. Done.

The queue could not be searched or filtered. Fix: a search by request, customer, item or service, and a filter by status. Done.

The customer was shown only by email, while every other warehouse screen names a username. Fix: the smallest change in the `dis` module, `requesterUsername` on the staff queue, shown as `@username` with the email under it. Done.

## Grading batches (`services`)

A failed load had no retry. Fix: a titled error with a retry. Done.

On a phone the batches table scrolled sideways. Fix: each batch becomes a card. Done.

Ship the batch was greyed out with no reason. Fix: a line says it needs the tracking number and a note. Done.

The `grade.subs.*` words (for instance the empty state) are outside this area's i18n prefixes. Needs another area. Done later, in the wording pass "Plain words on the grading, escrow and store screens": every note names the batch and the grader and says what comes next, shipping one item says "1 item", a refused add or ship is shown beside the Ship button, and the Manage, Add and Mark returned buttons name their batch or item.

## Support queue (`support`, `support-ticket`)

The queue could not be searched or narrowed to the tickets nobody had taken. Fix: a search by subject, ticket number or customer, and a "Nobody has taken it" filter. Done.

On a phone the table scrolled sideways. Fix: each ticket becomes a card. Done.

Taking a ticket gave no word that it was taken. Fix: it says so and that the customer sees the reply in their Help desk. Done.

The ticket drawer is the shared support thread, which closes on Escape and returns focus. No change needed.

## Admin facilities (`admin-facilities`, `admin-facility-drawer`)

A building still on the stand-in address was marked only by a small badge at the far right of its row (handed over from the vault pass). Fix: a note above the roll names every such building and says what it means, a "Set the address of …" button opens the first, and its row says "No street address yet" under its name. The drawer already said so and leaves the street and postal code empty to be filled. Done.

The seed itself still ships the stand-in addresses, by the hand-over's own instruction. Needs another area (seed, not changed here).
