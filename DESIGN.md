# Bault — Custody Grade, showcase edition

The design system for a platform that holds other people's property and is the only record of who
owns it, where it is, and what it costs.

This document is the spec. `apps/web/src/*.css` is the implementation, and every token named here
exists there under the same name. Where the two disagree, the CSS is right and this file is a bug.

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
   something *is* the record (a label, the ledger, the colophon) it is paper: cream, ink-black type,
   a foil strip under it. Paper is never decoration; it marks the places where the truth is written.
3. **Foil is what is alive.** One iridescent spectrum, borrowed from the sheen of a holographic card,
   is the only accent that moves: the active tab, the active destination, the title rule of a panel,
   the light under a primary button, the sweep across a slab. It never fills a surface and it never
   means a status.

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
  state in words beside it. Colour is never the only signal.

### Money names itself first
Amount before verb, everywhere: `$12.40 · Storage, Aug`. Tabular lining numerals. Every amount is
wrapped in `.amount` (`direction: ltr; unicode-bidi: isolate`). **No charge appears anywhere without
its amount adjacent.** Lead figures (a balance, a statistic, a price on the rate card) are set in the
display face, large, because money is the one thing a collector reads twice.

### Append-only looks append-only
Custody events, ledger lines, wallet-request history and support messages render as **a register**:
a dated vertical rule with a node per entry, the newest lit. No hover-to-edit, no pencil icons, no
bubbles. On the front page the same idea is shown literally: a ledger that writes itself a line at a
time, whose fourth line is a *correction* appended under the others while nothing above it moves.

### Photography is the colour
The UI is monochrome. Accents are semantic, and there are five of them. The one place the UI itself
is allowed to be colourful is the foil, and only as a hairline.

### One radius family, one border weight, shadows only for objects
The kit's radius (`--radius`, 10 px) with `--r-lg` for panels and sheets; a 1 px hairline; and shadows
only where something is physically in the room: a slab, a popover, a drawer, a dialog. **A panel is a
heading and a rule, not a floating rectangle**, and there are no cards inside cards.

### Density follows the job
Marketing generous, vault comfortable, warehouse compact — the same component adapting, not three
components. Four variables change; everything measured in them follows.

### Motion shows a change of state or makes an argument
It is allowed to be generous on the public page and exact in the product. Every animation does one
of three jobs: **confirm** (a press, a focus, a drawer closing), **orient** (a page arriving, a tab
indicator travelling, a card entering a shelf) or **argue** (the front page's journey, in which one
card changes state while you read). Nothing loops except two things that are alive on purpose: the
foil, and a hero card that breathes. `prefers-reduced-motion: reduce` removes all of it, and nothing
is ever hidden *waiting* for an animation that will not run.

### Two scripts, one rhythm
The same type scale in both languages. Layout mirrors through logical properties — there is no
`[dir='rtl']` layout branch, only `inline-start` and `inline-end`. The display face carries both
scripts. **Any screen that looks worse in one language is not done.**

---

## 3. Type

| Face | Weights | Job |
| --- | --- | --- |
| **Frank Ruhl Libre** | 500 / 700 | Display, **both scripts**: page titles, section headings, lead figures, the wordmark |
| **Geist** | 400 / 500 / 600 | Latin UI, body copy |
| **IBM Plex Sans Hebrew** | 400 / 500 / 600 | Hebrew UI and body (hebrew subset only) |
| **Geist Mono** | 400 / 500 / 600 | Codes: serials, bins, parcels, tickets, barcodes. Also the labels on a physical plate (shelf plate, paper label) and the `§` marks |

Self-hosted from `assets/fonts`, subset to `latin` / `latin-ext` / `hebrew`, `font-display: swap`.
Regenerate with `node scripts/fetch-fonts.mjs`. The Latin UI face, the Hebrew UI face and the display
face (both scripts) are preloaded in `index.html`; the rest arrive through `unicode-range`.

**Why a serif.** The kit's grotesque is the right voice for controls and the wrong voice for a house
that keeps people's property: a catalogue, a ledger and a deed are all set in a serif. Frank Ruhl
Libre ships a Latin companion drawn for its Hebrew, so a Hebrew headline and an English one share a
skeleton, a stroke contrast and a vertical rhythm by construction.

