## 2.3 Accounts, security, support and media

This section covers four modules. The accounts module `acc` holds accounts, sessions and two-factor sign-in. The security module `sec` holds roles and audit. `sup` is the helpdesk, and `med` stores photos. Read the guards first, in the order a request meets them after the rate limits of section 2.2. Then read the account flows, two-factor sign-in, the profile and the schema, and end with the helpdesk and media. The section takes about 30 minutes.

#### `apps/api/src/modules/sec/auth-context.ts`, `apps/api/src/modules/sec/current-user.decorator.ts`

About 1 minute. It builds on T6.3, T7.1 and T7.7.

`AuthUser` is the signed-in user that an authenticated request carries. It holds the `id`, a `Role` of `user`, `warehouse_operator` or `admin`, an `AccountStatus` and `mfaEnabled`. The file adds `user` to Express's `Request`. `CurrentUser` hands that user to a handler, and it answers 401 when there is none.

#### `apps/api/src/modules/acc/session-auth.guard.ts`, `apps/api/src/modules/acc/public.decorator.ts`, `apps/api/src/modules/acc/allow-suspended.decorator.ts`, `apps/api/src/modules/acc/allow-any-status.decorator.ts`

About 1.5 minutes. It builds on T6.3, T7.1 and T7.4.

`SessionAuthGuard` works out who is calling from the session cookie. It is the second global guard, after the rate limiter. `canActivate` resolves the `SESSION_COOKIE_NAME` cookie with `SessionService.resolve`. An account that is not `active` gets a 403 `account_suspended`, with two exceptions. A `suspended` account passes on an `@AllowSuspended()` route, and any account passes on an `@AllowAnyStatus()` route. The guard then sets `req.user`. A `@Public()` route passes with or without a user, and any other route without a user gets a 401.

`@Public()` marks sign-up, sign-in, the email links, password reset, public browsing, reference lists, the payment webhook and the probes. `@AllowSuspended()` marks only the five collector helpdesk routes and `GET /me/profile`, so an account suspended for debt can still ask for help. `@AllowAnyStatus()` marks only `POST /auth/logout`. The status check runs before the `@Public()` check. So a suspended or closed account with a live cookie gets a 403 on public routes too, `POST /auth/login` included, until it signs out.

#### `apps/api/src/modules/acc/session.service.ts`

About 1.5 minutes. It builds on T7.4 and T5.4.

`SessionService` opens, checks and ends sign-in sessions. A `login_session` row stores only the SHA-256 hash of an opaque random token, so a leaked table holds no usable cookie. `create` opens a seven-day session, `SESSION_TTL_MS`, with the `ip` and the user agent from `clampUserAgent`. Its optional `tx` lets the second sign-in step open the session in the transaction that spends the code. Using a session never extends its expiry. `resolve` reads the session, the role, the status and whether an `mfa_factor` is enabled, in one query per request. It returns null for a revoked or expired session. It joins `userAccount.id` to `loginSession.userId` through the uuid-text operator of section 2.2, which keeps the primary-key index. A cast to text would make Postgres scan the account table on every request. `revoke` ends one session. `revokeAllFor` ends a user's sessions, optionally except the caller's, and returns the count.

#### `apps/api/src/modules/acc/mfa/mfa-enrollment.guard.ts`, `apps/api/src/modules/acc/mfa/mfa-policy.ts`, `apps/api/src/modules/acc/mfa/allow-without-mfa.decorator.ts`

About 1 minute. It builds on T4.2, T6.3 and T7.6.

`MfaEnrollmentGuard` makes the roles that need two-factor sign-in set it up before anything else. It is the third global guard. It passes `@AllowWithoutMfa()` routes, `@Public()` routes and anonymous requests. A user whose role is in the policy and whose `mfaEnabled` is not `true` gets a 403 `mfa_enrollment_required`. `mfaPolicyProvider` reads `MFA_REQUIRED_ROLES` once. Unset, it means both staff roles in production and nobody elsewhere. `@AllowWithoutMfa()` marks only `GET /auth/mfa`, `setup`, `confirm`, sign-out and `GET /me/profile`, the routes a blocked user needs to enrol. `tests3/contract/mfa-enforcement.test.ts` pins that exact list.

#### `apps/api/src/modules/sec/roles.decorator.ts`, `apps/api/src/modules/sec/roles.guard.ts`

About 1 minute. It builds on T6.3 and T7.7.

