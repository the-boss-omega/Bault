## 2.3 Accounts, security, support and media

Four modules: `acc` (accounts, sessions, two-factor sign-in), `sec` (roles, audit), `sup` (the helpdesk) and `med` (photo uploads). The guards come first, in the order a request meets them after the rate limits of 2.2. Then the account flows, two-factor sign-in, the profile and the schema, and last the helpdesk and media. Budget: 30 minutes.

#### `apps/api/src/modules/sec/auth-context.ts`, `apps/api/src/modules/sec/current-user.decorator.ts` · 1 min · T6.3, T7.1, T7.7
- `AuthUser` — what an authenticated request carries: `id`, `role` (`Role`: `user`, `warehouse_operator`, `admin`), `status` (`AccountStatus`) and `mfaEnabled`. The file adds `user` to Express's `Request`.
- `CurrentUser` — the handler parameter decorator; a 401 when no user is attached.

#### `apps/api/src/modules/acc/session-auth.guard.ts`, `apps/api/src/modules/acc/public.decorator.ts`, `apps/api/src/modules/acc/allow-suspended.decorator.ts`, `apps/api/src/modules/acc/allow-any-status.decorator.ts` · 1.5 min · T6.3, T7.1, T7.4
The second global guard: who is calling, and may their account act.
- `canActivate` — resolves the `SESSION_COOKIE_NAME` cookie with `SessionService.resolve`. The account must be `active`, or it gets a 403 `account_suspended`, unless the route is `@AllowSuspended()` (for `suspended`) or `@AllowAnyStatus()`. Then `req.user` is set, a `@Public()` route passes, and any other route without a user gets a 401.
- `@Public()` — sign-up, sign-in, email links, reset, public browsing and reference lists, the payment webhook and the probes.
- `@AllowSuspended()` — only the five collector helpdesk routes and `GET /me/profile`, so an account suspended for debt can ask for help. `closed` never passes.
- `@AllowAnyStatus()` — only `POST /auth/logout`.

**Watch:** the status check comes before the `@Public()` check, so a suspended or closed account with a live cookie gets a 403 on public routes too, `POST /auth/login` included, until it signs out.

#### `apps/api/src/modules/acc/session.service.ts` · 1.5 min · T7.4, T5.4
Opaque random session tokens; `login_session` stores only their SHA-256 hash.
- `create` — seven days (`SESSION_TTL_MS`), with the client's `ip` and user agent (`clampUserAgent`). The optional `tx` lets the second sign-in step open the session in the transaction that spends the code.
- `resolve` — one query per request: session, role, status, and whether an `mfa_factor` is enabled. Revoked or expired is null.
- `revoke` ends one session; `revokeAllFor` ends all of a user's, optionally except the caller's, and returns the count.

**Watch:** expiry is fixed at sign-in; use doesn't extend it. `resolve` joins `userAccount.id` to `loginSession.userId` through the uuid-text operator (2.2), which keeps the primary-key index; casting the id to text would scan the account table on every request.

#### `apps/api/src/modules/acc/mfa/mfa-enrollment.guard.ts`, `apps/api/src/modules/acc/mfa/mfa-policy.ts`, `apps/api/src/modules/acc/mfa/allow-without-mfa.decorator.ts` · 1 min · T4.2, T6.3, T7.6
The third guard: a role that requires a second factor gets nothing until it has one.
- `MfaEnrollmentGuard` — passes `@AllowWithoutMfa()`, `@Public()` and anonymous requests. A user whose role is in the policy and whose `mfaEnabled` isn't `true` gets a 403 `mfa_enrollment_required`.
- `mfaPolicyProvider` — `MFA_REQUIRED_ROLES`, read once. Unset, it means both staff roles in production and nobody elsewhere.
- `@AllowWithoutMfa()` — only `GET /auth/mfa`, `setup`, `confirm`, sign-out and `GET /me/profile`. `tests3/contract/mfa-enforcement.test.ts` pins that list.

