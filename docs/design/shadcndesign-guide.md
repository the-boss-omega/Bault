# shadcndesign — the complete guide for Bault

*Written 19 September 2026, the day the kit was bought. Facts about the product are from
shadcndesign's own site and docs on that date (sources at the end); anything I could not
confirm there is marked **unverified**.*

---

## 0. First: which plan do you have?

Open the receipt email (it comes from **Polar**, shadcndesign's payment provider) and check
the product name. What you can do depends on it:

| | **Basic** $119 | **Plus** $299 ← *what I recommended* | **Premium** $599 |
|---|---|---|---|
| Figma kit | Basic (Nova style only) | **Pro kit** | Pro kit |
| Styles | 1 | **All 8** | All 8 |
| Pro Blocks | — | **340+, in Figma only** | 340+, Figma **and React code** |
| Templates | free one only | Figma files | Figma + Next.js code |
| Agent Skills (for AI tools like me) | — | **3 design skills** | all 10 |
| Figma → code plugin | — | — | 1 user |
| Licence | 1 person | **1 person** | 1 person |
| Updates / use | lifetime, unlimited commercial projects | same | same |

**For Bault, Plus is the right one** — and the missing React code does not matter: Bault
is not a Tailwind or shadcn/ui app. It has its own stylesheet (`apps/web/src/index.css`) and
its own components. We use the kit to **design**, and I **build** what you design in
Bault's own code. (More in §6.)

**Refund window:** 14 days from purchase, 90% back. Bought 19 September → decide by
**3 October 2026**. Email `hi@shadcndesign.com`.

---

## 1. Sign in and collect what you bought

There is no username or password to create. Everything lives in the **Polar customer portal**.

1. Go to **https://polar.sh/shadcndesign/portal**
2. Enter **the same email you paid with**. Polar emails you a sign-in code/link — open it.
3. In the portal you'll find:
   - **The Figma kit link** — this gives you full edit access to the kit file.
   - **Agent Skills (ZIP)** — the 3 design skills for Claude Code (§5).
   - **Receipts and invoices.**
   - Later, **updated files** when a new version ships.
4. Future updates are announced by email from `shadcndesign@notifications.polar.sh` —
   add it to your contacts so it doesn't land in spam.

> If the portal says there's no purchase: you used a different email at checkout. Try
> your other addresses, or write to `hi@shadcndesign.com` with the receipt.

---

## 2. Put the kit in Figma (15 minutes)

**You need:** a Figma account (free works to start), and the Figma **desktop app**
(fonts and big files behave better than in the browser).

1. **Open the kit link** from the portal and **import/duplicate it** into:
   - your **Drafts** if you're on Figma's free plan, or
   - a **team project** if you're on a paid Figma plan (then you can publish it as a library).
2. **Rename your copy** → `Bault — Design System`. Never edit the original; keep your
   copy as the one we work in.
3. **Trim the icons.** The kit ships five icon libraries. Keep **Lucide** (shadcn's
   default — simple 1.5px line icons, closest to Bault's quiet style), delete the other
   four icon pages. The file gets much lighter. Bault's code has no icon package; icons
   you choose in Figma I'll add as inline SVG.
4. **Install Bault's fonts on your computer** (all free, Google Fonts), then restart Figma:
   - **IBM Plex Sans** and **IBM Plex Sans Hebrew** — all interface text
   - **IBM Plex Mono** — serials and codes only
   - **Frank Ruhl Libre** — headlines (the display face on the landing page)
5. **Optional, paid Figma plan only:** *Publish* the file as a library, so every new Bault
   design file can use its components and updates flow to all of them.

---

## 3. What's inside — a tour

**Four variable collections** (Figma → right panel → *Local variables*):

| Collection | What it holds | Bault use |
|---|---|---|
| **Tailwind** | Raw palette (26 colours × 11 steps), spacing, radius, widths | reference only |
| **Style** | 8 modes (below): colours for light/dark, fonts, radius ramp, type scale, shadows | **we add a 9th mode: "Bault"** |
| **Mode** | Light / Dark — the semantic tokens (`background`, `primary`, `border`…) under shadcn's exact CSS names | switch to preview dark mode |
| **Typeset** | 14 / 15 / 16 / 18 px for long-form text | help pages, terms |

**The 8 styles** — each is one click away (select a frame → *Change variables mode* →
*Style*), and everything inside re-sizes, re-rounds and re-fonts:

| Style | Feel | For Bault? |
|---|---|---|
| Nova | the shadcn default, balanced | — |
| Vega | a little more distinctive | — |
| **Mira** | dense, smaller, 2px borders, for dashboards | **model for the warehouse and admin screens** |
| Luma | round, airy, friendly | ✗ too soft |
| Sera | square, editorial, underline inputs | interesting for the landing page |
| Maia | round, approachable | ✗ |
| Rhea | modern, borderless fields | — |
| **Lyra** | square corners, minimal | **the closest to Bault — start here** |

**Pro Blocks (340+)** — ready-made sections in three groups: **Landing page**,
**Application** and **E-commerce**. The e-commerce ones (product grids, filters, cart,
checkout, order summary) are what Bault's marketplace and house store are missing.

**Templates** — complete example pages, useful to see how blocks combine.

**Agent Skills (3)** — instruction sets that teach an AI assistant (me, in Claude Code) to
design properly *inside* this kit. Covered in §5.

---

## 4. Make it Bault — the one setup that matters

Everything else depends on this: a **"Bault" style mode** in the kit, so every block you
drop in comes out already in Bault's colours, fonts and corners. Two ways to do it:

### Way A — with me (recommended, ~10 minutes of your time)
After §5 setup, tell me:

> `/shadcn-design-apply-brand` — create a "Bault" style mode from `DESIGN.md` and the
> tokens in `apps/web/src/index.css`, starting from Lyra. Light and dark.

The skill reads a brand source and creates the new style mode with colours, radius and
fonts for both light and dark. You review it in Figma.

### Way B — by hand (~1 hour)
1. *Local variables* → **Style** collection → right-click the **Lyra** column →
   *Duplicate mode* → rename it **Bault**.
2. In the **Bault** column, set the values below. (Change colours in the Style
   collection's `color/light/*` and `color/dark/*` — the kit's docs say to recolour
   there, never on components directly; the tints follow automatically.)

**Colours — Bault's real values, light / dark:**

| shadcn token | Bault token | Light | Dark |
|---|---|---|---|
| `background` | `--surface-page` | `#f3f4f2` | `#14161a` |
| `foreground` | `--ink` | `#111318` | `#f0f1ee` |
| `card` / `popover` | `--surface-raised` | `#f3f4f2` | `#14161a` |
| `muted` | `--surface-sunken` | `#e9ebe7` | `#1c1f24` |
| `muted-foreground` | `--ink-2` | `#62676f` | `#9aa0a8` |
| `primary` | `--custody` (custody green) | `#0f5b4a` | `#4fbfa2` |
| `primary-foreground` | `--ink-on-accent` | `#ffffff` | `#0b0d10` |
| `accent` | `--brass` | `#7a5f1f` | `#c8a44e` |
| `destructive` | `--oxblood` | `#8c2b2b` | `#e79191` |
| `border` | `--line` | `#dcded9` | `#2b2f36` |
| `input` | `--line-strong` | `#c3c6bf` | `#3d434c` |
| `ring` (focus) | `--custody` | `#0f5b4a` | `#4fbfa2` |
| *(stage / photo background)* | `--surface-stage` | `#16181c` | `#0c0d10` |

3. **Radius:** set the whole `radius/*` ramp to **3px** (and `none` = 0). Bault has one
   radius. No pill buttons.
4. **Fonts:** `font/family/sans` = IBM Plex Sans · `heading` = Frank Ruhl Libre ·
   `mono` = IBM Plex Mono.
5. **Shadows:** set them all to none except one for overlays (menus, dialogs). Bault
   separates things with lines and surfaces, not drop shadows.
6. Select a page → *Change variables mode* → **Style: Bault**. Check a few blocks.

### Bault's rules — the kit won't enforce them, so you do
From `DESIGN.md` §11 (anti-patterns). When a Pro Block breaks one, fix the block:
- **No cards inside cards**, no floating tiles — sections are a heading and a rule.
- **No KPI tiles** (big number + tiny label + trend arrow grids).
- **No gradients, no glassmorphism**, no decorative illustrations. Real photographs only.
- **One dark surface:** the photography stage. Everything else is light (or dark mode).
- **Everything on a 4px grid.** Sizes from the 10-step type scale only.
- **Two languages:** every key screen needs a Hebrew (right-to-left) version — see §6.

---

## 5. Set up designing *with me* (one time, ~10 minutes)

This lets me read and **draw directly in your Figma file** from Claude Code.

**Step 1 — connect Figma to Claude Code.** In a terminal:

```
claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp
```

Then start Claude Code, type `/mcp`, pick **figma** → **Authenticate** → **Allow access**
in the browser. You should see *"Authentication successful. Connected to figma"*.

**Step 2 — install the 3 skills.** Download the Agent Skills ZIP from the Polar portal and
unzip it into:

```
C:\Users\User\.claude\skills\
```

(so you get folders like `...\skills\shadcn-design-figma\`). Restart Claude Code.

**Step 3 — test it.** Paste the link to any frame in your kit copy and ask me: *"What's in
this frame?"* If I can describe it, we're connected.

### Which Figma plan you need (checked on Figma's docs, 19 September 2026)

| Your Figma plan | I can **read** your designs | I can **draw** in your file | Cost |
|---|---|---|---|
| **Starter (free)** | yes — but only **20 requests a month** | no | $0 |
| **Professional, Dev seat** | yes — 200 a day | no (read-only) | $12/month |
| **Professional, Full seat** | yes — 200 a day, 10 a minute | **yes** | **$16/month** |
| Organization / Enterprise | more | yes (Full seat) | much more — not needed |

- **To have me draw in Figma you need a Full seat on a paid plan** — Figma: *"You need a
  Full seat to write to Figma files with agents."* You also need edit rights on the file
  (you have them on your own copy).
- One "request" is one read — looking at a frame, pulling its variables, a screenshot. A
  single "build this frame" handoff uses several. 20 a month is enough for occasional
  handoffs, not for designing together.
- Nothing forces a year: take Professional for a month when you do a design push, drop
  back to Starter after. Your files stay.
- Reported by third parties, **not** on Figma's page: drawing by agents is free while in
  beta and will become usage-priced later. Figma hasn't published when or how much.
- Starter is enough for **you** to use the kit by hand: unlimited drafts, and the kit
  imports into drafts. Publishing it as a shared library needs a paid plan — for one
  person you don't need that.

### Without Figma at all

It works, and for Bault it's a real option, because the code is the source of truth anyway:

- **I design straight in the product.** You describe what you want (or send a sketch,
  a photo of paper, a screenshot of a site you like); I build it in Bault, screenshot it
  in a real browser, and you look at it live through the tunnel. That's how today's
  landing page was made.
- **I make mockups as web pages.** Two or three directions for a screen as clickable
  HTML you open in the browser, before touching the product. Cheap to throw away.
- **What you lose:** you can't move things around yourself, and the shadcndesign kit is
  a Figma file — without Figma you'd only use it as a reference to look at. If you decide
  on this route, the refund window is open until **3 October 2026**.

**The three skills:**

| Skill | What it does | Example |
|---|---|---|
| `shadcn-design-figma` | Designs screens properly *inside the kit* — assembles them from kit components and Pro Blocks, binds variables, checks modes | `/shadcn-design-figma design the marketplace listing page, Bault style` |
| `shadcn-design-apply-brand` | Turns a brand source into a new style mode (colours, radius, fonts, light + dark) | §4 Way A |
| `shadcn-design-update` | When a new kit version ships, diffs it and migrates your copy | `/shadcn-design-update <link to the new kit release>` |

---

## 6. How to design — by hand

A loop that works for one person:

1. **Start from a block, not a blank frame.** New page in your file (`Marketplace`,
   `Checkout`…). Create a frame at **1440** wide (desktop) and another at **390** (phone).
   Drag in the closest Pro Blocks from the assets panel.
2. **Switch the frame to Style: Bault.** It's now in Bault's colours, fonts and corners.
3. **Cut, don't add.** Delete what Bault doesn't need. Replace sample text with real
   Bault wording (short — see the landing page). Replace stock images with **real card
   photographs** from `assets/images/` — never invented items.
4. **Use components, never detached copies.** If you need something new, build it with
   auto layout and the kit's variables, never hand-typed colours or sizes.
5. **Check dark mode:** set the frame's *Mode* to Dark.
6. **Make the Hebrew version:** duplicate the frame, set text direction right-to-left, and
   mirror the layout (navigation on the right, numbers and serials stay left-to-right).
   Not every screen — the ones customers see first.
7. **Name frames clearly** (`Marketplace / Listing / Desktop / EN`) and leave comments on
   anything that behaves (hover, empty state, error).
8. **Hand it to me:** right-click the frame → *Copy link to selection* → paste it to me
   with one sentence: *"Build this into Bault."*

**Before you hand off, check:** only kit components · Style = Bault · a phone frame exists ·
dark mode looks right · real photos · no card-in-card or KPI tiles · Hebrew frame for
customer screens.

---

## 7. How to design — with me

Once §5 is done, these are the requests that work well. You stay the designer: I propose,
you judge in Figma, we iterate.

**Explore options**
> `/shadcn-design-figma` Design three directions for the house store page on a new page
> called "Store — options". Use Pro Blocks from E-commerce, Style: Bault. Real Rayquaza
> photos only.

**Fill in the boring parts**
> Take my "Checkout / Desktop / EN" frame and make the phone version, the dark version, and
> the Hebrew version next to it.

**Review**
> Review the frames on the "Marketplace" page against DESIGN.md and list every rule
> they break.

**Build it in the real product** — the step that matters
> Build this frame into Bault: <Figma link>

What I do then: read the frame through Figma, map each part to Bault's **existing**
components and `index.css` tokens (not shadcn, not Tailwind — Bault has neither), write
the React, add tests, run design-lint and the suites, check it in a browser in both
languages, and write it into DIVE1. If the design needs a token Bault doesn't have yet, I
add it to `index.css` and tell you — `index.css` stays the single source of truth; nothing
is copy-pasted from a Figma export.

**Keep Figma and code in step**
> Compare the Bault style mode in Figma with the tokens in index.css and list anything
> that drifted.

**When a kit update arrives**
> `/shadcn-design-update <link to the new release>`

---

## 7½. How to ask me for a design

See [`04-figma-kits.md`](04-figma-kits.md) — the combined look, putting a design in yourself, and designing with me from screenshots.

---

## 8. The licence in one minute

- **You** can edit the kit — one person. Don't share **edit** access.
- Anyone (a developer, a friend) can get **view** access to your designs via Figma's
  share button to inspect them. That's allowed.
- Unlimited commercial projects, lifetime updates, one-time payment.
- Don't resell or redistribute the kit file itself.
- If a second person needs to *edit*, that's a **Team** licence.

---

## 9. Quick-start checklist

- [ ] Receipt checked — plan is **Plus** (or note what it is)
- [ ] Signed in at `polar.sh/shadcndesign/portal` with the purchase email
- [ ] Kit duplicated into Figma, renamed **Bault — Design System**
- [ ] Extra icon libraries deleted, **Lucide** kept
- [ ] Fonts installed: IBM Plex Sans, IBM Plex Sans Hebrew, IBM Plex Mono, Frank Ruhl Libre
- [ ] Figma connected to Claude Code (`claude mcp add … figma`, then `/mcp` → Authenticate)
- [ ] Agent Skills ZIP unzipped into `C:\Users\User\.claude\skills\`, Claude Code restarted
- [ ] **Bault** style mode created (with me or by hand) and checked on a few blocks
- [ ] First screen designed from Pro Blocks, handed to me as a link
- [ ] Decide by **3 October 2026** if you want a refund (you probably won't)

---

## Sources

- [Pricing — what each plan includes, portal, updates, refunds](https://www.shadcndesign.com/pricing)
- [Help & FAQ — portal sign-in, sharing, licences, support](https://www.shadcndesign.com/help)
- [Docs — getting started](https://www.shadcndesign.com/docs)
- [Docs — the 8 styles](https://www.shadcndesign.com/docs/styles)
- [Docs — variables and how to rebrand](https://www.shadcndesign.com/docs/variables)
- [Docs — Agent Skills: install folders and the three design skills](https://www.shadcndesign.com/docs/agent-skills)
- [Blog — using the kit as a design system for Claude Design](https://www.shadcndesign.com/blog/use-shadcn-ui-figma-kit-as-design-system-for-claude-design)
- [Figma — connecting the Figma MCP server to Claude Code](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Figma — MCP rate limits and access by plan and seat](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)
- [Figma — write to canvas (Full seat required)](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)
- [Figma — pricing](https://www.figma.com/pricing/)
- [Licensing](https://www.shadcndesign.com/licensing)

*Related in this repo: `DESIGN.md` (the rules), `docs/design/04-figma-kits.md` (how we design
with the kit), `apps/web/src/index.css` (the real tokens).*
