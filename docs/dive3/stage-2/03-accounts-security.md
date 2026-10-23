## 2.3 Accounts, security, support and media

This section covers four modules. `acc` holds accounts, sessions and two-factor sign-in, `sec` holds roles and audit, `sup` is the helpdesk and `med` stores photos. Read the guards first, in the order a request meets them after the rate limits of section 2.2. Then read the account flows, two-factor sign-in, the profile and the schema, and end with the helpdesk and media. The section takes about 30 minutes.

#### `apps/api/src/modules/sec/auth-context.ts`, `apps/api/src/modules/sec/current-user.decorator.ts`

About 1 minute. It builds on T6.3, T7.1 and T7.7.

`AuthUser` is what an authenticated request carries. It holds the `id`, a `Role` of `user`, `warehouse_operator` or `admin`, an `AccountStatus` and `mfaEnabled`. The file adds `user` to Express's `Request`. `CurrentUser` hands that user to a handler and answers 401 when there is none.

#### `apps/api/src/modules/acc/session-auth.guard.ts`, `apps/api/src/modules/acc/public.decorator.ts`, `apps/api/src/modules/acc/allow-suspended.decorator.ts`, `apps/api/src/modules/acc/allow-any-status.decorator.ts`

About 1.5 minutes. It builds on T6.3, T7.1 and T7.4.

`SessionAuthGuard` is the second global guard. `canActivate` resolves the `SESSION_COOKIE_NAME` cookie with `SessionService.resolve`. An account that is not `active` gets a 403 `account_suspended`. The exceptions are a `suspended` account on an `@AllowSuspended()` route and any account on an `@AllowAnyStatus()` route. The guard then sets `req.user`. A `@Public()` route passes, and any other route without a user gets a 401.

`@Public()` marks sign-up, sign-in, email links, reset, public browsing, reference lists, the payment webhook and the probes. `@AllowSuspended()` marks only the five collector helpdesk routes and `GET /me/profile`, so an account suspended for debt can ask for help. `@AllowAnyStatus()` marks only `POST /auth/logout`. The status check runs before the `@Public()` check. So a suspended or closed account with a live cookie gets a 403 on public routes too, `POST /auth/login` included, until it signs out.

#### `apps/api/src/modules/acc/session.service.ts`

About 1.5 minutes. It builds on T7.4 and T5.4.

`login_session` stores only the SHA-256 hash of an opaque random token. `create` opens a seven-day session, `SESSION_TTL_MS`, with the `ip` and the user agent from `clampUserAgent`. Its optional `tx` lets the second sign-in step open the session in the transaction that spends the code. Using the session never extends its expiry. `resolve` reads the session, the role, the status and whether an `mfa_factor` is enabled in one query per request. It gives null for a revoked or expired session. It joins `userAccount.id` to `loginSession.userId` through the uuid-text operator of section 2.2, which keeps the primary-key index. A cast to text would scan the account table on every request. `revoke` ends one session. `revokeAllFor` ends a user's sessions, optionally except the caller's, and returns the count.

#### `apps/api/src/modules/acc/mfa/mfa-enrollment.guard.ts`, `apps/api/src/modules/acc/mfa/mfa-policy.ts`, `apps/api/src/modules/acc/mfa/allow-without-mfa.decorator.ts`

About 1 minute. It builds on T4.2, T6.3 and T7.6.

`MfaEnrollmentGuard` is the third global guard. It passes `@AllowWithoutMfa()`, `@Public()` and anonymous requests. A user whose role is in the policy and whose `mfaEnabled` is not `true` gets a 403 `mfa_enrollment_required`. `mfaPolicyProvider` reads `MFA_REQUIRED_ROLES` once. When it is unset, it means both staff roles in production and nobody elsewhere. `@AllowWithoutMfa()` marks only `GET /auth/mfa`, `setup`, `confirm`, sign-out and `GET /me/profile`, and `tests3/contract/mfa-enforcement.test.ts` pins that list.

