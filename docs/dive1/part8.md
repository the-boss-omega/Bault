# Part 8 — Web App Pages & Role-Scoped Areas

This part of the DIVE1 document walks through Bault's web front-end **page and console components** file by file. These are the leaf components that a signed-in user actually looks at and interacts with. Each one lives under `apps/web/src/areas/`, grouped by the *area* it belongs to — `customer/` for collectors, `warehouse/` for operators, and `admin/` for managers. The app shell (routing, tab bar, session boot) chooses which of these components to mount based on the `{ id, role }` object returned by the login call, so every file below assumes the caller has already been authenticated and its area is authorized.

Before the individual pages, it is worth grounding the discussion in the three tiny shared modules that nearly every page imports, because they explain the conventions the pages rely on and several of the historical bug fixes the pages encode. All three live under `apps/web/src/shared/`.

## apps/web/src/shared/api.ts (shared foundation)

Although this is a shared helper rather than a page, every page in this part routes its network traffic through it, so understanding it up front removes a lot of repetition later. The module opens with a single module-level constant, `const BASE = '/api/v1';`. Because the constant is a *relative* path (no scheme, no host), every request the web app makes is same-origin. The Vite dev server (and the production reverse proxy) forwards `/api/v1/*` to the ACC/gateway process, which means the browser never has to know the API's real hostname and — crucially — the session cookie is treated as first-party.

