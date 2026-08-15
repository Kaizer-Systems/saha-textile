import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdminAuthGateway } from './auth-gateway';
import { HttpAdminAuthGateway } from './http-auth.gateway';

/**
 * Agreement between the route table and the credential classification (auth pass 3c).
 *
 * `isCredentialEndpoint` decides which `401`s the transport may recover by rotating the
 * session. Getting it wrong is not a cosmetic bug:
 *
 * - classify **refresh** as recoverable and a failed rotation triggers another rotation —
 *   an infinite loop against the API's reuse detection;
 * - classify **`/me`** as a credential endpoint and a reload after the 15-minute access
 *   window silently signs the operator out even though their refresh cookie is still valid.
 *
 * The URLs are not written here. Each one is captured from the gateway's OWN request through
 * the testing backend and fed back into the classifier, so the two can never drift apart —
 * and no credential path literal appears outside the one HTTP adapter, which
 * `check-browser-auth` enforces.
 */
describe('HttpAdminAuthGateway credential classification', () => {
	let gateway: AdminAuthGateway;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: AdminAuthGateway, useClass: HttpAdminAuthGateway },
			],
		});
		gateway = TestBed.inject(AdminAuthGateway);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
	});

	/** Issues the call, captures the URL the gateway actually used, and closes the request. */
	function urlUsedBy(call: () => void): string {
		call();
		const request = httpMock.expectOne(() => true);
		const url = request.request.url;
		request.flush({});
		return url;
	}

	it('treats its own refresh route as a credential endpoint', () => {
		const url = urlUsedBy(() => gateway.refreshSession().subscribe({ error: () => undefined }));
		// Without this, a failed rotation would trigger another rotation, forever.
		expect(gateway.isCredentialEndpoint(url)).toBe(true);
	});

	it.each([
		['password login', () => gateway.loginWithPassword({ identifier: 'operator', password: 'x'.repeat(12) })],
		['PIN login', () => gateway.loginWithPin({ identifier: 'operator', pin: '135790' })],
		['PIN quick-resume', () => gateway.resumeWithPin('135790')],
		['password quick-resume', () => gateway.resumeWithPassword('x'.repeat(12))],
		['password recovery request', () => gateway.requestPasswordReset('operator')],
		['password reset', () => gateway.resetPassword({ token: 'tok', newPassword: 'x'.repeat(12) })],
		['logout', () => gateway.logout()],
	])('treats %s as a credential endpoint', (_label, call) => {
		const url = urlUsedBy(() => call().subscribe({ error: () => undefined }));
		expect(gateway.isCredentialEndpoint(url)).toBe(true);
	});

	// A 401 here means "no live session for this browser" — precisely the case rotation can
	// still recover on a reload.
	it('does NOT treat the current-user route as a credential endpoint', () => {
		const url = urlUsedBy(() => gateway.currentUser().subscribe());
		expect(gateway.isCredentialEndpoint(url)).toBe(false);
	});

	/**
	 * Security Settings carries a recent-password proof on three of its four calls, so the
	 * intuitive classification is "credential endpoint" — and it is wrong, which is why it is
	 * pinned rather than left to the next reader's intuition.
	 *
	 * A FAILED proof answers `403`, deliberately, so it never enters 401 recovery at all. The
	 * only `401` these routes can still produce is the ordinary lapsed access cookie. Marking
	 * them credential routes would make the interceptor treat that as a lost session and drop
	 * an operator at the login screen halfway through changing a credential — after fifteen
	 * minutes of typing, which is exactly how long a long form takes.
	 */
	it.each([
		['security settings read', () => gateway.securitySettings()],
		['PIN set', () => gateway.setPin({ currentPassword: 'x'.repeat(12), pin: '384917' })],
		['PIN removal', () => gateway.removePin('x'.repeat(12))],
		[
			'password change',
			() => gateway.changePassword({ currentPassword: 'x'.repeat(12), newPassword: 'y'.repeat(12) }),
		],
	])('does NOT treat %s as a credential endpoint', (_label, call) => {
		const url = urlUsedBy(() => call().subscribe({ error: () => undefined }));
		expect(gateway.isCredentialEndpoint(url)).toBe(false);
		// Nor session-establishing: none of them issues a session, and the password change
		// ends every one the operator has.
		expect(gateway.isSessionEstablishingEndpoint(url)).toBe(false);
	});

	/**
	 * Every Security Settings route addresses the admin audience. A storefront path appearing
	 * here would be an audience mistake no other test would catch, because both applications
	 * talk to the same API and a storefront cookie is simply refused rather than misrouted.
	 *
	 * The expected prefix is derived from `/me` — a route this gateway already owns and whose
	 * audience is not in question — rather than written out. Writing it would put an auth path
	 * literal outside the one HTTP adapter, which `check-browser-auth` refuses, and it refused
	 * this test on the first run. Deriving it is also the stronger assertion: the two can only
	 * agree with each other, never with a stale string.
	 */
	it.each([
		['security settings read', () => gateway.securitySettings()],
		['PIN set', () => gateway.setPin({ currentPassword: 'x'.repeat(12), pin: '384917' })],
		['PIN removal', () => gateway.removePin('x'.repeat(12))],
		[
			'password change',
			() => gateway.changePassword({ currentPassword: 'x'.repeat(12), newPassword: 'y'.repeat(12) }),
		],
	])('addresses %s to the same audience as the current-user route', (_label, call) => {
		const mePath = new URL(urlUsedBy(() => gateway.currentUser().subscribe())).pathname;
		const audiencePrefix = mePath.replace(/[^/]+$/, '');
		const path = new URL(urlUsedBy(() => call().subscribe({ error: () => undefined }))).pathname;

		expect(audiencePrefix.length).toBeGreaterThan(1);
		expect(path.startsWith(audiencePrefix)).toBe(true);
	});

	it('does not classify an unrelated business route as a credential endpoint', () => {
		expect(gateway.isCredentialEndpoint('http://localhost:4000/orders')).toBe(false);
		expect(gateway.isCredentialEndpoint('/orders')).toBe(false);
	});

	// Compared against the path, so neither a query string nor the configured API origin can
	// change the answer.
	it('ignores query strings and the configured origin', () => {
		const url = urlUsedBy(() => gateway.refreshSession().subscribe({ error: () => undefined }));
		const path = new URL(url).pathname;

		expect(gateway.isCredentialEndpoint(`${url}?redirect=/dashboard`)).toBe(true);
		expect(gateway.isCredentialEndpoint(path)).toBe(true);
		expect(gateway.isCredentialEndpoint(`https://api.example.test${path}`)).toBe(true);
	});

	const establishingCalls: [string, () => Observable<unknown>][] = [
		['password login', () => gateway.loginWithPassword({ identifier: 'operator', password: 'x'.repeat(12) })],
		['PIN login', () => gateway.loginWithPin({ identifier: 'operator', pin: '135790' })],
		// Resume extends the operator's existing session, so its success proves that session
		// is alive — which is exactly what the latch needs to hear.
		['PIN quick-resume', () => gateway.resumeWithPin('135790')],
		['password quick-resume', () => gateway.resumeWithPassword('x'.repeat(12))],
	];

	const endingCalls: [string, () => Observable<unknown>][] = [
		['logout', () => gateway.logout()],
		['password recovery request', () => gateway.requestPasswordReset('operator')],
		// A reset revokes every admin session and suspends PIN use by design.
		['password reset', () => gateway.resetPassword({ token: 'tok', newPassword: 'x'.repeat(12) })],
	];

	// The latch that stops a failed rotation being re-attempted clears only on proof that a
	// session exists. Logout and password reset are credential endpoints that succeed by
	// ENDING one, so treating their success as proof would un-latch the transport into a
	// pointless rotation per later 401 — the loop the latch exists to prevent.
	it.each(establishingCalls)('treats %s as session-establishing', (_label, call) => {
		const url = urlUsedBy(() => call().subscribe({ error: () => undefined }));
		expect(gateway.isSessionEstablishingEndpoint(url)).toBe(true);
		// Every session-establishing route is also a credential route; the reverse is not true.
		expect(gateway.isCredentialEndpoint(url)).toBe(true);
	});

	it.each(endingCalls)('does NOT treat %s as session-establishing', (_label, call) => {
		const url = urlUsedBy(() => call().subscribe({ error: () => undefined }));
		expect(gateway.isSessionEstablishingEndpoint(url)).toBe(false);
		expect(gateway.isCredentialEndpoint(url)).toBe(true);
	});

	it('does NOT treat its own refresh route as session-establishing', () => {
		// Rotation renews a session that already exists; it proves nothing about a latch that
		// was set because rotation itself failed.
		const url = urlUsedBy(() => gateway.refreshSession().subscribe({ error: () => undefined }));
		expect(gateway.isSessionEstablishingEndpoint(url)).toBe(false);
	});

	// A path that merely CONTAINS a credential route must not be mistaken for one, which a
	// substring check would allow.
	it('matches the whole path, not a prefix or substring', () => {
		const path = new URL(urlUsedBy(() => gateway.refreshSession().subscribe({ error: () => undefined }))).pathname;

		expect(gateway.isCredentialEndpoint(`${path}/extra`)).toBe(false);
		expect(gateway.isCredentialEndpoint(`/tenant${path}`)).toBe(false);
	});
});
