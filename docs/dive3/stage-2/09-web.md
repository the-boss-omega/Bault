## 2.9 The web app

`apps/web` is a React 19 single-page app built with Vite, with no router, state library or form library. It has about 100 source files and 36,000 lines, and nearly a third of those lines are the message catalogue and the stylesheet. Read the boot files, then the shell and routing, then the shared modules, then the screens for collectors, the warehouse and admins. Almost every screen loads its data with `api`, keeps state in `useState`, puts its tab and open record in the URL, and reports through `ErrorState` and `SuccessNote`. After the first few screens, read only what differs. The section takes about 45 minutes.

#### `apps/web/index.html`, `apps/web/src/main.tsx`

About 1 minute. It builds on T16.1 and T16.4.

`index.html` sets `lang="he"` and `dir="rtl"` before any script runs, so the first paint is Hebrew and right to left. It links `favicon-32.png` and `apple-touch-icon.png`, the B that the rail shows, from the repo-root `assets` folder, which Vite serves as its public folder. `main.tsx` removes the retired `bault.railPinned` key, then nests `StrictMode`, `ThemeProvider`, `I18nProvider`, `ErrorBoundary` and `App`. The boundary sits inside the providers, so a crash still renders in the viewer's theme and direction.

#### `apps/web/vite.config.ts`, `apps/web/proxy-target.ts`

About 1 minute. It builds on T3.5, T4.2 and T16.3.

This file configures the dev server, the preview server and the build. `resolveApiProxyTarget` picks where `/api` goes. It takes `VITE_API_PROXY_TARGET` first, then `API_PORT` on `127.0.0.1`, then `DEFAULT_API_PORT`. The dev and preview servers proxy `/api` there, so the browser sees one origin, as in production, and the API needs no CORS. A dead API gets a 503 with the code `api_unreachable`, which `api.ts` reads as `unreachable`. When `WEB_PREVIEW_PASSWORD` is set, `previewBasicAuth` puts basic auth in front of the preview server.

`vite build` forces `NODE_ENV=production`. It refuses to start when an env file in `apps/web` asks for `development`, which `nodeEnvInEnvFiles` detects. A development bundle would ship the seeded credentials that `SignInPage` pre-fills, and `tests/web/no-credentials-in-bundle.test.ts` checks the output for them.

#### `apps/web/src/index.css`

About 1.5 minutes. It builds on T16.4 and T16.5.

The tokens come first, then every component class. The `:root` block has three faces, with `--font-mono` for codes only, ten type sizes, a 4px spacing scale, one `--radius` and one `--shadow-overlay`. It has five accents with one job each. `--custody` means in Bault's care, `--brass` means money, `--frost` means held, `--amber` means a warning and `--oxblood` means an action that cannot be undone. A legacy block maps old names such as `--navy` and `--gold` onto them. `[data-density='warehouse']` and `[data-density='marketing']` reset spacing and row height for the same components.

The file uses only logical properties such as `margin-inline-start`, so Hebrew and English are one layout, mirrored. Mono comes from `code`, `.code`, `.mono`, `.serial`, `.code-inline` and the counters `.rail-count` and `.state-count`. The one exception is the warehouse `.log` list, which names a monospace stack directly. A cell or detail value with `dir="ltr"` stays in the UI face, so money, dates and e-mails in it are not set as codes.

Dark mode is two identical blocks, `:root:not([data-theme='light'])` inside the `prefers-color-scheme` query and `:root[data-theme='dark']`, so change both. `scripts/design-lint.mjs` enforces five rules. It refuses physical properties in CSS, class names or inline styles, lengths off the scale, a literal radius or shadow, and a raw colour outside the token block. It allows mono only on code selectors, but it looks only for `var(--font-mono)`, so it misses `.log`. A `design-lint-allow` comment exempts a line. CI does not run the linter, so run `node scripts/design-lint.mjs` yourself.

#### `apps/web/src/App.tsx`

About 2.5 minutes. It builds on T16.1, T16.2 and T7.6.

