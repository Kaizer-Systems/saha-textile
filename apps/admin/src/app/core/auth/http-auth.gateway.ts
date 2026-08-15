import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	AdminAuthGateway,
	type AdminMe,
	type AdminPasswordChangeInput,
	type AdminPasswordResetInput,
	type AdminPasswordLoginInput,
	type AdminPinLoginInput,
	type AdminPinSetupInput,
	type AdminInviteInput,
	type AdminSecurityState,
	type AdminSessionResult,
	type AdminSessionSummary,
	type AdminUser,
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
	security: '/auth/admin/security',
	pin: '/auth/admin/pin',
	pinRemove: '/auth/admin/pin/remove',
	passwordChange: '/auth/admin/password/change',
	profile: '/auth/admin/profile',
	sessions: '/auth/admin/sessions',
	revokeOthers: '/auth/admin/sessions/revoke-others',
	invites: '/auth/admin/invites',
} as const;

/**
 * Routes where a `401` means the submitted credential was refused, not that the session
 * lapsed — so the transport must not try to rotate and retry.
 *
 * `me` is absent on purpose: a 401 there is precisely the recoverable case. `csrf` is absent
 * because it is shared, public and cannot 401. `resume` IS listed: a wrong PIN at the soft
 * lock is a refused credential, and rotating the access cookie would neither help nor be
 * an answer to the presence question the overlay is asking.
 *
 * The four Security Settings routes are absent, and that is a decision rather than an
 * omission. They carry a recent-password proof, so listing them looks right — but a FAILED
 * proof answers `403` there, not `401`, precisely so it never enters 401 recovery. What
 * remains of a `401` from one of them is the ordinary lapsed access cookie, which rotation
 * should recover: an operator halfway through a credential change must not be dropped at the
 * login screen because fifteen minutes passed while they typed.
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

	override resumeWithPassword(password: string): Observable<AdminSessionResult> {
		return this.http.post<AdminSessionResult>(this.url(ROUTES.resume), { password });
	}

	override requestPasswordReset(identifier: string): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.passwordForgot), { identifier }).pipe(map(() => undefined));
	}

	override resetPassword(input: AdminPasswordResetInput): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.passwordReset), input);
	}

	override securitySettings(): Observable<AdminSecurityState> {
		return this.http.get<AdminSecurityState>(this.url(ROUTES.security));
	}

	override listSessions(): Observable<AdminSessionSummary[]> {
		return this.http
			.get<{ items: AdminSessionSummary[] }>(this.url(ROUTES.sessions))
			.pipe(map((body) => body.items));
	}

	override revokeSession(sessionId: string): Observable<void> {
		return this.http.delete<void>(this.url(`${ROUTES.sessions}/${encodeURIComponent(sessionId)}`));
	}

	override revokeOtherSessions(): Observable<{ revoked: number }> {
		return this.http.post<{ revoked: number }>(this.url(ROUTES.revokeOthers), {});
	}

	override updateProfile(input: { displayName: string; phone?: string | null }): Observable<AdminUser> {
		return this.http.patch<AdminUser>(this.url(ROUTES.profile), input);
	}

	override setPin(input: AdminPinSetupInput): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.pin), input);
	}

	/**
	 * A POST rather than a DELETE because it carries the password proof in a body, and a
	 * bodyless DELETE cannot.
	 */
	override removePin(currentPassword: string): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.pinRemove), { currentPassword });
	}

	override changePassword(input: AdminPasswordChangeInput): Observable<void> {
		return this.http.post<void>(this.url(ROUTES.passwordChange), input);
	}

	override createInvite(input: AdminInviteInput): Observable<void> {
		return this.http.post<unknown>(this.url(ROUTES.invites), input).pipe(map(() => undefined));
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
