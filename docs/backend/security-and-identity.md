---
title: Security, Sessions, and Authorization
wide: true
description: Current authentication scaffold, ratified browser-session architecture, CSRF, authorization, BOLA, and security verification.
search_keywords: 'cookies csrf st_access st_refresh otp msg91 jwt session bola audiences pin'
status: scaffolded
audience: [beginner, backend, frontend, operator]
last_verified: '2026-08-01'
source_of_truth:
    - apps/api/src/auth
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

Security status is **scaffolded** because the implemented session foundation is not yet a complete identity system. Browser auth now uses audience-bound httpOnly access/refresh cookies, opaque refresh rotation with reuse-triggered family revocation, AuthSession `sid` checks so logout/family revoke invalidate access JWTs immediately, session-bound double-submit CSRF (Policy B preserve-or-recover on `GET /auth/csrf`), current-user/version checks, role/permission enforcement, cart/`st_guest` ownership and order ownership. Strict credentialed CORS, Helmet, trusted client-IP rate limiting, per-request correlation, adapter-level log redaction, and the shared safe error envelope also exist. Remaining gaps include OAuth, email-verification completion, admin invite acceptance/quick-resume, guest→user merge, fail-closed production secret validation, and provider-backed delivery.

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
    API-->>Browser: httpOnly access/refresh + readable CSRF cookies; sanitized JSON
    Browser->>API: cookies; X-CSRF-Token on unsafe requests
```

Important current gaps:

- the Angular interceptors still attach a legacy local-storage bearer token even though `SessionGuard` deliberately ignores `Authorization`; this is frontend migration debt, not a supported server fallback;
- registration and password flows use shared 12-character schemas, but the common-password denylist remains absent;
- OTP request/verify is live through `NotificationPort`, but the bound `ConsoleNotificationAdapter` is a safe development seam rather than MSG91 delivery;
- email-verification issuance is live but no completion route consumes the token; OAuth state persistence exists without provider/callback routes;
- admin password/PIN login, PIN setup/lockout, roles, permissions and version invalidation are live; invite acceptance and idle quick-resume are absent;
- consent/privacy, order ownership, cart Principal/`st_guest` ownership and order-create cart adoption are live; guest→user merge and checkout idempotency remain Chunk G;
- production configuration still needs a fail-closed secret check.

## Chunk D status boundary

Chunk D1's tested stores are now bound into the HTTP flow. The 18 gated rs0 tests prove atomic refresh rotation, replay lookup, family revocation, one-active OTP handling, single-use token consumption, concurrency-safe rate-limit counters, secret-field exclusion, and TTL policy.

| Pass | Current evidence                                                                                                                                                  | Remaining boundary                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| D2   | **Done:** cookie issue/refresh/revoke, sid-bound access invalidation, reuse-family revocation, session-bound CSRF (Policy B) and storefront/admin audience guards | None in the defined D2 scope            |
| D3   | **Partial:** register, password login/logout/me/refresh, password reset, and email OTP request/verify use generic anti-enumeration where applicable               | Email-verification completion and OAuth |
| D4   | **Partial:** admin password/PIN login, PIN setup/lockout, role/permission checks and permission-version invalidation                                              | Invite acceptance and idle quick-resume |
| D5   | **Partial:** consent/privacy, order BOLA, cart/`st_guest` ownership and order-create cart adoption                                                                | Guest→user merge (Chunk G)              |

## Browser session architecture

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant SessionStore

    Browser->>API: Login credentials / verified provider token
    API->>API: Validate policy and audience
    API->>SessionStore: Create session + refresh-family hash
    API-->>Browser: Set httpOnly access + refresh cookies; readable bound CSRF cookie
    Browser->>API: Unsafe request + cookies + X-CSRF-Token
    API->>API: Check origin/fetch metadata, access audience, CSRF, permission, resource
    API-->>Browser: Actor-safe response
    Browser->>API: Refresh with opaque cookie
    API->>SessionStore: Rotate atomically; detect reuse
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

The current guard accepts `customer | staff | admin` roles, enforces explicit permissions when a route declares them, and compares token/permission versions with current user state on each guarded request.

- Role groups permissions.
- Permission authorizes an action such as `orders.status.update`.
- Resource policy checks the specific order/entity and legal transition.
- UI hiding is convenience only.
- Every privileged write produces an audit event.

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

The PIN/OTP/session DTOs and persistence shapes are active in the HTTP lifecycle. Email OTP request/verification and admin PIN setup/login/lockout are implemented; provider-backed MSG91 delivery, invite acceptance, OAuth and quick-resume remain outside the current proof.

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
