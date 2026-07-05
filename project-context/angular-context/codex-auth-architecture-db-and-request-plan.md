# Saha Textile Auth Architecture, DB, API, Security, and PWA Plan

Created: 2026-06-28
Scope: Storefront auth, admin auth, auth-related MongoDB structure, contracts, DTOs, JWT/session handling, request security, OAuth setup, email/phone OTP stance, and PWA/offline constraints.

This file is a planning artifact only. It intentionally does not modify existing code, contracts, schemas, or env files.

> **⚠️ Superseded email-provider note (2026-07-02).** Every "Brevo" reference below (including the "Brevo manual setup" section and `BREVO_API_KEY` env) is **stale**. Email OTP and all transactional email now go through our **`EmailPort` with a provider adapter — primary Resend (free tier), swappable to MailerSend/SES**; **no Brevo lock-in**. Inbound `@sahatextile.com` mail = **Cloudflare Email Routing (free)**. Also LOCKED: OTP "send code" uses a **generic anti-enumeration response**. Source of truth = `owner-decisions-log.md` (2026-07-02). Read "Brevo" as "the configured `EmailPort` provider (Resend)".

---

## 1. Sources and Current Repo Baseline

### 1.1 Repo context read

- `project-context/angular-context/saha-textile-technical-knowledgebase.md`
- `project-context/angular-context/execution-roadmap.md`
- `project-context/angular-context/environment-variables.md`
- `project-context/angular-context/fastkart-assessment-and-plan.md`
- `project-context/angular-context/fastkart-execution-plan.md`
- `project-context/angular-context/catalog-db-architecture-assessment-and-plan.md`
- `packages/contracts/src/user.ts`
- `packages/core-domain/src/ports/auth.port.ts`
- `packages/core-domain/src/ports/user.repository.ts`
- `packages/adapters-db-mongo/src/models/user.model.ts`
- `packages/adapters-db-mongo/src/repositories/user.repository.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/jwt-auth.guard.ts`
- `apps/api/src/auth/roles.guard.ts`
- `apps/api/src/auth/current-user.decorator.ts`
- `apps/api/src/infra/argon2-jwt.auth.ts`
- `apps/api/src/config/app-config.ts`
- `apps/api/.env.example`
- `apps/admin/src/app/app.config.ts`
- `apps/storefront/src/app/app.config.ts`
- `apps/admin/src/app/core/*`
- `apps/storefront/src/app/core/*`

### 1.2 Current auth implementation summary

- Current user contract supports roles `customer | staff | admin` and auth providers `password | email_otp | google | facebook`.
- Current API supports customer email/password register/login and refresh, but returns bearer access and refresh tokens in JSON.
- Current `JwtAuthGuard` reads `Authorization: Bearer <token>` only.
- Current Mongo user model stores `passwordHash` inside `users` with `select: false` and has a sparse unique email index.
- Current email OTP and social login methods are stubs pending credentials.
- Current roadmap requires email/password, email OTP through Brevo, JWT access plus rotating refresh, Google/Facebook OAuth stubs, and phone OTP deferred.
- Current KB security standard requires short-lived access tokens plus rotating refresh tokens in `httpOnly`, `Secure`, `SameSite` cookies, argon2id, OTP rate limits, lockout/backoff, CORS allowlist, security headers, zod validation, and no secrets in browser config.

### 1.3 Architecture correction required

The final architecture should not keep returning long-lived tokens to Angular for storage. Browser-facing auth should move to API-owned, `httpOnly` cookie sessions with CSRF protection. Bearer tokens can remain for future non-browser integrations, but storefront and admin should use cookie auth.

---

## 2. External Provider Verification Snapshot

Checked on 2026-06-28 against official provider pages.

### 2.1 Google login verdict

