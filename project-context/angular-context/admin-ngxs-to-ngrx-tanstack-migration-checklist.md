# Admin State Migration Checklist (NGXS → NgRx + TanStack Query)

**Purpose.** This is the reusable, battle-tested checklist derived from actually migrating the `apps/admin` state layer off NGXS onto the owner's locked stack. Follow it to perform the **same migration on `apps/storefront`**. It captures every pattern, every gotcha, and the owner's decisions from the admin build. Where the storefront must differ, it is flagged **⚠️ STOREFRONT DIFFERS**.

> Context: we discarded an earlier "hand-rebuild the UI" approach. The corrected approach is: **port the vendor UI verbatim, then migrate the state layer feature-by-feature to the locked stack**, keeping the app green and verifiable at every step. This checklist is the corrected recipe.

---

## 0. The target stack (locked)

| Concern | Technology | Where it lives |
|---|---|---|
| Server state (lists, details, dropdown data) | **TanStack Query** (`@tanstack/angular-query-experimental`) | `data-access/queries/<feature>.queries.ts` |
| App-wide UI/session state (permissions, menu, auth, loader) | **NgRx SignalStore** (`@ngrx/signals`) | `core/state/<name>.store.ts` |
| Cart & orders (client-side collections, optimistic flows) | **NgRx classic Store/Effects/Entity** (`@ngrx/store` + `@ngrx/effects` + `@ngrx/entity`) | `core/state/cart/` |
| i18n | Transloco (later phase) | — |
| Forms | Reactive/Signal Forms | — |
| Charts | ApexCharts | — |

Deps to add: `@ngrx/{signals,store,effects,entity}`, `@tanstack/angular-query-experimental`.
Provide once in `app.config.ts`: `provideTanStackQuery(new QueryClient())`, and (when cart/orders land) `provideStore({ cart: cartReducer })` + `provideEffects(CartEffects)`.

---

## 1. Golden rules (learned the hard way)

1. **The production build is the source of truth**, not the dev server. Run `pnpm --filter <app> build` after every feature. It has been 100% reliable.
2. **⚠️ VITE DEP-HASH GOTCHA (will happen at least twice).** The first time you *use* a newly-added npm dep (e.g. adding `provideStore`/`provideEffects`, or the first `@ngrx/signals` import), Vite re-optimizes deps mid-session and serves **mixed dep chunks with two different `?v=<hash>` values** → spurious `NG0203`/`NG0302` (often surfacing on an unrelated service like `_HttpClient`/`StateService`). It is **not** a real bug. Fix: `pkill -f vite; rm -rf apps/<app>/node_modules/.vite`, then restart the dev server.
3. **Stale HMR console errors are noise.** After many edits, the dev server keeps old module versions (`?t=<timestamp>` URLs, old line numbers) in the console. Verify against the green build and, if unsure, `fetch('/src/.../file.ts?t='+Date.now()).then(r=>r.text())` to confirm the *served* module is clean. Restart to clear.
4. **Remove a state only when ALL its consumers are migrated.** Grep the STATE name **and every ACTION name** (action-only consumers hide from a State-name grep — this bit us on `AttachmentState` and category `DeleteCategoryAction`).
5. **The linter reformats saved files to TABS.** `Edit` `old_string`s with space indentation won't match reformatted bodies — match top-level (unindented) import lines, or `Write` the whole file.
6. **Migrate incrementally; keep the app green.** Each state removal is a checkpoint. Never leave two stores for the same data both live (e.g. cart split between NGXS + NgRx) — finish the swap before moving on.

---

## 2. Canonical patterns (copy these)

### 2a. TanStack list query
```ts
// data-access/queries/<feature>.queries.ts
export function injectXsQuery(params: () => Params) {
  const svc = inject(XService);
  return injectQuery(() => ({
    queryKey: ['xs', params()],
    queryFn: () => firstValueFrom(svc.getXs(params())),
  }));
}
```
Component (list):
```ts
private readonly params = signal<Params>({});
readonly xsQuery = injectXsQuery(() => this.params());
constructor() {
  effect(() => {
    const x = this.xsQuery.data();
    this.tableConfig.data = x ? x.data : [];
    this.tableConfig.total = x ? x.total : 0;
  });
}
onTableChange(data?: Params) { this.params.set({ ...data }); }
```
- **Static/effectively-immutable data** (countries, states): add `staleTime: Infinity` to load-once-and-cache (mirrors NGXS "if already loaded, skip").
- **`firstValueFrom` + loader interceptor:** the interceptor MUST use `finalize`, not `tap({complete})` — `firstValueFrom` unsubscribes on first emission before `complete` fires, so a tap-complete loader sticks forever.
- **`effect()` in `ngOnInit`** throws `NG0203` — put it in the constructor, or pass `{ injector: inject(Injector) }`.

### 2b. Select2 / dropdown cross-consumer (keep template's `| async`)
```ts
private readonly xsQuery = injectXsQuery(() => ({ status: 1 }));
xs$: Observable<Select2Data> = toObservable(
  computed(() => this.xsQuery.data()?.data.map(x => ({ label: x.name, value: x.id })) ?? []),
);
```
Template stays `(xs$ | async)`. Preserve the exact selector shape (some had a nested `data: { name, slug, image, ... }`).

