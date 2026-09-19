# Session summary — 16–18 September 2026

Shipping calculation, the VIP membership, the tunnel, and what they turned up.
Full detail is in DIVE1 Parts 42–46 and `docs/design/04-figma-kits.md` /
`05-vip-membership.md`. This is the short version.

| Topic | Status |
|---|---|
| Figma theme | **shadcndesign Pro — Plus, Team licence ($999)** on a free IBM Carbon base. Not bought yet. |
| Shipping calculation | Matches ShipMyCards except two deliberate differences |
| VIP membership | Built and working; shipping inclusions + commission waiver not yet deducted |
| Tunnel | Live, serves the built app only, no access to your computer |
| Bugs found | 4 fixed (dev-mode builds, 2 credential leaks, homework PDF, seed reset) |
| Landing page | Rayquaza card slides in |
| Tests | 184 web + 112 ux + 34 contract passing; typecheck and design-lint clean |

---

## 1. The Figma theme

You asked for a **paid** theme to combine with our design, price no object. The pick:

**[shadcndesign Pro](https://www.shadcndesign.com/pricing) — Plus tier, Team Professional licence (5 seats): $999**
(Personal Plus is $299 if only one person will use it.)

Checked 18 September 2026:

- One-time payment, lifetime updates, unlimited commercial projects
- 340+ Pro Blocks across **Landing Page, Application and E-commerce**
- All 8 style modes — **Lyra** (square) matches our 3px radius; **Mira** (compact) is the model for our warehouse density
- 14-day refund (90% after fees)

**Why this one.** Its commerce blocks — product lists, filters, cart, checkout, order summary — are
exactly what our marketplace and the Bault store lack. Its colours, radius and shadows are
variables, so they can be repointed at our tokens instead of fighting them.

**It is not used alone.** It layers on **IBM Carbon v11 (free)** as the base, because Carbon is the
closest starting point that exists: it already uses IBM Plex, its Gray 10 theme is almost our light
theme (`#f4f4f4` vs our `#f3f4f2`), and its styles are RTL-safe.

**Add: [RTL Layout](https://www.rtllayout.com/) Team plan ($99/year)** for mirrored Hebrew frames in
Figma. Test it on a Hebrew frame first — Hebrew is not named on its site.

**Rejected: Untitled UI PRO** — the most-recommended kit on the market, but Inter, purple, soft
shadows, 12px radius and KPI cards are a list of `DESIGN.md`'s named anti-patterns.

**How to merge it:** keep Carbon as the base, import only the shadcndesign blocks you need onto a
separate page, lock the style to Lyra, alias its colours to our primitives, delete its shadows, swap
every text style to IBM Plex. `index.css` stays the source of truth — never generate CSS from Figma.
The 9-step plan is in `docs/design/04-figma-kits.md`.

---

## 2. Shipping calculation

### How it works, in plain words

**Nobody ever measures an item.** You never ship an item, you ship a *box*, and there are only five
boxes with known sizes.

1. **At intake** the item is weighed — or given its class's typical weight (graded slab 60 g, sealed
   case 6,000 g). Weight only, never size.
2. **When you ship**, the item weights are added up.
3. The system picks the **smallest of the five boxes** that carries that weight and takes those item
   types. You can choose a bigger one.
4. Two weights are worked out:
   - **Real weight** = items + the box's own weight
   - **Volume weight** = (L × W × H in inches) ÷ 167
5. The carrier bills **whichever is bigger**.
6. That is **rounded up** to the next whole pound or ounce.
7. Carrier price, then Bault adds handling ($0), rush ($10), insurance (1.5%), add-ons.

**Heavy item, small box** → real weight wins (a 1.2 kg box bills on 1,380 g, not its 686 g volume).
**Light items, big box** → volume wins (two cards bill on 6,526 g in a large box).
Same two cards: **$6.45** in a rigid mailer, **$33.00** in a large box — which is why the system
picks the box for you.

### Same as ShipMyCards

The ÷167 formula · bill the greater of real and volume weight · per-pound (ePost) and per-ounce
(ePacket) rounding · the warehouse picks the box · ePacket 4 lb / $400 customs / $500 insurance /
24″ longest side / 36″ L+W+H · ePost 20 lb / $2,000 · $5,000 insurance ceiling · signature forced
above $500 · $0 handling markup · $2 package processing · 180 days storage then 10% per 90 days ·
$25 restocking · $25 chargeback.

### What we changed to match

| Change | Before | After |
|---|---|---|
| Dimensional divisor | 139 (~20% over-quote) | **167** |
| Weight billing | continuous (under-quoted by up to a unit) | **whole pounds / ounces** per service |
| ePacket size limits | not modelled | **24″ longest side, 36″ L+W+H** — a large box breaks it empty |
| Box when none chosen | none → no volume billed | **smallest box that fits** |

### Still different, on purpose

- **Over 20 lb:** they split into several parcels; we refuse and name the limit. Splitting is a
  real feature (custody, labels, insurance per parcel).
- **Intake fee:** theirs is per class ($1 card / $5 lot / $20 sealed case); ours is flat $5. Our
  pricing rules already support per class — a pricing decision, not a code change.

### Where it is in code

`inv/item-classes.ts` (weights) → `shp/parcel-profile.service.ts` `measure()` →
`shp/boxes.ts` `chooseBox()` → `adapters/shipping.ts` `dimensionalGrams()` + `billableGrams()` →
the adapter's price → `shp/shipment.service.ts` `priceServices()`.

### Found — fixed 19 September

`shp/dispatch.service.ts` bought the label with a **hard-coded `US`/`00000` destination**, the total
weight repeated per item, and no box dimensions. It now asks `ShipmentService.labelRequest()`, which
rebuilds the request from the shipment's stored address snapshot, box and billable weight.

### Why 167 and not 139

167 is the divisor ShipMyCards publishes, and matching them was the brief. 139 is the FedEx/UPS
retail divisor — about 20% more dimensional weight for the same box. USPS uses 166. With EasyPost
the carrier computes dimensional weight itself, so the constant only drives sandbox quotes and the
catalogue a collector sees before a label is bought.

### Intake per class — decided 19 September

Intake is now priced by what arrived, from ShipMyCards' list: **$1** a card or graded slab, **$5**
an oversized card, sealed pack or box, comic, small collectible, or a lot (`intake_lot`), **$10** a
collection box, **$20** a sealed case or memorabilia. The flat $5 stays as the catch-all for `other`.
Storage is 10% of the item's own intake fee, so a single card now costs a tenth of what it did to
store. A lot still uses one of a member's intakes.

---

## 3. VIP membership

### The tiers

Named for what a collection *is*, not for a metal:

| | Folio | Registry | Trust |
|---|---|---|---|
| **Monthly fee** *(illustrative)* | $39 | $199 | $699 |
| For | keeps a collection, ships rarely | active trader | dealers, five-figure collections |
| Storage | 60 items | 200, incl. oversized | 750 |
| Intake | 4/mo | 10/mo | 25/mo |
| Inbound parcels | 2/mo | 5/mo | unlimited |
| Insured shipments | 1 ≤ $500 | 3 ≤ $1,000 | 6 ≤ $2,500 |
| Postage credit | $10 | $30 | $100 |
| Commission waived on | — | $1,000/mo | $3,000/mo |
| Break-even utilisation | 63% | 66% | 64% |

**Better than ShipMyCards:** they have no membership at all. The headline benefit is that **the
storage clock stops**.

### The three rules

1. **Every allowance has a ceiling** — Bault's worst case per member is computable.
2. **No overage rate anywhere** — run out, and the action goes back to its normal price and needs
   the same approval as any paid action.
3. **Allowances don't roll over.**

### The open question — answered

**The commission waiver does NOT cover consignment.** The marketplace fee is 100% Bault's money, so
waiving it is cappable. A consignment commission is partly the partner's (auction house, eBay
partner), which Bault never receives and cannot waive.

