import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { ForgotPassword } from './forgot-password/forgot-password';
import { Login } from './login/login';
import { Otp } from './otp/otp';
import { UpdatePassword } from './update-password/update-password';

const brandData = () => undefined;
vi.mock('@core/brand/brand.gateway', () => ({
	injectBrandQuery: () => ({ data: brandData }),
}));

const setup = <T>(type: new () => T, token: string | null = 'tok') => {
	const store = {
		error: signal(null),
		pending: signal(false),
		clearError: vi.fn(),
		loginWithPassword: vi.fn(async () => true),
		loginWithPin: vi.fn(async () => true),
		resetPassword: vi.fn(async () => true),
		requestPasswordReset: vi.fn(async () => true),
	};
	const router = { navigateByUrl: vi.fn(async () => true), navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: store },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => token } } } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return { screen: TestBed.createComponent(type).componentInstance, store, router };
};
const strong = 'long-enough-password';

describe('Login', () => {
	it('stops without an identifier or while busy', async () => {
		const { screen, store } = setup(Login);
		await screen.submit();
		screen.form.patchValue({ identifier: 'a', password: 'p' });
		store.pending.set(true);
		await screen.submit();
		expect(store.loginWithPassword).not.toHaveBeenCalled();
	});

	it('needs a password', async () => {
		const { screen, store } = setup(Login);
		screen.form.patchValue({ identifier: 'a' });
		await screen.submit();
		screen.form.patchValue({ password: null });
		await screen.submit();
		expect(store.loginWithPassword).not.toHaveBeenCalled();
	});

	it('signs in with a password and goes to the dashboard', async () => {
		const { screen, store, router } = setup(Login);
		screen.form.patchValue({ identifier: ' a ', password: 'p' });
		await screen.submit();
		expect(store.loginWithPassword).toHaveBeenCalledWith({ identifier: 'a', password: 'p' });
		expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
	});

	it('stays put when refused', async () => {
		const { screen, store, router } = setup(Login);
		store.loginWithPassword.mockResolvedValue(false);
		screen.form.patchValue({ identifier: 'a', password: 'p' });
		await screen.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});

	it('uses the PIN, needing all six digits, and forgets it when switching', async () => {
		const { screen, store } = setup(Login);
		screen.useMethod('pin');
		expect(store.clearError).toHaveBeenCalledOnce();
		screen.form.patchValue({ identifier: 'a' });
		screen.pin.set('123');
		await screen.submit();
		expect(store.loginWithPin).not.toHaveBeenCalled();
		screen.pin.set('123456');
		await screen.submit();
		expect(store.loginWithPin).toHaveBeenCalledWith({ identifier: 'a', pin: '123456' });
		screen.useMethod('password');
		expect(screen.pin()).toBe('');
	});
});

describe('UpdatePassword', () => {
	const filled = (screen: UpdatePassword) => screen.form.patchValue({ newPassword: strong, confirmPassword: strong });

	it('reads the token, defaulting to none', () => {
		expect(setup(UpdatePassword).screen.token()).toBe('tok');
		expect(setup(UpdatePassword, null).screen.token()).toBe('');
	});

	it('flags a mismatch only once something is typed', () => {
		const { screen } = setup(UpdatePassword);
		expect(screen.passwordMismatch).toBe(false);
		screen.form.patchValue({ newPassword: strong, confirmPassword: 'other' });
		expect(screen.passwordMismatch).toBe(true);
	});

	it('shows the password on request', () => {
		const { screen } = setup(UpdatePassword);
		screen.showPassword();
		expect(screen.show).toBe(true);
	});

	it('stops on each thing that is wrong', async () => {
		const noToken = setup(UpdatePassword, null);
		filled(noToken.screen);
		await noToken.screen.submit();
		expect(noToken.store.resetPassword).not.toHaveBeenCalled();
		const invalid = setup(UpdatePassword);
		await invalid.screen.submit();
		expect(invalid.store.resetPassword).not.toHaveBeenCalled();
		const mismatch = setup(UpdatePassword);
		mismatch.screen.form.patchValue({ newPassword: strong, confirmPassword: `${strong}x` });
		await mismatch.screen.submit();
		expect(mismatch.store.resetPassword).not.toHaveBeenCalled();
		const busy = setup(UpdatePassword);
		filled(busy.screen);
		busy.store.pending.set(true);
		await busy.screen.submit();
		expect(busy.store.resetPassword).not.toHaveBeenCalled();
	});

	it('resets and returns to login, or stays on a refused link', async () => {
		const done = setup(UpdatePassword);
		filled(done.screen);
		await done.screen.submit();
		expect(done.router.navigateByUrl).toHaveBeenCalledWith('/auth/login');
		const refused = setup(UpdatePassword);
		refused.store.resetPassword.mockResolvedValue(false);
		filled(refused.screen);
		await refused.screen.submit();
		expect(refused.router.navigateByUrl).not.toHaveBeenCalled();
	});
});

describe('ForgotPassword', () => {
	it('stops on an empty form or while busy', async () => {
		const { screen, store } = setup(ForgotPassword);
		await screen.submit();
		screen.form.patchValue({ identifier: 'a' });
		store.pending.set(true);
		await screen.submit();
		expect(store.requestPasswordReset).not.toHaveBeenCalled();
	});

	it('asks and acknowledges', async () => {
		const { screen, store } = setup(ForgotPassword);
		screen.form.patchValue({ identifier: ' a ' });
		await screen.submit();
		expect(store.requestPasswordReset).toHaveBeenCalledWith('a');
		expect(screen.submitted()).toBe(true);
	});
});

describe('Otp', () => {
	it('stops on a short token', async () => {
		const { screen, router } = setup(Otp);
		screen.form.patchValue({ token: 'short' });
		await screen.submit();
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('hands the token to the reset screen', async () => {
		const { screen, router } = setup(Otp);
		screen.form.patchValue({ token: ' long-enough-token ' });
		await screen.submit();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/update-password'], {
			queryParams: { token: 'long-enough-token' },
		});
	});
});