### 2c. Form edit-fetch → **use the service directly** (simpler than a query for a one-shot)
```ts
this.route.params.pipe(
  switchMap(params => {
    if (!params['id']) return of();
    return this.xService.getXs().pipe(map(res => res.data.find(x => x.id == params['id']) ?? null));
  }),
  takeUntil(this.destroy$),
).subscribe(x => { /* patch form */ });
```
Replaces the old `dispatch(EditXAction).pipe(mergeMap(() => store.select(XState.selectedX)))`.

### 2d. Filter-function selector → replicate as a private method + signal
Some NGXS selectors returned a *function* (`select(S.attributes).pipe(map(fn => fn(arg)))`, same for `states`). Replicate over query data:
```ts
private readonly selectedArg = signal<string>('');
result$ = toObservable(computed(() => this.filterX(this.selectedArg())));
private filterX(arg: string): Select2Data { /* same filter+map logic over query.data() */ }
// where the old code reassigned result$, instead: this.selectedArg.set(arg);
```

### 2e. NgRx SignalStore (app-wide UI/session)
```ts
export const XStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(store => ({ derived: computed(() => ...) })),
  withMethods((store, dep = inject(Dep)) => ({
    load(): Observable<T> { return dep.get().pipe(tap(r => patchState(store, { ... }))); }, // return obs so callers can .subscribe({complete})
    clear() { patchState(store, initialState); },
  })),
  withHooks({ onInit(store) { /* hydrate from localStorage + effect(() => localStorage.setItem(...getState(store))) */ } }),
);
```
- Consumers read signals in TS, or `toObservable(store.field)` to keep template `| async`.
- Synchronous readers (e.g. a `*hasPermission` directive) read the signal directly inside an `effect()`.

### 2f. Classic NgRx cart (client-side collection)
`core/state/cart/{cart.actions,cart.reducer,cart.selectors,cart.effects}.ts`:
- `createActionGroup` for actions; `createEntityAdapter<ICart>` + a `total` field in the reducer; `total` recomputed from `selectAll(state)` after each mutation.
- Effects: `loadCart` (service → success), `addToCart` (branch: `payload.id ? updateCart : addNewItem`), `updateCart` (`withLatestFrom(selectCartItems)`, stock-check → `notification.showError` + `EMPTY`, else `setQuantity`/`deleteCart`).
- **`store.dispatch()` returns void** (unlike NGXS which returned an Observable) — components that did `.dispatch(...).subscribe({complete})` must act synchronously instead.
- Load the cart in **every** entry point that reads it (create-order AND checkout) — checkout redirected to `/order/create` on direct load because we forgot `loadCart()` there.
- Cart is **in-memory** (not persisted). It survives SPA router navigation but not a full page reload — this matches the original and is correct for a cart.

### 2g. Mock writes
All create/update/delete/import/export are no-op mocks (no backend yet). Replace `dispatch(WriteAction)` with the local side effect only (reset form, navigate, dismiss modal, clear selection) + a `// ... has no backend yet` comment.

---

## 3. Execution order (dependency-driven — do NOT go alphabetically)

The order matters because shared states can only be *removed* once their last consumer migrates. Proven admin order:

