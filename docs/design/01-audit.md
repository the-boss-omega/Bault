# 01 — Audit

What the product looks like before the "Custody Grade" pass, screen by screen, in both languages.

Every finding below was observed in a rendered screenshot or measured in the running app. Nothing
here is an adjective without an observation attached. Screenshots are in
[`audit/before/`](audit/before/), named `<screen>-<locale>-<viewport>.png`.

**Method.** The app was driven with `playwright-cli` in three signed-in passes (collector `red`,
operator `hermon`, manager `eldar`), capturing 41 + 7 + 7 tab-screens at 390 px and 1440 px in
`en`/LTR and `he`/RTL — 220 full-page captures — plus the item drawer in its active, frozen and
departed states. 66 of them are committed here as the before-set.

> **Reading the full-page captures.** The navigation rail is `position: fixed`. In a tall full-page
> screenshot it is painted once at the scroll origin, so it appears to float at the top of long
> pages and, in RTL, to sit oddly against the right edge. That is a capture artefact. The layout was
> measured instead: at 1440 px, `documentElement.scrollWidth === clientWidth === 1440` in both
> directions, the rail is `inset-inline-start: 0` (`left: 0` LTR, `left: 1364px` RTL) and the
> workspace carries `margin-inline-start: 76px`. **There is no horizontal overflow in either
> direction.** The shell mirrors correctly; almost everything inside it does not.

---

## A. Findings that recur on nearly every screen

These are counted once here rather than repeated twenty-three times below.

### A1. The item is never named. The enum is.
`vault-active-en-1440.png`, `marketplace-browse-en-1440.png`, `item-*-*.png`

