# UX review: the administrator console

FF39, area "admin". Every tab of the console was opened with Playwright as the seeded administrator (`eldar`) at 390 px and 1440 px, walked to the end of each flow with good and bad input, by keyboard, and read through role queries. The screenshots taken before any change are in `admin/before/`, the ones taken after in `admin/after/`, one per tab and width plus the account, item and wallet-request drawers. Each item below is one finding, the fix, and its state: "done" or "needs another area".

Only administrators see this console, so the collector rule (FF26) is read here as "nothing an administrator does not need", and nothing was found that breaks it.

## The console frame (all tabs)

1. A list that failed to load set itself to an empty list, so a server error read as "No accounts", "No runs yet" or "Nothing is parked", which is a lie about the data. Fix: every list keeps its own load error and shows it inside its panel with a "Try again" button (`LoadFailure` in `RollTools.tsx`), and the empty state is shown only for a list that really came back empty. Done.
2. The page-level error line always offered "Try again", which reloaded the accounts and items whatever had failed, so retrying a failed dispute update reloaded the wrong thing. Fix: the line above the tabs now only reports what an action came to and has no retry; each list's own failure carries the retry that reloads that list. Done.
3. A success or error from one tab stayed on screen after moving to another tab, describing work the new tab does not show. Fix: the line is cleared whenever the tab changes, and a new success clears an old error and the other way round. Done.
4. Twelve tabs do not fit a phone, and the tab strip scrolls sideways with nothing to say more tabs exist past the edge. Fix: the strip and its overflow cue belong to `ContextTabs` in `shared/ui/primitives.tsx`. Needs another area (shared UI).

## Shelf yield