#### `apps/api/src/modules/sec/roles.decorator.ts`, `apps/api/src/modules/sec/roles.guard.ts`

About 1 minute. It builds on T6.3 and T7.7.

`Roles` sets the allowed roles on a handler or a class. `RolesGuard`, the last global guard, passes a route without `Roles`. Otherwise the user's role must be listed, or the request gets a 403. So a route without `@Roles` is open to every signed-in account. Ownership is never a guard, and each service checks it.

#### `apps/api/src/modules/sec/audit.interceptor.ts`, `apps/api/src/modules/sec/audit.service.ts`, `apps/api/src/modules/sec/audit.schema.ts`, `apps/api/src/modules/sec/sec.module.ts`, `apps/api/src/modules/sec/pii.ts`

About 1.5 minutes. It builds on T6.7 and T5.6.

`AuditInterceptor` is global. After a successful POST, PUT, PATCH or DELETE it writes a row to the append-only `audit_record`. The row holds the actor, the method and path as `action`, the first path segment as `targetEntity`, the first id-like parameter as `targetId`, and the parameters. The write is not awaited, runs outside the request's transaction and swallows failures, so a row can be lost. The row holds no request body, so it shows which route ran but not what changed. A failed request leaves no row, and failed sign-ins are in `login_attempt`.

`AuditService.record` is one INSERT, and with a `tx` it commits with the change, as in `MfaService` and `WalletRequestService`. The global `SecModule` provides `AuditService`, `AuditInterceptor`, `RolesGuard` and `PiiInterceptor`. `Pii` and `PiiInterceptor` in `pii.ts` are used nowhere.

#### `apps/api/src/modules/acc/acc.module.ts`, `apps/api/src/modules/acc/acc.dto.ts`

About 1 minute. It builds on T6.2, T7.2 and T7.3.

`AccModule` holds `AuthController`, `ProfileController`, `MfaController` and their services. It exports `SessionService`, `SessionAuthGuard`, `MfaService`, `MfaEnrollmentGuard` and `MFA_POLICY` for the global guards and the admin's two-factor reset. In `RegisterDto`, `username` is 3 to 32 letters, digits, dots, dashes or underscores. It has no `@`, so it cannot look like an email. The name fields refuse markup and control characters. `password` needs 8 characters and is never trimmed, and `acceptedTermsVersion` is required. `LoginDto` takes one `identifier`, an email or a username. The other DTOs, such as `LoginMfaDto` and `ChangePasswordDto`, are small. No DTO accepts `username` after registration, and the `user_account_username_immutable` trigger from migration `0004` refuses the write anyway.

#### `apps/api/src/modules/acc/auth.controller.ts`

About 2 minutes. It builds on T7.3, T7.4, T7.6 and T6.7.

`login` sets the session cookie and answers `id`, `role` and `mfaEnrollmentRequired`. An enrolled account gets `mfa_required` and a `challengeToken` instead, and the answer is never cached. `login` sets `req.user` so the audit row names the actor. `loginMfa` takes the challenge and exactly one of `code` and `recoveryCode`. `logout` is `@AllowWithoutMfa()` and `@AllowAnyStatus()`. The other handlers are `register`, `verifyEmail`, `resend`, `resetRequest`, `reset`, `change` and `revokeOtherSessions`.

`setSessionCookie` sets `httpOnly`, `secure` in production and `sameSite: 'lax'`, and the cookie expires with the session. `CREDENTIAL_ROUTE`, from `AUTH_RATE_LIMIT_PER_MINUTE`, meters sign-up and every route that checks a credential. `MAIL_ROUTE`, a fixed 5 a minute, meters the two routes that mail an address the caller chose. Keep credential routes under `/auth`, because the error scrubber of section 2.2 drops request bodies only there and under `/me/password`.

#### `apps/api/src/modules/acc/auth.service.ts`, `apps/api/src/modules/acc/terms.ts`

About 2 minutes. It builds on T7.2, T7.3, T7.6 and T15.3.