1. **Pilot** one simple list (tag) end-to-end to lock the patterns + wire `provideTanStackQuery`.
2. **Independent list/form features** (coupon, faq, page, refund, currency, tax, role, questions-answers, blog, shipping, review, order-status, point, customer-ledger, notification, media/attachment). Each: list→query, form→service-direct edit, Select2 cross-consumers→computed, writes→mock. Remove the state when its consumers are done.
3. **App-shell SignalStores** (loader, menu, account/permissions, auth). These gate everything — do carefully, verify the shell (sidebar, header, permission-gated buttons) live.
4. **"Foundation" for the feature phase** (owner's framing): account + attachment + auth (SignalStore + persistence). Cart deferred to orders.
5. **Feature cluster, simplest-first:** blog → store → product+category → **order+cart last**.
6. **Order is the convergence hub.** Migrating it removes the coupled states (User, Product, Order, Country, State, OrderStatus) and finishes the dashboard/review reads. Introduce the classic NgRx cart here.
7. **Cross-consumers converge on `dashboard`** (reads order/product/topProduct/category/review) + `theme-option`/`coupon-form`/`link`/`form-blog` (product/category). Migrate these to free the last states.
8. **Leftover app-infrastructure:** DashboardState (2 dashboard reads, persisted, delicate ApexChart timing) + SettingState (app-wide, persisted, many readers). Do these last as a focused pass to fully remove NgxsModule + NgxsStoragePlugin. *(Admin left these two as the final documented step.)*

**Coupling reality:** a state (User, Product, Category, Country, State, OrderStatus) whose consumers span multiple features can't be removed until the LAST feature migrates — usually `order`/`create-order`/`checkout`. Map the consumer graph first (grep State + all Actions) so you know the true removal order.

---

## 4. Regressions we hit — check for these

- **Table row-action wipe:** the shared table's permission gate destructively set `tableConfig.rowActions = []` when `permissions()` was momentarily empty (permissions load async once account persistence was dropped), and never restored. **Fix:** the gating effect early-returns while `permissions()` is empty.
- **Logout navigation:** was handled by an NGXS `ofActionDispatched(LogoutAction)` listener in `app.ts`. Moving auth to SignalStore means the store's `logout()` must navigate itself; delete the app.ts listener.
- **Content routes are UNGUARDED** in admin (the guard is only `canActivateChild` on the `auth` route and returns `true`). Login/logout are cosmetic; the token exists only for the HTTP `Authorization` header. Don't assume a route guard protects `/dashboard`. ⚠️ STOREFRONT DIFFERS — the storefront will have real auth-gated routes (account, orders, checkout) and needs real guards.
- **Checkout empty on direct load:** forgot `loadCart()` in checkout (see 2f).
- **`of(signal.set(...))` trick:** to preserve a `dispatch(...).subscribe({next})` structure while switching to a params-signal, replace `store.dispatch(GetXAction(filter))` with `of(this.xParams.set({ ...filter }))` — `of(void)` emits once so the `next` body still runs, and the query refetches. Used in theme-option/form-product where the patch body sat inside the dispatch's `next`.

---

## 5. Verification workflow (per feature)

1. `pnpm --filter <app> build` — must be green.
2. Grep to confirm zero references to the removed State + Actions (exclude the query file + comments).
3. Live-check via the preview server (admin is a SPA on :4300; log in by `form.requestSubmit()`, navigate with `window.location.href` for full reload or click routerLinks for SPA nav). Confirm: rows render, forms patch, dropdowns populate, console clean.
4. For cart/permission/chart-sensitive changes, exercise the actual interaction (add to cart, permission-gated button, variant builder) — a green build does not catch timing/logic bugs.

---

## 6. Owner decisions from the admin build (re-confirm for storefront, don't assume)

| # | Question | Admin answer | Storefront note |
|---|---|---|---|
| D1 | Platform: keep Angular CLI+SSR or move to AnalogJS Vite? | **AnalogJS Vite, SPA (no SSR)** — admin is behind login, zone.js app crashed Vite SSR. | **⚠️ MUST RE-ASK. SSR/SEO is NOT optional for a public storefront.** Expect SSR/SSG (AnalogJS+Nitro) → this changes routing, data-fetching (server transfer state), auth (cookies not localStorage), and TanStack hydration. Ask before starting. |
| D2 | File-based routing (Analog) now? | **Deferred** — kept `provideRouter` config routing in admin SPA mode. | **⚠️ RE-ASK.** With SSR the `analog()` platform + file-based routing is the natural path; revisit. |
| D3 | Auth store: SignalStore vs classic Store? | **SignalStore + localStorage persistence** (token bag; simple flows). | **⚠️ RE-ASK.** Storefront auth is httpOnly cookie + CSRF + rotating refresh (per security constraints) — NOT localStorage. Likely different shape. |
| D4 | Cart/orders: how much classic NgRx? | **Hybrid** — cart = classic Store/Effects/Entity; order *reads* = TanStack; mock checkout local. | Storefront cart/orders are core + real flows (add→checkout→place→history) → lean MORE classic (Entity for cart+order lines, Effects for checkout/payment). **RE-ASK the split.** |
| D5 | Cart timing | **Migrated with orders** (shared Entity infra). | Same principle. |
| D6 | Multi-vendor/store/wallet | **Stripped** (single-store); wallet page → `customer-ledger`. | Confirm storefront scope (single store, no vendor UI). |
| D7 | Feature sequencing | "Do all in your recommended order, no bugs." | Confirm the owner still wants autonomous execution or per-phase checkpoints. |
| D8 | Fastkart Attributes / Classified product builder | **Use the UI pattern, not the domain assumption.** Fastkart's Attribute + Value selects and generated accordions are reusable inspiration, but every option group must choose semantic role (`filter_only`, `variation_axis`, `named_add_on`, `bundle_component_option`) and `displayStyle` separately. Only `variation_axis` creates the Cartesian variant matrix. | Storefront must render the same six styles (`rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`) while keeping business behavior from API semantics. |

**Additional storefront-only questions to raise up front:** SSR data hydration strategy (TanStack `dehydrate`/`hydrate` vs Angular TransferState); SEO metadata/OpenGraph per route; guest cart vs logged-in cart merge; PWA/offline (no PII cached offline per constraints); i18n routing (Transloco + locale in URL?); payment provider integration points; image/CDN strategy.

---

## 7. Definition of done (admin)

- ✅ ~20 NGXS feature states removed; server state on TanStack, app-shell on SignalStore, cart on classic NgRx.
- ✅ Every feature verified live + green production build at each step.
- ⏳ Remaining: `DashboardState` + `SettingState` (documented in §3.8) — the final pass to fully remove `NgxsModule` + `NgxsStoragePluginModule`.
- ⏭️ Later phases (both apps): Transloco i18n, PWA, then Phase 6 (move mock API/data JSON into `apps/api` under `admin/`).
