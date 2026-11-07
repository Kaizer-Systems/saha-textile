import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from '@core/auth/auth-gateway';

import { AuthStore } from './auth.store';

const me = { user: { email: 'a@b.co', preferredLoginMethod: 'pin' }, permissions: ['x'] };
const failure = () => throwError(() => new Error('refused'));

const setup = () => {
	const gateway = {
		currentUser: vi.fn(() => of<unknown>(me)),
		ensureCsrfToken: vi.fn(() => of<unknown>(undefined)),
		loginWithPin: vi.fn(() => of<unknown>({})),
		refreshSession: vi.fn(() => of<unknown>(undefined)),
		resumeWithPin: vi.fn(() => of<unknown>({})),
		resumeWithPassword: vi.fn(() => of<unknown>({})),
		requestPasswordReset: vi.fn(() => of<unknown>(undefined)),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminAuthGateway, useValue: gateway },
			{ provide: Router, useValue: { navigate: vi.fn() } },
		],
	});
	return { store: TestBed.inject(AuthStore), gateway };
};

describe('AuthStore edges', () => {
	it('exposes the address and login method, with defaults', async () => {
		const { store } = setup();
		expect(store.email()).toBe('');
		expect(store.preferredLoginMethod()).toBe('password');
		await store.bootstrap();
		expect(store.email()).toBe('a@b.co');
		expect(store.preferredLoginMethod()).toBe('pin');
	});

	it('signs in with a PIN', async () => {
		const { store } = setup();
		await expect(store.loginWithPin({ identifier: 'a', pin: '1234' })).resolves.toBe(true);
		expect(store.isAuthenticated()).toBe(true);
	});

	it('resumes with a password', async () => {
		const { store } = setup();
		await expect(store.resumeWithPassword('p')).resolves.toBe(true);
	});

	it('keeps a live session after a wrong resume proof', async () => {
		const { store, gateway } = setup();
		await store.bootstrap();
		gateway.resumeWithPin.mockReturnValue(failure());
		await expect(store.resumeWithPin('0000')).resolves.toBe(false);
		expect(store.isAuthenticated()).toBe(true);
		expect(store.error()).toBe('invalid_credentials');
	});

	it('goes anonymous after a wrong proof with no session', async () => {
		const { store, gateway } = setup();
		gateway.resumeWithPin.mockReturnValue(failure());
		await expect(store.resumeWithPin('0000')).resolves.toBe(false);
		expect(store.status()).toBe('anonymous');
	});

	it('reports a failed reset request', async () => {
		const { store, gateway } = setup();
		gateway.requestPasswordReset.mockReturnValue(failure());
		await expect(store.requestPasswordReset('a')).resolves.toBe(false);
		expect(store.error()).toBe('something_went_wrong_please_try_again');
		store.clearError();
		expect(store.error()).toBeNull();
	});

	it('clears locally', async () => {
		const { store } = setup();
		await store.bootstrap();
		store.clear();
		expect(store.status()).toBe('anonymous');
	});
});
