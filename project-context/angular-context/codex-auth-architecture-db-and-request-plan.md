# Authentication Architecture, Data Model, and Request Plan

**Status:** Target architecture and implementation contract
**Last reconciled:** 2026-07-25
**Authority:** `owner-decisions-log.md`; unresolved choices: `pending-decisions.md`

This document defines the target authentication boundary. It does not claim that
every capability described here is already implemented. Current delivery status
lives in `project-progress.md`; actual request/response shapes live in
`packages/contracts` and generated OpenAPI.

## 1. Outcomes

- Storefront users can authenticate with email/password, email OTP, Google, or
  Facebook.
- Browser sessions use API-set secure cookies rather than browser-stored bearer
  tokens.
- Admin users can sign in with email or username plus password, and may configure
  a six-digit PIN.
- Guest carts survive authentication and merge transactionally.
- Protected deep links and eligible pending actions resume safely after auth.
- Every owned-resource request is authorized server-side.
- Provider and persistence details stay behind ports/adapters.

## 2. Boundary and dependency rules

- Core owns auth policies, use cases, and port interfaces.
- `packages/contracts` owns Zod request/response schemas.
- The API composition root binds auth, notification, persistence, and OAuth
  adapters.
- Angular applications call the API only.
- Provider SDKs, Fastify request objects, Mongoose documents, and raw provider
  payloads never enter core.
- `packages/core-domain` may use contract types through `import type` only; it
  must not acquire a runtime dependency on Zod or contracts.

Primary ports:

- `AuthPort`: credential/session operations needed by core use cases.
- `UserRepository`: user identity and profile persistence.
- `NotificationPort`: channel delivery, including email OTP.
- `AuditPort`: security-event recording where represented as a distinct port.
- OAuth verifier adapters: provider-token verification at the edge.

## 3. Storefront identity methods

### 3.1 Email and password

- Registration uses normalized email plus a password of at least 12 characters.
- Reject common passwords; never silently weaken the rule for imported users.
- Hash passwords with Argon2id using an approved current configuration.
- Login, registration, reset, and recovery responses must not reveal whether an
  account exists.
- Phone is collected at checkout/address time, not registration.

### 3.2 Email OTP

- Saha Textile generates, stores, verifies, and consumes OTP challenges.
- Delivery goes through `NotificationPort`; MSG91 is the primary provider.
- Do not use MSG91 OTP Widget or SendOTP as the source of authentication truth.
- A challenge uses:
    - a CSPRNG six-digit code;
    - HMAC-SHA256 with a server pepper at rest;
    - a 10-minute expiry;
    - at most five verification attempts;
    - one active challenge per normalized identifier and purpose;
    - atomic attempt increments and consume;
    - no code or secret in logs.
- Send and verify endpoints are rate-limited by identifier, client IP, purpose,
  and broader abuse signals.
- Send responses are generic and anti-enumerating.
- Resend/SES/SMTP may be implemented only as optional email fallback adapters;
  none is the primary customer-notification provider.

### 3.3 Google and Facebook

- UI may use provider buttons or One Tap where appropriate.
- The backend verifies the provider token and creates the Saha Textile session.
- Request only minimum scopes.
- Provider email/subject links are identities, not authorization.
- Account linking requires a verified, collision-safe flow and audit record.
- X/Twitter login is excluded.

### 3.4 Phone OTP

Phone OTP is an intentionally preserved seam, not a launch requirement. Enabling
it later must reuse the same challenge policy and `NotificationPort`, with
channel-specific abuse controls.

## 4. Browser session model

- The API sets `httpOnly`, `Secure`, appropriately scoped `SameSite` cookies.
- Use short-lived access state plus an opaque rotating refresh token.
- Store only a hash/fingerprint of the refresh token server-side.
- Rotate on every refresh and detect reuse.
- A reused or revoked refresh token invalidates the affected token family.
- Use double-submit CSRF for cookie-authenticated state changes.
- CORS is an exact allowlist with credentials enabled only for approved origins.
- Browser happy paths are cookie-first.
- Bearer support is limited to explicitly approved non-browser clients.
- Never place access/refresh tokens in localStorage, sessionStorage, IndexedDB,
  URLs, analytics, or logs.

Suggested cookie names:

- `st_access`
- `st_refresh`
- `st_csrf`
- `st_guest`

Production may use the `__Host-` prefix where deployment topology permits it.

## 5. Admin authentication and soft lock

- Admin login accepts email or username plus password.
- Admin password policy is at least as strong as storefront policy.
- Mandatory MFA is not a launch requirement; preserve a future seam.
- An admin may configure a six-digit PIN:
    - optionally during onboarding;
    - later in Security Settings after password proof;
    - usable for full login and idle quick-resume;
    - preference stored as `password` or `pin`;
    - weak, repeated, and sequential values rejected;
    - password-grade hashed;
    - five failed attempts lock PIN use for 15 minutes or until password login;
    - setup, reset, success, failure, and lock events audited.
- After 15 minutes of admin inactivity, show a soft lock without discarding the
  mounted route or unsaved form state.
- Password, role, permission, account-status, token-version, or refresh-reuse
  changes invalidate quick resume.
- RBAC failures are never queued or replayed.

## 6. Guest cart and post-auth continuation

- Guest identity is an opaque random `st_guest` httpOnly cookie; persist only its
  hash.
- Guest cart TTL is 30 days sliding from last activity.
- Guest checkout is disabled at launch.
- `Proceed to checkout` authenticates, merges the guest cart, and resumes.
- Merge is a MongoDB transaction and must be idempotent.
- Revalidate price, availability, variant, add-on, stock, and quantity during
  merge.
