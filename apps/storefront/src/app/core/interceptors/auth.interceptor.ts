import {
	HttpErrorResponse,
	HttpEvent,
	HttpEventType,
	HttpHandler,
	HttpInterceptor,
	HttpRequest,
} from '@angular/common/http';
import { effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Observable, catchError, firstValueFrom, from, switchMap, tap, throwError } from 'rxjs';

import {
	CSRF_HEADER_NAME,
	RefreshCoordinator,
	hasBrowserCookieJar,
	isUnsafeMethod,
	readCsrfToken,
	withBrowserLock,
} from '@saha-textile/http-transport';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { AuthStore } from '@core/state/auth.store';
import { SettingStore } from '@core/state/setting.store';
import { NotificationService } from '@data-access/services/notification.service';

/**
 * Web Locks are scoped per origin, and the name is audience-specific so that an origin ever
 * shared with the admin would not serialise two unrelated sessions against each other.
 */
const SESSION_REFRESH_LOCK = 'saha-textile-storefront-session-refresh';

/**
 * Session transport for storefront API calls.
 *
 * The `Authorization: Bearer` branch that used to live here is gone. It read a token out
 * of client state, and no such token exists any more: the locked model is API-set
 * `httpOnly` cookies the browser cannot read, so what this interceptor does for
 * authentication is send credentials, echo the double-submit CSRF value, and recover a
 * single expired-access `401`.
 *
 * `withCredentials` is unconditional because the API is a different origin in every
 * environment (`localhost:4000` locally), and cookies are not attached cross-origin
 * without it. The API pairs this with an exact CORS allowlist — credentials are never
 * combined with a wildcard origin.
 *
 * The CSRF header is attached only to unsafe methods, matching the API's guard: safe
 * methods pass without it, unsafe methods carrying a session cookie fail closed.
 *
 * The CSRF cookie names, the header name, the safe/unsafe method split and the refresh
 * single-flight coordinator come from `@saha-textile/http-transport`. They are one half of a
 * contract with the API, identical for both audiences. What stays here is storefront policy:
 * maintenance-mode routing and which store to clear.
 *
 * ## 401 recovery (auth pass 3c)
 *
 * A `401` on an ordinary request means the short-lived access cookie lapsed while the
 * refresh cookie is very likely still good. Rather than dropping the user, the request is
 * rotated once and replayed.
 *
 * Six rules make that safe rather than a source of new failure modes:
 *
 * 1. **One rotation per tab, never one per request.** An expired access cookie fails EVERY
 *    in-flight request at once. `RefreshCoordinator` makes the first 401 perform the rotation
 *    and the rest join it, because the API's rotation is atomic and reuse-detecting — a
 *    losing concurrent rotation presents a token that was just rotated away, which is
 *    indistinguishable from theft and revokes the whole refresh family. Racing here would
 *    log the user out for the crime of loading two requests at once.
 * 2. **One rotation across tabs.** The coordinator cannot see the tab next to it, and two
 *    tabs share one cookie jar. `withBrowserLock` closes that window with the Web Locks API,
 *    falling through where it is unavailable. A follower that waits and then rotates again is
 *    fine: the leader has already set a new cookie, so no reuse is detected.
 * 3. **Never on a credential endpoint.** A 401 from login, registration, OTP or recovery
 *    means the credential was refused; rotating would be pointless, and rotating after a
 *    failed rotation would be infinite. The gateway classifies this, because the gateway is
 *    the file that owns route paths.
 * 4. **A missing CSRF cookie is acquired, not treated as defeat.** `st_csrf` is a
 *    browser-session cookie while the refresh cookie persists for up to 30 days, so closing
 *    the browser and returning leaves a valid session with no readable double-submit half.
 *    Rotation would 403, so one is fetched first — the API's CSRF policy exists for this.
 * 5. **The replay re-reads the CSRF cookie.** Rotation replaces `csrfSecretHash` server-side
 *    and issues a new `st_csrf`, so replaying with the header captured before the rotation
 *    would fail closed with a 403 — and read as an auth failure.
 * 6. **One verdict per session.** `latchOnFailure` stops a failed rotation from being retried
 *    on every subsequent 401; a visitor who is simply anonymous pays one recovery attempt,
 *    not one per protected request. It clears only on a response that PROVES a session
 *    exists — not on logout or a password reset, both of which succeed by ending one.
 *
 * Replaying the original request is safe because a 401 is raised by the API's global session
 * guard BEFORE any handler runs, so the first attempt had no effect to duplicate. That is a
 * different question from the transport package's `isRetryable`, which governs retrying
 * TRANSIENT failures and refuses unsafe methods precisely because those may have landed.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
	private router = inject(Router);
	private notificationService = inject(NotificationService);
	private authStore = inject(AuthStore);
	private settingStore = inject(SettingStore);
	private gateway = inject(StorefrontAuthGateway);

	/**
	 * Held on the interceptor because it is a singleton: one coordinator per application is
	 * what makes "one rotation" true. A per-request instance would coordinate nothing.
	 */
	private readonly refresh = new RefreshCoordinator({ latchOnFailure: true });

	public isMaintenanceModeOn: boolean = false;

	constructor() {
		// Only READ settings here (for maintenance mode). App-init data loads live
		// in App: firing an HTTP request from an interceptor constructor triggers a
		// circular HTTP_INTERCEPTORS dependency (the SignalStore rxMethod fires the
		// request synchronously, unlike the old async NGXS dispatch).
		effect(() => {
			this.isMaintenanceModeOn = this.settingStore.setting()?.maintenance?.maintenance_mode!;
		});
	}

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		// If Maintainance Mode On
		if (this.isMaintenanceModeOn) {
			void this.router.navigate(['/maintenance']);
		}

		const isCredentialCall = this.gateway.isCredentialEndpoint(req.url);

		return next.handle(this.prepare(req)).pipe(
			tap((event) => {
				// Proof that a session now exists makes any earlier "session is gone" verdict
				// obsolete. Deliberately narrower than `isCredentialEndpoint`: logout and
				// password reset succeed by ENDING a session, and un-latching on those would
				// buy one pointless rotation on every later 401.
				if (event.type !== HttpEventType.Response) return;
				if (this.gateway.isSessionEstablishingEndpoint(req.url)) this.refresh.reset();
			}),
			catchError((error: HttpErrorResponse) => {
				if (error.status !== 401) return throwError(() => error);

				if (isCredentialCall || !this.canAttemptRefresh()) {
					this.onSessionLost();
					return throwError(() => error);
				}

				return this.rotateAndReplay(req, next, error);
			}),
		);
	}

	/** Applies the transport contract. Called again for the replay so the CSRF value is fresh. */
	private prepare<T>(req: HttpRequest<T>): HttpRequest<T> {
		const prepared = req.clone({ withCredentials: true });

		const csrfToken = readCsrfToken();
		if (csrfToken && isUnsafeMethod(prepared.method)) {
			return prepared.clone({ setHeaders: { [CSRF_HEADER_NAME]: csrfToken } });
		}
		return prepared;
	}

	private rotateAndReplay<T>(
		req: HttpRequest<T>,
		next: HttpHandler,
		original: HttpErrorResponse,
	): Observable<HttpEvent<T>> {
		return from(this.refresh.run(() => withBrowserLock(SESSION_REFRESH_LOCK, () => this.rotate()))).pipe(
			// Rotation itself failed (or was already known to fail): the session really is
			// gone. Surface the ORIGINAL 401 — the caller asked about their request, not
			// about our recovery attempt.
			catchError(() => {
				this.onSessionLost();
				return throwError(() => original);
			}),
			switchMap(() =>
				next.handle(this.prepare(req)).pipe(
					catchError((retryError: HttpErrorResponse) => {
						// Only a second 401 means the rotation did not actually help. Any
						// other failure is the request's own problem and must not be
						// reported as a lost session.
						if (retryError.status === 401) this.onSessionLost();
						return throwError(() => retryError);
					}),
				),
			),
		);
	}

	/**
	 * The rotation, plus the CSRF acquisition it may need first.
	 *
	 * Rotation is an unsafe, cookie-authenticated POST and cannot succeed without the readable
	 * half of the double-submit pair. Refusing to rotate when that half is absent was wrong:
	 * the API sets `st_csrf` WITHOUT a `maxAge`, making it a browser-session cookie, while the
	 * access and refresh cookies are persistent. Closing the browser and returning therefore
	 * leaves a perfectly valid session with no readable CSRF value — for a storefront customer
	 * whose refresh window is 30 days, that is the normal way they come back — and treating it
	 * as an unrecoverable session logged them out for it. Both calls sit inside the
	 * coordinator, so the acquisition is single-flighted along with the rotation.
	 */
	private async rotate(): Promise<void> {
		if (readCsrfToken() === null) {
			await firstValueFrom(this.gateway.ensureCsrfToken());
		}
		await firstValueFrom(this.gateway.refreshSession());
	}

	/**
	 * Whether recovery is worth attempting at all.
	 *
	 * Only server rendering is excluded, and not because a value is missing: there is no
	 * cookie jar to populate and no user agent to carry the result, so the requests could
	 * never help. An empty jar in a real browser is recoverable — see `rotate()`.
	 */
	private canAttemptRefresh(): boolean {
		return hasBrowserCookieJar();
	}

	private onSessionLost(): void {
		this.notificationService.notification = false;
		this.authStore.authClear();
	}
}
