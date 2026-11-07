import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';

import { AccountStore } from './account.store';
import { AuthStore } from './auth.store';

const user = { id: 'c1', email: 'a@b.co' };
const session = of({ user });
const refusal = throwError(() => ({ error: { code: 'SIGNUP_EXPIRED' } }));
const failure = throwError(() => new Error('offline'));

const setup = () => {
	const gateway = {
		currentUser: vi.fn(() => of<unknown>(null)),
		ensureCsrfToken: vi.fn(() => of<unknown>(undefined)),
		loginWithPassword: vi.fn(() => session),
		finaliseSignup: vi.fn(() => session),
		signInFromSignup: vi.fn(() => session),
		requestLoginOtp: vi.fn(() => of<unknown>(undefined)),
		verifyLoginOtp: vi.fn(() => session),
		requestPasswordReset: vi.fn(() => of<unknown>(undefined)),
		resetPassword: vi.fn(() => of<unknown>(undefined)),
		activateAccount: vi.fn(() => of<unknown>(undefined)),
		logout: vi.fn(() => of<unknown>(undefined)),
	};
	const account = { loadUser: vi.fn(), clear: vi.fn() };
	const router = { navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: AccountStore, useValue: account },
			{ provide: Router, useValue: router },
		],
	});
	return { store: TestBed.inject(AuthStore), gateway, account, router };
};

describe('AuthStore.bootstrap', () => {
	it('starts undetermined, then settles on anonymous', async () => {
		const { store, account } = setup();
		expect(store.isResolving()).toBe(true);
		expect(store.email()).toBe('');
		await store.bootstrap();
		expect(store.status()).toBe('anonymous');
		expect(account.loadUser).not.toHaveBeenCalled();
	});

	it('adopts the session the cookie proves and loads the account', async () => {
		const { store, gateway, account } = setup();
		gateway.currentUser.mockReturnValue(of(user));
		await store.bootstrap();
		expect(store.isAuthenticated()).toBe(true);
		expect(store.email()).toBe('a@b.co');
		expect(account.loadUser).toHaveBeenCalledOnce();
	});

	it('does not block rendering when the CSRF fetch fails', async () => {
		const { store, gateway } = setup();
		gateway.ensureCsrfToken.mockReturnValue(failure);
		await expect(store.bootstrap()).resolves.toBeUndefined();
		expect(store.status()).toBe('anonymous');
	});
});

describe('AuthStore sign-in methods', () => {
	const signIns = [
		['loginWithPassword', { identifier: 'a@b.co', password: 'x' }],
		['finaliseSignup', 'pass'],
		['signInFromSignup', 'email'],
		['verifyLoginOtp', { identifier: 'a@b.co', code: '123456' }],
	] as const;

	it.each(signIns)('%s signs in, loads the account and fetches the CSRF token', async (method, input) => {
		const { store, gateway, account } = setup();
		const call = store[method] as (value: unknown) => Promise<boolean>;
		await expect(call(input)).resolves.toBe(true);
		expect(store.user()).toEqual(user);
		expect(store.pending()).toBe(false);
		expect(account.loadUser).toHaveBeenCalledOnce();
		expect(gateway.ensureCsrfToken).toHaveBeenCalledOnce();
	});

	it('answers one fixed key for a refused password or code', async () => {
		const { store, gateway } = setup();
		gateway.loginWithPassword.mockReturnValue(failure as never);
		await expect(store.loginWithPassword({ identifier: 'a', password: 'b' })).resolves.toBe(false);
		expect(store.error()).toBe('sign_in_failed');
		gateway.verifyLoginOtp.mockReturnValue(failure as never);
		await expect(store.verifyLoginOtp({ identifier: 'a', code: '1' })).resolves.toBe(false);
		expect(store.error()).toBe('invalid_or_expired_code');
		expect(store.status()).toBe('anonymous');
	});

	it('keeps the stable refusal code from signup, or the generic key', async () => {
		const { store, gateway } = setup();
		gateway.finaliseSignup.mockReturnValue(refusal as never);
		await expect(store.finaliseSignup()).resolves.toBe(false);
		expect(store.error()).toBe('SIGNUP_EXPIRED');
		gateway.signInFromSignup.mockReturnValue(failure as never);
		await expect(store.signInFromSignup('phone')).resolves.toBe(false);
		expect(store.error()).toBe('registration_failed');
	});

	it('adopts a session a provider token minted', async () => {
		const { store, gateway, account } = setup();
		await store.adoptSocialSession(user as never);
		expect(store.isAuthenticated()).toBe(true);
		expect(account.loadUser).toHaveBeenCalledOnce();
		expect(gateway.ensureCsrfToken).toHaveBeenCalledOnce();
	});
});

describe('AuthStore requests', () => {
	it('sends a login code, defaulting to the login purpose', async () => {
		const { store, gateway } = setup();
		await expect(store.requestLoginOtp('a@b.co')).resolves.toBe(true);
		expect(gateway.requestLoginOtp).toHaveBeenCalledWith('a@b.co', 'login');
		expect(store.pending()).toBe(false);
	});

	it('reports a generic failure for a code or reset request', async () => {
		const { store, gateway } = setup();
		gateway.requestLoginOtp.mockReturnValue(failure as never);
		await expect(store.requestLoginOtp('a@b.co', 'register')).resolves.toBe(false);
		expect(store.error()).toBe('something_went_wrong_please_try_again');
		store.clearError();
		expect(store.error()).toBeNull();
		gateway.requestPasswordReset.mockReturnValue(failure as never);
		await expect(store.requestPasswordReset('a@b.co')).resolves.toBe(false);
		expect(store.error()).toBe('something_went_wrong_please_try_again');
	});

	it('requests a reset', async () => {
		const { store } = setup();
		await expect(store.requestPasswordReset('a@b.co')).resolves.toBe(true);
		expect(store.pending()).toBe(false);
	});

	it.each(['resetPassword', 'activateAccount'] as const)('%s leaves the browser signed out', async (method) => {
		const { store, gateway } = setup();
		gateway.currentUser.mockReturnValue(of(user));
		await store.bootstrap();
		await expect(store[method]({ token: 't', newPassword: 'p' })).resolves.toBe(true);
		expect(store.status()).toBe('anonymous');
	});

	it.each(['resetPassword', 'activateAccount'] as const)('%s reports an expired link', async (method) => {
		const { store, gateway } = setup();
		gateway[method].mockReturnValue(failure as never);
		await expect(store[method]({ token: 't', newPassword: 'p' })).resolves.toBe(false);
		expect(store.error()).toBe('invalid_or_expired_reset_link');
		expect(store.pending()).toBe(false);
	});
});

describe('AuthStore leaving', () => {
	it('clears locally and goes to the login page, even when the API call fails', async () => {
		const { store, gateway, account, router } = setup();
		gateway.currentUser.mockReturnValue(of(user));
		await store.bootstrap();
		gateway.logout.mockReturnValue(failure as never);
		await expect(store.logout()).resolves.toBeUndefined();
		expect(store.status()).toBe('anonymous');
		expect(account.clear).toHaveBeenCalledOnce();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('logs out cleanly', async () => {
		const { store, gateway } = setup();
		await store.logout();
		expect(gateway.logout).toHaveBeenCalledOnce();
	});

	it('drops local state when the API reports the session is gone', async () => {
		const { store, gateway, account, router } = setup();
		gateway.currentUser.mockReturnValue(of(user));
		await store.bootstrap();
		store.authClear();
		expect(store.user()).toBeNull();
		expect(account.clear).toHaveBeenCalledOnce();
		expect(router.navigate).not.toHaveBeenCalled();
	});
});
