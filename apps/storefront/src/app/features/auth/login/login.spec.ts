import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rememberNotifyIntent } from '@core/catalog/notify-intent';
import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

import { Login } from './login';

const render = (platform = 'browser') => {
	const store = {
		error: signal<string | null>(null),
		pending: signal(false),
		requestLoginOtp: vi.fn(async () => undefined),
		loginWithPassword: vi.fn(async () => true),
		verifyLoginOtp: vi.fn(async () => true),
	};
	const http = { post: vi.fn(() => of({})) };
	const router = { navigateByUrl: vi.fn(async () => true) };
	const auth: { redirectUrl?: string } = {};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: store },
			{ provide: HttpClient, useValue: http },
			{ provide: Router, useValue: router },
			{ provide: AuthService, useValue: auth },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('Log in') } },
		],
	});
	TestBed.overrideComponent(Login, { set: { imports: [], template: '' } });
	const login = TestBed.createComponent(Login).componentInstance;
	return { login, store, http, router, auth };
};

afterEach(() => {
	sessionStorage.clear();
	history.replaceState(null, '');
});

describe('Login identifier', () => {
	it('sends the address, or the phone in E.164, and only the active one is required', () => {
		const { login } = render();
		login.form.patchValue({ email: '  a@b.co ' });
		login.channel.set('email');
		expect(login.form.controls['phone']?.valid).toBe(true);

		login.selectChannel('phone');
		expect(login.form.controls['email']?.errors).toBeNull();
		expect(login.form.controls['phone']?.errors).toMatchObject({ required: true });
		login.form.patchValue({ phone: ' 9000000000 ', country_code: '971' });
		expect(login.identifier()).toBe('+9719000000000');
	});

	it('falls back to India and to empty text', () => {
		const { login } = render();
		login.form.patchValue({ email: null, phone: null, country_code: null });
		login.selectChannel('email');
		expect(login.identifier()).toBe('');
		login.selectChannel('phone');
		expect(login.identifier()).toBe('+91');
	});
});

describe('Login arriving from registration', () => {
	it('offers the code for the address Google proved, once', () => {
		history.replaceState({ existingAccountEmail: 'a@b.co', keep: 1 }, '');
		const { login } = render();
		expect(login.method()).toBe('code');
		expect(login.form.value.email).toBe('a@b.co');
		expect(login.existingAccountNotice()).toBe(true);
		expect(history.state).toEqual({ keep: 1 });
	});

	it('ignores state that is not an address, and the server', () => {
		history.replaceState({ existingAccountEmail: 42 }, '');
		expect(render().login.existingAccountNotice()).toBe(false);
		history.replaceState({ existingAccountEmail: 'a@b.co' }, '');
		expect(render('server').login.existingAccountNotice()).toBe(false);
	});
});

describe('Login switching', () => {
	it('drops a half-finished code when the channel or method changes', async () => {
		const { login } = render();
		login.selectMethod('code');
		login.form.patchValue({ email: 'a@b.co', code: '123' });
		await login.requestCode();
		expect(login.codeSent()).toBe(true);
		expect(login.resend.waiting).toBe(true);
		login.selectChannel('phone');
		expect(login.codeSent()).toBe(false);
		expect(login.form.value.code).toBe('');
		expect(login.resend.waiting).toBe(false);
	});

	it('keeps the code when the same choice is pressed again, but clears the notice', async () => {
		const { login } = render();
		login.useCodeFor('a@b.co');
		await login.requestCode();
		login.existingAccountNotice.set(true);
		login.selectMethod('code');
		expect(login.existingAccountNotice()).toBe(false);
		expect(login.codeSent()).toBe(true);
		login.selectMethod('password');
		expect(login.codeSent()).toBe(false);
	});
});