`App` decides what to show before sign-in, then hands over to the shell. `TOKEN_ROUTES`, which are `verify-email` and `reset-password`, render first, signed in or not. `LANDING_ROUTES` render next for anyone not signed in, without waiting for the session. `probeSession` calls `loadProfile` once. A 401 means `anonymous` and shows `AuthPage`. Any other failure means `blocked`, an error screen with a retry button and never the sign-in form.

After sign-in the role picks the first section, which is `admin`, `warehouse` or `vault`. When `mustEnrolSecondFactor` is true, staff stay on `ForcedEnrollmentPage`, because the API refuses them everything else. `Workspace` filters `SECTIONS` by `requires`, which is `staff` or `admin`, and a `suspended` account gets only `support`. The section comes from the hash, then the last visited one, then the role's fallback, which also replaces an unknown or forbidden section. `<main key={section}>` remounts only on a section change, so tabs, drawers and a language switch update in place. `Workspace` sets `document.title` to the section's title and Bault, and puts back plain Bault when it unmounts. The rail filter is presentation only, and the API's role guards are the enforcement, as T6.3 explains.

#### `apps/web/src/shared/routing.ts`

About 1 minute. It builds on T16.2.

This is a hash router with no dependency, for URLs of the shape `#/<section>/<tab>?<params>`. `useRoute` reads the hash through `useSyncExternalStore`. `navigate` writes it and remembers the section under `bault.tab`. Redirects pass `replace`, so Back skips them. `useNavigation` returns `goTab`, `openRecord`, `closeRecord` and `setParams`, which holds filters. An open drawer is a URL parameter, so Back closes it. `legacyRedirect` sends retired links such as `#/wallet/topup` to their current tabs. A renamed tab needs a `LEGACY_TABS` entry, or old links land on the default tab.

#### `apps/web/src/shared/api.ts`

About 1.5 minutes. It builds on T16.3, T6.3 and T6.4.

This is the only HTTP client. `api.get`, `post`, `patch`, `put` and `del` call `/api/v1` with `credentials: 'include'` and a JSON content type. A failure throws an `ApiError` with a `kind`, the status and the envelope's `code`. The kinds are `unreachable`, `unauthenticated`, `forbidden`, `not_found`, `server` and `client`. `apiErrorKey` maps a kind to an i18n key, or to `null` for `client` errors, whose API message is more specific. Only `post` takes extra headers, which is how an `Idempotency-Key` travels. Nothing retries automatically.

Keep the JSON content type on every write. The API's `jsonBodiesOnly` refuses any other type as a CSRF defence, which is why uploads go as base64 JSON. Most screens show `(e as Error).message`, the API's English text, even in Hebrew. Only `App.tsx`, `ProfilePage`, `VerifyEmailPage` and `ResetPasswordPage` use `apiErrorKey`, and the last two word a stale link, which the API answers with 410, in their own text.

#### `apps/web/src/shared/session.ts`, `apps/web/src/shared/twoFactor.ts`, `apps/web/src/shared/names.ts`

About 1 minute. It builds on T7.1, T7.4 and T7.6.

The cookie is httpOnly, so `loadProfile`, which calls `GET /me/profile`, is the only way to know who is signed in. Concurrent calls share one request, and `resetProfileRequest` clears it on sign-in, enrolment and sign-out. `mustEnrolSecondFactor` is `mfaRequired` without `mfaEnabled`. `names.ts` repeats the API's username and name rules in `isValidUsername`, `normalizeNamePart` and `isValidNamePart`, and builds `fullName`.

#### `apps/web/src/shared/i18n.tsx`

About 1 minute. It builds on T16.4.

This file gives Hebrew and English with no library, and nearly all of it is the two catalogues. `he` is the source of truth. `MessageKey` derives from it and `en` is a `Record<MessageKey, string>`, so a missing English string fails the type check. A key built from a template string escapes that check. `t` fills `{placeholders}` and falls back to the Hebrew text, then to the key itself. `hasMessage` checks a key built at runtime. `I18nProvider` stores the choice under `bault.locale` and sets `lang` and `dir` on the `html` element, and nothing reloads. The provider calls `localStorage` without a `try`, unlike `theme.tsx` and `routing.ts`. Where storage is blocked it throws outside the `ErrorBoundary`, and the page stays blank.

