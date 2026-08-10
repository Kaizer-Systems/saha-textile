---
title: Security, Sessions, and Authorization
wide: true
description: Current authentication scaffold, ratified browser-session architecture, CSRF, authorization, BOLA, and security verification.
search_keywords: 'cookies csrf st_access st_refresh otp msg91 jwt session bola audiences pin'
status: scaffolded
audience: [beginner, backend, frontend, operator]
last_verified: '2026-08-11'
source_of_truth:
    - apps/api/src/auth
    - apps/api/src/admin
    - apps/api/src/first-admin.ts
    - apps/api/src/orders/orders.controller.ts
    - apps/api/src/privacy/privacy.controller.ts
    - apps/api/src/cart/cart.controller.ts
    - apps/api/src/common/cookies.ts
    - apps/api/src/common/csrf.guard.ts
    - apps/api/src/infra/argon2-jwt.auth.ts
    - apps/api/src/config/app-config.ts
    - apps/api/.env.example
    - packages/adapters-db-mongo/src/models/user.model.ts
    - packages/adapters-db-mongo/src/models/auth-session.model.ts
    - packages/adapters-db-mongo/src/models/auth-challenge.model.ts
    - packages/adapters-db-mongo/src/models/auth-token.model.ts
    - packages/adapters-db-mongo/src/models/auth-rate-limit.model.ts
    - packages/adapters-db-mongo/src/repositories/auth.repository.ts
    - packages/adapters-db-mongo/test/auth-persistence.test.ts
    - packages/contracts/src/auth.ts
    - packages/contracts/src/auth-internal.ts
    - packages/contracts/src/admin-auth.ts
    - packages/contracts/src/session.ts
    - docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Security, sessions, and authorization

Security status is **scaffolded** because the implemented session and authorization foundation is not yet a complete identity system. Browser auth uses audience-bound httpOnly access/refresh cookies, opaque refresh rotation with reuse-triggered family revocation, AuthSession `sid` checks so logout/family revoke invalidate access JWTs immediately, session-bound double-submit CSRF (Policy B preserve-or-recover on `GET /auth/csrf`), current-user/version checks, role/permission enforcement, cart/`st_guest` ownership and order ownership. The admin boundary now includes a closed 33-code registry, active assignment resolution, permission-gated role and user-authority routes, no-delegation-above-self, last-administrator protection, offboarding/session revocation and an operator-only first-admin bootstrap. Strict credentialed CORS, Helmet, trusted client-IP rate limiting, per-request correlation, adapter-level log redaction, and the shared safe error envelope also exist. Remaining gaps include OAuth, the admin Security Settings and idle-lock clients, browser PIN proof, guest→user merge, fail-closed production secret validation, provider-backed delivery, and granular-permission migration for older privileged routes.

## Authentication versus authorization

- **Authentication:** Who is the caller?
- **Authorization:** May this caller perform this action on this resource now?

A valid token proves identity and live session membership; object-level cart/order ownership is enforced separately and fails closed as not-found on mismatch.

## Current browser auth

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant UserRepo
    participant AuthPort
    participant SessionStore

    Browser->>API: POST /auth/storefront/login/password
    API->>UserRepo: findCredentialByEmail
    UserRepo-->>API: public user + selected password hash
    API->>AuthPort: verifyPassword
    API->>SessionStore: persist refresh family + CSRF hash
    API->>AuthPort: sign short-lived access JWT
    API-->>Browser: httpOnly access/refresh + readable CSRF cookies and sanitized JSON
    Browser->>API: cookies and X-CSRF-Token on unsafe requests
