# Bault — Custody Grade

The design system for a platform that holds other people's property and is the only record of who
owns it, where it is, and what it costs.

This document is the spec. `apps/web/src/index.css` is the implementation, and every token named
here exists there under the same name. Where the two disagree, the CSS is right and this file is a
bug.

---

## 1. The idea

Bault must communicate **trust, ownership, care, transparency, and the pleasure of collecting**.

The direction is a **precision instrument, in daylight**: a well-run lab, or the back office of a
serious institution that happens to love trading cards. Not a vault door, not a safe, not a dark
dashboard with a neon accent — those are pictures of security, and a picture of security is what you
show when you cannot show the thing itself.

What Bault can show is the thing itself: the serial, the register, the photograph, the ledger line,
the custody event with the operator's name on it. **Trust comes from precision and legibility, not
from mood.** So the palette is neutral and the collector's photographs are the most saturated thing
on any screen.

## 2. Principles

Nine rules. Each of them was written against something the audit found.

### The serial is the identity
Every item view opens with **photograph → serial → status**, in that order. Serials are IBM Plex
Mono, never truncated, always copyable (`user-select: all`), and always laid out left-to-right even
inside a Hebrew sentence. The catalogue description is the item's *name*; `type_class` is a
classification and belongs on a quiet line, not in the title. *(Before: every item in the product was
called `trading_card`.)*

### State is structural, not decorative
- **Active** — full colour, full chrome, every action offered. No modifier; this is the component.
- **Frozen** — colour retained, a visible **lock rail** along the leading edge in frost, actions
  muted **with a stated reason**. A frozen card is not broken and it is not gone; somebody else is
  holding the decision, and the screen says who and why.
- **Departed** — the **photograph desaturates**, the chrome stays, the history stays navigable.
  *A departed item never looks deleted.* *(Before: departed items were painted near-black with white
  text inside a light product, which read as redaction.)*

### Money names itself first
Amount before verb, everywhere: `$12.40 · Storage, Aug`. Tabular numerals
(`font-variant-numeric: tabular-nums`), decimal-aligned in tables, bidi-isolated so an RTL row cannot
reorder it. **No charge appears anywhere without its amount adjacent** — a service action may not
render its button before its price.

### Append-only looks append-only
Custody events, ledger lines, wallet-request history and support messages all render as **one
component**: a dated vertical register with a continuous rule down the leading edge. No hover-to-edit,
no pencil icons, no chat bubbles, nothing implying mutability. The rule runs *through* the last row
rather than tapering off — the record has not ended, that is just the most recent thing so far.

### Photography is the colour
The UI palette is neutral. Accents are semantic only, and there are five of them. The one dark
surface in the product is the **photography stage** at the top of an item view, because a card is an
object and objects are lit.

### One radius, one border weight, one shadow — and most surfaces have none
3px, 1px, and a single overlay shadow used **only** for popovers, sheets, dialogs and toasts. A panel
is a heading and a rule, not a floating white rectangle. **No cards inside cards.** Grouping is done
with spacing and rules, which is what grouping is.

### Density follows the job
Marketing generous, vault comfortable, warehouse compact — and it is **the same component adapting**,
not three components. Four variables change; everything measured in them follows.

### Motion confirms, never entertains
150–250 ms, ease-out, one purpose per animation. Irreversible actions get a deliberately slower
confirmation. `prefers-reduced-motion: reduce` disables all of it.

### Two scripts, one rhythm
The same type scale in both languages. Layout mirrors through logical properties — there is no
`[dir='rtl']` layout branch, only `inline-start` and `inline-end`. The globe control is the same
component in the same logical position in both directions. **Any screen that looks worse in one
language is not done.**

---

## 3. Type

| Face | Weights | Job |
| --- | --- | --- |
| **IBM Plex Sans** | 400 / 500 / 600 | Latin UI, and money |
| **IBM Plex Sans Hebrew** | 400 / 500 / 600 | Hebrew UI (hebrew subset only) |
| **IBM Plex Mono** | 400 / 500 | Codes. Serials, bins, parcels, tickets, barcodes. **Nothing else.** |
| **Frank Ruhl Libre** | 500 / 700 | Display, **both scripts**, marketing sizes only |