#### `apps/web/src/shared/theme.tsx`, `apps/web/src/shared/hooks.ts`

About 1 minute. It builds on T16.5 and T14.4.

`ThemeProvider` offers `light`, `dark` and `system`, the default, and stores the choice under `bault.theme`. `system` removes `data-theme` and follows the operating system live. `useMediaQuery` drives the phone layout in `App`. `usePrefersReducedMotion` has no caller, because CSS handles reduced motion. `useNotificationFeed` loads `GET /notifications` for the bell and the notifications page. The API has no read flag, so unseen means newer than this browser's `bault.notificationsSeenAt`.

#### `apps/web/src/shared/ui/primitives.tsx`, `apps/web/src/shared/ui/DetailDrawer.tsx`, `apps/web/src/shared/ui/Serial.tsx`

About 2 minutes. It builds on T16.4, T16.5 and T6.5.

These are the design-system primitives every screen is built from. The `gold` variant of `Button` is for the one primary action in a view. `loading` disables the button and sets `aria-busy`, the client's guard against a double press. `Field` links its child to the hint or to the error, which has `role="alert"`. `MoneyField` is the amount input, with `dir="ltr"` and a decimal keypad. `ContextTabs` is an ARIA tab list whose arrow keys mirror on a right-to-left page. `Panel`, `StatusBadge`, `EmptyState` and `SkeletonTable` are presentational.

`DetailDrawer` and `ConfirmationModal` trap focus and return it to the opener. `isTopOverlay` gives Escape to the topmost overlay. `dirty` stops an outside click closing a drawer. `busy` disables Cancel and the backdrop, so the modal stays open mid-action. Escape still closes a dirty drawer and a busy modal.

`Serial`, `Code`, `Amount` and `LtrRun` isolate Latin runs such as serials, bins and money as left to right. `ItemPick` names a card in a picker by its serial and description. Any new serial, code, amount or e-mail on screen goes through these or gets `dir="ltr"`, or it reorders inside Hebrew.

#### `apps/web/src/shared/ui/PageHeader.tsx`, `apps/web/src/shared/ui/NavigationRail.tsx`, `apps/web/src/shared/ui/navRailState.ts`, `apps/web/src/shared/ui/ErrorBoundary.tsx`

About 1 minute. It builds on T16.1 and T16.2.

`PageHeader` holds the title and breadcrumb. Beside them sit `AccountPill`, which shows `@username` or the suspended state, `ThemeToggle`, `LanguageSwitcher`, `NotificationBell` and `UserMenu`. The rail expands while hovered or focused and is never pinned. `navRailReducer` is its pure state machine, so `tests/web/nav-rail.test.ts` needs no DOM. `ErrorBoundary` offers Try again and Reload the page, and its text is English only.

#### `apps/web/src/shared/money.ts`

About 1 minute. It builds on T5.5, T8.2 and T16.4.

Amounts travel as integer cents and are all USD. `formatUsd` ignores any currency from the API. `formatLedgerAmount` signs a ledger row from its `direction`. `dollarsToCents` parses what a person typed, such as `1,250.50`, and returns `null` for blank, malformed, zero or negative input. `centsToDollars` pre-fills a field. `formatDate` and `formatDateTime` use `he-IL` or `en-US`. Convert at the input and keep cents everywhere else. A field where $0 is valid cannot use `dollarsToCents`.

#### `apps/web/src/shared/walletRequests.ts`

About 1 minute. It builds on T8.6 and T8.7.

This is the client's copy of the cash-in and cash-out rules. `WALLET_REQUEST_STATUSES`, `WALLET_REQUEST_LIMITS` and `FUNDING_SOURCES` copy `apps/api/src/modules/pay/wallet-request.rules.ts` by value. Nothing imports the API file, so a limit or status changed there must be changed here. `validateDraft` returns a message key per field. `findOpenDuplicate` applies the API's `isDuplicateOf` test on type, amount, currency and reference before sending. `canCancel` holds only for `submitted` and `pending_review`. In `WALLET_REQUEST_TONE` only `completed` is green, because only completion moves money.

