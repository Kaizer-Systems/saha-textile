import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	type AuthSessionResult,
	type AuthUser,
	type LoginOtpVerifyInput,
	type PasswordLoginInput,
	type PasswordResetInput,
	type LoginMethodsView,
	type OAuthStartResult,
	type OAuthVerifyResult,
	type PendingSignupView,
	type SignupOtpVerifyResult,
	type SocialProvider,
	type StartSignupInput,
	type StepUpProof,
	StorefrontAuthGateway,
} from './auth-gateway';

/**
 * The single place storefront authentication route paths exist in this application.
 *
 * Kept together deliberately: when `packages/contracts` and the OpenAPI document change, a
 * path or DTO edit happens here once. A path literal appearing in a component or guard is
 * the defect this constant prevents.
 */
const ROUTES = {
	csrf: '/auth/csrf',
	me: '/auth/storefront/me',
	signupStart: '/auth/storefront/signup/start',
	signupField: '/auth/storefront/signup/field',
	signupOtpRequest: '/auth/storefront/signup/otp/request',
	signupOtpVerify: '/auth/storefront/signup/otp/verify',
	signupFinalise: '/auth/storefront/signup/finalise',
	oauthState: '/auth/storefront/oauth/state',
	oauthGoogle: '/auth/storefront/oauth/google',
	oauthFacebook: '/auth/storefront/oauth/facebook',
	oauthConnect: '/auth/storefront/oauth/connect',
	oauthDisconnect: '/auth/storefront/oauth/disconnect',
	loginMethods: '/auth/storefront/login-methods',
	stepUpRequest: '/auth/storefront/step-up/request',
	passwordLogin: '/auth/storefront/login/password',
	otpRequest: '/auth/storefront/login/email-otp/request',
	otpVerify: '/auth/storefront/login/email-otp/verify',
	passwordForgot: '/auth/storefront/password/forgot',
	passwordReset: '/auth/storefront/password/reset',
	passwordSet: '/auth/storefront/password/set',
	activate: '/auth/storefront/activate',
	logout: '/auth/storefront/logout',
	refresh: '/auth/storefront/refresh',
} as const;

/**
 * Routes where a `401` means the submitted credential was refused, not that the session
 * lapsed — so the transport must not try to rotate and retry.
 *
 * `me` is absent on purpose: a 401 there is precisely the recoverable case. `csrf` is absent
 * because it is shared, public and cannot 401. `refresh` is present because retrying a
 * failed rotation with another rotation is the loop this list prevents.
 */
const CREDENTIAL_ROUTES: readonly string[] = [
	/**
	 * The whole signup and social surface.
	 *
	 * A 401 on ANY of these means the submitted credential — a code, a password, a provider
	 * token — was refused, never that a session lapsed. Omitting one would let the transport
	 * answer a refused code by rotating a session that does not exist yet and retrying, which
	 * is a loop rather than a recovery.
	 */
	ROUTES.signupStart,
	ROUTES.signupField,
	ROUTES.signupOtpRequest,
	ROUTES.signupOtpVerify,
	ROUTES.signupFinalise,
	ROUTES.oauthState,
	ROUTES.oauthGoogle,
	ROUTES.oauthFacebook,
	ROUTES.passwordLogin,
	ROUTES.otpRequest,
	ROUTES.otpVerify,
	ROUTES.passwordForgot,
	ROUTES.passwordReset,
	ROUTES.activate,
	ROUTES.logout,
	ROUTES.refresh,
];

/**
 * Routes whose SUCCESS proves a session now exists — a strict subset of the above.
 *
 * Logout succeeds by destroying one. `passwordForgot` only sends an email. `passwordReset`
 * revokes every session by design. `otpRequest` merely issues a challenge; it is `otpVerify`
 * that mints the session. Treating any of those as proof would un-latch the transport and
 * buy one pointless rotation per later 401.
 */
const SESSION_ESTABLISHING_ROUTES: readonly string[] = [
	ROUTES.passwordLogin,
	ROUTES.otpVerify,
	// Only FINALISE mints a session. Starting a signup, editing a field, requesting a code and
	// verifying one all leave the customer signed out — treating any of them as proof would
	// un-latch the transport and buy one pointless rotation per later 401.
	ROUTES.signupFinalise,
	// A provider token may sign an existing customer in, so this one CAN establish a session.
	ROUTES.oauthGoogle,
	ROUTES.oauthFacebook,
];

