import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	AdminAuthGateway,
	type AdminMe,
	type AdminSecurityState,
	type AdminSessionResult,
} from '@core/auth/auth-gateway';

import { AuthStore } from './auth.store';

/**
 * Behaviour of the admin session facade after the fake token and its `localStorage`
 * persistence were removed.
 *
 * The storage assertion matters most here: the admin store was the one that wrote a
 * credential-shaped value into browser storage, where any script on the page could read
 * it. Every case below fails against the previous implementation.
 */
const ME: AdminMe = {
	user: {
		id: 'user_admin',
		email: 'operator@example.com',
		emailVerified: true,
		username: 'operator',
		role: 'admin',
		status: 'active',
		pinConfigured: true,
		preferredLoginMethod: 'pin',
		lastLoginAt: null,
	},
	permissions: ['catalog.product.view'],
	session: {
		audience: 'admin',
		expiresAt: '2026-08-02T10:15:00.000Z',
		refreshExpiresAt: '2026-08-02T22:00:00.000Z',
	},
};

const SESSION: AdminSessionResult = {
	user: { id: ME.user.id, email: ME.user.email, role: 'admin', status: 'active' },
	session: ME.session,
};

class FakeGateway extends AdminAuthGateway {
	me: AdminMe | null = null;
	accept = true;