These files limit a route to certain roles. `Roles` sets the allowed roles on a handler or a class. `RolesGuard`, the last global guard, passes a route without `Roles`. Otherwise the user's role must be listed, or the request gets a 403. So a route without `@Roles` is open to every signed-in account. No guard checks ownership, so each service must check that the caller owns what it touches.

#### `apps/api/src/modules/sec/audit.interceptor.ts`, `apps/api/src/modules/sec/audit.service.ts`, `apps/api/src/modules/sec/audit.schema.ts`, `apps/api/src/modules/sec/sec.module.ts`, `apps/api/src/modules/sec/pii.ts`

About 1.5 minutes. It builds on T6.7 and T5.6.

These files keep the audit log of who changed what. `AuditInterceptor` is global. After a successful POST, PUT, PATCH or DELETE, it writes a row to the append-only `audit_record`. The row holds the actor, the method and path as `action`, the first path segment after `/api/v1/` as `targetEntity`, the first id-like parameter as `targetId`, and the parameters. The write is not awaited, runs outside the request's transaction and swallows failures, so a row can be lost without notice. The row holds no request body, so it shows which route ran but not what changed. A failed request leaves no row, and failed sign-ins are in `login_attempt`.

`AuditService.record` is one INSERT. Given a `tx`, it commits or rolls back with the change it describes, as in `MfaService` and `WalletRequestService`. The global `SecModule` provides `AuditService`, `AuditInterceptor`, `RolesGuard` and `PiiInterceptor`. `Pii` and `PiiInterceptor` in `pii.ts` are used nowhere.

#### `apps/api/src/modules/acc/acc.module.ts`, `apps/api/src/modules/acc/acc.dto.ts`

About 1 minute. It builds on T6.2, T7.2 and T7.3.

`AccModule` wires the accounts module, and `acc.dto.ts` holds the request shapes it accepts. `AccModule` holds `AuthController`, `ProfileController`, `MfaController` and their services. It exports `SessionService`, `SessionAuthGuard`, `MfaService`, `MfaEnrollmentGuard` and `MFA_POLICY` for the global guards and the admin's two-factor reset. In `RegisterDto`, `username` is 3 to 32 letters, digits, dots, dashes or underscores. It has no `@`, so it cannot look like an email. The name fields refuse markup and control characters. `password` needs 8 characters and is never trimmed, and `acceptedTermsVersion` is required. `LoginDto` takes one `identifier`, an email or a username. The other DTOs, such as `LoginMfaDto` and `ChangePasswordDto`, are small. No DTO accepts `username` after registration, and the `user_account_username_immutable` trigger from migration `0004` refuses the change anyway.

#### `apps/api/src/modules/acc/auth.controller.ts`

About 2 minutes. It builds on T7.3, T7.4, T7.6 and T6.7.

`AuthController` serves sign-up, sign-in, sign-out and the password routes under `/auth`. `login` sets the session cookie and answers `id`, `role` and `mfaEnrollmentRequired`. An account with two-factor sign-in gets `mfa_required` and a `challengeToken` instead. The answer is `no-store`, so it is never cached. `login` sets `req.user` so the audit row names who signed in. `loginMfa` takes the challenge and exactly one of `code` and `recoveryCode`. `logout` is `@AllowWithoutMfa()` and `@AllowAnyStatus()`, so any account can always sign out. The other handlers are `register`, `verifyEmail`, `resend`, `resetRequest`, `reset`, `change` and `revokeOtherSessions`.

`setSessionCookie` sets `httpOnly`, `secure` in production and `sameSite: 'lax'`, and the cookie expires with the session. `CREDENTIAL_ROUTE`, from `AUTH_RATE_LIMIT_PER_MINUTE`, is the rate limit for sign-up and every route that checks a credential. `MAIL_ROUTE`, a fixed 5 a minute, limits the two routes that mail an address the caller chose. Keep credential routes under `/auth`. The error scrubber of section 2.2 drops request bodies only there and under `/me/password`, so an error on a credential route elsewhere would send its password to the error reports.

#### `apps/api/src/modules/acc/auth.service.ts`, `apps/api/src/modules/acc/terms.ts`

About 2 minutes. It builds on T7.2, T7.3, T7.6 and T15.3.

