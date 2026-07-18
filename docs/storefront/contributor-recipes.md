---
title: Storefront Contributor Recipes
description: Beginner-safe recipes for adding routes, server queries, client state, translations, and SSR-safe UI.
status: scaffolded
audience: [beginner, frontend]
last_verified: '2026-07-18'
source_of_truth:
    - apps/storefront/src/app/pages
    - apps/storefront/src/app/features
    - apps/storefront/src/app/data-access
    - apps/storefront/src/app/core/state
---

# Storefront contributor recipes

These recipes are guardrails, not copy-paste substitutes for understanding the owning feature. Start with the smallest relevant recipe and follow its verification checklist.

## Recipe: add a customer page

**Use when:** a new stable customer URL is required.

1. Choose the file-based URL shape under `src/app/pages`.
2. Build the real feature under `src/app/features`; keep the page entry thin.
3. Add `routeMeta` only for required guards or route behavior.
4. Reuse the shared layout rather than rebuilding header/footer composition.
5. Verify direct SSR request, hydrated navigation, browser back/forward, and unknown parameters.
6. Add metadata/SEO behavior when the route is indexable.

**Done means:** the URL works on refresh, not only after navigating from the home page.

## Recipe: add a server-owned reader

**Use when:** the API is authoritative for a list or record.

1. Confirm the response contract in `packages/contracts`.
2. Add a method to the owning `data-access/services` service.
3. Add or extend an `injectQuery` function with a stable key.
4. Enable it only after required identifiers exist.
5. Handle pending, error, empty, success, and refetch states in the feature.
6. Test with SSR and browser navigation.

```ts title="Shape, not a project-specific endpoint"
export function injectExampleQuery(id: Signal<string | undefined>) {
	return injectQuery(() => ({
		queryKey: ['example', id()],
		enabled: Boolean(id()),
		queryFn: () => exampleService.getById(id()!),
	}));
}
```

Avoid the non-null assertion shown in many generic examples. In project code, narrow the identifier before invoking the service or structure the query function so TypeScript can prove it exists.

## Recipe: add a client-owned workflow

Ask these questions first:

- Does the server own the record? Use a query/mutation instead.
- Does only one component need it? Use local state.
- Is it a small cross-component state object? Consider SignalStore.
- Does it have many events, optimistic transitions, effects, and derived selectors? Consider classic NgRx.

If classic NgRx is justified:

1. Define state and event payloads.
2. Keep reducers pure.
3. Put side effects in effects.
4. Expose selectors rather than raw state shape.
5. Decide whether persistence is safe and necessary.
6. Cover reducer transitions and effect outcomes.

## Recipe: add a browser-only enhancement

1. Render a stable server-safe baseline.
2. Inject `PLATFORM_ID`.
3. Guard only the browser-dependent operation.
4. Avoid accessing browser globals during field initialization.
5. Verify server render and hydration without console errors.
6. Respect reduced motion and keyboard/touch input.

## Recipe: add or change a translation

1. Use semantic translation keys rather than copying visible English into templates.
2. Update every active locale file in the same change.
3. Verify parameter interpolation and plural behavior.
4. Test narrow layouts because translated strings expand.
5. Do not mark Bengali implemented until the runtime locale inventory and content coverage match the locked `en/bn` decision.

## Pull-request checklist

- [ ] The change lives in the correct directory and layer.
- [ ] External data has a typed, validated contract boundary.
- [ ] Mock behavior is labelled and not mistaken for a backend capability.
- [ ] SSR and browser navigation were both checked.
- [ ] Loading, error, empty, and success states are intentional.
- [ ] Keyboard, touch, focus, and reduced-motion behavior were considered.
- [ ] Unit/e2e coverage matches the risk.
- [ ] Portal status, sources, and verification date were updated when behavior changed.