	override currentUser(): Observable<AdminMe | null> {
		return of(this.me);
	}
	override ensureCsrfToken(): Observable<void> {
		return of(undefined);
	}
	override loginWithPassword(): Observable<AdminSessionResult> {
		return this.accept ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override loginWithPin(): Observable<AdminSessionResult> {
		return this.accept ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override resumeWithPin(): Observable<AdminSessionResult> {
		return this.accept ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override resumeWithPassword(): Observable<AdminSessionResult> {
		return this.accept ? of(SESSION) : throwError(() => new Error('rejected'));
	}
	override requestPasswordReset(): Observable<void> {
		return this.accept ? of(undefined) : throwError(() => new Error('rejected'));
	}
	override resetPassword(): Observable<void> {
		return this.accept ? of(undefined) : throwError(() => new Error('rejected'));
	}
	override securitySettings(): Observable<AdminSecurityState> {
		return of({
			hasPin: true,
			preferredLoginMethod: 'pin',
			pinLockedUntil: null,
			pinRevalidationRequiredAt: null,
			emailVerified: true,
			activeSessions: 1,
		});
	}
	override listSessions() {
		return of([]);
	}
	override revokeSession() {
		return of(undefined);
	}
	override revokeOtherSessions() {
		return of({ revoked: 0 });
	}
	override updateProfile() {
		return of(ME.user);
	}
	override setPin(): Observable<void> {
		return of(undefined);
	}
	override removePin(): Observable<void> {
		return of(undefined);
	}
	override changePassword(): Observable<void> {
		return of(undefined);
	}
	override createInvite(): Observable<void> {
		return of(undefined);
	}
	override logout(): Observable<void> {
		return of(undefined);
	}
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

describe('admin AuthStore', () => {
	let gateway: FakeGateway;
	let navigate: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		gateway = new FakeGateway();
		navigate = vi.fn();
		localStorage.clear();
		sessionStorage.clear();

		TestBed.configureTestingModule({
			providers: [
				{ provide: AdminAuthGateway, useValue: gateway },
				{ provide: Router, useValue: { navigate } },
			],
		});
	});

	it('starts unresolved rather than authenticated', () => {
		const store = TestBed.inject(AuthStore);
		// The old store answered `true` here, rendering the whole back office unauthenticated.
		expect(store.isAuthenticated()).toBe(false);
		expect(store.isResolving()).toBe(true);
		expect(store.permissions()).toEqual([]);
	});

	it('resolves to anonymous when the API reports no session', async () => {
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		expect(store.isAuthenticated()).toBe(false);
		expect(store.isResolving()).toBe(false);
	});

	it('adopts server-authoritative permissions from /me', async () => {
		gateway.me = ME;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		expect(store.isAuthenticated()).toBe(true);
		expect(store.permissions()).toEqual(['catalog.product.view']);
		expect(store.preferredLoginMethod()).toBe('pin');
	});

	it('rejects a password login the API refuses', async () => {
		gateway.accept = false;
		const store = TestBed.inject(AuthStore);

		const signedIn = await store.loginWithPassword({ identifier: 'operator', password: 'wrong-password' });

		expect(signedIn).toBe(false);
		expect(store.isAuthenticated()).toBe(false);
		expect(store.error()).toBe('invalid_credentials');
	});

	it('reports the same failure for a refused PIN as for a refused password', async () => {
		gateway.accept = false;
		const store = TestBed.inject(AuthStore);

		await store.loginWithPin({ identifier: 'operator', pin: '135790' });

		// Identical by design: the message must not reveal which method is configured.
		expect(store.error()).toBe('invalid_credentials');
	});

	it('authenticates only after /me confirms the session', async () => {
		const store = TestBed.inject(AuthStore);
		// The login call succeeds but /me still answers anonymous — a session the server
		// will not confirm must not render as one.
		const signedIn = await store.loginWithPassword({ identifier: 'operator', password: 'a-real-password' });

		expect(signedIn).toBe(false);
		expect(store.isAuthenticated()).toBe(false);
	});

	it('re-reads the session on quick-resume so stale authority cannot survive the soft lock', async () => {
		gateway.me = ME;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		// Role or permissions may have changed, or the session revoked, while the overlay
		// was up; resume must reflect that rather than restore the cached state.
		gateway.me = { ...ME, permissions: [] };
		const resumed = await store.resumeWithPin('135790');

		expect(resumed).toBe(true);
		expect(store.permissions()).toEqual([]);
	});

	it('clears the session when resume cannot rotate cookies (idle already dead)', async () => {
		gateway.me = ME;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();
		expect(store.isAuthenticated()).toBe(true);

		gateway.refreshSession = () => throwError(() => new Error('session expired'));
		const resumed = await store.resumeWithPin('135790');

		expect(resumed).toBe(false);
		expect(store.isAuthenticated()).toBe(false);
	});

	it('signs out locally and returns to login', async () => {
		gateway.me = ME;
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();

		await store.logout();

		expect(store.isAuthenticated()).toBe(false);
		expect(navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('writes nothing to browser storage across a full session lifecycle', async () => {
		gateway.me = ME;
		const store = TestBed.inject(AuthStore);

		await store.bootstrap();
		await store.loginWithPassword({ identifier: 'operator', password: 'a-real-password' });
		await store.logout();

		// The previous store persisted its entire state — including the token — right here.
		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
	});
});

describe('admin password recovery', () => {
	function store(gateway: FakeGateway) {
		TestBed.configureTestingModule({
			providers: [
				{ provide: AdminAuthGateway, useValue: gateway },
				{ provide: Router, useValue: { navigate: vi.fn() } },
			],
		});
		return TestBed.inject(AuthStore);
	}

	it('never authenticates from a recovery request', async () => {
		const gateway = new FakeGateway();
		const auth = store(gateway);

		await auth.requestPasswordReset('operator');

		// Recovery issues an emailed token, never a session. If this ever flipped, the
		// endpoint would have become the OTP login the owner ruled out.
		expect(auth.isAuthenticated()).toBe(false);
		expect(auth.error()).toBeNull();
	});

	it('signs the browser out after a successful reset', async () => {
		const gateway = new FakeGateway();
		gateway.me = ME;
		const auth = store(gateway);
		await auth.bootstrap();
		expect(auth.isAuthenticated()).toBe(true);

		const reset = await auth.resetPassword({ token: 'tok', newPassword: 'a-long-enough-password' });

		// The server revoked every admin session; local state must not keep claiming one.
		expect(reset).toBe(true);
		expect(auth.isAuthenticated()).toBe(false);
		expect(auth.permissions()).toEqual([]);
	});

	it('reports an invalid or expired reset link without guessing which', async () => {
		const gateway = new FakeGateway();
		gateway.accept = false;
		const auth = store(gateway);

		const reset = await auth.resetPassword({ token: 'stale', newPassword: 'a-long-enough-password' });

		expect(reset).toBe(false);
		expect(auth.error()).toBe('invalid_or_expired_reset_link');
	});
});