`AuthService` creates accounts and runs both steps of sign-in. `register` refuses any `acceptedTermsVersion` but `CURRENT_TERMS_VERSION` from `terms.ts`. `tests/web/faq-legal.test.ts` checks that constant against the SPA's `TERMS_VERSION`. `register` then normalises the email and username, hashes the password with argon2, inserts a `pending` account with its terms acceptance and sends the verification mail. The unique indexes are the real guard against duplicates, and `isUniqueViolation` catches one that races past the first look-up. Sign-up says when an email is already registered, so it reveals whether an address has an account.

`login` runs `attempt` through `perIdentifier`, an in-memory `OneAtATime` queue per typed identifier. So the lockout counts a burst of guesses one by one, but only within one API process. `attempt` refuses a locked identifier first, even with the right password. It always runs one argon2 verify, against `dummyHash` when nobody matched, so an unknown account looks like a wrong password. A `pending` account gets `email_unverified`, a `closed` one gets `account_suspended`, and a `suspended` one signs in. An account with two-factor sign-in gets a challenge, and others get a session. Every attempt that reaches the password check is logged. `completeSecondFactor` runs in the same queue and checks both the identifier lock and the account's second-factor lock. It then calls `MfaService.redeemChallenge` and logs the outcome.

#### `apps/api/src/modules/acc/login-attempts.service.ts`

About 1.5 minutes. It builds on T7.3, T7.8 and T15.3.

`LoginAttemptService` logs sign-in attempts and decides when an identifier is locked out. `record` writes one `login_attempt` row per attempt, with the typed identifier, account, `LoginOutcome`, IP and user agent. A failed write never breaks sign-in. A failure is a `bad_credentials` or `mfa_failed` row. `lockedFor` reports a lock while the identifier's last 10 failures span at most 15 minutes and the newest is under 15 minutes old. `secondFactorLockedFor` applies the same rule to one account's `mfa_failed` rows, from any identifier or route. `lockedError` is a 429 `rate_limited` with `retryAfterSeconds`. The lock is keyed on what was typed. So an unknown identifier locks like a real one, but an account's email and username count separately. A refusal during a lock writes nothing, so it cannot extend the lock.

#### `apps/api/src/modules/acc/verification.service.ts`, `apps/api/src/modules/acc/password.service.ts`

About 2 minutes. It builds on T7.2, T7.5, T14.3 and T15.3.

These services handle the emailed links and every password change. A link is a single-use `verification_token` row, stored as a hash. `issueEmailVerification` builds a 24-hour link into the SPA's hash route with `emailLink`, and it mails the link at once through `EMAIL_ADAPTER`. In one transaction, `verifyEmail` consumes the token with a conditional UPDATE, so the link works once. It moves the account from `pending` to `active`, and no other status. `resend` mails a fresh link only to a `pending` account. It looks the address up and mails inside the request, so unlike `requestReset` its timing can reveal a pending account.

`change` checks the current password, sets the new one and ends every other session. A wrong current password there is not logged in `login_attempt`, so only the rate limit slows someone with a stolen session who guesses it. `requestReset` only writes the outbox event `PASSWORD_RESET_REQUESTED`, for any address, so its answer reveals nothing. The worker job `apps/worker/src/jobs/password-reset-mail.ts` then looks the address up, creates the token and mails it. `reset` consumes the token and sets the password in one transaction, then ends every session.

#### `apps/api/src/modules/acc/mfa/mfa.controller.ts`

About 1 minute. It builds on T7.6.

`MfaController` is where a signed-in user sets up, checks or turns off two-factor sign-in. Its routes sit under `/auth/mfa`, so the error scrubber drops their bodies. `status`, `setup` and `confirm` are `@AllowWithoutMfa()`, so a blocked staff account can still enrol. `confirm`, `regenerate` and `disable` check codes, so they use the credential rate limit. Responses that carry a secret or recovery codes are `no-store`.

#### `apps/api/src/modules/acc/mfa/mfa.service.ts`

About 3 minutes. It builds on T7.6, T7.7 and T15.1.

`MfaService` sets up, checks and removes the second factor. A TOTP step or a recovery code is spent by a conditional UPDATE, and a challenge is spent under a row lock. Each is spent in the transaction that acts on it, so a code works once even across API processes. `beginSetup` upserts a new sealed secret into `mfa_factor`. Through `setWhere` it writes only while the factor is not enabled, so it cannot replace a working authenticator. It returns an `otpauth` URI, the secret as text and a QR code.

