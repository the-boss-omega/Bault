# Bault — Custody Grade, showcase edition

The design system for a platform that holds other people's property and is the only record of who
owns it, where it is, and what it costs.

This document is the spec. `apps/web/src/*.css` is the implementation, and every token named here
exists there under the same name. Where the two disagree, the CSS is right and this file is a bug.
`scripts/design-lint.mjs` checks the parts of this document that can be checked (section 14).

---

## 1. The idea

Bault must communicate **trust, ownership, care, transparency, and the pleasure of collecting**.

The first edition of this system was a precision instrument in daylight: neutral, ruled, quiet. It
was right about trust and wrong about pleasure. The showcase edition keeps every one of its rules
and changes the room: **a vault with the lights turned to the objects.**

Three ideas carry it, and everything else is subordinate to them.

1. **The object is the interface.** Every card photograph in the product is a card *in its case*: a
   graded slab, smoked acrylic with a paper label that carries the name and the serial. The thing the
   platform exists to hold looks like the thing it holds, in the list, on the shelf, in the drawer,
   on the front page.
2. **Paper is the record.** The product is dark, because a lit object wants a dark room. Where
   something *is* the record (a label, the ledger, the colophon, a wallet statement, the fine print of
   a membership) it is paper: cream, ink-black type, a foil strip on its edge. Paper is never
   decoration; it marks the places where the truth is written.
3. **Foil is what is alive.** One iridescent spectrum, borrowed from the sheen of a holographic card,
   is the only accent that moves or lights: the tab indicator, the brand mark, the line under a nav
   link you point at, the scroll progress line, the light under a primary button you reach for, the
   sweep across a slab, the trim of a paper piece, the mark on the tier you are on. It never fills a
   surface and it never means a status.

Trust still comes from precision and legibility, not from mood: the serial, the register, the
photograph, the ledger line with an operator's name on it.

## 2. Principles

Nine rules. Each of them was written against something the audit found; seven are unchanged.

### The serial is the identity
Every item view opens with **photograph → serial → status**, in that order. Serials are Geist Mono,
never truncated, always copyable (`user-select: all`), and always laid out left-to-right even inside
a Hebrew sentence. The catalogue description is the item's *name*; `type_class` is a classification
and belongs on a quiet line, not in the title. The slab label repeats the serial as a *drawing* (CSS
from a data attribute), so a serial is in the document once, where the page prints it.

### State is structural, not decorative
- **Active** — full colour, every action offered. No modifier; this is the component.
- **Frozen** — colour retained, a frost halo on the case, actions muted **with a stated reason**.
- **Departed** — the case and photograph **desaturate**; the chrome stays, the history stays
  navigable. *A departed item never looks deleted.*
- A status is a **light and a word** (`.pill` and `.badge`): a 7 px LED in the semantic colour, the
  state in words beside it. Colour is never the only signal. A shelf is *drawn* empty (dashed) or out
  of service (hatched) **and says so in words**; a parcel's current stop is *drawn* and is
  `aria-current="step"`.

### Money names itself first
Amount before verb, everywhere: `$12.40 · Storage, Aug`. Tabular lining numerals. Every amount is
wrapped in `.amount` (`direction: ltr; unicode-bidi: isolate`). **No charge appears anywhere without
its amount adjacent, and no amount without its name.** The column header that names a figure in a
table is hidden in every card layout, so on a card the name travels with the figure: `.money-label`
(*cost so far*, *price*, *offer*). Lead figures (a balance, a statistic, a price) are set in the
display face, large, because money is the one thing a collector reads twice.

### Append-only looks append-only
Custody events, ledger lines, wallet-request history and support messages render as **a register**:
a dated vertical rule with a node per entry, the newest lit. No hover-to-edit, no pencil icons, no
bubbles. On the front page the same idea is shown literally: a ledger that writes itself a line at a
time, whose fourth line is a *correction* appended under the others while nothing above it moves. A
wallet's statement shows the identity the ledger keeps as the sum it is: credited, less debited,
equals net.

### Photography is the colour
The UI is monochrome. Accents are semantic, and there are five of them. The one place the UI itself
is allowed to be colourful is the foil, and only as a hairline or a band.