#### `apps/web/src/shared/market.ts`, `apps/web/src/shared/escrow.ts`, `apps/web/src/shared/parcels.ts`, `apps/web/src/shared/shipments.ts`, `apps/web/src/shared/carriers.ts`, `apps/web/src/shared/grading.ts`, `apps/web/src/shared/itemClasses.ts`, `apps/web/src/shared/serviceLabels.ts`, `apps/web/src/shared/support.ts`, `apps/web/src/shared/signIns.ts`, `apps/web/src/shared/notifications.ts`, `apps/web/src/shared/membership.ts`

About 1 minute. It builds on T2, T11.5, T12.2 and T13.1.

Each file holds the response types, a status-to-tone map and the label functions for one domain, such as `ESCROW_TONE`, `ITEM_CLASSES` and `ruleLabel`, which names the rule a refused rate failed. `itemName` and `itemPickText` name a card by its description, or by its class in words when it has none. `storefrontHref` builds a seller's page link. `tierAction` repeats the proration in `MembershipService.subscribe`, so the confirm button shows the exact charge. Change both together, because no test compares them. `tests/web/notification-catalogue.test.ts` fails when `EVENT_LABEL_KEY` and the API's events drift.

#### `apps/web/src/shared/servicePrices.ts`, `apps/web/src/shared/countries.ts`, `apps/web/src/shared/useVaultItems.ts`, `apps/web/src/shared/Barcode.tsx`, `apps/web/src/shared/barcode128.ts`, `apps/web/src/shared/CardPhoto.tsx`, `apps/web/src/shared/ui/PhotoInput.tsx`

About 1 minute. It builds on T8.5, T9.3 and T13.1.

`useServicePrices` loads `GET /pricing/list` once per page load. `SERVICE_FEE_ACTION` maps a card service to its rule, and `priceLabel` shows a percentage rule as a percentage, never as dollars. `useShippingCountries` and `useVaultItems` load `GET /shipping/countries` and `GET /vault/items`. `lacksRegion` says whether an address needs a state or province that it does not have. `barcodeSvg` draws Code 128B for `Barcode` and `printBarcodes`. `Barcode` inserts the SVG with `dangerouslySetInnerHTML`, and `escapeXml` is what makes that safe. `cardPhotoUrl` points at `/images/<SERIAL>` in the repo-root `assets` folder and tries `.png`, then `.jpg`. `PhotoInput` uploads each file when it is picked, with `POST /media/uploads`, and hands the object keys to the form.

#### `apps/web/src/areas/customer/auth/AuthPage.tsx`, `apps/web/src/areas/customer/auth/SignInPage.tsx`, `apps/web/src/areas/customer/auth/SecondFactorForm.tsx`, `apps/web/src/areas/customer/auth/SignUpPage.tsx`, `apps/web/src/areas/customer/auth/VerifyEmailPage.tsx`, `apps/web/src/areas/customer/auth/ForgotPasswordPage.tsx`, `apps/web/src/areas/customer/auth/ResetPasswordPage.tsx`, `apps/web/src/areas/customer/auth/ForcedEnrollmentPage.tsx`

About 1.5 minutes. It builds on T7.2, T7.3 and T7.6.

`SignInPage` posts `/auth/login` with one `identifier`, an e-mail or a username. A two-factor account gets a challenge, which `SecondFactorForm` answers at `/auth/login/mfa`. An `email_unverified` refusal offers a new link. `SignUpPage` posts `/auth/register` with `acceptedTermsVersion`. `TERMS_VERSION` in `legalContent.ts` must equal `CURRENT_TERMS_VERSION` in `apps/api/src/modules/acc/terms.ts`, or every registration is refused, and `tests/web/faq-legal.test.ts` fails when they differ. `VerifyEmailPage` posts each token once through `verifyOnce`, because tokens are single-use and StrictMode runs effects twice. `ForcedEnrollmentPage` wraps `TwoFactorPanel`.

#### `apps/web/src/areas/customer/vault/VaultPage.tsx`

About 2 minutes. It builds on T9.6, T10.1 and T12.6.