Self-hosted from `assets/fonts`, subset to `latin` / `latin-ext` / `hebrew`, `font-display: swap`,
512 kB over 19 files. Regenerate with `node scripts/fetch-fonts.mjs`. The Latin and Hebrew UI faces
are preloaded in `index.html`; everything else arrives on demand through `unicode-range`.

**Why one display family instead of a pair.** The brief asked for Frank Ruhl Libre in Hebrew paired
with a Latin serif of similar contrast, and for the pair to be confirmed as one voice before
adoption. Frank Ruhl Libre ships a Latin companion drawn for its Hebrew, so the two scripts share a
skeleton, a stroke contrast and a vertical rhythm **by construction rather than by resemblance**.
Set side by side at 48/64 px in `docs/design/type-specimen.html`, it holds. Source Serif 4 was the
alternative and was not adopted: 436 kB to assert a similarity this family gets for free.

**Codes are mono; figures are not.** The old stylesheet put money, dates, counts, serials and
barcodes in one mono bucket on the reasoning that they all contain numbers. They do — which is why
the bucket was wrong. When a price and a barcode are set identically, neither is saying what it is.
Mono does real work on a serial (fixed advance, slashed zero, unambiguous `1/l/I`); on money it was
only being borrowed for column alignment, which `tabular-nums` already provides.

### Scale
`12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64`. Ten steps, nothing between them.

| Token | px | Used for |
| --- | --- | --- |
| `--fs-caption` | 12 | table headers, timestamps, meta |
| `--fs-sm` | 13 | dense cells, warehouse body |
| `--fs-base` | 14 | controls, vault body |
| `--fs-md` | 16 | reading copy |
| `--fs-lg` | 18 | panel titles |
| `--fs-xl` | 22 | section headings |
| `--fs-2xl` | 28 | page titles |
| `--fs-3xl` | 36 | the one figure on a screen that deserves it |
| `--fs-4xl` | 48 | marketing |
| `--fs-5xl` | 64 | marketing, one line only |

Line height: `--lh-tight` 1.15 (display), `--lh-snug` 1.35 (controls, cells, UI headings),
`--lh-normal` 1.5 (body).

Weights: `--fw-regular` 400, `--fw-medium` 500, `--fw-semibold` 600. **`--fw-bold` is also 600** —
the loaded faces ship no 700, and `font-synthesis: none` is set, so asking for one gets 600 rather
than a smeared 400. *(Before: `font-weight: 550` appeared twelve times against a stack with no
variable font.)*

### Numerals
- Money, quantities, dates, percentages: `font-variant-numeric: tabular-nums`.
- Every amount is wrapped in `.amount`, which sets `direction: ltr; unicode-bidi: isolate`.
- Decimal alignment in a column is `text-align: end` + tabular figures. There is no
  character-alignment property shipping in browsers; this is the alignment.

### Currency, and a decision worth stating
Money renders as `$1,234.56` in **both** locales, rather than switching to Hebrew's trailing-symbol
convention. USD is the platform's only settlement currency; a collector comparing a Bault price to a
price guide is comparing the same string; and a ledger column that changes shape when somebody
switches language is a column two people cannot read together. Dates, by contrast, **are**
locale-formatted through `Intl.DateTimeFormat` with the real locale. This is a decision, not an
oversight, and it is the one place the system deliberately departs from "locale-correct".

---

## 4. Colour

Every token below is measured against `--surface-page` in the light theme. Ratios are stated because
a palette that has not been measured is a mood board.

### Ground

