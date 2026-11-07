import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

import { Otp } from './otp';
import { ForgotPassword } from '../forgot-password/forgot-password';

const translate = { provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } };

describe('Otp', () => {
	const render = () => {
		const store = {
			error: signal(null),
			pending: signal(false),
			requestLoginOtp: vi.fn(async () => true),
			verifyLoginOtp: vi.fn(async () => true),
		};
		const router = { navigateByUrl: vi.fn(async () => true) };
		const auth: { redirectUrl?: string } = {};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: store },
				{ provide: Router, useValue: router },
				{ provide: AuthService, useValue: auth },
				translate,
			],
		});
		TestBed.overrideComponent(Otp, { set: { imports: [], template: '' } });
		return { page: TestBed.createComponent(Otp).componentInstance, store, router, auth };
	};
	const sent = async () => {
		const parts = render();
		parts.page.form.patchValue({ email: 'a@b.co' });
		await parts.page.submit();
		return parts;
	};

	it('sends nothing for an invalid address or while busy', async () => {
		const { page, store } = render();
		await page.requestCode();
		page.form.patchValue({ email: 'a@b.co' });
		store.pending.set(true);
		await page.requestCode();
		expect(store.requestLoginOtp).not.toHaveBeenCalled();
		expect(page.step()).toBe('request');
	});

	it('always advances after asking', async () => {
		const { page, store } = await sent();
		expect(store.requestLoginOtp).toHaveBeenCalledWith('a@b.co', 'login');
		expect(page.sentTo()).toBe('a@b.co');
		expect(page.step()).toBe('verify');
	});

	it('stops on a short or missing code, or while busy', async () => {
		const { page, store } = await sent();
		page.form.patchValue({ code: '123' });
		await page.submit();
		page.form.patchValue({ code: null });
		await page.submit();
		page.form.patchValue({ code: '123456' });
		store.pending.set(true);
		await page.submit();
		expect(store.verifyLoginOtp).not.toHaveBeenCalled();
	});

	it('stays put on a wrong code', async () => {
		const { page, store, router } = await sent();
		store.verifyLoginOtp.mockResolvedValue(false);
		page.form.patchValue({ code: '123456' });
		await page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});

	it('goes to the dashboard, or to where the guard stopped them', async () => {
		const first = await sent();
		first.page.form.patchValue({ code: '123456' });
		await first.page.submit();
		expect(first.store.verifyLoginOtp).toHaveBeenCalledWith({ identifier: 'a@b.co', code: '123456' });
		expect(first.router.navigateByUrl).toHaveBeenCalledWith('/account/dashboard');
		const second = await sent();
		second.auth.redirectUrl = '/checkout';
		second.page.form.patchValue({ code: '123456' });
		await second.page.submit();
		expect(second.router.navigateByUrl).toHaveBeenCalledWith('/checkout');
		expect(second.auth.redirectUrl).toBeUndefined();
	});
});

describe('ForgotPassword', () => {
	const render = () => {
		const store = { pending: signal(false), requestPasswordReset: vi.fn(async () => true) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: AuthStore, useValue: store }, translate] });
		TestBed.overrideComponent(ForgotPassword, { set: { imports: [], template: '' } });
		return { page: TestBed.createComponent(ForgotPassword).componentInstance, store };
	};

	it('asks with the trimmed address and acknowledges', async () => {
		const { page, store } = render();
		page.form.patchValue({ email: 'a@b.co' });
		page.selectChannel('email');
		await page.submit();
		expect(store.requestPasswordReset).toHaveBeenCalledWith('a@b.co');
		expect(page.submitted()).toBe(true);
	});

	it('sends nothing for an invalid identifier or while busy', async () => {
		const { page, store } = render();
		await page.submit();
		page.form.patchValue({ email: 'a@b.co' });
		store.pending.set(true);
		await page.submit();
		expect(store.requestPasswordReset).not.toHaveBeenCalled();
		expect(page.submitted()).toBe(false);
	});

	it('accepts a phone number in E.164', async () => {
		const { page, store } = render();
		page.form.patchValue({ phone: '9000000000', country_code: '971' });
		page.selectChannel('phone');
		expect(page.form.controls['email']?.errors).toBeNull();
		await page.submit();
		expect(store.requestPasswordReset).toHaveBeenCalledWith('+9719000000000');
	});

	it('asks for the corrected address on a second attempt', async () => {
		const { page, store } = render();
		page.form.patchValue({ email: 'wrong@b.co' });
		await page.submit();
		page.form.patchValue({ email: 'right@b.co' });
		await page.submit();
		expect(store.requestPasswordReset).toHaveBeenLastCalledWith('right@b.co');
	});

	it('falls back to India and to empty text', () => {
		const { page } = render();
		page.form.patchValue({ email: null, phone: null, country_code: null });
		expect(page.identifier()).toBe('');
		page.selectChannel('phone');
		expect(page.identifier()).toBe('+91');
	});
});