- Verdict: Include Google login for storefront. Basic Sign in with Google setup uses OAuth 2.0 client ID, OAuth branding/consent, authorized JavaScript origins, optional redirect URIs, and default `openid email profile` scopes. No paid Google login product is required in the official setup flow reviewed.
- Official setup page: [https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- Official server-side ID token verification page: [https://developers.google.com/identity/gsi/web/guides/verify-google-id-token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- Important implementation note: Google says the backend must verify Google ID tokens and use the `sub` claim as the stable unique Google identifier. For our architecture, store Google `sub` as `authIdentities.providerSubject`.

### 2.2 Facebook login verdict

- Verdict: Include Facebook login for storefront. Basic Facebook Login setup requires a Meta app, Facebook Login product/settings, valid OAuth redirect URI, allowed domain, and `public_profile,email` permissions. No paid Facebook login product is required in the official setup flow reviewed.
- Official web login page: [https://developers.facebook.com/docs/facebook-login/web](https://developers.facebook.com/docs/facebook-login/web)
- Official permissions page: [https://developers.facebook.com/docs/facebook-login/permissions](https://developers.facebook.com/docs/facebook-login/permissions)
- Important implementation note: Meta currently says App Review is required for permissions except `email` and `public_profile` when accessing user data not owned/managed by the app. Extra permissions are rejected unless justified. Do not request anything beyond `public_profile,email`.

### 2.3 Email OTP verdict

- Verdict: Include email OTP for storefront. It can be programmatic and free at modest volume using Brevo's free plan, subject to Brevo approval and daily limits.
- Brevo pricing page reviewed: [https://www.brevo.com/pricing/](https://www.brevo.com/pricing/)
- Brevo page currently says transactional email features are available on all plans and free signup can send up to 300 emails/day after approval.

### 2.4 Phone OTP verdict

- Verdict: Keep phone OTP in the domain model and API seam, but do not implement SMS sending now.
- Reason: phone as an identifier is free, but phone OTP needs an SMS/WhatsApp provider and becomes paid at production scale.

### 2.5 X/Twitter verdict

- Verdict: Exclude X login from launch and from active implementation.
- Reason: existing KB already classifies it as effectively paid/low ROI. Keep no active dependency or UI path for X login.

---

## 3. Non-Negotiable Auth Standards

1. Storefront and admin must use the same session security floor.
2. Admin can be stricter than storefront, but never weaker.
3. Browser auth tokens must not be stored in `localStorage`, `sessionStorage`, IndexedDB, NgRx persisted state, TanStack Query cache, or service worker cache.
4. Browser sessions should use `httpOnly`, `Secure`, `SameSite=Lax` cookies, with `SameSite=Strict` for admin where UX allows.
5. Unsafe authenticated requests must require CSRF protection.
6. Refresh tokens must rotate and be stored server-side only as hashes.
7. Passwords must use argon2id.
8. OTP codes must be hashed, short lived, attempt limited, and single use.
9. OAuth must use signed state, nonce where applicable, fixed redirect URIs, and backend token verification.
10. API responses must use zod contracts and must never expose password hashes, refresh token hashes, provider secrets, OTP hashes, internal risk flags, or raw provider access tokens.
11. Admin writes must create audit logs.
12. Public product catalogue PWA caching must not weaken auth boundaries.

---

## 4. Auth Product Scope

### 4.1 Storefront login methods

| Method              | Include       | Cost stance                 | Launch implementation                | Notes                                               |
| ------------------- | ------------- | --------------------------- | ------------------------------------ | --------------------------------------------------- |
| Email plus password | Yes           | Free                        | Yes                                  | Customer registration and login.                    |
| Email OTP           | Yes           | Free within provider limits | Yes                                  | Brevo-backed, rate limited, short TTL.              |
| Google login        | Yes           | Free for basic login        | Yes                                  | OAuth/OIDC identity link via Google `sub`.          |
| Facebook login      | Yes           | Free for basic login        | Yes                                  | OAuth identity link via Facebook user id.           |
| Phone plus password | Optional seam | Free                        | Maybe after phone field is finalized | Phone is only an identifier without OTP.            |
| Phone OTP           | Keep seam     | Paid SMS                    | No                                   | DB/API placeholders only.                           |
| Guest browsing/cart | Yes           | Free                        | Yes                                  | Required for ecommerce conversion and offline cart. |
| X/Twitter           | No            | Avoid                       | No                                   | Excluded.                                           |

### 4.2 Admin login methods

| Method                      | Include     | Launch implementation | Notes                                                         |
| --------------------------- | ----------- | --------------------- | ------------------------------------------------------------- |
| Email plus password         | Yes         | Yes                   | Primary admin/staff login.                                    |
| Username plus password      | Yes         | Yes                   | Accept email or username in the same DTO.                     |
| Admin self-registration     | No          | No                    | Admins/staff must be invited or created by existing admin.    |
| Google/Facebook admin login | No          | No                    | Not needed; increases policy and account takeover surface.    |
| Email OTP step-up           | Future seam | No                    | Useful for critical actions if MFA is delayed.                |
| TOTP/passkey MFA            | Future seam | No                    | Recommended when admin operations become production-critical. |

### 4.3 Guest identity

- Guest users do not get a full `users` record by default.
- Guest session should use an anonymous `guestId` cookie plus cart record.
- On login/register/social login, the server merges the guest cart into the authenticated cart using a deterministic merge policy.
- Guest cookie must be separate from auth cookies and must not grant access to account/order APIs.

---

## 5. Recommended Request and Session Model

### 5.1 Browser cookie model

Use API-set cookies for both storefront and admin.

| Cookie                | HttpOnly | Secure | SameSite | Path            | Purpose                                                            |
| --------------------- | -------- | ------ | -------- | --------------- | ------------------------------------------------------------------ |
| `__Host-saha_access`  | Yes      | Yes    | Lax      | `/`             | Short-lived access JWT for API authorization.                      |
| `__Host-saha_refresh` | Yes      | Yes    | Lax      | `/auth/refresh` | Opaque refresh token, hashed in DB.                                |
| `saha_csrf`           | No       | Yes    | Lax      | `/`             | CSRF token value readable by Angular and echoed in `X-CSRF-Token`. |
| `saha_guest`          | Yes      | Yes    | Lax      | `/`             | Anonymous guest cart/session id.                                   |
| `saha_locale`         | No       | Yes    | Lax      | `/`             | Locale preference for SSR.                                         |
| `saha_currency`       | No       | Yes    | Lax      | `/`             | Currency preference for SSR/API pricing.                           |

Cookie notes:

- `__Host-` cookies require `Secure`, `Path=/`, and no `Domain` attribute. They are host-bound to the API host, which is acceptable when Angular calls the API with `withCredentials`.
- If production uses `api.sahatextile.com`, storefront/admin requests to that API are same-site under `sahatextile.com` but still cross-origin, so CORS credentials and allowlist are mandatory.
- If a same-origin reverse proxy is chosen later, the same cookie model still works.

### 5.2 Access token

- Type: JWT.
- Lifetime: 10 to 15 minutes.
- Storage: `httpOnly` access cookie only for browser apps.
- Verification: API guard validates signature, issuer, audience, expiration, session id, user status, and token version.

Recommended claims:

```json
{
	"iss": "https://api.sahatextile.com",
	"aud": "storefront",
	"sub": "user_...",
	"sid": "sess_...",
	"role": "customer",
	"permissionsVersion": 1,
	"tokenVersion": 3,
	"jti": "jwt_...",
	"iat": 1780000000,
	"exp": 1780000900
}
```

Admin access token uses `aud: "admin"` and must never be accepted by storefront-only endpoints unless the endpoint explicitly supports staff/admin acting as a customer through a controlled impersonation flow.

### 5.3 Refresh token

- Type: opaque random token, not browser-readable JWT.
- Storage: `httpOnly` refresh cookie in browser; hashed in `authSessions` collection.
- Lifetime: 30 days storefront, 8 to 12 hours admin idle with absolute max 7 days unless MFA is added.
- Rotation: every refresh invalidates the previous refresh token and stores the hash of the replacement.
- Reuse detection: using an already-rotated refresh token revokes the entire refresh family and all active sessions in that family.

### 5.4 CSRF

Use double-submit CSRF plus server-side session binding.

Flow:

1. API sets a non-httpOnly `saha_csrf` cookie on session creation or `/auth/csrf`.
2. Angular interceptor reads `saha_csrf` and sends `X-CSRF-Token` for unsafe methods.
3. API `CsrfGuard` validates the header value against the cookie and session-bound hash.
4. Auth endpoints that accept provider POST callbacks must follow provider-specific CSRF rules too, especially Google GIS double-submit CSRF when using `credential` POST.

Unsafe methods: `POST`, `PUT`, `PATCH`, `DELETE`.

### 5.5 Angular request handling

Storefront and admin should both use:

- `HttpClient` with `withCredentials: true` for API requests.
- `authInterceptor` to attach `X-CSRF-Token` to unsafe requests.
- `authInterceptor` to handle one silent refresh attempt on 401, then replay the original request once.
- `authStateStore` to store only sanitized user/session status, not tokens.
- `authQueryKeys` in TanStack Query for `me`, addresses, orders, wishlist, etc. with logout purge.
- Route guards: `authGuard`, `guestOnlyGuard`, `adminRoleGuard`, `permissionGuard`.

Do not persist auth-sensitive query data to IndexedDB unless explicitly approved and encrypted. For launch, persist public catalogue only.

---

## 6. Auth API Surface

### 6.1 Public/storefront auth endpoints

| Method | Path                                       | Purpose                     | Auth           | CSRF            | Notes                             |
| ------ | ------------------------------------------ | --------------------------- | -------------- | --------------- | --------------------------------- |
| `GET`  | `/auth/csrf`                               | Issue/refresh CSRF cookie   | Optional       | No              | Safe endpoint.                    |
| `GET`  | `/auth/me`                                 | Current sanitized user      | Required       | No              | Reads access cookie.              |
| `POST` | `/auth/storefront/register`                | Email/password registration | Guest          | Yes             | Sets cookies; merges guest cart.  |
| `POST` | `/auth/storefront/login/password`          | Email/password login        | Guest          | Yes             | Sets cookies; merges guest cart.  |
| `POST` | `/auth/storefront/login/email-otp/request` | Request email OTP           | Guest          | Yes             | Generic response, rate limited.   |
| `POST` | `/auth/storefront/login/email-otp/verify`  | Verify email OTP            | Guest          | Yes             | Sets cookies; creates/links user. |
| `POST` | `/auth/storefront/password/forgot`         | Request reset email         | Guest          | Yes             | Generic response.                 |
| `POST` | `/auth/storefront/password/reset`          | Reset password              | Guest          | Yes             | Revokes sessions.                 |
| `POST` | `/auth/storefront/email/verify/request`    | Request verification email  | Required       | Yes             | Rate limited.                     |
| `POST` | `/auth/storefront/email/verify`            | Verify email                | Optional       | Yes             | Token based.                      |
| `GET`  | `/auth/oauth/google/start`                 | Start Google OAuth          | Guest          | No              | Redirects to Google.              |
| `GET`  | `/auth/oauth/google/callback`              | Google OAuth callback       | Guest          | State validated | Sets cookies.                     |
| `GET`  | `/auth/oauth/facebook/start`               | Start Facebook OAuth        | Guest          | No              | Redirects to Meta.                |
| `GET`  | `/auth/oauth/facebook/callback`            | Facebook OAuth callback     | Guest          | State validated | Sets cookies.                     |
| `POST` | `/auth/refresh`                            | Rotate refresh session      | Refresh cookie | Yes             | Sets new cookies.                 |
| `POST` | `/auth/logout`                             | Revoke current session      | Optional       | Yes             | Clears cookies.                   |
| `POST` | `/auth/logout-all`                         | Revoke all user sessions    | Required       | Yes             | Password change/security action.  |

Compatibility note: current `/auth/register`, `/auth/login`, `/auth/refresh`, and bearer guard can remain temporarily, but the final browser API should use cookie semantics and audience-specific endpoints.

### 6.2 Admin auth endpoints

| Method | Path                          | Purpose                                | Auth             | CSRF | Notes                                  |
| ------ | ----------------------------- | -------------------------------------- | ---------------- | ---- | -------------------------------------- |
| `POST` | `/auth/admin/login`           | Email-or-username/password admin login | Guest            | Yes  | Must require `staff` or `admin` user.  |
| `GET`  | `/auth/admin/me`              | Current admin/staff profile            | Admin            | No   | Includes permissions, not secrets.     |
| `POST` | `/auth/admin/refresh`         | Rotate admin refresh                   | Refresh cookie   | Yes  | Stricter idle timeout.                 |
| `POST` | `/auth/admin/logout`          | Revoke current admin session           | Optional         | Yes  | Audit log.                             |
| `POST` | `/auth/admin/logout-all`      | Revoke all admin sessions              | Admin            | Yes  | Audit log.                             |
| `POST` | `/admin/users/invite`         | Invite staff/admin                     | Admin permission | Yes  | Not public registration.               |
| `POST` | `/admin/users/:id/disable`    | Disable staff/customer                 | Admin permission | Yes  | Revokes sessions.                      |
| `POST` | `/admin/users/:id/roles`      | Change role/permissions                | Admin permission | Yes  | Audit log and step-up later.           |
| `POST` | `/auth/admin/password/forgot` | Admin password reset request           | Guest            | Yes  | Generic response, tighter rate limits. |
| `POST` | `/auth/admin/password/reset`  | Admin password reset                   | Guest            | Yes  | Revokes sessions.                      |

### 6.3 Auth request outcome rules

- Login failure responses must be enumeration-safe: `Invalid credentials` or generic accepted messages for OTP/reset.
- OTP request must return the same response whether the email exists or not.
- OAuth callback must reject missing/expired state, provider mismatch, redirect mismatch, nonce mismatch, or unverified email where provider supplies verification status.
- Disabled, archived, locked, deleted, or unverified-where-required users cannot receive new sessions.
- Password change must revoke all existing sessions except optionally the current one if UX requires.
- Admin role changes must increment `permissionsVersion` so old access JWTs fail quickly.

---

## 7. MongoDB Collections

The model below stays compatible with self-hosted Docker MongoDB and avoids assuming Redis. Later, Redis can take over hot rate limits while Mongo remains the source of truth.

### 7.1 `users`

Purpose: canonical user/customer/staff/admin account record, excluding secret credential material where possible.

Suggested shape:

```ts
type UserDoc = {
	_id: string;
	role: 'customer' | 'staff' | 'admin';
	status: 'active' | 'pending' | 'disabled' | 'locked' | 'deleted';
	email: string | null;
	emailNormalized: string | null;
	emailVerified: boolean;
	phone: string | null;
	phoneE164: string | null;
	phoneVerified: boolean;
	username: string | null;
	usernameNormalized: string | null;
	displayName: string | null;
	firstName: string | null;
	lastName: string | null;
	avatarMediaId: string | null;
	addresses: AddressSnapshot[];
	defaultBillingAddressId: string | null;
	defaultShippingAddressId: string | null;
	guestCartId: string | null;
	mergedGuestCartIds: string[];
	consent: ConsentSnapshot | null;
	marketingOptIn: boolean;
	loyalty: {
		pointsBalance: number;
		tierId: string | null;
	} | null;
	security: {
		tokenVersion: number;
		permissionsVersion: number;
		passwordChangedAt: Date | null;
		lastLoginAt: Date | null;
		lastLoginIpHash: string | null;
		failedLoginCount: number;
		lockoutUntil: Date | null;
		riskLevel: 'normal' | 'watch' | 'blocked';
	};
	adminProfile?: {
		employeeCode: string | null;
		department: string | null;
		invitedByUserId: string | null;
		acceptedInviteAt: Date | null;
	};
	createdAt: Date;
	updatedAt: Date;
	disabledAt: Date | null;
	deletedAt: Date | null;
};
```

Indexes:

- Unique sparse `{ emailNormalized: 1 }`.
- Unique sparse `{ phoneE164: 1 }`.
- Unique sparse `{ usernameNormalized: 1 }`.
- `{ role: 1, status: 1 }` for admin user management.
- `{ 'security.lastLoginAt': -1 }` for audit review.

Notes:

- Current `passwordHash` can remain embedded initially, but the cleaner target is `passwordCredentials` so `users` stays mostly non-secret.
- Do not hard-delete users with orders. Use `status: 'deleted'`, scrub optional PII where legally required, and retain order snapshots for tax/accounting.

### 7.2 `authIdentities`

Purpose: many-to-one login identities for password, email OTP, Google, Facebook, and future phone OTP/passkey.

Suggested shape:

```ts
type AuthIdentityDoc = {
	_id: string;
	userId: string;
	provider: 'password' | 'email_otp' | 'phone_otp' | 'google' | 'facebook' | 'passkey';
	providerSubject: string;
	email: string | null;
	emailNormalized: string | null;
	emailVerifiedByProvider: boolean | null;
	phoneE164: string | null;
	displayNameFromProvider: string | null;
	avatarUrlFromProvider: string | null;
	scopes: string[];
	linkedAt: Date;
	lastUsedAt: Date | null;
	revokedAt: Date | null;
	rawProfileEncrypted?: string;
};
```

Provider subject rules:

- Password/email identity: `providerSubject = emailNormalized`.
- Google identity: `providerSubject = Google ID token sub`.
- Facebook identity: `providerSubject = Facebook userID` from verified provider token/profile response.
- Phone OTP future identity: `providerSubject = phoneE164`.

Indexes:

- Unique `{ provider: 1, providerSubject: 1 }`.
- `{ userId: 1, provider: 1 }`.
- Sparse `{ emailNormalized: 1 }`.

Linking rules:

- If OAuth email matches an existing verified email account, link only after an explicit safe-link flow or after strong provider email verification.
- If multiple accounts could match, do not auto-link. Ask the user to sign in to the existing account first.
- Never merge admin identities through storefront social login.

### 7.3 `passwordCredentials`

Purpose: store password material separately from public user profile.

Suggested shape:

```ts
type PasswordCredentialDoc = {
	_id: string;
	userId: string;
	passwordHash: string;
	algorithm: 'argon2id';
	params: {
		memoryCost: number;
		timeCost: number;
		parallelism: number;
	};
	passwordVersion: number;
	createdAt: Date;
	updatedAt: Date;
	disabledAt: Date | null;
};
```

Indexes:

- Unique `{ userId: 1 }`.

Rules:

- On password change, increment `users.security.tokenVersion` and revoke active sessions.
- Password hash is never returned through repositories except explicit credential lookup paths.

### 7.4 `authSessions`

Purpose: server-side session and refresh-token family state.

Suggested shape:

```ts
type AuthSessionDoc = {
	_id: string;
	userId: string;
	audience: 'storefront' | 'admin';
	roleAtLogin: 'customer' | 'staff' | 'admin';
	refreshTokenHash: string;
	refreshFamilyId: string;
	rotationCounter: number;
	previousRefreshTokenHash: string | null;
	replacedBySessionId: string | null;
	csrfSecretHash: string;
	device: {
		userAgentHash: string | null;
		ipHash: string | null;
		country: string | null;
		label: string | null;
	};
	createdAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
	absoluteExpiresAt: Date;
	revokedAt: Date | null;
	revokeReason:
		| 'logout'
		| 'logout_all'
		| 'password_changed'
		| 'role_changed'
		| 'reuse_detected'
		| 'disabled_user'
		| null;
};
```

Indexes:

- Unique `{ refreshTokenHash: 1 }`.
- `{ userId: 1, audience: 1, revokedAt: 1 }`.
- `{ refreshFamilyId: 1 }`.
- TTL `{ expiresAt: 1 }`.

Rules:

- Hash refresh tokens with HMAC-SHA256 using a server secret or argon2id if acceptable for volume. HMAC is usually enough for random high-entropy tokens and faster.
- Reuse detection revokes every session with the same `refreshFamilyId`.
- Admin sessions must use shorter idle expiry than storefront.

### 7.5 `otpChallenges`

Purpose: email OTP now, phone OTP future seam.

Suggested shape:

```ts
type OtpChallengeDoc = {
	_id: string;
	channel: 'email' | 'phone';
	purpose: 'login' | 'register' | 'verify_email' | 'reset_password' | 'step_up';
	destinationHash: string;
	emailNormalized: string | null;
	phoneE164: string | null;
	codeHash: string;
	userId: string | null;
	attempts: number;
	maxAttempts: number;
	resendCount: number;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
	blockedAt: Date | null;
};
```

Indexes:

- TTL `{ expiresAt: 1 }`.
- `{ channel: 1, destinationHash: 1, purpose: 1, createdAt: -1 }`.
- `{ ipHash: 1, createdAt: -1 }`.

Rules:

- OTP should be 6 digits for email login or 8 digits if attack risk increases.
- Store only code hash, never plaintext code.
- TTL: 5 to 10 minutes.
- Max attempts: 5 or less.
- Resend backoff: 30 seconds, 60 seconds, 5 minutes, then cool down.

### 7.6 `oauthStates`

Purpose: provider CSRF/state/nonce validation for OAuth.

Suggested shape:

```ts
type OAuthStateDoc = {
	_id: string;
	provider: 'google' | 'facebook';
	audience: 'storefront' | 'admin';
	stateHash: string;
	nonceHash: string | null;
	codeVerifierHash: string | null;
	redirectAfterLogin: string | null;
	guestCartId: string | null;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
};
```

Indexes:

- Unique `{ stateHash: 1 }`.
- TTL `{ expiresAt: 1 }`.

Rules:

- State lifetime: 5 to 10 minutes.
- Redirect after login must be relative or match a strict allowlist.
- PKCE should be used where the provider flow supports it.

### 7.7 `passwordResetTokens`

Purpose: password reset by email for customers/admins.

Suggested shape:

```ts
type PasswordResetTokenDoc = {
	_id: string;
	userId: string;
	tokenHash: string;
	audience: 'storefront' | 'admin';
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
	ipHash: string | null;
	userAgentHash: string | null;
};
```

Indexes:

- Unique `{ tokenHash: 1 }`.
- TTL `{ expiresAt: 1 }`.
- `{ userId: 1, createdAt: -1 }`.

### 7.8 `emailVerificationTokens`

Purpose: email verification separate from OTP login.

Suggested shape:

```ts
type EmailVerificationTokenDoc = {
	_id: string;
	userId: string;
	emailNormalized: string;
	tokenHash: string;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
};
```

Indexes:

- Unique `{ tokenHash: 1 }`.
- TTL `{ expiresAt: 1 }`.
- `{ userId: 1, emailNormalized: 1 }`.

### 7.9 `adminInvites`

Purpose: controlled staff/admin creation.

Suggested shape:

```ts
type AdminInviteDoc = {
	_id: string;
	emailNormalized: string;
	role: 'staff' | 'admin';
	permissions: string[];
	invitedByUserId: string;
	tokenHash: string;
	createdAt: Date;
	expiresAt: Date;
	acceptedAt: Date | null;
	revokedAt: Date | null;
};
```

Indexes:

- Unique `{ tokenHash: 1 }`.
- `{ emailNormalized: 1, acceptedAt: 1, revokedAt: 1 }`.
- TTL `{ expiresAt: 1 }` for unaccepted expired invites.

Rules:

- First super-admin can be seeded through a one-time CLI/script with explicit env guard.
- After first admin exists, no public admin creation endpoint should exist.

### 7.10 `roles` and `userRoleAssignments`

Purpose: keep current `role` enum simple now but reserve enterprise RBAC.

Minimal launch:

- `users.role` remains the broad gate: `customer | staff | admin`.
- Admin permissions can initially be computed by role.

Growth target:

```ts
type RoleDoc = {
	_id: string;
	key: string;
	name: string;
	audience: 'admin' | 'storefront';
	permissions: string[];
	system: boolean;
	createdAt: Date;
	updatedAt: Date;
};

type UserRoleAssignmentDoc = {
	_id: string;
	userId: string;
	roleId: string;
	scope: 'global' | 'category' | 'order' | 'content';
	scopeId: string | null;
	assignedByUserId: string;
	createdAt: Date;
	revokedAt: Date | null;
};
```

Indexes:

- Unique `{ key: 1, audience: 1 }` on `roles`.
- `{ userId: 1, revokedAt: 1 }` on assignments.

### 7.11 `securityAuditLogs`

Purpose: immutable security and admin audit trail.

Suggested shape:

```ts
type SecurityAuditLogDoc = {
	_id: string;
	actorUserId: string | null;
	targetUserId: string | null;
	audience: 'storefront' | 'admin' | 'system';
	eventType:
		| 'login_success'
		| 'login_failure'
		| 'logout'
		| 'refresh'
		| 'refresh_reuse_detected'
		| 'password_changed'
		| 'password_reset_requested'
		| 'password_reset_completed'
		| 'otp_requested'
		| 'otp_verified'
		| 'oauth_started'
		| 'oauth_completed'
		| 'oauth_failed'
		| 'role_changed'
		| 'user_disabled'
		| 'admin_invited'
		| 'admin_invite_accepted';
	severity: 'info' | 'warn' | 'critical';
	ipHash: string | null;
	userAgentHash: string | null;
	requestId: string;
	metadata: Record<string, unknown>;
	createdAt: Date;
};
```

Indexes:

- `{ actorUserId: 1, createdAt: -1 }`.
- `{ targetUserId: 1, createdAt: -1 }`.
- `{ eventType: 1, createdAt: -1 }`.
- `{ severity: 1, createdAt: -1 }`.

Rules:

- Logs should be append-only at application level.
- Do not log plaintext OTP, passwords, refresh tokens, provider tokens, or raw IP addresses.

### 7.12 `authRateLimits`

Purpose: Mongo-backed rate limiting until Redis or another hot store is introduced.

Suggested shape:

```ts
type AuthRateLimitDoc = {
	_id: string;
	key: string;
	scope: 'ip' | 'email' | 'phone' | 'user' | 'provider';
	action: 'login' | 'otp_request' | 'password_reset' | 'oauth_start' | 'refresh';
	count: number;
	firstSeenAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
	blockedUntil: Date | null;
};
```

Indexes:

- Unique `{ key: 1, action: 1 }`.
- TTL `{ expiresAt: 1 }`.

Rules:

- Use atomic `$inc` and `$setOnInsert` updates.
- For high traffic later, move this to Redis while keeping audit logs in Mongo.

### 7.13 `consentEvents`

Purpose: GDPR/cookie consent history.

Suggested shape:

```ts
type ConsentEventDoc = {
	_id: string;
	userId: string | null;
	guestId: string | null;
	consent: {
		necessary: true;
		analytics: boolean;
		marketing: boolean;
	};
	policyVersion: string;
	source: 'storefront' | 'admin';
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
};
```

Indexes:

- `{ userId: 1, createdAt: -1 }`.
- `{ guestId: 1, createdAt: -1 }`.

---

## 8. Contracts and DTOs

### 8.1 Contract package additions

Add or expand zod contracts in `packages/contracts` when implementation begins.

Recommended files:

- `packages/contracts/src/auth.ts`
- `packages/contracts/src/admin-auth.ts`
- `packages/contracts/src/session.ts`
- Expand `packages/contracts/src/user.ts` with phone, username, status, identity metadata, and sanitized admin profile fields.

### 8.2 Storefront DTOs

```ts
RegisterStorefrontRequest = {
  email: string;
  password: string;
  displayName?: string;
  marketingOptIn?: boolean;
  guestCartId?: string;
};

PasswordLoginRequest = {
  email: string;
  password: string;
  rememberMe?: boolean;
  guestCartId?: string;
};

EmailOtpRequest = {
  email: string;
  purpose: 'login' | 'register';
};

EmailOtpVerifyRequest = {
  email: string;
  code: string;
  guestCartId?: string;
};

AuthSessionResponse = {
  user: PublicUser;
  session: {
    audience: 'storefront' | 'admin';
    expiresAt: string;
    refreshExpiresAt: string;
  };
};
```

Responses should not include access token or refresh token for browser flows. Cookies carry the session.

### 8.3 Admin DTOs

```ts
AdminLoginRequest = {
  identifier: string; // email or username
  password: string;
};

AdminMeResponse = {
  user: AdminUserProfile;
  permissions: string[];
  session: {
    audience: 'admin';
    expiresAt: string;
    refreshExpiresAt: string;
  };
};

AdminInviteRequest = {
  email: string;
  role: 'staff' | 'admin';
  permissions?: string[];
};
```

### 8.4 Sanitized user shapes

Public storefront user:

- `id`
- `email`
- `emailVerified`
- `phone` only if collected and user-owned
- `phoneVerified`
- `displayName`
- `role` only if needed by frontend guards
- `addresses`
- `consent`
- `createdAt`

Admin user profile:

- same public fields plus `username`, `status`, `permissions`, `adminProfile`, `lastLoginAt`.
- never expose token versions, password hash state, raw risk metadata, or provider raw profile.

---

## 9. Backend Architecture Plan

### 9.1 Ports

Expand the domain boundary rather than leaking Mongoose/provider details into controllers.

Recommended ports:

```ts
interface AuthCryptoPort {
	hashPassword(password: string): Promise<string>;
	verifyPassword(password: string, hash: string): Promise<boolean>;
	signAccessToken(claims: AccessClaims): Promise<string>;
	verifyAccessToken(token: string): Promise<AccessClaims>;
	generateOpaqueToken(bytes?: number): string;
	hashOpaqueToken(token: string): string;
	generateOtp(): string;
	hashOtp(code: string): Promise<string>;
	verifyOtp(code: string, hash: string): Promise<boolean>;
}

interface AuthSessionRepository {
	createSession(input: CreateSessionInput): Promise<AuthSession>;
	findByRefreshTokenHash(hash: string): Promise<AuthSession | null>;
	rotateRefresh(input: RotateRefreshInput): Promise<AuthSession>;
	revokeSession(sessionId: string, reason: RevokeReason): Promise<void>;
	revokeUserSessions(userId: string, reason: RevokeReason): Promise<void>;
}

interface IdentityRepository {
	findByProviderSubject(provider: AuthProvider, providerSubject: string): Promise<AuthIdentity | null>;
	linkIdentity(input: LinkIdentityInput): Promise<AuthIdentity>;
}

interface OtpRepository {
	createChallenge(input: CreateOtpChallengeInput): Promise<OtpChallenge>;
	consumeChallenge(input: ConsumeOtpChallengeInput): Promise<OtpChallenge>;
}

interface OAuthStateRepository {
	createState(input: CreateOAuthStateInput): Promise<OAuthState>;
	consumeState(state: string): Promise<OAuthState>;
}
```

### 9.2 Services

- `AuthService`: orchestration for login/register/refresh/logout/me.
- `StorefrontAuthService`: storefront-specific registration, guest cart merge, email OTP login.
- `AdminAuthService`: admin login, invite acceptance, admin session policy.
- `OAuthService`: provider start/callback, state, nonce, provider profile verification.
- `OtpService`: code generation, email dispatch, verification, rate limits.
- `SessionService`: cookie setting/clearing, refresh rotation, reuse detection.
- `SecurityAuditService`: append audit events.

### 9.3 Guards

- `CookieJwtAuthGuard`: reads access JWT from cookie first, bearer fallback only for non-browser API clients.
- `OptionalAuthGuard`: attaches user if present, does not fail if absent; useful for catalog/cart personalization.
- `CsrfGuard`: enforces `X-CSRF-Token` for unsafe methods with cookie sessions.
- `RolesGuard`: existing role guard, expanded to use session audience.
- `PermissionGuard`: for admin permissions beyond broad roles.
- `AdminAudienceGuard`: requires `aud: admin` and `role: staff|admin`.
- `StorefrontAudienceGuard`: requires `aud: storefront` where customer account context is required.

### 9.4 Controller conventions

- Controllers validate all bodies with zod schemas from `packages/contracts`.
- Controllers do not set cookies directly except through a session/cookie service abstraction.
- Controllers never call provider SDKs directly.
- Controllers return sanitized contract responses only.

---

## 10. OAuth Implementation Plan

### 10.1 Recommended OAuth pattern

Use API-owned authorization-code flow for both Google and Facebook.

Why:

- Client secrets never enter Angular bundles.
- Redirect URIs are centralized.
- State/nonce validation is controlled by API.
- Session cookies are issued by the API after provider verification.
- Same flow works for SSR, PWA, and normal browser navigation.

### 10.2 Google flow

1. Storefront user clicks `Continue with Google`.
2. Browser navigates to `/auth/oauth/google/start?redirect=/account`.
3. API creates `oauthStates` record with state, nonce, optional PKCE verifier, audience `storefront`, guest cart id, and redirect-after-login.
4. API redirects to Google authorization URL with client id, redirect URI, response type, scope `openid email profile`, state, nonce, and PKCE when used.
5. Google redirects to `/auth/oauth/google/callback`.
6. API validates state and exchanges code or validates ID token depending on selected implementation.
7. API validates issuer, audience, expiry, signature, nonce, email, and Google `sub`.
8. API finds or creates `authIdentities(provider='google', providerSubject=sub)`.
9. API links/creates user based on safe identity rules.
10. API creates `authSessions`, sets auth cookies, merges guest cart, audits login, and redirects back to storefront.

### 10.3 Facebook flow

1. Storefront user clicks `Continue with Facebook`.
2. Browser navigates to `/auth/oauth/facebook/start?redirect=/account`.
3. API creates `oauthStates` record with provider `facebook` and audience `storefront`.
4. API redirects to Meta OAuth dialog with app id, redirect URI, scope `public_profile,email`, and state.
5. Meta redirects to `/auth/oauth/facebook/callback`.
6. API validates state and exchanges code for access token.
7. API validates token using Meta token/debug/profile endpoints as appropriate.
8. API fetches `/me?fields=id,name,email`.
9. API stores `authIdentities(provider='facebook', providerSubject=facebookUserId)`.
10. API creates/links user, creates session, sets cookies, merges guest cart, audits login, and redirects back to storefront.

### 10.4 Provider token storage

Default: do not store raw provider access tokens.

Only store raw provider tokens if a future feature needs provider API access after login. If that happens:

- Encrypt tokens at rest.
- Store least scopes only.
- Store expiry and refresh rules.
- Add data deletion and revocation flow.
- Re-run privacy review.

Social login for Saha Textile does not need provider API access beyond identity verification.

### 10.5 OAuth account linking

Recommended safe policy:

| Case                                                                  | Action                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Provider subject already linked                                       | Login existing user.                                                             |
| Provider email verified and exactly matches one active customer email | Allow link after explicit confirmation or after password/OTP proof.              |
| Provider email missing                                                | Create account only if provider subject is stable and user supplies email later. |
| Email belongs to admin/staff                                          | Do not auto-link through storefront OAuth.                                       |
| Email matches multiple/inconsistent records                           | Block auto-link; ask user to login another way.                                  |

---

## 11. Manual Steps Outside Repo

### 11.1 Google Cloud manual setup

1. Create or select a Google Cloud project for Saha Textile production.
2. Open Google Auth Platform/Branding and configure:

- App name: `Saha Textile`
- Support email
- App logo
- Authorized domains: `sahatextile.com` and any final staging domain
- Homepage URL
- Privacy Policy URL
- Terms of Service URL if available

3. Create OAuth 2.0 Client ID with application type `Web application`.
4. Add authorized JavaScript origins if using Google Identity Services button or One Tap:

- `https://sahatextile.com`
- `https://www.sahatextile.com`
- staging storefront origin
- local dev origins as needed, for example `http://localhost:5173`

5. Add authorized redirect URIs:

- `https://api.sahatextile.com/auth/oauth/google/callback`
- staging API callback
- local API callback, for example `http://localhost:4000/auth/oauth/google/callback`

6. Use only default auth scopes: `openid`, `email`, `profile`.
7. Copy these into secret env storage, not browser config:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

8. If frontend Google Identity Services button is used, expose only the client ID through public runtime config; never expose the client secret.
9. Confirm OAuth verification status before production launch if Google requests verification.

### 11.2 Meta/Facebook manual setup

1. Create or select a Meta for Developers app for Saha Textile.
2. Add the Facebook Login product/use case.
3. Add Website platform and site URL:

- `https://sahatextile.com`
- `https://www.sahatextile.com` if used

4. Configure app domains:

- `sahatextile.com`
- staging domain if used

5. Configure privacy and compliance URLs:

- Privacy Policy URL
- User Data Deletion URL or deletion instructions URL
- Terms URL if available

6. In Facebook Login settings, add valid OAuth redirect URIs:

- `https://api.sahatextile.com/auth/oauth/facebook/callback`
- staging API callback
- local API callback, for example `http://localhost:4000/auth/oauth/facebook/callback`

7. Request only these permissions:

- `public_profile`
- `email`

8. Copy these into secret env storage, not browser config:

- `FACEBOOK_OAUTH_APP_ID`
- `FACEBOOK_OAUTH_APP_SECRET`

9. Test with app roles/test users first.
10. Switch app to live mode only after privacy/deletion URLs and production redirect URIs are correct.
11. Do not request advanced permissions unless a future feature has a clear need and app review is planned.

### 11.3 Brevo manual setup

1. Create Brevo account.
2. Complete sender/domain verification.
3. Configure a sender address such as `no-reply@sahatextile.com`.
4. Create API key for transactional email.
5. Copy into secret env storage:

- `BREVO_API_KEY`
- `OTP_EMAIL_FROM`

6. Keep OTP email templates transactional, short, and non-marketing.
7. Monitor the free daily cap; if exceeded, OTP login should fail gracefully with a non-sensitive message and alert admins.

### 11.4 Domain and policy prerequisites

Before production OAuth launch, create/publish:

- Privacy Policy page.
- Terms and Conditions page.
- Data deletion instructions page.
- Contact/support email.
- Cookie policy and consent UI.
- Production domain and staging domain decisions.

---

## 12. Environment Variables to Plan

Existing env plan already includes core JWT, Brevo, Google, and Facebook entries. Add or refine these during implementation.

```dotenv
# API URL and cookie behavior
PUBLIC_SITE_URL=https://sahatextile.com
ADMIN_SITE_URL=https://admin.sahatextile.com
API_PUBLIC_URL=https://api.sahatextile.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=

# JWT/access token
JWT_ACCESS_SECRET=...
JWT_ACCESS_TTL=15m
JWT_ISSUER=https://api.sahatextile.com

# Refresh/session
REFRESH_TOKEN_PEPPER=...
STORE_FRONT_REFRESH_TTL=30d
ADMIN_REFRESH_IDLE_TTL=12h
ADMIN_REFRESH_ABSOLUTE_TTL=7d

# CSRF
CSRF_SECRET=...

# Google OAuth
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://api.sahatextile.com/auth/oauth/google/callback

# Facebook OAuth
FACEBOOK_OAUTH_APP_ID=...
FACEBOOK_OAUTH_APP_SECRET=...
FACEBOOK_OAUTH_REDIRECT_URI=https://api.sahatextile.com/auth/oauth/facebook/callback

# Email OTP
BREVO_API_KEY=...
OTP_EMAIL_FROM=no-reply@sahatextile.com
OTP_TTL_SECONDS=600
OTP_MAX_ATTEMPTS=5

# Admin bootstrap, local/one-time only
ADMIN_BOOTSTRAP_EMAIL=
ADMIN_BOOTSTRAP_USERNAME=
ADMIN_BOOTSTRAP_PASSWORD=
ADMIN_BOOTSTRAP_DISABLED=true
```

Notes:

- Keep `JWT_REFRESH_SECRET` only if the implementation continues JWT refresh tokens temporarily. Target architecture uses opaque refresh tokens plus `REFRESH_TOKEN_PEPPER`.
- Do not expose OAuth secrets through Angular environment files.
- Public client IDs can be exposed only if provider browser SDKs need them.

---

## 13. Dependency Plan

### 13.1 Backend dependencies

| Dependency                                      | Need                                                 | Justification                                                                                |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@fastify/cookie`                               | Add if absent                                        | Required to parse/set signed cookies cleanly in Fastify.                                     |
| `@fastify/csrf-protection` or custom CSRF guard | Add/evaluate                                         | Protect cookie-auth unsafe requests. Custom guard may be better for zod/session integration. |
| `openid-client`                                 | Add/evaluate                                         | Strong OIDC/OAuth authorization-code handling for Google and future providers.               |
| `google-auth-library`                           | Add/evaluate                                         | Official Google ID token verification if using GIS credential POST or One Tap.               |
| `undici`                                        | Use if already available via Node, or add explicitly | Server-side calls to Meta token/profile/debug endpoints.                                     |
| `argon2`                                        | Keep                                                 | Password and optionally OTP hashing.                                                         |
| `jsonwebtoken` or `jose`                        | Keep or migrate                                      | Current code uses JWT. `jose` is stronger for modern JWT/JWK/key rotation.                   |
| `@fastify/rate-limit`                           | Keep/add per roadmap                                 | Baseline rate limit for auth, OTP, search, checkout.                                         |
| `zod`                                           | Keep                                                 | Contract-first DTO validation.                                                               |

Recommendation: do not add Passport unless the team wants its middleware conventions. Direct provider services behind ports are clearer and easier to test in this architecture.

### 13.2 Frontend dependencies

| Dependency                | Need                        | Justification                                                               |
| ------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| Angular HttpClient        | Keep                        | All auth requests through interceptors with credentials and CSRF header.    |
| NgRx hybrid               | Keep                        | Auth/session UI state only, no tokens.                                      |
| TanStack Query            | Keep                        | `me`, account, orders, addresses; purge on logout.                          |
| `idb`                     | Keep/planned                | Offline catalogue and cart only; no tokens.                                 |
| `vite-plugin-pwa`/Workbox | Keep/planned                | Offline catalogue browsing and installable storefront.                      |
| Google GIS script         | Optional, no npm dependency | Needed only if using Google button/One Tap frontend experience.             |
| Facebook JS SDK           | Optional, no npm dependency | Avoid unless frontend SDK UX is required; backend redirect flow is cleaner. |

---

## 14. Offline PWA and Auth Constraints

### 14.1 What works offline

- Public previously-fetched catalogue browsing.
- Public previously-fetched category pages/data.
- Product detail pages already cached by Workbox/TanStack Query persistence.
- Guest cart reads/writes in IndexedDB.
- Cart mutation queue that syncs when online.
- Locale/currency preferences.

### 14.2 What does not work offline

- Login.
- Register.
- OAuth login.
- Email OTP request/verify.
- Password reset.
- Refresh token rotation.
- Checkout/payment.
- Admin CRUD.
- Account/order updates.

### 14.3 Storefront offline cart rules

- Guest cart can be edited offline.
- Authenticated cart can be edited offline only as local pending mutations tied to the current user id and session fingerprint.
- On reconnect, sync must check `GET /auth/me` first.
- If session is expired, prompt login before sync.
- If user logs out, purge authenticated offline cart queue and account query cache.
- On login, merge guest cart server-side, then replace local cart with server truth.

### 14.4 Service worker cache denylist

Never cache these paths in a shared/public service worker cache:

- `/auth/*`
- `/admin/*`
- `/account/*`
- `/orders/*`
- `/checkout/*`
- `/payments/*`
- `/returns/*`
- `/refunds/*`
- any response with `Set-Cookie`
- any response containing user PII

### 14.5 Admin PWA stance

- Admin PWA can be installable as a shell, but no offline admin data mutation at launch.
- Admin should show offline status and disable writes when offline.
- Admin service worker must not cache sensitive admin API responses.

---

## 15. Security Controls

### 15.1 Password controls

- Argon2id only.
- Minimum 12 characters for admin, 8 or 10 for customers depending UX decision.
- Check common passwords locally with a small denylist at minimum.
- Password reset and password change revoke sessions.
- Password failure count uses user/email plus IP rate limits.

### 15.2 Rate limits

Baseline limits to tune during implementation:

| Action                  | Suggested limit                                             |
| ----------------------- | ----------------------------------------------------------- |
| Customer password login | 5 failures per email per 15 min; 20 per IP per 15 min.      |
| Admin password login    | 5 failures per identifier per 30 min; 10 per IP per 30 min. |
| Email OTP request       | 3 per email per 15 min; 10 per IP per hour.                 |
| OTP verify              | 5 attempts per challenge.                                   |
| Password reset request  | 3 per email per hour; generic response.                     |
| OAuth start             | 20 per IP per 10 min.                                       |
| Refresh                 | Higher, but detect abnormal rotation/reuse.                 |

### 15.3 Headers and CORS

- CORS allowlist only: storefront origin, admin origin, local dev origins.
- `Access-Control-Allow-Credentials: true` only for allowlisted origins.
- `Vary: Origin` for credentialed CORS responses.
- HSTS on production domains.
- CSP with explicit provider allowances for Google/Meta only if frontend SDKs are used.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` to reduce browser feature exposure.

### 15.4 Admin-specific hardening

- Admin login must accept only users with `role: staff | admin` and `status: active`.
- Admin sessions use `aud: admin` and shorter refresh TTL.
- Every admin write creates an audit log.
- Role/permission changes increment `permissionsVersion`.
- Critical admin actions should have a future `step_up_required` seam.
- Staff/admin cannot be created through storefront registration.
- Admin routes should be hidden from indexing and protected at API level, not only UI routes.

### 15.5 Privacy and data deletion

- Keep consent history.
- Implement user data export and delete request workflow.
- For orders, retain required tax/accounting snapshots while scrubbing optional account PII where legally allowed.
- Social login must have user data deletion instructions to satisfy Meta and privacy requirements.

---

## 16. Implementation Phasing

### Phase A: Schema and contracts

- Expand auth contracts/DTOs.
- Add Mongo models for sessions, identities, OTP, OAuth state, reset tokens, audit logs, rate limits.
- Add indexes and TTLs.
- Keep current user model compatible while migrating passwordHash if needed.

### Phase B: Cookie session foundation

- Add cookie parsing/setting.
- Add CSRF guard.
- Replace browser token response flow with cookie setting.
- Add cookie-aware JWT guard with bearer fallback.
- Add refresh rotation with reuse detection.

### Phase C: Storefront password and email OTP

- Implement customer register/login/logout/me.
- Implement Brevo email OTP request/verify.
- Implement guest cart merge hook.
- Add frontend auth interceptor, auth store, and route guards.

### Phase D: Admin auth

- Implement first-admin bootstrap CLI/script.
- Implement admin login with email-or-username plus password.
- Implement admin session audience/guards.
- Implement admin invites and audit logs.

### Phase E: Google/Facebook OAuth

- Implement OAuth state repository.
- Implement Google start/callback and identity verification.
- Implement Facebook start/callback and identity verification.
- Implement social identity linking rules.
- Add storefront buttons and callback handling.

### Phase F: PWA and security hardening

- Add Workbox denylist for auth/admin/account/order APIs.
- Persist public catalogue only.
- Purge auth-sensitive caches on logout/session expiry.
- Add security tests for CSRF, cookie flags, refresh reuse, role/audience separation, and admin access.

---

## 17. Test and Review Checklist

### 17.1 API tests

- Register sets cookies and returns sanitized user only.
- Login sets cookies and does not return tokens in JSON for browser flow.
- Access cookie authorizes `/auth/me`.
- Missing CSRF blocks unsafe authenticated requests.
- Refresh rotates token and old refresh reuse revokes family.
- Logout clears cookies and revokes session.
- Disabled user cannot refresh or login.
- Admin login rejects customer role.
- Storefront token cannot access admin route.
- Admin token cannot bypass object-level authorization.
- OTP request is enumeration-safe.
- OTP verify enforces attempts and TTL.
- OAuth callback rejects invalid state.
- OAuth identity uses Google `sub` / Facebook user id, not email as primary provider id.

### 17.2 Frontend tests

- Auth interceptor sends credentials.
- Unsafe requests include CSRF header.
- One failed API call triggers one refresh retry, not infinite loops.
- Logout purges auth store and sensitive query caches.
- Storefront login merges guest cart.
- Admin routes require admin session.
- Offline catalogue works without auth.
- Auth/login pages show online requirement when offline.

### 17.3 Security review

- Cookie flags verified in browser devtools.
- No token appears in localStorage/sessionStorage/IndexedDB.
- No token appears in service worker cache.
- CORS rejects unknown origins.
- Admin audit logs are created for sensitive writes.
- Rate limits trigger on repeated login/OTP attempts.
- Provider secrets do not appear in client bundles.

---

## 18. Query Register for Owner Decisions

### Query 1: Should admin MFA be mandatory at launch?

Recommended option: No mandatory MFA at launch, but design the seam now.

| Option                      | Pros                                                   | Cons                                                      |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| No MFA at launch, seam only | Fastest; keeps admin login simple; no paid dependency. | Lower protection for admin accounts until MFA lands.      |
| TOTP at launch              | Free; strong admin security; no SMS cost.              | More UI/API work; support burden for lost devices.        |
| Passkeys at launch          | Modern and phishing resistant.                         | More complexity; browser/device support testing required. |

### Query 2: Should Google/Facebook use backend redirect only or provider JS buttons too?

Recommended option: Backend redirect flow first, provider JS buttons later only if UX needs it.

| Option                                          | Pros                                                         | Cons                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Backend redirect flow                           | Secrets stay server-side; uniform for SSR/PWA; easier audit. | Slightly less native provider button/One Tap UX.      |
| Frontend provider SDK plus backend verification | Better Google One Tap/Facebook button UX.                    | More CSP/COOP work; more browser/provider edge cases. |
| Both                                            | Best UX flexibility.                                         | More implementation and testing surface.              |

### Query 3: Final production domain topology?

Recommended option: `www.sahatextile.com`, `admin.sahatextile.com`, `api.sahatextile.com`.

| Option                          | Pros                                                                   | Cons                                                         |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Separate subdomains             | Clean deploy boundaries; clear CORS allowlist; API cookies host-bound. | Requires credentialed CORS and careful cookie settings.      |
| Same-origin reverse proxy paths | Simpler browser cookie/CORS behavior.                                  | More proxy routing complexity; app boundaries less explicit. |

### Query 4: Should phone be collected during registration?

Recommended option: Collect phone at checkout/address stage, not registration.

| Option                | Pros                                               | Cons                                              |
| --------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Checkout/address only | Less signup friction; phone tied to shipping need. | Phone login cannot launch until later.            |
| Registration optional | Builds phone dataset early.                        | Adds form friction and validation questions.      |
| Registration required | Better contactability.                             | Highest conversion risk; not needed for browsing. |

### Query 5: Should offline account/order data be cached?

Recommended option: No offline account/order cache at launch.

| Option                     | Pros                               | Cons                                                                 |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| No sensitive offline cache | Safest; simplest compliance story. | Account/order pages need network.                                    |
| Short-lived account cache  | Better UX for repeat visitors.     | PII in IndexedDB; logout purge and expiry become critical.           |
| Encrypted local cache      | Stronger UX and security.          | Key management is hard in browser apps; not worth launch complexity. |

---

## 19. Final Architecture Position

The target auth architecture is:

- Storefront: email/password, email OTP, Google login, Facebook login, guest cart, future phone OTP seam.
- Admin: email-or-username/password only at launch, invite/bootstrap controlled, same cookie/CSRF/session security, stricter TTL and audit.
- Session: short-lived access JWT in `httpOnly` cookie plus opaque rotating refresh token in `httpOnly` cookie.
- DB: `users` plus separate identity, credential, session, OTP, OAuth state, reset, invite, rate-limit, consent, and audit collections.
- Frontend: Angular stores session state only, never tokens.
- PWA: offline public catalogue and cart only; no offline auth or admin data mutation.
- OAuth: Google and Facebook included; X excluded; phone OTP modeled but not implemented.
