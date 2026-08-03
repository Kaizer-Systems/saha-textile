import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	AdminAuthGateway,
	type AdminMe,
	type AdminPasswordResetInput,
	type AdminPasswordLoginInput,
	type AdminPinLoginInput,
	type AdminSessionResult,
} from './auth-gateway';

/**
 * The single place admin authentication route paths exist in this application.
 *
 * Every entry is under `/auth/admin/**`. There is no storefront path here and there must
 * never be one: the route families are separated so an audience mistake is a visible
 * import error rather than a silent privilege question.
 */
const ROUTES = {
	csrf: '/auth/csrf',
	me: '/auth/admin/me',
	login: '/auth/admin/login',
	pinLogin: '/auth/admin/login/pin',
	resume: '/auth/admin/resume',
	passwordForgot: '/auth/admin/password/forgot',
	passwordReset: '/auth/admin/password/reset',
	logout: '/auth/admin/logout',
	refresh: '/auth/admin/refresh',
} as const;

/**
 * Routes where a `401` means the submitted credential was refused, not that the session
 * lapsed — so the transport must not try to rotate and retry.
 *
 * `me` is absent on purpose: a 401 there is precisely the recoverable case. `csrf` is absent
 * because it is shared, public and cannot 401. `resume` IS listed: a wrong PIN at the soft
 * lock is a refused credential, and rotating the access cookie would neither help nor be
 * an answer to the presence question the overlay is asking.
 */
const CREDENTIAL_ROUTES: readonly string[] = [
	ROUTES.login,
	ROUTES.pinLogin,
	ROUTES.resume,
	ROUTES.passwordForgot,
	ROUTES.passwordReset,
	ROUTES.logout,
	ROUTES.refresh,
];

/**
 * Routes whose SUCCESS proves a session now exists — a strict subset of the above.
 *
 * Logout succeeds by destroying one. `passwordForgot` only sends an email. `passwordReset`
 * revokes every admin session and suspends PIN use by design. Treating any of those as proof
 * would un-latch the transport and buy one pointless rotation per later 401. `resume` belongs
 * here because it extends the operator's existing session, which a success proves is alive.
 */
const SESSION_ESTABLISHING_ROUTES: readonly string[] = [ROUTES.login, ROUTES.pinLogin, ROUTES.resume];

@Injectable({ providedIn: 'root' })
export class HttpAdminAuthGateway extends AdminAuthGateway {
	private readonly http = inject(HttpClient);

	/** Read at call time, not construction: runtime config is filled by an app initializer. */
	private url(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	override currentUser(): Observable<AdminMe | null> {
		return this.http.get<AdminMe>(this.url(ROUTES.me)).pipe(
			// 401 is the ordinary anonymous answer. Any other failure is also treated as
			// "not signed in" — a back-office session we cannot confirm must never render.
			catchError(() => of(null)),
		);
	}

	override ensureCsrfToken(): Observable<void> {
		return this.http.get<{ csrfToken: string }>(this.url(ROUTES.csrf)).pipe(map(() => undefined));
	}

	override loginWithPassword(input: AdminPasswordLoginInput): Observable<AdminSessionResult> {
		return this.http.post<AdminSessionResult>(this.url(ROUTES.login), input);
	}

	override loginWithPin(input: AdminPinLoginInput): Observable<AdminSessionResult> {
		return this.http.post<AdminSessionResult>(this.url(ROUTES.pinLogin), input);
	}

	override resumeWithPin(pin: string): Observable<AdminSessionResult> {
		return this.http.post<AdminSessionResult>(this.url(ROUTES.resume), { pin });
	}

	override requestPasswordReset(identifier: string): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.passwordForgot), { identifier }).pipe(map(() => undefined));
	}

	override resetPassword(input: AdminPasswordResetInput): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.passwordReset), input);
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