`register` refuses any `acceptedTermsVersion` but `CURRENT_TERMS_VERSION` from `terms.ts`, which `tests/web/faq-legal.test.ts` checks against the SPA's `TERMS_VERSION`. It normalises email and username, hashes with argon2, inserts a `pending` account with its terms acceptance and sends the verification mail. The unique indexes are the real guard against duplicates, and `isUniqueViolation` catches a racing duplicate. Sign-up says when an email is already registered, so it reveals whether an address has an account.

`login` runs `attempt` through `perIdentifier`, an in-memory `OneAtATime` queue. So the lockout counts a burst one by one, within one API process. `attempt` refuses a locked identifier first, even with the right password. It always runs one argon2 verify, against `dummyHash` when nobody matched, so an unknown account looks like a wrong password. `pending` gets `email_unverified`, `closed` gets `account_suspended`, and `suspended` signs in. An enrolled account gets a challenge, and others get a session. Every attempt that reaches the password check is logged. `completeSecondFactor` runs in the same queue, checks both locks, calls `MfaService.redeemChallenge` and records the outcome.

#### `apps/api/src/modules/acc/login-attempts.service.ts`

About 1.5 minutes. It builds on T7.3, T7.8 and T15.3.

`record` writes one `login_attempt` row per attempt, with the typed identifier, account, `LoginOutcome`, IP and user agent. A failed write never breaks sign-in. `lockedFor` reports a lock while the identifier's last 10 failures span at most 15 minutes and the newest is under 15 minutes old. A failure is `bad_credentials` or `mfa_failed`. `secondFactorLockedFor` applies the same rule to one account's `mfa_failed` rows, from any identifier or route. `lockedError` is a 429 `rate_limited` with `retryAfterSeconds`. The lock is keyed on what was typed. So an unknown identifier locks like a real one, but an account's email and username count separately. A refusal during a lock writes nothing, so it cannot extend the lock.

#### `apps/api/src/modules/acc/verification.service.ts`, `apps/api/src/modules/acc/password.service.ts`

About 2 minutes. It builds on T7.2, T7.5, T14.3 and T15.3.

A link is a single-use `verification_token` row, stored as a hash. `issueEmailVerification` builds a 24-hour link into the SPA's hash route with `emailLink` and mails it at once through `EMAIL_ADAPTER`. In one transaction, `verifyEmail` consumes the token with a conditional UPDATE and moves the account from `pending` to `active`. It moves no other status. `resend` mails a fresh link only to a `pending` account. It looks the address up and mails inside the request, so unlike `requestReset` its timing can reveal a pending account.

`change` checks the current password, sets the new one and ends every other session. A wrong current password there is not logged in `login_attempt`, so only the rate limit slows a stolen session guessing it. `requestReset` only writes the outbox event `PASSWORD_RESET_REQUESTED`, for any address. The worker job `apps/worker/src/jobs/password-reset-mail.ts` looks the address up, mints the token and mails it. `reset` consumes the token and sets the password in one transaction, then ends every session.

#### `apps/api/src/modules/acc/mfa/mfa.controller.ts`

About 1 minute. It builds on T7.6.

`MfaController` is the signed-in half of two-factor sign-in, under `/auth/mfa` so the error scrubber drops its bodies. `status`, `setup` and `confirm` are `@AllowWithoutMfa()`, so a staff account can enrol. `confirm`, `regenerate` and `disable` check codes and use the credential rate limit. Responses that carry a secret or recovery codes are `no-store`.

#### `apps/api/src/modules/acc/mfa/mfa.service.ts`

About 3 minutes. It builds on T7.6, T7.7 and T15.1.

A TOTP step or a recovery code is spent by a conditional UPDATE, and a challenge is spent under a row lock. Each is spent in the transaction that acts on it, so a code works once even across API processes. `beginSetup` upserts a new sealed secret into `mfa_factor` only while the factor is not enabled, through `setWhere`. It returns an `otpauth` URI, the secret as text and a QR code.