Every card tile, in the vault and in the marketplace, is titled **`trading_card`** — the raw
`type_class` enum, in bold, at title size. The actual identity of the object ("2015 Pokémon XY
Roaring Skies — M Rayquaza-EX (Full Art, Δ Evolution) #105/108") is demoted to a two-line grey
subtitle that is then truncated mid-word with an ellipsis. A collector's vault currently lists four
things all called the same thing.

### A2. The serial is not the identity.
`item-active-en-1440.png`

The brief's first principle is photograph → serial → status. Today the item drawer opens with a
four-line catalogue string as its `<h2>`, `trading_card` under it, an 80 px thumbnail, a photo strip,
and only then — the **fifth** block down, under "State" — the serial `SN-ROS105-0008`, set as a small
grey pill. On the vault tile the serial is absent entirely; the tile shows the **bin** instead
(`Bin: BIN-XHMHPADV · B`), which is where the object is, not what it is.

### A3. Bidi damage wherever Latin text sits inside Hebrew.
`admin-pricing-he-1440.png`, `item-history-he-1440.png`, `vault-active-he-390.png`

The most serious defect in the product, and it is everywhere the catalogue or the database speaks
English inside an RTL page. No isolation (`<bdi>`, `dir="ltr"`, `unicode-bidi: isolate`) is applied
anywhere, so the Unicode bidi algorithm reorders the run. Observed, verbatim:

| Should read | Renders as | Where |
| --- | --- | --- |
| `90 days included, then the full intake fee again every 90 days` | `days included, then the full intake fee again every 90 days 90` | pricing, storage_oversized |
| `180 days included, then 10% of the item intake fee every 90 days` | `days included, then 10% of the item intake fee every 90 days 180` | pricing, storage |
| `Cracking a graded card out of its holder. Irreversible.` | `.Cracking a graded card out of its holder. Irreversible` | pricing, deslab |
| `2021 Pokémon SWSH Evolving Skies — Rayquaza V …` | `Pokémon SWSH Evolving Skies — 2021 Rayquaza V …` | item drawer title |
| `8 בספט׳ 2026` | `8  2026 בספט׳` | every date cell in RTL |

Leading numerals migrate to the end of the line and terminal punctuation migrates to the front. On
the mobile Hebrew vault the truncation ellipsis lands at the **start** of the line
(`…#SL10/95 · Rare Holo`), because the truncated LTR run is being laid out from the wrong edge.

### A4. State is decorative, not structural.
`vault-hold-*.png`, `item-hold-*.png` vs `vault-active-*.png`

A frozen card and an active card are **pixel-identical apart from which filter chip is dark**. The
held M Rayquaza still shows a green "Stored" pill; there is no lock, no rail, no muted actions, and
the reason for the freeze — which is written on the custody event — is not shown at all. The only
way to know a card is frozen is to have clicked the "On hold" chip to get there.

### A5. A departed item looks deleted.
`item-history-en-1440.png`, `item-history-he-1440.png`

The opposite failure. `.card--historical` paints the whole tile near-black (`--navy-800`) with
white text, inside an otherwise light product. It reads as redacted. The brief's requirement is the
reverse: desaturate the photograph, keep the chrome, keep the history navigable.

### A6. Money is set in the mono face, and does not come first.
`wallet-overview-en-1440.png`, `marketplace-offers-en-1440.png`, `admin-pricing-he-1440.png`

`--font-mono` is applied to `.amt`, `.price`, `.hero-value`, `.metric-value`, `.detail-amount` and
every numeric table cell. `$3,200.00` renders as a code token with visible letter-spacing between
the digits and the comma. Mono is the serial's job; borrowing it for money means a price and a
barcode carry the same signal. Meanwhile the amount is rarely the first thing in its row: the offers
row leads with a 2-line catalogue string and puts `$2,750.00` in the fourth column, with the asking
price as grey 12 px underneath.

Decimal alignment is claimed but not delivered: in the pricing table `$1,500.00`, `$4.00` and
`1.00%` share one right-aligned column with no decimal anchor, so no two figures line up.

### A7. Card-in-card, everywhere.
Every `*-1440.png`

The shell is: page → white rounded panel (12 px radius, drop shadow) → white rounded card grid
(12 px radius, drop shadow) → white rounded tile. Three nested elevations to show one list. The
marketplace filter row is itself a bordered strip inside the panel inside the page. `--shadow-card`
is applied to `.panel`, `.card`, `.metric-card`, `.pop`, `.modal`, `.drawer` and `.hero-balance` —
seven different resting surfaces all floating at once, which means nothing floats.

### A8. Interchangeable KPI grids with icon tiles.
`wallet-overview-en-1440.png`, `admin-yield-en-1440.png`

Both the wallet and the management console open with a row of four identical white cards, each with
a 36 px rounded-square tinted icon tile above a label above a number. Drop either grid into any
other SaaS product and nothing would look out of place. The wallet adds a dark navy "balance card"
with a gold gradient and a decorative vault-wheel illustration — the single most generic element in
the product, and the brief names it explicitly as an anti-pattern.

### A9. Density does not follow the job.
`warehouse-receiving-en-1440.png` vs `wallet-overview-en-1440.png`

The warehouse receiving bench — a keyboard- and scanner-first screen used standing up — is set at
exactly the same rhythm as the wallet: 24 px panel padding, 16 px field gaps, 20 px between panels,
17 px panel titles. The bench needs three panels and 1 900 px of scroll to do one job. There is one
density in this product and it is "comfortable".

### A10. Two vocabularies in one column.
`admin-pricing-he-1440.png`, `warehouse-receiving-en-1440.png`

The pricing table's Action column mixes translated labels (`קליטה`, `אחסון`, `משלוח`) with raw
snake-case keys (`parcel_forwarding`, `grading_fee:psa_walkthrough`, `white_glove:international`).
Twenty-seven rows, two languages and two registers in one 90 px column. The custody register has the
same problem: event kinds are translated (`שינוי מצב`), the reasons beside them are raw English
strings from the database (`state change — donated`).

### A11. Uppercase tracked-out eyebrow labels as default chrome.
Every table

`--fs-micro` + `--track-label` + `text-transform: uppercase` is the style of every table header, every
metric label and every field caption. It is the brief's named anti-pattern, applied globally rather
than chosen anywhere.

### A12. Empty states are an icon in a rounded box.
`shipping-services-requests-en-1440.png`

`EmptyState` renders a 56 px tinted rounded square containing a generic inbox/box glyph, then a
bold title, then grey text. The copy is good ("To order a service, open a collectible in your Vault
and choose an action"); the icon tile adds nothing and is the third rounded-square-with-a-glyph on
the page.

### A13. Photography is a thumbnail.
`vault-active-en-1440.png`, `marketplace-browse-en-1440.png`

The collector's photographs are real, catalogue-accurate, and rendered at **72 px** on a 1440 px
screen — in a product whose entire proposition is that somebody else is holding your object and you
cannot touch it. The marketplace listing tile gives the photo 75 px and the Buy button 110 px.

### A14. There is no landing page.
The entire SPA is behind authentication. The only anonymous surface is sign-in/sign-up/reset. The
sign-in screen is a 380 px white box with a gold `B` and a demo-credentials paragraph.

---

## B. Per-screen findings

### Vault — list (`vault-active`, `vault-hold`, `vault-history`)
- Four tiles occupy the top 590 px of a 1000 px viewport; the rest is empty ground. At 1440 px the
  grid does not use the width, and at 390 px each tile is 220 px tall to show 72 px of photograph.
- The search field is a 720 px pill with a 999 px radius and 17 px placeholder — the largest,
  loudest control in the product, for a list of four items.
- The three state chips carry counts in gold circles; the active one is a near-black pill. Three
  different button treatments in one row (`.state-control`, `.state-control.is-on`, `.link-more`).
- **No storage cost anywhere.** The vault does not show what any card is costing, so the Break-Even
  Watch the brief asks for has no surface to live on.
- "Remove commons" is a bare text link floating between the search row and the panel, unaligned to
  either.
- Sort/filter state is component state, not URL state — reloading loses it. (Scope *is* in the URL.)
- A11: `hold` and `history` scopes are reachable and now carry seeded data, but neither has a
  designed treatment; see A4 and A5.

### Vault — item drawer (`item-active`, `item-hold`, `item-history`)
- 420 px wide on a 1440 px screen: 29 % of the viewport for the most important object in the product.
- Order of information is photograph-thumbnail → media strip → State → Serial → Condition → Bin →
  Storage cost. The brief's order is photograph → serial → status.
- **Broken image.** The "Photographs and video" strip renders the alt text over a grey box, because
  the media URL is a MinIO presigned link answering **403**
  (`http://localhost:9000/bault-images/images/sn-ros105-0008-intake.jpg?X-Expires=300` — the
  signature parameters are missing from the URL). Storage/back end is out of scope for this pass;
  the UI must at minimum stop rendering a broken image with sprawling alt text.
- The barcode block sits mid-drawer at full width, above "Item history", with a "Print barcode"
  text link — an operational control in the middle of a collector's reading flow.
- Custody register: gold dots, translated event kinds, untranslated English reasons, and no
  visual separation between "what happened" and "when".
- Services are below the fold with no prices visible before the action is opened.
- At 390 px the drawer becomes full-width, which is right; the header still spends four lines on the
  catalogue string before anything actionable.

### Marketplace — browse (`marketplace-browse`)
- One listing renders as a 295 px card in a 1 240 px content area, top-left, with 940 px of empty
  ground beside it.
- Price `$3,200.00` is mono with visible tracking. No seller storefront line, no inspected-escrow
  seal, no serial.
- Filters (`Type`, `Condition`, `Price from`, `Price to`, `Sort by`) are five native `<select>`/
  `<input>` in a bordered strip. **They are component state, not URL state.** Confirmed in
  `MarketplacePage.tsx:72-76`: `type`, `condition`, `minPrice`, `maxPrice` and `sort` are each a bare
  `useState`, alongside the search box at line 57. The tab is in the hash; nothing else is. A filtered
  marketplace view cannot be linked, bookmarked or reloaded.
- Two buttons of equal size ("Buy" gold, "Make offer" white) with no hierarchy between an
  irreversible purchase and an opening bid.

### Marketplace — offers (`marketplace-offers`)
- The business rule holds, on both sides. `SellerPanels.tsx:481` branches on `offer.yourTurn`: when
  the offer is yours, the Accept button **is not rendered at all** — only "Change" (a counter that
  replaces your own price in place) and "Withdraw". The server refuses it independently
  (`offer.service.ts`, `assertNotProposer`). **Preserve `offer.yourTurn`; the redesign must not
  reintroduce a disabled Accept in its place** — the action does not exist, it is not unavailable.
- Three actions stacked vertically in a 90 px column: gold Accept, white Counter, red-text Reject.
  Three weights, three shapes, one row.
- No photograph of the item being bid on.
- `$2,750.00` is the fourth column; "Asking $3,200.00" is 12 px grey under a 2-line title. The two
  numbers a person is comparing are 380 px apart, in different sizes, one of them mono.
- Date wraps to two lines inside a mono cell (`Sep 8,` / `2026`).

### Marketplace — trade / escrow / storefront
- `marketplace-trade`: swap approval shows both parties' approval booleans as pills; the items being
  swapped are named in text with no photographs, which is the one thing a swap decision needs.
- `marketplace-escrow`: now has a real deal at the inspection gate. Rendered as an ordinary table
  row — the inspection state, which is the entire value of escrow, has no mark.
- `marketplace-store`: the public storefront reuses `.card-grid`, not the vault's register, so a
  seller's storefront and a seller's vault look like different products.

### Wallet (`wallet-overview`, `wallet-transactions`, `wallet-cash-in`)
- Dark gradient balance card with decorative vault-wheel SVG and a 44 px gold mono figure. See A8.
- Six KPI cards, four then two, leaving a half-empty second row.
- **No running balance** in the ledger. The brief requires it; the transactions table has Date /
  Type / Reference / Amount and stops.
- Reference column shows a truncated UUID fragment (`242ccbf7`) in grey under a label — an
  identifier with no prefix, no monospace consistency and no way to act on it.
- Type column repeats a tinted rounded-square icon tile per row (24 px) — the icon-tile motif again,
  now at row scale, 7 times.
- Cash-in/cash-out are correctly framed as *requests* with review status (`wallet-cash-in`), which
  is right and must be preserved.

### Services / shipping (`shipping-services-requests`, `shipping-services-shipping`)
- With the extended seed there are now custom requests at all three steps; they render as ordinary
  rows with a status pill. There is no step register, so "ask → quoted → accepted" is not visible as
  a progression anywhere.
- The quoted request's price and scope — the two things a person is being asked to agree to — are
  inside a collapsed row rather than adjacent to the accept action.
- Eight tabs (`Overview`, `Shipping`, `In person`, `Tracking`, `Shared parcels`, `Service requests`,
  `History`, `Not accepted`) in one strip at 1440 px; at 390 px the strip scrolls horizontally with
  no affordance that it does.

### Support (`support-tickets`)
- Ticket status "Waiting for us" (an **open** ticket, i.e. waiting on staff) is rendered with the
  **success/green** pill. Green for "nobody has looked at this yet" is a semantic inversion.
- `TKT-ALNDLB77` is set correctly in mono. The date beside it is *also* mono
  (`September 8, 2026 at 4:13 PM`), so the code and the date carry the same signal.
- The suspended-account banner is correct in content and is the amber `okbox--warning` component
  — the same component used for success messages, tinted differently.
- Message threads are not append-only in appearance: they render as chat bubbles
  (`.ask-bubble--you` / `--bot`) with rounded corners, which is the opposite of a dated register.

### Inbound (`inbound-parcels`)
- Now shows the collector's expected parcel. Tracking number `9400100000000000000001` renders
  unbroken and unwrapped, overflowing its cell at 390 px.
- The forwarding-address explanation, which is the point of the page, is body copy at `--fs-base`
  with no more weight than a field hint.

### Warehouse — receiving (`warehouse-receiving`)
- Three separate panels — "Receive an arrival", "Inbound parcels", "Receive bench" — stacked to
  1 900 px, when the brief asks for one continuous screen. An operator scanning a box scrolls past a
  form they have finished to reach the one they need next.
- Two gold buttons on screen at once ("Add inventory" top-right, "Open and check" in a row) plus a
  third gold "Attribute" — three primaries.
- The **unclaimed** parcel (addressed to `r.ashwod`, which resolves to nobody) is a normal table row
  distinguished only by a red-dot pill. It is the one row on the bench that is somebody's unopened
  property with no owner; it looks like the other two.
- Status pills use three different tones (`Unclaimed` red, `Received` green, `On its way` grey) and
  are the only signal — no rail, no row treatment.
- Field labels are 13 px regular and their values 14 px regular; nothing in a 5-column form row is
  visually the answer rather than the question.
- No indication of what has focus or what Enter does. `autoFocus` is not set on the bench's first
  field.

### Warehouse — inventory / locations / shipments / services / support
- All five reuse `.data-table` with uppercase headers, mono values and a pill column. They are
  correct and unremarkable; they are also indistinguishable from each other and from the management
  console's tables, so an operator's context is carried entirely by the breadcrumb.

### Management — shelf yield (`admin-yield`)
- Four KPI cards with icon tiles (A8), then three tables each with a teal progress bar in a cell.
- The bar is drawn full-width in its column with no scale, no axis and no maximum stated, so
  `$225.00` and `$75.00` produce bars whose lengths cannot be read against anything.
- "Earning" appears as a green pill on every single row of every table — a status that never varies
  is not a status.
- The brief asks for revenue-vs-occupied-space reporting in one chart style. There is no chart.

### Management — pricing (`admin-pricing`)
- 27 rules in one unpaginated table, with the *create* form above them.
- Two vocabularies in the Action column (A10); severe bidi damage in the Description column in
  Hebrew (A3); no decimal alignment between `$1,500.00`, `$4.00` and `1.00%` (A6).
- A green "Fixed amount" pill on 21 of 27 rows.
- **Pricing history is not shown.** Each rule states "in force from", but the brief's requirement —
  every historical charge shows the pricing rule that applied to it — has no surface. The data
  exists (`charge.frozen_pricing`), the screen does not.

### Management — wallet requests / disputes / items / users / storage fees
- Wallet approvals are a table with an approve/deny pair per row; money is mono, amounts are not the
  first thing in the row.
- Disputes reuse the same neutral table as items and users; a dispute — the one screen in the
  product that is about a disagreement over property — has no distinct treatment.

### Help / FAQ / prices (`faq-prices`)
- The published price list is the clearest money screen in the product and is set as an ordinary
  table with mono figures.
- `faqContent.ts` reproduces a competitor's price list verbatim and is exempted from the
  Rayquaza-only guard for that reason. Leave the quotation alone.

### Profile (`profile-details`)
- Correct and complete: real labels, `autoComplete` on every field, inline errors. Visually it is
  five stacked white panels with 24 px padding; nothing groups "who you are" apart from "how you
  sign in".

---

## C. Design-system defects in the source

### C1. Five CSS custom properties are self-referential, and one of them silently kills every link.
`apps/web/src/index.css:160-164`

```css
--success-strong: var(--success-strong);
--error-strong:   var(--error-strong);
--warning-strong: var(--warning-strong);
--warning-tint:   var(--warning-tint);
--link:           var(--link);
```

Each declares itself in terms of itself, in the **light** block. Real values are assigned only in the
two dark blocks, so in the default light theme all five resolve to the empty string — measured in the
browser: `getComputedStyle(document.documentElement).getPropertyValue('--link')` returns `""`.

The consequence is not a fallback colour. `a { color: var(--link) }` becomes *invalid at
computed-value time*, which for an inherited property means the declaration is discarded and the
element **inherits** instead. A bare link therefore computes to `rgb(26, 37, 47)` — `--text`,
identical to the body copy around it. **Every link in the light theme is invisible as a link.**
Verified by measurement, not by reading.

### C2. `font-weight: 550` is used twelve times, and no loaded face has it.
`index.css:908, 1357, 1464, 1557, 1579, 1683, 1754, 1790, 1882, 2287, 2308, 2478`

A variable font would interpolate it; none is loaded, so the browser rounds to 500 in some engines
and synthesises in others. The stylesheet's own header states the rule this breaks — "real weights
only — never a faked bold again" — and sets `font-synthesis: none` to enforce it, which means these
twelve declarations quietly fall back to 500 rather than doing anything.

### C3. Four radii, five shadows, three focus treatments.
`--r-xs/sm/md/lg/pill` and `--shadow-card/pop/hero/rail/rail-open` are all in use. Focus is
`:focus-visible` outline in some places, a `box-shadow` ring in inputs (with a **hardcoded**
`rgba(49, 93, 197, 0.14)` that is in no token), and `outline: none` with no replacement at
`index.css:1585` (`.control select:focus`).

### C4. `outline: none` without a replacement.
`index.css:1585` — `.control select:focus { outline: none; }` and nothing else. The other three
occurrences (1642, 3299, 3904) do provide a replacement (`box-shadow` ring, or a
`:focus-within` treatment on the wrapper), which is acceptable, but they use `:focus` rather than
`:focus-visible`, so the ring appears on mouse click.

### C5. Physical properties are rare but present.
The stylesheet is genuinely written in logical properties — a real strength worth preserving. The
exceptions are direction-conditional overrides (`[dir='rtl'] .rail-label`, `[dir='rtl'] .drawer`,
`[dir='rtl'] .link-more svg`, `[dir='ltr'] .drawer`) which exist because a logical equivalent was
not used. There is no lint rule preventing regression.

### C6. `<html>` `theme-color` is `#0b1f33`.
`apps/web/index.html` — the navy. It does not match the page background in either theme.

---

## D. Web Interface Guidelines sweep

Run against `apps/web/src` with the Vercel Web Interface Guidelines. The codebase is in good shape;
these are the real gaps.

```
apps/web/src/index.css:1585   - outline:none on .control select:focus with no replacement
apps/web/src/index.css:1642   - :focus not :focus-visible on inputs (ring shows on mouse click)
apps/web/src/index.css:1642   - focus ring colour rgba(49,93,197,.14) hardcoded, not a token
apps/web/src/index.css        - no touch-action: manipulation anywhere (300ms tap delay)
apps/web/src/index.css        - no -webkit-tap-highlight-color set
apps/web/src/index.css        - no env(safe-area-inset-*) on the fixed rail / mobile bar
apps/web/src/index.css:2168   - .drawer-backdrop / .modal-backdrop lack overscroll-behavior: contain
apps/web/src/index.css:163    - five self-referential custom properties (see C1)
apps/web/src/areas/customer/vault/VaultPage.tsx:711 - <img> without width/height (CLS)
apps/web/src/shared/CardPhoto.tsx:90,152            - <img> without width/height (CLS)
apps/web/src/shared/ui/PhotoInput.tsx:120           - <img> without width/height (CLS)
apps/web/src/areas/customer/auth/SignInPage.tsx:100 - username input lacks spellCheck={false}
apps/web/src/areas/warehouse/*                      - serial/bin/tracking inputs lack spellCheck={false}
apps/web/index.html                                 - theme-color does not match page background
(everywhere)                                        - no translate="no" on serials, bins, parcel codes
(everywhere)                                        - no <link rel="preload"> for the UI font
```

Checked and **passing**: icon buttons all carry `aria-label` (`IconButton` requires it); every form
control is labelled through the `Field` primitive, which correctly puts the hint in
`aria-describedby` rather than in the accessible name; skip link present; `prefers-reduced-motion`
block present at `index.css:4171`; `Intl.DateTimeFormat` used for all dates with the real locale; no
`transition: all`; no `user-scalable=no`; no `<div onClick>` acting as a button (the three that exist
are modal backdrops with `role="presentation"` and a real close control); `role="status"` /
`role="alert"` used correctly; contextual tabs are a real ARIA tablist with arrow-key support and
mirrored arrow direction in RTL.

---

## E. Bugs found that are **not** design, reported rather than fixed

Backend and business logic are out of scope for this pass (guardrail). These were found while
seeding the states the redesign needs, and each one is real.

1. **The "still owned, but departed" half of the vault History view is unreachable.**
   `apps/api/src/modules/vlt/vault.service.ts:233` matches a departure either by
   `custody_event.prev_owner_id = user` (an ownership transfer) or by
   `custody_event.new_owner_id = user AND new_state IN (shipped, donated, consigned, sold)`.
   Nothing in the application ever writes the second shape: `CustodyService.changeState`
   (`custody.service.ts:158`) does not set `new_owner_id`, and no code path writes a `dispatch`
   event at all, though the query looks for one. **Consequence:** a card a collector still owns but
   has shipped home never appears in their History — including the seeded `SN-SV146-0006`, which has
   been invisible since it was written. Suggested fix: add
   `and(eq(item.ownerId, userId), inArray(item.lifecycleState, TERMINAL))` as a third arm of the
   departure subquery, or set `newOwnerId` in `changeState`.

2. **Item media presigned URLs are unsigned.** `GET` on an `item_image` URL returns **403**; the URL
   carries only `?X-Expires=300` with no signature or credential parameters. Every item's arrival
   and professional photographs are therefore broken in the UI. The catalogue photographs served
   from `assets/images` (keyed by serial) are unaffected and work.

3. **Support ticket status tone is inverted.** `open` (waiting on staff) renders with the success
   tone. This one *is* presentational and is fixed in this pass.

---

## F. What the redesign has to produce

Derived from the above, in the order the work will be done.

1. A token layer that replaces navy/gold/teal with the Custody Grade palette, one radius, one border
   weight, one shadow, one focus treatment — and fixes C1 while doing it.
2. Self-hosted IBM Plex + Frank Ruhl Libre, replacing the platform-UI stack. *(Done — committed.)*
3. New primitives the product has no equivalent of: **Serial**, **Amount**, **Seal**, **Register /
   RegisterRow**, **StateTreatment** (active / frozen / departed), **PhotoStage**,
   **ProportionBar** (Break-Even Watch), **StepRegister**, **ConfirmSheet**, **Bidi** isolation.
4. A density system with three modes, applied by surface rather than by component.
5. Bidi isolation applied to every string that can carry Latin text inside Hebrew — catalogue
   descriptions, serials, bins, tracking numbers, dates, amounts, database reason strings.
6. Item title = the catalogue description; `type_class` demoted to a classification line.
7. Filters into the URL on the marketplace.
8. Running balance in the wallet ledger; storage cost and Break-Even Watch on the vault register.
9. A receiving bench that is one screen, compact, with the next action focused.
10. A pricing screen that shows which rule applied to a historical charge.
11. An anonymous surface that is a real landing page rather than a login box.
12. A lint rule standing in for the absent slop detector, so none of this regresses.