| Token | Light | Dark | Job |
| --- | --- | --- | --- |
| `--surface-page` | `#f3f4f2` | `#14161a` | The ground. Off-white with a **cool** cast — deliberately not warm cream, which plus a serif is a mood this product is not selling. |
| `--surface-raised` | `#f3f4f2` | `#14161a` | Same as the page. **Panels are not lighter rectangles.** |
| `--surface-sunken` | `#e9ebe7` | `#1c1f24` | Register rails, table headers, the navigation rail |
| `--surface-sunken-2` | `#dfe2dc` | `#24282e` | The unfilled part of a proportion bar |
| `--surface-input` | `#ffffff` | `#1c1f24` | **True white, and only where somebody types.** The only white rectangle on screen is therefore unmistakably a field. |
| `--surface-stage` | `#16181c` | `#0c0d10` | The photography stage. The one dark surface. |
| `--line` | `#dcded9` | `#2b2f36` | The hairline. One step darker than the surface. |
| `--line-strong` | `#c3c6bf` | `#3d434c` | A rule that separates sections rather than rows |

### Ink

| Token | Light | Contrast on page | Job |
| --- | --- | --- | --- |
| `--ink` | `#111318` | **16.7:1** AAA | Headings, values, the answer in a row |
| `--ink-body` | `#2a2d33` | **12.5:1** AAA | Body copy |
| `--ink-2` | `#676c74` | **4.8:1** AA | Secondary, captions, the question in a row |

**No grey text on a coloured background, anywhere.**

### Accents — five, one job each

Each has an **ink** value that passes AA as text on the page, a **mark** value for rules, rails and
seals where 3:1 is the bar, and a **wash** for the rare filled ground.

| Token | Light | Contrast | The one job |
| --- | --- | --- | --- |
| `--custody` | `#0f5b4a` | **7.3:1** AAA | In Bault's care: verified, active, custody confirmed. Also the focus ring and the primary button. |
| `--brass` | `#7a5f1f` | **5.5:1** AA | Money. Prices, wallet, ledger, fees. Never a highlight, never a border. |
| `--brass-mark` | `#9a7a2e` | 3.7:1 | Money as a rule or a seal, and figures ≥ 22 px only |
| `--frost` | `#4a6e8f` | **4.9:1** AA | Frozen. A held card, a paused action, a decision somebody else controls. |
| `--amber` | `#96591a` | **5.1:1** AA | Warning. Break-Even Watch approaching, a deadline. |
| `--amber-mark` | `#a8641a` | 4.2:1 | The amber rail and bar |
| `--oxblood` | `#8c2b2b` | **7.6:1** AAA | Irreversible, destructive, disputed. |

There is **no violet**. It was a sixth status with no job; `--violet` now points at `--ink-2`.

### The dark theme
Not an inversion and not a second brand: the ground becomes the colour the photography stage already
is, the accents lift until they clear AA against it, and every relationship holds — money is still
brass, frozen is still frost, the ink is still three weights apart. Three states, as browsers report
them: an explicit choice stamps `data-theme`; the default "system" stamps nothing, so the media query
is guarded as `:root:not([data-theme='light'])` and the `[data-theme='dark']` block repeats the
tokens so the toggle wins in both directions.

---

## 5. Shape, elevation, focus

| Token | Value | Rule |
| --- | --- | --- |
| `--radius` | `3px` | **The** radius. `--r-xs`/`sm`/`md`/`lg`/`pill` all point at it, so there are no pills. |
| `--radius-flat` | `0` | Tables, registers, photography stages, proportion bars |
| `--border-w` | `1px` | The only border weight |
| `--shadow-overlay` | `0 1px 2px …, 0 12px 32px …` | **The only shadow.** Popovers, sheets, dialogs, toasts. A resting surface never has one — `--shadow-card`, `--shadow-hero` and `--shadow-rail` are all `none`. |

**Focus.** `--focus-width` 2px, `--focus-color` custody green, `--focus-offset` 2px. One rule, on
every focusable element, in both directions, both themes. `:focus-visible`, never `:focus` — a ring
that appears on mouse click is a ring on every field somebody has merely touched. Compound controls
(the vault search, the `.control` select) take the ring on the wrapper via `:focus-within` and
suppress it on the inner element, which is the only legitimate `outline: none` in the file.

---

## 6. Space and density

4 px base: `--sp-1` 4 … `--sp-24` 96.

Four variables carry the rhythm, and switching `data-density` on a subtree changes all of them:

| | `--pad-panel` | `--gap-section` | `--gap-group` | `--gap-field` | `--row-min-h` |
| --- | --- | --- | --- | --- | --- |
| **marketing** | 64 | 96 | 32 | 12 | 56 |
| **vault** (default) | 24 | 24 | 16 | 8 | 44 |
| **warehouse** | 16 | 16 | 8 | 4 | 34 |

Warehouse also drops `--fs-base` to 13 px. It is applied on the console wrapper, so the same Panel,
Register and Field get denser without a single component being rewritten.

---

## 7. Motion

`--dur-fast` 150 ms · `--dur` 200 ms · `--dur-slow` 250 ms · `--ease` `cubic-bezier(0.16, 1, 0.3, 1)`.

One purpose per animation. Sheets slide in at `--dur-slow`; hovers and focus resolve at `--dur-fast`;
nothing loops, nothing bounces, nothing draws attention to itself. **Irreversible actions are slower
on purpose** — the confirmation sheet opens at `--dur-slow` and its confirm control does not become
available until the typed confirmation matches, so the fastest possible path through it is still
slower than a click.

Under `prefers-reduced-motion: reduce`, all durations collapse to 0.01 ms and the press-down
transform is removed.

---

## 8. The components

### Existing components, brought onto the system

| Component | What changed |
| --- | --- |
| **Panel** | Was a white rounded card with a border and a shadow. Now a heading, a rule and padding from the density scope. |
| **Button** | Five legacy variants mapped onto four jobs: `gold` → primary (custody, filled), `navy` → strong secondary (ink, filled), `secondary`, `ghost` → quiet, `danger` → destructive. A loading button **keeps its label**; the spinner replaces the icon, so the width does not change. |
| **Register** (`.data-table`, `.table`) | Square corners, sunken header at 12 px sentence case (was 11 px uppercase, 0.07 em tracked), rows ruled, numbers decimal-aligned, a 3 px state rail reserved on the leading edge of every row. |
| **Status** (`.pill`, `.badge`) | Two components became one. A 2 px leading rule in the semantic colour on the ground, square, with the status still stated in words. `.badge`'s duplicate nine-modifier block is deleted. |
| **Sheet** (`.drawer`) | 440 px default; `.drawer--sheet` is 960 px for the item, which has a photograph, an identity, services with prices and a custody register to hold. `overscroll-behavior: contain`, safe-area padding. |
| **Empty state** | The 44 px tinted rounded square with a generic glyph is deleted. Typographic, start-aligned, and it names the next action. |
| **Metric** | The four-identical-cards-with-icon-tiles grid became a ruled row of figures. `.metric-icon` is `display: none`. |
| **Balance** | The dark navy panel with a gold gradient, a glowing text-shadow and a cropped vault-door illustration became a figure and a rule. `.hero-art` is deleted. |
| **Navigation rail** | Was a navy monolith with an animated gold plate, a machined notch and a turned rivet. Now the second surface with a hairline, and the active destination takes the same 2 px custody rule as everything else. |
| **Type glyph** in ledger rows | Deleted. A 24 px tinted square beside a label that already said "Cash in". |
| **Support thread** | Chat bubbles became register rows. Support messages are append-only; a bubble is the shape of a conversation that can be deleted. |

### Components this product did not have

| Component | Why |
| --- | --- |
| **`.serial`** | The identity. `dir=ltr` + `unicode-bidi: isolate`, mono, `user-select: all`, never truncated. |
| **`.amount`** | Money. Isolated, tabular, figure-first. `--lead` and `--display` sizes; `--brass`/`--credit`/`--debit` tones. |
| **`.seal`** | Bault's mark on something it checked with its own hands — an inspected escrow deal, a signed condition report. A rule and a mark, not a chip, and it never appears on anything Bault has not physically handled. |
| **`.identity`** | Photograph → serial → status, as one line, in that order, in every place an item is named. |
| **State treatments** | `.is-frozen` / `.card--frozen`, `.is-departed` / `.card--historical`, `.frozen-reason`, `.departed-note`. |
| **`.stage`** | The photography stage and its `.stage-photo` (`object-fit: contain` — this is evidence, cropping it hides the corner somebody is trying to see). |
| **`.proportion`** | The Break-Even Watch and the shelf-yield bar, one component. Goes **amber before it says anything**. |
| **`.steps`** | The custom-request register: ask (free) → operator proposes price and scope → you accept, with the current step marked by the same rule as everything else. |
| **`.confirm-sheet`** | Full-height, the item's photograph present, the consequence in one plain sentence as the largest text in the sheet, a typed confirmation, and `--dur-slow`. |
| **`.ltr-run` / `.bidi`** | Bidi isolation, applied to every string that can carry Latin inside Hebrew. |
| **`.offer`** | A service with its price stated before its button. Structurally impossible to render one without the other. |

