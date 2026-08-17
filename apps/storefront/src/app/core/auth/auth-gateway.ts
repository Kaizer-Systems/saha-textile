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

/**
 * The server's view of a signup in progress (`DEC-SIGNUP-VERIFICATION`).
 *
 * The form RENDERS this; it never asserts it. Verified state lives on the server, so the
 * screen asks what is already true rather than telling the API what it believes — a browser
 * that could claim "verified" would be a browser that could claim somebody else's address.
 */
export interface SignupFieldView {
	value: string | null;
	verified: boolean;
	/** Google's asserted address: shown, never editable. */
	locked: boolean;
	sendsRemaining: number;
	/** When a resend becomes available under the backoff, or null when it already is. */
	resendAvailableAt: string | null;
}

export interface PendingSignupView {
	origin: 'password' | 'google' | 'facebook';
	email: SignupFieldView;
	phone: SignupFieldView;
	displayName: string | null;
	complete: boolean;
	expiresAt: string;
}

export interface StartSignupInput {
	email?: string;
	phone?: string;
	displayName?: string;
	marketingOptIn: boolean;
}

/** What proving control of an identifier revealed — see `verifySignupOtp`. */
export interface SignupOtpVerifyResult {
	state: PendingSignupView;
	existingAccount: boolean;
	accountUsable: boolean;
}

export type SocialProvider = 'google' | 'facebook';

export interface OAuthStartResult {
	stateId: string;
	/** Google only; passed to `google.accounts.id.initialize({ nonce })`. */
	nonce: string | null;
	expiresAt: string;
}

/**
 * Either a session or a signup, never both.
 *
 * A known provider subject signs in; an unknown one lands in the signup form with whatever
 * the provider supplied, still editable. A matching EMAIL produces neither — accounts are
 * never linked automatically on an address.
 */
export interface OAuthVerifyResult {
	outcome: 'signed_in' | 'signup_required';
	user: AuthUser | null;
	session: AuthSessionInfo | null;
	pendingSignup: PendingSignupView | null;
}

export interface LinkedIdentityView {
	provider: SocialProvider;
	connected: boolean;
	email: string | null;
	linkedAt: string | null;
}

export interface LoginMethodsView {
	passwordSet: boolean;
	emailVerified: boolean;
	phoneVerified: boolean;
	identities: LinkedIdentityView[];
	/** Password when one exists — free to check, and stronger than a code to a readable channel. */
	stepUpMethod: 'password' | 'otp';
}

/** Freshness proof for a sensitive account action. Exactly one field is used. */
export interface StepUpProof {
	password?: string;
	otpCode?: string;
}

export interface PasswordLoginInput {
	/** Email address OR phone in E.164. Both are login credentials under `DEC-SIGNUP-VERIFICATION`. */
	identifier: string;
	password: string;
	/**
	 * Stay signed in after the browser closes.
	 *
	 * The API decides what this MEANS — a dated cookie plus the long idle TTL, versus a
	 * session cookie plus a short one. The screen only reports the answer.
	 */
	rememberMe?: boolean;
}

export interface LoginOtpVerifyInput {
	identifier: string;
	code: string;
	/** "Remember me" — the same choice the password path sends. */
	rememberMe?: boolean;
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

	/**
	 * Begins a signup. Replaced `register`, which created an account with nothing verified.
	 *
	 * Returns the server's view of the pending record; the browser holds no proof of its own.
	 */
	abstract startSignup(input: StartSignupInput): Observable<PendingSignupView>;

	/** Sets an identifier, which clears that field's verification server-side. */
	abstract updateSignupField(field: 'email' | 'phone', value: string): Observable<PendingSignupView>;

	abstract requestSignupOtp(field: 'email' | 'phone'): Observable<PendingSignupView>;

	/**
	 * Verifies a code, and reports whether that identifier already has an account.
	 *
	 * The disclosure only exists because the caller just PROVED they control the address; the
	 * screen uses it to offer sign-in rather than letting them finish and be refused.
	 */
	abstract verifySignupOtp(field: 'email' | 'phone', code: string): Observable<SignupOtpVerifyResult>;

	/**
	 * Creates the account from the values the SERVER verified.
	 *
	 * Deliberately takes no identifiers. Everything comes from the pending record, so this call
	 * cannot name an address at the moment an account is minted.
	 */
	abstract finaliseSignup(password?: string): Observable<AuthSessionResult>;

	/** Mints the single-use state a provider round-trip is bound to. */
	abstract startOAuth(provider: SocialProvider): Observable<OAuthStartResult>;

	abstract verifyGoogle(input: {
		stateId: string;
		credential: string;
		nonce: string | null;
	}): Observable<OAuthVerifyResult>;

	abstract verifyFacebook(input: { stateId: string; accessToken: string }): Observable<OAuthVerifyResult>;

	abstract loginMethods(): Observable<LoginMethodsView>;

	/** Sends a step-up code to the channel the customer chose — a credit control, not a courtesy. */
	abstract requestStepUp(channel: 'email' | 'sms'): Observable<void>;

	abstract connectIdentity(
		input: { provider: SocialProvider; stateId: string; credential: string; nonce: string | null } & StepUpProof,
	): Observable<LoginMethodsView>;

	abstract disconnectIdentity(input: { provider: SocialProvider } & StepUpProof): Observable<LoginMethodsView>;

	/**
	 * Sets or changes the password of the signed-in account.
	 *
	 * One call for both, because whether a password already exists is the server's fact to know.
	 * The proof carried alongside is the current password when there is one, and a one-time code
	 * when there is not — which is how a social-only account earns its first password.
	 */
	abstract setPassword(input: { newPassword: string } & StepUpProof): Observable<LoginMethodsView>;

	abstract loginWithPassword(input: PasswordLoginInput): Observable<AuthSessionResult>;

	/**
	 * Requests a one-time code, by email or SMS according to the identifier's shape.
	 *
	 * Resolves identically whether or not the account exists — the API answers generically on
	 * purpose, so the UI must not infer existence from success.
	 */
	abstract requestLoginOtp(identifier: string, purpose: 'login' | 'register'): Observable<void>;

	abstract verifyLoginOtp(input: LoginOtpVerifyInput): Observable<AuthSessionResult>;

	/** Starts password recovery. Also generic: success never confirms an identifier is known. */
	abstract requestPasswordReset(identifier: string): Observable<void>;

	abstract resetPassword(input: PasswordResetInput): Observable<void>;

	/** First password for an admin-created customer (activation token). Same body shape as reset. */
	abstract activateAccount(input: PasswordResetInput): Observable<void>;

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