**Codes are mono; figures are not.** Mono does real work on a serial (fixed advance, slashed zero,
unambiguous `1/l/I`). Money, dates and counts are set in the UI face, or in the display face when they
are the point of the screen.

### Scale
`12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64` — ten steps for the product. The public page and
the page titles use fluid display sizes (`clamp`) between 34 and 112 px, because a headline is not a
control.

Line height: `--lh-tight` 1.15 (display), `--lh-snug` 1.35, `--lh-normal` 1.5. Display headings set at
1.0–1.1; Hebrew display gets an extra 0.05. **Tracking is Latin-only**: Hebrew display tracking is 0
(`:lang(he)`).

Weights: 400 / 500 / 600; `--fw-bold` is 600; `font-synthesis: none`.

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
default**; light and system stay on the toggle.

### Ground and ink (dark)
| Token | Value | Job |
| --- | --- | --- |
| `--surface-page` | `#0a0a0a` (`--background`) | The room |
| `--surface-raised` | `#141414` (`--card`) | Inputs, overlays, the colophon's neighbours |
| `--surface-sunken` | `#1c1c1c` (`--muted`) | Table headers, hover grounds |
| `--line` | white 10 % (`--border`) | The hairline |
| `--line-strong` | white 15 % (`--input`) | A rule that separates sections |
| `--ink` | `#fafafa` | Headings, values |
| `--ink-2` | `#a3a3a3` | Secondary — 8.3:1 on the page |

Light is the kit's light: white page, `#171717` primary, `#5f5f68` secondary ink (6.4:1).