`confirmSetup` checks the password first. One transaction then locks the factor, checks the code, sets `enabledAt` and `lastUsedStep`, and makes ten recovery codes that only this response shows. The same transaction ends every other session and writes an audit row. `regenerateRecoveryCodes` takes a current code and replaces the set in one transaction. `disable` checks the password and a code, and a role that requires a second factor gets `mfa_required_for_role`. These three methods refuse while the account's second factor is locked and log a failure as `mfa_failed`, though `confirmSetup` logs only a wrong password, not a wrong code. `resetFor` lets an admin remove another account's factor and end its sessions, with an audit row, but never their own. `apps/api/src/modules/adm/adm.controller.ts` calls it.

`issueChallenge` stores a five-minute challenge, `CHALLENGE_TTL_MINUTES`, as a hash. `findChallenge` reads a live challenge with fewer failures than `CHALLENGE_MAX_FAILURES`, which is 5. `redeemChallenge` locks and re-checks the challenge, and refuses an account closed since the password step. Then it calls `spendTotp` or `spendRecoveryCode`. A wrong code adds one to `failedAttempts`, and that commits, so the limit of five holds. A right code consumes the challenge and opens the session in the same transaction. `spendTotp` accepts a step only if it is later than `lastUsedStep`, compared inside the UPDATE. So a replayed code fails, and of two copies sent at once only one succeeds. A secret that will not open is a 409 `mfa_factor_unreadable` and one error log line, usually after `MFA_ENCRYPTION_KEY` changed. Recovery codes are hashed under a key derived from it, so after a change they fail like a typo.

#### `apps/api/src/modules/acc/mfa/totp.ts`, `apps/api/src/modules/acc/mfa/secret-box.ts`, `apps/api/src/modules/acc/mfa/recovery-codes.ts`

About 1.5 minutes. It builds on T7.6 and T4.5.

These files are the pure cryptography of two-factor sign-in on `node:crypto`, pinned by `tests3/contract/mfa-crypto.test.ts`. `matchTotp` follows RFC 6238 with HMAC-SHA1, 30-second steps, six digits and one step either side, `TOTP_WINDOW`. It returns the matched step and compares every candidate in constant time, so timing reveals nothing. `sealSecret` and `openSecret` use AES-256-GCM under `MFA_ENCRYPTION_KEY`, with the account id as authenticated data, so a ciphertext copied to another row will not open. A failure is an `UnreadableSecretError`. `deriveSubkey` uses HKDF to give recovery codes their own key. `generateRecoveryCodes` makes ten 12-character Crockford base32 codes. `normalizeRecoveryCode` forgives case, dashes and look-alike letters, and `hashRecoveryCode` stores each as HMAC-SHA256. Back up `MFA_ENCRYPTION_KEY` with the database. Without it, no enrolled account can sign in until an admin resets its second factor.

#### `apps/api/src/modules/acc/profile.controller.ts`, `apps/api/src/modules/acc/profile.service.ts`

About 1.5 minutes. It builds on T7.1 and T13.1.

These files let a user read their profile, fix their name and manage addresses, under `/me`. `get` returns the caller's `ProfileView`, including `nameReviewRequired`, the terms acceptance, `mfaEnabled` and `mfaRequired`. It is `@AllowSuspended()` and `@AllowWithoutMfa()` because the SPA's shell boots from it. `update` writes only `firstName` and `lastName` and clears `nameReviewRequired`. `listAddresses` returns the caller's addresses. `updateAddress` and `deleteAddress` find an address by its id and the caller's id, so another person's address is a 404. `country` must pass `IsShippableCountry` and is stored through `toCountryCode`. `regionFor` checks `region` with `normalizeRegion`. A US or Canadian address needs a known two-letter code, stored upper-cased, and elsewhere the region is optional free text. An edit re-checks the pair only when it changes `country` or `region`. A new default demotes the old one in the same transaction. No unique index enforces a single default, so two saves at once can leave two defaults.

#### `apps/api/src/modules/acc/acc.schema.ts`, `apps/api/src/modules/acc/address.schema.ts`, `apps/api/src/modules/acc/intake-id.ts`

About 1 minute. It builds on T5.4, T7.1 and T7.2.