The heart of the module is one generic function:

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(message);
  }
  return body as T;
}
```

There are several deliberate implementation choices packed into these few lines, and they ripple through every page in this part. First, `credentials: 'include'` is what makes the whole app work without any token handling in JavaScript: the API sets an **httpOnly** session cookie at login, the browser attaches it to every subsequent same-origin request automatically, and the JS layer never sees, stores, or forwards a bearer token. This is the concrete realization of the project's "no tokens in JS" principle (Principle IX in the constitution) — a page like `WalletPage` can call `api.get('/finance/wallet')` and the request is authenticated purely by the ambient cookie. Second, the `Content-Type: application/json` header is always set but is *spread-overridable*, so a caller can add headers without losing the default. Third, the `res.status === 204 ? null : await res.json().catch(() => null)` line handles two edge cases at once: a `204 No Content` response (common for `DELETE`) never tries to parse a body, and a malformed/empty body on any other status degrades to `null` instead of throwing a `SyntaxError` that would mask the real HTTP error. Fourth, the error path reaches into the uniform `{ error: { code, message } }` envelope that the API guarantees and rethrows a plain `Error` carrying the server's human message, falling back to `res.statusText` when the envelope is missing. That single convention is why nearly every page in this part can write `catch (e) { setError((e as Error).message); }` and reliably surface a meaningful Hebrew message from the backend.

The public surface is the `api` object with four methods:

```ts
export const api = {
  get:   <T>(path) => request<T>(path),
  post:  <T>(path, data?) => request<T>(path, { method: 'POST',  body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path, data?) => request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del:   <T = unknown>(path) => request<T>(path, { method: 'DELETE' }),
};
```

Note what is *absent*: there is no `put`. The client intentionally exposes only `get`/`post`/`patch`/`del`. This omission is the reason the notifications page (below) has to hand-roll a raw `fetch` for its single `PUT` call — a detail that would be baffling without seeing this file. Also note that `post`/`patch` only serialize a body when `data` is truthy, so a bodyless `POST` (like `marketplace/listings/:id/purchase`) sends no `Content-Type`-mismatched empty string; it just omits the body.

## apps/web/src/shared/useVaultItems.ts (shared foundation)

This custom hook is imported by the marketplace, services, and shipping pages, and it exists specifically to prevent a class of bug that used to plague those flows. Its doc comment states the motivation directly: passing a real item **UUID** (not a typed barcode or a free-text name) "is what prevents the 'invalid input syntax for type uuid' 500s on services/shipping." In an earlier iteration, those pages let the user type an item identifier into a text field; when the string was not a valid Postgres UUID, the query blew up with a 500 at the database layer. The fix was structural: never let the user *type* an id — always let them **pick** an item from a dropdown populated with genuine ids the server handed us.

The hook signature is `useVaultItems(storedOnly = false)`. Internally it keeps two pieces of state, `items` and `error`, and defines a memoized `reload` callback:

```ts
const reload = useCallback(async () => {
  try {
    const all = await api.get<VaultItem[]>('/vault/items');
    setItems(storedOnly ? all.filter((i) => i.lifecycleState === 'stored') : all);
    setError(null);
  } catch (e) {
    setError((e as Error).message);
  }
}, [storedOnly]);
```

The `storedOnly` flag is the second important design point. Services, shipping, and marketplace listing all require the item to be physically in custody and not already committed elsewhere, so those pages pass `useVaultItems(true)` and the hook client-side-filters to `lifecycleState === 'stored'`. A `useEffect` fires `reload` once on mount (its dependency is the memoized `reload`, which only changes if `storedOnly` changes), and the hook returns `{ items, error, reload }`. Exposing `reload` is what lets a page refresh the picker after an action that changes an item's state — e.g., after a marketplace purchase or a shipment rate selection, the item is no longer `stored`, so the page calls `reload()` to drop it from the dropdown.

The exported `VaultItem` interface (`id`, `typeClass`, `description`, `conditionGrade`, `lifecycleState`, `barcode`) is the canonical shape reused across the customer area, so the individual pages don't redeclare it.

## apps/web/src/shared/serviceLabels.ts (shared foundation)

The last shared module is a pair of plain string→string lookup maps, `SERVICE_TYPE_LABEL` and `SERVICE_STATUS_LABEL`, that translate the API's machine enums into Hebrew display text. `professional_photography` becomes "צילום מקצועי", `third_party_grading` becomes "דירוג", `consignment` becomes "קונסיגנציה", `donation` becomes "תרומה", and there are entries for `batch_split` and `warehouse_transfer` as well. The status map turns `requested`→"ממתין", `in_progress`→"אושר", `completed`→"הושלם", `cancelled`→"נדחה". This file is shared deliberately: both the customer-facing `ServicesPage` ("my requests" table) and the operator-facing `ServiceQueue` render the same enums, and centralizing the labels keeps the two views consistent. Every consumer reads them with a `?? raw` fallback (`SERVICE_TYPE_LABEL[r.type] ?? r.type`) so an unknown enum never renders blank — it degrades to the raw key.

With the shared plumbing established, the rest of this part covers the twelve page/console components in order.

---

## apps/web/src/areas/customer/auth/AuthPage.tsx

`AuthPage` is the unauthenticated entry point: it is the only component in the customer area that renders *before* a session exists, and its job is to obtain one. Its imports are minimal — `useState` from React and the shared `api` client. It also **exports** a small but load-bearing interface:

```ts
export interface SessionUser {
  id: string;
  role: string;
}
```

This is the exact shape the login endpoint returns and the shape the app shell threads through the rest of the tree to decide which area to mount. `AuthPage` accepts a single prop, `onSignedIn: (user: SessionUser) => void`, a callback the parent supplies to lift the freshly authenticated user up into app state.

The component holds three pieces of local state: `email` (defaulting to the demo string `'red@bault.dev'`), `password` (defaulting to `'11111111'`), and a nullable `message` used for both success and error text. Pre-filling the demo credentials is a pragmatic choice for a demo/review build — a reviewer can land on the page and immediately click "התחבר" without knowing any credentials. The hint line at the bottom documents the full roster of seeded demo accounts and the shared password (`11111111`): `red@bault.dev` and `golden@bault.dev` are collectors, `hermon@bault.dev` is a warehouse operator, and `eldar@bault.dev` is a manager. Choosing which email to log in as is therefore how a reviewer picks which role-scoped area to exercise.

There are two async handlers. `register()` calls `api.post<{ intakeId: string }>('/auth/register', { email, password })` and, on success, sets a message telling the user their intake id and asking them to check their email for verification — reflecting that registration produces a *pending* account that must be verified, not an immediately-usable session. Any thrown error is caught and its message shown via the same `message` slot. `login()` calls `api.post<SessionUser>('/auth/login', { email, password })`; on success it does **not** set a message — instead it immediately invokes `onSignedIn(user)`, handing the `{ id, role }` object to the parent, which will unmount `AuthPage` and mount the appropriate area. The API's side effect (setting the httpOnly cookie) is invisible here by design; from this component's perspective, login simply "returns the user."

The rendered JSX is a single `<section className="card auth-card">`. Inside are two `<label>`-wrapped `<input>`s (email and password, both `dir="ltr"` because credentials are Latin-script even though the surrounding UI is right-to-left Hebrew), an `.actions` div holding a primary "התחבר" (log in) button wired to `login` and a ghost "הרשם" (register) button wired to `register`, the demo-credentials hint paragraph (`className="hint"`), and a conditional `<p role="status">{message}</p>`. The `role="status"` is an accessibility affordance so screen readers announce login results. The button class pairing — `btn btn--primary` for the main action and `btn btn--ghost` for the secondary — is the design-system convention repeated throughout the app: exactly one primary action per action cluster, everything else de-emphasized.

The action cluster is worth quoting because it establishes the button idiom the rest of the app reuses verbatim:

```tsx
<div className="actions">
  <button className="btn btn--primary" onClick={login}>התחבר</button>
  <button className="btn btn--ghost" onClick={register}>הרשם</button>
</div>
```

**State summary**

- `email: string` — bound to the email input, prefilled `'red@bault.dev'`.
- `password: string` — bound to the password input, prefilled `'11111111'`.
- `message: string | null` — dual-purpose success/error line.

**Backend endpoints touched**

- `POST /auth/register` → `{ intakeId }` — creates a *pending* account and triggers an email-verification step.
- `POST /auth/login` → `SessionUser { id, role }` — sets the httpOnly session cookie as a side effect and returns the identity the shell routes on.

The asymmetry between the two handlers is the design point: `register` stays on the page and reports a next step ("check your email"), because registration does not yield a usable session; `login` leaves the page entirely by calling `onSignedIn`, because it does. Neither handler ever inspects the cookie — that is the browser's job.

## apps/web/src/areas/customer/vault/VaultPage.tsx

`VaultPage` (tagged T055 in its doc comment) is the collector's view of everything they currently own in storage. It imports `useEffect`/`useState` and the `api` client, and declares its own local `VaultItem` interface (`id`, `typeClass`, `description`, `conditionGrade`, `lifecycleState`, `barcode`) — the same shape the shared hook exports, redeclared here because this page loads and renders items directly rather than through the picker hook.

At module scope sits a `STATE_BADGE` lookup mapping each `lifecycleState` to a CSS badge-variant class: `stored`→`badge--stored`, `listed`→`badge--listed`, `sold`→`badge--sold`, `on-hold`→`badge--hold`, and `received`/`shipped`/`consigned`→`badge--info`, `donated`→`badge--success`. This is purely presentational — it lets the same badge element take on a state-appropriate color without a `switch` in the JSX. Any unmapped state falls back to an empty class (`?? ''`), so the badge still renders, just unstyled.

The component keeps three state slots: `items` (the list), `q` (the free-text search string), and `error`. The single data function is `load()`:

```ts
setItems(await api.get<VaultItem[]>(`/vault/items${q ? `?q=${encodeURIComponent(q)}` : ''}`));
```

This is the mapping to the backend: `GET /vault/items`, which the API scopes to the signed-in owner (the cookie identifies who "I" am, so the endpoint never needs an explicit owner id). When `q` is non-empty it is appended as an `encodeURIComponent`-escaped `?q=` query parameter, delegating the actual search to the server; when empty, the bare endpoint returns everything. A `useEffect` with an empty dependency array runs `load()` once on mount (with the `exhaustive-deps` lint suppressed because `load` closes over `q` but we intentionally only want the initial fetch).

The JSX renders a `<section>` titled "הכספת שלי" (My Vault). A `.field-row` holds the search `<input>` (bound to `q`) and a primary "חפש" (search) button that re-invokes `load` — so searching is an explicit action, not a debounced live filter. Errors render as `<p role="alert">`. The items themselves render as a `<ul className="card-grid">`, one `<li className="card">` per item, each showing: the `typeClass` as an `<h4 className="card-title">`, the description (or an em-dash placeholder when empty) as `.card-desc`, a `.card-meta` row pairing the state badge with a "מצב:" (condition) label showing `conditionGrade ?? '—'`, and a second `.card-meta` row with the `barcode` in a `dir="ltr"` `<code>` element. The `dir="ltr"` on the barcode matters: barcodes are Latin/numeric and would otherwise be mangled by the RTL flow direction of the Hebrew page.

Here is the card body that renders each item, which shows how the `STATE_BADGE` lookup and the em-dash fallbacks come together:

```tsx
<li key={it.id} className="card">
  <h4 className="card-title">{it.typeClass}</h4>
  <p className="card-desc">{it.description || '—'}</p>
  <div className="card-meta">
    <span className={`badge ${STATE_BADGE[it.lifecycleState] ?? ''}`}>{it.lifecycleState}</span>
    <span>מצב: {it.conditionGrade ?? '—'}</span>
  </div>
  <div className="card-meta">
    <code dir="ltr">{it.barcode}</code>
  </div>
</li>
```

**State summary**

- `items: VaultItem[]` — the owner-scoped list returned by the API.
- `q: string` — the free-text search box.
- `error: string | null` — surfaced as `role="alert"`.

**Backend endpoints touched**

- `GET /vault/items` — all of the caller's items (owner-scoped by cookie).
- `GET /vault/items?q=<term>` — server-side filtered when the search box is non-empty.

Two small choices deserve emphasis. First, search is *explicit*: nothing re-queries as you type; you press "חפש" (or Enter is not even wired here — it is a click). That keeps the request count low and the behaviour predictable. Second, the `description || '—'` and `conditionGrade ?? '—'` fallbacks use different operators on purpose — `||` because an empty description string should also fall back, `??` because a condition grade is either a real string or `null` and an empty string is not a meaningful case there.

## apps/web/src/areas/customer/finance/WalletPage.tsx

`WalletPage` (T072) presents the collector's money: a hero showing the current balance, a top-up control, and the full ledger. Its doc comment states the key architectural fact — the balance shown is **derived** (Σ of the ledger), and every ledger row is immutable. The UI never mutates a balance field directly; it displays a computed number the server returns and a running history it can audit.

Two small interfaces model the data. `Money` is `{ amount: number; currency: string }` where `amount` is in **minor units** (agorot/cents). `LedgerRow` is `{ id, type, amount, direction, occurredAt }`, where `direction` is `'credit'` or `'debit'`. State comprises `balance` (nullable `Money`), `ledger` (array), `topupAmount` (a number defaulting to `10000`, i.e. 100.00 ₪ expressed in agorot), and `error`.

`load()` fires two GETs sequentially — `/finance/wallet` for the derived balance and `/finance/ledger` for the transaction history — and stores each. `topup()` posts to `/finance/wallet/topups` with `{ amountMinor: topupAmount }` and then re-runs `load()` so both the hero and the ledger reflect the new credit. Sending the amount as `amountMinor` (not a decimal like `100.00`) keeps the client and server on the same integer-minor-units contract, avoiding floating-point drift in money math. A `useEffect` loads once on mount.

The hero only renders when `balance` is truthy: a `.hero` block with a `.hero-label` ("יתרה נוכחית" / current balance) and a `.hero-value` that divides the minor-unit amount by 100 and `toFixed(2)`s it, appending the currency in a `<span className="currency">`. This `/100 + toFixed(2)` conversion from minor units to a human decimal is the mirror image of the `amountMinor` we send on top-up, and it recurs in every money-rendering spot in the app. Below the hero, a `.field-row` holds a numeric `<input>` (bound to `topupAmount`, `dir="ltr"`) and a primary "טען ארנק (באגורות)" button — the label literally says "in agorot" to make the units unambiguous to the user.

The hero and top-up controls read like this, and the `/100 + toFixed(2)` conversion is the canonical minor-units-to-decimal render used everywhere in the app:

```tsx
{balance && (
  <div className="hero">
    <p className="hero-label">יתרה נוכחית</p>
    <p className="hero-value">
      {(balance.amount / 100).toFixed(2)}
      <span className="currency">{balance.currency}</span>
    </p>
  </div>
)}
```

The ledger renders as a `.table-wrap` wrapping a `.table`. The `.table-wrap` is the standard responsive scroll container so a wide table scrolls horizontally on small screens rather than blowing out the page. The table has three columns (תאריך/date, סוג/type, סכום/amount). Each row keys on `r.id`; the date cell slices the ISO `occurredAt` to its first 10 characters (`YYYY-MM-DD`) and forces `dir="ltr"`; the amount cell applies a conditional class — `row-credit` vs `row-debit` — and prefixes a `+` or a Unicode minus `−` based on `direction`, then renders the `/100` decimal. Colouring credits and debits differently and signing them is what lets a user scan the history and immediately see money in vs money out.

The signed amount cell is the one piece of genuinely conditional rendering in the table:

```tsx
<td dir="ltr" className={r.direction === 'credit' ? 'row-credit' : 'row-debit'}>
  {r.direction === 'credit' ? '+' : '−'}
  {(r.amount / 100).toFixed(2)}
</td>
```

**State summary**

- `balance: Money | null` — the derived Σ-ledger balance; the hero only renders once it is non-null.
- `ledger: LedgerRow[]` — the immutable transaction history.
- `topupAmount: number` — the top-up input, in minor units (default `10000` = 100.00 ₪).
- `error: string | null`.

**Backend endpoints touched**

- `GET /finance/wallet` → `Money { amount, currency }` — the derived balance.
- `GET /finance/ledger` → `LedgerRow[]` — the full auditable history.
- `POST /finance/wallet/topups` `{ amountMinor }` — credits the wallet, after which `load()` re-runs.

The architectural takeaway is that the balance is *never* a stored, directly-mutated field the client edits. The client posts a top-up event, the server appends an immutable ledger row, and the balance the hero shows is the server's recomputed sum. The UI's only job is to display the derived number and re-fetch after any money-moving action.

## apps/web/src/areas/customer/marketplace/MarketplacePage.tsx

`MarketplacePage` is the busiest customer page: it browses/searches active listings, buys, makes offers, and lets the user list one of their own stored items for sale. It imports `useEffect`/`useState`, the `api` client, and the `useVaultItems` hook. Its `Listing` interface carries pricing (`askingPrice`, `currency`), the underlying item (`itemId`, `typeClass`, `conditionGrade`, `description`), and an optional `imageUrl?`.

State: `listings`, a nullable `status` message, the vault picker (`const { items, reload: reloadItems } = useVaultItems(true)` — stored-only, because you can only sell something you actually hold), `sellItemId` (the selected item to list), `sellPrice` (defaulting to `50000` agorot = 500 ₪), and `q` (the marketplace search box). A `useEffect` auto-selects the first vault item into `sellItemId` once items arrive and nothing is chosen yet — a small ergonomics touch so the "sell" control is immediately usable.

`loadListings()` calls `GET /marketplace/listings?q=${encodeURIComponent(q)}` — note the `?q=` is always present (even when empty), delegating search to the server exactly like the vault page. It runs once on mount via a separate `useEffect`. The three action handlers each map to a REST endpoint:

- `buy(id)` → `POST /marketplace/listings/${id}/purchase` (no body). On success it sets "הרכישה הושלמה" (purchase complete), then reloads both the listings *and* the vault picker, because the purchased item now belongs to the buyer and may become sellable, while the sold listing disappears.
- `offer(id)` → prompts the user for an amount in agorot via `window.prompt`, bails if falsy, then `POST /marketplace/listings/${id}/offers` with `{ amount }`. Using a `prompt` here is a deliberately lightweight choice for a secondary action; offers do not need a full form.
- `sell()` → guards that `sellItemId` is set (otherwise sets "בחר פריט למכירה"), then `POST /marketplace/listings` with `{ itemId: sellItemId, askingPrice: sellPrice }`. On success it reloads listings and the picker (the just-listed item leaves the stored-only picker).

The critical design note lives in the doc comment and the JSX: the seller chooses the item "from a vault dropdown — a real UUID, so no invalid-id 500." This is the same historical bug the `useVaultItems` hook was built to kill. The `<select>` is populated from `items`, each `<option>`'s `value` is the genuine `i.id` UUID, and the label shows `typeClass — description`. There is a leading disabled-ish "— בחר פריט —" placeholder option with an empty value, and the "הצע למכירה" button is `disabled={!sellItemId}` so you cannot submit without a real id. The `sell` fieldset also holds the numeric price input (`dir="ltr"`) and uses the `btn--accent` variant to distinguish "list for sale" from the primary browse actions.

The sell fieldset shows the UUID-picker pattern that eliminates the invalid-id 500 — the option values are real item ids, and the submit is disabled until one is chosen:

```tsx
<select value={sellItemId} onChange={(e) => setSellItemId(e.target.value)}>
  <option value="">— בחר פריט —</option>
  {items.map((i) => (
    <option key={i.id} value={i.id}>{i.typeClass} — {i.description}</option>
  ))}
</select>
<input type="number" value={sellPrice} onChange={(e) => setSellPrice(Number(e.target.value))} dir="ltr" />
<button className="btn btn--accent" disabled={!sellItemId} onClick={sell}>הצע למכירה (באגורות)</button>
```

The browse grid is a `<ul className="card-grid">` of listing cards. Each card conditionally renders `{l.imageUrl && <img src={l.imageUrl} alt={l.typeClass} />}` — the image only appears when the listing has one, and the `alt` falls back to the type. Below the image are the title (`typeClass`), description, a `.price` line rendering `(askingPrice / 100).toFixed(2)` plus currency in `dir="ltr"`, and an `.actions` cluster with a primary "קנה" (buy) and a ghost "הצע מחיר" (make offer). The `status` message renders once near the top as `<p role="status">`.

**State summary**

- `listings: Listing[]` — active marketplace listings (search-filtered).
- `status: string | null` — one shared status/error line.
- `{ items, reload: reloadItems } = useVaultItems(true)` — the stored-only sell picker.
- `sellItemId: string` — selected item to list (auto-seeded to the first item).
- `sellPrice: number` — asking price in minor units (default `50000`).
- `q: string` — the marketplace search box.

**Backend endpoints touched**

- `GET /marketplace/listings?q=<term>` — browse/search (the `?q=` is always present).
- `POST /marketplace/listings/:id/purchase` — buy (bodyless).
- `POST /marketplace/listings/:id/offers` `{ amount }` — make an offer (amount prompted, in minor units).
- `POST /marketplace/listings` `{ itemId, askingPrice }` — list one of your stored items.

After both `buy` and `sell`, the page calls `reloadItems()` in addition to `loadListings()`. This dual refresh is deliberate: purchasing brings a new item into your vault while removing a listing, and selling removes an item from your stored-only picker while adding a listing — so both the grid and the dropdown must be re-synced for the UI to stay truthful.

## apps/web/src/areas/customer/services/ServicesPage.tsx

`ServicesPage` lets a collector order value-added, billable services against one of their stored items and then track the resulting requests. It imports `useCallback`/`useEffect`/`useState`, the `api` client, the `useVaultItems` hook, and the shared `SERVICE_STATUS_LABEL`/`SERVICE_TYPE_LABEL` maps. Locally it defines a `STATUS_BADGE` map (`requested`→`badge--pending`, `in_progress`→`badge--accepted`, `completed`→`badge--done`, `cancelled`→`badge--denied`) and a `MyRequest` interface (`id`, `type`, `status`, `itemId`, `createdAt`, `typeFields`).

State: the stored-only picker via `useVaultItems(true)` (destructured to `items`, `error`, `reload`), a selected `itemId`, a nullable `status` message, and a `requests` array. `loadRequests` is a `useCallback` that GETs `/services/mine` and swallows any error (`catch { /* ignore */ }`) — the "my requests" list is secondary, so a transient failure there shouldn't blast an alert over the whole page. One `useEffect` auto-selects the first vault item into `itemId`; another runs `loadRequests` on mount.

The linchpin is the `run(fn, ok)` helper. It first guards that an item is selected (`if (!itemId) { setStatus('בחר פריט קודם'); return; }`), then awaits the passed action, sets the success message, and refreshes *both* the vault picker and the requests list. Centralizing the guard + refresh means every service button shares identical pre/post behaviour and only differs in the endpoint it calls. Each of the three simple services is wired inline:

- Photography → `run(() => api.post('/services/photography', { itemId }), 'בקשת צילום נשלחה')`
- Grading → `run(() => api.post('/services/grading', { itemId }), 'בקשת דירוג נשלחה')`
- Consignment → `run(() => api.post('/services/consignment', { itemId, channel: 'eBay' }), ...)` — note the hard-coded `channel: 'eBay'`, the single supported consignment channel in this build.

Donation is special because it is a **two-step, confirmation-guarded** flow, reflecting that giving away an asset is irreversible. The `donate()` function first `POST`s `/services/donation` with `{ itemId }` and receives a `{ confirmationToken }` challenge, then immediately `POST`s `/services/donation/confirm` with that token. The token round-trip is the server's mechanism to ensure a donation is a deliberate two-phase commit rather than a single accidental click; here the UI chains both halves so the user experiences one "תרומה" button, but the backend contract is honoured. Donation is wired through `run(donate, 'הפריט נתרם')` and uses the `btn--accent` variant to visually separate the destructive-ish action from the primary services.

The `run` helper is the shared spine of all four service buttons — one guard, one refresh path, differing only in the injected action:

```tsx
async function run(fn: () => Promise<unknown>, ok: string) {
  if (!itemId) { setStatus('בחר פריט קודם'); return; }
  try {
    await fn();
    setStatus(ok);
    await reload();          // refresh the stored-only picker
    await loadRequests();    // refresh the "my requests" table
  } catch (e) {
    setStatus((e as Error).message);
  }
}
```

And the two-step donation, which honours the server's confirmation-token contract but presents as one button to the user:

```tsx
async function donate() {
  const challenge = await api.post<{ confirmationToken: string }>('/services/donation', { itemId });
  await api.post('/services/donation/confirm', { confirmationToken: challenge.confirmationToken });
}
```

The JSX: a `.card` holds the item `<select>` (same UUID-picker pattern, with the placeholder option and a "אין פריטים מאוחסנים זמינים בכספת" hint when the list is empty), then an `.actions` cluster of four buttons, each `disabled={!itemId}`. Below, `status` and `error` render as `role="status"`/`role="alert"`. Then "הבקשות שלי" (My Requests): if empty, a hint; otherwise a `.table-wrap`/`.table` with columns שירות/status/date. Each row translates `type` via `SERVICE_TYPE_LABEL[...] ?? r.type`, renders the status through a badge whose class comes from `STATUS_BADGE` and whose text comes from `SERVICE_STATUS_LABEL`, and slices `createdAt` to its date. The `?.slice(0,10)` (optional chaining) defends against a missing timestamp.

**State summary**

- `{ items, error, reload } = useVaultItems(true)` — the stored-only item picker.
- `itemId: string` — selected item (auto-seeded to the first stored item).
- `status: string | null` — shared status/error line.
- `requests: MyRequest[]` — the caller's own service requests.

**Backend endpoints touched**

- `POST /services/photography` `{ itemId }` — order professional photography.
- `POST /services/grading` `{ itemId }` — order third-party grading.
- `POST /services/consignment` `{ itemId, channel: 'eBay' }` — order consignment sale.
- `POST /services/donation` `{ itemId }` → `{ confirmationToken }` then `POST /services/donation/confirm` `{ confirmationToken }` — the two-step donation.
- `GET /services/mine` → `MyRequest[]` — the tracking table (loaded via a swallow-errors callback).

The status-badge lookup is the customer-side mirror of the operator's `ServiceQueue`: both files import the same `SERVICE_STATUS_LABEL`/`SERVICE_TYPE_LABEL` maps and define the identical `STATUS_BADGE` variant map, so a request labelled "ממתין" with a `badge--pending` pill on the customer's tracking table reads identically in the operator's queue.

## apps/web/src/areas/customer/shipping/ShipmentPage.tsx

`ShipmentPage` implements outbound shipping as an explicit three-step flow: create a shipment, fetch carrier rates, select a rate. It imports the same trio (`useEffect`/`useState`, `api`, `useVaultItems`) and defines a `Rate` interface (`carrier`, `serviceLevel`, `costMinor`, `currency`). The doc comment underscores two things: the item is chosen from the vault (a real UUID again), and the physical scan-verified dispatch is *not* here — it happens later in the warehouse console. So this page is the customer half of shipping; the operator half is `DispatchPanel` in `WarehouseConsole`.

State: stored-only picker (`items`, `error`, `reload`), selected `itemId`, an `address` prefilled with a demo Israeli address ("הרצל 1, תל אביב"), a `rush` boolean, a `shipmentId` (populated after creation), a `rates` array, and a `status` message. A `useEffect` auto-selects the first item.

`create()` guards for a selected item, then `POST`s `/shipping/shipments` with `{ itemIds: [itemId], destinationAddress: address, rush }`. Note the item is sent as a single-element **array** (`itemIds`), matching an API that supports multi-item shipments even though this UI only builds one-item ones. It stores the returned `id` into `shipmentId`, then immediately GETs `/shipping/shipments/${s.id}/rates` to populate the rate cards, and sets the "נוצר משלוח — בחר תעריף" (shipment created — choose a rate) status. This two-call sequence in one handler is why the user perceives a single "create and get rates" button.

`select(rate)` `POST`s `/shipping/shipments/${shipmentId}/select-rate` with `{ carrier, serviceLevel }` — it identifies the chosen rate by its carrier + service-level pair rather than by an index, which is robust to reordering. The doc comment on the flow notes the selected rate is auto-charged server-side. On success it composes a rich status string echoing the chosen carrier, service level, and cost (`/100`), notes the item is now "ממתין לשילוח במחסן" (awaiting warehouse dispatch), clears the `rates` array (collapsing the picker), and calls `reload()` so the now-committed item drops out of the stored-only picker.

The `create` handler is the two-call sequence that makes step 1 and step 2 feel like one button:

```tsx
const s = await api.post<{ id: string }>('/shipping/shipments', {
  itemIds: [itemId],
  destinationAddress: address,
  rush,
});
setShipmentId(s.id);
setRates(await api.get<Rate[]>(`/shipping/shipments/${s.id}/rates`));
setStatus('נוצר משלוח — בחר תעריף');
```

The JSX: a `.card` with a `.field-row` containing the item `<select>` (UUID picker), the destination address `<input>`, a `rush` checkbox wrapped in a `<label>` ("משלוח מהיר" / express), and a primary "צור משלוח וקבל תעריפים" button that is `disabled={!itemId}`. Below, `status`/`error`. The rates render as a `card-grid` of cards, each keyed on `` `${carrier}-${serviceLevel}` `` (the composite key again), showing carrier as the title, service level as the description, the `costMinor/100` price in `dir="ltr"`, and an accent "בחר" (select) button calling `select(r)`.

**State summary**

- `{ items, error, reload } = useVaultItems(true)` — stored-only picker.
- `itemId: string` — selected item (auto-seeded).
- `address: string` — destination, prefilled with a demo Israeli address.
- `rush: boolean` — express flag.
- `shipmentId: string` — populated after step 1.
- `rates: Rate[]` — carrier quotes for step 2; cleared after selection.
- `status: string | null`.

**Backend endpoints touched**

- `POST /shipping/shipments` `{ itemIds, destinationAddress, rush }` → `{ id }` — create.
- `GET /shipping/shipments/:id/rates` → `Rate[]` — carrier quotes.
- `POST /shipping/shipments/:id/select-rate` `{ carrier, serviceLevel }` — commit + auto-charge.

The item is sent as `itemIds: [itemId]` — a single-element array against a multi-item-capable API — and the rate is selected by its `{ carrier, serviceLevel }` identity rather than an array index, which is resilient to the server returning quotes in a different order. After selection the page clears `rates` (collapsing the picker to signal completion) and calls `reload()` so the now-committed item leaves the stored-only dropdown. The physical dispatch that follows is deliberately *not* on this page — it is the operator's scan-verified `DispatchPanel` in the warehouse console.

## apps/web/src/areas/customer/notifications/NotificationsPage.tsx

`NotificationsPage` (tagged NOT) renders the user's notification feed newest-first and per-event-type opt-in toggles. It is the most defensively-coded page in the customer area, for two reasons that both trace back to real bugs.

First, the `content` field of a notification is **jsonb** — it may be a string, an object, an array, or null. Rendering an object directly as a React child throws the infamous "Objects are not valid as a React child" runtime crash. The file guards against this with a dedicated helper:

```ts
function renderContent(content: unknown): string {
  if (content == null) return '—';
  if (typeof content === 'string') return content;
  try { return JSON.stringify(content); }
  catch { return String(content); }
}
```

Every notification's content is funneled through `renderContent` before it reaches JSX, so the cell always receives a *string*: null becomes an em-dash, strings pass through, objects are stringified, and anything that resists `JSON.stringify` (e.g. a circular structure) degrades to `String(content)`. The `AppNotification` interface even types `content` as `unknown` and carries an inline comment ("jsonb — may be an object; render defensively") to keep future editors from naively dropping `{n.content}` into the JSX. This is the "object-as-child crash" the task brief refers to, and this helper is precisely how the current code avoids it.

Second, notification **preferences** are written with a `PUT`, but the shared `api` client only exposes `get/post/patch/del` — there is no `put`. So the file hand-rolls a single raw `fetch`, deliberately mirroring the client's conventions:

```ts
async function putPreference(eventType: string, enabled: boolean): Promise<void> {
  const res = await fetch('/api/v1/notifications/preferences', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, enabled }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? res.statusText);
  }
}
```

It replicates `credentials: 'include'` (same cookie session), the JSON content type, the same `{ error: { message } }` unwrapping, and the same `res.statusText` fallback — so from the calling code's perspective this bespoke `PUT` behaves identically to an `api.*` call. This is a conscious trade-off: rather than widen the shared client's surface for one endpoint, the one oddball call absorbs the boilerplate locally.

At module scope, `EVENT_LABEL` maps the five known event types to Hebrew (`item_received`→"פריט התקבל", `item_sold`→"פריט נמכר", `offer_received`→"התקבלה הצעה", `shipment_out`→"משלוח יצא", `hold_placed`→"הוטלה החזקה"), and `EVENT_TYPES = Object.keys(EVENT_LABEL)` drives the toggle list. A `Preference` is `{ eventType, enabled }`.

State: `notifications`, `prefs`, `error`, and a `saving` boolean that disables the toggles mid-write to prevent double-submits. The `load` callback fetches the feed and the preferences **in parallel** with `Promise.all`, then **sorts the feed newest-first** client-side via `list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))` — using `localeCompare` on ISO date strings (which sort lexicographically == chronologically) and defaulting missing timestamps to empty strings so the comparator never throws. A `useEffect` runs `load` on mount.

`isEnabled(eventType)` implements the "default enabled" semantics from the doc comment: it looks for an explicit preference and returns its `enabled`; if none exists, it returns `true`. So a brand-new user with no stored preferences sees every toggle on, and only an explicit `enabled: false` record turns one off. `toggle(eventType, enabled)` sets `saving`, calls `putPreference`, then re-fetches the preferences to reflect the server's canonical state (rather than optimistically trusting the local checkbox), and always clears `saving` in a `finally`.

The "default enabled unless explicitly disabled" rule lives in one small function, and it is what lets a brand-new user with zero stored preferences see every toggle switched on:

```tsx
function isEnabled(eventType: string): boolean {
  const pref = prefs.find((p) => p.eventType === eventType);
  return pref ? pref.enabled : true;
}
```

The JSX: a `.card` labelled "העדפות התראות" (notification preferences) with a hint and a `.field-row` of checkboxes — one per `EVENT_TYPES` entry, each `checked={isEnabled(et)}`, `disabled={saving}`, and toggling via `onChange`. Below, an `<h3>` shows "ההתראות שלי" with a live count `({notifications.length})`. When empty, a hint; otherwise a `.table-wrap`/`.table` with columns אירוע/content/date. The event cell renders an info badge with the Hebrew label (or raw type fallback), the content cell renders `renderContent(n.content)` in `dir="ltr"` (jsonb payloads are typically Latin), and the date cell slices `createdAt`.

**State summary**

- `notifications: AppNotification[]` — the feed, sorted newest-first client-side.
- `prefs: Preference[]` — stored per-event-type opt-in records.
- `error: string | null`.
- `saving: boolean` — disables the toggles mid-write to block double-submits.

**Backend endpoints touched**

- `GET /notifications` → `AppNotification[]` — the feed (fetched in parallel with prefs).
- `GET /notifications/preferences` → `Preference[]` — the stored toggles.
- `PUT /api/v1/notifications/preferences` `{ eventType, enabled }` — the hand-rolled raw-`fetch` write, because the shared client has no `put`.

The critical content cell is a single call — `<td dir="ltr">{renderContent(n.content)}</td>` — never `{n.content}`. That distinction is the entire defence against the object-as-child crash: because `content` is jsonb typed as `unknown`, the only safe thing to hand JSX is the guaranteed-string output of `renderContent`.

## apps/web/src/areas/customer/profile/ProfilePage.tsx

`ProfilePage` (ACC) shows the account's own details, lets the user edit their display name, and manages saved shipping addresses. It imports `useCallback`/`useEffect`/`useState` and `api`, and defines two interfaces: `Profile` (`id`, `email`, `intakeId`, `role`, `status`, `displayName`) and `Address` (`id`, `label`, `recipient`, `line1`, `city`, `country`, `postalCode`, `isDefault`). A `ROLE_LABEL` map translates the role enum for display (`user`→"אספן" / collector, `warehouse_operator`→"עובד מחסן", `admin`→"מנהל").

The top-level component keeps `profile`, `displayName` (the editable copy), `addresses`, a `status` message, and an `error`. The `load` callback fetches `/me/profile` and `/me/addresses` in parallel via `Promise.all`, seeds both the `profile` and the editable `displayName` (`p.displayName ?? ''`), stores the addresses, and clears any error. A `useEffect` runs it on mount. `saveName()` `PATCH`es `/me/profile` with `{ displayName }`, replaces `profile` with the server's response, and shows "השם נשמר" (name saved). `removeAddress(id)` `DELETE`s `/me/addresses/${id}` and reloads. These map cleanly to the ACC endpoints: read profile + addresses, patch profile, delete address, and (via the child form) post a new address.

The JSX renders a `.card` (only when `profile` is loaded) showing the email (`dir="ltr"`), the intake id in a `<code>`, and the role as an info badge — each paired with a `.hint`-styled label inside a `.card-meta` paragraph. A `.field-row` holds the display-name `<input>` and a "שמור שם" button. Below, "כתובות למשלוח" (shipping addresses): if none, a hint; otherwise a `card-grid` of address cards, each showing the `label` (with a "ברירת מחדל" / default info-badge when `isDefault`), the recipient, the composed address line (`line1, city, country postalCode`), and a **danger**-variant "מחק" (delete) button calling `removeAddress`. Using `btn--danger` here signals destructiveness consistently with the rest of the app.

The page factors address creation into a separate `AddressForm` child component that receives `onAdded` and `onError` callbacks. This keeps the seven address fields' state (`label`, `recipient`, `line1`, `city`, `country` defaulting to "ישראל"/Israel, `postalCode`, `isDefault`) local to the form rather than polluting the parent. A derived `valid` flag (`label && recipient && line1 && city && country && postalCode`) gates the submit button so the form cannot be posted half-empty. `add()` `POST`s `/me/addresses` with all fields, clears the inputs on success, and calls `onAdded()` (which in the parent sets "הכתובת נוספה" and reloads). Errors bubble up via `onError`. The form is a `<fieldset>` with a `<legend>` and a `.field-row` of labelled inputs, the `isDefault` checkbox, and a primary "הוסף כתובת" button `disabled={!valid}`. The parent/child split is the notable design choice: it isolates a chunk of form state and gives the parent a clean two-callback contract instead of prop-drilling seven setters.

The parent's usage of the child is a compact two-callback contract — no setters cross the boundary:

```tsx
<AddressForm
  onAdded={async () => { setStatus('הכתובת נוספה'); await load(); }}
  onError={(m) => setError(m)}