### Accents — five, one job each, unchanged
`--custody` (in Bault's care: verified, stored) · `--brass` (money) · `--frost` (frozen) · `--amber`
(warning) · `--oxblood` (destructive; follows `--destructive`). Each has an ink value that clears AA as
text, a mark value, and a wash. The theme's `--primary` is *not* an accent: it is the primary button.

### Foil
`--foil` — a 115° ramp of five light hues (`--foil-a` … `--foil-e`, rose → amber → mint → sky →
violet). Hairlines and strips only; always still or sliding slowly (a 6–7 s loop).

### Paper
`--paper` `#f3efe6`, `--paper-ink` `#15130f`, `--paper-line` `#d6d0c2`. The slab label, the shelf plate,
the colophon, the record section of the front page. Paper is the same in both themes.

---

## 5. Shape, elevation, focus

| Token | Value | Rule |
| --- | --- | --- |
| `--radius` | `0.625rem` (the kit's) | Controls |
| `--r-lg` | `--radius + 4px` | Panels, sheets, dialogs |
| `--r-pill` | `--radius` | There are no pills; a status is a light and a word |
| `--border-w` | `1px` | The only border weight |
| `--shadow-overlay` | popover/drawer/dialog | Overlays |
| the slab shadow | inside `.slab-case` | The one resting shadow: an object on a table |

**Focus.** A three-pixel ring in `--ring` at 55 % (`box-shadow`, as the kit draws it); the field's
border takes `--ring`. `:focus-visible`, never `:focus`.

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

Tokens: `--dur-fast` 150 · `--dur` 200 · `--dur-slow` 250 · `--dur-enter` 300 · `--dur-exit` 180 ms;
`--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)` for arrivals, `--ease-in-out-quart` for departures and
drawing, `--ease-spring` for the one overshoot.

| Where | What | Job |
| --- | --- | --- |
| Slab | Tilts toward the pointer (±9°), the card shifts against it, a spot of light and a holographic spectrum slide across the case | Orient / delight |
| Hero slab | Breathes (a slow idle sway of the sheen) | Alive on purpose |
| Landing hero | Headline words rise out of a mask; text and buttons rise; five cards fan out from a stack; the plate rises; the fan leans toward the pointer | Argue |
| Landing, scrolling | Section words rise; the ledger writes itself; the receipt draws; rows lean on hover; tickets tilt and their pictograms draw; a foil progress line; a header that blurs | Orient |
| Landing, journey | One card moves through four states while you read (unidentified → booked in, with a flash → shelved → decided) | Argue |
| Shell | Page and tab panels rise; cards in a gallery arrive in sequence; figures count up; the tab indicator and the active rail mark are foil and travel | Orient |
| Controls | Press settles (`scale(.98)`); a primary button throws a little foil light under itself | Confirm |
| Overlays | Drawers slide, dialogs rise, both *exit* (`.is-closing` for `--dur-exit`) | Confirm |
| Loading | Placeholders are empty cases in the shape of what is coming, with a shimmer; the boot mark breathes | Orient |

Under `prefers-reduced-motion: reduce` every animation and transition is removed. Hidden *initial*
states exist only under `prefers-reduced-motion: no-preference` and only after the page has proved it
can run the observer (`.lp-js`), so nothing is ever left invisible.

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
departed loses its colour. The lightbox is the same slab, large.

### Gallery (`gallery.css`)
The vault and the marketplace show items as slabs on a table: serial, name, state light, bin, cost.
The markup is the old register's, unchanged (same buttons, same hit areas); only the layout changed.
The photo button is inert in the gallery so the whole card opens the item.

### Panel and statement
A panel is a **section of a printed statement**: a hairline across the top with a 48 px foil segment
at its start, a serif heading, content. Statistics are columns divided by hairlines with lead figures
in the display face. A table is hairline rows under a quiet header, with a foil mark on the leading
edge of a row you point at.

### Status
`.pill` / `.badge` / `.status-badge`: an LED (7 px, the semantic colour, a soft halo) and the state in
words. Departed is a hollow LED.

### The register (`.timeline`)
A rule down the leading edge, a node per entry, the newest node lit.

### Paper pieces
The **shelf plate** (serial · state · where, on paper, under the fan of cards), the **label** (the
serial drawn as a barcode label), the **colophon** (the front page's footer), and the **record
section** (the front page's one paper section). All use `--paper`, `--paper-ink` and a foil strip.

### Empty and loading
An empty state is a dashed empty case with a serif title. Loading is an empty slab with a shimmer.

### Components this product has always had
`.serial`, `.amount`, `.seal`, `.identity`, `.stage`, `.proportion`, `.steps`, `.confirm-sheet`,
`.ltr-run` / `.bidi`, `.offer` — as in the first edition. `.stage` is now the lit mat the item's slab
stands on in the drawer.

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
| Public / sign-in | `marketing` | The only place the display face runs at poster size; real cards on a shelf are the pitch. |
| Marketplace list & detail | `marketing` heading, `vault` body | Price is the first text line, set in the display face. |
| Vault, item, wallet, services, support | `vault` | The gallery and the statement are the default shapes. |
| Warehouse | `warehouse` | Compact, keyboard- and scanner-first. Barcodes stay white for scanners. |
| Management | `vault` | Charts are graphite bars/lines with a single accent, tabular axis labels, no gradients. |

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

---

## 13. Implementation map

| File | Holds |
| --- | --- |
| `index.css` | The first-edition stylesheet: tokens, shell, every component's structure |
| `theme.css` | The kit's variables (paste target), the mapping onto Bault's tokens, foil / paper / easing tokens |
| `slab.css` | The slab, its sheen, its idle breathing, small-slab rules, the lightbox |
| `components.css` | Buttons, focus, fields, selects, panels, status LEDs, tables, tabs, overlays |
| `landing.css` | The public page |
| `app.css` | Grain, the shell (rail, page head, language switch, avatar), figures and statistics, the sign-in stage, details |
| `gallery.css` | The gallery, the item drawer's stage, loading and empty states, the register, filters |
| `motion.css` | Transitions and keyframes shared by all of the above, and the reduced-motion switch |

Loaded in that order after `index.css` (`main.tsx`). Components: `shared/CardPhoto.tsx` (slab),
`shared/ui/slabTilt.ts` (pointer tilt), `shared/ui/useLandingMotion.ts` (scroll reveal, journey,
parallax), `shared/ui/SplitWords.tsx`, `shared/ui/CountUp.tsx`, `areas/customer/marketing/LandingArt.tsx`.

`scripts/make-photo-derivatives.mjs` writes `assets/images/w640/*.webp` (the slab asks for the 640 px WebP first and
falls back to the original; 7.8 MB of photographs became 1.2 MB). Re-run it when a photograph is added.

`scripts/design-lint.mjs` keeps the logical-properties rule and applies it to all of the layers
above, and requires the reduced-motion block in `motion.css`.

**To re-theme:** paste the kit's CSS export over part 1 of `theme.css`. Colours, radius and the UI
font follow; foil, paper and the slab are Bault's own and do not.
