# UX review: the Marketplace area

This review covers the Marketplace (Browse, Sell, My listings, Offers, Trade with Swaps and gifts, the collector Storefront, the buy confirmation and the offer drawer), the Card Embassy store page and the Escrow page with its deal drawer. Every screen was opened in Chromium at 390 px and 1440 px on a freshly seeded local database, as the collectors `red` (a seller with a listing, an offer received, a swap waiting and an escrow deal) and `golden` (a buyer and a storefront visitor), and walked by mouse, by keyboard alone (Tab, Enter, Escape) and through the accessibility tree, with good and bad input in every field. The screenshots taken before any change are in `marketplace/before/`, the ones after are in `marketplace/after/`, and each file is named after the screen and the width. The design lint (`node scripts/design-lint.mjs`) was clean before and after. The tests for every change are in `tests/ux/marketplace-pass.test.tsx`, with the older marketplace tests updated where a behaviour changed on purpose, and `tests/integration/mkt-offers.test.ts` for the one API change.

Each item below is one finding, then its fix, then its state.

## Across the marketplace

Every money move that cannot be undone went through on a single press: accepting an offer sold the card, approving a swap moved ownership, and a gift was sent with no question. Fix: accepting, turning down or withdrawing an offer, approving or rejecting a swap, accepting a gift and sending a gift each open a confirmation that names the item, the other side and the amount. Done.

Errors from every tab were shown at the top of the page, far from the button that caused them and, while a confirmation or drawer was open, behind its backdrop. Fix: each refusal is shown where it happened, inside the confirmation, on the offer, beside the field or in the drawer's notice. Done.

A success or error note from one tab stayed on the screen after moving to another tab, where it no longer applied. Fix: the notes clear when the tab changes, except the note of a listing just made, which travels to My listings with it. Done.

A list that failed to load showed its empty state ("Nothing listed", "No offers", "Nothing in the store right now"), which told a collector with listings that they had none, and offered no retry. Fix: a titled error with "Try again" in the list's place, on Browse, My listings, Offers, Swaps and gifts, the store and My deals. Done.

Lists that grow (My listings, Offers, Swaps and gifts, a storefront, the store, My deals) could not be searched or sorted. Fix: a shared bar in `ListTools.tsx` with a search box, a sort and a count read out as it changes, shown once a list has more than four rows; Offers always shows it, with a filter for offers received or made. Done.

A username typed with a leading `@`, as every screen writes usernames, was refused as invalid. Fix: Trade, the storefront and Escrow drop a leading `@`. Done.

## Browse (`browse`, `browse-filtered-empty`)

A collector's own listings carried Buy and Make offer, which the server then refused. Fix: they say "Your listing" and offer Manage, which opens My listings. Done.

A price filter that was not a price was silently ignored, and a lowest price above the highest returned nothing without saying why. Fix: an error beside the field in plain words, and an upside-down range is not sent. Done.

The listing count was not announced when a search changed it. Fix: it is a polite status. Done.

The empty marketplace said what would appear but not what to do. Fix: it offers "Sell an item"; a search with no results still offers "Clear filters". Done.

Listing an item reloaded Browse with the raw search word in place of the query string, so a filtered Browse was briefly wrong after listing or after an offer was settled. Fix: both reload with the real query. Done.

## Buy confirmation and offer drawer (`buy-confirm`, `offer-drawer`)

A refused purchase closed the confirmation and showed the reason at the top of the page. Fix: the confirmation stays open with the reason inside it, and the confirm button shows it is busy. Done.

The purchase note said only "Purchase completed". Fix: it names the item and the price and says it is in your vault, and the confirmation says where the item goes before it is bought. Done.

The offer amount had no error for a non-amount, did not send on Enter, and a refusal sat at the bottom of the scrolling body. Fix: an error beside the amount, Enter sends, and the refusal is in the drawer's notice above the buttons. Done.

An offer at or above the asking price gave no hint that buying is the simpler move. Fix: the hint under the amount says so. Done.

The note after an offer said only "Offer sent". Fix: it gives the amount and says the answer will be under Offers. Done.

## Sell (`sell`)

The asking price started at $500.00 for every item, a made-up figure that could list a $3,200 card for $500 with one press. Fix: the price starts empty. Done.

A price that was not one only changed the hint. Fix: an error beside the field after it is left, in plain words. Done.

The form did not list on Enter. Fix: it is a form, and Enter lists. Done.

The vault could not open Sell with an item chosen (handed on from the vault review). Fix: Sell reads `item` (an item id) or `serial` from the address and chooses that item, and says so when the item is not one that can be listed. Done.

Before the vault loaded, Sell showed "No stored items available", then the items. Fix: a loading block until the vault has loaded, and the empty state offers "Go to your vault". Done.

With many stored items the picker was a long unsearchable list. Fix: a search box above it from five items. Done.

After listing, the note said "Item listed for sale" and Browse opened. Fix: the note names the item and price and says offers show under Offers, and My listings opens, where the listing can be managed. Done.

## My listings (`my-listings`)

