## 2.9 The web app

`apps/web` is a React 19 single-page app built with Vite, with no router, state or form library: about 100 files and 30,000 lines, a third of them catalogue and stylesheet. Read boot, the shell and routing, the shared modules, then the screens: customer, warehouse, admin. Almost every screen loads with `api`, keeps state in `useState`, puts its tab and open record in the URL, and reports through `ErrorState` and `SuccessNote`, so after the first few read only what differs. Budget: 45 minutes.

#### `apps/web/index.html`, `apps/web/src/main.tsx` · 1 min · T16.1, T16.4
- `index.html` sets `lang="he"` and `dir="rtl"` before any script runs, so the first paint is Hebrew, right to left. It links `favicon-32.png` and `apple-touch-icon.png` from `assets/`, the B the rail shows.
- `main.tsx` nests `ThemeProvider`, `I18nProvider`, `ErrorBoundary` and `App`. The boundary sits inside the providers, so a crash still renders in the viewer's theme and direction.

#### `apps/web/vite.config.ts`, `apps/web/proxy-target.ts` · 1 min · T3.5, T4.2, T16.3
The dev server, the preview server and the build.
- `/api` is proxied to the target `resolveApiProxyTarget` picks (`VITE_API_PROXY_TARGET`, else `API_PORT`, else `DEFAULT_API_PORT`). The browser sees one origin, as in production, so the API needs no CORS.
- A dead API gets a 503 with code `api_unreachable`, which `api.ts` reads as `unreachable`.
- `vite build` forces `NODE_ENV=production` and refuses to start when `apps/web`'s env files ask for `development` (`nodeEnvInEnvFiles`). A development bundle would ship the seeded credentials `SignInPage` pre-fills; `tests/web/no-credentials-in-bundle.test.ts` checks the output.