#### `apps/api/src/modules/sec/roles.decorator.ts`, `apps/api/src/modules/sec/roles.guard.ts` · 1 min · T6.3, T7.7
- `Roles` sets the allowed roles on a handler or class. `RolesGuard` passes a route without it; otherwise the user's role must be listed, or it is a 403.

**Watch:** a route without `@Roles` is open to every signed-in account. Ownership ("is this my item") is never a guard; each service checks it.

#### `apps/api/src/modules/sec/audit.interceptor.ts`, `apps/api/src/modules/sec/audit.service.ts`, `apps/api/src/modules/sec/audit.schema.ts` · 1.5 min · T6.7, T5.6
The audit log, in the append-only `audit_record`.
- `AuditInterceptor` — global. After a successful POST, PUT, PATCH or DELETE it records the actor, method and path as `action`, the first path segment as `targetEntity`, the first id-like route param as `targetId`, and the params.
- `AuditService.record` — one INSERT; with `tx` it commits with the change, as in `MfaService` and `WalletRequestService`.

**Watch:** the interceptor's write is fire-and-forget, outside the request's transaction, with failures swallowed, so a row can be lost. It stores no body: it says which route ran, not what changed. Failed requests leave no row; failed sign-ins are in `login_attempt`.

#### `apps/api/src/modules/acc/acc.module.ts`, `apps/api/src/modules/acc/acc.dto.ts` · 1 min · T6.2, T7.2, T7.3
- `AccModule` — `AuthController`, `ProfileController`, `MfaController` and their services. It exports `SessionService`, `SessionAuthGuard`, `MfaService`, `MfaEnrollmentGuard` and `MFA_POLICY` for the global guards and the admin's two-factor reset.
- `RegisterDto` — `username` is 3 to 32 letters, digits, `.`, `-` or `_`, never an `@`, so it can't look like an email. Names refuse markup and control characters. `password` needs 8 characters and is never trimmed. `acceptedTermsVersion` is required.
- `LoginDto` takes one `identifier`, email or username. The rest are small: `LoginMfaDto`, `ConfirmMfaDto`, `DisableMfaDto`, `ResetPasswordDto`, `ChangePasswordDto`, `UpdateProfileDto`.

**Watch:** no DTO accepts `username` after registration, and the `user_account_username_immutable` trigger (migration 0004) refuses the write anyway.

#### `apps/api/src/modules/acc/auth.controller.ts` · 2 min · T7.3, T7.4, T7.6, T6.7
The `/auth` routes.
- `register`, `verify-email`, `verify-email/resend`.
- `login` — sets the cookie and answers `{ id, role, mfaEnrollmentRequired }`, or `mfa_required` with a `challengeToken` for an enrolled account, never cached. It sets `req.user` so the audit row names the actor.
- `loginMfa` — the challenge plus exactly one of `code` and `recoveryCode`.
- `logout` — `@AllowWithoutMfa()` and `@AllowAnyStatus()`.
- `password/reset-request`, `password/reset`, `password/change`, `sessions/revoke-others`.
- `setSessionCookie` — `httpOnly`, `secure` in production, `sameSite: 'lax'`, expiring with the session.
- `CREDENTIAL_ROUTE` (`AUTH_RATE_LIMIT_PER_MINUTE`) meters every route that checks a credential; `MAIL_ROUTE`, a fixed 5 a minute, the two that mail an address the caller chose.

**Watch:** keep credential routes under `/auth`; the error scrubber drops request bodies only there and under `/me/password` (2.2).