This page shows the collector's cards, with a search, three scopes, a grid and an item drawer. The scopes are `active`, `hold` and `history`. `GET /vault/items` and `GET /vault/counts` load together, debounced, so the counts follow the search. `GET /vault/break-even` feeds the `Watch` badge. A History row and its drawer say why the card left with `departureLabel`, from the API's `departure`. The class is named with `itemClassLabel`, never as its key.

`ItemDrawer` loads the item, its `/timeline` and its `/storage` forecast. `timelineDetail` words each register entry in the page's language. It lives in `apps/web/src/shared/itemTimeline.ts`, beside `STATE_META`, and puts every code in its own isolated run from U+2068 to U+2069, so a Latin barcode cannot reorder a Hebrew sentence. `CARD_ACTIONS` lists the services, gated by `states`, `lotOnly` or `gradedOnly` and priced from `useServicePrices`. A held or historical card offers none.

Deslab and donation cannot be undone. Each shows a `ConfirmationModal`, then posts the challenge, such as `/services/donation`, and posts its `confirmationToken` at once to the confirm route, as T6.6 describes. A service is charged when requested, with no idempotency key. The double-press guard is the server's `assertNotAlreadyOpen`, which allows one open request per type per card.

#### `apps/web/src/areas/customer/vault/GradingForm.tsx`, `apps/web/src/areas/customer/vault/InspectionForm.tsx`, `apps/web/src/areas/customer/vault/ConsignmentForm.tsx`, `apps/web/src/areas/customer/vault/CustomRequestForm.tsx`, `apps/web/src/areas/customer/vault/RemoveCommonsPanel.tsx`

About 1 minute. It builds on T10.

These are the forms the drawer opens. Each loads its options, such as `/services/grading/tiers`, and posts its service. `CustomRequestForm` has no options to load. `RemoveCommonsPanel` donates or discards many cards through the `/services/remove-commons` confirmation pair.

#### `apps/web/src/areas/customer/inbound/InboundPage.tsx`

About 1 minute. It builds on T9.1.

The tabs are `addresses`, `parcels` and `processing`. `GET /me/inbound-addresses` gives what to paste into a seller's checkout, with the `C/O` line the API builds from the username. `GET /me/parcels` lists parcels, `POST /me/parcels` announces one and `POST /me/parcels/:id/cancel` cancels one. `GET /parcels/workflow/status` shows the queue counts, loaded once when the tab opens.

#### `apps/web/src/areas/customer/finance/WalletPage.tsx`

About 1.5 minutes. It builds on T8.1 and T8.6.

The tabs are `overview`, `transactions`, `cash-in`, `cash-out` and `requests`. The page loads `GET /finance/wallet`, `/finance/ledger`, `/finance/wallet-requests` and `/finance/wallet/pending`. Pending totals stay apart from the balance, because none of that money has moved. `runningBalances` walks the whole ledger, oldest first, for each row's balance after. It relies on `LedgerService.list` returning every row, so if that endpoint ever pages, the server must supply the figure. `RequestDrawer` shows a request's history and cancels it while `canCancel` holds.

`TYPE_META` words every ledger type. `REF_LABEL` words every reference type the API writes, but not `interest`, which the worker's interest job writes, so those rows show the raw word in both languages. A new type or reference shows its raw name until it is added to these maps and to both catalogues.

#### `apps/web/src/areas/customer/finance/MoneyPanels.tsx`, `apps/web/src/areas/customer/finance/WalletRequestForms.tsx`

About 1.5 minutes. It builds on T8.6, T8.7, T6.5 and T1.4.

`TopUpPanel` pays with `POST /finance/checkout`, sending `amountMinor`, `route` and `idempotencyKey`. A retry with the same route and amount reuses the key. After an `unreachable` or `server` error the key is kept, because the card may have been charged. An answer or any other refusal clears it. Never mint a new key for a retry, because that turns one top-up into two. `CashOutQuotePanel` shows what will land, from `GET /finance/cash-out-quote`.

`WalletRequestForm` serves both directions and posts `/finance/wallet-requests`. It says that submitting moves no money, since an admin approves and completes each request, as T1.4 explains. `validateDraft` and `findOpenDuplicate` run first, and the server checks both again.

