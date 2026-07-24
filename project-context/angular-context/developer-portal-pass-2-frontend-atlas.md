# Developer Portal Pass 2 — Frontend Application Atlas

**Status:** Implemented and verified on 2026-07-18

**Scope:** Storefront, admin and shared frontend contributor documentation

**Portal runtime:** Docusaurus 3.10.2
**Depends on:** `developer-portal-scalar-visual-baseline.md` and the Pass 1 governance foundation

## Purpose

Pass 2 converts the placeholder storefront and admin portal sections into an evidence-backed application atlas. It is designed for a first-time contributor who needs to understand the current code without mistaking broad UI scaffolding for production integrations.

## Implemented portal surfaces

### Storefront

- Orientation and directory ownership.
- Interactive implementation atlas with lifecycle filters, search and evidence disclosures.
- Analog file-based routing and dynamic SSR guide.
- TanStack Query, SignalStore, classic NgRx and service ownership guide.
- Beginner recipes for routes, readers, client workflows, browser-only behavior and translations.

### Admin

- Orientation and route-family inventory.
- Interactive implementation atlas with lifecycle filters, search and evidence disclosures.
- Root routing, content/full shells, lazy feature routes and guard behavior.
- Query, store, service, interceptor and fixture ownership.
- Forms, tables, CRUD state design and bulk-operation guidance.
- Beginner recipes for feature families, lists, forms, mock replacement and permissions.

### Shared frontend

- Interactive state-ownership decision lab.
- Shared contract and dependency-boundary guidance.
- Honest cross-application UI reuse boundary.
- Frontend quality and definition-of-done contract.

## Code reconciliation recorded by this pass

- The storefront uses Analog file-based routing and dynamic SSR through Nitro; prerendering is disabled.
- Storefront catalogue listing has an API seam while product detail and several adjacent readers still use JSON fixtures.
- Storefront cart behavior is implemented in classic NgRx as a client workflow; authoritative server cart behavior is not implied.
- Storefront checkout, authentication, refunds, reviews and several other writes remain unconnected seams.
- Transloco is wired, but the current runtime locale inventory advertises `en/fr`; the locked target is `en/bn`.
- The PWA/offline requirement remains planned because the Vite PWA integration is not present in the current configuration.
- The admin has a broad lazy feature graph and reusable shell/table/form surface.
- Most admin readers still use JSON fixtures and most mutations remain explicit mock seams.
- Admin guard/menu/directive behavior is presentation logic, not API authorization.
- `packages/contracts` contains real zod contract modules; a repository-level `packages/ui` implementation is not present.
- Frontend automated-test coverage is currently minimal and must not be represented as mature.

## Interaction and accessibility contract

- Atlas status buttons expose `aria-pressed`.
- State-decision controls use tab semantics.
- Filter results announce changes through a polite live region.
- Search uses a visible label.
- Evidence paths use native disclosure elements.
- Cards collapse to one column on narrow viewports.
- Focus outlines and reduced-motion behavior are explicit.

## Verification contract

Before this pass is confirmed:

1. Run portal content validation.
2. Run portal TypeScript checking.
3. Run the optimized Docusaurus build.
4. Verify all new routes return successfully from the local preview.
5. Test interactive filters, search, evidence disclosure and decision tabs.
6. Check desktop, tablet and mobile overflow and readability.
7. Check keyboard focus and browser console health.
8. Confirm the prohibited vendor-name boundary remains clean.

## Deferred from Pass 2

- Scalar API reference integration.
- Generated database catalogue.
- Full backend and infrastructure documentation expansion.
- Storybook embedding and component-catalogue generation.
- Repairing the non-critical Docusaurus hot-reload memory issue.