`confirmSetup` checks the password and a code. One transaction then locks the factor, sets `enabledAt` and `lastUsedStep` and makes ten recovery codes that only this response shows. The same transaction ends every other session and writes an audit row. `regenerateRecoveryCodes` takes a current code and replaces the set in one transaction. `disable` checks the password and a code, and a role that requires a second factor gets `mfa_required_for_role`. These three methods refuse while the second factor is locked and log a failure as `mfa_failed`. `resetFor` lets an admin remove another account's factor and end its sessions, with an audit row, but never their own. `apps/api/src/modules/adm/adm.controller.ts` calls it.

`issueChallenge` stores a five-minute challenge, `CHALLENGE_TTL_MINUTES`, as a hash. `findChallenge` reads a live challenge with fewer failures than `CHALLENGE_MAX_FAILURES`, which is 5. `redeemChallenge` locks and re-checks the challenge and refuses an account closed since the password step. Then it calls `spendTotp` or `spendRecoveryCode`. A wrong code increments `failedAttempts`, and that commits. A right code consumes the challenge and opens the session in the same transaction. `spendTotp` accepts a step only if it is later than `lastUsedStep`, compared inside the UPDATE, so a replayed or simultaneous code fails. A secret that will not open is a 409 `mfa_factor_unreadable` and one error log line, usually after `MFA_ENCRYPTION_KEY` changed. Recovery codes are hashed under a key derived from it, so after a change they fail like a typo.

#### `apps/api/src/modules/acc/mfa/totp.ts`, `apps/api/src/modules/acc/mfa/secret-box.ts`, `apps/api/src/modules/acc/mfa/recovery-codes.ts`

About 1.5 minutes. It builds on T7.6 and T4.5.

These files are pure crypto on `node:crypto`, pinned by `tests3/contract/mfa-crypto.test.ts`. `matchTotp` follows RFC 6238 with HMAC-SHA1, 30-second steps, six digits and one step either side, `TOTP_WINDOW`. It returns the matched step and compares every candidate in constant time. `sealSecret` and `openSecret` use AES-256-GCM under `MFA_ENCRYPTION_KEY`, with the account id as authenticated data, so a ciphertext copied to another row will not open. A failure is an `UnreadableSecretError`. `deriveSubkey` uses HKDF to give recovery codes their own key. `generateRecoveryCodes` makes ten 12-character Crockford base32 codes. `normalizeRecoveryCode` forgives case, dashes and look-alike letters, and `hashRecoveryCode` stores each as HMAC-SHA256. Back up `MFA_ENCRYPTION_KEY` with the database, because without it every enrolled account needs an admin reset.

#### `apps/api/src/modules/acc/profile.controller.ts`, `apps/api/src/modules/acc/profile.service.ts`

About 1.5 minutes. It builds on T7.1 and T13.1.

`get` returns the caller's `ProfileView`, including `nameReviewRequired`, the terms acceptance, `mfaEnabled` and `mfaRequired`. It is `@AllowSuspended()` and `@AllowWithoutMfa()` because the SPA's shell boots from it. `update` writes only `firstName` and `lastName` and clears `nameReviewRequired`. `listAddresses`, `addAddress`, `updateAddress` and `deleteAddress` find an address by its id and the caller's id. `country` must pass `IsShippableCountry` and is stored through `toCountryCode`. `regionFor` checks `region` with `normalizeRegion`. A US or Canadian address needs a known two-letter code, stored upper-cased, and elsewhere the region is optional free text. An edit re-checks the pair only when it changes `country` or `region`. A new default demotes the old one in the same transaction. No unique index enforces a single default address, so two concurrent saves can leave two defaults.

#### `apps/api/src/modules/acc/acc.schema.ts`, `apps/api/src/modules/acc/address.schema.ts`, `apps/api/src/modules/acc/intake-id.ts`

About 1 minute. It builds on T5.4, T7.1 and T7.2.