- Return invalid/unavailable lines to the client; never drop them silently.

Post-auth order:

1. Establish the authenticated session.
2. Merge the guest cart.
3. Load and revalidate the latest eligible pending intent.
4. Replay the action when still allowed.
5. Clear the intent.
6. Navigate to the relevant continuation.

Pending intent stores at most one latest account-bound action per guest/session
and expires within 30 minutes unless the feature requires less. Wishlist, Save
for Later, and Notify Me may use it. RBAC failures, reorder, and payment actions
must not.

## 7. Persistence model

Collection names are descriptive; adapter implementation remains authoritative.

### `users`

- `_id`
- normalized email and optional normalized phone
- profile/status fields
- password hash metadata when password auth is enabled
- role/permission references
- preferred admin login method where applicable
- admin PIN hash/lock metadata where applicable
- token/session invalidation version
- created/updated timestamps

Indexes:

- unique normalized email where present
- unique normalized phone where present
- unique normalized admin username where present

### `auth_identities`

- user id
- provider (`google`, `facebook`, future approved provider)
- provider subject
- verified provider email snapshot
- linked/last-used timestamps

Unique compound index: provider plus provider subject.

### `auth_sessions`

- user id
- refresh-token family id
- current token hash/fingerprint
- issued, last-used, expiry, revoked timestamps
- reuse-detected timestamp
- client/device metadata kept to the minimum needed for security

Indexes:

- unique token hash/fingerprint
- user plus active/revoked state
- TTL or scheduled cleanup on expiry, while preserving required audit facts

### `otp_challenges`

- normalized identifier hash
- channel and purpose
- code HMAC
- expiry
- attempts
- consumed/revoked timestamps
- provider correlation id without message body or secret

Indexes:

- active identifier/purpose uniqueness
- cleanup/TTL on expiry subject to audit-retention rules

### `password_reset_challenges`

Use an opaque random token, store only a hash, expire quickly, consume once, and
invalidate relevant sessions after successful reset.

### `pending_intents`

- guest/session binding hash
- intended user/action
- validated minimal payload
- return path from an allowlisted route model
- created/expiry/consumed timestamps

Never store an arbitrary redirect URL or executable client command.

### `audit_events`

Record actor, target, action, outcome, request correlation, and safe metadata.
Never record passwords, PINs, OTPs, access tokens, refresh tokens, or provider
secrets. Retention details follow the current retention decision and operational
policy.

## 8. Request surface

Exact paths and payloads must be defined in Zod contracts/OpenAPI. The intended
capability surface is:

- register
- password login/logout
- refresh/revoke session
- request/verify email OTP
- initiate/complete password reset
- verify Google/Facebook identity
- list/revoke a user's sessions
- admin password/PIN login
- configure/reset admin PIN after password proof
- admin soft-lock resume
- current-session/current-user query

Every mutation:

- validates input with Zod;
- applies endpoint and abuse rate limits;
- sets or clears cookies server-side;
- applies CSRF where cookie-authenticated;
- emits a safe audit event;
- returns an anti-enumerating response when identity existence is sensitive.

## 9. Authorization rules

- Authentication never substitutes for object-level authorization.
- Cart, order, address, profile, wishlist, session, and export/erasure endpoints
  verify ownership on every request.
- Admin endpoints enforce permissions server-side.
- Repository queries should include the ownership/tenant predicate where
  possible, not fetch first and trust a client-supplied id.
- Security failures use stable public error codes and do not leak internals.

## 10. Configuration

The canonical variable inventory is `environment-variables.md`. Auth-relevant
groups include:

- access/refresh/CSRF secrets and TTLs;
- cookie names/domain/security attributes;
- OTP TTL/attempt limits and HMAC pepper;
- `NOTIFICATION_PROVIDER=msg91` plus MSG91 channel credentials;
- optional email fallback provider configuration;
- Google/Facebook public client identifiers and API-only secrets;
- rate-limit and trusted-proxy configuration.

Secrets remain API-only. OAuth client identifiers and other explicitly public
values may be supplied through Angular runtime config.

## 11. Delivery order

1. Lock Zod contracts and error codes.
2. Implement repository/session/challenge models and indexes.
3. Implement password auth and cookie session rotation/reuse detection.
4. Add CSRF, CORS, proxy-awareness, and endpoint rate limits.
5. Implement email OTP through `NotificationPort`/MSG91.
6. Implement guest-cart merge and pending-intent continuation.
7. Add Google and Facebook verification adapters.
8. Implement admin PIN and soft-lock behavior.
9. Add session management, recovery, export/erasure integration, and audit views.
10. Run unit, adapter-integration, API, browser, and security-negative tests.

## 12. Definition of done

- Contracts, OpenAPI, implementation, and portal docs agree.
- No auth secret or credential is accessible to Angular/browser bundles.
- Refresh rotation, reuse detection, CSRF, rate limits, and anti-enumeration have
  negative tests.
- Object-level authorization tests cover all owned resources.
- OTP verification is atomic and concurrency-tested.
- Guest-cart merge is transactional, idempotent, and reports rejected lines.
- Provider failure does not bypass local authorization or session policy.
- Admin PIN lockout and soft resume preserve the intended UX without weakening
  session invalidation.
- Current verification status is recorded in `project-progress.md`.

## 13. Open decisions

There is no question register in this architecture file. Any unresolved
auth-adjacent owner choice belongs in `pending-decisions.md` under a stable
`DEC-*` identifier.