### Verified working

Subscribing charges the fee and grants allowances. 4 intakes booked with **no charge**, the 5th
charged the ordinary price (then a flat $5.00; per class since 19 September). Buying through the tunnel UI works end to end.

### Wired — 19 September

Everything the table promises is now deducted at the moment it is charged, and nothing else:

- **Shipments:** insured value up to the tier's cap, postage credit, rush, GPS tracker. The quote
  shows the net price and a line saying what the membership paid; the cover is stored on the
  shipment and spent in the same transaction that charges it. "Choose for me" no longer picks a
  slower service because a credit made it look cheap.
- **Commission, escrow fee, cash-out fee, show pickup:** waived at charge time within the allowance.
- **Upgrades** prorate: the unused part of the current cycle is credited. **Downgrades** wait for the
  renewal date (they used to cancel the membership outright) and can be undone with "Keep".

### Code

`modules/mem/*` · migration `0027` · the one entitlement check in `pay/billing.service.ts` ·
storage exclusion in `worker/jobs/storage-fee.ts` · `worker/jobs/membership-renewal.ts` ·
`areas/customer/membership/MembershipPage.tsx` · full proposal in `docs/design/05-vip-membership.md`.

---

## 4. The tunnel

**Current link:** https://revolutionary-specialists-vol-chevy.trycloudflare.com
(changes every time the tunnel restarts)