describe('Login.requestCode', () => {
	it('sends nothing for an invalid identifier or while busy', async () => {
		const { login, store } = render();
		await login.requestCode();
		expect(login.form.controls['email']?.touched).toBe(true);
		login.form.patchValue({ email: 'a@b.co' });
		store.pending.set(true);
		await login.requestCode();
		expect(store.requestLoginOtp).not.toHaveBeenCalled();
	});

	it('sends a new code to the corrected phone number', async () => {
		const { login, store } = render();
		login.selectChannel('phone');
		login.form.patchValue({ phone: '9000000000' });
		await login.requestCode();
		login.form.patchValue({ phone: '9111111111' });
		await login.requestCode();
		expect(store.requestLoginOtp).toHaveBeenLastCalledWith('+919111111111', 'login');
	});

	it('always advances, whether or not the account exists', async () => {
		const { login, store } = render();
		login.form.patchValue({ email: 'a@b.co' });
		await login.requestCode();
		expect(store.requestLoginOtp).toHaveBeenCalledWith('a@b.co', 'login');
		expect(login.codeSent()).toBe(true);
	});
});

describe('Login.submit with a password', () => {
	const filled = () => {
		const parts = render();
		parts.login.form.patchValue({ email: 'a@b.co', password: 'secret-value' });
		return parts;
	};

	it('stops on a missing identifier, a missing password or a busy store', async () => {
		const { login, store } = render();
		await login.submit();
		login.form.patchValue({ email: 'a@b.co' });
		await login.submit();
		login.form.patchValue({ password: 'secret-value' });
		store.pending.set(true);
		await login.submit();
		expect(store.loginWithPassword).not.toHaveBeenCalled();
	});

	it('sends the corrected address after a refused attempt', async () => {
		const { login, store } = filled();
		store.loginWithPassword.mockResolvedValueOnce(false);
		await login.submit();
		login.form.patchValue({ email: 'right@b.co' });
		await login.submit();
		expect(store.loginWithPassword).toHaveBeenLastCalledWith(expect.objectContaining({ identifier: 'right@b.co' }));
	});

	it('stays put when the API refuses', async () => {
		const { login, store, router } = filled();
		store.loginWithPassword.mockResolvedValue(false);
		await login.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});

	it('carries remember-me and goes to the dashboard by default', async () => {
		const { login, store, router } = filled();
		login.rememberMe.setValue(true);
		await login.submit();
		expect(store.loginWithPassword).toHaveBeenCalledWith({
			identifier: 'a@b.co',
			password: 'secret-value',
			rememberMe: true,
		});
		expect(router.navigateByUrl).toHaveBeenCalledWith('/account/dashboard');
	});

	it('returns to where the guard stopped them, once', async () => {
		const { login, router, auth } = filled();
		auth.redirectUrl = '/checkout';
		await login.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/checkout');
		expect(auth.redirectUrl).toBeUndefined();
	});

	it('finishes a pending stock alert after signing in', async () => {
		const { login, http } = filled();
		rememberNotifyIntent(sessionStorage, 'red saree', 'SKU-1');
		await login.submit();
		expect(http.post).toHaveBeenCalledWith(
			expect.stringContaining('/catalog/products/red%20saree/stock-alerts'),
			{ variantSku: 'SKU-1' },
			{ withCredentials: true },
		);
		expect(sessionStorage.getItem('st_notify_intent')).toBeNull();
	});
});

describe('Login.submit with a code', () => {
	const sent = async () => {
		const parts = render();
		parts.login.selectMethod('code');
		parts.login.form.patchValue({ email: 'a@b.co' });
		await parts.login.submit();
		return parts;
	};

	it('sends the code first, then verifies it', async () => {
		const { login, store, router } = await sent();
		expect(store.requestLoginOtp).toHaveBeenCalledOnce();
		login.form.patchValue({ code: '123456' });
		await login.submit();
		expect(store.verifyLoginOtp).toHaveBeenCalledWith({
			identifier: 'a@b.co',
			code: '123456',
			rememberMe: false,
		});
		expect(router.navigateByUrl).toHaveBeenCalled();
	});

	it('stops on a short or missing code, or while busy', async () => {
		const { login, store } = await sent();
		login.form.patchValue({ code: '123' });
		await login.submit();
		login.form.patchValue({ code: null });
		await login.submit();
		login.form.patchValue({ code: '123456' });
		store.pending.set(true);
		await login.submit();
		expect(store.verifyLoginOtp).not.toHaveBeenCalled();
	});

	it('stays put on a wrong code', async () => {
		const { login, store, router } = await sent();
		store.verifyLoginOtp.mockResolvedValue(false);
		login.form.patchValue({ code: '123456' });
		await login.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});