#### `apps/web/src/areas/customer/membership/MembershipPage.tsx`

About 1 minute. It builds on T12.2.

The page loads `GET /membership/tiers` and `GET /membership/me`. `POST /membership/subscribe` serves join, upgrade, downgrade and keep, and `POST /membership/cancel` ends the membership at the period end. Each button confirms first, with a sentence built from `tierAction`, so the amount shown is the amount charged.

#### `apps/web/src/areas/customer/marketplace/MarketplacePage.tsx`

About 1 minute. It builds on T11.1, T11.2 and T11.3.

The tabs are `browse`, `house`, `sell`, `listings`, `offers`, `trade`, `escrow` and `store`. Browse filters live in the URL through `setParams` and go to `GET /marketplace/listings`, and the server filters because results are capped. `buy` posts `/marketplace/listings/:id/purchase` with no key. The controller builds one from the buyer and listing ids, so a double click comes back `replayed`. `SellPanel` creates a listing, and `OfferDrawer` makes an offer. `SellerLine` on each card and the seller row in `OfferDrawer` link to `storefrontHref`, which is `#/marketplace/store?seller=<username>`.

#### `apps/web/src/areas/customer/marketplace/SellerPanels.tsx`, `apps/web/src/areas/customer/marketplace/ProposeTradePanel.tsx`, `apps/web/src/areas/customer/marketplace/EscrowTab.tsx`, `apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx`

About 1.5 minutes. It builds on T11 and T15.3.

`MyListingsPanel` reprices and takes down a listing through the `/remove` confirmation pair. `OffersPanel` accepts, rejects or counters, and on accept the controller falls back to a key built from the offer id. `SwapsPanel` approves or rejects swaps. `ProposeTradePanel` proposes a swap, or a gift through the `/marketplace/transfers` confirmation pair. `EscrowTab` creates a deal, then posts `agree`, `fund`, `release` or `return`, and `EscrowService` locks the deal row and checks its status each time. `HouseStorePanel` sends an `Idempotency-Key` from `crypto.randomUUID()`, made when the confirmation opens. A product has copies, so each confirmation is a new purchase, while a double click inside one is not.

#### `apps/web/src/areas/customer/shipping/ShippingServicesPage.tsx`

About 2 minutes. It builds on T13, T10.5 and T10.6.

The tabs are `overview`, `shipping`, `in-person`, `tracking`, `shared`, `requests`, `history` and `not-accepted`. `TrackingTab` lists `GET /shipping/shipments`. `ShipmentDrawer` pays, cancels with a reason, and shows `CustomsReadiness` outside the US. `RechooseService` appears after a carrier refuses a label. It loads the shipment's rates and posts `select-rate`, and the server settles the difference. `RequestTable` lists `GET /services/mine` and accepts or declines buyout and custom-request quotes. `NotAcceptedTable` lists `GET /me/disposals`, the arrivals Bault refused.

#### `apps/web/src/areas/customer/shipping/ShipmentComposer.tsx`, `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx`, `apps/web/src/areas/customer/shipping/SharedParcelsTab.tsx`

About 1 minute. It builds on T13.1, T13.6 and T13.7.

`ShipmentComposer` quotes again as answers change, with `POST /shipping/quote`, which creates nothing. Refused rates stay visible with their rule. `commit` posts `/shipping/shipments`, then `choose-for-me` or `select-rate`. If the second call fails, the shipment already exists and only the error shows. An address that `lacksRegion`, or that the server refuses with `address_region_required`, stops the quote and shows a link to edit it. `HumanFulfilmentPanels.tsx` handles show pickup and hand delivery. Its `WhiteGloveQuotes` accepts with no amount, so the server charges whatever quote is current. `SharedParcelsTab` runs group shipments.

#### `apps/web/src/areas/customer/profile/ProfilePage.tsx`, `apps/web/src/areas/customer/profile/TwoFactorPanel.tsx`, `apps/web/src/areas/customer/support/SupportPage.tsx`, `apps/web/src/areas/customer/notifications/NotificationsPage.tsx`

About 1.5 minutes. It builds on T7.1, T7.6 and T14.4.

