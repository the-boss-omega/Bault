# Demo — one parcel, end to end

Everything you need to show the whole intake process live: the collector side,
the warehouse side, and the card landing in the vault with its real photograph.

**The inbound parcel queue has been cleared.** There are 0 parcels in the
database right now, so the bench starts empty and the box you register on camera
is the only one on it.

---

## The demo package

These are the values to type. Nothing is pre-created — you do the whole thing on
camera, which is the point.

| | |
|---|---|
| **Collector** | `red` — Red Ashwood |
| **Sent to** | Bault New Jersey (**NJ**) |
| **Carrier** | `FedEx` |
| **Tracking number** | `789412650037` |
| **What should be inside** | `One Rayquaza VMAX alternate art from a private sale, top-loader in a bubble mailer.` |
| **Shipped from outside the US** | no |

### The card in the box

| | |
|---|---|
| **Serial to type** | `SN-EVS218-0010` |
| **Class** | Trading card |
| **Description** | `2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX (Alternate Art secret) #218/203 · Rare Rainbow · art by Anesaki Dynamic · swsh7-218` |
| **Condition** | `Raw` |

> **Why this serial matters.** Card photographs live in `assets/images`, one file
> per item named by its serial. `SN-EVS218-0010.png` is already on disk, and its
> card is **deliberately left out of the seed** so the intake flow can be shown
> against a real item. Type that serial at the bench and the genuine Rayquaza
> VMAX alt-art photograph appears in Red's vault the moment you book it in.
>
> It is the only free serial with a photo — the other nine are already seeded.
> **Type it exactly.** Leave the serial blank and the system mints one, which is
> correct behaviour but shows the generated placeholder instead of the card.

### A label for the box

[`demo/parcel-label.svg`](demo/parcel-label.svg) — a 4x6in shipping label for
this exact parcel: FedEx, tracking `789412650037`, addressed to `@red` at Bault
New Jersey. Open it in a browser and print it, then tape it to any small box.

The barcode is encoded with the product's own Code 128 renderer, so it is a real
symbol: a scanner reads it back as `789412650037`, which means you can **scan the
box into the tracking field** on camera instead of typing it.

### Accounts

All passwords are `11111111`.

| Role | Email |
|---|---|
| Collector | `red@bault.dev` |
| Operator | `hermon@bault.dev` |

---

## Before you start

```
pnpm dev
```

Open **http://localhost:5173** in a fresh window.

**⚠ The app opens in Hebrew, right-to-left.** Click the **globe icon** in the
top-right of the header (it reads `HE`) → **English**. Do this first; it is the
most common way a take is lost.

Window at **1440×900**, zoom 100%.

> **Do not run `pnpm db:reset`.** It would put the three old parcels back. If you
> do reset, clear them again with the script at the bottom of this page.

---

## Part 1 — The collector says a box is coming

Sign in as **`red@bault.dev`** / `11111111`.

1. Click **Inbound** in the left rail — second item, under Vault.
2. Top panel: **Tell us a parcel is coming**.
3. Fill in:

| Field | Value |
|---|---|
| **Sent to** | Bault New Jersey |
| **Carrier** | `FedEx` |
| **Tracking number** | `789412650037` |
| **What should be inside** | `One Rayquaza VMAX alternate art from a private sale, top-loader in a bubble mailer.` |
| **Shipped from outside the US** | leave unchecked |

4. Click **Register parcel**.

A green note appears — *"Registered parcel PKG-XXXXXXXX"* — and the parcel shows
in Red's list below, status **On its way**.

**Note the `PKG-` code that comes back.** It is minted fresh, so it differs every
run. You will see the same code on the warehouse side in a moment; that is the
point of Part 2.

> **Say:** "Registering is optional — a box that turns up unannounced is received
> exactly the same way. What it buys is that Red can watch it, and that the
> operator receiving it has a tracking number to match against. That's what turns
> a mystery box into somebody's property before anyone opens it."

---

## Part 2 — It arrives at the dock

Sign out. Sign in as **`hermon@bault.dev`** / `11111111`.

You land on the **Warehouse** console. Click the **Receiving** tab.

The top panel is **Receive an arrival**:

| Field | Value |
|---|---|
| **Facility** | Bault New Jersey |
| **Username on the parcel** | `red` |
| **Carrier** | `FedEx` |
| **Tracking number** | `789412650037` |
| **Notes** | `Signed for at the NJ dock. Outer carton sound, tape intact.` |