/>
```

**State summary (parent)**

- `profile: Profile | null` — the account record; the details card only renders when non-null.
- `displayName: string` — the editable copy seeded from `profile.displayName`.
- `addresses: Address[]` — saved shipping addresses.
- `status` / `error: string | null`.

**Backend endpoints touched**

- `GET /me/profile` → `Profile` and `GET /me/addresses` → `Address[]` — loaded in parallel.
- `PATCH /me/profile` `{ displayName }` — save the display name; returns the updated profile.
- `POST /me/addresses` `{ label, recipient, line1, city, country, postalCode, isDefault }` — add.
- `DELETE /me/addresses/:id` — remove, then reload.

## apps/web/src/areas/customer/Banners.tsx

`Banners` is a small decorative component (ADM-05, customer side) that surfaces the manager-authored dashboard banners above the tab content. It imports `useEffect`/`useState` and `api`, and defines a `Banner` interface (`id`, `title`, `link`). It holds a single `banners` array. On mount, a `useEffect` fires `api.get<Banner[]>('/banners').then(setBanners).catch(() => {})` — and the empty catch is deliberate: banners are non-essential, so a fetch failure is swallowed silently rather than showing an error. This is the same "decorative — ignore failures" philosophy as the services page's request list, applied even more strictly.

The component **returns `null` when there are no banners** (`if (banners.length === 0) return null;`), so it contributes nothing to the layout — no empty `<section>`, no stray margin — when there is nothing to show. That early return is the whole reason the app can mount `<Banners />` unconditionally at the top of the dashboard without worrying about blank space.

When there *are* banners, it renders an `aria-label`led `<section>` and maps each banner to a `.card` styled inline with design-system CSS variables (`var(--space-2)`, `var(--space-4)`, `var(--accent)`) rather than a dedicated class. The inline style gives each banner a slim accent-coloured leading border (`borderInlineStart: '4px solid var(--accent)'` — using the logical `border-inline-start` property so it flips correctly under RTL), flex layout with wrapping, and gap spacing. Each banner shows a 📣 emoji plus its title as a zero-margin `.card-title`, and, when `link` is present, an "לפרטים" (details) anchor opening in a new tab with `target="_blank" rel="noreferrer"` — the `rel="noreferrer"` being the standard security hardening for external links so the opened page can't reach back through `window.opener`.

## apps/web/src/areas/warehouse/WarehouseConsole.tsx

`WarehouseConsole` (T054) is the operator's cockpit and the most compositionally rich file in this part: one top-level component plus four private sub-components (`DispatchPanel`, `BinsPanel`, `ReportPanel`) and the imported `ServiceQueue`. Its guiding design principle, stated in the doc comment, is **scanner-first**: a keyboard-wedge barcode scanner types straight into the text fields and emits an Enter keystroke, so the flows are built so a scan can drive them with no mouse. It imports `useCallback`/`useEffect`/`useState`, `api`, and `ServiceQueue`.

The top-level component maintains a rolling activity `log` (a `string[]`) and an `append` helper that prepends a line and caps the list at 20 entries (`[line, ...prev].slice(0, 20)`) — newest-first, bounded so it never grows without limit. This log is the operator's running feedback channel; every sub-flow reports into it.

**Intake.** State `ownerIntakeId` (prefilled "BAULT-0001"), `typeClass` (prefilled "Trading Card"), and an optional `binId`. `intake()` `POST`s `/intake/items` with `{ ownerIntakeId, typeClass, binId: binId || undefined }` — the `|| undefined` ensures an empty bin field is omitted rather than sent as `""`, letting the server treat it as "no bin yet." On success it appends "נקלט פריט {barcode} ({id})" so the operator sees the generated barcode and id; on failure it appends the error. Mapping: intake creates a new custody item owned by the referenced customer.

**Relocate.** State `scanItem` and `scanBin`. `relocate()` `POST`s `/custody/items/${scanItem}/relocate` with `{ binId: scanBin }`, logs the move, and clears both fields for the next scan. The scan-only ergonomics show here: the `scanBin` input has `onKeyDown={(e) => e.key === 'Enter' && relocate()}`, so after the operator scans the item barcode into the first field and the shelf barcode into the second, the scanner's trailing Enter fires the relocate automatically — no button press. The legend even instructs "סרוק פריט, סרוק מדף" (scan item, scan shelf).

The rolling log and its bounded prepend are the operator's feedback channel; every sub-panel funnels lines into it:

```tsx
const [log, setLog] = useState<string[]>([]);
const append = (line: string) => setLog((prev) => [line, ...prev].slice(0, 20));
```

The Enter-to-submit wiring on the second scan field is the concrete expression of the scanner-first idea:

```tsx
<input
  placeholder="סרוק מדף"
  value={scanBin}
  onChange={(e) => setScanBin(e.target.value)}
  onKeyDown={(e) => e.key === 'Enter' && relocate()}
  dir="ltr"
