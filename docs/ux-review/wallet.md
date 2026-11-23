# UX review: the wallet

The money screens of Card Embassy: the wallet overview, the statement of transactions and its receipts, cash-in (card, PayPal, crypto and a payment made another way), cash-out requests, the list of requests and a request opened, and the charges as they appear on the statement. The price list itself lives on the FAQ page, which another area owns, and is reviewed at the end under "Needs another area".

Walked on a seeded database as the collector `red` and the seller `golden`, at 390 px and 1440 px, with the mouse, with the keyboard only (Tab, Enter, Escape, arrows) and with axe-core's WCAG 2 A and AA rules. axe found no violations on any wallet screen before or after; the items below are what a person meets. Screenshots are in `wallet/before/` and `wallet/after/` (the 1440 px captures are full-page and scaled to half size to stay under 150 KB).

## Overview (`#/wallet`)

1. The header offered "Request cash in" as the primary action, though most cash-ins settle instantly and are not requests at all. Fix: the buttons now read "Cash in" and "Cash out". **Done.**
2. The in-transit strip showed a "Cash out pending $0.00" slip whenever any cash-in was pending, a figure that says nothing. Fix: each slip shows only when money is waiting in that direction. **Done.**
3. The empty state ("No transactions found") said what would appear but not what to do. Fix: it carries a "Cash in" button. **Done.**
4. A charge row was described only as "Platform charge", so a collector could not tell an intake fee from a service fee or a grading fee. Fix: the ledger now carries the charge's action and item class, and the row is named by its price-list entry ("Intake: A single card", "Flat fee for a value-added service request"), falling back to "Platform charge" when the price list cannot say for sure. **Done** (smallest change in `pay`: `LedgerService.list`).

## Transactions (`#/wallet/transactions`)

5. The list could be filtered by type and date but not searched or sorted, and it grows with every charge. Fix: a search over type, what it was for, amount and date, and a sort by newest, oldest, largest and smallest. **Done.**
6. "Clear filters" left a search in place once there was one. Fix: it clears the search, the type and the range together, and the empty text says to try another search, filter or range. **Done.**
7. The running balance was computed from the order the API returned rows in, so any other order would have shown wrong balances. Fix: balances are computed oldest first by date, whatever the list is sorted by. **Done.**
8. With four controls the tools row would not fit a phone. Fix: the controls sit in a wrapping filter bar, named as a group for a screen reader. **Done.**

## A transaction, opened

9. The drawer did not say what a charge paid for, nor where its price comes from. Fix: a "What it was for" line with the price-list entry and a "See the price list" link. **Done.**
10. The drawer did not give the balance after the movement, which the list shows. Fix: a "Balance after" line, also on the receipt. **Done.**
11. A cash-in or cash-out that settled a wallet request was a dead end: the drawer said "Wallet request" and offered no way to it. Fix: an "Open the request" button that swaps the drawer for the request's own. **Done.**
12. The receipt's heading was a hard-coded English string outside the catalogue. Fix: it comes from `wallet.tx.receiptHeading`. **Done.**

## Cash in (`#/wallet/cash-in`)

13. The tab had three primary buttons at once (the header's two, Pay now and Submit request) and ran to almost three phone screens, with a second full form for a manual cash-in under the instant one. Fix: the header buttons are gone on this tab, and the manual form sits closed under "Paid another way?" behind "Tell us about a payment", which opens it and puts the keyboard in its first field. **Done.**
14. While the ways to pay loaded the panel said "Loading…", and if they failed the error appeared at the top of the page with a retry that did not reload them. Fix: a skeleton while loading, and a failure inside the panel with a retry that loads them again. **Done.**
15. Pay now stayed disabled with no reason when the amount was outside the limits. Fix: the amount field says "Enter an amount between $10.00 and $20,000.00." beside itself, tied to the field for a screen reader. **Done.**
16. The bank-transfer help text said to "raise a cash-in request below", which no longer matches the page. Fix: it names the "Tell us about a payment" step. **Done.**
17. The manual form's limits read "$10.00 – $20000.00", not written by the shared money formatter. Fix: "Between $10.00 and $20,000.00.", and the amount errors use the formatter too. **Done.**
18. The form asked for a "Supporting document" as the "key of an already-uploaded file", which a collector has no way to get. Fix: the field is gone from the collector's form; a receipt upload needs another area (below). **Done.**
19. After a request was sent, its success note lived inside the form, which the page then left for the requests tab, so it was never seen. Fix: the page says "Request WR-… for $50.00 was sent for review. It is listed below with its status; your balance changes only once it is completed." on the requests tab. **Done.**
20. Sending the form with a missing field showed the errors but left the keyboard on the button. Fix: focus moves to the first field that needs fixing. **Done.**

## Cash out (`#/wallet/cash-out`)

21. As cash-in: two header buttons beside the form's own, the document field, the unformatted errors ("Only $9700.00 is available"), the lost success note and the focus. Fix: the same fixes; the over-balance error now reads "Only $9,700.00 is available to cash out." **Done.**
22. An empty wallet still showed the whole form, which could only fail. Fix: "Nothing to cash out yet", with the balance and a "Cash in" button. **Done.**
23. When the fee quote could not be fetched the panel silently kept saying "Type an amount to see exactly what lands". Fix: it says the fee could not be worked out and offers to try again. **Done.**

## Requests (`#/wallet/requests`)

24. The list could be searched but not filtered by status or sorted. Fix: a status filter and the same four sorts. **Done.**
25. A screen reader read each row as its cells run together. Fix: each row is named "code · type · amount · status". **Done.**
26. A search that matched nothing said "No requests yet", which is wrong once there are some. Fix: "No requests match" with a button that clears the search and the status filter; the true empty state offers "Cash in". **Done.**

## A request, opened

27. The drawer was blank while it loaded. Fix: a skeleton. **Done.**
28. Cancelling showed nothing but the changed badge, and a failed cancel left the confirmation open over the error. Fix: the drawer says "The request was cancelled.", the page says which one and that nothing moved, and a failure closes the confirmation so the error is read where it is shown. **Done.**

## Checked and left as they are

The statement slip, its sum and the transaction count, the tab bar (arrow keys move between tabs, as in every other area), the keyboard order of every tab, the row activation by Enter and Space, the PayPal and crypto returns, the duplicate-request guard, and the design lint (`node scripts/design-lint.mjs`, clean).

## Needs another area

29. A collector cannot attach a receipt to a cash-in request: `POST /media/uploads` is staff only and has no receipt purpose (`med`). Until it has one the field stays out of the collector's form.
30. The price list page (`#/faq/prices`, help area) runs to about five phone screens with no search and no way to jump to a group, so finding one fee means scrolling past all of them.
31. The price list writes percentage rules in the Price column as "1.00%" and "10.00%" beside dollar amounts, and the money rows mix a sentence ("Cash-out fee: 6% (min $0.99) under $100, otherwise $5.00 + 1%") with a figure ("1.00%") that contradicts it at a glance.
32. The price list marks storage "daily" in its Charged column, while the FAQ says storage is not billed by the day.
33. The price list shows the list price only; a collector with a tier discount sees no price of their own there, although the tier page and `TierPrice` know it.
34. The price list shows a "Handling surcharge added on top of the carrier rate" of $0.00, which reads as a fee that is not one.
