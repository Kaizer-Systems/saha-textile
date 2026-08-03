---
title: Admin Contributor Recipes
description: Beginner-safe recipes for routes, lists, forms, mutations, permissions, and operator verification.
status: scaffolded
audience: [beginner, frontend, operator]
last_verified: '2026-08-02'
source_of_truth:
    - apps/admin/src/app/routes
    - apps/admin/src/app/features
    - apps/admin/src/app/data-access
    - apps/admin/src/app/shared
---

# Admin contributor recipes

## Recipe: add a feature family

1. Create the feature directory and local `feature.routes.ts`.
2. Add a lazy entry in `content.routes.ts` or `full.routes.ts` according to shell ownership.
3. Build a list/landing component before adding optional create/edit routes.
4. Add typed interfaces or shared contracts before transport methods.
5. Add query functions for server-owned reads.
6. Reuse shared table, fields, modal, pagination, and upload primitives when appropriate.
7. Add navigation only after the route and permission behavior are defined.
8. Update the application atlas.

## Recipe: add a list screen

1. Define stable query parameters: search, page, page size, sort, and filters.
2. Create a service reader and query function.
3. Configure columns and row actions in the feature.
4. Feed table changes back into the query-parameter signal.
5. Render pending, error, empty, and populated states intentionally.
6. Treat row-action visibility as UX only; enforce permissions on the API.

## Recipe: add a create/edit form

1. Reuse one form component when create and edit share the same domain command shape.
2. Derive mode from the route and load detail data only when an ID exists.
3. Build typed controls and arrays.
4. Separate UI validation from contract/business validation.
5. Map the form to a command object instead of sending raw form state.
6. Disable duplicate submission and preserve recoverable input after failure.
7. Invalidate the exact list/detail queries after success.
8. Handle invalid IDs, 403, conflict, and validation responses.

## Recipe: replace a mock action

Search for the explicit mock comment before implementing. Then:

1. Confirm the API route and shared contract exist.
2. Add a typed mutation at the data-access boundary.
3. Replace only the relevant no-op method.
4. Add confirmation for destructive or high-impact actions.
5. Add pending/success/failure states.
6. Reconcile cache data.
7. Remove obsolete mock comments and fixture assumptions.
8. Advance portal status only after verification.

## Recipe: add permission-aware UI

1. Name the action in domain language.
2. Decide whether unavailable actions are hidden or disabled with explanation.
3. Use the shared permission presentation seam.
4. Send the request normally when invoked.
5. Require the API to authorize actor, action, and resource.
6. Handle 403 without treating it as a generic system failure.

## Recipe: add or update a component story

1. Add the story under `apps/developer-portal-storybook/src/admin` and import the real Angular component from `apps/admin`; the single Storybook workspace owns the tool dependency.
2. Use an `Admin/...` title so it stays under the single renderer's admin branch.
3. Declare `parameters.application: 'admin'` so the admin decorator and isolated admin application stylesheet are active.
4. Model useful loading, empty, success, permission, validation, and failure states rather than only a polished default.
5. Add required Angular providers through story/application configuration; do not replace an Angular component with a React imitation.
6. Verify the story in the shared light and dark portal themes.

## Operator verification checklist

- [ ] Deep-link refresh reaches the correct shell and feature.
- [ ] The screen does not imply a real write when the action is still mocked.
- [ ] Keyboard users can reach and invoke every action.
- [ ] Search, sorting, filters, pagination, and reset behavior agree.
- [ ] Validation messages explain how to recover.
- [ ] Destructive actions show exact scope and confirmation.
- [ ] Pending actions prevent accidental duplicates.
- [ ] 401, 403, validation, conflict, and unexpected failures are distinct.
- [ ] Narrow desktop/tablet layouts remain usable for dense tables and forms.
- [ ] The portal source evidence and verification date remain current.
