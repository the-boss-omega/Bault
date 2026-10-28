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

### One radius family, a hairline, shadows only for objects
The kit's radius (`--radius`, 10 px) and the sizes derived from it: `--r-xs` 6 · `--r-sm` 8 ·
`--r-md` 10 · `--r-lg` 14 · `--r-xl` 18 · `--r-2xl` 24 (the landing's one large stage), plus `--r-bar`
(3 px, the end of a bar a few pixels thick) and `--r-capsule` (the product's one pill, used on
purpose: the header's control group, the landing's buttons, the journey's chips). The slab's corners
are container-relative (`cqw`) so they scale with it. Panels have none: **a panel is a heading and a
rule, not a floating rectangle**. A corner is one of these, nothing, or a circle; the lint rejects
anything else in `index.css` and in the layers, including arithmetic on a token (`calc(var(--r-xl) +
6px)` is a size the family does not have: if one is needed it is named in `theme.css`). A 1 px
hairline is the border of every rule and box. Heavier edges exist, each for one job and none for a
box: 1.5 px for the ring of a small marker (a register's node, the selection circle on a card in a
picker); a 2 px or 3 px bar down the start edge of a register entry, an alert or a state, in the
state's colour; 2 px for a spinner's ring and for the landing's paper rules. Shadows are for objects
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
rule above the landing's headings, the register's caret, the hero card's breathing, which stops when it is
off screen). Inside the product only the waiting ones loop; the rail's mark for the page you are on glints
once as the page opens and then rests. `prefers-reduced-motion: reduce` removes all of it, including
smooth scrolling that a script asks for, and nothing is ever hidden *waiting* for an animation that
will not run.

### Two scripts, one rhythm
The same type scale in both languages. Layout mirrors through logical properties. The few things
logical properties cannot turn around (a gradient's angle, a transform origin, a background position,
a chevron, the side a drawer slides from) multiply by one token, `--dir`; the one thing a number
cannot say, the edge a block that takes the direction of its own text hangs from, is its twin,
`--text-start` (`left` or `right`). Both are declared once in `theme.css`; **no other rule may ask
which way the page reads**. The display face carries both
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
The product's UI scale is `12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64` (`--fs-*`). In
`index.css` a size is a step of it, or relative to the text it sits in (`em`), and the lint says so
when it is not. The layers are not held to it, because they draw single objects: the public page, the
page titles and lead figures use fluid display sizes (`clamp`) between 34 and 128 px (a headline is
not a control); the small caps labels are 10–13 px (10, 11, 11.5, 12.5); a few body-adjacent sizes
(13.5, 14.5, 15, 15.5 px) sit between steps; and a wordmark, an amount or a numeral the display
face draws as part of an object (the marks and wordmarks, a listing's price, a membership offer's
numeral, the charge stamp, the statement's operators) is 20, 24, 26, 30, 34, 38 or 112 px.

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
`--muted`, `--border`, `--input`, `--ring`, `--destructive`, light and dark: the Nova style on its
neutral palette, as the owner's Figma copy defines it). Two values are **not** the kit's. Both are in
the light theme, and both are darkened because the kit's measure under 4.5:1 as text on the surfaces
they are drawn on: `--muted-foreground` is `#5f5f68` (the kit's `#737373` is 4.35:1 on the dimmest
surface), and `--destructive` is `#c70010` (the kit's `#e7000b` is 4.38:1 there, and 4.07:1 on its own
wash). The dark theme is the kit's, unchanged. Part 2 maps those names onto Bault's tokens, so nothing
else has to know a theme exists. **Dark is the default**; light and system stay on the toggle. The two
dark blocks (system-dark and explicit dark) are one theme written twice; the lint fails if they drift
apart.

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

Fields are the foreground at 3.5 % over the page, with the control border. Light is the kit's light
(white page, `#171717` primary) with the two darker inks above: `#5f5f68` secondary, `#c70010` error.

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
violet). Hairlines and bands only: the top edge of a paper piece, a tab's underline, the foot of a
primary button (3 px; it marks a thing that can be pressed, so a disabled button has none). It is
still, except for the loops listed in section 2 (a button's foil slides on to its other half once when
the button is reached for, and rests).

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
| `--r-xs` / `--r-sm` / `--r-md` / `--r-lg` / `--r-xl` / `--r-2xl` | radius − 4 / − 2 / 0 / + 4 / + 8 / + 14 | Paper slips and clauses / shelf slots / controls / cards and tables / tickets, dialogs and large stages / the landing's stage |
| `--r-bar` | `3px` | A rule or a bar a few pixels thick |
| `--r-capsule` | `999px` | The three deliberate pills |
| `--border-w` | `1px` | The hairline, the border of every rule and box (heavier edges: section 2) |
| `--shadow-overlay` | popover/drawer/dialog | Overlays |
| the slab shadow | inside `.slab-case` | The one resting shadow: an object on a table |

**Focus.** A two-pixel `outline` in `--focus-color` at a two-pixel offset (`:focus-visible`), which
measures about 9:1 in both themes, and a field's border takes the same colour. The kit's own ring (a
soft halo, about 1.5:1) is a decoration, not an indicator, and is not used. An outline follows the
element's radius and does not replace its shadow, so hover cannot remove it. A search box and a select
ring the box around the field (`:focus-within`) and the field's own outline is turned off, so there is
one ring and not two; the skip link is the one thing that answers a bare `:focus`, because that is
what brings it into view. A ring is never drawn where a box that scrolls would cut it off: the room is
padding, with a negative margin to give it back (`audit` measures it, section 14). Surfaces that keep their palette in
both themes set their own ring: `--paper-ink` on paper, `--room-ink` on the room. A heading that a
jump link focuses (`tabindex="-1"`) shows none: it is not a control.

---

## 6. Space and density

4 px base: `--sp-1` 4 … `--sp-24` 96. This is Tailwind's spacing scale, which the kit uses, and it is
held in `index.css` (after its token block) and in every layer: every padding, margin, gap and inset
is a multiple of four or one of the scale's half steps (2, 6, 10, 14 px), with the 1 px hairline for
a nudge, and `design-lint` says so when one is not. A `rem` is read as sixteen pixels to the unit and
held to the same grid; a space in `em` is space in the glyph's own size, which is on no grid, and the
lint refuses it unless the line says why (`design-lint-allow`: the wallet statement's operators are
placed from their own glyph, and that is the one). Sizes (a glyph, a ring, a rail's width) are not
space, so they are not held to it; when a size has to be taken out of a space, it is a custom
property that both read, not a number written twice.

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
belongs to one piece of choreography (an arrival, a stagger, the landing's headline words) is written
beside the thing it times and not given a name it would share with nothing (the slab's pointer tilt
settles over 560 ms and follows the pointer over 90 ms; the landing's hero card, tickets and fan settle
over 450–1000 ms); a transition on a state (hover, selected) reads the tokens.

| Where | What | Job |
| --- | --- | --- |
| Slab | Tilts toward the pointer (±9°), the card shifts against it, a spot of light and a holographic spectrum slide across the case | Orient / delight |
| Hero slab | Breathes (a slow idle sway of the sheen); paused while the hero is off screen | Alive on purpose |
| Landing hero | Headline words rise out of a mask; text and buttons rise; five cards fan out from a stack; the plate rises; the fan leans toward the pointer | Argue |
| Landing, scrolling | Section words rise; the ledger writes itself; rows lean on hover; tickets tilt; a foil progress line; a header that blurs | Orient |
| Landing, journey | One card moves through four states while you read (unidentified → booked in, with a flash → shelved → decided) | Argue |
| Shell | A page's own sections rise in sequence (the page container itself does not move); cards in a gallery arrive in sequence; figures count up; the tab indicator is foil and glides to the active tab | Orient |
| Wallet | The statement's sum prints in when the overview opens; the balance counts up | Orient |
| Controls | A press puts a button down onto its edge (a pixel; the primary's foil thins); a primary button's foil, twice the button's width, slides on to its other half and thickens when it is reached for (only where a pointer can hover) | Confirm |
| Overlays | Drawers slide, dialogs and the photo lightbox rise, all *exit* (`.is-closing` for `--dur-exit`) | Confirm |
| Loading | Placeholders hold the room of what is coming (an empty case for a card, rows for a table) with a shimmer; the boot mark breathes | Orient |

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
  date). The figures are isolated left to right inside cells that read the page's way, so in Hebrew
  they hang from the same edge as their names.
- **Membership — tier cards.** An outlined ordinal, the tier's name and price in the display face, the
  four allowances that matter most (from the same figures as the schedule), and the action; the foil
  trim marks the tier you are on. The full schedule sits under the cards (on a phone, one small stack
  per row). What no tier covers is a numbered list of clauses on paper.
- **Offers — bid slips.** The card in its case, who made the offer and whose move it is, the offer
  named and in the display face, a rule showing how it stands against the asking price, the state,
  and the actions. The maker of an offer sees only Change and Withdraw; to whom it was made, Accept,
  Counter and Reject. The answer that ends the offer (Withdraw, Reject) is set a step apart from the
  others, by space as well as colour.
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
- **Warehouse — the shelf map** (`ShelfMap`). A zone's heading is an aisle sign, a strip of paper
  with its letter and what stands in it; its rack is a grid that fills the panel. Each slot is a
  shelf with its barcode, its count from the shelf report and a mark per item (twelve, then `+n`).
  Empty shelves are dashed, shelves out of service are hatched, an oversized shelf takes two places,
  and items on no shelf stand on a tray. A shelf is a button that opens what is on it (`ShelfContents`,
  read only, from `GET /custody/bins/:id/items`): in a drawer, the shelf's count as the figure of a tag
  (with its zone, its kind and whether it is in use) and under it each item by its number, its name
  and where it stands. The product declares no capacity for a shelf, so there is still no fill bar:
  the pips are a count, not a measure of room. The table is still on the Inventory tab.
- **Shipping and services — the departures.** Three lines on a board, the figure first in the display
  face and counted up: how many cards are ready to ship, a lookup for the shipments that have gone
  (an icon, because a lookup has no count), and the requests that are open, with those closed under
  them. What each is, and the way in. A figure that has not arrived is a dash, never a zero.
- **Inbound, the processing floor.** The two places a parcel waits (to be opened, to be catalogued),
  along the same line a label's journey is drawn on; a place with parcels in it is lit, and the line
  runs on past the last. Each place says how many, in the display face, and what it means; under them
  is how long the oldest has waited and since when. A figure that has not arrived is a dash.
- **Notifications — a register in days.** The same register as the item's history, under a heading
  per day on a dashed rule ("today · Tuesday, October 27", from the browser's own tables, so in the
  page's language and with no message of ours). An entry is stamped with its time; one about a card
  shows the card in its case with its serial in mono, the rest carry the kind of thing they are in a
  tile the width of the case; what it says is a sentence the API wrote in English, its own island, so
  its full stop stays at its end. The bell's menu is the same register in small: a heading per day,
  the mark, the kind, two lines of what it says and the time. A day's list is named by its heading and
  is not a landmark.
- **Drawers about a sum — the tag** (`DrawerTag`). An escrow deal, a wallet request and a ledger entry
  open on a tag of paper, as the statement is paper: the amount named, in the display face and read
  left to right, and under it, on a dashed rule, where it stands (the state's light and word, in ink)
  and what goes with it (the fee, the currency). With lines (a name and its value to a line, a leader
  of dots between) and no amount, the same tag is a slip that says where something goes. The history under it is a register, in the product's
  own words for each step; a step the product does not know is shown as recorded.
- **Forms with a slip — cash in, cash out, the shipment.** What was a narrow column of fields on an
  empty band is the fields and, beside them, the request as it will be read, on the same paper,
  written while it is typed: the tag with lines. A request for cash out is its amount (named, in the
  display face), the destination, the beneficiary and the reference (a dash for what is not typed
  yet) and, once the server has quoted it, what the fee takes and what reaches the person. A route
  that is paid by transfer is the payment slip it is: where to send it, one line to a fact. The
  shipment is the parcel as it will be sent: the price of the service the warehouse would pick, where
  it goes, how many cards, and what was asked for (express, a box, cover, the signature that cover
  makes necessary), each only once it has been. Beside the fields on a wide window (sticky, while the
  panels scroll), between the last field and the button that sends it on a phone. Every label and
  sentence on a slip is one the form already had.
- **The sign-in log — a statement and a register.** Three counts on one sheet (the same paper, three
  columns of a width), then the attempts in days, a heading for each on a dashed rule and a list named
  by it: the time, the outcome as a light and a word, the account, where from and on what. A line to an
  attempt on a wide window, because a log is read down; two on a phone.
- **Accounting — the month as a statement.** The summary is one sheet of that paper: the revenue as a
  figure with the lines it is made of under it (a name, a leader of dots, an amount), what customers
  put in and what is held for them stacked beside it, each with the sentence that says what the figure
  leaves out, and the shipping and platform-account sentence as the sheet's foot. How many sit side by
  side is the sheet's own width, not the window's. The ledger by type is the table under it.
- **Forms with a slip — the ones that make a request or a record.** Selling an item (the card in its case, its
  serial, the price asked, that it will be active), proposing a trade (the two sides stacked, the glyph
  turned a quarter, a gift as one way), registering a parcel (what is in it, where it goes, and its
  number as a real Code 128 barcode once there is one), a new support ticket (its subject in the display
  face, how its message begins, its kind and where it will stand), the name on the account (the account
  as a card: the name as it is typed, the email, the permanent username, the role), an address being
  added or edited (a label as it is written on a parcel), a pricing rule (what it is called, what it
  charges, for what) and a dispute being opened (the transaction, its sum and kind, the note). One layout
  (`.request-form`: the fields, the slip, the button): beside the fields from 1100 px, the slip sticky and
  the button under the fields, not at the foot of a slip taller than they are; below that, the slip
  between the last field and the button. Where the form has less than a page (half of one, a column of
  600 px) it is stacked (`.request-form--stacked`), its fields no wider than the password form's. What has
  not been written is asked for in the quieter ink, as the name of the field, and a sum not yet typed is a
  dash, never a zero or any other value made up (a listing for no price is not "$0.00 · Active"); a label
  written for a list (`Email:`) loses its colon on a tag, which has a leader. The forms that have no slip
  are the ones in the warehouse's benches, and a few that are still the kit's fields in a column:
  the Bault store's listing, raising an escrow deal and a shared parcel's group. Whatever a person
  types as free text (a name, a subject, a message, an address) takes the direction of what is typed
  (`dir="auto"`), so an English sentence in a Hebrew page keeps its full stop where it belongs.
- **What can be asked for on a card — a menu and a slip.** The item's drawer lists what the warehouse can
  do for it as a menu of rows (`btn--row`): photography, grading, a video, an inspection, consignment, a
  buy-out, something else, and the donation in red, each with its price at its end. A request that has a
  form (grading, an inspection, consignment, something else) takes the menu's place in the drawer, and the
  keyboard goes to its heading; closing it gives back the menu and the keyboard to the row it came from.
  The form is a slip over its fields, the width of the drawer's column: grading is the tier's fee (a
  dash where it has no price yet, with that said), the tier, how long it takes, what it covers and what
  was declared, and under a dashed rule what it means (the card cannot be sold, swapped or shipped while
  it is away); consignment is the asking price (a dash until it is typed), where it goes, the show where
  the channel wants one, when it pays, the minimum, that only graded cards are taken, and what asking
  costs; an inspection is what it costs and, for each area asked for, a finding; something else is what
  is wanted as the slip's title (in the quieter ink until it is written), how it is put and that asking is
  free. The areas of an inspection are tiles (`choice-tiles`), the checkbox still the control: a chosen
  one has the edge of a button that is down, and the ring goes round the tile.
- **The doors — a slip with a stub.** Signing in and up, asking for a new password and setting it, the
  second factor's code, the link that was sent to confirm an address: each is a slip of paper in both
  themes (`AuthCard`). Foil runs along its top edge; over the heading is a kicker that says what the slip
  is (*Members’ entrance*, *New account*, *Getting back in*, *New password*, *Second factor*, *Address
  confirmation*); then the fields and the one button, which is the ink with foil at its foot in either
  theme. Under a perforation (a dashed rule with a notch cut out at each end of it) is the stub, where
  what else one may do is: sign up instead, ask for a new password, go back to signing in. It comes after
  the button in the tab order too. The fields, their labels and notes, a mistake (in the paper's
  oxblood, the field it is about in a line of the same red) and a confirmation (in the paper's green) are
  the paper's own; the code that is typed from a phone is set large, in the code's face, spaced as
  digits are read. A page that has said what it came for (the link was sent) is the same slip with its
  sentence on it, named by its heading. A person who signs in on a phone is held to the same targets
  as everywhere: the button 44 px, the text buttons on the stub 24.
- **Support — a register in days, a ticket's stub.** The tickets are the notifications' register: a
  heading per day, an entry for each with its time, whose turn it is, its subject (the control that
  opens it), its number and its kind.
- **Addresses — a label each.** A saved address is a label on paper (whose it is, where it goes, its
  default and what carriers lack marked); Edit and Delete are under it, on the page. The tags run in
  rows (`.tag-grid`, the same for the disputes); one being edited takes the row, so its fields have the
  room of a form. A tag that is one of a list is an article, named by its kicker, not a landmark (`item`
  on `DrawerTag`): forty disputes are not forty regions of the page. A tag on its own is a region.
- **Security — cards and a sheet.** The password and the second factor are a half of the page each. The
  second factor says where it stands on a card (on, what it asks for, what is left of the way back in);
  the key to scan is a card, the QR in its own white label (printed black on white, whichever way the
  page is) and the key to type; the recovery codes are a sheet of paper that is a heading of its own,
  the codes ink on it. The acknowledgement and *Done* are under the sheet, not on it.
- **Pricing — a rate card.** The rules are one printed card: a group to each action, in the order of the
  price list (an action the product has no word for is its code, not a phrase made up from it), a line
  to each rule (what it is, what it is for, when it began, said in the order the page reads) and its
  charge in the display face, in as many columns as the card has room for. For an action and a class the
  newest rule that has begun and not ended is the one in force, as the server chooses; the rules it
  replaced stay under it, quiet, their figures struck through, and one that has not begun is quiet and
  not struck. A rule is added, and takes effect; it is not changed, so the card has no controls.
- **Disputes — case files.** Each is a file on paper whose headline is the ruling, and says so in its
  kicker (a case with none has a dash, cut at three lines however much was written), then its number
  and the transaction it is about with its kind and price, the note that was made, and where it
  stands. What moves it on is under the file, in the page's own controls.
- **Parked messages — a register in days.** An entry for each: when, what it was, why it failed (in its
  own ink, left to right), what it carried, how many times and when last, and *Requeue* at the end of
  the line. What needs attention is marked at its node in the amber.
- **Storage fees — a statement.** The sweep's runs on paper, a line to each: its date, what it charged
  in all (named: a figure on paper does not travel without its name), and under that the threshold and
  how many items.
- **Accounts and items — rolls, opened in a drawer.** Nothing in a line is a field. An account is
  its initials, its name, its username and email, what it may do and where it stands; an item is its
  name, its number, whose it is and where it stands (a hold in red). The name is the control (and the
  line says so to a pointer), and the link that names a record opens it. The drawer is the record as a
  card that is written as it is changed (the name as typed, the role, the status, the owner; for an item
  its card in its case and its barcode as a printed label), then the sweep's suspension and what is
  offered about it, and the fields. *Save* sends only what was changed; what was saved is in the roll
  at once. What a save or a reset came to (done, or why it was refused) is said in the drawer, above
  its buttons, where a phone shows it and a screen reader reads it out (the page's own line is behind
  the drawer's backdrop); the page keeps its line as well. Resetting somebody else's second factor is
  in the drawer of another enrolled account, and asked about first; when it is done, focus is in the
  drawer, not on the page behind. A name an account is flagged for is confirmed by sending it as it is,
  which is not an edit to be guarded: the backdrop still shuts the drawer.

### Buttons (`Button`, `ButtonLink`, `IconButton`; `buttons.css`)
One family, in one file. A button is a piece of the paper put to work, and it stands on its lower edge the
way a key does: a quiet button on a line a pixel heavier at the foot, the primary one on a strip of foil.
The foil marks a thing that can be pressed, so a disabled button has none: it is a dashed outline, a blank
key, which is not a field either. A button that is working keeps its face (it has not stopped being the
button) and takes a spinner in the place of its glyph.

| Variant | For | Drawn |
| --- | --- | --- |
| `primary` | the one thing to do next: a screen, a drawer or a form has one | the paper's own ink on the page (the ink in the light theme, the paper itself in the dark), with 3 px of foil at its foot |
| `secondary` (the default) | another thing one may do | a line (`--control-border`, 3:1) and nothing else |
| `ghost` | the way out (Cancel, Close) and what is only sometimes wanted | words; a line only when it is reached for |
| `danger` | what cannot be taken back | the destructive red on its wash; filled when it is reached for |
| `link` | an action inside a sentence | set as the words around it, underlined |

The hierarchy is the screen's, not the button's. One primary to a view; Cancel and Close are ghost; what
destroys is `danger` and stands apart from what saves; an action that is a switch (a filter that is on) is
a secondary with `pressed`, and its state is its foot, a heavy line, not its label; "clear the filters" in an
empty state is a secondary, and in a toolbar it is ghost. A button that is only a glyph is an `IconButton`,
named by its `label` (a screen reader's name and the tooltip); the header's three are one capsule, which is
their outline. A link that goes somewhere (a download, a file) is a `ButtonLink`: an `<a>` that is drawn as
one, so that it is announced as the link it is.

**Size.** A control is `--control-h`: 40 px under a pointer and 44 px where the pointer is a finger
(`pointer: coarse`), for a field and a button alike, so a button beside a field lines up with it. A small
button (`size="sm"`) is 32 px under a pointer and 44 under a finger: it is small in what it says, not in
what it asks of a thumb. Hover is for a pointer that can hover (`hover: hover`), so a tap does not leave a
button lit.

**A row** (`className="btn--row"`) is a button that is one of a menu: its icon, what it is called (semibold)
and what it will do (the quieter ink) beneath it, and at the far end its price and, where it opens a form,
the way on (a chevron that turns with the page and moves a step on the way when reached for). The whole
row is the target, its words start where the page starts (a button's are centred), and it is named by
what it is called and described by what it does (`aria-labelledby`, `aria-describedby`), so a screen
reader does not read a sentence as the name of a button. It has every state of the family: danger
(what cannot be undone: the donation) is red through its text, and a row that is not there to press (a
request already open on the card) is dashed and says where that request stands in place of its price.

**Where it stands.** Colour is the `--btn-*` tokens of `theme.css`, written with `light-dark()` so one line
serves both themes (the lint resolves it and measures every pair). The paper and the room are not the page's
and say which they want (`.on-paper`, `.on-room`, and the surfaces `buttons.css` lists): on paper the
primary is the print (`--paper-ink`) and a line is `--paper-edge`; on the room the primary is the paper. A
new surface that is paper adds its class to that list or wears `.on-paper`; the audit measures a button where
it is drawn and finds the one that is not.

**Forced colours.** The system draws the colours, so the difference is in the lines: the primary has a heavy
foot (4 px), a danger button a dashed line, a ghost a dotted one, and a switch that is on a highlight.

### The emails (`renderEmail`, in `packages/adapters`)
The account emails (the address to confirm, the password to reset) and the update on a vault are one
slip of paper on the room's grey: foil along the top edge, the wordmark, and for each language a kicker,
a heading in the serif, the sentence, one ink button with a strip of foil at its foot, the link a button
hides on a line of its own (left to right in either language) and the fine print. The two languages are
one slip with a tear line between them, the Hebrew first and read right to left; a Hebrew kicker is not
spaced out as capitals are. It is made for a mail client and not a browser: every style inline, every
layout a table, the foil a row of five coloured cells (a gradient is not promised), the button a cell
with a colour of its own (a client that drops styles still draws it), the reader's own fonts (no web
font is loaded or named) and a preheader for the inbox. The hues are `--foil-*` and the paper inks of
`theme.css`, written as the hex a mail client reads. The audit inspects each as a document in every
engine; the contract test says the rest.

### Choosing cards (`ItemPick`; `components.css`)
Wherever the list is of cards to choose among (the items to ship, to offer in a trade, to hand over
in person, and the one to sell or to give away, where the control is a radio because only one can be
chosen), it is the cards: each in its case with its serial and name under it, in a grid. Choosing
one pulls it from the shelf: a foil edge and a filled mark in the corner. The checkbox (or radio) is
still the control, so the keyboard and a screen reader reach exactly what they did; the photograph is
decoration and adds nothing to its name. The set is a `fieldset` with a name (drawn for the one to
sell, read aloud for the rest), so a screen reader says what it has entered and, for a radio, "1 of
n". The focus ring goes round the card. On a wide screen a big collection scrolls inside its own room
(640 px), so what follows the list stays within reach; on a phone the page is what scrolls, because a
scroller inside a scroller takes the thumb. Outside a label, in a list of cards already chosen, an
`ItemPick` is a row.

### Numeric columns
A column of figures hangs from one edge, header and figures alike. The figures are left to right
(`td.num`), so their decimals line up at the right-hand edge in either language, and the header
(`th.td-end`, `th.num`) is set the same way; read in the page's direction, in Hebrew it hangs from the
other edge and the word sits a column away from the numbers it names.

### Status
`.pill` / `.badge` / `.status-badge`: an LED (7 px, the semantic colour, a soft halo) and the state in
words. Departed is a hollow LED.

### The register (`.timeline`)
A rule down the leading edge, a node per entry, the newest node lit. The time of an entry has no
letters to say which way it reads, so it hangs from the edge the page starts at (`--text-start`).

### Paper pieces
The **shelf plate** (serial · state · where, on paper, under the fan of cards), the **label** (the
serial drawn as a barcode label), the **colophon** (the front page's footer), the **record
section**, the **statement slip**, the **clauses**, the **drawer tag** (which is also the slip of a
form, an address label, a case file, a key card and a recovery sheet), the **month's statement**, the
**rate card** and the **fee statement**. All use `--paper`, `--paper-ink` and a foil strip, and what is
drawn on them is drawn in the paper's inks (`--paper-ink`, `-2`, `-3`) or in the colour it is on, never
a colour of the theme's, which is light on cream in the dark theme. The lint says so of the classes it
is told are on paper (the drawer tag, the slip, the statement, the rate card, the fee statement, a case
note, an address, a ticket's note, a parcel's stub, the recovery codes, the key), for a text colour, a
colour of a border, an outline or a decoration, a fill or a stroke, and a colour mixed from a theme's
ink; what stands beside the paper on the page (the controls under a case file) is not held to it.

### Overlays (`useOverlay`, `useExit`)
Drawers, confirmation dialogs and the photo lightbox share one behaviour: while it is the topmost it
is all the keyboard reaches (Tab stays inside, Escape closes it and nothing under it), the page
behind does not scroll, focus goes back to what opened it (or, if that is gone because the answer
removed it, to the dialog it was opened over, so the keyboard is not left on the page behind), a field
that takes focus is shown whole with room for its ring (the browser reveals only a text field's
caret), and it plays its exit before it closes.
They are drawn into `<body>`, so a transform or a clip on an ancestor can neither trap a fixed overlay
nor cut it off, and an open one covers the window (`tests/ux/layout-in-a-browser.test.tsx` measures
it). The photograph opens in the room: the dark a card is photographed against, the card large in its
case with a plate that names it. On a phone the rail is one too: it takes focus when it opens, on the
page you are on, Escape closes it, and while it is closed it is out of the keyboard's way.

A strip of tabs that scrolls brings the selected tab into view and moves focus with the arrow keys; it
keeps room for the ring of the tab at either end.

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
  `--text-start` (`left` or `right`) is its twin for one case: a block that takes the direction of its
  own text (`unicode-bidi: plaintext`, a name in whatever language it was typed in) keeps that text's
  characters in order, and `text-align: start` would then hang it from *that text's* edge, which on a
  Hebrew page puts an English name at the wrong side of the column; `text-align: var(--text-start)`
  hangs it from the page's. `[dir='rtl']` and `:dir(rtl)` appear only in `theme.css`, where both are set.
- `scripts/design-lint.mjs` (section 14) fails on physical properties, on four-value shorthands that
  name a right and a left, on corners that are not mirrored, on `float` and `clear`, and on `left` /
  `right` keywords, angles and horizontal moves that point the same way in both languages, standing in
  for the slop detector the brief assumed.
- **LTR islands inside RTL** are mandatory for: serials, bin/parcel/ticket codes, tracking numbers,
  amounts, catalogue descriptions, and any free-text string coming back from the API in English. All
  of them go through `.serial`, `.code-inline`, `.amount`, `.ltr-run` or a `<bdi dir="ltr">` inside a
  block that keeps the page's direction (so the run is isolated but its label still sits at the start
  edge). What a sender wrote (a parcel's contents) sets its own direction (`unicode-bidi: plaintext`).
- **A date is not an island.** A locale-formatted date reads in the page's direction (`.date`, which
  is `unicode-bidi: plaintext`), so its day, month and year keep the order the language gives them; a
  `dir="ltr"` around one reads `27 2026 באוק׳`. A figure inside a phrase (`$39.00` before "a month")
  is isolated where it stands (`isolateLtr()` in `money.ts`), so the phrase keeps its own order. A
  cell that holds only a pill, a date or a code is set `unicode-bidi: normal`, or it would fall back
  to left to right and hang from the wrong edge. A select shows the chosen option the way that option
  reads (`option { unicode-bidi: plaintext }`), so an English address on a Hebrew page starts at its
  beginning instead of being cut off at it.
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

- Some of the management consoles are restyled to the kit and the statement language, not redesigned:
  the wallet requests, the Bault store and the shelf yield chart, and the pricing coverage check, which
  is a table because it is a check. The rest are made of the system's pieces: the accounting summary (a
  statement on paper), the sign-in log (a statement and a register), the shelf map (aisle signs over
  racks), pricing (a rate card), the disputes (case files), the parked messages (a register), the
  storage fees (a statement) and the accounts and items (rolls opened in a drawer).
- Of the forms, those that make a request or a record have their slip (section 8), and the doors are
  slips with a stub. The ones that do not are the kit's fields in a column: changing the password, the
  warehouse's benches, the Bault store's listing, raising an escrow deal and a shared parcel's group.
- `docs/design/type-specimen.html` is the first edition's IBM Plex specimen, kept as a record; it no
  longer renders as it did.

---

## 14. How it is checked

| What | By | When |
| --- | --- | --- |
| Contrast of every pair the interface draws text or a boundary in, in both themes (table in section 4) | `design-lint` reads `theme.css` | `pnpm test:web` (CI) and by hand |
| The two dark blocks stay one theme; the buttons' colour pairs (the primary's label on it, its edge against the page, danger's red on its wash, the paper's and the room's primaries) | `design-lint` | same |
| Physical properties (including `float`, `clear`, four-value shorthands that name a side, corners that are not mirrored); `left`/`right` keywords, angles and horizontal moves that point one way in both languages; any `[dir]` / `:dir()` outside `theme.css`; a block that takes its own text's direction and is aligned to `start` | `design-lint` | same |
| Every colour literal in the layers is a named token (pure black and white shades excepted); every radius is from the family, with no arithmetic on a token | `design-lint` | same |
| Every padding, margin, gap and inset in `index.css` (after its token block) and in the layers is on the 4 px grid, with no `em` that is not declared (section 6); a font size in `index.css` is a step of the scale or relative (section 3) | `design-lint` | same |
| In a component: no physical utility class or inline style, no timer that never stops, and no date (made by `toLocale…`, `Intl.DateTimeFormat` or the app's own formatter) forced left to right (section 9) | `design-lint` | same |
| A rule that paints the paper or the room names its focus ring; a rule for what is drawn on paper uses a paper ink, not a colour of the theme's | `design-lint` | same |
| Every infinite animation, spelled however, is on the list in section 2 | `design-lint` | same |
| The reduced-motion block silences animation, transition and smooth scrolling for everything; no script says `behavior: 'smooth'` | `design-lint` | same |
| WCAG 2.x A and AA rules (axe-core), every focus ring measured against what is behind it **and whether a box that scrolls cuts it off** (the first 40 keyboard stops of each screen, in both languages at both widths; `--focus-stops` changes the number), anything cut off at the edge of a phone that is not in something that scrolls sideways, and on a Hebrew page any phrase, price or sentence that is drawn the wrong way round (measured from where the characters ended up, not from the markup), on every screen, with the drawers, menus and photograph a visitor opens opened first (and, for the manager, an account and an item in the drawers they are changed in); the transactional emails are inspected as documents. `--forced` also captures with forced colours on (axe is run without its contrast rule, which reads the colours the stylesheet asked for, not the ones the person's palette draws) and checks that the current page, the selected tab and the selected row are still drawn; `--motion` captures with motion on (otherwise every page is captured with reduced motion, so nothing is mid-fade, and the overlays are opened with motion either way) | `pnpm design:screens --axe` (both themes, every persona) | before a push that changes the look |
| The buttons as they are drawn: each label against its own face, each edge (the face where it is filled, the line where it is outlined) against what it stands on, each target (24 px always, 44 px where the pointer is a finger), on the page, the paper and the room | `auditButtons` in `scripts/lib/audit-checks.mjs`, run on every screen by `pnpm design:screens`, and on one of every kind, in both themes and both languages, by `tests/ux/buttons-in-a-browser.test.tsx` | `pnpm design:screens`, `pnpm test:ux` |
| The menu of what can be asked for on a card and the slips of its forms: a row is named for what it is and described by what it does, a form takes the menu's place and the keyboard goes with it and comes back, each slip writes what is typed (and a dash for what is not), the tiles of an inspection, a slip the width of its fields, a row's words starting where the page starts and its chevron turning, a finger-high row read and edged in both themes and both languages | `tests/ux/service-forms.test.tsx` | `pnpm test:ux` |
| What jsdom cannot see: an overlay covers the window and is clickable, a closed sheet is out of the keyboard's way, a ring is not cut off at either end of a strip of tabs or of a table that scrolls, or at the foot of a drawer that scrolls (every control in an account's and an item's drawer, run through the same function the page runs when a field takes focus); the month's statement, every form with its slip (beside the fields on a wide window with the button under them, between the fields and the button on a phone, in both languages; a pricing rule and a dispute among them; an address being edited at the width where its fields were squeezed), the security tab (its fields no wider than the password's), the shipment and the sign-in log are where they should be at their widths; a register's time hangs from the edge the page starts at, in Hebrew too; a case file is cut at three lines; the first frame, before the application starts, is in the visitor's theme, language and direction; the audit's own detectors, shown a mistake planted in a page and a page without | `tests/ux/layout-in-a-browser.test.tsx`, `tests/web/first-frame.test.ts`, `tests/web/design-screens-detectors.test.ts` (each needs a browser, and the first-frame one the production build; they skip without) | `pnpm test:web`, `pnpm test:ux` |
| The lint's own rules | `tests/web/design-lint.test.ts` plants a violation of each rule in a copy of the source (in `index.css`, in a layer, in a component, in `theme.css`), and checks that what is allowed is let through | `pnpm test:web` |
| The behaviour of the motion and overlay code | `tests/ux/motion-and-overlays.test.tsx` | `pnpm test:ux` |

---

## 15. Implementation map

| File | Holds |
| --- | --- |
| `index.css` | The first-edition stylesheet: tokens, shell, every component's structure |
| `theme.css` | The kit's variables (paste target), the mapping onto Bault's tokens (incl. `--focus-color`, `--control-border`, the radius family), `--dir` and `--text-start`, and Bault's own: foil, paper, the room, easing |
| `fonts.css` | Generated by `scripts/fetch-fonts.mjs`: one `@font-face` per variable subset |
| `slab.css` | The slab, its sheen, its idle breathing, small-slab rules, the lightbox |
| `components.css` | Focus, fields, selects, panels, status LEDs, tables, tabs, overlays, `.money-label`, the card picker |
| `buttons.css` | Every button: `.btn` and its variants, the row of a menu, `.icon-btn`, the header's capsule of them, the spinner, the paper's and the room's own, what forced colours draw |
| `landing.css` | The public page |
| `app.css` | Grain, the shell (rail, page head, language switch, avatar), figures and statistics, the sign-in stage, details |
| `gallery.css` | The gallery, the item drawer's stage, loading and empty states, the register, filters |
| `screens.css` | The statement, tier cards, bid, trade and listing slips, parcel labels, the shelf map, the departures, the notifications register, the drawer tag and the form that has one, address labels, the key card and the recovery sheet, case files, the rate card, the fee statement, the month's statement, the rolls, the doors, the service menu and the tiles of a choice |
| `motion.css` | Transitions and keyframes shared by all of the above, the reduced-motion switch, and what forced colours draw in place of the foil |

Loaded in that order after `index.css` (`main.tsx`). Components and hooks: `shared/CardPhoto.tsx`
(slab), `shared/ui/slabTilt.ts` (pointer tilt), `shared/ui/useLandingMotion.ts` (`useMotionReady`;
scroll reveal, journey, parallax, progress), `shared/ui/useOverlay.ts` and `useExit.ts` (dialogs),
`shared/ui/motionPreference.ts` (`prefersReducedMotion`, `scrollBehavior`), `shared/ui/SplitWords.tsx`,
`shared/ui/CountUp.tsx`, `shared/ui/useScrollableRegions.ts` (a table wider than its room scrolls
sideways, and while it does it is in the tab order, with a name, so a keyboard can reach its far
columns), `shared/ui/Serial.tsx` (`ItemPick`), `areas/customer/marketing/LandingArt.tsx`,
`areas/customer/finance/StatementSlip.tsx`, `areas/warehouse/ShelfMap.tsx`, `shared/ui/DrawerTag.tsx`,
`shared/ui/NotificationMark.tsx`. The audit's checks are in `scripts/lib/audit-checks.mjs`, apart from the
script that walks the app (`scripts/design-screens.mjs`), so that the tests can show them a planted mistake.

`scripts/make-photo-derivatives.mjs` writes `assets/images/w640/*.webp` (the slab asks for the 640 px
WebP first and falls back to the original; 7.8 MB of photographs became 1.2 MB). Re-run it when a
photograph is added. `scripts/lib/color.mjs` is the colour maths the lint uses.

**To re-theme:** take the kit's CSS export and put its `:root` block over part 1's `:root`, and its
`.dark` block over **both** dark blocks (the export's selector is `.dark`; Bault's are the system's
`prefers-color-scheme` block and `[data-theme='dark']`, which are one theme written twice). It is a
paste of values, not of selectors. Colours, radius and the UI font follow, and the lint re-measures
every pair in both themes and names the ones that fail: expect it to want the light `--muted-foreground`
and `--destructive` darkened again (section 4). Foil, paper, the room and the slab are Bault's own and
do not follow.