```

Important current gaps:

- both Angular applications use cookie-only typed auth gateways with no browser-held credential; the shared transport coordinates CSRF, one refresh attempt and cross-tab refresh exclusion;
- registration and password flows use shared 12-character schemas, but the common-password denylist remains absent;
- OTP request/verify is live through `NotificationPort`, but the bound `ConsoleNotificationAdapter` is a safe development seam rather than MSG91 delivery;
- email-verification issuance, completion and resend are live; OAuth state persistence exists without provider/callback verification routes;
- admin password recovery, password/PIN login, PIN setup/lockout, invite lifecycle, HTTP resume, first-admin bootstrap and fine-grained assignment enforcement on the admin management surfaces are live; the Security Settings and idle-lock clients plus real-browser PIN proof are absent;
- consent/privacy, order ownership, cart Principal/`st_guest` ownership and order-create cart adoption are live; guest→user merge and checkout idempotency remain Chunk G;
- production configuration still needs a fail-closed secret check.

## Chunk D status boundary

Chunk D1's tested stores are bound into the HTTP flow. The current adapter suite also proves atomic refresh rotation, replay lookup, family revocation, one-active OTP handling, single-use token consumption, concurrency-safe rate-limit counters, role-assignment uniqueness, secret-field exclusion, and TTL policy against rs0.

| Pass | Current evidence                                                                                                                                                                                                                            | Remaining boundary                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D2   | **Done:** cookie issue/refresh/revoke, sid-bound access invalidation, reuse-family revocation, session-bound CSRF (Policy B) and storefront/admin audience guards                                                                           | None in the defined D2 scope                                                                                                      |
| D3   | **Partial:** register, password login/logout/me/refresh, password reset, email verification/resend, and email OTP request/verify use generic anti-enumeration where applicable                                                              | OAuth provider verification                                                                                                       |
| D4   | **Partial:** admin recovery, password/PIN login, PIN setup/lockout, invites, HTTP resume, bootstrap, registry-backed assignments, deny-by-default admin management, no-delegation, last-admin/offboarding controls and version invalidation | Security Settings client, browser PIN proof, idle-lock/PIN-resume orchestration and granular migration of older privileged routes |
| D5   | **Partial:** consent/privacy, order BOLA, cart/`st_guest` ownership and order-create cart adoption                                                                                                                                          | Guest→user merge (Chunk G)                                                                                                        |

## Browser session architecture

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant SessionStore

    Browser->>API: Login credentials / verified provider token
    API->>API: Validate policy and audience
    API->>SessionStore: Create session + refresh-family hash
    API-->>Browser: Set httpOnly access + refresh cookies and readable bound CSRF cookie
    Browser->>API: Unsafe request + cookies + X-CSRF-Token
    API->>API: Check origin/fetch metadata, access audience, CSRF, permission, resource
    API-->>Browser: Actor-safe response
    Browser->>API: Refresh with opaque cookie
    API->>SessionStore: Rotate atomically and detect reuse
    API-->>Browser: New cookie pair or revoke family
```

### Cookie roles

| Cookie/token               | Browser readable? | Purpose                                             |
| -------------------------- | ----------------: | --------------------------------------------------- |
| Access cookie              |                No | Short-lived authenticated requests                  |
| Refresh cookie             |                No | Opaque rotation credential; hash stored server-side |
| CSRF cookie                |               Yes | Double-submit value bound/signed to session         |
| Guest cookie               |                No | Opaque authority for one guest cart only            |
| Locale/currency preference |            May be | Non-secret presentation context                     |

The cookie names are `st_access`, `st_refresh`, and the browser-readable `st_csrf` (CSRF header `x-csrf-token`). Session cookies use `httpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production; the CSRF cookie is deliberately readable and is not a credential. The `__Host-` prefix is used exactly when valid: production and no pinned `COOKIE_DOMAIN`. A pinned domain or plain HTTP uses the allowed compact `st_*` name. Auth responses return sanitized user/session metadata, never reusable access or refresh credentials.

## CSRF rule

For cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE`, the global guard currently:

1. allows safe methods and unsafe requests with no session cookie;
2. otherwise requires the readable CSRF cookie and matching `x-csrf-token` header;
3. compares them in constant time and rejects generically before mutation.

Login, OTP verification, and refresh issue the readable CSRF cookie together with a matching `authSessions.csrfSecretHash`; copy that cookie value into the header for unsafe requests. `GET /auth/csrf` remains useful before a session exists. For an active session it follows Policy B: preserve the still-valid bound token, and only atomically rotate `csrfSecretHash` when the readable cookie is missing or desynced. Unsafe requests that carry session cookies fail closed when no live session resolves.

Never use `GET` for a state-changing operation.

## Audience and privilege separation

| Actor               | Audience          | Allowed surface                                    |
| ------------------- | ----------------- | -------------------------------------------------- |
| Guest cart identity | none/accountless  | Only its cart and public catalogue actions         |
| Customer            | `storefront`      | Own account/cart/orders and allowed public writes  |
| Staff/admin         | `admin`           | Explicit admin routes permitted by role/permission |
| Provider webhook    | signature-based   | One verified callback capability                   |
| Internal job        | internal identity | Narrow scheduled capability                        |

An admin session must not automatically become customer authority, and a storefront session must never authorize an admin route.

## Object-level authorization

The former `GET /orders/:id` BOLA defect was fixed on 2026-08-01. Customer reads now compare `order.userId` with the authenticated subject and return not-found on a mismatch; staff/admin have an explicit support bypass. Cart routes remain `@Public()` for guest add-to-cart but enforce Principal ownership or the hashed `st_guest` proof, and order create validates ownership/adoption before any write.