#### `apps/web/src/index.css` · 1.5 min · T16.4, T16.5
Tokens first, then every component class.
- The `:root` token block: three faces (`--font-mono` for codes only), ten type sizes, a 4px spacing scale, one `--radius`, one `--shadow-overlay`, and five accents with one job each: `--custody` (in Bault's care), `--brass` (money), `--frost` (held), `--amber` (warning), `--oxblood` (irreversible). A legacy block maps old names (`--navy`, `--gold`) onto them.
- `[data-density='warehouse']` and `[data-density='marketing']` reset spacing and row height for the same components.
- Only logical properties (`margin-inline-start`), so Hebrew and English are one layout, mirrored.
- Mono comes only from `code`, `.code`, `.mono`, `.serial`, `.code-inline` and two counters. A cell or detail value with `dir="ltr"` stays in the UI face, so money, dates and e-mails in it are not set as codes.
- `scripts/design-lint.mjs` enforces five rules: no physical properties (in CSS, class names or inline styles), no off-scale px lengths, no literal radius or shadow, no raw colour outside the token block, mono only on code selectors. A `design-lint-allow:` comment exempts a line.

**Watch:** dark mode is two identical blocks, `:root:not([data-theme='light'])` inside the `prefers-color-scheme` query and `:root[data-theme='dark']`; change both. CI does not run the linter: run `node scripts/design-lint.mjs` yourself.

#### `apps/web/src/App.tsx` · 2.5 min · T16.1, T16.2, T7.6
What to show before sign-in, then the shell.
- `TOKEN_ROUTES` (`verify-email`, `reset-password`) render first, signed in or not; `LANDING_ROUTES` next, without waiting for the session.
- `probeSession` calls `loadProfile` once. A 401 means `anonymous` and shows `AuthPage`. Any other failure means `blocked`: an error screen with a retry button, never the sign-in form.
- After sign-in the role picks the first section: `admin`, `warehouse` or `vault`. `mustEnrolSecondFactor` holds staff on `ForcedEnrollmentPage`, because the API refuses them everything else.
- `Workspace` filters `SECTIONS` by `requires` (`staff`, `admin`); a `suspended` account gets only `support`. The section comes from the hash, then the last visited one, then the role's fallback, which also replaces an unknown or forbidden section.
- `<main key={section}>` remounts only on a section change; tabs, drawers and a language switch update in place.
- `Workspace` sets `document.title` to the section's title and Bault, and puts back plain Bault when it unmounts.

**Watch:** the rail filter is presentation. The API's role guards are the enforcement (T6.3).

#### `apps/web/src/shared/routing.ts` · 1 min · T16.2
A hash router with no dependency: `#/<section>/<tab>?<params>`.
- `useRoute` reads the hash through `useSyncExternalStore`. `navigate` writes it and remembers the section under `bault.tab`; redirects pass `replace`, so Back skips them.
- `useNavigation` returns `goTab`, `openRecord` and `closeRecord` (an open drawer is a URL parameter, so Back closes it), and `setParams` for filters.
- `legacyRedirect` sends retired links such as `#/wallet/topup` to their current tabs.

**Watch:** a renamed tab needs a `LEGACY_TABS` entry, or old links land on the default tab.

#### `apps/web/src/shared/api.ts` · 1.5 min · T16.3, T6.3, T6.4
The only HTTP client: `api.get`, `post`, `patch`, `put` and `del` call `/api/v1` with `credentials: 'include'` and a JSON content type.
- A failure throws an `ApiError` with a `kind` (`unreachable`, `unauthenticated`, `forbidden`, `not_found`, `server`, `client`), the status and the envelope's `code`.
- `apiErrorKey` maps a kind to an i18n key, or `null` for `client` errors, whose API message is more specific.
- Only `post` takes extra headers, which is how an `Idempotency-Key` travels. Nothing retries automatically.

**Watch:** keep the JSON content type on every write: the API's `jsonBodiesOnly` refuses any other (a CSRF defence), which is why uploads go as base64 JSON. Most screens show `(e as Error).message`, the API's English text, even in Hebrew; only `App.tsx`, `ProfilePage`, `VerifyEmailPage` and `ResetPasswordPage` use `apiErrorKey`, and the last two word a stale link (410) themselves.

#### `apps/web/src/shared/session.ts`, `apps/web/src/shared/twoFactor.ts`, `apps/web/src/shared/names.ts` · 1 min · T7.1, T7.4, T7.6
- The cookie is httpOnly, so `loadProfile` (`GET /me/profile`) is the only way to know who is signed in. Concurrent calls share one request; `resetProfileRequest` clears it on sign-in, enrolment and sign-out.
- `mustEnrolSecondFactor` is `mfaRequired` without `mfaEnabled`.
- `names.ts` repeats the API's username and name rules (`isValidUsername`, `normalizeNamePart`) and builds `fullName`.

#### `apps/web/src/shared/i18n.tsx` · 1 min · T16.4
Hebrew and English with no library; nearly all of it is the two catalogues.
- `he` is the source of truth. `MessageKey` derives from it and `en` is a `Record<MessageKey, string>`, so a missing English string fails the type check.
- `t` fills `{placeholders}` and falls back to the key itself; `hasMessage` checks a key built at runtime.
- `I18nProvider` stores the choice under `bault.locale` and sets `<html lang>` and `<html dir>`. Nothing reloads.

**Watch:** the provider calls `localStorage` without `try`, unlike `theme.tsx` and `routing.ts`. Where storage is blocked it throws outside the `ErrorBoundary`, and the page stays blank. Keys built from template strings escape the type check.

#### `apps/web/src/shared/theme.tsx`, `apps/web/src/shared/hooks.ts` · 1 min · T16.5, T14.4
- `ThemeProvider`: `light`, `dark` or `system` (default), stored under `bault.theme`. `system` removes `data-theme` and follows the OS live.
- `usePrefersReducedMotion` has no caller; CSS handles reduced motion.
- `useNotificationFeed` loads `GET /notifications` for the bell and the notifications page. The API has no read flag, so "unseen" means newer than this browser's `bault.notificationsSeenAt`.

#### `apps/web/src/shared/ui/primitives.tsx`, `apps/web/src/shared/ui/DetailDrawer.tsx`, `apps/web/src/shared/ui/Serial.tsx` · 2 min · T16.4, T16.5, T6.5
The design-system primitives every screen is built from.
- `Button`: `gold` is the one primary action in a view. `loading` disables it and sets `aria-busy`, the client's guard against a double press.
- `Field` links its child to the hint or error (`role="alert"`). `MoneyField` is the amount input, `dir="ltr"` with a decimal keypad.
- `ContextTabs` is an ARIA tab list whose arrow keys mirror in RTL. `Panel`, `StatusBadge`, `EmptyState` and `SkeletonTable` are presentational.
- `DetailDrawer` and `ConfirmationModal` trap focus and return it to the opener; `isTopOverlay` gives Escape to the topmost. `dirty` stops an outside click closing a drawer; `busy` stops the modal closing mid-action.
- `Serial`, `Code`, `Amount` and `LtrRun` isolate Latin runs (serials, bins, money) as left-to-right. `ItemPick` names a card in a picker by its serial and description.

**Watch:** any new serial, code, amount or e-mail on screen goes through these or gets `dir="ltr"`; otherwise it reorders inside Hebrew.

#### `apps/web/src/shared/ui/PageHeader.tsx`, `apps/web/src/shared/ui/NavigationRail.tsx`, `apps/web/src/shared/ui/navRailState.ts`, `apps/web/src/shared/ui/ErrorBoundary.tsx` · 1 min · T16.1, T16.2
- `PageHeader` holds title and breadcrumb, with `AccountPill` (`@username`, or the suspended state), `ThemeToggle`, `LanguageSwitcher`, `NotificationBell` and `UserMenu`.
- The rail expands while hovered or focused and is never pinned. `navRailReducer` is its pure state machine, so `tests/web/nav-rail.test.ts` needs no DOM.
- `ErrorBoundary` offers Try again and Reload. Its text is English only.

#### `apps/web/src/shared/money.ts` · 1 min · T5.5, T8.2, T16.4
Amounts travel as integer cents and are all USD.
- `formatUsd` ignores any currency from the API. `formatLedgerAmount` signs a ledger row from its `direction`.
- `dollarsToCents` parses what a person typed ("1,250.50") and returns `null` for blank, malformed, zero or negative input. `centsToDollars` pre-fills a field.
- `formatDate` and `formatDateTime` use `he-IL` or `en-US`.

**Watch:** convert at the input and keep cents everywhere else. A field where $0 is valid cannot use `dollarsToCents`.

#### `apps/web/src/shared/walletRequests.ts` · 1 min · T8.6, T8.7
The client's copy of the cash-in and cash-out rules.
- `WALLET_REQUEST_STATUSES`, `WALLET_REQUEST_LIMITS` and `FUNDING_SOURCES` copy `apps/api/src/modules/pay/wallet-request.rules.ts` by value.
- `validateDraft` returns a message key per field. `findOpenDuplicate` applies the API's `isDuplicateOf` test (type, amount, currency, reference) before sending.
- `canCancel` holds only for `submitted` and `pending_review`. In `WALLET_REQUEST_TONE` only `completed` is green: only completion moves money.

**Watch:** nothing imports the API file. A limit or status changed there must be changed here.

#### `apps/web/src/shared/market.ts`, `apps/web/src/shared/escrow.ts`, `apps/web/src/shared/parcels.ts`, `apps/web/src/shared/shipments.ts`, `apps/web/src/shared/carriers.ts`, `apps/web/src/shared/grading.ts`, `apps/web/src/shared/itemClasses.ts`, `apps/web/src/shared/serviceLabels.ts`, `apps/web/src/shared/support.ts`, `apps/web/src/shared/signIns.ts`, `apps/web/src/shared/notifications.ts`, `apps/web/src/shared/membership.ts` · 1 min · T2, T11.5, T12.2, T13.1
Response types, a status-to-tone map and label functions per domain, such as `ESCROW_TONE`, `ruleLabel` (the rule a refused rate failed) and `ITEM_CLASSES`. `itemName` and `itemPickText` name a card by its description, or its class in words when it has none. `storefrontHref` builds a seller's page link.

**Watch:** `tierAction` repeats the proration in `MembershipService.subscribe` so the confirm button shows the exact charge; change both together. `tests/web/notification-catalogue.test.ts` fails when `EVENT_LABEL_KEY` and the API's events drift.

#### `apps/web/src/shared/servicePrices.ts`, `apps/web/src/shared/countries.ts`, `apps/web/src/shared/useVaultItems.ts`, `apps/web/src/shared/Barcode.tsx`, `apps/web/src/shared/barcode128.ts`, `apps/web/src/shared/CardPhoto.tsx`, `apps/web/src/shared/ui/PhotoInput.tsx` · 1 min · T8.5, T9.3, T13.1
- `useServicePrices` loads `GET /pricing/list` once per page load. `SERVICE_FEE_ACTION` maps a card service to its rule; `priceLabel` shows a percentage rule as a percentage, never dollars.
- `useShippingCountries` and `useVaultItems` load `GET /shipping/countries` and `GET /vault/items`. `lacksRegion` says whether an address needs a state or province it doesn't have.
- `barcodeSvg` draws Code 128B for `Barcode` and `printBarcodes`. `cardPhotoUrl` points at `/images/<SERIAL>` in the repo-root `assets/`, trying `.png`, then `.jpg`.
- `PhotoInput` uploads each file when picked (`POST /media/uploads`) and hands the object keys to the form.

**Watch:** `escapeXml` is what makes `Barcode`'s `dangerouslySetInnerHTML` safe.

#### `apps/web/src/areas/customer/auth/AuthPage.tsx`, `apps/web/src/areas/customer/auth/SignInPage.tsx`, `apps/web/src/areas/customer/auth/SecondFactorForm.tsx`, `apps/web/src/areas/customer/auth/SignUpPage.tsx`, `apps/web/src/areas/customer/auth/VerifyEmailPage.tsx`, `apps/web/src/areas/customer/auth/ForgotPasswordPage.tsx`, `apps/web/src/areas/customer/auth/ResetPasswordPage.tsx`, `apps/web/src/areas/customer/auth/ForcedEnrollmentPage.tsx` · 1.5 min · T7.2, T7.3, T7.6
- `SignInPage` posts `/auth/login` with one `identifier` (e-mail or username). A two-factor account gets a challenge, which `SecondFactorForm` answers at `/auth/login/mfa`. An `email_unverified` refusal offers a new link.
- `SignUpPage` posts `/auth/register` with `acceptedTermsVersion`.
- `VerifyEmailPage` posts each token once (`verifyOnce`): tokens are single-use and StrictMode runs effects twice.
- `ForcedEnrollmentPage` wraps `TwoFactorPanel`.

**Watch:** `TERMS_VERSION` in `legalContent.ts` must equal `CURRENT_TERMS_VERSION` in `apps/api/src/modules/acc/terms.ts`, or every registration is refused.

#### `apps/web/src/areas/customer/vault/VaultPage.tsx` · 2 min · T9.6, T10.1, T12.6
The collector's cards: search, three scope tabs (`active`, `hold`, `history`), a grid and an item drawer.
- `GET /vault/items` and `GET /vault/counts` load together, debounced, so counts follow the search. `GET /vault/break-even` feeds the `Watch` badge.
- A History row and its drawer say why the card left with `departureLabel`, from the API's `departure`; the class is named with `itemClassLabel`, never as its key.
- `ItemDrawer` loads the item, its `/timeline` and its `/storage` forecast. `timelineDetail` (`apps/web/src/shared/itemTimeline.ts`, beside `STATE_META`) words each register entry in the page's language, with every code in its own isolated run (U+2068 to U+2069), so a Latin barcode can't reorder a Hebrew sentence.
- `CARD_ACTIONS` lists the services, gated by `states`, `lotOnly` or `gradedOnly` and priced from `useServicePrices`.
- Deslab and donation are irreversible: a `ConfirmationModal`, then the challenge (`/services/donation`) and its `confirmationToken` posted at once to `/services/donation/confirm` (T6.6).

**Watch:** a service is charged when requested, with no idempotency key. The double-press guard is the server's `assertNotAlreadyOpen`: one open request per type per card.

#### `apps/web/src/areas/customer/vault/GradingForm.tsx`, `apps/web/src/areas/customer/vault/InspectionForm.tsx`, `apps/web/src/areas/customer/vault/ConsignmentForm.tsx`, `apps/web/src/areas/customer/vault/CustomRequestForm.tsx`, `apps/web/src/areas/customer/vault/RemoveCommonsPanel.tsx` · 1 min · T10
The forms the drawer opens: each loads its options, such as `/services/grading/tiers`, and posts its service. `RemoveCommonsPanel` donates or discards many cards through the `/services/remove-commons` confirmation pair.

#### `apps/web/src/areas/customer/inbound/InboundPage.tsx` · 1 min · T9.1
Tabs `addresses`, `parcels`, `processing`.
- `GET /me/inbound-addresses`: what to paste into a seller's checkout, with the `C/O` line the API builds from the username.
- `GET /me/parcels`; `POST /me/parcels` announces a parcel; `POST /me/parcels/:id/cancel`.
- `GET /parcels/workflow/status` shows live queue counts.

#### `apps/web/src/areas/customer/finance/WalletPage.tsx` · 1.5 min · T8.1, T8.6
Tabs `overview`, `transactions`, `cash-in`, `cash-out`, `requests`.
- Loads `GET /finance/wallet`, `/finance/ledger`, `/finance/wallet-requests` and `/finance/wallet/pending`. Pending totals stay apart from the balance: none of it has moved.
- `runningBalances` walks the whole ledger, oldest first, for each row's balance after. It relies on `LedgerService.list` returning every row; if that endpoint ever pages, the server must supply the figure.
- `RequestDrawer` shows a request's history and cancels it while `canCancel` holds.
- `TYPE_META` and `REF_LABEL` word every ledger type and reference type the API writes; a new one shows as its key until it is added to both and to both languages.

#### `apps/web/src/areas/customer/finance/MoneyPanels.tsx`, `apps/web/src/areas/customer/finance/WalletRequestForms.tsx` · 1.5 min · T8.6, T8.7, T6.5, T1.4
- `TopUpPanel` pays with `POST /finance/checkout`, sending `amountMinor`, `route` and `idempotencyKey`. A retry with the same route and amount reuses the key. After an `unreachable` or `server` error the key is kept, because the card may have been charged; an answer or any other refusal clears it.
- `CashOutQuotePanel` shows what will land (`GET /finance/cash-out-quote`).
- `WalletRequestForm` serves both directions and posts `/finance/wallet-requests`. It says submitting moves no money, since an admin approves and completes each request (T1.4). `validateDraft` and `findOpenDuplicate` run first; the server re-checks both.

**Watch:** never mint a new idempotency key for a retry; that turns one top-up into two.

#### `apps/web/src/areas/customer/membership/MembershipPage.tsx` · 1 min · T12.2
- Loads `GET /membership/tiers` and `GET /membership/me`. `POST /membership/subscribe` serves join, upgrade, downgrade and keep; `POST /membership/cancel` ends at the period end.
- Each button confirms first, with a sentence built from `tierAction`, so the amount shown is the amount charged.

#### `apps/web/src/areas/customer/marketplace/MarketplacePage.tsx` · 1 min · T11.1, T11.2, T11.3
Tabs `browse`, `house`, `sell`, `listings`, `offers`, `trade`, `escrow`, `store`.
- Browse filters live in the URL (`setParams`) and go to `GET /marketplace/listings`; the server filters because results are capped.
- `buy` posts `/marketplace/listings/:id/purchase` with no key. The controller builds one from the buyer and listing ids, so a double click comes back `replayed`.
- `SellPanel` creates a listing; `OfferDrawer` makes an offer.
- `SellerLine` on each card and the seller row in `OfferDrawer` link to `storefrontHref`, `#/marketplace/store?seller=<username>`.

#### `apps/web/src/areas/customer/marketplace/SellerPanels.tsx`, `apps/web/src/areas/customer/marketplace/ProposeTradePanel.tsx`, `apps/web/src/areas/customer/marketplace/EscrowTab.tsx`, `apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx` · 1.5 min · T11, T15.3
- `MyListingsPanel` reprices and takes down through the `/remove` confirmation pair. `OffersPanel` accepts, rejects or counters; on accept the controller falls back to a key from the offer id. `SwapsPanel` approves or rejects swaps.
- `ProposeTradePanel` proposes a swap, or a gift through the `/marketplace/transfers` confirmation pair.
- `EscrowTab` creates a deal, then posts `agree`, `fund`, `release` or `return`; `EscrowService` locks the deal row and checks its status each time.
- `HouseStorePanel` sends an `Idempotency-Key` from `crypto.randomUUID()`, made when the confirmation opens. A product has copies, so each confirmation is a new purchase, while a double click inside one is not.

#### `apps/web/src/areas/customer/shipping/ShippingServicesPage.tsx` · 2 min · T13, T10.5, T10.6
Tabs `overview`, `shipping`, `in-person`, `tracking`, `shared`, `requests`, `history`, `not-accepted`.
- `TrackingTab` lists `GET /shipping/shipments`. `ShipmentDrawer` pays, cancels with a reason, and shows `CustomsReadiness` outside the US.
- `RechooseService` appears after a carrier refuses a label: it loads the shipment's rates and posts `select-rate`, and the server settles the difference.
- `RequestTable` lists `GET /services/mine` and accepts or declines buyout and custom-request quotes.
- `NotAcceptedTable` lists `GET /me/disposals`, arrivals Bault refused.

#### `apps/web/src/areas/customer/shipping/ShipmentComposer.tsx`, `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx`, `apps/web/src/areas/customer/shipping/SharedParcelsTab.tsx` · 1 min · T13.1, T13.6, T13.7
- `ShipmentComposer` re-quotes as answers change (`POST /shipping/quote`, which creates nothing); refused rates stay visible with their rule. `commit` posts `/shipping/shipments`, then `choose-for-me` or `select-rate`. An address that `lacksRegion`, or that the server refuses with `address_region_required`, stops the quote and shows a link to edit it.
- `HumanFulfilmentPanels.tsx` handles show pickup and hand delivery; `SharedParcelsTab` runs group shipments.

**Watch:** if `commit`'s second call fails, the shipment already exists and only the error shows. `WhiteGloveQuotes` accepts with no amount, so the server charges whatever quote is current.

#### `apps/web/src/areas/customer/profile/ProfilePage.tsx`, `apps/web/src/areas/customer/profile/TwoFactorPanel.tsx`, `apps/web/src/areas/customer/support/SupportPage.tsx`, `apps/web/src/areas/customer/notifications/NotificationsPage.tsx` · 1.5 min · T7.1, T7.6, T14.4
- `ProfilePage`: `PATCH /me/profile`, addresses on `/me/addresses`, and `/auth/password/change`. `AddressFields` shows a state or province list for a country with `regions`, free text elsewhere, and clears it when the country changes; a saved address that `lacksRegion` wears a warning badge. `TwoFactorPanel` drives setup, disable and recovery codes under `/auth/mfa`.
- `SupportPage` runs tickets on `/support/tickets` and is the whole app for a suspended account. The warehouse reuses its `ThreadDrawer` with `staff` set.
- `NotificationsPage` shows the shared feed and saves preferences with `PUT /notifications/preferences`.

**Watch:** `nameDirty` disables Save until a name changes, so an account flagged `nameReviewRequired` whose name is already right cannot confirm it.

#### `apps/web/src/areas/customer/marketing/LandingPage.tsx`, `apps/web/src/areas/customer/help/FaqLegalPage.tsx` · 1 min · T16.1, T16.4
- `LandingPage` needs no session; it reads the public `GET /pricing/list` and `GET /content/account-terms`.
- `FaqLegalPage` tabs: `ask`, `guides`, `faq`, `policy`, `prices`, `shows`, `contact`, `legal`, from static content files plus live panels.

**Watch:** the FAQ, guides and legal text are English only, even in Hebrew. The terms, privacy policy and cookie notice show `DRAFT_NOTICE`: a lawyer must review them before launch.

#### `apps/web/src/areas/warehouse/WarehouseConsole.tsx` · 2 min · T9.3, T9.5, T9.6, T13.3
The operator console, at warehouse density. Tabs `overview`, `receiving`, `inventory`, `shipments`, `locations`, `services`, `support`.
- On receiving, `focusParcelId` points the intake bench at the box chosen in the queue.
- Inventory: `RelocatePanel`, `HoldPanel` (`POST` or `DELETE /custody/items/:id/hold`, reporting `changed: false` as nothing to do), `LotsPanel`, `DisposalPanel`.
- `FulfillmentPanel` matches each scan to id, barcode or serial (`sameCode`) and posts `/shipping/shipments/:id/dispatch` with `scannedItemIds` (or `scannedParcel` for `direct_overnight`), carrier, weight and notes.
- `BinsPanel` creates bins and switches them on or off.

**Watch:** dispatch sends what was scanned, never the shipment's own item list, so the server can compare the two.

#### `apps/web/src/areas/warehouse/ReceiveParcels.tsx`, `apps/web/src/areas/warehouse/ParcelQueue.tsx`, `apps/web/src/areas/warehouse/IntakeBench.tsx` · 1.5 min · T9.1, T9.2, T9.3
- `ReceiveParcels` receives a stack of arrivals in one `POST /parcels/receive/batch`.
- `ParcelQueue` lists `GET /parcels`; a row offers only its legal moves (`claim`, `open`, `forward`), as the API enforces.
- `IntakeBench` books a box's contents. The parcel sets the owner; each `UnitDraft` has class, description, condition, optional serial and photos. In auto mode the bench shows the shelf `GET /custody/bins/suggest` picks and sends `autoStow`; in scan mode the operator scans a shelf. Submit is one `POST /intake/items/batch`; `closeParcel` posts `/parcels/:id/process`, with a reason when the box held nothing.

**Watch:** the batch has no idempotency key; only `busy` stops a second press.

#### `apps/web/src/areas/warehouse/ServiceQueue.tsx`, `apps/web/src/areas/warehouse/GradingSubmissions.tsx`, `apps/web/src/areas/warehouse/SupportQueue.tsx`, `apps/web/src/areas/warehouse/HouseOrdersPanel.tsx` · 1 min · T10.1, T10.2, T11.6
- `ServiceQueue` accepts or denies requests, then closes one with its form from `FORMS` (`/services/<type>/:id/complete`), which needs every field and `itemVerified`.
- `GradingSubmissions` batches cards for a grading company. `SupportQueue` assigns tickets. `HouseOrdersPanel` shelves the copy a house-store buyer paid for.

#### `apps/web/src/areas/admin/AdminConsole.tsx` · 2 min · T7.1, T7.6, T8.5, T8.9
The management console, admins only. Tabs `yield` (default), `users`, `signins`, `outbox`, `requests`, `accounting`, `items`, `house`, `pricing`, `disputes`, `storage`.
- `UserRow` and `ItemRow` edit inline and `PATCH /admin/users/:id` or `/admin/items/:id` with only the changed fields. The server reads every field as a decision: a `status` sent with a name fix would clear the debt sweep's `autoSuspended` marker. A flagged name (`nameReviewRequired`) is sent even unchanged, to confirm it (`confirmName`).
- `resetMfa` posts `/admin/users/:id/mfa/reset` behind a danger `ConfirmationModal`.
- `PricingSection` shows `PricingCoveragePanel`, then posts `/pricing/rules`; a membership rule carries `tierRuleParameters`.

**Watch:** a `storage` rule created here carries no `parameters`, so the worker's defaults apply.

#### `apps/web/src/areas/admin/WalletRequestsSection.tsx` · 1.5 min · T8.6, T8.7, T1.4
The queue behind the beta rule: an admin decides every cash-in and cash-out.
- `reviewerActions` offers only transitions the API allows; `cancelled` belongs to the requester.
- `act` posts `/admin/wallet-requests/:id/<action>`. Reject needs a reason. Complete, the only action that moves a balance, sits behind a confirmation and can carry a `payoutReference`.
- A request the admin raised offers no actions (`isOwnRequest`); the API refuses them too. `reconcile` re-asks the payout provider about stuck payouts.

**Watch:** separation of duties covers only one's own requests; one admin can approve and complete the same cash-out.

#### `apps/web/src/areas/admin/AccountingSection.tsx`, `apps/web/src/areas/admin/ShelfYieldPanel.tsx`, `apps/web/src/areas/admin/PricingCoveragePanel.tsx`, `apps/web/src/areas/admin/OutboxSection.tsx`, `apps/web/src/areas/admin/SignInsSection.tsx`, `apps/web/src/areas/admin/HouseStoreSection.tsx` · 1 min · T8.10, T11.6, T14.3, T15.3
- `AccountingSection`: month summary, reconciliation, ledger CSV. `ShelfYieldPanel`: yield by zone and customer. `PricingCoveragePanel`: actions with no price. `OutboxSection`: requeue parked messages. `SignInsSection`: the sign-in log.
- `HouseStoreSection` changes stock with `expectedStock`, so a change against a stale count is refused.

**Watch:** `AccountingSummary` is a hand-written copy of the API type without `payoutsReturnedMinor` and `cashOutFeesReturnedMinor`, so returned payouts never show.

**Also in this area**
- `apps/web/src/fonts.css`: `@font-face` rules, subset by `unicode-range`.
- `apps/web/src/shared/ui/icons.tsx`: inline SVG icons.
- `apps/web/src/areas/admin/YieldChart.tsx`: the Shelf Yield bar chart.
- `apps/web/src/areas/customer/marketplace/StorefrontPanel.tsx`: a seller's public storefront, the one `?seller=` names, else the visitor's own.
- `apps/web/src/areas/customer/help/HelpPanels.tsx`, `IntakePolicyPanel.tsx`, `PriceListPanel.tsx`, `LegalDocumentView.tsx`: the help tabs.
- `apps/web/src/areas/customer/help/faqContent.ts`, `guideContent.ts`, `legalContent.ts`: static help and legal text.
- `apps/web/src/areas/customer/auth/demoUsers.ts`: the seeded-account hint on the dev server.