### How to run it

```bash
pnpm dev:api      # API + database must be up
pnpm tunnel       # builds, serves dist/ behind a password, opens the tunnel,
                  # prints the link, user and password
```

(`WEB_PREVIEW_PASSWORD=... pnpm tunnel` to choose the password; otherwise one is generated.)

`.env` has `WEB_PUBLIC_HOST=…,.trycloudflare.com`, so any quick-tunnel address is allowed.
**Never tunnel `pnpm dev`** — it serves your source files.

Don't run `pnpm dev:api` after `pnpm dev` — that's the `EADDRINUSE :3000` error (the API twice).

### Does it give access to your computer? No.

It forwards to **one address only**, `localhost:4173`. Tested through the live link:

- `.env`, `package.json`, source files, `win.ini`, path traversal → all return the web page, no file
- Swagger, MinIO, the database → not reachable
- Private API routes → **401**; public ones (price list, tiers, listings) → 200 by design

**Caveats:** since 19 September `pnpm tunnel` puts a password in front of the site (browser prompt); whoever logs in can act as that account
— don't hand out the admin login; the link dies when the machine sleeps or `cloudflared` stops.

### Can he get the files but not see them? No.

Anything a browser runs, the viewer can read. What he gets is already the minimum: a minified bundle
with no source, no sourcemaps and no comments. The business logic lives in the API, not the bundle.

---

## 5. Bugs found while getting it ready

| Bug | Impact | Fix |
|---|---|---|
| `vite build` produced **development** bundles — root `.env`'s `NODE_ENV=development` leaked into Vite | 1,562 kB with `jsxDEV`; every `DEV` branch live | One line in `vite.config.ts` → real 894 kB build |
| Login form **pre-filled with a real account and password** in the deployed build | Anyone opening sign-in got working credentials | Fixed by the build fix above |
| Admin email + password in the i18n catalogue, shipped whole | Findable with Ctrl+F in devtools, even in a true production build | Moved to `auth/demoUsers.ts`, tree-shaken out |
| `assets/images/EX1_sol.pdf` (TAU homework) publicly downloadable | `assets/` is the publish folder | Moved to `_local/` (gitignored) |
| `pnpm db:reset` didn't clear membership tables | Seed stopped being the clean state | Added to the seed's clear list |

New test `tests/web/no-credentials-in-bundle.test.ts` checks the **built** output, so this can't
come back.

---

## 6. Landing page animation

The Rayquaza card slides in from the outside edge of the stage (left in English, right in Hebrew),
fading and settling over 250 ms. Only the card moves. Turned off automatically for users who prefer
reduced motion. It's the one exception to `DESIGN.md`'s "motion confirms, never entertains" — argued
in DIVE1 Part 46.

---

## 7. `docs/production-readiness.md`

A 357-line audit from 12 September: *what's missing before real customers and real money.*
5 blockers · 11 serious · 8 compliance · 4 housekeeping. 13 already fixed.

Refreshed 19 September: B2 updated for EasyPost, the §5 bugs added, plus two more — `nginx.conf`
never forwarded `/api` (a deployed site could not sign in) and the sign-in audit trail.

---

## 8. Open items

- [ ] Buy the Figma kit (§1) and run the merge plan — needs your purchase
- [x] Wire the VIP shipment inclusions and commission waiver (§3) — plus escrow, cash-out, pickup, GPS
- [x] Fix the label-purchase destination bug in `dispatch.service.ts` (§2)
- [x] Decide per-class intake pricing (§2)
- [x] Refresh `production-readiness.md` (§7)
- [x] Basic-auth gate on the tunnel (§4) — `pnpm tunnel`
- [x] Two pre-existing lint errors in `apps/api/svg2png.tmp.mjs`
- [x] VIP bugs: downgrade cancelled the membership; renewal precision; prorated upgrade
- [x] Security: sign-in log (incl. failures), IP + device per session, admin **Sign-ins** tab
- [x] Deploy: nginx `/api` proxy, `TRUST_PROXY`
- [ ] Remaining, needs you: an EasyPost key to exercise real labels; 2FA / KYC decisions (readiness C1, C5)