`userAccount` has `accountStatus`, `userRole`, and a unique `email` and `username`. `autoSuspendedAt` marks a debt-sweep suspension. The sweep lifts only those, and any status an admin sets clears it. `user_account_terms_acceptance_complete` keeps the two terms columns set together. Only the seed writes `intakeId` and `legacyDisplayName`, and nothing calls `generateIntakeId` in `intake-id.ts`. The other tables are `verificationToken`, `loginSession`, `loginAttempt`, `mfaFactor`, `mfaRecoveryCode`, `mfaChallenge` and `shippingAddress`. `shippingAddress.region` came with migration `0037` and is nullable, so older rows have none. Every `user_id` here is `text` with no foreign key.

#### `apps/api/src/modules/sup/sup.controller.ts`, `apps/api/src/modules/sup/sup.module.ts`

About 1 minute. It builds on T7.1, T7.7 and T6.3.

`SupController` serves `/support`, and `SupModule` wires it to `SupportService`. The collector routes are `mine`, `open`, `thread`, `reply` and `awaiting`, all `@AllowSuspended()`. The staff routes are `queue`, `queueCount`, `assign` and `resolve`, all under `@Roles('warehouse_operator', 'admin')`. `CATEGORIES` includes `private_sale`. The service's `TicketCategory` type does not, but the database enum accepts it.

#### `apps/api/src/modules/sup/support.service.ts`, `apps/api/src/modules/sup/sup.schema.ts`

About 2 minutes. It builds on T15.1, T14.3 and T5.6.

The status says whose turn it is. It is `open` for staff, `awaiting_customer` for the customer, or `resolved`. `open` writes the ticket, with a `TKT-` code, and its first message in one transaction. `loadFor` shows staff every ticket and a collector only their own, and another person's ticket reads as a 404. `staff` requires an `active` account. So a staff role on a suspended account gets a 403 on another person's ticket, and its own replies count as a customer's.

`reply` sets the status by who spoke, so a customer reply reopens a resolved ticket. A staff reply claims an unassigned ticket and emits `support_ticket_replied`. `resolve` and `assign` are conditional UPDATEs, so two staff clicking together act once. `resolve` emits `support_ticket_resolved`. `listQueue` lists unresolved tickets, longest wait first. `supportMessage` is append-only, and both sides see every message. `relatedType` and `relatedId` are free text, and nothing checks them against a real record or the customer.

#### `apps/api/src/modules/med/med.controller.ts`, `apps/api/src/modules/med/med.module.ts`, `apps/api/src/modules/med/med.schema.ts`

About 1 minute. It builds on T7.10, T9.1 and T9.2.

`POST /media/uploads` is staff only, so collectors cannot upload. `UploadDto` takes `contentType`, `dataBase64` and a `purpose` of `item_intake` or `parcel`. `MedModule` is global, so `inv` and `mkt` inject `MediaService` freely. `mediaUpload` keeps one `media_upload` row per stored image, with key, purpose, uploader, sniffed type and size. The wallet request's `documentKey` is text the requester types in. Its shape is checked, but nothing uploads it, looks it up or signs it.

#### `apps/api/src/modules/med/media.service.ts`

About 2 minutes. It builds on T7.10, T9.1 and T9.2.

A client uploads the bytes for a key first and names the key when it creates the record. `upload` needs a declared type in `ALLOWED_TYPES`, and `decodedLength` checks `MAX_IMAGE_BYTES`, 10 MB, before decoding. `sniffImageType` takes the real type from the first bytes and refuses anything else. The key is built from a prefix, the year and month and a UUID, and never from caller input. A store failure is a 503 `storage_unavailable`, and the row is written only after the bytes are stored.

`assertAttachable` runs in the caller's transaction. Each key must be safe, recorded and of the expected purpose. It must also be the actor's own or a colleague's from the last 30 minutes, `FOREIGN_UPLOAD_WINDOW_MS`. `IntakeService`, `ParcelService` and `HouseStoreService` call it. `signed` and `signAll` return signed URLs and drop a key that cannot be signed. Nothing records that a key was attached, so one upload can go on several records, and unattached uploads are never removed.