#### `apps/api/src/modules/acc/auth.service.ts` · 2 min · T7.2, T7.3, T7.6, T15.3
Registration and both sign-in steps.
- `register` — refuses any `acceptedTermsVersion` but `CURRENT_TERMS_VERSION`, normalises email and username, hashes with argon2, inserts a `pending` account with its terms acceptance, and sends the verification mail. The unique indexes are the guarantee; `isUniqueViolation` catches a racing duplicate.
- `login` — runs `attempt` through `perIdentifier`, a `OneAtATime`, so the lockout counts a burst one by one.
- `attempt` — refuses a locked identifier first, even with the right password. It always runs one argon2 verify, against `dummyHash` when nobody matched, so an unknown account and a wrong password look alike. `pending` gets `email_unverified`, `closed` gets `account_suspended`, `suspended` signs in. An enrolled account gets a challenge, others a session. Every checked attempt is logged.
- `completeSecondFactor` — in the same queue, checks both locks, calls `MfaService.redeemChallenge`, and records the outcome.

**Watch:** sign-up answers "Email is already registered", so registration does reveal whether an address has an account.

#### `apps/api/src/modules/acc/login-attempts.service.ts` · 1.5 min · T7.3, T7.8, T15.3
The sign-in log and its lockout.
- `record` — one `login_attempt` row per attempt: typed identifier, account, `LoginOutcome`, IP, user agent. A failed write never breaks sign-in.
- `lockedFor` — locked while the identifier's last 10 failures (`bad_credentials` or `mfa_failed`) span at most 15 minutes and the newest is under 15 minutes old.
- `secondFactorLockedFor` — the same rule on one account's `mfa_failed` rows, from any identifier or route.
- `lockedError` — a 429 `rate_limited` with `retryAfterSeconds`.

**Watch:** keyed on what was typed, an unknown identifier locks like a real one, but an account's email and username count separately. Refusals during a lock write nothing, so they can't extend it.

#### `apps/api/src/modules/acc/verification.service.ts`, `apps/api/src/modules/acc/password.service.ts` · 2 min · T7.2, T7.5, T14.3, T15.3
Email links and passwords. A link is a single-use `verification_token` row, stored as a hash.
- `issueEmailVerification` — a 24-hour link into the SPA's hash route (`emailLink`), mailed at once through `EMAIL_ADAPTER`.
- `verifyEmail` — one transaction: a conditional UPDATE consumes the token, then the account moves from `pending` to `active`, and from nothing else.
- `resend` — a fresh link for a `pending` account; silent otherwise.
- `change` — checks the current password, sets the new one, then ends every other session.
- `requestReset` — only writes the outbox event `PASSWORD_RESET_REQUESTED`, for any address. `apps/worker/src/jobs/password-reset-mail.ts` looks the address up, mints the token and mails it.
- `reset` — consumes the token and sets the password in one transaction, then ends every session.

**Watch:** `resend` looks the address up and mails inside the request, so unlike `requestReset` its timing can reveal a pending account. A wrong current password in `change` isn't logged in `login_attempt`; only the rate limit slows a stolen session guessing it.

#### `apps/api/src/modules/acc/mfa/mfa.controller.ts` · 1 min · T7.6
The signed-in half of two-factor, under `/auth/mfa` so the scrubber drops its bodies.
- `status`, `setup` and `confirm` are `@AllowWithoutMfa()`, so a staff account can enrol.
- `confirm`, `recovery-codes` and `disable` check codes and use the credential rate limit.
- Responses carrying a secret or recovery codes are `no-store`.

