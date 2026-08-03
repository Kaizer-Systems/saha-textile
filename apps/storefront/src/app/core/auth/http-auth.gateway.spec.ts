import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StorefrontAuthGateway } from './auth-gateway';
import { HttpStorefrontAuthGateway } from './http-auth.gateway';

/**
 * Agreement between the route table and the credential classification (auth pass 3c).
 *
 * `isCredentialEndpoint` decides which `401`s the transport may recover by rotating the
 * session. Getting it wrong is not a cosmetic bug:
 *
 * - classify **refresh** as recoverable and a failed rotation triggers another rotation —
 *   an infinite loop against the API's reuse detection;
 * - classify **`/me`** as a credential endpoint and a reload after the access cookie lapses
 *   silently signs the customer out even though their refresh cookie is still valid.
 *
 * The URLs are not written here. Each one is captured from the gateway's OWN request through
 * the testing backend and fed back into the classifier, so the two can never drift apart —
 * and no credential path literal appears outside the one HTTP adapter, which
 * `check-browser-auth` enforces.
 */
describe('HttpStorefrontAuthGateway credential classification', () => {
	let gateway: StorefrontAuthGateway;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: StorefrontAuthGateway, useClass: HttpStorefrontAuthGateway },
			],
		});
		gateway = TestBed.inject(StorefrontAuthGateway);
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

	// Typed explicitly: the methods return differently-shaped observables, and an inferred
	// union of their `subscribe` signatures is not callable.
	const credentialCalls: [string, () => Observable<unknown>][] = [
		['registration', () => gateway.register({ email: 'customer@example.test', password: 'x'.repeat(12) })],
		[
			'password login',
			() => gateway.loginWithPassword({ email: 'customer@example.test', password: 'x'.repeat(12) }),
		],
		['OTP request', () => gateway.requestEmailOtp('customer@example.test', 'login')],
		['OTP verification', () => gateway.verifyEmailOtp({ email: 'customer@example.test', code: '123456' })],
		['password recovery request', () => gateway.requestPasswordReset('customer@example.test')],
		['password reset', () => gateway.resetPassword({ token: 'tok', newPassword: 'x'.repeat(12) })],
		['logout', () => gateway.logout()],
	];

	it.each(credentialCalls)('treats %s as a credential endpoint', (_label, call) => {
		const url = urlUsedBy(() => call().subscribe({ error: () => undefined }));
		expect(gateway.isCredentialEndpoint(url)).toBe(true);
	});

	// A 401 here means "no live session for this browser" — precisely the case rotation can
	// still recover on a reload.
	it('does NOT treat the current-user route as a credential endpoint', () => {
		const url = urlUsedBy(() => gateway.currentUser().subscribe());
		expect(gateway.isCredentialEndpoint(url)).toBe(false);
	});

	it('does not classify an unrelated business route as a credential endpoint', () => {
		expect(gateway.isCredentialEndpoint('http://localhost:4000/catalog/products')).toBe(false);
		expect(gateway.isCredentialEndpoint('/catalog/products')).toBe(false);
	});

	// Compared against the path, so neither a query string nor the configured API origin can
	// change the answer.
	it('ignores query strings and the configured origin', () => {
		const url = urlUsedBy(() => gateway.refreshSession().subscribe({ error: () => undefined }));
		const path = new URL(url).pathname;

		expect(gateway.isCredentialEndpoint(`${url}?redirect=/account`)).toBe(true);
		expect(gateway.isCredentialEndpoint(path)).toBe(true);
		expect(gateway.isCredentialEndpoint(`https://api.example.test${path}`)).toBe(true);
	});

	const establishingCalls: [string, () => Observable<unknown>][] = [
		['registration', () => gateway.register({ email: 'customer@example.test', password: 'x'.repeat(12) })],
		[
			'password login',
			() => gateway.loginWithPassword({ email: 'customer@example.test', password: 'x'.repeat(12) }),
		],
		['OTP verification', () => gateway.verifyEmailOtp({ email: 'customer@example.test', code: '123456' })],
	];

	const endingCalls: [string, () => Observable<unknown>][] = [
		['logout', () => gateway.logout()],
		['password recovery request', () => gateway.requestPasswordReset('customer@example.test')],
		// A reset revokes every session for the account by design.
		['password reset', () => gateway.resetPassword({ token: 'tok', newPassword: 'x'.repeat(12) })],
		// Requesting a code only issues a challenge; verification is what mints the session.
		['OTP request', () => gateway.requestEmailOtp('customer@example.test', 'login')],
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