These files define the account tables. `userAccount` has a `status` from `accountStatus`, a `role` from `userRole`, and a unique `email` and `username`. `autoSuspendedAt` marks a debt-sweep suspension. The sweep lifts only those, and any status an admin sets clears it. `user_account_terms_acceptance_complete` keeps the two terms columns both set or both empty. Only the seed writes `intakeId` and `legacyDisplayName`, and nothing calls `generateIntakeId` in `intake-id.ts`. The other tables are `verificationToken`, `loginSession`, `loginAttempt`, `mfaFactor`, `mfaRecoveryCode`, `mfaChallenge` and `shippingAddress`. `shippingAddress.region` came with migration `0037` and is nullable, so older rows have none. Every `user_id` here is `text` with no foreign key.

#### `apps/api/src/modules/sup/sup.controller.ts`, `apps/api/src/modules/sup/sup.module.ts`

About 1 minute. It builds on T7.1, T7.7 and T6.3.

`SupController` serves the helpdesk under `/support`, and `SupModule` wires it to `SupportService`. The collector routes are `mine`, `open`, `thread`, `reply` and `awaiting`, all `@AllowSuspended()`. The staff routes are `queue`, `queueCount`, `assign` and `resolve`, all under `@Roles('warehouse_operator', 'admin')`. `CATEGORIES` includes `private_sale`. The service's `TicketCategory` type does not, but the database enum accepts it, so such a ticket saves normally.

#### `apps/api/src/modules/sup/support.service.ts`, `apps/api/src/modules/sup/sup.schema.ts`

About 2 minutes. It builds on T15.1, T14.3 and T5.6.

`SupportService` runs tickets between a collector and staff. The status says whose turn it is. It is `open` when staff must answer, `awaiting_customer` when the customer must, or `resolved`. The method `open` writes the ticket, with a `TKT-` code, and its first message in one transaction. `loadFor` shows staff every ticket and a collector only their own, and another person's ticket reads as a 404. `staff` requires an `active` account as well as a staff role. So a staff role on a suspended account gets a 403 on another person's ticket, and on its own tickets its replies count as a customer's.

`reply` sets the status by who spoke, so a customer reply reopens a resolved ticket. A staff reply also claims an unassigned ticket and emits `support_ticket_replied`. `resolve` and `assign` are conditional UPDATEs, so when two staff click at once, one acts and the other gets a 409. `resolve` emits `support_ticket_resolved`. `listQueue` lists unresolved tickets, longest wait first. `supportMessage` is append-only, and both sides see every message. `relatedType` and `relatedId` are free text, and nothing checks them against a real record or the customer.

#### `apps/api/src/modules/med/med.controller.ts`, `apps/api/src/modules/med/med.module.ts`, `apps/api/src/modules/med/med.schema.ts`

About 1 minute. It builds on T7.10, T9.1 and T9.2.

These files take photo uploads and record each stored image. `POST /media/uploads` is staff only, so collectors cannot upload. `UploadDto` takes `contentType`, `dataBase64` and a `purpose` of `item_intake` or `parcel`. `MedModule` is global, so the inbound module `inv` and the marketplace module `mkt` inject `MediaService` freely. `mediaUpload` keeps one `media_upload` row per stored image, with key, purpose, uploader, sniffed type and size. The wallet request's `documentKey` is free text the requester types in. Its shape is checked, but nothing uploads it, looks it up or signs it.

#### `apps/api/src/modules/med/media.service.ts`

About 2 minutes. It builds on T7.10, T9.1 and T9.2.

`MediaService` stores photos and checks that a photo key may go on a record. A client uploads the bytes first and names the returned key when it creates the record. `upload` needs a declared type in `ALLOWED_TYPES`. `decodedLength` checks `MAX_IMAGE_BYTES`, 10 MB, before decoding, so an oversized body is refused cheaply. `sniffImageType` takes the real type from the first bytes and refuses anything else. The key is built from a purpose prefix, the year and month and a UUID, and never from caller input. A store failure is a 503 `storage_unavailable`, and the row is written only after the bytes are stored.

`assertAttachable` normally runs in the caller's transaction. Each key must have no `.` or `..` segment, must be recorded in `media_upload`, and must have the expected purpose. It must also be the actor's own upload or a colleague's from the last 30 minutes, `FOREIGN_UPLOAD_WINDOW_MS`. `IntakeService`, `ParcelService` and `HouseStoreService` call it. `signed` and `signAll` return signed URLs and drop a key that cannot be signed. Nothing records that a key was attached, so one upload can go on several records, and unattached uploads are never removed.