**Notes is the last field, under the "Shipped from outside the US" checkbox, and
it is easy to scroll past.** It is optional — the form submits without it — but
fill it in: it is the operator's own account of how the box turned up, it lands
on the parcel's permanent trail, and it is the only free text on this form. If
you leave it blank nothing breaks; the trail just says less.

Click **Receive parcel** → *"Arrival recorded"*.

Look at **Inbound parcels** below: **one row**, carrying the same `PKG-` code Red
saw, now status **Received**.

> **Say:** "Same tracking number Red registered — so instead of creating a second
> parcel, the system adopted the one that already existed. A second row would
> leave Red watching a box that never moves.
>
> And the username is typed exactly as written on the label. If it resolves to an
> account, the parcel belongs to that account. If it doesn't, the box is held as
> *unclaimed* and the label kept verbatim. The system will not guess whose
> property it is."

---

## Part 3 — Open and check

On the parcel's row, click **Open and check**. The row expands in place.

| Field | Value |
|---|---|
| **Condition** | Sound *(the default — leave it)* |
| **What you found** | `Carton sound, tape intact. One card in a top-loader inside a bubble mailer, sleeve unbroken.` |

Click **Open and check** — the gold button inside the expanded form.

Status flips to **Opened**, and the action becomes **Book contents** with
*"Nothing has come out of this parcel yet."* underneath.

> **Say:** "The finding is required before the lid comes off, and 'Sound' is a
> positive statement that somebody looked — not a default that means nobody did.
> It's timestamped before a single item record exists, so if there's a damage
> claim six weeks later, the evidence predates the contents."

---

## Part 4 — Book the card in

Click **Book contents**. The page scrolls down to the **Receive bench**.

**Point at the top row before typing anything:**

| Field | What it shows |
|---|---|
| **From parcel** | `PKG-XXXXXXXX — red` |
| **Owner username** | `red`, **greyed out and locked** |
| **Where it goes** | *Auto — wherever there is room* |
| **Stow to** | **`BIN-N4SPYC6G`** — *"Zone A · 1 items on it now"* |

*(The shelf serial is minted per seed. `BIN-N4SPYC6G` is what is in your database
right now — it is the emptiest standard shelf, holding 1 item. If you reset, read
whatever the screen says instead.)*

> **Say:** "Choosing the box locked the owner. The API refuses items booked into
> somebody else's parcel, and it's better to make that impossible to type than to
> explain it in an error afterwards.
>
> And nobody picked a shelf. The system sent us to the emptiest suitable shelf in
> the building the box is physically in, and says how many things are on it.
> There is no capacity number anywhere in this product — the person who knows
> whether a shelf has room is the person standing in front of it."

Now fill in unit **1**:

| Field | Value |
|---|---|
| **Type / class** | Trading card |
| **Description** | `2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX (Alternate Art secret) #218/203 · Rare Rainbow · art by Anesaki Dynamic · swsh7-218` |
| **Condition** | `Raw` |
| **Serial number (optional)** | `SN-EVS218-0010` |

Click **Intake**.

Everything at once:

- The unit row clears.
- **Stow to** re-queries — the shelf is one item fuller.
- *"Parcel PKG-XXXXXXXX — 1 booked in so far."* appears.
- A **Log** panel at the bottom: *"Intook 1 items"*.
- **Labels for what you just booked in** appears with the Code 128 barcode.

> **Say:** "One button, and inside a single transaction that created the item
> under Red's ownership, wrote its first custody event, wrote the first row in
> the shelving ledger, charged the intake fee against a snapshot of the price
> that was in force, and queued the notification to Red. If any one of those had
> failed, none of them happened."

---

## Part 5 — The label

Point at the barcode block. It carries `SN-EVS218-0010`, with the serial printed
underneath the bars.

Click **Print all 1 labels** → the print dialog opens with the label on its own
page → press **Esc**.

> **Say:** "The serial is printed under the bars because that's what an operator
> reads out when the scanner won't read. And the barcode *is* the serial — one
> string on the label, so there's no second identifier that can ever disagree
> with it. Every later scan reads this one: the shelf scan, the pick, the
> dispatch."

---

## Part 6 — Close the box out

Scroll to *"Parcel PKG-XXXXXXXX — 1 booked in so far."* and click
**Close out parcel**.

The row flips to **Processed** with no actions left, and the bench's
**From parcel** dropdown resets.

