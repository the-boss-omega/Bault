# Feature Specification: Collectibles Vaulting & Marketplace Platform

**Feature Branch**: `001-collectibles-vault-marketplace`

**Created**: 2026-07-14

**Status**: Draft

**Input**: User description: "A vaulting and marketplace platform for physical collectibles. Customers ship collectibles to a professionally operated warehouse where each item is received, documented, barcoded, photographed, and stored; from that point on the owner manages the item entirely digitally — viewing, selling, swapping, gifting, enriching with services, or requesting it shipped home. Ownership can change hands any number of times without the item ever leaving its shelf. Operated by three human roles (customer, warehouse operator, administrator) plus automated system processes, spanning six domains: identity and account lifecycle, intake and chain of custody, a marketplace transaction engine, value-added services and outbound shipping, payments and pricing, and administration/security/operations."

## Overview

The platform lets collectors store physical collectibles in a professionally operated
warehouse and then own, trade, and enrich those items entirely digitally. Once an item is
received and documented, ownership can change hands any number of times — through sale,
swap, or gift — without the physical item ever leaving its shelf. The platform is the sole
system of record for who owns each item, where it is, and what money is owed. Every item
record is permanent and single-owner; every history stream (custody, transactions, ledger,
audit) is append-only; and every billable action is charged automatically from one central
pricing table.

Actors: **Customer** (item owner), **Warehouse Operator** (physical handling and
documentation), **Administrator** (platform governance, pricing, disputes, support), and
**System** (automated processes: billing, notifications, custody logging, backups, alerts).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register and Access an Account (Priority: P1)

A collector registers with email and password, verifies their email, signs in to a secure
session, and manages their credentials and profile. This is the entry point to every other
capability and gates access to the vault.

**Why this priority**: No item can be owned, viewed, or traded without an identity. Account
lifecycle is the prerequisite foundation for the entire platform.

**Independent Test**: Register a new email, receive and click the verification link, sign
in, change the password, sign out, and confirm the session token is revoked — all without
any item or marketplace functionality present.

**Acceptance Scenarios**:

1. **Given** a new email and password, **When** the customer registers, **Then** the
   account is created in `pending-verification` status, is assigned a unique intake ID, and
   a verification email is sent.
2. **Given** a valid, unexpired verification link, **When** the customer clicks it, **Then**
   the account becomes `active` and the customer can sign in.
3. **Given** an expired verification link, **When** the customer clicks it, **Then** access
   is refused and the customer can request a new verification email.
4. **Given** an `active` account, **When** the customer signs in with correct credentials,
   **Then** a secure session with a token and expiry is opened.
5. **Given** a signed-in session, **When** the customer signs out, **Then** the session
   token is revoked and can no longer be used.
6. **Given** a forgotten password, **When** the customer requests a reset and clicks the
   one-time, time-limited emailed link, **Then** they can set a new password once and the
   link cannot be reused.
7. **Given** a signed-in customer, **When** they supply their current and a new password,
   **Then** the password changes immediately.
8. **Given** a `suspended` or `closed` account, **When** the user attempts to sign in or
   perform any action, **Then** the action is blocked.

---

### User Story 2 - Intake, Document, and View a Vaulted Item (Priority: P1)

