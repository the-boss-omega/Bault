<!--
SYNC IMPACT REPORT
==================
Version change: (unversioned template) → 1.0.0
Rationale: Initial ratification. Constitution populated from template placeholders
           to a full principle set; MINOR/PATCH inapplicable for first adoption.

Modified principles: N/A (initial adoption; all principles newly defined)
Added sections:
  - Core Principles I–XIII (13 principles)
  - Security, Privacy & Compliance Standards
  - Development Workflow & Quality Gates
  - Governance
Removed sections: None

Templates requiring updates:
  ✅ .specify/templates/plan-template.md   — "Constitution Check" gate references
                                             constitution dynamically; no hardcoded
                                             principle names; no edit required.
  ✅ .specify/templates/spec-template.md   — no constitution/principle/gate refs; OK.
  ✅ .specify/templates/tasks-template.md  — no constitution/principle/gate refs; OK.
  ✅ Runtime guidance docs (README/docs)   — none present; nothing to sync.

Deferred TODOs: None. RATIFICATION_DATE set to first adoption date (2026-07-14),
                as no earlier adoption record exists.
-->

# Bault Constitution

Bault is the authoritative platform for the ownership, custody, and monetary state of
physical items held in vault. The principles below are non‑negotiable invariants: they
define correctness for the system, not merely style preferences. Where a principle uses
MUST/MUST NOT, a violation is a defect that blocks release.

## Core Principles

### I. Single-Owner, Never-Deleted Items with Enforced Lifecycle

Every item record MUST have exactly one owner at any point in time and MUST NOT be
hard-deleted, ever. Items MUST progress only through explicitly defined lifecycle states
via permitted transitions; any transition not enumerated in the lifecycle state machine
MUST be rejected. Retirement, loss, or destruction MUST be represented as a terminal
lifecycle state that preserves the record, never as deletion.

**Rationale**: Physical custody and ownership disputes require a permanent, unambiguous
record. Deletion or shared ownership would destroy the chain of accountability that the
entire platform exists to guarantee.

### II. Append-Only Immutable History

All history — custody events, transactions, ledger entries, and the audit log — MUST be
append-only. Records in these stores MUST NOT be updated or deleted after they are
written. Corrections MUST be expressed as new compensating entries that reference the
original, preserving the full lineage.

**Rationale**: Immutable history is the source of truth for reconstructing any past state
and for dispute resolution, regulatory review, and forensic audit. Mutable history cannot
be trusted.

### III. Automatic Chain-of-Custody

Every change to an item's ownership, physical location, or lifecycle state MUST
automatically generate a custody event as part of the same atomic operation that effects
the change. No ownership, location, or state change may occur without a corresponding
custody event; the two MUST NOT be separable.

**Rationale**: Custody is only meaningful if it is complete. Manual or optional custody
logging inevitably produces gaps, and a single gap breaks the chain.

### IV. Ledger-Derived Balances

Wallet balances MUST always be derived by computing over ledger entries. A balance MUST
NOT be stored as an independent authoritative value that can drift from the ledger. Cached
or materialized balances are permitted only as a performance optimization that is provably
reconstructable from, and reconciled against, the ledger.

**Rationale**: A single append-only ledger as the sole source of monetary truth eliminates
reconciliation ambiguity and makes every balance auditable back to first principles.

### V. Atomic, Irreversible, Price-Frozen Transactions

Transactions MUST execute atomically — fully applied or not at all — and MUST be
irreversible once committed. The prices and fees applied to a transaction MUST be frozen
(snapshotted) at the moment of execution and stored with the transaction, independent of
later changes to any pricing source. Reversal, if ever required, MUST occur only through a
new compensating transaction, never by mutating or undoing the original.

**Rationale**: Atomicity prevents partial money movement; frozen prices guarantee that what
a party agreed to is exactly what is recorded, even if the pricing table later changes.

### VI. Central, Configuration-Driven Pricing and Automatic Billing

There MUST be exactly one central, configuration-driven pricing table as the single source
of pricing for all billable actions. Prices MUST NOT be hardcoded or duplicated across the
system. Every billable action MUST be billed automatically, at execution, from that table —
billing MUST NOT depend on a separate manual step.

**Rationale**: One pricing source prevents inconsistent charges; automatic billing ensures
no billable action escapes accounting, protecting both revenue integrity and the ledger's
completeness.

### VII. Explicit Confirmation and Dual Consent

Any irreversible action MUST require explicit user confirmation before execution. Actions
involving two parties — specifically swaps and transfers — MUST require dual consent: both
parties MUST affirmatively agree before the action commits. A single party MUST NOT be able
to unilaterally move another party's item or money.

**Rationale**: Irreversibility raises the cost of mistakes and coercion; explicit and
mutual consent are the safeguards that make irreversible operations trustworthy.

### VIII. Trading Integrity

Trading MUST be restricted to items that are physically in-vault and not currently held
(reserved, locked, or otherwise encumbered). Self-dealing MUST be prohibited: a party MUST
NOT be both sides of the same trade, directly or through controlled accounts. Any trade
proposal involving out-of-vault, held, or self-dealt items MUST be rejected.

