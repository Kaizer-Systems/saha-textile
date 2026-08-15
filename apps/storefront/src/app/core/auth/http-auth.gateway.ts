import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	type AuthSessionResult,
	type AuthUser,
	type EmailOtpVerifyInput,
	type PasswordLoginInput,
	type PasswordResetInput,
	type RegisterInput,
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
	register: '/auth/storefront/register',
	passwordLogin: '/auth/storefront/login/password',
	otpRequest: '/auth/storefront/login/email-otp/request',
	otpVerify: '/auth/storefront/login/email-otp/verify',
	passwordForgot: '/auth/storefront/password/forgot',
	passwordReset: '/auth/storefront/password/reset',
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
	ROUTES.register,
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
const SESSION_ESTABLISHING_ROUTES: readonly string[] = [ROUTES.register, ROUTES.passwordLogin, ROUTES.otpVerify];

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

	override register(input: RegisterInput): Observable<AuthSessionResult> {
		return this.http.post<AuthSessionResult>(this.url(ROUTES.register), input);
	}

	override loginWithPassword(input: PasswordLoginInput): Observable<AuthSessionResult> {
		return this.http.post<AuthSessionResult>(this.url(ROUTES.passwordLogin), input);
	}

	override requestEmailOtp(email: string, purpose: 'login' | 'register'): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.otpRequest), { email, purpose }).pipe(map(() => undefined));
	}

	override verifyEmailOtp(input: EmailOtpVerifyInput): Observable<AuthSessionResult> {
		return this.http.post<AuthSessionResult>(this.url(ROUTES.otpVerify), input);
	}

	override requestPasswordReset(email: string): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.passwordForgot), { email }).pipe(map(() => undefined));
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