A customer ships a collectible to the warehouse. An operator receives the package (routed by
the customer's intake ID), creates an item record with serial number and barcode, takes an
intake photo, assigns it to the single owner and a bin, records the first custody event, and
bills the intake fee. The customer then sees the item in their personal vault.

**Why this priority**: Vaulting is the core value proposition and the precondition for all
trading and services. Without items in the vault, no marketplace exists.

**Independent Test**: Route a package by intake ID, create and document an item, assign it to
an owner and bin, and confirm it appears in that customer's vault with a full item card,
images, condition, and a custody event — while an intake charge is recorded.

**Acceptance Scenarios**:

1. **Given** an inbound package labeled with a customer's intake ID, **When** the operator
   processes it, **Then** the package is routed to that owner; if it is a batch-type arrival,
   a batch linked to that owner is opened.
2. **Given** a received item, **When** the operator creates the item record, **Then** it
   captures type/class, description, condition/grade, an initial photo, serial number, and
   barcode; is assigned to exactly one owner and a bin; and its first custody event is
   recorded automatically.
3. **Given** item creation completes, **When** the intake is finalized, **Then** an intake
   charge is generated automatically per the pricing table in force.
4. **Given** a documented item, **When** the operator corrects a field, **Then** the change
   is applied and preserved in a full change history recording who changed what and when.
5. **Given** an item in a bin, **When** the operator scans the item and a destination bin,
   **Then** the item's location updates and a custody event is logged automatically.
6. **Given** a batch, **When** the operator splits it at the owner's request, **Then** each
   resulting item is individually tracked with its own custody event.
7. **Given** items in storage, **When** the customer opens their vault, **Then** they see
   every item they currently own with a full item card (details, images, condition, history)
   and can search and filter their portfolio by type, condition, and other attributes.

---

### User Story 3 - List and Sell an Item on the Marketplace (Priority: P1)

An owner lists a stored item at an asking price. A buyer purchases it in one atomic
transaction: the item is locked, the buyer is charged, the seller is credited net of the
marketplace fee, ownership transfers, and an irreversible record is written. The item never
physically moves.

**Why this priority**: The marketplace transaction engine is the platform's primary
differentiator — trading ownership without physical movement — and drives revenue via fees.

**Independent Test**: List an owned, unheld item; have a second user buy it; confirm the
buyer is charged, the seller credited net of fee, ownership transferred, and an irreversible
transaction plus custody event recorded — with no physical movement.

**Acceptance Scenarios**:

1. **Given** an owned, unheld, stored item, **When** the owner lists it at an asking price,
   **Then** an active listing is created.
2. **Given** an item under hold, **When** the owner attempts to list it, **Then** listing is
   blocked.
3. **Given** an active listing, **When** any user browses/searches/filters, **Then** they can
   view listing details including images, condition, and price.
4. **Given** an active listing not yet sold, **When** the seller repriced or removes it,
   **Then** the change takes effect before sale; removal requires explicit confirmation.
5. **Given** an active listing, **When** a buyer purchases it, **Then** a single atomic
   transaction locks the item, charges the buyer, credits the seller net of the marketplace
   fee, transfers ownership, and writes an irreversible transaction record with frozen prices.
6. **Given** two concurrent purchase attempts on the same item, **When** they execute,
   **Then** the item lock ensures only one succeeds.
7. **Given** a user's own listing, **When** they attempt to buy it, **Then** the purchase is
   blocked (no self-dealing).

---

### User Story 4 - Wallet, Ledger, and Automatic Billing (Priority: P1)

Money flows through a wallet whose balance is always the sum of immutable ledger records. A
user loads credits via an external payment provider and can withdraw a balance to an external
account after explicit confirmation. Every billable action generates a charge automatically
from the pricing table in force at that moment.

**Why this priority**: Trading, intake, services, and shipping all depend on charging and
crediting. The ledger is the single source of monetary truth for the whole platform.

**Independent Test**: Load wallet credits, incur an automatic charge for a billable action,
withdraw a balance after confirmation, and verify the wallet balance always equals the sum of
its ledger records and the full ledger is auditable.

**Acceptance Scenarios**:

1. **Given** a user, **When** they load the wallet, **Then** the credit is charged through
   the external payment provider and recorded as an immutable ledger record.
2. **Given** a credit balance, **When** the user withdraws to an external account, **Then**
   an explicit confirmation step precedes execution, the transfer runs, and a ledger record
   is written.
3. **Given** any billable action (intake, storage, service, shipping, purchase), **When** it
   executes, **Then** a charge is generated automatically per the pricing table in force at
   that moment, paid from credit balance or an external means.
4. **Given** any monetary movement, **When** it occurs, **Then** it is written as an
   immutable ledger record and the user's balance equals the sum of their ledger records.
5. **Given** a negative balance, **When** the user requests defined services, **Then** those
   services are blocked and interest accrues until the balance is settled.
6. **Given** the ledger, **When** it is reviewed, **Then** every entry is auditable and
   traceable to its originating action.

---

### User Story 5 - Offers and Negotiation (Priority: P2)

A buyer submits an offer below the asking price. The seller accepts (triggering a purchase at
the offer price), rejects, or counters, with the buyer notified of each response and offers
chained as a negotiation.

**Why this priority**: Negotiation increases marketplace liquidity and conversion but is not
required for the platform to transact; it builds on the direct-sale engine.

**Independent Test**: Submit an offer on another user's listing, have the seller counter,
accept the counter, and confirm a purchase executes at the agreed price with the buyer
notified at each step.

**Acceptance Scenarios**:

1. **Given** an active listing that is not the buyer's own, **When** the buyer submits an
   offer, **Then** the offer is recorded as `pending` and the seller is notified.
2. **Given** a pending offer, **When** the seller accepts, **Then** a purchase executes at
   the offer price (same atomic guarantees as direct sale).
3. **Given** a pending offer, **When** the seller rejects or counters, **Then** the status
   updates accordingly, a counter chains to its parent offer, and the buyer is emailed.
4. **Given** the buyer's own listing, **When** they attempt to submit an offer, **Then** it
   is blocked.

---

### User Story 6 - Swaps and Gift Transfers (Priority: P2)

Two users swap stored items with dual consent, executing mutual ownership transfers. An owner
also gifts an item to another user for no consideration, requiring the recipient's approval.

**Why this priority**: Extends trading beyond monetary sale; requires the dual-consent and
irreversible-recording machinery already established for sales.

**Independent Test**: Propose a swap between two owners, have both consent, and confirm mutual
ownership transfer and irreversible recording; separately, transfer an item as a gift and
confirm it only completes upon recipient approval.

**Acceptance Scenarios**:

1. **Given** two owners with stored, unheld items, **When** a swap is proposed and both
   parties consent, **Then** mutual ownership transfers execute and are recorded irreversibly.
2. **Given** a swap where one party has not consented, **When** execution is attempted,
   **Then** it does not proceed.
3. **Given** an owner gifting a stored item, **When** the recipient explicitly approves,
   **Then** ownership transfers with no consideration and is recorded like any other
   ownership change.
4. **Given** a gift transfer, **When** the recipient has not approved, **Then** ownership
   does not change.
5. **Given** a purchase, swap, or transfer, **When** it completes, **Then** the corresponding
   billable charge is generated automatically.

---

### User Story 7 - Value-Added Services (Priority: P2)

Owners order services on stored items: professional photography (new image version), third-
party grading (e.g., PSA) with status tracking and returned grades, donation (removes
ownership after confirmation), and consignment sale via an external channel (e.g., eBay or an
event) crediting the owner net of fees. Each service is billable.

**Why this priority**: Services increase item value and platform revenue but are optional
enrichments layered on the core vault and billing.

**Independent Test**: Order professional photography and confirm a new image version is added
and charged; submit an item for grading, track status, and record the returned grade; donate
an item after confirmation and verify ownership is removed with a final record.

**Acceptance Scenarios**:

1. **Given** a stored item, **When** the owner orders professional photography, **Then** it is
   charged per the price list and resulting photos are uploaded as a new image version.
2. **Given** eligible items, **When** the owner submits a third-party grading request, **Then**
   the items are sent to the grading body, status is tracked, and returned grades are recorded.
3. **Given** a stored item, **When** the owner donates it after explicit confirmation, **Then**
   it is removed from their ownership with a final record of the action.
4. **Given** a stored item, **When** the owner requests consignment sale on an external
   channel, **Then** the sale is managed externally and, on completion, the owner is credited
   net of fees and the action is fully recorded.
5. **Given** any value-added service, **When** it executes, **Then** it generates a charge
   automatically per the pricing table.

---

### User Story 8 - Outbound Shipping (Priority: P2)

A user or operator selects items and a destination, creates an outbound shipment, chooses a
carrier and service level with cost calculation via an external rate provider (e.g.,
ShipStation or Easyship), optionally flags rush handling, and the operator picks, packs,
labels, and ships — moving item lifecycle state to `shipped` with custody events. The user
tracks the shipment.

**Why this priority**: Enables physical exit from the vault; important but downstream of
owning and trading items.

**Independent Test**: Create a shipment for one or more items, pick a carrier/service with
calculated cost, mark rush, have the operator label and ship, and confirm items move to
`shipped` with custody events and a trackable tracking number, with shipping charges applied.

**Acceptance Scenarios**:

1. **Given** one or more items and a destination address, **When** a user or operator creates
   an outbound shipment request, **Then** available carriers and service levels are presented
   with calculated cost via the external rate provider.
2. **Given** a shipment, **When** the user flags rush handling, **Then** an added fee applies
   (or it is covered by a subscription).
3. **Given** a shipment, **When** the operator picks, packs, labels, and records the tracking
   number, **Then** the items' lifecycle state moves to `shipped` with custody events logged.
4. **Given** a shipped shipment, **When** the user checks status, **Then** they can track
   status and tracking number throughout its life.
5. **Given** shipping and rush handling, **When** performed, **Then** the corresponding
   charges are generated automatically.

---

### User Story 9 - Administration, Pricing, and Operations (Priority: P3)

Administrators manage users, roles, and account status; view a specific user's items and
transactions for support; run a structured dispute process; manage promotional banners;
maintain the single central pricing table; and trigger bulk storage-fee runs.

**Why this priority**: Governance and operations are essential for running the platform but
are not required to demonstrate the core customer value slices.

**Independent Test**: From an admin screen, change a user's role and status, open and rule on
a dispute, update a pricing rule (recorded with effective date and admin identity), and
trigger a storage-fee run that charges items stored beyond the defined period.

**Acceptance Scenarios**:

1. **Given** an administrator, **When** they manage users, **Then** they can assign roles and
   set account status to suspended, reactivated, or closed from a dedicated admin screen.
2. **Given** a support inquiry, **When** an administrator opens the support view, **Then** they
   can see a specific user's items and transactions for troubleshooting.
3. **Given** a contested transaction, **When** an administrator runs the dispute process,
   **Then** it supports opening, investigation, ruling, and documentation of the decision.
4. **Given** the central pricing table, **When** an administrator updates a price, **Then** the
   change applies without code change, supports fixed or percentage fees and pricing by item
   class/parameters, and is recorded with its effective date and the administrator's identity.
5. **Given** a completed transaction, **When** the pricing table later changes, **Then** the
   transaction preserves the exact prices and fees that applied at its execution.
6. **Given** items stored beyond a defined period, **When** an administrator triggers a bulk
   storage-fee run, **Then** charges are generated automatically per the pricing table.
7. **Given** the user dashboard, **When** an administrator creates, updates, or removes a
   promotional banner, **Then** it displays or stops displaying accordingly.

---

### User Story 10 - Preference-Driven Notifications (Priority: P3)

Users choose which notification types they receive, and the system sends notifications on
events concerning them — item received, item sold, offer received, shipment dispatched, hold
placed — according to those preferences.

**Why this priority**: Notifications improve engagement and trust but are not required to
complete any core transaction.

**Independent Test**: Configure preferences to opt into "item sold" and out of "hold placed",
trigger both events, and confirm only the opted-in notification is delivered.

**Acceptance Scenarios**:

1. **Given** configured notification preferences, **When** an event concerning the user
   occurs, **Then** a notification is sent only if the user opted into that event type.
2. **Given** a user opted out of an event type, **When** that event occurs, **Then** no
   notification for it is sent.
3. **Given** a relevant event (item received, item sold, offer received, shipment dispatched,
   hold placed), **When** it occurs, **Then** the notification content, channel, send time,
   and status are recorded.

---

### Edge Cases

- **Expired tokens**: Verification and password-reset links are one-time and time-limited;
  reuse or expiry must be refused with a path to request a fresh link.
- **Concurrent purchase**: Two buyers targeting the same item — the item lock guarantees a
  single winner; the loser is informed the item is no longer available.
- **Held item actions**: Listing, swapping, transferring, or shipping an item under hold must
  be blocked while the hold is active.
- **Self-dealing attempts**: Buying, offering on, or swapping into one's own listing/items
  must be prevented, including via controlled/linked accounts.
- **Insufficient / negative balance**: A charge exceeding available credit either draws from
  an external means or drives the balance negative, which blocks defined services and accrues
  interest until settled.
- **Withdrawal vs. pending charge**: A pending charge must not be stranded by a simultaneous
  withdrawal; monetary movements must remain individually recorded and mutually consistent.
- **Suspended/closed mid-session**: A user suspended or closed during an active session must
  be blocked from further actions.
- **Grading/consignment external delays or failures**: Status must remain trackable and the
  item must never lose its single-owner record while out at an external body/channel.
- **Batch arrivals**: A batch item must be individually splittable later, each split producing
  its own tracked item and custody event.
- **Pricing change during a run**: A storage-fee or transaction in flight must use the price in
  force at its own execution moment, not a later table change.
- **Backup restore**: A point-in-time restore must reproduce authoritative state (items,
  custody, ledger, audit) consistently.

## Requirements *(mandatory)*

### Functional Requirements — Identity & Account Lifecycle

- **FR-001**: System MUST allow registration with a unique email address and a password,
  creating the account in `pending-verification` status.
- **FR-002**: System MUST assign each account a unique intake ID used to route that customer's
  inbound packages.
- **FR-003**: System MUST send an email verification link on registration; clicking a valid,
  unexpired link MUST activate the account.
- **FR-004**: System MUST refuse an expired verification link and allow the customer to request
  a new one.
- **FR-005**: System MUST authenticate sign-in with email and password and open a secure
  session bearing a token and expiry.
- **FR-006**: System MUST close the session and revoke its token on sign-out.
- **FR-007**: System MUST support password reset via a one-time, time-limited emailed link
  usable only once.
- **FR-008**: System MUST let a signed-in user change their password by supplying current and
  new passwords, effective immediately.
- **FR-009**: Users MUST be able to maintain their own profile details.
- **FR-010**: Administrators MUST be able to change a user's role and set account status to
  suspended, reactivated, or closed.
- **FR-011**: System MUST block a `suspended` or `closed` account from signing in and from
  performing any action.

### Functional Requirements — Intake & Chain of Custody

- **FR-012**: Warehouse operators MUST be able to create storage bins and generate serial
  numbers and barcodes for items and shelves.
- **FR-013**: System MUST identify and route an inbound package by the owner's intake ID; a
  batch-type arrival MUST open a batch linked to that owner.
- **FR-014**: Operators MUST be able to create an item record holding type/class, description,
  condition/grade, an initial photo, serial number, and barcode; assign it to a single owner
  and a bin; complete documentation fields; and record its first custody event.
- **FR-015**: System MUST treat intake as a billable action and generate its charge
  automatically.
- **FR-016**: Operators MUST be able to correct item fields, with every correction preserved in
  a full change history of who changed what and when (records never deleted).
- **FR-017**: Operators MUST be able to move an item between locations by scanning the item and
  destination bin, updating location and logging a custody event automatically.
- **FR-018**: Operators MUST be able to split a batch into individually tracked items at the
  owner's request, with a custody event recorded per item.
- **FR-019**: Operators MUST be able to produce inventory reports of all items and locations,
  cut by shelf, owner, condition, or class, and manage inventory statistics (e.g., packages per
  shelf) with access to and editing of bin data.
- **FR-020**: System MUST log custody events and enforce item lifecycle transitions
  automatically as part of every relevant operation, never as a separate optional step.
- **FR-021**: Each item record MUST have exactly one owner at all times and MUST NEVER be
  deleted; retirement/loss/destruction MUST be represented as a terminal lifecycle state.
- **FR-022**: Customers MUST have a personal vault view of every item they currently own in
  storage, each with a full item card (details, images, condition, history), plus free-text
  search and filtering by type, condition, and other attributes.

### Functional Requirements — Marketplace Transaction Engine

- **FR-023**: Owners MUST be able to list a stored item at an asking price; an item under hold
  MUST be blocked from listing.
- **FR-024**: All users MUST be able to browse, search, and filter active listings and view
  listing details including images, condition, and price.
- **FR-025**: Sellers MUST be able to reprice or remove a listing any time before it sells;
  removal is an irreversible action requiring explicit confirmation.
- **FR-026**: System MUST execute a direct purchase as one atomic transaction whose completion
  is conditional on all of: locking the item, charging the buyer, crediting the seller net of
  the marketplace fee, transferring ownership, and writing an irreversible record — with no
  physical movement.
- **FR-027**: System MUST prevent two concurrent purchases of the same item via item locking.
- **FR-028**: System MUST block a user from buying their own listing (no self-dealing).
- **FR-029**: Buyers MUST be able to submit an offer on an active listing (never their own),
  notifying the seller; the seller MUST be able to accept (triggering a purchase at the offer
  price), reject, or counter, with the buyer emailed on each response and counters chained to
  their parent offer.
- **FR-030**: System MUST let two users swap stored items, executing only upon both parties'
  consent, performing mutual ownership transfers and irreversible recording.
- **FR-031**: Owners MUST be able to transfer a stored item to another user with no
  consideration, requiring the recipient's explicit approval and recorded as an ownership
  change.
- **FR-032**: System MUST restrict trading (sale, offer, swap) to items that are in-vault and
  not currently held, and MUST prohibit self-dealing.
- **FR-033**: Purchases, swaps, and transfers MUST each be billable actions charged
  automatically.
- **FR-034**: Every completed transaction (sale, swap, transfer, consignment) MUST be recorded
  as a final, irreversible business event storing items, buyer/seller, price, fee, frozen
  effective prices, and timestamp.

### Functional Requirements — Value-Added Services & Outbound Shipping

- **FR-035**: Owners MUST be able to request professional photography for an item (or part),
  charged per the price list, with resulting photos uploaded as a new image version.
- **FR-036**: Owners MUST be able to submit eligible items for third-party grading, sending them
  to a grading body, tracking submission status, and recording returned grades.
- **FR-037**: Owners MUST be able to donate an item, which after explicit confirmation removes
  it from their ownership with a final record of the action.
- **FR-038**: Owners MUST be able to request consignment sale of an item on an external channel
  (e.g., eBay or an event); the sale is managed externally and, on completion, the owner is
  credited net of fees and the action is fully recorded.
- **FR-039**: All value-added services MUST be billable actions charged automatically.
- **FR-040**: A user or operator MUST be able to select one or more items and a destination and
  create an outbound shipment request.
- **FR-041**: System MUST present available carriers and service levels with cost calculation
  via an external rate provider, with the choice made by the user or left to the operator.
- **FR-042**: Users MUST be able to flag a shipment for rush handling for an added fee or as
  part of a subscription service.
- **FR-043**: Operators MUST be able to pick items from bins, pack them, produce a shipping
  label, record the tracking number, and move item lifecycle state to `shipped` with custody
  events.
- **FR-044**: Users MUST be able to track shipment status and tracking number throughout its
  life.
- **FR-045**: Shipping and rush handling MUST be billable actions charged automatically.

### Functional Requirements — Payments & Pricing

- **FR-046**: Users MUST be able to load the wallet with credits, charged through the external
  payment provider and recorded as an immutable ledger record.
- **FR-047**: Users MUST be able to withdraw a credit balance to an external account through an
  explicit confirmation step, execution of the transfer, and a ledger record.
- **FR-048**: Every billable action (intake, storage, service, shipping, trade) MUST
  automatically create a charge per the pricing table in force at that moment, paid from the
  credit balance or by an external means.
- **FR-049**: Every monetary movement MUST be written as an immutable ledger record; a user's
  balance MUST always equal the sum of their ledger records; the entire ledger MUST be
  auditable.
- **FR-050**: A negative balance MUST block defined services and accrue interest until settled.
- **FR-051**: System MUST maintain exactly one central, configuration-driven pricing table
  covering all billable actions, editable by administrators without any code change, supporting
  fixed or percentage fees and pricing by item class and defined parameters.
- **FR-052**: Every price change MUST be recorded with its effective date and the identity of
  the administrator who made it.
- **FR-053**: A completed transaction MUST preserve the exact prices and fees that applied at
  its execution regardless of future pricing-table changes.
- **FR-054**: Administrators MUST be able to trigger a bulk storage-fee run that automatically
  generates charges, per the pricing table, for items stored beyond a defined period, recording
  the threshold period, run time, and items/accounts charged.
- **FR-055**: External payment references MUST store only the provider-side token or identifier
  with no raw card data.

### Functional Requirements — Administration, Security & Operations

- **FR-056**: Administrators MUST be able to manage users, assign roles, and change account
  status from a dedicated admin screen.
- **FR-057**: Administrators MUST have a support view into a specific user's items and
  transactions for troubleshooting and inquiries.
- **FR-058**: System MUST provide a structured dispute process for contested transactions
  covering opening, investigation, ruling, and documentation of the decision.
- **FR-059**: Administrators MUST be able to create, update, and remove promotional banners
  displayed on the user dashboard.
- **FR-060**: System MUST enforce strict separation among four roles — customer, warehouse
  operator, administrator, and system — with least-privilege permissions.
- **FR-061**: All data MUST be encrypted; personal data and shipping addresses MUST be exposed
  to administrators only.
- **FR-062**: Secrets and credentials MUST be kept separate from application code.
- **FR-063**: Images MUST be stored durably with version management.
- **FR-064**: Users MUST be able to configure which notification types they receive, and the
  system MUST send notifications on events concerning them (item received, item sold, offer
  received, shipment dispatched, hold placed) according to those preferences.
- **FR-065**: System MUST back up the database regularly with point-in-time recovery and
  restore procedures that are tested periodically.
- **FR-066**: System MUST log and monitor errors with automatic alerting on failures.
- **FR-067**: Every action that changes system state MUST be written to an immutable audit log
  containing actor, action, target, and timestamp, with records that can never be modified or
  deleted.
- **FR-068**: Sensitive or irreversible actions (withdrawal, donation, ownership transfer,
  listing removal) MUST require an explicit confirmation step before execution.
- **FR-069**: The platform MUST be the sole system of record for item ownership, custody, and
  money; external providers MUST be referenced by tokens only, and their state MUST NOT be
  treated as authoritative over the platform's.

### Key Entities

- **User Account**: A platform identity. Unique email, encrypted password, status
  (`pending`, `active`, `suspended`, `closed`), unique intake ID, role, creation date.
- **Verification Token**: One-time, expiring token for email verification or password reset.
- **Login Session**: An authenticated session with token and expiry.
- **Item**: The core physical-asset record; never deleted, always exactly one owner. Serial
  number, barcode, type/class, description, condition/grade, lifecycle state, owner, bin,
  source batch, hold flag, dates.
- **Bin**: A storage location. Barcode, zone, capacity.
- **Item Image**: A versioned image typed as `intake` or `professional photography`.
- **Custody Event**: Immutable record of event type, previous/new owner, location and state,
  actor, reason, timestamp.
- **Listing**: A marketplace offer to sell. Item, seller, asking price, status (`active`,
  `sold`, `removed`), publish and update dates.
- **Offer**: A bid on a listing with counter-offer chaining via a parent-offer link; status
  `pending`, `accepted`, `rejected`, or `countered`.
- **Swap Proposal**: Offered and requested item sets with dual-approval status.
- **Transaction**: A final, irreversible business event typed `sale`, `swap`, `transfer`, or
  `consignment`, holding items, buyer/seller, price, fee, frozen effective prices, timestamp.
- **Service Request**: Typed `batch split`, `professional photography`, `third-party grading`,
  `donation`, or `consignment`, with item/batch reference, status, charge, and type-specific
  fields (e.g., received grade, external sale channel).
- **Shipment**: User, destination address, carrier, service level, rush flag, cost, status,
  tracking number.
- **Wallet**: A user's credit account whose balance is always derived from the sum of ledger
  records.
- **Ledger Record**: Immutable monetary entry typed `purchase`, `sale credit`, `fee`, `service
  charge`, `credit top-up`, `withdrawal`, or `interest`, with amount, direction, reference,
  timestamp.
- **External Payment**: Stores only the provider-side token/identifier; no raw card data.
- **Charge**: Auto-generated record of action type, pricing actually applied, amount, payment
  means, and status.
- **Withdrawal**: Destination account details and status.
- **Pricing Rule**: Action type, item class and parameters, percentage or fixed model, value,
  effective date, and updating administrator.
- **Storage-Fee Run**: Threshold period, run time, and the items and accounts charged.
- **Dashboard Banner**: Title, image, link, display period, active flag.
- **Audit Record**: Immutable record of actor, action, target, timestamp.
- **Notification**: User, event type, content, channel, send time, status.
- **Notification Preference**: Per-user opt-in setting by event type.
- **Inventory Report**: Generated report with production time, cut, filters, and item-location
  data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new customer can complete registration and email verification and reach an
  active, signed-in state in under 3 minutes.
- **SC-002**: 100% of item records are single-owner and never deleted — no item ever exists
  with zero or more than one owner, and no item record is ever removed.
- **SC-003**: 100% of ownership, location, and lifecycle-state changes produce a corresponding
  custody event, with zero gaps in any item's custody chain.
- **SC-004**: For every user at every point in time, wallet balance equals the exact sum of
  that user's ledger records (zero reconciliation discrepancies).
- **SC-005**: 100% of billable actions generate an automatic charge; no billable action
  completes without a corresponding charge recorded.
- **SC-006**: 100% of completed transactions retain the exact prices/fees in force at
  execution, unaffected by later pricing-table changes.
- **SC-007**: In concurrent-purchase tests, exactly one buyer succeeds per item; no item is
  ever sold to two buyers.
- **SC-008**: Zero self-dealing transactions occur — no user buys, offers on, or swaps into
  their own item.
- **SC-009**: 100% of state-changing actions appear in the immutable audit log with actor,
  action, target, and timestamp; no audit record is ever modified or deleted.
- **SC-010**: 100% of sensitive/irreversible actions (withdrawal, donation, transfer, listing
  removal) require and receive explicit confirmation before execution.
- **SC-011**: Notifications are delivered only for event types a user has opted into, matching
  preferences in 100% of tested cases.
- **SC-012**: Point-in-time restore reproduces authoritative state (items, custody, ledger,
  audit) with zero data inconsistency in periodic restore tests.
- **SC-013**: Personal data and shipping addresses are accessible only to administrators; no
  non-admin role can retrieve them.
- **SC-014**: No raw card data is ever stored; 100% of payment references hold only provider
  tokens/identifiers.
- **SC-015**: Ownership can change hands repeatedly (sale, swap, gift) with zero physical
  movement of the item required.

## Assumptions

- **External providers**: Email delivery, payment processing, shipping rate/label generation
  (e.g., ShipStation/Easyship), grading (e.g., PSA), and consignment channels (e.g., eBay) are
  external services integrated via their provider APIs; the platform references them by token
  and remains the sole system of record.
- **Web application**: The platform is delivered as a web application accessible to customers,
  operators, and administrators; specific native client platforms are out of scope for this
  specification.
- **Single warehouse**: A single professionally operated warehouse is assumed; multi-warehouse
  routing is not specified here and can be added later.
- **Currency**: A single settlement currency is assumed for wallet, ledger, pricing, and
  payouts unless otherwise specified.
- **Subscription service**: Rush handling "as part of a subscription" implies a subscription
  offering exists; its full lifecycle (plans, renewal, billing cadence) is assumed handled by
  the same pricing/billing model and is not further detailed here.
- **Interest on negative balance**: The interest rate and accrual cadence for negative balances
  are configured via the pricing/administration model and applied by an automated system
  process.
- **Storage-fee period**: The "defined period" after which storage fees apply is a
  configurable parameter set by administrators in the pricing/configuration model.
- **Notification channels**: Email is the primary notification channel referenced (verification,
  password reset, offer responses); additional channels are governed by notification
  preferences and the Notification entity's channel field.
- **Authentication**: Standard session-based authentication with email/password is used; no
  external SSO is assumed for this version.
- **Eligibility rules**: "Eligible items" for grading and "defined services" blocked by a
  negative balance are governed by configurable business rules maintained through
  administration.