### One radius family, one border weight, shadows only for objects
The kit's radius (`--radius`, 10 px) and the sizes derived from it: `--r-xs` 6 · `--r-sm` 8 ·
`--r-md` 10 · `--r-lg` 14 · `--r-xl` 18, plus `--r-bar` (3 px, the end of a bar a few pixels thick)
and `--r-capsule` (the product's one pill, used on purpose: the header's control group, the landing's
buttons, the journey's chips). The slab's corners are container-relative (`cqw`) so they scale with
it. Panels have none: **a panel is a heading and a rule, not a floating rectangle**. The lint rejects
any other radius in the layers. A 1 px hairline is the only border weight; shadows are for objects
that are physically in the room: a slab, a paper piece, a popover, a drawer, a dialog.

### Density follows the job
Marketing generous, vault comfortable, warehouse compact — the same component adapting, not three
components. Four variables change; everything measured in them follows.

### Motion shows a change of state or makes an argument
It is allowed to be generous on the public page and exact in the product. Every animation does one
of three jobs: **confirm** (a press, a focus, a drawer closing), **orient** (a page arriving, a tab
indicator travelling, a card entering a shelf) or **argue** (the front page's journey, in which one
card changes state while you read). Only two kinds of thing loop, and the lint holds the list:
*waiting* (a skeleton's shimmer, a button's spinner, the boot mark) and *alive* (the foil on the
brand mark and on the rule above the landing's headings, the register's caret, the hero card's breathing,
which stops when it is off screen). `prefers-reduced-motion: reduce` removes all of it, including
smooth scrolling that a script asks for, and nothing is ever hidden *waiting* for an animation that
will not run.

### Two scripts, one rhythm
The same type scale in both languages. Layout mirrors through logical properties. The few things
logical properties cannot turn around (a gradient's angle, a transform origin, a background position,
a chevron, the side a drawer slides from) multiply by one token, `--dir`, declared once in
`theme.css`; **no other rule may ask which way the page reads**. The display face carries both
scripts. **Any screen that looks worse in one language is not done.**

---

## 3. Type

| Face | Weights | Job |
| --- | --- | --- |
| **Frank Ruhl Libre** | 500–700 (variable) | Display, **both scripts**: page titles, section headings, lead figures, the wordmark. Hebrew display and the wordmark set at 700 |
| **Geist** | 400–600 (variable) | Latin UI, body copy |
| **IBM Plex Sans Hebrew** | 400 / 500 / 600 | Hebrew UI and body (hebrew subset only), and the Hebrew in any mono label (Geist Mono has no Hebrew, so it is second in `--font-mono`) |
| **Geist Mono** | 400–600 (variable) | Codes: serials, bins, parcels, tickets, barcodes. Also the small caps labels (kickers, `§` marks, breadcrumbs), set in the UI face in Hebrew, which has no capitals |

Self-hosted from `assets/fonts`, subset to `latin` / `latin-ext` / `hebrew`, `font-display: swap`.
Geist, Geist Mono and Frank Ruhl Libre are variable fonts: **one file per subset and one `@font-face`
covering the weight range**. Regenerate with `node scripts/fetch-fonts.mjs`, which also removes files
nothing produces. The Latin UI face, the Hebrew UI face and the display face (both scripts) are
preloaded in `index.html`; the rest arrive through `unicode-range`.

**Why a serif.** The kit's grotesque is the right voice for controls and the wrong voice for a house
that keeps people's property: a catalogue, a ledger and a deed are all set in a serif. Frank Ruhl
Libre ships a Latin companion drawn for its Hebrew, so a Hebrew headline and an English one share a
skeleton, a stroke contrast and a vertical rhythm by construction.

**Codes are mono; figures are not.** Mono does real work on a serial (fixed advance, slashed zero,
unambiguous `1/l/I`). Money, dates and counts are set in the UI face, or in the display face when they
are the point of the screen.

### Scale
The product's UI scale is `12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64` (`--fs-*`), and
`index.css` is linted against it. The public page, the page titles and lead figures use fluid display
sizes (`clamp`) between 34 and 128 px, because a headline is not a control; the small caps labels are
11–13 px and a few body-adjacent sizes (13.5, 14.5, 15, 15.5 px) sit between steps in the layers. The
layers are not linted for size.

Line height: `--lh-tight` 1.15 (display), `--lh-snug` 1.35, `--lh-normal` 1.5. Display headings set at
1.0–1.1; Hebrew display gets an extra 0.05. **Tracking is Latin-only**: Hebrew display tracking is 0
(`:lang(he)`).

Weights: 400 / 500 / 600 in the UI; 500 and 700 in the display face.

### Numerals
- Money, quantities, dates, percentages: `font-variant-numeric: tabular-nums` (and `lining-nums` in
  the display face).
- Decimal alignment in a column is `text-align: end` + tabular figures.

### Currency
Money renders as `$1,234.56` in **both** locales. USD is the only settlement currency, a collector
comparing a Bault price to a price guide is comparing the same string, and a ledger column that
changes shape when somebody switches language is a column two people cannot read together. Dates are
locale-formatted through `Intl.DateTimeFormat`.

---

## 4. Colour

The theme is the shadcn/ui kit's (`theme.css`, part 1: `--background`, `--card`, `--primary`,
`--muted`, `--border`, `--input`, `--ring`, `--destructive`, light and dark, pasted from the kit's
own export). Part 2 maps those names onto Bault's tokens, so re-theming is a paste. **Dark is the
default**; light and system stay on the toggle. The two dark blocks (system-dark and explicit dark) are
one theme written twice; the lint fails if they drift apart.