---

## 9. Two scripts

- Direction comes from `<html dir>`, written by `I18nProvider`. There is **no** `[dir='rtl']` layout
  branch — only `inline-start`, `inline-end`, `margin-inline`, `padding-block`, `border-inline-start`.
- `scripts/design-lint.mjs` fails the build on `ml-`/`mr-`/`pl-`/`pr-`/`left:`/`right:`/`text-left`/
  `text-right` and on off-scale values, standing in for the slop detector the brief assumed.
- **LTR islands inside RTL** are mandatory for: serials, bin/parcel/ticket codes, tracking numbers,
  amounts, catalogue descriptions, and any free-text `reason` string coming back from the API in
  English. All of them go through `.serial`, `.code-inline`, `.amount` or `.ltr-run`.
- **Icons that flip**: chevrons, back/forward arrows, the "view all" caret — anything expressing
  *direction of travel through the interface*. **Icons that do not flip**: the external-link arrow
  (it means "leaves this site", not "goes right"), clocks, checkmarks, the camera, the box.
- The globe control is one component in one logical position in both directions.

---

## 10. Density by surface

| Surface | Density | Notes |
| --- | --- | --- |
| Public / sign-in | `marketing` | The only serif. The photograph is the pitch. |
| Marketplace list & detail | `marketing` heading, `vault` body | Price is the first text line; the seal is a mark, not a badge. |
| Vault, item, wallet, services, support | `vault` | The register is the default shape. |
| Warehouse | `warehouse` | Compact, keyboard- and scanner-first, no photography stage. |
| Management | `vault` | Charts are graphite bars/lines with a single accent, tabular axis labels, no gradients. |

---

## 11. Anti-patterns — rejected, and where they were

Each of these was in the product and is named in the audit.

- Arbitrary gradients — the rail, the balance card, the gold button, the selector plate.
- Identical rounded cards for everything — panel inside panel inside tile.
- The same soft grey shadow under everything — seven resting surfaces shared one.
- Tracked-out ALL-CAPS eyebrow labels above every heading — every table header, every metric label.
- Middle-dot meta strings as default chrome.
- Icon tiles above headings — the wallet and management KPI grids, the empty state, the ledger rows.
- Generic illustrations — the cropped vault door.
- Monospace for ordinary data labels — money, dates, counts, usernames.
- Dark-mode-with-one-neon-accent.
- Cream paper plus serif everywhere.
- Interchangeable dashboard grids of KPI cards.
- Decorative animation — the rail selector's travel, the notch, the rivet.
- "Balance cards" for money.

---

## 12. The business rules the design must not break

These are product invariants. Any redesign that loses one of them has failed, whatever it looks
like.

- **Offers.** A party may not accept a price they proposed. `SellerPanels` branches on
  `offer.yourTurn`: when the offer is yours the Accept control **is not rendered** — only "Change"
  (a counter replacing your own price) and "Withdraw". It is not a disabled button. The server
  enforces it independently.
- **Swaps and gifts.** Both parties must approve.
- **Wallet.** Deposits and withdrawals are *requests* with a review status, not transfers.
- **Ledger and custody history are append-only.** They render as registers and offer no affordance
  that suggests otherwise.
- **Service pricing is shown before purchase.** `.offer` makes the price and the button one component.
- **Custom requests are three steps**: ask (free) → operator proposes → you accept.
- **Shipping eligibility rules** are unchanged.
- **A suspended user keeps support access** and nothing else, and the rail is narrowed to match.
