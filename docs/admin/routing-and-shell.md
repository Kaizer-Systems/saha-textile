---
title: Admin Routing and Shell
wide: true
description: How admin guards, layouts, lazy routes, and feature families compose the operator workspace.
status: implemented
audience: [beginner, frontend, operator]
last_verified: '2026-08-09'
source_of_truth:
    - apps/admin/src/app/app.routes.ts
    - apps/admin/src/app/routes/content.routes.ts
    - apps/admin/src/app/routes/full.routes.ts
    - apps/admin/src/app/layout
    - apps/admin/src/app/core/guards/auth.guard.ts
---

# Admin routing and shell

The admin uses an explicit Angular route graph. The root configuration delegates to two layout shells and lazy-loads feature-specific route arrays.

## Root route order

```mermaid
flowchart TD
    Request["Admin URL"] --> Empty{"Empty path?"}
    Empty -->|Yes| Login["Redirect to /auth/login"]
    Empty -->|No| Auth{"/auth route?"}
    Auth -->|Yes| AuthRoutes["Lazy authentication routes"]
    Auth -->|No| Content{"Content-shell feature?"}
    Content -->|Yes| ContentShell["Header + sidebar + content + footer"]
    Content -->|No| Full{"Full-shell route?"}
    Full -->|Yes| FullShell["Full-page auth/error presentation"]
    Full -->|No| NotFound["404 component"]
```

Route order matters because both shells use an empty parent path. The feature child arrays decide which shell claims a URL.

## Shell responsibilities

### Content shell

Used for the operator workspace. It composes navigation, header, content outlet, footer, loader, and page-level wrapper behavior.

### Full shell

Used for full-page experiences such as authentication and errors where admin navigation should not appear.

## Guard behavior today

`AuthGuard` checks the sanitized session state resolved from `/auth/admin/me`. The `/auth` family stays unguarded so login, PIN login and recovery are reachable; both back-office shells use `canActivate` and `canActivateChild`, redirecting anonymous navigation to `/auth/login`. On success the content shell initializes menu badges and account details.

Important boundaries:

- The guard is presentation and navigation policy, not API authorization.
- `canActivateChild()` inherits authentication from the protected shell; it does not implement route-level permissions.
- Permissions held in the store shape UI only. The API rechecks audience, role, declared permission and current versions.
- The admin idle-lock overlay is still absent even though the store and API expose PIN resume.

## Feature route convention

Most feature families follow a recognizable shape:

| Path                | Purpose                |
| ------------------- | ---------------------- |
| `/feature`          | List or landing screen |
| `/feature/create`   | Creation form          |
| `/feature/edit/:id` | Edit form              |

Orders add `/order/details/:id`, `/order/create`, and `/order/checkout`. Blog adds category and tag management routes. Shipping and category currently expose narrower route subsets.

## Add a route safely

1. Confirm which shell owns the experience.
2. Create or extend the feature’s local `*.routes.ts` file.
3. Lazy-load the standalone component.
4. Reuse the established list/create/edit naming unless the workflow needs a different model.
5. Add authentication and authorization requirements explicitly.
6. Verify deep-link refresh, browser back/forward, invalid IDs, and missing permissions.
7. Keep data loading in query/service layers rather than a route file.

## Future authorization shape

```mermaid
sequenceDiagram
    participant O as Operator
    participant UI as Admin UI
    participant API as API
    participant Policy as Authorization policy

    O->>UI: Open or invoke an action
    UI->>UI: Hide or disable unavailable affordance
    UI->>API: Authenticated request
    API->>Policy: Check actor + action + resource
    alt Authorized
        Policy-->>API: Allow
        API-->>UI: Result
    else Denied
        Policy-->>API: Deny
        API-->>UI: 403 response
        UI-->>O: Explain unavailable action
    end
```

The UI permission layer is an affordance. The API policy is the security boundary.