### Ground and ink (dark)
| Token | Value | Job |
| --- | --- | --- |
| `--surface-page` | `#0a0a0a` (`--background`) | The room |
| `--surface-raised` | `#141414` (`--card`) | Surfaces that stand on the page: tier cards, parcel labels, shelf slots, the sign-in stage |
| `--popover` | `#171717` | Overlays: drawers, dialogs |
| `--surface-sunken` | `#1c1c1c` (`--muted`) | Table headers, hover grounds, the rack a shelf slot stands in |
| `--line` | white 10 % (`--border`) | The hairline |
| `--line-strong` | white 15 % (`--input`) | A rule that separates sections |
| `--ink` | `#fafafa` | Headings, values |
| `--ink-2` | `#a3a3a3` (`--muted-foreground`) | Secondary text |
| `--focus-color` | 72 % foreground over the page | The focus ring |
| `--control-border` | 46 % foreground over the page | The edge of a field and of a search box |

Fields are the foreground at 3.5 % over the page, with the control border. Light is the kit's light:
white page, `#171717` primary, `#5f5f68` secondary ink.

### Measured
`design-lint` computes these from `theme.css` on every run and fails below the threshold.

| Pair | Light | Dark | Needs |
| --- | --- | --- | --- |
| foreground on the page | 19.8 | 19.0 | 4.5 |
| secondary text on the page / on the dimmest surface | 6.3 / 5.8 | 7.8 / 6.0 | 4.5 |
| primary button text on its fill | 17.2 | 14.2 | 4.5 |
| error text on the page | 6.1 | 6.9 | 4.5 |
| focus ring on the page / on a muted surface | 9.9 / 9.1 | 8.9 / 7.7 | 3 |
| field border on the page / on a muted surface | 3.8 / 3.5 | 3.8 / 3.2 | 3 |

On the paper (both themes): print 16.2, copy 9.4, labels 8.0. On the room: ink 12.2–16.7.

