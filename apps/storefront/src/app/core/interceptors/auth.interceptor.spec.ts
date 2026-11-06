import { HttpErrorResponse, HttpEvent, HttpHandler, HttpRequest, HttpResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { Observable, Subject, firstValueFrom, map, of, take, tap, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { CsrfTokens } from '@core/auth/csrf-tokens';
import { AuthStore } from '@core/state/auth.store';
import { SettingStore } from '@core/state/setting.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AuthInterceptor } from './auth.interceptor';

/**
 * Behaviour of the storefront session transport: the CSRF contract (pass 3b) and 401 recovery
 * (pass 3c).
 *
 * Written against the observable contract with the API rather than the implementation.
 *
 * URLs here are deliberately ordinary routes. Whether a given path is a credential endpoint
 * is the GATEWAY's judgement — `http-auth.gateway.spec.ts` proves the real classification
 * agrees with the real routes — so this file stubs that answer and tests what the interceptor
 * does with it. It also keeps credential paths out of a file that is not the one HTTP
 * adapter, which `check-browser-auth` enforces and specs are not exempt from.
 */
const CREDENTIAL_URL = '/stub-credential-endpoint';
/** A credential endpoint whose SUCCESS proves a session exists — login, not logout. */
const ESTABLISHING_URL = '/stub-session-establishing-endpoint';
const PROTECTED_URL = '/catalog/products';

/** Captures every forwarded request and lets each attempt be answered independently. */
class StubHandler implements HttpHandler {
	readonly requests: HttpRequest<unknown>[] = [];
	/** Answers attempt `index` (0-based across ALL requests through this handler). */
	responder: (req: HttpRequest<unknown>, index: number) => Observable<HttpEvent<unknown>> = () =>
		of(new HttpResponse({ status: 200 }));

	handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
		const index = this.requests.length;
		this.requests.push(req);
		return this.responder(req, index);
	}

	forwarded(url = PROTECTED_URL): HttpRequest<unknown>[] {
		return this.requests.filter((req) => req.url === url);
	}
}

const unauthorized = () => new HttpErrorResponse({ status: 401 });

describe('storefront AuthInterceptor', () => {
	let handler: StubHandler;
	let interceptor: AuthInterceptor;
	let authClear: ReturnType<typeof vi.fn>;
	let notificationService: { notification: boolean };
	let refreshCalls: number;
	let csrfCalls: number;
	let csrfTokens: CsrfTokens;
	let acquireCsrf: () => Observable<unknown>;
	let refreshResult: (call: number) => Observable<void>;

	beforeEach(() => {
		handler = new StubHandler();
		authClear = vi.fn();
		notificationService = { notification: true };
		refreshCalls = 0;
		csrfCalls = 0;
		refreshResult = () => of(undefined);
		csrfTokens = new CsrfTokens();
		acquireCsrf = () => of(undefined);

		const gateway = {
			isCredentialEndpoint: (url: string) => url === CREDENTIAL_URL || url === ESTABLISHING_URL,
			isSessionEstablishingEndpoint: (url: string) => url === ESTABLISHING_URL,
			ensureCsrfToken: () => {
				csrfCalls += 1;
				return acquireCsrf().pipe(
					take(1),
					tap(() => csrfTokens.remember('acquired-token')),
					map(() => undefined),
				);
			},
			refreshSession: () => {
				refreshCalls += 1;
				return refreshResult(refreshCalls);
			},
		};

		TestBed.configureTestingModule({
			providers: [
				AuthInterceptor,
				{ provide: Router, useValue: { navigate: vi.fn() } },
				{ provide: AuthStore, useValue: { authClear } },
				{ provide: NotificationService, useValue: notificationService },
				{ provide: StorefrontAuthGateway, useValue: gateway },
				{ provide: CsrfTokens, useValue: csrfTokens },
				// The interceptor's constructor reads this through an `effect` to decide
				// maintenance-mode routing; a signal of `null` is the not-yet-loaded state.
				{ provide: SettingStore, useValue: { setting: signal(null) } },
			],
		});
		interceptor = TestBed.inject(AuthInterceptor);
	});

	const run = (method: string, url = PROTECTED_URL) =>
		interceptor.intercept(new HttpRequest(method as 'GET', url, method === 'GET' ? undefined : {}), handler);

	describe('transport contract', () => {
		// Unconditional, because the API is a different origin in every environment and cookies
		// are not attached cross-origin without it.
		it.each(['GET', 'POST'])('sends credentials on a %s', (method) => {
			run(method).subscribe();
			expect(handler.forwarded()[0]?.withCredentials).toBe(true);
		});

		it('echoes the CSRF token on an unsafe method', () => {
			csrfTokens.remember('tok-123');
			run('POST').subscribe();

			expect(handler.forwarded()[0]?.headers.get('x-csrf-token')).toBe('tok-123');
		});

		// The API's guard only requires it on unsafe methods; sending it on a GET would be noise.
		it('does not attach the header on a safe method', () => {
			csrfTokens.remember('tok-123');
			run('GET').subscribe();

			expect(handler.forwarded()[0]?.headers.has('x-csrf-token')).toBe(false);
		});

		it('attaches nothing when no CSRF token is held', () => {
			run('POST').subscribe();

			expect(handler.forwarded()[0]?.headers.has('x-csrf-token')).toBe(false);
			expect(handler.forwarded()[0]?.withCredentials).toBe(true);
		});
	});

	describe('401 recovery', () => {
		beforeEach(() => {
			// A CSRF token is the precondition for rotation: it is an unsafe,
			// cookie-authenticated POST and cannot succeed without the double-submit half.
			csrfTokens.remember('first-token');
		});

		it('rotates once and replays the request, keeping the session', async () => {
			handler.responder = (_req, index) =>
				index === 0 ? throwError(unauthorized) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('GET'));

			expect(refreshCalls).toBe(1);
			// A token was already held, so none needed acquiring first.
			expect(csrfCalls).toBe(0);
			expect(handler.forwarded()).toHaveLength(2);
			expect(authClear).not.toHaveBeenCalled();
		});

		// The headline case. Rotation is atomic and reuse-detecting server-side: a losing
		// concurrent rotation presents a token that was just rotated away, which the API
		// cannot distinguish from theft — it revokes the whole family and signs the customer
		// out. One expired access cookie fails every in-flight request at once, so without
		// single-flight this is the NORMAL case, not an edge case.
		it('performs ONE rotation for concurrent 401s and replays each request', async () => {
			const rotation = new Subject<void>();
			refreshResult = () => rotation.asObservable();
			handler.responder = (req, index) =>
				req.url === PROTECTED_URL && index < 3
					? throwError(unauthorized)
					: of(new HttpResponse({ status: 200 }));

			const inFlight = Promise.all([
				firstValueFrom(run('GET')),
				firstValueFrom(run('GET')),
				firstValueFrom(run('GET')),
			]);

			expect(refreshCalls).toBe(1);

			rotation.next();
			rotation.complete();
			await inFlight;

			expect(refreshCalls).toBe(1);
			// Three originals plus three replays.
			expect(handler.forwarded()).toHaveLength(6);
			expect(authClear).not.toHaveBeenCalled();
		});

		// Rotation replaces `csrfSecretHash` server-side, so the gateway fetches the new token. Replaying
		// with the value captured before the rotation would fail closed with a 403 — and read
		// as an auth failure rather than the stale header it is.
		it('sends the new CSRF token on the replay', async () => {
			refreshResult = () => {
				csrfTokens.remember('rotated-token');
				return of(undefined);
			};
			handler.responder = (_req, index) =>
				index === 0 ? throwError(unauthorized) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('POST'));

			const [first, replay] = handler.forwarded();
			expect(first?.headers.get('x-csrf-token')).toBe('first-token');
			expect(replay?.headers.get('x-csrf-token')).toBe('rotated-token');
		});

		// A 401 from a credential endpoint means the credential was refused. Rotating would be
		// pointless, and rotating after a failed rotation would be infinite.
		it('never rotates for a credential endpoint', async () => {
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('POST', CREDENTIAL_URL))).rejects.toBeInstanceOf(HttpErrorResponse);

			expect(refreshCalls).toBe(0);
			expect(authClear).toHaveBeenCalledOnce();
		});

		it('clears the session and surfaces the original 401 when rotation fails', async () => {
			refreshResult = () => throwError(() => new HttpErrorResponse({ status: 401 }));
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(refreshCalls).toBe(1);
			expect(handler.forwarded()).toHaveLength(1);
			expect(authClear).toHaveBeenCalledOnce();
			expect(notificationService.notification).toBe(false);
		});

		// Loop prevention: one failed rotation is a verdict about the session, not something
		// to re-ask on every subsequent 401. This is what bounds the cost for a visitor who is
		// simply anonymous to a single refresh attempt.
		it('does not retry rotation after it has already failed', async () => {
			refreshResult = () => throwError(() => new HttpErrorResponse({ status: 401 }));
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });
			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });
			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(refreshCalls).toBe(1);
		});

		it('clears the session when the replay is also unauthorized', async () => {
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(refreshCalls).toBe(1);
			expect(handler.forwarded()).toHaveLength(2);
			expect(authClear).toHaveBeenCalledOnce();
		});

		// The replay failing for an unrelated reason says nothing about the session.
		it('does not clear the session when the replay fails for a non-auth reason', async () => {
			handler.responder = (_req, index) =>
				index === 0 ? throwError(unauthorized) : throwError(() => new HttpErrorResponse({ status: 500 }));

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 500 });

			expect(authClear).not.toHaveBeenCalled();
		});
	});

	describe('when the API refuses the CSRF token', () => {
		const csrfRejected = () =>
			new HttpErrorResponse({ status: 403, error: { error: { code: 'forbidden', reason: 'csrf_rejected' } } });
		const forbidden = () => new HttpErrorResponse({ status: 403, error: { error: { code: 'forbidden' } } });

		beforeEach(() => {
			csrfTokens.remember('stale-token');
		});

		// Another tab rotated the session, so this tab's copy is stale. Same recovery as a tab
		// that has only just reloaded and holds no token at all.
		it('fetches a new token and replays with it', async () => {
			handler.responder = (_req, index) =>
				index === 0 ? throwError(csrfRejected) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('POST'));

			const [first, replay] = handler.forwarded();
			expect(first?.headers.get('x-csrf-token')).toBe('stale-token');
			expect(replay?.headers.get('x-csrf-token')).toBe('acquired-token');
			expect(csrfCalls).toBe(1);
			expect(refreshCalls).toBe(0);
		});

		it('fetches once for concurrent refusals', async () => {
			const ready = new Subject<void>();
			acquireCsrf = () => ready;
			handler.responder = (_req, index) =>
				index < 2 ? throwError(csrfRejected) : of(new HttpResponse({ status: 200 }));

			const both = Promise.all([firstValueFrom(run('POST')), firstValueFrom(run('POST'))]);
			ready.next();
			ready.complete();
			await both;

			expect(csrfCalls).toBe(1);
			expect(handler.forwarded()).toHaveLength(4);
		});

		it('retries once, then surfaces the refusal', async () => {
			handler.responder = () => throwError(csrfRejected);

			await expect(firstValueFrom(run('POST'))).rejects.toMatchObject({ status: 403 });

			expect(handler.forwarded()).toHaveLength(2);
			expect(csrfCalls).toBe(1);
		});

		// A permissions 403 may come from a handler that already ran, and would fail again anyway.
		it('never retries a 403 that is not a CSRF refusal', async () => {
			handler.responder = () => throwError(forbidden);

			await expect(firstValueFrom(run('POST'))).rejects.toMatchObject({ status: 403 });

			expect(handler.forwarded()).toHaveLength(1);
			expect(csrfCalls).toBe(0);
		});

		it('surfaces the original refusal when the token cannot be fetched', async () => {
			acquireCsrf = () => throwError(() => new Error('offline'));
			handler.responder = () => throwError(csrfRejected);

			await expect(firstValueFrom(run('POST'))).rejects.toMatchObject({ status: 403 });

			expect(handler.forwarded()).toHaveLength(1);
		});
	});

	describe('when the rotation is refused for its CSRF token', () => {
		// The token lives in memory, so it is gone after a reload while the access and refresh
		// cookies persist. A returning user therefore arrives with a valid session and no token. Acquiring a token BEFORE trying to
		// rotate fixed that, but charged an extra round-trip to every anonymous visitor on
		// first paint. Asking first works because the API's two refusals differ: 403 means the
		// token was missing, 401 means there is no session — asserted end to end in
		// `apps/api/e2e/session-rotation.mjs`.
		it('acquires a token on a 403, then rotates and replays', async () => {
			refreshResult = (call) =>
				call === 1 ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(undefined);
			handler.responder = (_req, index) =>
				index === 0 ? throwError(unauthorized) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('GET'));

			expect(csrfCalls).toBe(1);
			expect(refreshCalls).toBe(2);
			expect(handler.forwarded()).toHaveLength(2);
			expect(authClear).not.toHaveBeenCalled();
		});

		// The saving this ordering exists for: a visitor with no session pays ONE request, not
		// a token fetch for a session they do not have followed by a rotation that cannot work.
		it('does not fetch a token when the refusal is 401', async () => {
			refreshResult = () => throwError(() => new HttpErrorResponse({ status: 401 }));
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(csrfCalls).toBe(0);
			expect(refreshCalls).toBe(1);
			expect(authClear).toHaveBeenCalledOnce();
		});

		it('gives up when the rotation still fails after acquiring a token', async () => {
			refreshResult = () => throwError(() => new HttpErrorResponse({ status: 403 }));
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(csrfCalls).toBe(1);
			expect(refreshCalls).toBe(2);
			expect(authClear).toHaveBeenCalledOnce();
		});

		// Server rendering has no cookie jar to populate and no user agent to carry the
		// result, so recovery there is meaningless rather than merely missing a value. That
		// branch is `hasBrowserCookieJar()`, covered in
		// `packages/http-transport/test/csrf.test.ts`; jsdom always provides a document, so
		// it cannot be reproduced at this level.
	});

	describe('outside a browser', () => {
		afterEach(() => {
			// Restores the prototype accessor jsdom provides.
			Reflect.deleteProperty(document, 'cookie');
		});

		// Proves the interceptor CONSULTS the guard, which nothing else does: jsdom always
		// provides a cookie jar, so removing `canAttemptRefresh()` entirely would leave every
		// other case in this file green. `hasBrowserCookieJar()` keys on `document.cookie`
		// being a string, so shadowing it with a non-string reproduces the branch exactly.
		it('does not attempt recovery when there is no cookie jar', async () => {
			Object.defineProperty(document, 'cookie', { configurable: true, get: () => undefined });
			handler.responder = () => throwError(unauthorized);

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			// No rotation and no CSRF acquisition: under server rendering there is no jar to
			// populate and no user agent to carry the result, so both could only ever fail.
			expect(refreshCalls).toBe(0);
			expect(csrfCalls).toBe(0);
			expect(authClear).toHaveBeenCalledOnce();
		});
	});

	describe('latch lifetime', () => {
		beforeEach(() => {
			csrfTokens.remember('first-token');
			refreshResult = () => throwError(() => new HttpErrorResponse({ status: 401 }));
			handler.responder = (req) =>
				req.url === PROTECTED_URL ? throwError(unauthorized) : of(new HttpResponse({ status: 200 }));
		});

		// Logout succeeds by ENDING a session. Treating its 204 as proof of one would un-latch
		// the transport and buy a pointless rotation on every later 401.
		it('is not cleared by a successful credential call that ends a session', async () => {
			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });
			expect(refreshCalls).toBe(1);

			await firstValueFrom(run('POST', CREDENTIAL_URL));
			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(refreshCalls).toBe(1);
		});

		it('is cleared by a successful call that establishes a session', async () => {
			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });
			expect(refreshCalls).toBe(1);

			await firstValueFrom(run('POST', ESTABLISHING_URL));
			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(refreshCalls).toBe(2);
		});
	});

	describe('cross-tab coordination', () => {
		afterEach(() => {
			Reflect.deleteProperty(globalThis.navigator as object, 'locks');
		});

		// The coordinator cannot see the tab next to it, and two tabs share one cookie jar.
		// Without a lock, both can rotate; the loser presents a token that was just rotated
		// away, which the API reads as theft and answers by revoking the whole family.
		it('rotates while holding the audience-specific cross-tab lock', async () => {
			const held: string[] = [];
			Object.defineProperty(globalThis.navigator, 'locks', {
				configurable: true,
				value: {
					request<T>(name: string, callback: () => Promise<T>): Promise<T> {
						held.push(name);
						return callback();
					},
				},
			});

			csrfTokens.remember('first-token');
			handler.responder = (_req, index) =>
				index === 0 ? throwError(unauthorized) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('GET'));

			expect(held).toEqual(['saha-textile-storefront-session-refresh']);
			expect(refreshCalls).toBe(1);
		});
	});

	/**
	 * Rule 7 (auth pass 4b/4c). A session-bound 401 may name WHY, and two reasons describe
	 * states rotation provably cannot fix — the act that revoked the session invalidated the
	 * refresh token with it. Everything else, including silence, keeps the pre-4b behaviour,
	 * because wrongly skipping a rotation signs out somebody who was recoverable.
	 */
	describe('refusal reasons (rule 7)', () => {
		const refusedWith = (reason: string) =>
			new HttpErrorResponse({
				status: 401,
				error: { error: { code: 'unauthorized', message: 'Authentication is required.', reason } },
			});

		it.each(['session_revoked', 'account_inactive'])('does not rotate after %s', async (reason) => {
			csrfTokens.remember('tok');
			handler.responder = () => throwError(() => refusedWith(reason));

			await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 401 });

			expect(refreshCalls).toBe(0);
			expect(authClear).toHaveBeenCalled();
			expect(handler.forwarded()).toHaveLength(1);
		});

		it.each(['session_expired', 'session_missing', 'permissions_changed'])(
			'still rotates after %s',
			async (reason) => {
				csrfTokens.remember('tok');
				handler.responder = (_req, index) =>
					index === 0 ? throwError(() => refusedWith(reason)) : of(new HttpResponse({ status: 200 }));

				await firstValueFrom(run('GET'));

				expect(refreshCalls).toBe(1);
				expect(handler.forwarded()).toHaveLength(2);
			},
		);

		it('still rotates when the refusal names no reason at all', async () => {
			csrfTokens.remember('tok');
			handler.responder = (_req, index) =>
				index === 0 ? throwError(unauthorized) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('GET'));

			expect(refreshCalls).toBe(1);
		});

		it('still rotates when the reason is one this client does not recognise', async () => {
			csrfTokens.remember('tok');
			handler.responder = (_req, index) =>
				index === 0 ? throwError(() => refusedWith('pin_locked')) : of(new HttpResponse({ status: 200 }));

			await firstValueFrom(run('GET'));

			expect(refreshCalls).toBe(1);
		});
	});

	it('leaves session state alone on a non-401 failure', async () => {
		handler.responder = () => throwError(() => new HttpErrorResponse({ status: 403 }));

		await expect(firstValueFrom(run('GET'))).rejects.toMatchObject({ status: 403 });

		expect(refreshCalls).toBe(0);
		expect(authClear).not.toHaveBeenCalled();
	});
});