**Rationale**: The platform can only guarantee settlement for items it physically controls
and that are free of competing claims; self-dealing enables price manipulation and wash
trading.

### IX. Security and Data Protection by Default

Data MUST be encrypted by default, both at rest and in transit. Personally identifiable
information (PII) MUST be accessible only to admin roles and MUST NOT be exposed to other
roles or logs. Payments MUST be tokenized; the platform MUST NOT store, log, or transmit
raw card data under any circumstance.

**Rationale**: Default-on encryption, least-privilege PII access, and tokenized payments
minimize breach impact and keep the platform out of scope for raw cardholder data handling.

### X. Strict Role Separation

The system MUST enforce four distinct roles — customer, warehouse operator, admin, and
system — with separated, least-privilege permissions. A capability granted to one role MUST
NOT be implicitly available to another. Privilege escalation MUST be explicit, audited, and
authorized.

**Rationale**: Clear role boundaries prevent both accidental and malicious cross-role
actions and make every privileged action attributable.

### XI. Preference-Driven Notifications

Users MUST be notified of relevant events according to their stored notification
preferences. Notification delivery MUST honor those preferences; the system MUST NOT send
event notifications a user has opted out of, nor silently drop notifications a user has
opted into.

**Rationale**: Respecting notification preferences keeps users informed of custody and
money movements they care about without eroding trust through noise or silence.

### XII. Resilience: Point-in-Time Backups and Automatic Error Alerting

The system MUST maintain point-in-time backups sufficient to restore authoritative state
(items, custody, ledger, audit log) to a chosen prior instant. Errors and anomalies MUST
trigger automatic alerting to operators; failures MUST NOT depend on a human noticing them.

**Rationale**: Point-in-time recovery bounds data loss, and automatic alerting bounds the
time an undetected fault can corrupt custody or money.

### XIII. Platform as Sole System of Record

The platform MUST be the sole system of record for item ownership, custody, and money.
External providers (payment processors, identity, storage, or others) MUST be referenced by
opaque tokens only; the platform MUST NOT delegate authoritative ownership, custody, or
monetary state to any external system, and MUST NOT treat an external provider's state as
authoritative over its own.

**Rationale**: Concentrating authority for ownership, custody, and money in one system of
record eliminates split-brain disputes and ensures the platform can always answer, on its
own, who owns what and what is owed.

## Security, Privacy & Compliance Standards

- **Encryption**: Encryption at rest and in transit is mandatory for all environments,
  including non-production. Unencrypted transport or storage of platform data is prohibited.
- **PII access**: PII access is admin-only, logged to the audit log, and MUST follow
  least-privilege. PII MUST NOT appear in application logs, error traces, or notifications.
- **Payment data**: Only tokenized payment references are permitted in the platform. Raw
  card data (PAN, CVV, track data) MUST NOT enter platform storage, logs, or memory beyond
  the tokenizing boundary.
- **Audit log**: The audit log is append-only (Principle II) and MUST capture actor, role,
  action, affected records, and timestamp for every privileged or state-changing action.
- **External providers**: Referenced by opaque token only (Principle XIII); provider
  credentials MUST be secret-managed, never committed or logged.
- **Backups**: Backups MUST themselves be encrypted and access-controlled, and restore
  procedures MUST be periodically exercised.

## Development Workflow & Quality Gates

- **Constitution Check**: Every feature plan (`/speckit.plan`) MUST pass a Constitution
  Check gate before design proceeds and be re-checked after design. Any violation MUST be
  either removed or explicitly justified in the plan's Complexity Tracking table.
- **Invariant tests**: Changes affecting items, custody, ledger, transactions, pricing,
  roles, or audit MUST include tests asserting the relevant invariants (single owner,
  append-only, custody-on-change, ledger-derived balance, price freeze, no self-dealing).
- **Irreversibility review**: Any code path that performs an irreversible or two-party
  action MUST demonstrate explicit confirmation / dual consent (Principle VII) in review.
- **No principle bypass**: Reviewers MUST reject changes that hard-delete records, mutate
  history, store authoritative balances, hardcode prices, or bypass automatic billing.
- **Security review**: Changes touching PII, payments, encryption, roles, or external
  providers MUST receive a security review before merge.

## Governance

This constitution supersedes all other development practices and conventions within the
Bault project. Where guidance conflicts, the constitution wins.

- **Amendments**: Amendments MUST be proposed in writing with rationale and impact,
  reviewed and approved by project maintainers, and accompanied by a migration/propagation
  plan for any dependent templates, code, or data.
- **Versioning**: The constitution follows semantic versioning. MAJOR = backward-
  incompatible principle removal or redefinition; MINOR = new principle/section or
  materially expanded guidance; PATCH = clarifications and non-semantic refinements.
- **Compliance review**: All plans, specs, tasks, and pull requests MUST verify compliance
  with the applicable principles. Complexity that appears to violate a principle MUST be
  justified against a simpler rejected alternative, or the change MUST be revised.
- **Enforcement**: A merged violation is treated as a defect and MUST be remediated with
  priority; the audit log and history stores MUST NOT be altered to conceal it.

**Version**: 1.0.0 | **Ratified**: 2026-07-14 | **Last Amended**: 2026-07-14
