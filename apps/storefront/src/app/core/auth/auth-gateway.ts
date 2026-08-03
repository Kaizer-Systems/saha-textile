import { Observable } from 'rxjs';

/**
 * The storefront's authentication boundary.
 *
 * Components, guards and stores depend on THIS, never on `HttpClient`. That is what makes
 * the API swappable and testable: a route path or wire-DTO change is absorbed by the one
 * adapter behind this token (`HttpStorefrontAuthGateway`) instead of rippling through
 * feature code. It is also why there is no `token` anywhere in these types — the browser
 * session lives entirely in API-set httpOnly cookies, so there is nothing for the client
 * to hold, store or forward.
 *
 * Storefront only. Admin authentication is a separate gateway with separate credentials
 * and a separate audience; the two must never be able to import each other's methods.
 */

/** Sanitized identity the UI may render. Never carries hashes or version counters. */
export interface AuthUser {
	id: string;
	email: string | null;
	emailVerified: boolean;
	displayName?: string;
	role: string;
	status: string;
}

/** Session envelope timings. Cookies carry the actual credential; these are for UX only. */
export interface AuthSessionInfo {
	audience: string;
	expiresAt: string;
	refreshExpiresAt: string;
}

export interface AuthSessionResult {
	user: AuthUser;
	session: AuthSessionInfo;
}

export interface RegisterInput {
	email: string;
	password: string;
	displayName?: string;
}

export interface PasswordLoginInput {
	email: string;
	password: string;
	rememberMe?: boolean;
}

export interface EmailOtpVerifyInput {
	email: string;
	code: string;
}

export interface PasswordResetInput {
	token: string;
	newPassword: string;
}

export abstract class StorefrontAuthGateway {
	/** Resolves the signed-in customer from session cookies, or `null` when anonymous. */
	abstract currentUser(): Observable<AuthUser | null>;

	/**
	 * Obtains the readable double-submit CSRF token and lets the API bind it to the live
	 * session. Safe to call repeatedly; the API preserves a still-valid bound token.
	 */
	abstract ensureCsrfToken(): Observable<void>;

	abstract register(input: RegisterInput): Observable<AuthSessionResult>;

	abstract loginWithPassword(input: PasswordLoginInput): Observable<AuthSessionResult>;

	/**
	 * Requests an email OTP. Resolves identically whether or not the account exists — the
	 * API answers generically on purpose, so the UI must not infer existence from success.
	 */
	abstract requestEmailOtp(email: string, purpose: 'login' | 'register'): Observable<void>;

	abstract verifyEmailOtp(input: EmailOtpVerifyInput): Observable<AuthSessionResult>;

	/** Starts password recovery. Also generic: success never confirms an address is known. */
	abstract requestPasswordReset(email: string): Observable<void>;

	abstract resetPassword(input: PasswordResetInput): Observable<void>;

	abstract logout(): Observable<void>;

	/**
	 * Rotates the session using the refresh cookie. Emits nothing — the new access, refresh
	 * and CSRF cookies are set by the API on the response, and the client never sees them.
	 *
	 * Callers must not invoke this directly to "keep the session alive". It exists for the
	 * transport layer to recover a single expired-access 401, and rotation is reuse-detecting:
	 * two concurrent rotations look like a stolen token and revoke the whole family.
	 */
	abstract refreshSession(): Observable<void>;

	/**
	 * True when a `401` from this URL means "these credentials were refused" rather than
	 * "this session expired".
	 *
	 * The distinction is what keeps the transport's 401 recovery from looping: rotating the
	 * session after a wrong password would be pointless, and rotating after a failed rotation
	 * would be infinite. It lives on the gateway because the gateway is the one file that
	 * knows this app's route paths.
	 *
	 * `/me` is deliberately NOT one of these: a 401 there means there is no live session for
	 * this browser, which is exactly the case a refresh can still recover on a page reload.
	 */
	abstract isCredentialEndpoint(url: string): boolean;

	/**
	 * True when a SUCCESSFUL response from this URL proves a session now exists.
	 *
	 * A strict subset of the credential endpoints, and the difference is the point. The
	 * transport stops attempting rotation once one has failed, and only evidence of a live
	 * session makes that verdict obsolete. Logout, recovery request and password reset are
	 * credential endpoints that succeed by DESTROYING or not creating a session, so treating
	 * their `204` as proof would un-latch the transport into one pointless rotation per
	 * subsequent 401 — the exact loop the latch exists to prevent.
	 */
	abstract isSessionEstablishingEndpoint(url: string): boolean;
}
