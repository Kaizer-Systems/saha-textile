import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AuthSessionResult, type AuthUser, StorefrontAuthGateway } from '@core/auth/auth-gateway';

import { AccountStore } from './account.store';
import { AuthStore } from './auth.store';

/**
 * Behaviour of the session facade after the fake token was removed.
 *
 * The point of these cases is that the store can no longer claim a session the API did not
 * grant. Each one is written so that the previous implementation — which set
 * `access_token` to a constant in `onInit` — would fail it.
 */
const USER: AuthUser = {
	id: 'cus_1',
	email: 'customer@example.com',
	emailVerified: false,
	displayName: 'Customer',
	status: 'active',
};

const SESSION: AuthSessionResult = {
	user: USER,
	session: {
		audience: 'storefront',
		expiresAt: '2026-08-02T10:00:00.000Z',
		refreshExpiresAt: '2026-09-01T10:00:00.000Z',
	},
};

class FakeGateway extends StorefrontAuthGateway {
	me: AuthUser | null = null;
	loginResult: 'ok' | 'fail' = 'ok';
	logoutCalls = 0;

	override currentUser(): Observable<AuthUser | null> {
		return of(this.me);
	}
	override ensureCsrfToken(): Observable<void> {
		return of(undefined);
	}
	override register(): Observable<AuthSessionResult> {
		return this.loginResult === 'ok' ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override loginWithPassword(): Observable<AuthSessionResult> {
		return this.loginResult === 'ok' ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override requestEmailOtp(): Observable<void> {
		return of(undefined);
	}
	override verifyEmailOtp(): Observable<AuthSessionResult> {
		return this.loginResult === 'ok' ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override requestPasswordReset(): Observable<void> {
		return of(undefined);
	}
	override resetPassword(): Observable<void> {
		return this.loginResult === 'ok' ? of(undefined) : throwError(() => new Error('rejected'));
	}
	override activateAccount(): Observable<void> {
		return this.loginResult === 'ok' ? of(undefined) : throwError(() => new Error('rejected'));
	}
	override logout(): Observable<void> {
		this.logoutCalls += 1;
		return of(undefined);
	}
	// Transport-layer concerns. The store never calls either: rotation is the interceptor's
	// recovery path, and the classification exists so it knows which 401s are recoverable.
	override refreshSession(): Observable<void> {
		return of(undefined);
	}
	override isCredentialEndpoint(): boolean {
		return false;
	}
	override isSessionEstablishingEndpoint(): boolean {
		return false;
	}
}

describe('storefront AuthStore', () => {
	let gateway: FakeGateway;
	let navigate: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		gateway = new FakeGateway();
		navigate = vi.fn();
		localStorage.clear();
		sessionStorage.clear();

		TestBed.configureTestingModule({
			providers: [
				{ provide: StorefrontAuthGateway, useValue: gateway },
				{ provide: AccountStore, useValue: { loadUser: vi.fn(), clear: vi.fn() } },
				{ provide: Router, useValue: { navigate } },
			],
		});
	});

	it('starts unresolved rather than authenticated', () => {
		const store = TestBed.inject(AuthStore);
		// The old store answered `true` here with nobody signed in.
		expect(store.isAuthenticated()).toBe(false);
		expect(store.isResolving()).toBe(true);
		expect(store.user()).toBeNull();
	});

	it('resolves to anonymous when the API reports no session', async () => {
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		expect(store.isAuthenticated()).toBe(false);
		// Distinct from the initial state: the API answered, and the answer was "no".
		expect(store.isResolving()).toBe(false);
	});

	it('resolves to authenticated from a cookie session', async () => {
		gateway.me = USER;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		expect(store.isAuthenticated()).toBe(true);
		expect(store.user()?.email).toBe('customer@example.com');
	});

	it('does not authenticate when the API rejects the credentials', async () => {
		gateway.loginResult = 'fail';
		const store = TestBed.inject(AuthStore);

		const signedIn = await store.loginWithPassword({ email: 'a@b.com', password: 'wrong-password' });

		expect(signedIn).toBe(false);
		expect(store.isAuthenticated()).toBe(false);
		// A translation key, never a server-supplied sentence.
		expect(store.error()).toBe('sign_in_failed');
	});

	it('authenticates only after the API confirms', async () => {
		const store = TestBed.inject(AuthStore);
		const signedIn = await store.loginWithPassword({ email: 'a@b.com', password: 'correct-password' });

		expect(signedIn).toBe(true);
		expect(store.isAuthenticated()).toBe(true);
		expect(store.error()).toBeNull();
	});

	it('drops the session locally after a password reset', async () => {
		gateway.me = USER;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();
		expect(store.isAuthenticated()).toBe(true);

		// The API revokes every session for the account, including this browser's.
		await store.resetPassword({ token: 'reset-token', newPassword: 'a-very-long-password' });
		expect(store.isAuthenticated()).toBe(false);
	});

	it('clears local state even when the logout call fails', async () => {
		gateway.me = USER;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		vi.spyOn(gateway, 'logout').mockReturnValue(throwError(() => new Error('network')));
		await store.logout();

		// Leaving the UI signed-in after the user asked to leave is the worse outcome.
		expect(store.isAuthenticated()).toBe(false);
		expect(navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('writes nothing to browser storage across a full session lifecycle', async () => {
		gateway.me = USER;
		const store = TestBed.inject(AuthStore);

		await store.bootstrap();
		await store.loginWithPassword({ email: 'a@b.com', password: 'correct-password' });
		await store.logout();

		// The credential lives in httpOnly cookies; nothing about it may be readable here.
		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
	});
});
