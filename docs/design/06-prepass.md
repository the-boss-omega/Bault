# 06 — Pre-pass before the design review

Every screen was captured and checked against [`DESIGN.md`](../../DESIGN.md) before the Day 6
design review, so the review starts from a short list instead of a cold walk.

- **Branch:** `design/prepass`, on top of `design/register-and-seller` (#16).
- **Screenshots:** [`audit/prepass/`](audit/prepass/), named `<screen>-<locale>-<width>-before.png` and `-after.png`. Only the screens with a finding are committed.
- **The full set:** run `pnpm design:screens` (see "How to regenerate" below). It writes every capture and a contact sheet to `design-screens/`, which is gitignored.

## How the pass was run

**What was captured:** 702 captures of 178 screens.
- Six personas: anonymous, collector, seller, suspended collector, operator and admin.
- Every section and tab, in Hebrew and English, at 390 and 1440 px.
- The three item sheets: active, frozen and departed.
- The verify and reset emails, rendered from the real templates.

**Automatic flags:** the script flags any capture that shows:
- an id or a sum in cents;
- an enum name;
- lowercase English words on a Hebrew page;
- sideways scrolling at phone width;
- a console error, or an API call that failed.

**Before the fixes:** 136 captures were flagged. No screen scrolled sideways at 390 px.

**After the fixes:** 83 were flagged, out of 704 captures of 180 screens; the two new screens are the enrolment's QR step. What's still flagged is data (card names, people's names, staff and collector notes), or an item in the left list below.

**The walk:** then each screen no design pass had seen was walked by eye, as were the Day 8 first-impression screens. The flags pointed to most of the findings below; looking found the rest.

## Fixed in this branch (13)

| # | What was wrong | Where | What changed |
|---|---|---|---|
| F1 | Why a card left the vault was the custody log's English note: "donation accepted — youth league raffle", "remove commons — discarded", "sale of listing &lt;uuid&gt;" | Vault › History, the departed card's sheet | The API returns a structured `departure` (`departureOf`). The page words it in both languages: "Donated", "Sold through escrow ESC-…", "Discarded at your request" |
| F2 | Cards were named `trading_card — <description>`, a class key in the title, with no serial | Shipping, in-person pickup and hand-delivery pickers, the sell select, the swap picker, the item sheet's class row | Pickers lead with the serial, then the description (`ItemPick`, `itemPickText`). The sheet names the class in words, and every "description, else class" fallback names the class (`itemName`) |
| F3 | Money, dates and e-mails were set in IBM Plex Mono, because one CSS rule made every left-to-right table cell and detail value mono. Hebrew dates were also forced left to right | Price list, seller listings, escrow, storage forecast, parcels, support, pickups | The rule is gone. Codes stay mono through `code` and `.code-inline`; the two that relied on the rule are wrapped (request code, shelf code). Dates lost `dir="ltr"` |
| F4 | The price list explained itself in English, named classes by key ("for small_collectible"), and left its English rule text un-isolated in a Hebrew table | FAQ › Prices | A translated note, class labels, the description in an LTR run, the price in `Amount` |
| F5 | The intake policy's classes, refusals and outcomes were English keys or labels, and its English prose was not isolated, so each sentence's full stop landed at the wrong end | FAQ › What we accept | Classes, refusals and outcomes come from the web's labels; the reasons and rules are marked `lang="en"` and isolated |
| F6 | Ledger rows showed `wallet request`, and four ledger types (escrow hold, release, refund, chargeback) showed as raw keys | Wallet › Overview, Transactions | Labels for every ledger and reference type the API writes, in both languages |
| F7 | Roles, account states and item states appeared as keys (`warehouse_operator`, `suspended`) | Management › Users, Items | Worded in both languages |
| F8 | A stale verify or reset link showed the API's English sentence on a Hebrew page | Verify email, reset password | A 410 is worded in the page's language; other errors go through `apiErrorKey` |
| F9 | The verify and reset emails were English only, in the old navy (`#17202c`) and a system font | The two account emails | Hebrew first, then English, each half in its own direction. The product's ink and custody green; the link kept LTR; bilingual subjects |
| F10 | No browser-tab icon (a 404 on every page), and every tab said only "Bault" | Every page | `favicon-32.png` and `apple-touch-icon.png`, the rail's B in Frank Ruhl Libre; the tab reads "&lt;section&gt; · Bault" |
| F11 | The GPS tracker's insurance note ran straight into the price: "$30.00דורש" | Shipping › add-ons | The note sits on its own line |
| F12 | The Hebrew QR instruction scrambled the bracketed app list ("Authy ,1Password") | Two-factor enrolment | The app names are one isolated run |
| F13 | `index.html` still carried comments, against the repository's convention | `apps/web/index.html` | Removed; nothing else changed there |

Each fix that changes text or behaviour has a test that failed before it:
- `tests/ux/design-prepass.test.tsx`
- `tests/web/departure-label.test.ts`
- `tests/contract/email-templates.test.ts`
- `tests/integration/vlt-scopes.test.ts`
- the updated discarded-card case in `tests/ux/customer-screens.test.tsx`

## Left for your eye or your decision (13)

| # | What | Where | Why it was left |
|---|---|---|---|
| L1 | **Notifications are English on a Hebrew page.** The worker writes an English sentence into each notification (`content.message`), and the feed and the notification emails show it | Notifications feed, notification emails | It needs one message catalogue, in both languages, shared by the worker and the web. That is content work across every event type, not a design fix. Decide whether it lands before the invites |
| L2 | **Help content is English only.** FAQ, guides and legal text exist in English alone (`faqContent.ts`, `guideContent.ts`, `legalContent.ts`, about 1,200 lines) | FAQ & Legal, every tab | The legal text waits for the lawyer (Day 7). Translating the FAQ and guides is content work. Decide: translate before the invites, or accept English for the beta |
| L3 | **Pricing rule descriptions are English data** ("Intake: A small collectible"), shown on the Hebrew price list | FAQ › Prices | Each rule needs a Hebrew description (a schema and content change), or the web needs a label per action. It's a decision about where the words live |
| L4 | **The price column misstates rules that have parameters.** The cash-out fee shows "1.00%" beside "6% (min $0.99) under $100…". Storage shows "$1.00 · daily" beside "180 days included, then 10%…" | FAQ › Prices | The column prints `value` and `billingTrigger` as if every rule were flat. Deciding how a tiered or included-period rule should read is yours; then it's a small change |
| L5 | **Wallet references show an 8-character id fragment** (`884c05db`) under the reference type | Wallet › Overview, Transactions | It's machine vocabulary, but it's also the only handle a collector can quote to support. Replacing it needs the API to send a human code per reference |
| L6 | **Most other errors still show the API's English text** | Any screen's error state | Systemic: it needs an error-code catalogue in both languages. The two first-impression links (F8) are done |
| L7 | **The departed card's sheet asks for `GET /vault/items/:id`, which 404s for a past owner** | Vault › History › a card | The photograph still shows from the list, so nothing visible breaks; only the console notices. A small API or web change, left so as not to widen this branch |
| L8 | **The consent box shows the raw terms version** "(draft-1-2026-10)" | Sign-up | It changes on Day 7 with the lawyer's text and the version bump. Isolate it then, or show only the date |
| L9 | **The link preview has no image** (`og:image`) | Shared links | No brand image exists. It belongs with the wordmark decision on Day 8 |
| L10 | **Admin tables show action and class keys, and English rule text** | Management › Pricing | Staff use the keys as identifiers, and they're set as codes. Fine for a console; reword only if staff ask |
| L11 | **Catalogue descriptions aren't always isolated.** DESIGN.md asks for an LTR run around every description; the item sheet's title and the marketplace cards set it as plain text | Item sheet, marketplace cards | It reads in order in every capture checked, because each description starts and ends with Latin text. Wrap it in `ltr-run` the next time those components change |
| L12 | **"Your storefront link" shows a bare hash path** (`#/marketplace/store?seller=red`) | Marketplace › Storefront | It should be the full address, with a copy button. A small change, but deciding what to show is yours |
| L13 | **Two Hebrew voices.** Some strings use the plural imperative ("סרקו", "הקלידו"); most use the masculine singular ("הזן", "בדוק") | Two-factor enrolment and a few others | A copy decision: pick one voice, then a single pass over `i18n.tsx` |

## The screenshots in `audit/prepass/`

| Finding | Before | After |
|---|---|---|
| F1, F2, F3 departed card, class, date | [before](audit/prepass/collector-item-history-he-390-before.png) | [after](audit/prepass/collector-item-history-he-390-after.png) |
| F2, F11 shipping picker and add-on | [before](audit/prepass/collector-shipping-services-shipping-he-390-before.png) | [after](audit/prepass/collector-shipping-services-shipping-he-390-after.png) |
| F3, F4 price list | [before](audit/prepass/collector-faq-prices-he-1440-before.png) | [after](audit/prepass/collector-faq-prices-he-1440-after.png) |
| F5 intake policy | [before](audit/prepass/collector-faq-policy-he-1440-before.png) | [after](audit/prepass/collector-faq-policy-he-1440-after.png) |
| F6 wallet | [before](audit/prepass/collector-wallet-overview-he-390-before.png) | [after](audit/prepass/collector-wallet-overview-he-390-after.png) |
| F7 console users | [before](audit/prepass/admin-admin-users-he-1440-before.png) | [after](audit/prepass/admin-admin-users-he-1440-after.png) |
| F8 stale verify link | [before](audit/prepass/anonymous-verify-email-invalid-he-390-before.png) | [after](audit/prepass/anonymous-verify-email-invalid-he-390-after.png) |
| F9 verify email | [before](audit/prepass/email-email-verification-he-en-390-before.png) | [after](audit/prepass/email-email-verification-he-en-390-after.png) |
| F9 reset email | [before](audit/prepass/email-password-reset-he-en-390-before.png) | [after](audit/prepass/email-password-reset-he-en-390-after.png) |
| F12 two-factor QR step | (no earlier capture) | [after](audit/prepass/operator-two-factor-enrolment-code-he-390-after.png) |

## How to read the full set

- **The fixed bars in tall captures:** they are full-page captures, so the sticky top bar and the navigation rail can be drawn partway down a long page. It's how the capture works, not a layout bug.
- **Flags that are only data:** card names, people's names, addresses and staff notes are English data. They are flagged only when they contain lowercase English words, and many of those (seeded support tickets, parcel notes) are still data, not a translation gap.
- **What the two numbers mean:** "Before" is the head of #16. "After" is this branch, on the same seed.

## How to regenerate

```
pnpm db:reset
MFA_REQUIRED_ROLES=admin,warehouse_operator pnpm dev:api
pnpm --filter @bault/web build
pnpm design:screens
```

Open `design-screens/index.html`. The script refuses any address that isn't this machine: it signs in with the seed's password, and it enrols two-factor on the staff accounts.