#### `apps/api/src/modules/acc/mfa/mfa.service.ts` · 3 min · T7.6, T7.7, T15.1
TOTP sign-in. Spending a code, a recovery code or a challenge is always a conditional UPDATE inside the transaction that acts on it, which holds across API processes.
- `beginSetup` — a new sealed secret, upserted into `mfa_factor` only while not enabled (`setWhere`), returned as an `otpauth` URI, text and a QR code.
- `confirmSetup` — password and code. One transaction locks the factor, sets `enabledAt` and `lastUsedStep`, makes ten recovery codes (shown only here), ends every other session and audits.
- `regenerateRecoveryCodes` — a current code replaces the set in one transaction.
- `disable` — password and code, and never for a role that requires it (`mfa_required_for_role`).
- `resetFor` — an admin removes another account's factor and ends its sessions, audited; never their own. Called from `apps/api/src/modules/adm/adm.controller.ts`.
- `issueChallenge` — five minutes (`CHALLENGE_TTL_MINUTES`), stored as a hash. `findChallenge` reads a live one under `CHALLENGE_MAX_FAILURES` (5).
- `redeemChallenge` — locks and re-checks the challenge, refuses an account closed since the password step, then `spendTotp` or `spendRecoveryCode`. A wrong code increments `failedAttempts`, and that commits; a right one consumes the challenge and opens the session together.
- `spendTotp` — accepts a step only if it is later than `lastUsedStep`, compared inside the UPDATE, so a replayed or simultaneous code fails.

**Watch:** a secret that won't open is a 409 `mfa_factor_unreadable` and one error log line, usually after `MFA_ENCRYPTION_KEY` changed. Recovery codes are hashed under a key derived from it, so after a change they fail like a typo.

#### `apps/api/src/modules/acc/mfa/totp.ts`, `apps/api/src/modules/acc/mfa/secret-box.ts`, `apps/api/src/modules/acc/mfa/recovery-codes.ts` · 1.5 min · T7.6, T4.5
Pure crypto on `node:crypto`, pinned by `tests3/contract/mfa-crypto.test.ts`.
- `matchTotp` — RFC 6238: HMAC-SHA1, 30-second steps, six digits, one step either side (`TOTP_WINDOW`). It returns the matched step and compares every candidate in constant time.
- `sealSecret` and `openSecret` — AES-256-GCM under `MFA_ENCRYPTION_KEY`, with the account id as authenticated data, so a ciphertext copied to another row won't open. Failure is `UnreadableSecretError`.
- `deriveSubkey` — HKDF, so recovery codes use their own key.
- `generateRecoveryCodes`, `normalizeRecoveryCode`, `hashRecoveryCode` — ten 12-character Crockford base32 codes, forgiving about case, dashes and look-alike letters, stored as HMAC-SHA256.

**Watch:** back up `MFA_ENCRYPTION_KEY` with the database. Without it, every enrolled account needs an admin reset.

#### `apps/api/src/modules/acc/profile.controller.ts`, `apps/api/src/modules/acc/profile.service.ts` · 1.5 min · T7.1, T13.1
`/me/profile` and `/me/addresses`, always the caller's own.
- `get` — the `ProfileView`, including `nameReviewRequired`, the terms acceptance, `mfaEnabled` and `mfaRequired`. It is `@AllowSuspended()` and `@AllowWithoutMfa()` because the SPA's shell boots from it.
- `update` — writes `firstName` and `lastName` only, and clears `nameReviewRequired`.
- `listAddresses`, `addAddress`, `updateAddress`, `deleteAddress` — scoped to the caller; an address is found by its id and the caller's id. `country` must pass `IsShippableCountry` and is stored via `toCountryCode`. A new default demotes the old one in the same transaction.

**Watch:** no unique index backs "one default address", so two concurrent saves can leave two defaults.

#### `apps/api/src/modules/acc/acc.schema.ts`, `apps/api/src/modules/acc/address.schema.ts` · 1 min · T5.4, T7.1, T7.2
- `userAccount` — `accountStatus` (`pending`, `active`, `suspended`, `closed`), `userRole`, unique `email` and `username`. `autoSuspendedAt` marks a debt-sweep suspension: the sweep lifts only those, and any status an admin sets clears it. `user_account_terms_acceptance_complete` keeps the two terms columns set together. Nothing writes `intakeId` or `legacyDisplayName`.
- `verificationToken`, `loginSession`, `loginAttempt`, `mfaFactor`, `mfaRecoveryCode`, `mfaChallenge` and `shippingAddress`.

**Watch:** every `user_id` here is `text` with no foreign key.

