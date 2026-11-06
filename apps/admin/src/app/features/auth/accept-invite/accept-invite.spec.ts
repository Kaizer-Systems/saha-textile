import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { AcceptInvite } from './accept-invite';

const password = 'long-enough-password';

const render = (token: string | null = 't1') => {
	const gateway = { acceptInvite: vi.fn(() => of<unknown>({})) };
	const router = { navigateByUrl: vi.fn(async () => true) };
	const notification = { showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminAuthGateway, useValue: gateway },
			{ provide: Router, useValue: router },
			{ provide: NotificationService, useValue: notification },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => token } } } },
		],
	});
	TestBed.overrideComponent(AcceptInvite, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(AcceptInvite).componentInstance;
	return { page, gateway, router, notification };
};
const filled = (token?: string | null) => {
	const parts = render(token);
	parts.page.form.patchValue({ newPassword: password, confirmPassword: password });
	return parts;
};
const refused = (status: number, error: unknown) => throwError(() => new HttpErrorResponse({ status, error }));

describe('AcceptInvite', () => {
	it('reads its token, and treats a missing one as empty', () => {
		expect(render().page.token()).toBe('t1');
		expect(render(null).page.token()).toBe('');
	});

	it('toggles the password view', () => {
		const { page } = render();
		page.showPassword();
		expect(page.show).toBe(true);
	});

	it('compares the passwords once the second is typed', () => {
		const { page } = render();
		page.form.patchValue({ newPassword: password, confirmPassword: '' });
		expect(page.passwordMismatch).toBe(false);
		page.form.patchValue({ confirmPassword: 'other' });
		expect(page.passwordMismatch).toBe(true);
		page.form.patchValue({ confirmPassword: password });
		expect(page.passwordMismatch).toBe(false);
	});

	it('compares complete PINs only', () => {
		const { page } = render();
		page.pin.set('123456');
		page.confirmPin.set('12');
		expect(page.pinMismatch()).toBe(false);
		page.confirmPin.set('654321');
		expect(page.pinMismatch()).toBe(true);
		page.pin.set('1');
		expect(page.pinMismatch()).toBe(false);
	});

	it.each([
		['no token', () => filled('')],
		['an invalid form', () => render()],
		[
			'different passwords',
			() => {
				const parts = filled();
				parts.page.form.patchValue({ confirmPassword: 'different-password' });
				return parts;
			},
		],
		[
			'a save in progress',
			() => {
				const parts = filled();
				parts.page.pending.set(true);
				return parts;
			},
		],
	])('stops with %s', async (_name, build) => {
		const { page, gateway } = build();
		await page.submit();
		expect(gateway.acceptInvite).not.toHaveBeenCalled();
	});

	it('refuses a part-typed PIN', async () => {
		const { page, gateway } = filled();
		page.pin.set('123');
		await page.submit();
		expect(page.error()).toBe('pin_must_be_6_digits');
		expect(gateway.acceptInvite).not.toHaveBeenCalled();
	});

	it('refuses a PIN that does not match', async () => {
		const { page } = filled();
		page.pin.set('123456');
		page.confirmPin.set('654321');
		await page.submit();
		expect(page.error()).toBe('pins_do_not_match');
	});

	it('accepts with a password alone', async () => {
		const { page, gateway, notification, router } = filled();
		await page.submit();
		expect(gateway.acceptInvite).toHaveBeenCalledWith({ token: 't1', password });
		expect(notification.showSuccess).toHaveBeenCalledWith('account_created_sign_in');
		expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/login');
	});

	it('sends a name and a PIN, with the chosen login method', async () => {
		const { page, gateway } = filled();
		page.form.patchValue({ displayName: ' Asha ' });
		page.pin.set('123456');
		page.confirmPin.set('123456');
		await page.submit();
		expect(gateway.acceptInvite).toHaveBeenCalledWith({
			token: 't1',
			password,
			displayName: 'Asha',
			pin: '123456',
			preferredLoginMethod: 'password',
		});
		const preferring = filled();
		preferring.page.pin.set('123456');
		preferring.page.confirmPin.set('123456');
		preferring.page.preferPin.set(true);
		await preferring.page.submit();
		expect(preferring.gateway.acceptInvite).toHaveBeenCalledWith(
			expect.objectContaining({ preferredLoginMethod: 'pin' }),
		);
	});

	it.each([
		['an issue', 422, { error: { issues: [{ message: 'Too weak' }] } }, 'Too weak'],
		['a 400 message', 400, { error: { message: 'Bad token' } }, 'Bad token'],
		['a 400 with no message', 400, {}, 'something_went_wrong_please_try_again'],
		['a 401', 401, null, 'invalid_or_expired_invitation_link'],
		['a 500', 500, null, 'something_went_wrong_please_try_again'],
	])('explains %s', async (_name, status, body, text) => {
		const { page, gateway, router } = filled();
		gateway.acceptInvite.mockReturnValue(refused(status, body));
		await page.submit();
		expect(page.error()).toBe(text);
		expect(page.pending()).toBe(false);
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});

	it('explains an unknown failure', async () => {
		const { page, gateway } = filled();
		gateway.acceptInvite.mockReturnValue(throwError(() => new Error('down')));
		await page.submit();
		expect(page.error()).toBe('something_went_wrong_please_try_again');
	});
});
