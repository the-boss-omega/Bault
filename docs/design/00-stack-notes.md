# 00 — Stack notes

What the redesign is being built on, what was already there, and what had to be assumed.
Written at the start of the "Custody Grade" pass so that every later decision can be traced to
something that was actually checked rather than guessed.

## The application

| | |
| --- | --- |
| Repo | pnpm workspace monorepo, `apps/{api,web,worker}` + `packages/{adapters,config,contracts}` |
| Web app | React 19 + Vite 6, TypeScript. **No Tailwind, no shadcn/ui, no Radix, no CSS-in-JS.** |
| Styling | One hand-written stylesheet, `apps/web/src/index.css` (4 599 lines), BEM-ish class names, CSS custom properties, light + dark palettes |
| Routing | Custom hash router, `apps/web/src/shared/routing.ts`. Shape `#/<section>/<tab>?<param>=<id>`. Opening a record is a real history entry. |
| i18n | Custom provider, `apps/web/src/shared/i18n.tsx` (4 197 lines). Hebrew is the **source-of-truth catalogue**; `MessageKey` is derived from it and the English catalogue is a total map, so a missing translation fails the build. |
| Direction | `I18nProvider` writes `document.documentElement.lang` and `.dir` (`he → rtl`, `en → ltr`). **Verified working** — the globe control flips `<html dir>` on both the auth screen and inside the shell. |
| Theme | `apps/web/src/shared/theme.tsx` — light / dark / system, stamping `data-theme` on `:root`. Three states, correctly implemented. |
| Icons | Hand-drawn inline SVG set, `apps/web/src/shared/ui/icons.tsx` (582 lines). No icon-font, no external dependency. |
| API | NestJS + Drizzle + Postgres, session cookie, `/api/v1/*`, proxied by Vite in dev. |
| Card photography | Real photographs of real cards, one PNG per serial in `assets/`, served at `/images/<SERIAL>.png`. Ten Rayquaza cards, catalogue-accurate. |

### Consequences for the brief

The brief assumes a Tailwind + shadcn/Radix stack. **This project has none of them**, so three
instructions do not apply as written and were adapted rather than followed literally:

- *"Tailwind theme entries"* → tokens are CSS custom properties on `:root`, which is what this
  stylesheet already uses. Nothing to add a Tailwind config for.
- *"Radix `DirectionProvider`"* → there is no Radix. Direction comes from `<html dir>` and the
  stylesheet is written in logical properties, which is the mechanism Radix's provider exists to
  approximate. Verified by measurement rather than assumed (see below).
- *"shadcn MCP to install primitives"* → every primitive is already local, in
  `apps/web/src/shared/ui/`. They are restyled in place; nothing is installed.
- *"`/impeccable` … DESIGN.md, PostToolUse slop detector"* → **not installed in this environment.**
  There is no `impeccable` skill, plugin or command available. Substituted: `DESIGN.md` is written
  by hand, and `scripts/design-lint.mjs` is added to play the slop-detector role (physical-property
  classes, off-scale values, stray radii/shadows, mono misuse). `web-design-guidelines` **is**
  available and is used.

`playwright-cli` (v0.1.19) is present and is the primary eye. Its `run-code --filename=…` mode gives
the full Playwright `page` API, which is how the 220-shot baseline was captured in three passes
rather than three hundred CLI calls.

## Running it

Infrastructure was already up (`infra/docker-compose.yml`): Postgres 16 on 5432, pgbouncer on 6432,
MinIO on 9000. An API instance was already listening on `:3000` and answering
`/api/v1/healthz`, so only the SPA needed starting.

```
pnpm dev            # API + web, in order (scripts/dev.mjs)
pnpm dev:web        # web only, when the API is already up
```

The dev server took **port 5174** because 5173 was already occupied by a pre-existing Vite process.
Every URL in the audit is therefore `http://localhost:5174/`.

## Credentials and data

`apps/api/src/db/seed.ts`. **Every seeded account uses the password `11111111`**, and sign-in accepts
either the email or the immutable username.

| Role | Email | Username |
| --- | --- | --- |
| Collector | `red@bault.dev` | `red` |
| Collector (counterparty) | `golden@bault.dev` | `golden` |
| Warehouse operator | `hermon@bault.dev` | `hermon` |
| Manager / admin | `eldar@bault.dev` | `eldar` |
| Legacy collector (flagged name, carries a retired `OW-` intake ID) | `veteran@bault.dev` | `veteran` |
| Platform custodian (receives donations/consignments) | `platform@bault.dev` | `platform` |

