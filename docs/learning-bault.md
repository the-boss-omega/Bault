# Learning the Bault codebase from DIVE1 — the fast path

DIVE1 is **~22,000 lines / ~180,000 words** across 42 parts. Read front to back
at 220 wpm that is **about 14 hours**, and more than half of it (Parts 1–8, ~99k
words) describes scaffolding the code now explains faster than the prose does.

This is the short path. **Three tiers; stop at whichever one covers what you
need.**

> **Want the long path instead?** `docs/learning-bault-plan.pdf` is the same
> material as a ten-day, ~24-hour curriculum: a day at a time, each with its
> reading, the files to open beside it, an exercise you can only finish if you
> understood the reading, and a self-test question. Use this page to get moving
> today; use the PDF if you are working through the whole codebase deliberately.

| Tier | Time | Afterwards you can |
|---|---|---|
| **1. The spine** | 1 hour | Reason correctly about any part of the system |
| **2. Working knowledge** | +3 hours | Change code in any module without breaking an invariant |
| **3. The whole thing** | +8 hours | Answer why any specific decision was made |

Two rules make every tier faster:

1. **Read backwards.** Later parts say what replaced earlier decisions. Reading
   forwards means spending hours on bin `capacity`, `BIN-A-001` naming,
   two-tab receiving and quantity-based intake, all of which were deleted.
   DIVE1 says so itself: *later parts win*.
