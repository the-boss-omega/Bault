# Figma kits that fit Bault's design system

**Question:** which Figma theme or kit can Bault adopt without abandoning what
`DESIGN.md` already decided?

**Answer:** no off-the-shelf theme should *replace* the current look. The best fit
is **IBM Carbon v11** as the component and pattern base, re-skinned with Bault's
own tokens, plus a small number of patterns from **AWS Cloudscape** and
**GOV.UK / MoJ**. Everything below was researched in September 2026. Licences
marked "Figma default" are Figma Community's CC BY 4.0 default and were not read
off each individual file.

## What any kit has to fit

- **The look is "a precision instrument, in daylight".** Trust comes from
  precision and legibility, not mood: no vault doors, no dark neon dashboards.
- **Every item view opens photo → serial → status.** Serials are IBM Plex Mono,
  never truncated, and isolated left-to-right even inside Hebrew.
- **The palette is neutral so the card photos carry the colour.** The ground is
  a cool off-white (`--surface-page #f3f4f2`); the only dark surface is the photo
  stage.
- **Five accents, one job each:** custody green `#0f5b4a`, brass `#7a5f1f`
  (money only), frost `#4a6e8f` (frozen), amber `#96591a` (warning), oxblood
  `#8c2b2b` (irreversible).
- **One of each shape token:** 3px radius (0 on tables and registers), 1px
  border, one overlay shadow. No cards inside cards, no KPI tiles, no gradients.
- **Type:** IBM Plex Sans and Plex Sans Hebrew, Plex Mono for codes, Frank Ruhl
  Libre for display. A 10-step scale.
- **Density and direction:** three densities (marketing / vault / warehouse) and
  RTL built on logical properties only, enforced by `scripts/design-lint.mjs`.

## Shortlist