> **Say:** "That's the only point the per-package fee is charged, and it can't
> happen twice — 'Processed' has no outgoing transitions, so a second call can't
> reach the code that bills it. And it refuses to close a box that produced
> nothing unless somebody writes down why it was empty."

---

## Part 7 — Red's vault

Sign out. Sign in as **`red@bault.dev`** / `11111111`.

You land on **Vault**. **The Rayquaza VMAX is there, with its real photograph.**

Click it: the detail panel shows the serial, the class, the full catalogue line
you typed, the storage terms, and the custody trail.

Then click **Inbound** in the rail — the parcel Red registered at the start now
reads **Processed**, with the item it produced listed against it.

> **Closing line:** "Red said a box was coming. It arrived, it was checked, it
> was opened, the card was booked onto a shelf and labelled, and the box was
> closed out. Red sees the card, its photograph, what it cost and where it is —
> with an append-only trail behind every step that nothing in the system can
> delete."

---

## Optional — showing more than one card

The bench books a whole box at once. To show that, click **Another unit** before
submitting in Part 4 and add:

| Field | Value |
|---|---|
| **Type / class** | Trading card |
| **Description** | `2021 Pokémon SWSH Evolving Skies — Rayquaza V (Alternate Full Art) #194/203 · Rare Ultra · art by Ryuta Fuse · swsh7-194` |
| **Condition** | `Raw` |
| **Serial number** | **leave blank** |

The gold button changes to **Book in 2 units**.

**Know this before you shoot it:** the second card shows the **generated
placeholder** in the vault, not a photograph. Its real serial `SN-EVS194-0009` is
already taken by a seeded item, so it cannot be reused, and a minted serial has
no file on disk. Only `SN-EVS218-0010` gives you a real picture.

If the photograph matters more than the multi-unit story, keep it to one card.

---

## Two more beats worth having

**The oversized shelf.** In Part 4, change **Type / class** to **Sealed case**.
A hint appears — *"Oversized — needs prior approval and unusual shelf space"* —
and **Stow to** switches to one of the two zone-**O** shelves
(`BIN-42YZAGZZ` or `BIN-J35PWYUY`, both empty). Change it back to Trading card.

> "Oversized goods only go to oversized shelving — and just as importantly,
> ordinary cards are kept off it. That shelving is the scarce kind."

**The empty-box refusal.** In Part 6, click **Close out parcel** *before* booking
anything in. A **Why is it empty** field appears and the button stays disabled
until you write a reason.

> "Closing an empty box used to be one click, and it charged the collector a
> processing fee for unpacking nothing."

---

## Troubleshooting mid-take

| Symptom | Fix |
|---|---|
| Interface is Hebrew / right-to-left | Globe icon in the header → **English** |
| No parcel in the bench's **From parcel** dropdown | The box must be **Opened**, not Received — do Part 3 |
| **Owner username** editable and blank | Pick the parcel in **From parcel** so it locks |
| Gold **Intake** button disabled | The description is empty |
| *"Tracking number … is already registered"* | You registered twice. Use `789412650038`, or clear parcels (below) |
| No photo in Red's vault | The serial was not `SN-EVS218-0010`, exactly |
| *"Item serial already exists"* | `SN-EVS218-0010` has been used already — needs a full reset to free it |
| Page looks like a phone | Window narrower than ~1100px |

---

## Resetting between takes

`pnpm db:reset` restores the whole seed **including the three old parcels**. To
get back to the clean state you have now:

```bash
cat > /tmp/clear-parcels.ts <<'EOF'
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';
async function main() {
  const pool = new Pool({ connectionString: loadEnv().DIRECT_DATABASE_URL });
  await pool.query(`update item set source_parcel_id = null where source_parcel_id is not null`);
  await pool.query(`truncate table parcel_photo, parcel_event, parcel restart identity cascade`);
  console.log('parcels cleared');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
EOF
pnpm db:reset
cd apps/api && npx tsx /tmp/clear-parcels.ts
```

`TRUNCATE` rather than `DELETE` because `parcel_event` is append-only — row
triggers reject a delete and truncate bypasses them, which is the same mechanism
the seed's own reset uses.

A full reset is the only way to free `SN-EVS218-0010` once you have booked it in,
because item serials are unique. For a quick second take without a reset, use a
different tracking number and leave the card's serial blank — you lose the
photograph but everything else works.

---

Full mechanics behind every step: [`docs/design/03-intake.md`](design/03-intake.md).