`ProfilePage` saves names with `PATCH /me/profile`, edits addresses on `/me/addresses` and changes the password with `/auth/password/change`. `AddressFields` shows a state or province list for a country with `regions` and free text elsewhere, and it clears the value when the country changes. A saved address that `lacksRegion` wears a warning badge. `nameDirty` disables Save until a name changes, so an account flagged `nameReviewRequired` whose name is already right cannot confirm it. `TwoFactorPanel` drives setup, disabling and recovery codes under `/auth/mfa`. `SupportPage` runs tickets on `/support/tickets` and is the whole app for a suspended account. The warehouse reuses its `ThreadDrawer` with `staff` set. `NotificationsPage` shows the shared feed and saves preferences with `PUT /notifications/preferences`.

#### `apps/web/src/areas/customer/marketing/LandingPage.tsx`, `apps/web/src/areas/customer/help/FaqLegalPage.tsx`

About 1 minute. It builds on T16.1 and T16.4.

`LandingPage` needs no session. It reads the public `GET /pricing/list` and `GET /content/account-terms`. `FaqLegalPage` has the tabs `ask`, `guides`, `faq`, `policy`, `prices`, `shows`, `contact` and `legal`, built from static content files plus live panels. The FAQ, guides and legal text are English only, even in Hebrew. The terms, privacy policy and cookie notice show `DRAFT_NOTICE`, because a lawyer must review them before launch.

#### `apps/web/src/areas/warehouse/WarehouseConsole.tsx`

About 2 minutes. It builds on T9.3, T9.5, T9.6 and T13.3.

This is the operator console, at warehouse density. The tabs are `overview`, `receiving`, `inventory`, `shipments`, `locations`, `services` and `support`. On receiving, `focusParcelId` points the intake bench at the box chosen in the queue. Inventory holds `RelocatePanel`, `HoldPanel`, `LotsPanel` and `DisposalPanel`. `HoldPanel` posts or deletes `/custody/items/:id/hold`, and it reports `changed: false` as nothing to do. `FulfillmentPanel` matches each scan to an id, barcode or serial with `sameCode`. It posts `/shipping/shipments/:id/dispatch` with `scannedItemIds`, or `scannedParcel` for `direct_overnight`, plus carrier, weight and notes. Dispatch sends what was scanned and never the shipment's own item list, so the server can compare the two. `BinsPanel` creates bins and switches them on or off.

#### `apps/web/src/areas/warehouse/ReceiveParcels.tsx`, `apps/web/src/areas/warehouse/ParcelQueue.tsx`, `apps/web/src/areas/warehouse/IntakeBench.tsx`

About 1.5 minutes. It builds on T9.1, T9.2 and T9.3.

`ReceiveParcels` receives a stack of arrivals in one `POST /parcels/receive/batch`. `ParcelQueue` lists `GET /parcels`, and a row offers only its legal moves, `claim`, `open` or `forward`, as the API enforces. `IntakeBench` books a box's contents. The parcel sets the owner, and each `UnitDraft` has a class, description, condition, optional serial and photos. In auto mode the bench shows the shelf that `GET /custody/bins/suggest` picks and sends `autoStow`, and in scan mode the operator scans a shelf. Submit is one `POST /intake/items/batch`, and `closeParcel` posts `/parcels/:id/process`, with a reason when the box held nothing. The batch has no idempotency key, so only `busy` stops a second press.

#### `apps/web/src/areas/warehouse/ServiceQueue.tsx`, `apps/web/src/areas/warehouse/GradingSubmissions.tsx`, `apps/web/src/areas/warehouse/SupportQueue.tsx`, `apps/web/src/areas/warehouse/HouseOrdersPanel.tsx`

About 1 minute. It builds on T10.1, T10.2 and T11.6.

`ServiceQueue` accepts or denies requests, then closes one with its form from `FORMS`, which posts a route such as `/services/photography/:id/complete`. The form needs every field and `itemVerified`. `GradingSubmissions` batches cards for a grading company. `SupportQueue` assigns tickets. `HouseOrdersPanel` shelves the copy a house-store buyer paid for.

#### `apps/web/src/areas/admin/AdminConsole.tsx`