| # | Kit | Fit | Licence | Take | Don't take |
|---|---|---|---|---|---|
| 1 | **IBM Carbon v11**. [Figma file](https://www.figma.com/community/file/1157761560874207208), [kit page](https://carbondesignsystem.com/designing/kits/figma/) | 9/10 | Free. Figma default licence; code and icons Apache-2.0 | Data table (5 row sizes, toolbar, batch actions, expandable rows), structured list, progress indicator, inline notification, form field states, number input, date picker, file uploader, pagination, skeletons, copyable code snippet | IBM blue `#0f62fe`, inset focus ring, white `layer-01` panels, zebra rows, tiles, pill tags, the dark shell header, yellow warning, 0-radius buttons |
| 2 | **AWS Cloudscape**. [Figma profile](https://www.figma.com/@cloudscape), [resources](https://cloudscape.design/get-started/for-designers/design-resources/) | 8/10 | Free; code Apache-2.0 | Table property filter and column preferences, split panel (list beside detail, for the warehouse bench), key-value pairs, status indicator, wizard, [bidirectionality guide](https://cloudscape.design/get-started/dev-guides/bidirectionality/) | AWS palette and fonts, rounded shadowed containers, dashboard board items |
| 3 | **GOV.UK + MoJ kits**. [GOV.UK](https://www.figma.com/community/file/1543190867840891511), [MoJ](https://www.figma.com/community/file/1543193133973726850) | 7/10 | Free; `govuk-frontend` MIT. GDS Transport and crown restricted | Check-answers summary list (for the confirm sheet before irreversible actions), error summary, task list, MoJ Timeline (append-only, like the register) | Yellow focus, GDS Transport, black header, large body type, thick inputs |
| 4 | **GitHub Primer**. [Primer Web](https://www.figma.com/community/file/854767373644076713) | 6.5/10 | Free; primitives MIT | Two-layer token naming (base → functional), Timeline, StateLabel, empty states, high-contrast theme idea | Branding, Mona Sans, 6px radius, pill counters, Octicons |
| 5 | **USWDS Design Kit (beta)**. [Figma file](https://www.figma.com/community/file/1440921849343185329/uswds-design-kit-beta) | 6/10 | Public domain | Colour *grading* rule (a gap of 50+ grades guarantees AA contrast), step indicator, summary box | Public Sans, gov banner, bright blue |
| 6 | **Obra shadcn/ui (Community)**. [Figma file](https://www.figma.com/community/file/1514746685758799870) | 4.5/10 | Free, MIT | Only its lean semantic-variable setup, as a model | Nearly everything visual |

**Rejected:**
- **Untitled UI PRO:** no RTL, a licence that bars exposing source, and a look
  (Inter, purple, soft shadows, KPI cards) that is a list of `DESIGN.md`'s
  anti-patterns.
- **Radix Themes Figma:** the file is unofficial.
- **Ant Design RTL:** the publisher is unverified, and the look conflicts.
- **Generic fintech and NFT-auction kits:** dark with neon, which `DESIGN.md`
  explicitly rejects.

## Why Carbon

- It already uses **IBM Plex**, so there is no font change.
- **Its Gray 10 theme is almost Bault's light theme:** background `#f4f4f4` vs
  `#f3f4f2`, white fields, text `#161616` vs `#111318`. Gray 100 `#161616` is
  almost the photo stage.
- **Its colours are Figma variables**, so they can be repointed at Bault's tokens
  rather than copied.
- **Its component styles are RTL-safe:** the data table, notification and input
  SCSS use only logical properties (83 logical, 0 physical, counted in
  `@carbon/styles@1.115.0`).
- **Caveat:** Carbon has no RTL *design* guidance
  ([issue #3754](https://github.com/carbon-design-system/carbon-website/issues/3754)),
  and the Figma kit is LTR. Borrow Cloudscape's bidirectionality rules for that.

## Merge plan

`index.css` stays the source of truth. The merge happens in Figma.

1. **Copy the kit.** Duplicate Carbon v11 into the Bault team. Keep only the
   Gray 10 and Gray 100 modes, and rename them "Bault Light" and "Bault Dark".
2. **Add the primitives.** Create a "Bault / Primitives" variable collection
   holding the literal values from `:root` and the dark block of `index.css`.
3. **Repoint Carbon's semantic variables at Bault's tokens:**
   - `background` → `--surface-page`
   - `layer-01` → `--surface-raised`
   - `layer-02` → `--surface-sunken`
   - `field-01` → `--surface-input`
   - `border-subtle-01` → `--line`
   - `border-strong-01` → `--line-strong`
   - `text-primary` → `--ink`
   - `text-secondary` → `--ink-2`
   - `interactive`, `focus`, `button-primary` → `--custody`
   - `support-error` → `--oxblood`
   - `support-warning` → `--amber`
   - `support-info` → `--frost`
   - `background-inverse` → `--surface-stage`
4. **Add what Carbon lacks:** brass and its variants, the `*-wash` values,
   `surface-stage`, and the frozen/departed state rails.
5. **Add density.** Create a "Density" collection with modes marketing / vault /
   warehouse (`row-min-h` 56 / 44 / 34), and bind table row height to it.
6. **Fix the number and type tokens.**
   - Numbers: radius 3, flat radius 0, border 1, focus width 2, focus offset 2.
   - Carbon's type steps: 20 → 18/22, 32 → 28/36, 42 → 48.
7. **Strip the conflicts:**
   - Tags become the Status component with a leading rule.
   - Tiles are removed.
   - Zebra rows are turned off.
   - The batch action bar uses the ground colour instead of a brand fill.
   - The focus ring becomes an outer 2px custody-green ring.
8. **Check against the code.** Export the variables to DTCG JSON (e.g. with
   Tokens Studio) and diff them against `index.css` in `design-lint.mjs`. Never
   generate the CSS from Figma.
9. **Handle RTL.** Keep mirrored Hebrew frames for the key templates in Figma;
   the actual mirroring stays in CSS logical properties.

## Paid options (checked 13 September 2026, budget no object)

**No paid kit beats Carbon as the base.** None ships real RTL or Hebrew support
in its Figma file, none starts closer to Bault's look, and none uses IBM Plex.
Money is better spent on what Carbon lacks: customer-facing commerce patterns,
and RTL mirroring in Figma.

| # | Kit | Price | Fit | Use it for | RTL |
|---|---|---|---|---|---|
| 1 | [shadcndesign Pro](https://www.shadcndesign.com/pricing) | Team (5 seats): $359 / $999 / $1,799 | 7/10 | E-commerce blocks (product lists, filters, cart, checkout, order summary). Its `Style` variable modes (square Lyra, compact Mira) as the model for Bault's density collection | None in Figma |
| 2 | [Ant Design System for Figma](https://www.antforfigma.com/pricing) | Personal $149–$549; team price unconfirmed | 6.5/10 | Deepest back-office table patterns, compact mode | Unconfirmed |
| 3 | [Untitled UI PRO](https://www.untitledui.com/pricing) | Studio $399 (8 seats) | 6/10 | Table cell variants, settings and detail pages. Its colours, radius and shadows can be repointed | Not mentioned |
| 4 | [Obra shadcn/ui Pro](https://shadcn.obra.studio/products/obra-shadcn-ui-pro) | Team €299 | 6/10 | The leanest variable set to repoint; far fewer blocks | None |
| 5 | [AlignUI Pro](https://pro.alignui.com/pricing) | Startup $399 | 5/10 | Wallet send-money and transaction flows, as reference only | None |
| 6 | [MUI for Figma](https://mui.com/store/items/figma-react/) | $79 per editor | 4/10 | The Data Grid; the Material look is a mismatch | Not documented |

**What to buy:**
- **shadcndesign Pro, Plus tier, Team licence ($999)**, for the marketplace and
  checkout blocks. Premium's React code doesn't apply to Bault's plain-CSS app.
- **[RTL Layout](https://www.rtllayout.com/) Team plan ($99 a year)**, to
  generate mirrored Hebrew frames. Test it on a Hebrew frame first: Hebrew isn't
  named on its site.
- **Cheaper route:** Obra Pro team (€299) instead of shadcndesign.

**How to merge it:** keep Carbon as the base and import only the blocks you need
onto a separate page.
1. Lock `Style` to Lyra and bind radius to Bault's 3 / 0 tokens.
2. Alias the kit's colours to Bault's primitives and delete its shadows.
3. Swap every text style to IBM Plex.
4. Remove KPI tiles, cards inside cards, and gradients.
5. Diff the exported variables against `index.css`.

## Two findings in Bault itself

- **Form-field borders fail WCAG 1.4.11 (non-text contrast, 3:1).**
  `--line-strong #c3c6bf` measures 1.57:1 against the page, and `.control`'s
  `--line` measures 1.23:1. Carbon's equivalent border is `#8d8d8d` (3.02:1). A
  dedicated `--line-control` token is worth adding.
- **`DESIGN.md` and the CSS disagree on `--ink-2`.** The document says `#676c74`;
  the CSS has `#62676f`. By `DESIGN.md`'s own rule, the document is the one to fix.