/** Wire shape of the API's `/me`. Declared here so no other file depends on it. */
interface MeResponse {
	user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class HttpStorefrontAuthGateway extends StorefrontAuthGateway {
	private readonly http = inject(HttpClient);

	/** Read at call time, not construction: runtime config is filled by an app initializer. */
	private url(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	override currentUser(): Observable<AuthUser | null> {
		return this.http.get<MeResponse>(this.url(ROUTES.me)).pipe(
			map((response) => response.user),
			// 401 is the ordinary anonymous answer, not an error worth surfacing. Anything
			// else is also treated as "not signed in" because a session we cannot confirm
			// must never be rendered as one.
			catchError(() => of(null)),
		);
	}

	override ensureCsrfToken(): Observable<void> {
		return this.http.get<{ csrfToken: string }>(this.url(ROUTES.csrf)).pipe(map(() => undefined));
	}

	override startSignup(input: StartSignupInput): Observable<PendingSignupView> {
		return this.http.post<PendingSignupView>(this.url(ROUTES.signupStart), input);
	}

	override updateSignupField(field: 'email' | 'phone', value: string): Observable<PendingSignupView> {
		return this.http.post<PendingSignupView>(this.url(ROUTES.signupField), { field, value });
	}

	override requestSignupOtp(field: 'email' | 'phone'): Observable<PendingSignupView> {
		return this.http.post<PendingSignupView>(this.url(ROUTES.signupOtpRequest), { field });
	}

	override verifySignupOtp(field: 'email' | 'phone', code: string): Observable<SignupOtpVerifyResult> {
		return this.http.post<SignupOtpVerifyResult>(this.url(ROUTES.signupOtpVerify), { field, code });
	}

	override finaliseSignup(password?: string): Observable<AuthSessionResult> {
		// No identifiers. The server finalises from what it verified, so there is nothing here
		// for a tampered form to substitute.
		return this.http.post<AuthSessionResult>(this.url(ROUTES.signupFinalise), password ? { password } : {});
	}

	override startOAuth(provider: SocialProvider): Observable<OAuthStartResult> {
		return this.http.post<OAuthStartResult>(this.url(ROUTES.oauthState), { provider });
	}

	override verifyGoogle(input: {
		stateId: string;
		credential: string;
		nonce: string | null;
	}): Observable<OAuthVerifyResult> {
		return this.http.post<OAuthVerifyResult>(this.url(ROUTES.oauthGoogle), input);
	}

	override verifyFacebook(input: { stateId: string; accessToken: string }): Observable<OAuthVerifyResult> {
		return this.http.post<OAuthVerifyResult>(this.url(ROUTES.oauthFacebook), input);
	}

	override loginMethods(): Observable<LoginMethodsView> {
		return this.http.get<LoginMethodsView>(this.url(ROUTES.loginMethods));
	}

	override requestStepUp(channel: 'email' | 'sms'): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.stepUpRequest), { channel }).pipe(map(() => undefined));
	}

	override connectIdentity(
		input: { provider: SocialProvider; stateId: string; credential: string; nonce: string | null } & StepUpProof,
	): Observable<LoginMethodsView> {
		return this.http.post<LoginMethodsView>(this.url(ROUTES.oauthConnect), input);
	}

	override setPassword(input: { newPassword: string } & StepUpProof): Observable<LoginMethodsView> {
		return this.http.post<LoginMethodsView>(this.url(ROUTES.passwordSet), input);
	}

	override disconnectIdentity(input: { provider: SocialProvider } & StepUpProof): Observable<LoginMethodsView> {
		return this.http.post<LoginMethodsView>(this.url(ROUTES.oauthDisconnect), input);
	}

	override loginWithPassword(input: PasswordLoginInput): Observable<AuthSessionResult> {
		return this.http.post<AuthSessionResult>(this.url(ROUTES.passwordLogin), input);
	}

	override requestLoginOtp(identifier: string, purpose: 'login' | 'register'): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.otpRequest), { identifier, purpose }).pipe(map(() => undefined));
	}

	override verifyLoginOtp(input: LoginOtpVerifyInput): Observable<AuthSessionResult> {
		return this.http.post<AuthSessionResult>(this.url(ROUTES.otpVerify), input);
	}

	override requestPasswordReset(identifier: string): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.passwordForgot), { identifier }).pipe(map(() => undefined));
	}

	override resetPassword(input: PasswordResetInput): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.passwordReset), input);
	}

	override activateAccount(input: PasswordResetInput): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.activate), input);
	}

	override logout(): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.logout), {});
	}

	override refreshSession(): Observable<void> {
		// The response body carries the user and session envelope, but nothing here needs
		// it: what matters is the rotated cookies the API sets alongside it.
		return this.http.post<unknown>(this.url(ROUTES.refresh), {}).pipe(map(() => undefined));
	}

	/**
	 * Compared against the path only, so a query string or the configured API origin cannot
	 * change the answer — and an unrelated URL that merely CONTAINS one of these strings
	 * cannot be mistaken for it, which a `includes()` check would allow.
	 */
	override isCredentialEndpoint(url: string): boolean {
		const path = pathOf(url);
		return CREDENTIAL_ROUTES.includes(path);
	}

	override isSessionEstablishingEndpoint(url: string): boolean {
		const path = pathOf(url);
		return SESSION_ESTABLISHING_ROUTES.includes(path);
	}
}

/**
 * Extracts the path from an absolute or relative URL without assuming either form.
 *
 * `URL` needs a base for a relative input; the base is a throwaway origin used only to make
 * parsing total. A malformed URL falls back to the raw string minus its query, so the caller
 * still gets a defined answer rather than an exception thrown out of an interceptor.
 */
function pathOf(url: string): string {
	try {
		return new URL(url, 'http://placeholder.invalid').pathname;
	} catch {
		return url.split('?')[0] ?? url;
	}
}