Prefer ownership-scoped repository methods/use cases:

```text
getCustomerOrder({ actorUserId, orderId })
→ repository.findOwnedOrder(actorUserId, orderId)
→ not found/forbidden policy
→ CustomerOrderDetailResponse
```

Repeat this pattern for carts, addresses, returns, refunds, wishlist, saved items, media drafts, and admin tenant/resource scopes.

## Role versus permission

The current guard accepts `customer | staff | admin` roles, enforces explicit permissions when a route declares them, and compares token/permission versions with current user state on each guarded request. It resolves effective permissions from the user's transitional embedded grants and active role assignments, ignores revoked/dangling assignments, and refuses contributions above the user's coarse-role tier. Routes with no `@RequirePermissions` declaration do not trigger assignment resolution.

- Role groups permissions.
- Permission authorizes an action such as `orders.status.update`.
- Resource policy checks the specific order/entity and legal transition.
- UI hiding is convenience only.
- Every privileged write produces an audit event.

### Current admin authority controls

- `GET /admin/permissions` publishes the compile-time closed 33-code registry; clients cannot mint free-form privileges.
- `/admin/roles` CRUD is admin-audience and permission-gated; system roles cannot be edited or deleted.
- `/admin/users/:userId/authority` returns server-resolved roles and effective permissions.
- Role grants cannot exceed the actor's tier or permission set.
- Revoking or disabling the last administrator is refused, as is self-disable.
- Offboarding bumps token version and revokes every session.
- Assignment/role mutations write security-retention audit evidence and invalidate affected permission versions.
- The operator-only bootstrap creates the first administrator with a generated one-time password, records a critical actorless audit event, exposes no HTTP route, and refuses once administrative authority exists.

The 22-check live security campaign proves direct-API denial, audience isolation, BOLA, no-delegation, last-admin protection, offboarding and permission-version behavior. A real admin browser separately proves password login, cookie-only reload, CSRF-protected role grant/revoke, `permissions_changed` recovery, expiry recovery and logout. It does not yet prove PIN login or the unimplemented idle-lock client.

## Password, PIN, and OTP policies

### Password

- Minimum 12 characters for storefront and admin.
- Common-password denylist.
- Argon2id hash.
- Generic login failure.
- Rate limiting/backoff.
- Password change revokes sessions/increments token version.

### Admin PIN

- Six digits, chosen only after a password credential exists.
- Reject repeated, sequential, known-weak, keyboard/calendar-like patterns.
- Strong hash, never plaintext.
- Stricter rate limit/lockout due to low entropy.
- Same secure session after successful verification.

### OTP

- Six-digit CSPRNG value.
- Store HMAC with server pepper, not plaintext.
- Ten-minute expiry, maximum five attempts, single active challenge per identifier/purpose.
- Atomic constant-time verification and single-use consumption.
- Generic anti-enumeration responses.
- Channel-direct delivery through the ratified notification abstraction and provider; no code or token logs.

The PIN/OTP/session DTOs and persistence shapes are active in the HTTP lifecycle. Email OTP and email-verification flows, admin recovery, PIN setup/login/lockout, invite acceptance and the resume endpoint are implemented; provider-backed MSG91 delivery, OAuth verification and the idle-lock client remain outside the current proof.

## Configuration fail-closed rule

Current config falls back to predictable development JWT secrets. Production bootstrap must reject defaults/missing secrets. Test this directly by setting production mode with each required security value absent.

## Security verification matrix

| Boundary          | Minimum proof                                                           |
| ----------------- | ----------------------------------------------------------------------- |
| Login/register    | cookies set, no tokens in JSON, password policy, enumeration resistance |
| CSRF              | all unsafe cookie routes reject missing/wrong/cross-session token       |
| Refresh           | atomic rotation, replay revokes family, concurrent refresh handled      |
| Audience          | storefront cannot call admin; admin cannot bypass customer ownership    |
| BOLA              | cross-user ids fail for every owned resource                            |
| Permissions       | stale/downgraded/disabled admin fails quickly                           |
| Secrets           | production fails without secure config; logs/responses redacted         |
| OTP/PIN           | entropy/policy/attempts/expiry/race/reuse tests                         |
| Provider callback | signature, replay, amount/order correlation, legal transition           |

## Incident evidence

Security audit logs should identify request/session/actor, action, target, decision, timestamp, and safe context. Never record passwords, PINs, OTP values, access/refresh tokens, provider secrets, raw IPs, or full PII payloads.