2. **Navigate by heading, never by line number.** DIVE1 grows with every change,
   so line numbers go stale within a day. Every part starts with `# Part N — `,
   and every section inside a part is a `## ` heading:

   ```bash
   grep -n "^# Part" DIVE1.md                               # the 42 parts and where they start
   awk '/^# Part 24 /,/^# Part 25 /' DIVE1.md | grep "^## "   # one part's sections
   ```

   In an editor, search for `# Part 24 ` (including the trailing space, so
   Part 2 doesn't match Part 24).

> `docs/dive1/part1.md` … `part8.md` are earlier split copies of Parts 1–8.
> `DIVE1.md` is the current one; read that.

---

## Tier 1 — the spine (1 hour)

### 1. The thesis · 5 min · the opening paragraphs, above "How this document is organized"

Everything else follows from one sentence:

> the **database, not the shelf, is the authority** on who owns each item, where
> it is, and what money is owed

The same paragraph lists the six invariants: records are never deleted; there is
exactly one owner at all times; every change leaves an immutable custody trail;
the ledger is append-only; a balance is always the sum of its ledger rows; every
state-changing action is audited. Several of these are **database triggers**, so
no application bug can break them.

### 2. The map · 15 min · "How this document is organized"

A sentence or two on each of the 41 parts. It gives you more per minute than any
other part of the document. You're building an index here, not learning the
content.

### 3. Where it stands now · 25 min · Parts 41 → 39, backwards

- **Part 41** (8 min): the Bault store, and a choosable shipping box. It is the
  clearest recent example of the system's central move: create the ownership
  record in the same transaction as the money.
- **Part 40** (3 min): the last fake adapter replaced (EasyPost).
- **Part 39** (8 min): the production-readiness pass, including an explicit
  list of what was left undone.

Together these tell you what is real, what is simulated, and why.

### 4. Intake in one sitting · 15 min · `docs/design/03-intake.md`

This covers the whole intake path in the order the work happens. It condenses
Parts 4, 14, 15, 24, 32, 34, 36 and 37, so reading it first turns those parts
into confirmation rather than discovery.

**Stop here if you only need to talk about the system.**

---

## Tier 2 — working knowledge (3 more hours)

### 5. Part 4, Custody, Intake & Vault · 50 min · read every word

This is the heart of the system: the custody kernel, the lifecycle state
machine, why an item always has an owner, and why nothing is ever deleted. If
you read one part in full, make it this one. Keep `apps/api/src/modules/cst/`
open alongside it.

### 6. Parts 3 and 5 at section level · 50 min

Skim the `##` headings. Stop only where a heading names something you couldn't
have predicted.

- **Part 3**: money in integer minor units, tokens, errors, idempotency, RBAC,
  sessions.
- **Part 5**: effective-dated pricing, the **derived** ledger balance, the
  atomic purchase.

### 7. The two big later parts · 45 min

- **Part 24, Stow It Wherever It Fits** (30 min): directed stow, bin serials,
  facilities. Shelving works the way this part describes.
- **Part 20, Outbound Shipping Stops Being a Shape** (17 min): quote before
  commit, and why the quoted price must equal the charged price.

### 8. Backward skim, Part 38 → Part 25 · 35 min

Read the first and last section of each part, about 2–3 minutes apiece. Each part
opens with what was broken and closes with what fixing it cost. **Don't go below
Part 25 here**; the value drops off sharply.

**Stop here if you're going to work on the code.**

---

## Tier 3 — the whole thing (8 more hours)

Only needed if you have to answer *why* for any decision in the system.

- **Parts 23 → 9, backwards, in full**, about 4 hours. These are the passes that
  turned a working API into a product. Part 12 (44 min) is the long one.
- **Part 6** (services, shipping, notifications, admin): 45 min.
- **Parts 1, 2, 7, 8**: about 4 hours. **Read them last, or not at all.** They
  cover monorepo setup, API bootstrap and the React shell. Wherever a later
  part disagrees, the later part wins, and the code explains the rest faster.

---

## By goal: the parts for the job in front of you

Once you have Tier 1, go straight to the row that matches your task and read
those parts **newest first**.

| You are working on | Read | Then open |
|---|---|---|
| Intake, receiving, shelves | 41, 37, 36, 34, 32, 24, 15, 14, 4 | `inv/intake.service.ts`, `cst/stow.service.ts` |
| Marketplace, the Bault store | 41, 31, 30, 22, 18, 5 | `mkt/purchase.service.ts`, `mkt/house-store.service.ts` |
| Money, wallet, fees | 30, 23, 16, 13, 5, 3 | `pay/ledger.service.ts`, `prc/` |
| Outbound shipping | 41, 40, 20, 6 (SHP) | `shp/shipment.service.ts`, `shp/carriers.ts`, `shp/boxes.ts` |
| Services (grading, cracking, splitting) | 33, 19, 6 (DIS) | `dis/service.service.ts` |
| Screens and design system | 42, 31, 29, 28, 12, 8 | `DESIGN.md`, `apps/web/src/index.css` |
| The public / marketing surface | 42, 29 | `areas/customer/marketing/LandingPage.tsx` |
| Auth, security, perimeter | 39, 27, 26, 17, 13, 3 | `acc/`, `sec/` |
| Notifications | 21, 6 (NOT) | `not/event-types.ts`, `apps/worker/src/jobs/` |
| Hebrew/English, copy | 40, 33, 10 | `apps/web/src/shared/i18n.tsx` |

---

## The shortcut that isn't in DIVE1

**The code carries the same reasoning at the point where each rule is
enforced.** These files are the short version of what DIVE1 says at length,
and they can't drift, because each sits next to the rule it explains:

```
apps/api/src/db/sql/0001_append_only.sql        the invariants, as triggers
apps/api/src/modules/cst/lifecycle.ts           every legal state change, in 30 lines
apps/api/src/modules/cst/custody.service.ts     the only code allowed to move an item
apps/api/src/modules/cst/stow.service.ts        why there is no bin capacity
apps/api/src/modules/inv/item-classes.ts        the taxonomy, and the lot rule
apps/api/src/modules/inv/parcel.schema.ts       why a parcel is not an item
apps/api/src/modules/mkt/house-store.service.ts when an item comes into existence
apps/api/src/db/migrations/*.sql                each one opens with why it exists
```

The integration tests are the third source. Their names are sentences
(`tests/integration/*.test.ts`, e.g. *"charges the boxed price it quoted,
because the box is stored on the request"*), and reading only the `it(...)`
lines of a file tells you what that module promises:

```bash
grep -h "^\s*it('" tests/integration/shp-outbound.test.ts
```

When a part of DIVE1 gets tedious, open the file it describes instead.

---

## Self-test

You have the spine when you can answer these cold. Each one maps to a part, so a
blank tells you exactly where to go back to.

1. Why is there **no bin capacity**? (Part 24)
2. Why is a serial **minted, never typed**? (Parts 9, 24)
3. Why does closing an **empty parcel** refuse by default? (Parts 24, 38)
4. Why is `type_class` a **closed vocabulary**? (Part 14)
5. Why is a wallet balance **never stored**? (Part 5)
6. What is the difference between a **parcel** and an **item**? (Part 15)
7. Which adapters are **real** and which are **simulated** right now? (Parts 39–40)
8. When a card is bought from the **Bault store**, when does its item record come
   into existence, and why then? (Part 41)
9. Why is a chosen shipping **box stored on the shipment** rather than only
   used in the quote? (Parts 20, 41)

Get 1–5 right and the rest of the document reads at roughly double speed,
because you stop re-deriving the same principles in each new context.

---

## What to skip, stated plainly

- **Parts 1, 2, 7, 8**, unless you're changing the build system or the React
  shell. They are 55% of the document and the least current part of it.
- **Any part describing a screen you aren't working on.** The UX parts (12, 28,
  29, 30, 31) are excellent, but they are reference, not spine.
- **Reading anything forwards.** It is the biggest single waste of time available
  here.
