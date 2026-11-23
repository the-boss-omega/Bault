# UX review: account, help and the app shell

This review covers sign-in, sign-up, the password reset request and the reset link, the email confirmation link, the profile with its addresses and security tab, the tier page at `#/tier`, support tickets, every help tab (FAQ, Guides, What we accept, Prices, Show calendar, Contact, Legal Terms and the assistant), the landing page, and the shared shell: the strip of tabs, the empty state, the error boundary. Every screen was opened in Chromium at 390 px and 1440 px, signed out for the entry screens and as the seeded collector `red` for the rest, walked by mouse and by keyboard alone, filled with good and bad input, and checked with axe (WCAG 2 A and AA), which found no violations on any of these screens before or after. The screenshots taken before any change are in `profile/before/`, the ones after are in `profile/after/`, each named after the screen and the width. The design lint (`node scripts/design-lint.mjs`) was clean before and after. The tests for every change are in `tests/ux/profile-ux-pass.test.tsx`.

Each item below is one finding, then its fix, then its state.

## The strip of tabs, shared (`help-*`, `profile-*`, `support-*` at 390)

On a phone the strip of tabs cut off the last tabs at the screen's edge with nothing to say there were more, so the help page's Show calendar, Contact and Legal Terms tabs looked missing (handed on by the vault, marketplace and admin reviews). Fix: the strip marks the side that has tabs past its edge and fades out there, on either side as it is scrolled, and it already scrolls the selected tab into view. Done.

## The empty state inside a drawer, shared

The empty state's title was set at page size, too large inside a drawer column (handed on by the vault review). Fix: inside a drawer the empty state has a smaller title, a smaller card and less padding. Done.

## Sign in (`signin`)

A wrong password was answered "Invalid credentials", which is jargon and gives no way forward. Fix: the API now says "That email or username and password do not match. Check both, or reset your password." Done.

Sign in, sign up and the reset request were one screen that did not follow the address, so the back button did nothing, a typed or shared `#/forgot` link showed whichever form was last open, and a link could not open sign-up. Fix: the screen shown is the one the address names, and the links between them write the address. Done.

## Sign up (`signup`)

The Sign up button stayed disabled until every field and the consent box were right, without saying what was missing, so a person who had not ticked the box had a button that did nothing. Fix: the button can always be pressed, and pressing it shows every field's error, including one for the consent box, and moves focus to the first. Done.

## Reset request and reset link (`forgot`, `reset-password`)

"Back to sign in" on the reset link and on the email confirmation link went to the landing page, not to sign-in. Fix: both go to `#/signin`. Done.

An expired or used reset link said "Ask for a new one" without a way to do it, and a link without a token offered only sign-in. Fix: both offer "Ask for a new link", which opens the reset request form. Done.

## Profile, details (`profile-details`)

The success note after saving the name said only "Name saved". Fix: it says the account shows the new name from now on. Done.

The email address cannot be changed here, and nothing in the API allows it. Needs another area (acc, a change-of-email flow with a new confirmation link is a feature, not a UX fix).

## Profile, addresses (`profile-addresses`)

Every saved address had buttons named only "Edit" and "Delete", so a screen reader user with two addresses could not tell which one a button acted on. Fix: each button is named for its address, "Edit address Home" and "Delete address Home". Done.

While the addresses loaded, and when they failed to load, the tab said "No saved addresses yet", which is false for a collector who has some. Fix: a placeholder while loading, nothing under the failure, which has its retry. Done.

The success notes for adding, changing and deleting an address did not say what follows. Fix: they say when the address is offered for shipping, or no longer is. Done.

## Profile, security (`profile-security`)

The password and two-factor forms already name their fields, check as they are typed and confirm their changes. Nothing to change.

## Your tier (`tier`)

A failed load showed a bare error with no title, and an empty message when the server gave none. Fix: the failure has a title, a sentence and its retry. Done.

The tier page did not link to the prices it discounts or to the explanation in the FAQ. Fix: links to the price list and to "How tiers work" under the table. Done.

The FAQ's grading answer called each grading service a "tier", which now means the account's Bronze, Silver or Gold level. Fix: the answer calls them grading services and says they are not the account's tier. Done.