### Accents — five, one job each, unchanged
`--custody` (in Bault's care: verified, stored) · `--brass` (money) · `--frost` (frozen) · `--amber`
(warning, and money that has not moved) · `--oxblood` (destructive; follows `--destructive`). Each has
an ink value that clears AA as text, a mark value, and a wash. The theme's `--primary` is *not* an
accent: it is the primary button.

### Foil
`--foil` — a 115° ramp of five light hues (`--foil-a` … `--foil-e`, rose → amber → mint → sky →
violet). Hairlines and bands only. It is still, except for the loops listed in section 2.

### Paper
`--paper` `#f3efe6`, `--paper-bright` `#fffdf8`, `--paper-line` `#d6d0c2`, the inks `--paper-ink`,
`--paper-ink-2` (copy), `--paper-ink-3` (labels), the rules `--paper-rule` and `--paper-rule-soft`,
`--paper-shadow`, the amber of a correction `--paper-amber`, and `--paper-grain` (fractal noise laid
over it with multiply). Paper is the same in both themes. A surface that paints it names the focus
ring that reads on it (`--focus-color: var(--paper-ink)`); the lint requires it.

### The room
`--room-deep` … `--room-pool`, `--room-glass` and `--room-ink`: the dark a card is photographed
against (the slab's case, the item drawer's stage, the journey's shelf). A photograph does not change
with the page, so the room is dark in both themes and its ring is `--room-ink`.

---

## 5. Shape, elevation, focus

| Token | Value | Rule |
| --- | --- | --- |
| `--radius` | `0.625rem` (the kit's) | Controls |
| `--r-xs` / `--r-sm` / `--r-md` / `--r-lg` / `--r-xl` | radius − 4 / − 2 / 0 / + 4 / + 8 | Paper slips and clauses / shelf slots / controls / cards / tickets and large stages |
| `--r-bar` | `3px` | A rule or a bar a few pixels thick |
| `--r-capsule` | `999px` | The three deliberate pills |
| `--border-w` | `1px` | The only border weight |
| `--shadow-overlay` | popover/drawer/dialog | Overlays |
| the slab shadow | inside `.slab-case` | The one resting shadow: an object on a table |

**Focus.** A two-pixel `outline` in `--focus-color` at a two-pixel offset (`:focus-visible`, never
`:focus`), which measures about 9:1 in both themes, and a field's border takes the same colour. The
kit's own ring (a soft halo, about 1.5:1) is a decoration, not an indicator, and is not used. An
outline follows the element's radius and does not replace its shadow, so hover cannot remove it.
A search box rings the box around its input (`:focus-within`). Surfaces that keep their palette in
both themes set their own ring: `--paper-ink` on paper, `--room-ink` on the room. A heading that a
jump link focuses (`tabindex="-1"`) shows none: it is not a control.

---

## 6. Space and density

4 px base: `--sp-1` 4 … `--sp-24` 96. This is Tailwind's spacing scale, which the kit uses, and it is
held in the layers as well as in `index.css`: every padding, margin, gap and inset is a multiple of
four or one of the scale's half steps (2, 6, 10, 14 px), with the 1 px hairline for a nudge, and
`design-lint` says so when one is not. Sizes (a glyph, a ring, a rail's width) are not space, so they
are not held to it; when a size has to be taken out of a space (a 3 px bar out of a padding), it is a
custom property that both read, not a number written twice.

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

Tokens: `--dur-fast` 150 · `--dur` 200 · `--dur-slow` 250 · `--dur-enter` 300 · `--dur-exit` 180 ms
(read by `useExit`, so the exit's length is set in one place); for the slower, larger moves
`--dur-surface` 400 (a surface settling) · `--dur-colour` 600 (a colour moving) · `--dur-reveal` 900
(a reveal) · `--dur-hero` 1400 ms; `--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)` for arrivals,
`--ease-in-out-quart` for departures and breathing, `--ease-in-out` for the in-between. A length that
belongs to one piece of choreography (a stagger, the landing's headline words) is written beside the
thing it times and not given a name it would share with nothing.

| Where | What | Job |
| --- | --- | --- |
| Slab | Tilts toward the pointer (±9°), the card shifts against it, a spot of light and a holographic spectrum slide across the case | Orient / delight |
| Hero slab | Breathes (a slow idle sway of the sheen); paused while the hero is off screen | Alive on purpose |
| Landing hero | Headline words rise out of a mask; text and buttons rise; five cards fan out from a stack; the plate rises; the fan leans toward the pointer | Argue |
| Landing, scrolling | Section words rise; the ledger writes itself; rows lean on hover; tickets tilt; a foil progress line; a header that blurs | Orient |
| Landing, journey | One card moves through four states while you read (unidentified → booked in, with a flash → shelved → decided) | Argue |
| Shell | A page's own sections rise in sequence (the page container itself does not move); cards in a gallery arrive in sequence; figures count up; the tab indicator is foil and glides to the active tab | Orient |
| Wallet | The statement's sum prints in when the overview opens; the balance counts up | Orient |
| Controls | Press settles (`scale(.98)`); a primary button throws a little foil light under itself, clipped at its lower edge so it never hazes the face | Confirm |
| Overlays | Drawers slide, dialogs and the photo lightbox rise, all *exit* (`.is-closing` for `--dur-exit`) | Confirm |
| Loading | Placeholders are empty cases in the shape of what is coming, with a shimmer; the boot mark breathes | Orient |

Under `prefers-reduced-motion: reduce` every animation and transition is removed, and a script that
scrolls asks `scrollBehavior()` instead of saying `'smooth'`. Hidden *initial* states exist only
under `prefers-reduced-motion: no-preference`, and only inside an element carrying `.lp-js`, which
`useMotionReady` adds before the first paint and only where `IntersectionObserver` exists, so
nothing is ever left invisible.

**Irreversible actions are slower on purpose**: the confirmation sheet opens at `--dur-slow` and its
confirm control is not available until the typed confirmation matches.

---

## 8. The components

### The slab (`CardPhotoThumb`, `CardSlab`; `slab.css`)
The signature object. Every card photograph is shown this way. Anatomy: the **case** (smoked acrylic,
inner edge light, a drop shadow); the **label** (paper, the name up to the first ` · ` on two lines,
the serial in mono, a foil strip underneath); the **window** (the photography mat: a dark well with a
top light and an inner shadow); the **glare** (pointer-tracked light plus the foil spectrum,
`mix-blend-mode: overlay`). It is sized in container units, so one slab scales from a 44 px table
thumbnail (no label text) to a 400 px hero. States are on the object: frozen has a frost halo,
departed loses its colour. The lightbox is the same slab, large, with the same focus handling as a
drawer. A photograph is looked for as a 640 px WebP, then the original, and the source that worked
is remembered per serial.

### Gallery (`gallery.css`)
The vault and the marketplace show items as slabs on a table: serial, name, state light, bin, cost.
In the vault the whole tile is the button that opens the item, so its photograph is a decorative slab
(not a second tab stop); in the marketplace the thumbnail opens the lightbox.

### Panel and statement
A panel is a **section of a printed statement**: a hairline across the top with a 32 px, 2 px rule at
its start, a serif heading, content. Statistics are columns divided by hairlines with lead figures in
the display face. A table is hairline rows under a quiet header, with a foil mark on the leading edge
of a row you point at.

### The screens that are objects (`screens.css`)
These screens were tables, lists of checkboxes or metric grids, and are now made of the system's own
pieces. Each keeps the old markup's contracts and message keys.

- **Wallet — the statement** (`StatementSlip`). A paper slip with a foil trim: currency and
  provenance in mono, the balance in the display face (counted up), and on the overview the sum the
  ledger keeps — total credited, less total debited, equals net movement (double-ruled, as a
  statement's total is) — beside the entry count. A perforated stub carries a barcode and the house
  mark. Money asked for and not yet moved is two dashed slips and one sentence (`InTransit`). On a
  phone the ledger is a list of lines (type, what it was for, amount, the balance after it, the
  date).
- **Membership — tier cards.** An outlined ordinal, the tier's name and price in the display face, the
  four allowances that matter most (from the same figures as the schedule), and the action; the foil
  trim marks the tier you are on. The full schedule sits under the cards (on a phone, one small stack
  per row). What no tier covers is a numbered list of clauses on paper.
- **Offers — bid slips.** The card in its case, who made the offer and whose move it is, the offer
  named and in the display face, a rule showing how it stands against the asking price, the state,
  and the actions. The maker of an offer sees only Change and Withdraw; to whom it was made, Accept,
  Counter and Reject, with Reject set a step apart from the other two (space as well as colour).
- **Trade — the same slip, two sides facing each other.** What *they* receive and what *you* receive,
  each card in its case beside its serial, and between them the way the cards travel: both ways for a
  swap, one way for a gift, toward whoever is receiving (decorative; the two labelled groups say it in
  words). Stacked on a phone, the glyph turns a quarter. Approve is gold, Reject stands apart.
- **My listings — the same slip, price first.** The card in its case and its serial; the asking price in
  the display face, named, with the date it was listed; the offers waiting on it; where the listing
  stands; Reprice (in place, from the price it has) and Delist, set a step apart and asked about before
  it happens.
- **Inbound — parcel labels.** Contents and code, the facility, and under them the four-stop journey
  (expected, received, opened, processed) with the date of each stop reached; past a perforation, the
  tracking number as a barcode.
- **Warehouse — the shelf map** (`ShelfMap`). Racks by zone; each slot is a shelf with its barcode,
  its count from the shelf report and a mark per item (twelve, then `+n`). Empty shelves are dashed,
  shelves out of service are hatched, oversized shelves are wide, and items on no shelf stand on a
  tray. The table is still on the Inventory tab.

- **Shipping and services — the departures.** Three lines on a board, the figure first in the display
  face and counted up: how many cards are ready to ship, a lookup for the shipments that have gone
  (an icon, because a lookup has no count), and the requests that are open, with those closed under
  them. What each is, and the way in.
- **Notifications — a register.** The same register as the item's history: a rule down the leading
  edge, when (left to right) and what kind, then what it says.

### Choosing cards (`ItemPick`; `components.css`)
Wherever the list is of cards to choose among (the items to ship, to offer in a trade, to hand over
in person, and the one to sell, where the control is a radio because only one can be chosen), it is the
cards: each in its case with its serial and name under it, in a grid. Choosing
one pulls it from the shelf: a foil edge and a filled mark in the corner. The checkbox is still the
control, so the keyboard and a screen reader reach exactly what they did; the photograph is decoration
and adds nothing to its name. The focus ring goes round the card. A big collection scrolls inside its
own room (640 px), so what follows the list stays within reach. Outside a label, in a list of cards
already chosen, an `ItemPick` is a row.

### Status
`.pill` / `.badge` / `.status-badge`: an LED (7 px, the semantic colour, a soft halo) and the state in
words. Departed is a hollow LED.

### The register (`.timeline`)
A rule down the leading edge, a node per entry, the newest node lit.

### Paper pieces
The **shelf plate** (serial · state · where, on paper, under the fan of cards), the **label** (the
serial drawn as a barcode label), the **colophon** (the front page's footer), the **record
section**, the **statement slip**, the **clauses**. All use `--paper`, `--paper-ink` and a foil strip.

### Overlays (`useOverlay`, `useExit`)
Drawers, confirmation dialogs and the photo lightbox share one behaviour: while it is the topmost it
is all the keyboard reaches (Tab stays inside, Escape closes it and nothing under it), the page
behind does not scroll, focus goes back to what opened it, and it plays its exit before it closes.

### Empty and loading
An empty state is a dashed empty case with a serif title. Loading is an empty slab with a shimmer.

### Components this product has always had
`.serial`, `.amount`, `.seal`, `.identity`, `.stage`, `.proportion`, `.steps`, `.confirm-sheet`,
`.ltr-run` / `.bidi`, `.offer` — as in the first edition. `.stage` is now the lit mat the item's slab
stands on in the drawer; `.offer` is a membership tier's card.

---

## 9. Two scripts

- Direction comes from `<html dir>`, written by `I18nProvider`. Layout uses only `inline-start`,
  `inline-end`, `margin-inline`, `padding-block`, `border-inline-start`. Things logical properties
  cannot express read `--dir` (1 or −1): gradient angles (`calc(90deg * var(--dir))`), transform
  origins, background positions, the chevron flip, the drawer's and the rail's offscreen offset.
  `[dir='rtl']` and `:dir(rtl)` appear only in `theme.css`, where `--dir` is set.
- `scripts/design-lint.mjs` (section 14) fails on physical properties and on `left`/`right` keywords
  in origins, positions and gradients, standing in for the slop detector the brief assumed.
- **LTR islands inside RTL** are mandatory for: serials, bin/parcel/ticket codes, tracking numbers,
  amounts, catalogue descriptions, and any free-text string coming back from the API in English. All
  of them go through `.serial`, `.code-inline`, `.amount`, `.ltr-run` or a `<bdi dir="ltr">` inside a
  block that keeps the page's direction (so the run is isolated but its label still sits at the start
  edge). What a sender wrote (a parcel's contents) sets its own direction (`unicode-bidi: plaintext`).
- **Icons that flip**: chevrons, back/forward arrows, the "view all" caret — anything expressing
  *direction of travel through the interface*. **Icons that do not flip**: the external-link arrow
  (it means "leaves this site", not "goes right"), clocks, checkmarks, the camera, the box.
- The globe control is one component in one logical position in both directions.
- Hebrew has no capitals and Geist Mono has no Hebrew glyphs: mono labels are set in the UI face,
  without tracking, under `:lang(he)`.

---

## 10. Density by surface

| Surface | Density | Notes |
| --- | --- | --- |
| Public / sign-in | `marketing` | The only place the display face runs at poster size; real cards on a shelf are the pitch. |
| Marketplace list & detail | `marketing` heading, `vault` body | Price is the first text line, set in the display face. |
| Vault, item, wallet, membership, services, support | `vault` | The gallery and the statement are the default shapes. |
| Warehouse | `warehouse` | Compact, keyboard- and scanner-first. Barcodes stay white for scanners. |
| Management | `vault` | Tables and charts with a single accent, tabular axis labels, no gradients. Restyled, not redesigned: these are tools, and density follows the job. |

---

## 11. Anti-patterns — rejected, and where they were

From the first edition (still rejected): identical rounded cards for everything; the same soft shadow
under everything; icon tiles above headings; generic illustrations; "balance cards"; decorative
animation that has no job.

From the showcase edition's own first draft (rejected after review, because they are what every
generated site looks like):

- A blurred coloured glow behind the hero or the app (an "aurora").
- A grid-line backdrop.
- Gradient headline text.
- Bento grids of identical cards with a pointer spotlight and counters.
- Glass panels.
- The same eyebrow-plus-heading-plus-grey-paragraph-plus-visual rhythm in every section. (The page
  alternates dark, paper, and sticky scroll scenes; its section marks are `§ 01`, not a decorative rule.)
- A giant ghosted wordmark as a footer. (The footer is a paper colophon with real links.)

From the first review of the finished work: a screen that is the old table with new paint (the five
screens in section 8 were each given a form of their own); a ring that is a decoration and not an
indicator; a figure on a card with no name.

---

## 12. The business rules the design must not break

These are product invariants. Any redesign that loses one of them has failed, whatever it looks
like.

- **Offers.** A party may not accept a price they proposed. `SellerPanels` branches on
  `offer.yourTurn`: when the offer is yours the Accept control **is not rendered** — only "Change"
  (a counter replacing your own price) and "Withdraw". It is not a disabled button. The server
  enforces it independently, and `tests/ux/offers-and-parcels.test.tsx` holds it in the bid slip.
- **Swaps and gifts.** Both parties must approve.
- **Wallet.** Deposits and withdrawals are *requests* with a review status, not transfers.
- **Ledger and custody history are append-only.** They render as registers and offer no affordance
  that suggests otherwise.
- **Service and membership pricing is shown before purchase.** `.offer` makes the price and the button
  one component; a Join button is never rendered without its price in the same card.
- **Custom requests are three steps**: ask (free) → operator proposes → you accept.
- **Shipping eligibility rules** are unchanged.
- **A suspended user keeps support access** and nothing else, and the rail is narrowed to match.

---

## 13. Not in this edition

- The management consoles (users, pricing, accounting, disputes, shelf yield) are restyled to the
  kit and the statement language, not redesigned.
- Two strings in `shared/i18n.tsx`, which the design did not touch, still describe the bundled
  fonts as "IBM Plex and Frank Ruhl Libre" (`legal.provenance.ofl`, Hebrew and English). The licence
  page's own text (`legalContent.ts`) and `assets/fonts/OFL.txt` list all four families.
- `docs/design/type-specimen.html` is the first edition's IBM Plex specimen, kept as a record; it no
  longer renders as it did.

---

## 14. How it is checked

| What | By | When |
| --- | --- | --- |
| Contrast of every pair the interface draws text or a boundary in, in both themes (table in section 4) | `design-lint` reads `theme.css` | `pnpm test:web` (CI) and by hand |
| The two dark blocks stay one theme | `design-lint` | same |
| Physical properties; `left`/`right` keywords in origins, positions, gradients; any `[dir]` / `:dir()` outside `theme.css` | `design-lint` | same |
| Every colour literal in the layers is a named token (pure black and white shades excepted); every radius is from the family | `design-lint` | same |
| Every padding, margin, gap and inset in the layers is on the 4 px grid (section 6) | `design-lint` | same |
| A rule that paints the paper or the room names its focus ring | `design-lint` | same |
| Every infinite animation is on the list in section 2 | `design-lint` | same |
| The reduced-motion block silences animation, transition and smooth scrolling for everything; no script says `behavior: 'smooth'` | `design-lint` | same |
| WCAG 2.x A and AA rules (axe-core), and every focus ring measured against what is behind it, on every screen | `pnpm design:screens --axe` (both themes, every persona) | before a push that changes the look |
| The lint's own rules | `tests/web/design-lint.test.ts` plants a violation of each in a copy of the source | `pnpm test:web` |
| The behaviour of the motion and overlay code | `tests/ux/motion-and-overlays.test.tsx` | `pnpm test:ux` |

---

## 15. Implementation map

| File | Holds |
| --- | --- |
| `index.css` | The first-edition stylesheet: tokens, shell, every component's structure |
| `theme.css` | The kit's variables (paste target), the mapping onto Bault's tokens (incl. `--focus-color`, `--control-border`, the radius family), `--dir`, and Bault's own: foil, paper, the room, easing |
| `fonts.css` | Generated by `scripts/fetch-fonts.mjs`: one `@font-face` per variable subset |
| `slab.css` | The slab, its sheen, its idle breathing, small-slab rules, the lightbox |
| `components.css` | Buttons, focus, fields, selects, panels, status LEDs, tables, tabs, overlays, `.money-label`, the card picker |
| `landing.css` | The public page |
| `app.css` | Grain, the shell (rail, page head, language switch, avatar), figures and statistics, the sign-in stage, details |
| `gallery.css` | The gallery, the item drawer's stage, loading and empty states, the register, filters |
| `screens.css` | The statement, tier cards, bid, trade and listing slips, parcel labels, the shelf map, the departures |
| `motion.css` | Transitions and keyframes shared by all of the above, and the reduced-motion switch |

Loaded in that order after `index.css` (`main.tsx`). Components and hooks: `shared/CardPhoto.tsx`
(slab), `shared/ui/slabTilt.ts` (pointer tilt), `shared/ui/useLandingMotion.ts` (`useMotionReady`;
scroll reveal, journey, parallax, progress), `shared/ui/useOverlay.ts` and `useExit.ts` (dialogs),
`shared/ui/motionPreference.ts` (`prefersReducedMotion`, `scrollBehavior`), `shared/ui/SplitWords.tsx`,
`shared/ui/CountUp.tsx`, `areas/customer/marketing/LandingArt.tsx`,
`areas/customer/finance/StatementSlip.tsx`, `areas/warehouse/ShelfMap.tsx`.

`scripts/make-photo-derivatives.mjs` writes `assets/images/w640/*.webp` (the slab asks for the 640 px
WebP first and falls back to the original; 7.8 MB of photographs became 1.2 MB). Re-run it when a
photograph is added. `scripts/lib/color.mjs` is the colour maths the lint uses.

**To re-theme:** paste the kit's CSS export over part 1 of `theme.css`. Colours, radius and the UI
font follow, and the lint re-measures every pair; foil, paper, the room and the slab are Bault's own
and do not.