Repricing did not save on Enter or cancel on Escape, and a bad price only disabled Save. Fix: Enter saves, Escape cancels, and the error is beside the field. Done.

The count of open offers was a badge with nowhere to go. Fix: on a live listing it is a button to Offers, named "See the N open offers". Done.

Delisting did not say that open offers would be declined, and a refusal closed the confirmation. Fix: the confirmation says how many open offers will be declined and keeps a refusal inside it. Done.

## Offers (`offers`)

An offer you made did not say whom it was made to. Fix: the offers list now carries `sellerUsername` (the one API change, in `mkt/market-read.service.ts`), and the row says "To @seller" with a link to their storefront; a received offer says "From @buyer". Done.

The counter form had no error for a non-amount, did not send on Enter and did not close on Escape, and its field was not named for a screen reader. Fix: a named money field with its error beside it, Enter sends, Escape returns to the buttons, and the asking price is the hint. Done.

The success notes did not say what comes next ("Counter-offer sent", "Offer rejected"). Fix: each says the amount and what happens next. Done.

The empty state gave no way forward. Fix: "Browse the marketplace". Done.

## Trade, and Swaps and gifts (`trade`)

The username did not look up on Enter, and a collector that does not exist was reported at the top of the page. Fix: a form, so Enter finds, and the error beside the field. Done.

The wanted serial did not add on Enter, and a wrong serial was reported at the top of the page. Fix: the same, Enter adds, error beside the field. Done.

A wanted item's remove button said "Cancel". Fix: "Remove", named with the serial. Done.

The cards you offer had no visible label, only a hidden one that read "They get". Fix: a visible "What you offer" (or "What you give" for a gift). Done.

The send button stayed disabled with no reason. Fix: a line under it says what is still missing. Done.

With many stored items the picker was unsearchable. Fix: a search box from five items. Done.

Before the vault loaded, Trade showed "No stored items available". Fix: a loading block. Done.

## Storefront (`storefront`, `storefront-visitor`)

The help text said the page is public, but a storefront link opens the sign-in page for anyone signed out. Fix: it says any signed-in member can open a storefront link. Done.

"Your storefront link" printed a bare `#/marketplace/store?seller=…` fragment that could not be pasted anywhere. Fix: the full address, with a "Copy link" button and a note when it is copied. Done.

The username did not open a storefront on Enter, and a seller that does not exist was reported at the top of the page. Fix: Enter opens it, the error is beside the field. Done.

A storefront with one listing said "1 listings", it showed nothing while loading, and its cards had no condition. Fix: the singular, a loading block, and the condition as on Browse. Done.

Your own storefront's cards had an empty action area. Fix: "Your listing" and Manage; your own empty storefront offers "List a collectible", and someone else's offers "Propose a trade". Done.

## The Card Embassy store (`house-store`)

A failed load said the store was empty. Fix: an error with a retry. Done.

A refused purchase closed the confirmation and showed the reason at the top of the page. Fix: the reason is inside the confirmation, which stays open, and its button shows it is busy. Done.

The store could not be searched or sorted by price. Fix: the shared list bar from five products. Done.

## Escrow (`escrow`, `escrow-deal`)

The deals list showed the word "Loading" as text and a failed load put the error at the top of the page with no retry. Fix: a skeleton table, and the error with "Try again" in the list's place. Done.

The email field accepted anything and the username field had no check, so a typo was only caught by the server. Fix: an email field with an error beside it after it is left, and a username error beside its field. Done.

"Open the deal" stayed disabled with no reason. Fix: a line under it says what is still missing, and once it is ready, what happens next. Done.

A refused deal was shown at the top of the page. Fix: above the button. Done.

The note after opening a deal said only "Deal ESC-… opened.". Fix: it says who is told and where to follow it. Done.

The empty My deals said what escrow is for but not how to start. Fix: it points to the form above. Done.

The deals list could not be searched or sorted. Fix: the shared list bar from five deals, and each row is named "Open deal ESC-…" for a screen reader. Done.

Clicking a deal showed nothing until it loaded, and a failed load did nothing visible. Fix: the drawer opens at once with a loading block, or the error with a retry. Done.

In the deal drawer, errors and success notes went to the page behind the drawer's backdrop. Fix: both are shown in the drawer's notice. Done.

Putting money in, confirming you are satisfied and returning a deal each went through on one press. Fix: each opens a confirmation with the amount and the deal code. Done.

The return reason had no hint that it is required and read by both sides. Fix: a hint. Done.

## Needs another area

The tabs on a phone scroll sideways and cut the last tab ("Storef…") with no sign there is more; that is the shared `ContextTabs`. Needs another area (shared primitives and CSS).

Server messages write money without a thousands separator ("$2750.00"), because the API's shared `formatMinor` in `apps/api/src/shared/money.ts` has none. Needs another area (API shared money).

The escrow form and drawer still use `esc.*` sentences (only new sentences were added under `escrow.*`), and the store's `house.*` sentences were left as they are. Needs another area (owner of those prefixes, to fold them into `escrow.*` and `store.*`).

Notifications about offers and swaps do not link to the offer or swap. Needs another area (notification payloads), as the vault review also found.