/>
```

The JSX arranges the console as a stack of `<fieldset>`s, each a titled section: intake, relocate, dispatch (`<DispatchPanel onLog={append} />`), bins (`<BinsPanel onLog={append} />`), inventory report (`<ReportPanel />`), the embedded `<ServiceQueue />`, and finally an `<h3>יומן</h3>` (log) rendering the log array as a `<ul className="log">`. Passing `append` down as `onLog` is how every panel funnels feedback into the single shared log.

**DispatchPanel** (T109) implements scan-verified outbound dispatch — the operator half of the shipping flow whose customer half is `ShipmentPage`. It holds `shipmentId` and a comma-separated `scanned` string. `dispatch()` `POST`s `/shipping/shipments/${shipmentId}/dispatch` with `scannedItemIds: scanned.split(',').map(s => s.trim()).filter(Boolean)` — parsing the scanned field into a clean array, trimming whitespace and dropping empties. The doc comment states the API **rejects the dispatch unless the scanned set matches the shipment's items exactly**, which is the physical safety check: you cannot ship a box until you've scanned precisely the items that belong in it. On success it logs the returned `trackingNumber`. The panel is a `.field-row` with a shipment-id input, a scanned-items input, and a primary "אשר ושלח" (confirm and ship) button.

The scanned-set parsing is worth quoting because the trim/filter guard is what keeps a stray trailing comma or space from being sent as a bogus item id:

```tsx
const res = await api.post<{ trackingNumber: string }>(`/shipping/shipments/${shipmentId}/dispatch`, {
  scannedItemIds: scanned.split(',').map((s) => s.trim()).filter(Boolean),
});
onLog(`נשלח ${shipmentId} · מעקב ${res.trackingNumber}`);
```

**BinsPanel** (INV-01) creates and lists storage bins. It holds `bins`, `zone`, `capacity` (a string defaulting "10"), and an optional `barcode`. A memoized `load` GETs `/custody/bins` (swallowing errors so a load failure leaves the existing list intact), run on mount. `create()` `POST`s `/custody/bins` with `{ zone, capacity: Number(capacity), barcode: barcode || undefined }` — barcode omitted when empty, letting the server auto-generate one (the doc comment: "barcode auto-generated when omitted"). On success it logs the new bin, clears zone/barcode, and reloads. The create button is `disabled={!zone || capacity === ''}` so a bin can't be created without a zone and capacity. Bins render in a `.table-wrap`/`.table` (barcode `dir="ltr"`, zone, capacity), with an "אין תאים עדיין" (no bins yet) hint when empty.

**ReportPanel** (CST-06) renders the inventory report grouped by a selectable "cut." A `CUT_LABEL` map defines the four cuts: `shelf`→"לפי מדף", `owner`→"לפי בעלים", `condition`→"לפי מצב", `item_class`→"לפי מחלקת פריט". It holds the current `cut` (default "shelf"), the `rows` (`{ key, count }`), and an `error`. A `useEffect` keyed on `cut` refetches `/custody/report?cut=${cut}` whenever the selection changes — so switching the dropdown re-runs the aggregation server-side. The `<select>` is built from `Object.entries(CUT_LABEL)`. Rows render in a table whose first header is the human cut label; each row shows `r.key ?? '— ללא —'` (grouping key, or a placeholder for the null/ungrouped bucket) and the count. The row key `` `${r.key ?? 'none'}-${i}` `` combines key and index to stay unique even if two rows share a null key. An empty result shows "אין נתונים להצגה" (no data).

The cut-driven refetch is the whole mechanism — a `useEffect` whose dependency array is `[cut]`:

```tsx
useEffect(() => {
  api.get<ReportRow[]>(`/custody/report?cut=${cut}`)
    .then((r) => { setRows(r); setError(null); })
    .catch((e: Error) => setError(e.message));
}, [cut]);
```

**WarehouseConsole endpoint map**

- `POST /intake/items` `{ ownerIntakeId, typeClass, binId? }` → `{ id, barcode }` — intake.
- `POST /custody/items/:id/relocate` `{ binId }` — relocate (Enter-driven).
- `POST /shipping/shipments/:id/dispatch` `{ scannedItemIds }` → `{ trackingNumber }` — scan-verified dispatch.
- `GET /custody/bins` and `POST /custody/bins` `{ zone, capacity, barcode? }` — bins list + create.
- `GET /custody/report?cut=<shelf|owner|condition|item_class>` → `ReportRow[]` — inventory aggregation.

Everything on this console reports into the single 20-line rolling log, so the operator has one continuous transcript of intakes, relocations, dispatches, and bin creations regardless of which fieldset produced them.

## apps/web/src/areas/warehouse/ServiceQueue.tsx

`ServiceQueue` is the operator counterpart to the customer `ServicesPage`: it lists pending and accepted service requests and lets the operator accept/deny and then complete them. It is rendered *embedded inside* `WarehouseConsole`, not as its own tab. It imports `useCallback`/`useEffect`/`useState`, `api`, and the shared `SERVICE_STATUS_LABEL`/`SERVICE_TYPE_LABEL` maps, and reuses the same `STATUS_BADGE` map as the customer page. Its `QueueItem` interface is richer than the customer's `MyRequest` because the operator needs cross-user context: it adds `requesterEmail` and `itemDescription` (joined server-side) alongside `id`, `type`, `status`, `itemId`, and `typeFields`.

The parent component holds `queue` and a `msg`. A memoized `load` GETs `/services/queue` (the operator-scoped list of actionable requests) and runs on mount. An `act(fn, ok)` helper — structurally identical to the customer page's `run`, minus the item guard — awaits the action, sets the success message, and reloads the queue. The JSX is a `<fieldset>` legend "בקשות שירות" (service requests); when empty it shows "אין בקשות ממתינות" (no pending requests); otherwise a `.table-wrap`/`.table` with columns שירות/לקוח/פריט/סטטוס/פעולות (service/customer/item/status/actions). Each row shows the translated type, the `requesterEmail ?? '—'` (`dir="ltr"`, since it's an email), the `itemDescription ?? '—'`, a status badge (class from `STATUS_BADGE`, text from `SERVICE_STATUS_LABEL`), and a `<QueueActions>` cell.

`QueueActions` is where the per-type completion controls live, and it is the interesting part. It holds two local input states used only by the completion forms — `grade` (default "PSA 9") and `sale` (default 100000 agorot). Its render is a small state machine keyed on the request's `status` and `type`:

- If `status === 'requested'`, it shows the **accept/deny** pair: a primary "אשר" button → `POST /services/requests/${q.id}/accept`, and a danger "דחה" button → `POST /services/requests/${q.id}/deny`. This is the triage step — the operator decides whether to take the job.
- Otherwise the request is `in_progress` (accepted) and the control **branches by type** to a type-specific completion:
  - `professional_photography` → a single "סיים צילום" button posting `/services/photography/${q.id}/complete` with `{ objectKey: `images/${q.id}-pro.jpg` }`. The object key is synthesized from the request id, standing in for the uploaded photo's storage location.
  - `third_party_grading` → a `grade` text input plus a "סיים דירוג" button posting `/services/grading/${q.id}/complete` with `{ grade }` — so the operator records the assigned grade (e.g. "PSA 9").
  - `consignment` → a numeric `sale` input (agorot) plus a "סיים מכירה (אגורות)" button posting `/services/consignment/${q.id}/complete` with `{ saleAmountMinor: sale }` — recording the realized sale price in minor units, consistent with the money contract used everywhere else.
  - Any other type falls through to a plain `—`, meaning there's no operator-completable action (e.g. donation completes elsewhere).

The triage branch is the simplest slice of the state machine, and it shows the accept/deny endpoint pair:

```tsx
if (q.status === 'requested') {
  return (
    <div className="field-row">
      <button className="btn btn--primary" onClick={() => onAct(() => api.post(`/services/requests/${q.id}/accept`), 'הבקשה אושרה')}>אשר</button>
      <button className="btn btn--danger" onClick={() => onAct(() => api.post(`/services/requests/${q.id}/deny`), 'הבקשה נדחתה')}>דחה</button>
    </div>
  );
}
```

This branch-by-type design keeps the completion form tightly matched to what each service actually needs to capture, and co-locating the per-row input state inside `QueueActions` means each row's grade/sale fields are independent — editing one row's grade doesn't touch another's.

**ServiceQueue endpoint map**

- `GET /services/queue` → `QueueItem[]` — pending + accepted requests with joined `requesterEmail`/`itemDescription`.
- `POST /services/requests/:id/accept` and `POST /services/requests/:id/deny` — triage a `requested` item.
- `POST /services/photography/:id/complete` `{ objectKey }` — complete a photography job.
- `POST /services/grading/:id/complete` `{ grade }` — record the assigned grade.
- `POST /services/consignment/:id/complete` `{ saleAmountMinor }` — record the realized sale price.

The completion payloads are the operator-side counterpart to the customer's order calls in `ServicesPage`: the customer creates a `requested` row, the operator moves it to `in_progress` (accept) and then to `completed` with the type-specific result data captured in these forms.

## apps/web/src/areas/admin/AdminConsole.tsx

`AdminConsole` is the manager's console and by far the largest file in this part — a single file housing a top-level tabbed shell plus six section components and two inline-editable row components. It imports `useCallback`/`useEffect`/`useState` and `api`. At the top it declares option arrays reused by the editors — `ROLES` (`user`, `warehouse_operator`, `admin`), `STATUSES` (`pending`, `active`, `suspended`, `closed`), and `STATES` (the eight item lifecycle states) — and a `SECTIONS` tuple (`as const`) defining the six sub-tabs with their keys and Hebrew labels: users (משתמשים), items/cards (כרטיסים), pricing (תמחור), disputes (מחלוקות), banners (באנרים), storage fees (דמי אחסון). The `SectionKey` type is derived from that tuple so the active-section state is exhaustively typed.

The shell component holds `section` (the active sub-tab, default `'users'`), `users`, `items`, and a shared `msg` string that every section writes status/error text into. `load()` fetches `/admin/users` and `/admin/items` and runs on mount. The JSX renders an `<h2>ניהול</h2>`, a `<nav className="tabs">` of tab buttons (each gets `is-active` when selected), the shared `msg` as `role="status"`, and then conditionally renders the active section. Users and items render inline as tables; the other four delegate to dedicated section components (`PricingSection`, `DisputesSection`, `BannersSection`, `StorageFeesSection`), each receiving `onMsg={setMsg}` so they can report into the shared message line. Loading users+items eagerly (even before their tabs are opened) is what lets the item editor offer an owner dropdown populated with real users without a second fetch.

The shell's tab bar is the same `tabs`/`tab`/`is-active` idiom the rest of the app uses, driven off the typed `SECTIONS` tuple:

```tsx
<nav className="tabs">
  {SECTIONS.map((s) => (
    <button key={s.key} className={`tab${section === s.key ? ' is-active' : ''}`} onClick={() => setSection(s.key)}>
      {s.label}
    </button>
  ))}