## Support, tickets (`support-tickets`)

The list of tickets, which grows, could not be searched or filtered. Fix: a search by subject or ticket code and a filter by whose turn it is (All, Waiting for you, Waiting for us, Resolved), with a no-match state. Done.

When the list failed to load the page showed the error and, under it, "No tickets yet", which told a collector with tickets that they had none. Fix: the empty state is not drawn for a failure. Done.

The empty state did not offer to open a ticket. Fix: it has a New ticket button. Done.

## Support, new ticket (`support-new`)

The success note said only "Opened ticket TKT-…", not what happens next. Fix: it says the reply will show on the list as waiting for you, with a notification. Done.

## Help, the assistant (`help-ask`)

Help opened on the assistant, which is a placeholder that answers every question with a placeholder response, so the first thing a collector saw was a dead end. Fix: help opens on the FAQ, and the assistant is the last tab. Done.

## Help, prices (`help-prices`)

The price list was about five phone screens long with no search and no way to narrow it. Fix: a search box and a row of group buttons, with a no-match state and a count read to screen readers. Done.

Percentage prices read "1.00%" and "10.00%". Fix: they read "1%" and "10%". Done.

The cash-out row showed "1.00%" in the Price column, which contradicts its own sentence (6% with a minimum under $100, then $5.00 plus 1%). Fix: the Price column shows the whole schedule from the account terms. Done.

Storage was marked "daily", while the FAQ says storage is charged once per period after the free days, and its price read "$1.00", which is not what is charged. Fix: storage shows "10% of the intake fee", charged "every 90 days after 180 free days", from the rule's own parameters. Done.

A "$0.00" handling surcharge row was shown, which is noise. Fix: a fixed price of $0.00 is left out. Done.

The page did not say whose prices it shows. Fix: a line above the list says the prices are the viewer's tier price and by how much, or, for Bronze, that Silver and Gold pay less, with a link to the tier page; the tier price itself is shown by the shared `TierPrice`, with the list price struck through. Done.

A failed load had no title and no retry. Fix: both. Done.

Each intake row repeated its class under the description ("Intake: A graded comic, for Comic book (graded)"). Fix: the repeat is gone. Done.

## Help, contact (`help-contact`)

Email, phone and hours each read "Not published", three rows that tell a collector nothing. Fix: only published details are shown. Done.

"Open a ticket" opened the ticket list, not the form. Fix: it opens New ticket. Done.

## Help, FAQ, guides, what we accept, show calendar, legal (`help-faq`, `help-guides`, `help-policy`, `help-shows`, `help-legal`)

The FAQ and the legal documents are searchable with categories, every page has its loading and failure states, and the money figures use the shared formatter. Nothing else to change beyond the grading answer above.

## Landing page (`landing`)

The page explained itself in engineering words, "invariants", "database triggers", "the billing engine". Fix: the same promises in a collector's words. Done.

The card slab drawn on the landing page carries the old internal name "BAULT" in its corner, from `landing.css` and `screens.css`, which are not in this area's files. Needs another area (the stylesheet owner).

## The error page (app shell)

The page shown when the app fails said to reload and tell support, with nothing to press. Fix: a "Reload the page" button and a "Tell support" link that opens a new ticket. Done.

## Wording handed on

The Remove commons toggle read "Close", and the `cull.*` sentences were terse or flippant ("Charging you to stop charging you would be indefensible"). Fix: "Stop removing", plain sentences, and the success says where the removed items now appear. Done.

The `notifications.allOn` and `notifications.allOff` keys were unused. Fix: removed. Done.

The escrow and store screens' older `esc.*` and `house.*` sentences used "we", dashes and jokes ("There is no fee for finding out you were misled"), unlike the newer `escrow.*` and `market.*` ones. Fix: the collector-facing ones rewritten in the same plain style; the staff-facing `house.admin.*` and `house.queue.*` were left. Done.

## Needs another area

The email address cannot be changed (acc, a new feature). The landing slab's "BAULT" mark (`landing.css`, `screens.css`).
