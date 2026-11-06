import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { UpdatePassword } from './update-password';

const strong = 'long-enough-password';

const render = (url = '/auth/update-password', token: string | null = 'tok') => {
	const store = {
		error: signal(null),
		pending: signal(false),
		resetPassword: vi.fn(async () => true),
		activateAccount: vi.fn(async () => true),
	};
	const router = { url, navigateByUrl: vi.fn(async () => true) };
	const translate = vi.fn(() => of('Title'));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: store },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => token } } } },
			{ provide: TranslocoService, useValue: { selectTranslate: translate } },
		],
	});
	TestBed.overrideComponent(UpdatePassword, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(UpdatePassword).componentInstance, store, router, translate };
};
const filled = (page: UpdatePassword) => page.form.patchValue({ newPassword: strong, confirmPassword: strong });

describe('UpdatePassword', () => {
	it('titles itself by purpose', () => {
		expect(render().translate).toHaveBeenCalledWith('reset_password');
		expect(render('/auth/activate?token=x').translate).toHaveBeenCalledWith('create_password');
	});

	it('flags a mismatch only once the confirmation was touched', () => {
		const { page } = render();
		page.form.patchValue({ newPassword: strong, confirmPassword: 'other' });
		expect(page.passwordMatchError).toBeFalsy();
		page.form.get('confirmPassword')?.markAsTouched();
		expect(page.passwordMatchError).toBe(true);
	});

	it('stops with no token, an invalid form or while busy', async () => {
		const noToken = render('/auth/update-password', null);
		filled(noToken.page);
		await noToken.page.submit();
		expect(noToken.store.resetPassword).not.toHaveBeenCalled();
		const invalid = render();
		await invalid.page.submit();
		expect(invalid.store.resetPassword).not.toHaveBeenCalled();
		const busy = render();
		filled(busy.page);
		busy.store.pending.set(true);
		await busy.page.submit();
		expect(busy.store.resetPassword).not.toHaveBeenCalled();
	});

	it('resets, then goes to the login page', async () => {
		const { page, store, router } = render();
		filled(page);
		await page.submit();
		expect(store.resetPassword).toHaveBeenCalledWith({ token: 'tok', newPassword: strong });
		expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/login');
	});

	it('activates an account from the activation address', async () => {
		const { page, store } = render('/auth/activate?token=tok');
		filled(page);
		await page.submit();
		expect(store.activateAccount).toHaveBeenCalledOnce();
		expect(store.resetPassword).not.toHaveBeenCalled();
	});

	it('stays put when the link has expired', async () => {
		const { page, store, router } = render();
		store.resetPassword.mockResolvedValue(false);
		filled(page);
		await page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});