5. The shelves table can grow to every shelf in every facility and could not be searched or reordered. Fix: a search by shelf, zone or facility and a sort (yield lowest first, which is the server's order and the default, yield highest first, revenue, items, shelf number), with the count shown. Done.
6. The figures use the shared money formatter, the zone chart and the customer table have empty states, and a failed load already showed a retry. No change needed.

## Users

7. The accounts roll could not be searched, filtered or sorted, so finding one account among hundreds meant scrolling. Fix: search by name, username or email, a status filter, and a sort by email (the server's order), name, status with held accounts first, or role. Done.
8. Clearing the first name in the account drawer greyed the Save button with no word as to why. Fix: the field is marked invalid and says under it that a first name is required, or that the name has characters it cannot keep. Done.
9. The table had no caption for a screen reader. Fix: a hidden caption names the roll and how many it shows. Done.

## Sign-ins

10. The sign-in log could not be narrowed, so finding the attempts from one address or one account meant reading every day. Fix: a search by account, address or device and an outcome filter, with the count. Done.
11. A failed load showed zeros and "No sign-in attempts recorded yet", which reads as a quiet day rather than a broken report. Fix: the failure is said in the panel with a retry (item 1). Done.

## Parked messages

12. A failed load showed "Nothing is parked", the all-clear, when nothing was known. Fix: item 1. Done.
13. The list is short by nature (only messages that failed five times), is in time order, and each requeue says what happens next; no search was added on purpose.

## Wallet requests

14. The desk had type, status and date filters but no way to find a request by its code or its customer. Fix: a search by code, customer name, username or beneficiary beside the filters, cleared by Escape and by "Clear filters". Done.
15. An end date before the start date was accepted and silently returned nothing. Fix: the "To" field says the end is before the start, and its picker cannot go below the start. Done.
16. A failed load showed "No wallet requests", the same as a clear desk. Fix: item 1. Done.

## Accounting

17. The ledger export accepted a backwards range or one over 366 days, and the link then downloaded the API's error as a file, a dead end. Fix: the range is checked with the API's own rule as it is typed, the fields are marked invalid, a sentence under them says what to change, and the download is offered only for a range the export accepts. Done.
18. A failed summary or reconciliation went to the page line far above, and the panel kept saying "Choose a month and show its summary". Fix: the error is shown in the panel that failed, with a retry. Done.
19. The by-type table showed ledger codes and `credit`/`debit` as the only words. Fix: each type is named in words where the wallet already has a word for it, with the code under it for the accountant, and the direction reads "In (credit)" or "Out (debit)". Done.
20. A pending payment's amount was written in the sentence without the amount style, and its date was missing. Fix: the amount leads the line in the amount style, then the account, the date and the provider's detail. Done.

## Items

21. The inventory roll could not be searched, filtered or sorted. Fix: search by name, serial, barcode, grade or owner, a lifecycle filter holding only the states present, an "On hold only" switch, and a sort (newest first, which is the server's order, name, owner, lifecycle). Done.
22. The owner picker listed bare emails in no order. Fix: sorted by email and each with the person's name beside it. Done.
23. The item drawer is long on a phone (the card, the barcode, the tools and then the fields); it scrolls inside the drawer with the Save button fixed at its foot, so the primary action is always in reach. No change.

## Card Embassy store

24. The products could not be searched, filtered or sorted, and the store is meant to grow. Fix: search by code, description, grade or photograph, a filter for on sale, sold out or removed, and a sort (newest, description, price either way, lowest stock). Done.
25. The Add button sat greyed with no word as to why. Fix: a line beside it says a description, a price above zero and at least one copy are needed, and a price of zero or an unreadable price is named under the price field. Done.
26. "Added to the store." and "Saved." did not say which product or what changed. Fix: the new product is named by the code the store gave it, a stock change says the new count, and taking a product off sale says buyers no longer see it and how to undo it; each message is shown under the product's own tag as well as on the page line. Done.
27. A failed save or a stock number that is not a whole count was told only at the top of the page. Fix: the error and the "whole number of copies" message sit under the product they belong to. Done.
28. The empty state did not say what to do. Fix: it says to add a product above, and that it goes on sale at once. Done.

## Pricing

29. A figure that is not a price (a zero, three decimals, a word) only greyed the Add button. Fix: the field is marked invalid and a sentence under it gives the rule and an example, for a flat amount and for a percentage. Done.
30. The Add button gave no reason while the rule had no name or no figure. Fix: a line beside it says to name the rule and give it a figure. Done.
31. A rule that could not be added was reported far from the form, and "Pricing rule added" did not say when it applies. Fix: the result is shown under the form, and the success says the rule is listed under Pricing rules and charged from now on. Done.
32. If the coverage report failed, its panel stayed a skeleton for good and the action picker stayed empty. Fix: the failure and a retry are shown in the coverage panel; a later failed refresh keeps the last report and tells the page line. Done.

## Disputes

33. The transaction picker showed raw codes and an unformatted ISO date (`9a46e1d6 — sale — $260.00 — 2026-11-23`). Fix: each option reads code, type in words, amount and date in the shared formats, newest first, and the case file names the type in words too. Done.
34. "Open dispute" was greyed with no word as to why. Fix: a line beside it says to pick the transaction first, and the note is a multi-line field. Done.
35. "Update" was always enabled, so pressing it with nothing changed sent a request, and a dispute could be marked ruled with no ruling. Fix: Update is offered once the status or the ruling has changed, works with Enter, and asks for the ruling, under the field, before a dispute is marked ruled. Done.
36. The update result went only to the page line, and "Dispute updated" did not say to what. Fix: a failure is shown under the case, and the success names the new status. Done.
37. The disputes list could not be searched or filtered. Fix: search by number, ruling or note and a status filter. Done.
38. "Dispute opened" said nothing of what comes next. Fix: it says the case is filed below as Open and to move it to Investigating when work starts. Done.

## Storage fees

39. A failed load showed "No runs yet". Fix: item 1. Done.
40. The empty state did not say when a run appears. Fix: it says the daily job writes a run the first time it charges. Done.
41. A run lists only how many items it charged, not which; the run's item ids are in the API response, but naming each item needs the report to return the items' serials and owners. Not done in this pass: it is a new report rather than a UX fix, and is left as a follow-up in the `adm` module.

## Facilities

42. A failed load showed the "no facilities yet" state. Fix: item 1. Done.
43. The list holds a handful of rows by nature (one per building), so it has no search; the drawer already names its fields and shows its errors in place. No change.

## Checks that hold on every screen

Every money figure goes through `formatUsd`; every new field is named for a screen reader by its label or `aria-label`; every new error sits next to its field with `aria-invalid` and `aria-describedby`; every search clears with Escape; and `node scripts/design-lint.mjs` is clean. The longest pages on a phone (pricing and the store, about eight screens) are made of headed panels (coverage, the new rule, the pricing rules; the new product, the products), which stand as the sections the checklist asks for.

## Needs another area

Item 4 (the tab strip's overflow cue on a phone) is in the shared `ContextTabs`. Item 41 (naming the items a storage-fee run charged) is a follow-up, not another area's.