The sign-in screen prints the demo accounts under the form, so nothing had to be discovered by
reading the database.

Seeded material, as the seed's own summary reports it: 6 users, 6 bins (4 standard, 2 oversized),
8 items across two collectors, 1 batch, 2 listings, 1 offer, 1 swap, 1 transaction, 1 dispute,
3 service requests, 1 shipment, 1 withdrawal, 4 wallet requests, 3 notifications, 2 addresses,
2 shows. Two further cards (`SN-EVS194-0009`, `SN-EVS218-0010`) are deliberately **not** seeded so
the receiving bench has real, photographed material to intake by hand.

### Data gaps found, and what was done about them

State coverage was checked against the states the redesign has to draw, not against the seed's own
summary. Gaps are recorded in `01-audit.md` and closed by extending the existing seed — never by
hand-writing a fixture screen.

## Things verified rather than assumed

- **`<html dir>` flips.** Switching to English gives `ltr / en`; Hebrew gives `rtl / he`.
- **The shell mirrors correctly.** At 1440 px, `document.scrollWidth === clientWidth === 1440` in
  both directions; the rail is `position: fixed` at `inset-inline-start: 0` and the workspace carries
  `margin-inline-start: 76px`, measured as `left: 0` in LTR and `left: 1364px` in RTL. There is no
  horizontal overflow in either direction. *(A full-page screenshot renders `position: fixed`
  elements at the scroll origin, which makes the rail look mispositioned in tall RTL captures. It is
  a capture artefact, not a layout bug — measured, not eyeballed.)*
- **The Hebrew and Latin display faces are one voice.** Frank Ruhl Libre ships a Latin companion
  drawn for its Hebrew; set side by side at 48/64 px in `docs/design/type-specimen.html` they share
  stroke contrast and vertical proportion. Source Serif 4 was the alternative in the brief and was
  **not** adopted — it would have added 436 kB to assert a resemblance this family gets by
  construction.

## Assumptions

1. **There is no public/marketing site.** The whole SPA is behind authentication; the only anonymous
   surfaces are sign-in, sign-up, forgot/reset password and verify-email. The brief's "public site,
   landing" is therefore read as *the anonymous surface*, and the sign-in shell is given the
   marketing treatment (photograph of a real item, the display face, the custody line) rather than a
   new marketing site being invented at new routes. Flagged as a deferred question in the report.
2. **The item view stays a URL-addressed drawer, widened.** The brief describes an item *page* with
   a photography stage, then a serial/status header, then details+services on the start side and the
   custody register on the end side. That is a layout, not a routing requirement, and the existing
   drawer is already addressable (`?item=<id>`) and already puts the Back button in charge of
   closing it. It is widened into a full-height sheet that takes that layout at ≥ 900 px and stacks
   below it, rather than being rebuilt as a route.
3. **Storage-object images are broken in this environment and that is not a design defect.**
   `item_image` media resolve to MinIO URLs that answer **403** (`.../sn-ros105-0008-intake.jpg?X-Expires=300`
   — the signature parameters are absent from the presigned URL). Backend/storage is out of scope
   per the guardrails; the UI is made to degrade to a stated placeholder instead of a broken-image
   glyph with sprawling alt text, and the underlying fault is reported, not patched.
4. **`USD` is the only settlement currency in the seed**, so "locale-correct currency" is exercised
   as `$` formatted under `he-IL` and `en-US` conventions, not as a multi-currency feature.

## Typefaces added

`scripts/fetch-fonts.mjs` downloads and subsets the faces into `assets/fonts/` and generates
`apps/web/src/fonts.css`. Self-hosted, `font-display: swap`, `latin` / `latin-ext` / `hebrew` only.
**512 kB across 19 files**, replacing a 396 kB single-weight mathematical face
(`LibertinusMath-Regular.woff2`) that the stylesheet had already stopped using and that covered no
Hebrew at all.

| Face | Weights | Job |
| --- | --- | --- |
| IBM Plex Sans | 400 / 500 / 600 | Latin UI |
| IBM Plex Sans Hebrew | 400 / 500 / 600 | Hebrew UI (hebrew subset only — Plex Sans covers the Latin) |
| IBM Plex Mono | 400 / 500 | Serials, bins, parcel and shelf codes. Nothing else. |
| Frank Ruhl Libre | 500 / 700 | Display, both scripts, marketing sizes only |