</nav>
```

**Users table & `UserRow`.** The users section renders a table (email/name/role/status/save) with one `<UserRow>` per user. `UserRow` is an **inline editor**: it seeds local state from the user (`displayName`, `role`, `status`) and renders editable controls — a name text input, a role `<select>` from `ROLES`, and a status `<select>` from `STATUSES`. Its `save()` `PATCH`es `/admin/users/${user.id}` with `{ displayName, role, status }` and reports "נשמר: {email}" up via `onSaved`. Each row edits and saves independently, which is the whole point of per-row local state — the manager can retune one account without a global form.

```tsx
async function save() {
  try {
    await api.patch(`/admin/users/${user.id}`, { displayName, role, status });
    onSaved(`נשמר: ${user.email}`);
  } catch (e) {
    onSaved((e as Error).message);
  }
}
```

**Items table & `ItemRow`.** Structurally the same pattern, richer schema. `ItemRow` seeds `description`, `typeClass`, `conditionGrade`, `ownerId`, `lifecycleState`, and `holdFlag`, and renders text inputs for description/type/condition, an **owner `<select>` populated from the `users` list** (so reassigning ownership is a pick, not a typed id — the same UUID-safety principle as the customer pickers), a lifecycle-state `<select>` from `STATES`, and a `holdFlag` checkbox. `save()` `PATCH`es `/admin/items/${item.id}` with all six fields and reports "נשמר כרטיס: {barcode}". This is the admin escape hatch to correct any item's metadata, ownership, state, or hold flag directly.

The owner dropdown is the admin-side instance of the UUID-picker discipline — option values are real user ids, never typed strings:

```tsx
<select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
  {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
</select>
```

This is exactly why the shell eagerly loads `users` alongside `items` even before the items tab is opened: the item editor needs the full user list on hand to render this dropdown without a second round-trip.

**PricingSection** (ADM-02 / PRC-02). Manages pricing rules. `ACTION_TYPES` (`intake`, `storage`, `service`, `shipping`, `marketplace_fee`) and `ACTION_LABEL`/`MODEL_LABEL` provide the Hebrew display text; `MODEL_LABEL` distinguishes `fixed` ("סכום קבוע") from `percentage` ("אחוז"). It holds `rules` plus the new-rule form state (`actionType`, `itemClass`, `model`, `value`). A memoized `load` GETs `/pricing/rules`. `create()` `POST`s `/pricing/rules` with `{ actionType, itemClass: itemClass || undefined, model, value: Number(value) }` — an empty item class is omitted so the rule applies to all classes. The create button is `disabled={value === ''}`. The rendered form is a `<fieldset>` with the action `<select>`, an item-class input, the model `<select>`, a numeric value input, and the add button; a hint clarifies the units — "באגורות עבור סכום קבוע; בנקודות בסיס עבור אחוז (100 = 1%)" — i.e. fixed values are minor-unit amounts and percentages are **basis points** (100 bps = 1%). The rules table renders action, class (`?? 'הכל'` / all), a model badge, and the value formatted per model: `${(value/100).toFixed(2)} ₪` for fixed vs `${(value/100).toFixed(2)}%` for percentage, then currency and effective-from date. Rendering the same stored integer two different ways depending on `model` is the subtle correctness detail here.

The value cell is the subtle part — the same stored integer is formatted two different ways depending on the rule's `model`:

```tsx
<td dir="ltr">{r.model === 'fixed' ? `${(r.value / 100).toFixed(2)} ₪` : `${(r.value / 100).toFixed(2)}%`}</td>
```

**DisputesSection** (ADM-04). Manages transaction disputes. `DISPUTE_STATUSES` (`open`, `investigating`, `ruled`, `closed`) with matching `DISPUTE_LABEL` and `DISPUTE_BADGE` maps drive the display. It holds `disputes` plus the open-form state (`transactionId`, `note`). `load` GETs `/admin/disputes`. `open()` `POST`s `/admin/disputes` with `{ transactionId, note: note || undefined }` (button `disabled={!transactionId}`). Existing disputes render via `<DisputeRow>`, another inline editor that seeds `status` and `ruling` and, on `save()`, `PATCH`es `/admin/disputes/${dispute.id}` with `{ status, ruling: ruling || undefined }`. `DisputeRow`'s `onSaved` is `async` and, in the parent, both sets the message *and* reloads the list — so a status change immediately re-renders the badge. The row shows a truncated id (`dispute.id.slice(0, 8)`) to keep the UUID from dominating the column, the transaction id, a status badge, the current ruling, and an edit cluster (status `<select>` + ruling input) plus an "עדכן" (update) button.

**BannersSection** (ADM-05). The manager side of the same banners the customer `Banners` component displays. It holds `banners` plus new-banner form state (`title`, `link`, `active` defaulting true). `load` GETs `/admin/banners`. `create()` `POST`s `/admin/banners` with `{ title, link: link || undefined, active }` (button `disabled={!title}`). `toggle(b)` `PATCH`es `/admin/banners/${b.id}` with `{ active: !b.active }` to flip visibility, and `remove(id)` `DELETE`s `/admin/banners/${id}`. The table shows title, link (`?? '—'`), a status badge (`badge--success` "פעיל" when active, blank "כבוי" when off), and an actions cluster with a ghost toggle button ("כבה"/"הפעל" — turn off/on) and a danger "מחק" (delete). The toggle and delete handlers are the terse CRUD verbs the row actions call:

```tsx
async function toggle(b: AdminBanner) { await api.patch(`/admin/banners/${b.id}`, { active: !b.active }); await load(); }
async function remove(id: string) { await api.del(`/admin/banners/${id}`); onMsg('הבאנר נמחק'); await load(); }
```

This is the full CRUD lifecycle of a banner, and it closes the loop with the customer-facing `Banners` component: what a manager marks `active` here is exactly what `GET /banners` returns to collectors' dashboards.

**StorageFeesSection** (VLT-04). Runs the periodic storage-fee billing job and lists past runs. Interfaces `FeeRun` (`id`, `thresholdDays`, `runAt`, `chargedItemIds`, `totalAmount`, `currency`) and `FeeRunResult` (`runId`, `chargedCount`, `totalAmount`). State: `runs`, `thresholdDays` (default "90"), a nullable `result`, and a `running` guard. `load` GETs `/admin/storage-fee-runs`. `run()` sets `running`, `POST`s `/admin/storage-fee-runs` with `{ thresholdDays: Number(thresholdDays) }`, stores the returned `result`, reloads the history, and clears `running` in a `finally`. The button is `disabled={running || thresholdDays === ''}` to prevent concurrent runs and empty thresholds. The doc/hint explains the semantics: every stored item received more than the threshold number of days ago gets charged. On completion a `role="status"` line reports "חויבו {chargedCount} פריטים, סה״כ {totalAmount/100} ₪" (charged N items, total X). The history table shows date, threshold days, the count of charged items (defensively `Array.isArray(r.chargedItemIds) ? r.chargedItemIds.length : 0` — guarding against a non-array payload), and the total. This `Array.isArray` guard is a smaller sibling of the notifications page's defensive rendering: never assume a JSON field is the shape you expect before calling array methods on it.

The run handler shows the `running` guard being set and released around the billing call:

```tsx
async function run() {
  setRunning(true);
  try {
    const res = await api.post<FeeRunResult>('/admin/storage-fee-runs', { thresholdDays: Number(thresholdDays) });
    setResult(res);
    await load();
  } catch (e) {
    onMsg((e as Error).message);
  } finally {
    setRunning(false);
  }
}
```

**AdminConsole endpoint map**

- `GET /admin/users`, `PATCH /admin/users/:id` `{ displayName, role, status }` — user administration.
- `GET /admin/items`, `PATCH /admin/items/:id` `{ description, typeClass, conditionGrade, ownerId, lifecycleState, holdFlag }` — item administration.
- `GET /pricing/rules`, `POST /pricing/rules` `{ actionType, itemClass?, model, value }` — pricing.
- `GET /admin/disputes`, `POST /admin/disputes` `{ transactionId, note? }`, `PATCH /admin/disputes/:id` `{ status, ruling? }` — disputes.
- `GET /admin/banners`, `POST /admin/banners` `{ title, link?, active }`, `PATCH /admin/banners/:id` `{ active }`, `DELETE /admin/banners/:id` — banners CRUD.
- `GET /admin/storage-fee-runs`, `POST /admin/storage-fee-runs` `{ thresholdDays }` → `{ runId, chargedCount, totalAmount }` — storage-fee billing.

---

## Cross-cutting patterns and the bugs the current code avoids

Reading these twelve files together, several conventions recur, and it is worth collecting them because they are the load-bearing decisions of the whole web front-end.

**Cookie-session auth, no tokens in JS.** Every page authenticates purely through the httpOnly cookie set at login and forwarded by `credentials: 'include'`. No page ever reads, stores, or attaches a bearer token. `AuthPage.login` returns `{ id, role }` only so the *shell* can pick an area; the actual credential lives in a cookie the JS never touches. This is why an operator page like `WarehouseConsole` can call owner-scoped endpoints without ever naming the operator.

**Server-side scoping via the session.** Endpoints like `/vault/items`, `/finance/wallet`, `/services/mine`, `/me/profile`, and `/notifications` are implicitly scoped to "me" — the pages never pass an owner id, because the cookie already identifies the caller. The admin and operator consoles, by contrast, hit `/admin/*`, `/services/queue`, and `/custody/*` endpoints that return cross-user data, which is exactly why those areas are gated by role at the shell.

**Minor-units money everywhere.** Balances, top-ups, prices, offers, consignment sale amounts, storage-fee totals, and pricing-rule values are all integers in minor units on the wire, converted to a human decimal only at render (`/100 + toFixed(2)`) and back to minor units on input. This keeps money math integer-exact end to end. The pricing section adds the wrinkle that percentages are stored as basis points, rendered with a `%` suffix instead of a currency symbol.

**The invalid-UUID 500, and how it's prevented.** The marketplace, services, and shipping pages historically let users type item identifiers, and a non-UUID string produced a database-level "invalid input syntax for type uuid" 500. The current code eliminates this entire class of bug by never letting the user type an id: `useVaultItems` loads real items and every relevant page renders a `<select>` whose option values are genuine UUIDs, with the action buttons `disabled` until a real id is chosen. The admin item editor applies the same idea to owner reassignment (a user dropdown, not a typed id).

**The object-as-child crash, and how it's prevented.** The notifications feed's `content` is jsonb and may be an object; dropping it straight into JSX would throw "Objects are not valid as a React child." The current code funnels it through `renderContent`, which always returns a string (em-dash for null, pass-through for strings, `JSON.stringify` for objects, `String()` as a last resort). The `content: unknown` typing and the inline warning comment keep the guard from being accidentally removed. The storage-fee section's `Array.isArray` check before `.length` is a smaller instance of the same "don't trust the JSON shape" discipline.

**The missing `put`, and how it's handled.** The shared `api` client exposes only `get/post/patch/del`. The one endpoint that needs `PUT` — notification preferences — hand-rolls a raw `fetch` inside `NotificationsPage`, faithfully replicating the client's cookie inclusion, JSON headers, and uniform `{ error: { message } }` unwrapping so it behaves like a first-class `api` call. This is a conscious "keep the shared surface small; absorb the oddball locally" trade-off.

**Uniform status/error surfacing.** Almost every page keeps a nullable `status`/`msg`/`error` string, renders it through `role="status"` (info) or `role="alert"` (error) for accessibility, and populates it in a `catch (e) { ... (e as Error).message }` — which works precisely because the shared client rethrows the server's human message. Decorative or secondary loads (`Banners`, the services "my requests" list, the bins list) deliberately swallow their errors instead, so a non-critical failure never blasts an alert over the page.

**Design-system class vocabulary.** The same class names recur across every file: `card`/`card-grid`/`card-title`/`card-desc`/`card-meta` for content cards, `field-row` for horizontal input clusters, `actions` for button groups, `btn` with `btn--primary`/`btn--ghost`/`btn--accent`/`btn--danger` variants encoding action prominence and destructiveness, `badge` with state-specific variant classes for status pills, `table`/`table-wrap` for responsive scrollable tables, `hero`/`hero-label`/`hero-value` for the wallet's headline balance, `tabs`/`tab`/`is-active` for the admin sub-navigation, and `hint` for muted helper text. Hebrew RTL content is the default flow, with `dir="ltr"` applied surgically to Latin/numeric data (emails, barcodes, ids, dates, money, credentials). This shared vocabulary is why twelve independently-authored pages read as one coherent product.