About 2 minutes. It builds on T7.1, T7.6, T8.5 and T8.9.

This is the management console, for admins only. The tabs are `yield`, the default, then `users`, `signins`, `outbox`, `requests`, `accounting`, `items`, `house`, `pricing`, `disputes` and `storage`. `UserRow` and `ItemRow` edit inline and send `PATCH /admin/users/:id` or `/admin/items/:id` with only the changed fields. The server reads every field as a decision, so a `status` sent with a name fix would clear the debt sweep's `autoSuspended` marker. When `nameReviewRequired` is set, `confirmName` sends the name even unchanged, which confirms it. `resetMfa` posts `/admin/users/:id/mfa/reset` behind a danger `ConfirmationModal`. `PricingSection` shows `PricingCoveragePanel`, then posts `/pricing/rules`, and a membership rule carries `tierRuleParameters`. A `storage` rule created here carries no `parameters`, so the worker's defaults apply.

#### `apps/web/src/areas/admin/WalletRequestsSection.tsx`

About 1.5 minutes. It builds on T8.6, T8.7 and T1.4.

This is the queue behind the beta rule that an admin decides every cash-in and cash-out. `reviewerActions` offers only transitions the API allows, and `cancelled` belongs to the requester. `act` posts `/admin/wallet-requests/:id/<action>`. Reject needs a reason. Complete, the only action that moves a balance, sits behind a confirmation and can carry a `payoutReference`. A request the admin raised offers no actions, which `isOwnRequest` decides, and the API refuses them too. `reconcile` asks the payout provider again about stuck payouts. Separation of duties covers only one's own requests, so one admin can approve and complete the same cash-out.

#### `apps/web/src/areas/admin/AccountingSection.tsx`, `apps/web/src/areas/admin/ShelfYieldPanel.tsx`, `apps/web/src/areas/admin/PricingCoveragePanel.tsx`, `apps/web/src/areas/admin/OutboxSection.tsx`, `apps/web/src/areas/admin/SignInsSection.tsx`, `apps/web/src/areas/admin/HouseStoreSection.tsx`

About 1 minute. It builds on T8.10, T11.6, T14.3 and T15.3.

`AccountingSection` shows the month summary, the reconciliation and the ledger CSV. Its `AccountingSummary` is a hand-written copy of the API type without `payoutsReturnedMinor` and `cashOutFeesReturnedMinor`, so returned payouts never show. `ShelfYieldPanel` shows yield by zone and customer. `PricingCoveragePanel` lists actions with no price. `OutboxSection` requeues parked messages. `SignInsSection` shows the sign-in log. `HouseStoreSection` changes stock with `expectedStock`, so a change against a stale count is refused.

#### `apps/web/src/fonts.css`, `apps/web/src/shared/ui/icons.tsx`, `apps/web/src/areas/admin/YieldChart.tsx`, `apps/web/src/areas/customer/marketplace/StorefrontPanel.tsx`, `apps/web/src/areas/customer/help/HelpPanels.tsx`, `apps/web/src/areas/customer/help/IntakePolicyPanel.tsx`, `apps/web/src/areas/customer/help/PriceListPanel.tsx`, `apps/web/src/areas/customer/help/LegalDocumentView.tsx`, `apps/web/src/areas/customer/help/faqContent.ts`, `apps/web/src/areas/customer/help/guideContent.ts`, `apps/web/src/areas/customer/help/legalContent.ts`, `apps/web/src/areas/customer/auth/demoUsers.ts`

These small files need no separate time.

`fonts.css` holds the `@font-face` rules, subset by `unicode-range`. `icons.tsx` holds the inline SVG icons. `YieldChart` draws the Shelf Yield bar chart. `StorefrontPanel` shows a seller's public storefront, the one that `?seller=` names, or else the visitor's own. `HelpPanels.tsx`, `IntakePolicyPanel.tsx`, `PriceListPanel.tsx` and `LegalDocumentView.tsx` render the help tabs. `faqContent.ts`, `guideContent.ts` and `legalContent.ts` hold the static help and legal text. `demoUsers.ts` holds the seeded-account hint on the dev server.