#### `apps/api/src/modules/sup/sup.controller.ts`, `apps/api/src/modules/sup/sup.module.ts` · 1 min · T7.1, T7.7, T6.3
`/support`.
- Collector routes, all `@AllowSuspended()`: `tickets` (list and open), `tickets/:id`, `tickets/:id/messages`, `awaiting`.
- Staff routes, `@Roles('warehouse_operator', 'admin')`: `queue`, `queue/count`, `tickets/:id/assign`, `tickets/:id/resolve`.

**Watch:** `CATEGORIES` includes `private_sale`; the service's `TicketCategory` type doesn't, and the database enum accepts it.

#### `apps/api/src/modules/sup/support.service.ts`, `apps/api/src/modules/sup/sup.schema.ts` · 2 min · T15.1, T14.3, T5.6
Status says whose turn it is: `open` (staff), `awaiting_customer` or `resolved`.
- `open` — the ticket, with a `TKT-` code, and its first message in one transaction.
- `loadFor` — staff see every ticket, a collector only their own; another's reads as a 404. `staff` requires an `active` account, so a suspended operator is a customer here.
- `reply` — sets the status by who spoke; a customer reply reopens a resolved ticket. A staff reply claims an unassigned ticket and emits `support_ticket_replied`.
- `resolve` and `assign` — conditional UPDATEs, so two staff clicking together act once. `resolve` emits `support_ticket_resolved`.
- `listQueue` — unresolved tickets, longest wait first.
- `supportMessage` — append-only, and every message is visible to both sides.

**Watch:** `relatedType` and `relatedId` are free text; nothing checks that the record exists or is the customer's.

#### `apps/api/src/modules/med/med.controller.ts`, `apps/api/src/modules/med/med.module.ts`, `apps/api/src/modules/med/med.schema.ts` · 1 min · T7.10, T9.1, T9.2
- `POST /media/uploads` — staff only; `UploadDto` takes `contentType`, `dataBase64` and a `purpose` of `item_intake` or `parcel`.
- `MedModule` — global, so `inv` and `mkt` inject `MediaService` freely.
- `mediaUpload` — a `media_upload` row per stored image: key, purpose, uploader, sniffed type, size.

**Watch:** collectors cannot upload. The wallet request's `documentKey` is typed text that nothing uploads, checks or signs.

#### `apps/api/src/modules/med/media.service.ts` · 2 min · T7.10, T9.1, T9.2
Upload the bytes for a key, then name the key when creating the record.
- `upload` — the declared type must be in `ALLOWED_TYPES`, and `decodedLength` checks `MAX_IMAGE_BYTES` (10 MB) before decoding. `sniffImageType` takes the real type from the first bytes and refuses anything else. The key is a prefix, the date and a UUID, never caller input. A store failure is a 503 `storage_unavailable`; the row is written only after the bytes are stored.
- `assertAttachable` — in the caller's transaction: each key must be safe, recorded, of the expected purpose, and the actor's own or a colleague's from the last 30 minutes (`FOREIGN_UPLOAD_WINDOW_MS`). Called by `IntakeService`, `ParcelService` and `HouseStoreService`.
- `signed`, `signAll` — signed URLs; a key that can't be signed is left out.

**Watch:** nothing records that a key was attached, so one upload can be attached to several records, and nothing removes uploads never attached.

**Also in this area**
- `apps/api/src/modules/acc/terms.ts` — `CURRENT_TERMS_VERSION`; `tests/web/faq-legal.test.ts` checks it matches the SPA's `TERMS_VERSION`.
- `apps/api/src/modules/acc/intake-id.ts` — `generateIntakeId`, which nothing calls.
- `apps/api/src/modules/sec/pii.ts` — `Pii` and `PiiInterceptor`, used nowhere.
- `apps/api/src/modules/sec/sec.module.ts` — global; provides `AuditService`, `AuditInterceptor`, `RolesGuard`, `PiiInterceptor`.
