import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Account } from './account';

const refused = (body: unknown, status = 400) => throwError(() => new HttpErrorResponse({ status, error: body }));

const setup = (user: unknown = { displayName: 'Asha', username: 'asha', email: 'a@b.co', phone: '1' }) => {
	const gateway = {
		updateProfile: vi.fn(() => of<unknown>({})),
		securitySettings: vi.fn(() => of<unknown>({ preferredLoginMethod: 'pin' })),
		listSessions: vi.fn(() => of<unknown>([{ id: 's1' }])),
		revokeSession: vi.fn(() => of<unknown>(undefined)),
		revokeOtherSessions: vi.fn(() => of<unknown>({ revoked: 2 })),
		setPin: vi.fn(() => of<unknown>(undefined)),
		removePin: vi.fn(() => of<unknown>(undefined)),
		changePassword: vi.fn(() => of<unknown>(undefined)),
	};
	const store = {
		user: signal(user),
		email: signal('a@b.co'),
		bootstrap: vi.fn(async () => undefined),
		clear: vi.fn(),
	};
	const notification = { showSuccess: vi.fn() };
	const router = { navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminAuthGateway, useValue: gateway },
			{ provide: AuthStore, useValue: store },
			{ provide: NotificationService, useValue: notification },
			{ provide: Router, useValue: router },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(Account, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(Account).componentInstance, gateway, store, notification, router };
};

describe('Account profile', () => {
	it('starts from the signed-in operator, with blanks for nothing', () => {
		expect(setup().page.profileForm.getRawValue()).toMatchObject({ displayName: 'Asha', phone: '1' });
		expect(setup({ username: 'asha' }).page.profileForm.value.displayName).toBe('asha');
		expect(setup(null).page.profileForm.getRawValue()).toEqual({
			displayName: '',
			email: '',
			username: '',
			phone: '',
		});
	});

	it('knows the platform', () => {
		const parts = setup();
		expect(parts.page.isBrowser).toBe(true);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PLATFORM_ID, useValue: 'server' },
				{ provide: AdminAuthGateway, useValue: {} },
				{ provide: AuthStore, useValue: { user: signal(null), email: signal('') } },
				{ provide: NotificationService, useValue: {} },
				{ provide: Router, useValue: {} },
				{ provide: TranslocoService, useValue: {} },
			],
		});
		TestBed.overrideComponent(Account, { set: { imports: [], template: '' } });
		expect(TestBed.createComponent(Account).componentInstance.isBrowser).toBe(false);
	});

	it('shows an initial from the best name, or a mark', () => {
		expect(setup().page.profileInitial()).toBe('A');
		expect(setup({ username: 'bina' }).page.profileInitial()).toBe('B');
		const none = setup(null);
		expect(none.page.profileInitial()).toBe('A');
		none.store.email.set(undefined as never);
		expect(none.page.profileInitial()).toBe('?');
	});

	it('stops on an empty name', () => {
		const { page, gateway } = setup(null);
		page.profileFormSubmit();
		expect(gateway.updateProfile).not.toHaveBeenCalled();
	});

	it('saves the profile and re-reads the session', () => {
		const { page, gateway, store, notification } = setup();
		page.profileForm.patchValue({ phone: ' 9 ' });
		page.profileFormSubmit();
		expect(gateway.updateProfile).toHaveBeenCalledWith({ displayName: 'Asha', phone: '9' });
		expect(store.bootstrap).toHaveBeenCalledOnce();
		expect(notification.showSuccess).toHaveBeenCalledWith('profile_updated');
		page.profileForm.patchValue({ phone: null });
		page.profileFormSubmit();
		expect(gateway.updateProfile).toHaveBeenLastCalledWith({ displayName: 'Asha', phone: null });
	});

	it('shows a refusal', () => {
		const { page, gateway } = setup();
		gateway.updateProfile.mockReturnValue(refused({ error: { issues: [{ message: 'Bad phone' }] } }));
		page.profileFormSubmit();
		expect(page.securityError()).toBe('Bad phone');
	});
});

describe('Account refusal messages', () => {
	it('reads the wrong-password, API and generic cases', () => {
		const { page, gateway } = setup();
		gateway.securitySettings.mockReturnValueOnce(refused({}, 403));
		page.loadSecurity();
		expect(page.securityError()).toBe('current_password_is_incorrect');
		gateway.securitySettings.mockReturnValueOnce(refused({ error: { message: 'Nope' } }));
		page.loadSecurity();
		expect(page.securityError()).toBe('Nope');
		gateway.securitySettings.mockReturnValueOnce(refused(null));
		page.loadSecurity();
		expect(page.securityError()).toBe('something_went_wrong_please_try_again');
	});
});

describe('Account security state', () => {
	it('loads once when the tab opens', () => {
		const { page, gateway } = setup();
		page.onTabChange('profile');
		expect(gateway.securitySettings).not.toHaveBeenCalled();
		page.onTabChange('security');
		expect(page.preferPin()).toBe(true);
		expect(page.sessions()).toEqual([{ id: 's1' }]);
		page.onTabChange('security');
		expect(gateway.securitySettings).toHaveBeenCalledOnce();
	});

	it('prefers the password when told to', () => {
		const { page, gateway } = setup();
		gateway.securitySettings.mockReturnValue(of({ preferredLoginMethod: 'password' }));
		page.loadSecurity();
		expect(page.preferPin()).toBe(false);
	});

	it('shows a failed session read', () => {
		const { page, gateway } = setup();
		gateway.listSessions.mockReturnValue(refused({ error: { message: 'Down' } }));
		page.loadSessions();
		expect(page.securityError()).toBe('Down');
	});

	it('clears everything when switching view, reloading sessions on the status view', () => {
		const { page, gateway } = setup();
		page.pin.set('123456');
		page.onSecurityViewChange('pin');
		expect(page.securityView()).toBe('pin');
		expect(page.pin()).toBe('');
		expect(gateway.listSessions).not.toHaveBeenCalled();
		page.onSecurityViewChange('password');
		expect(page.securityView()).toBe('password');
		page.onSecurityViewChange('other');
		expect(page.securityView()).toBe('credential_status');
		expect(gateway.listSessions).toHaveBeenCalledOnce();
	});

	it('reads the PIN state', () => {
		const { page } = setup();
		expect(page.pinLocked()).toBe(false);
		expect(page.pinSuspended()).toBe(false);
		page.security.set({ pinLockedUntil: null } as never);
		expect(page.pinLocked()).toBe(false);
		page.security.set({ pinLockedUntil: new Date(Date.now() + 60_000).toISOString() } as never);
		expect(page.pinLocked()).toBe(true);
		page.security.set({ pinLockedUntil: new Date(Date.now() - 60_000).toISOString() } as never);
		expect(page.pinLocked()).toBe(false);
		page.security.set({ pinRevalidationRequiredAt: 'now' } as never);
		expect(page.pinSuspended()).toBe(true);
	});

	it('compares the two PIN entries', () => {
		const { page } = setup();
		page.pin.set('123456');
		page.confirmPin.set('12');
		expect(page.pinMismatch()).toBe(false);
		page.confirmPin.set('654321');
		expect(page.pinMismatch()).toBe(true);
		expect(page.pinReady()).toBe(false);
		page.confirmPin.set('123456');
		expect(page.pinReady()).toBe(true);
		page.pin.set('12');
		page.confirmPin.set('12');
		expect(page.pinReady()).toBe(false);
	});
});

describe('Account sessions', () => {
	it('ignores a second press', () => {
		const { page, gateway } = setup();
		page.sessionsBusy.set(true);
		page.revokeSession({ id: 's1' } as never);
		page.revokeOtherSessions();
		expect(gateway.revokeSession).not.toHaveBeenCalled();
		expect(gateway.revokeOtherSessions).not.toHaveBeenCalled();
	});

	it('signs out after revoking this session', () => {
		const { page, store, router } = setup();
		page.revokeSession({ id: 's1', current: true } as never);
		expect(store.clear).toHaveBeenCalledOnce();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('refreshes after revoking another session', () => {
		const { page, notification, gateway } = setup();
		page.revokeSession({ id: 's2' } as never);
		expect(notification.showSuccess).toHaveBeenCalledWith('session_revoked');
		expect(gateway.securitySettings).toHaveBeenCalledOnce();
	});

	it('revokes the others', () => {
		const { page, notification } = setup();
		page.revokeOtherSessions();
		expect(notification.showSuccess).toHaveBeenCalledWith('other_sessions_revoked');
		expect(page.sessionsBusy()).toBe(false);
	});

	it('shows a refusal and frees the buttons', () => {
		const { page, gateway } = setup();
		gateway.revokeSession.mockReturnValue(refused({ error: { message: 'No' } }));
		page.revokeSession({ id: 's2' } as never);
		expect(page.securityError()).toBe('No');
		expect(page.sessionsBusy()).toBe(false);
		gateway.revokeOtherSessions.mockReturnValue(refused({ error: { message: 'Not now' } }));
		page.revokeOtherSessions();
		expect(page.securityError()).toBe('Not now');
		expect(page.sessionsBusy()).toBe(false);
	});
});

describe('Account PIN', () => {
	const ready = () => {
		const parts = setup();
		parts.page.securityForm.patchValue({ current_password: 'pw' });
		parts.page.pin.set('123456');
		parts.page.confirmPin.set('123456');
		return parts;
	};

	it('stops without a password, a matching PIN, or while busy', () => {
		const { page, gateway } = setup();
		page.savePin();
		page.securityForm.patchValue({ current_password: 'pw' });
		page.savePin();
		const busy = ready();
		busy.page.securityBusy.set(true);
		busy.page.savePin();
		expect(gateway.setPin).not.toHaveBeenCalled();
		expect(busy.gateway.setPin).not.toHaveBeenCalled();
	});

	it('saves the PIN with the chosen login method', () => {
		const { page, gateway, notification } = ready();
		page.savePin();
		expect(gateway.setPin).toHaveBeenLastCalledWith({
			currentPassword: 'pw',
			pin: '123456',
			preferredLoginMethod: 'password',
		});
		expect(notification.showSuccess).toHaveBeenCalledWith('pin_saved');
		expect(page.pin()).toBe('');
		expect(page.securityBusy()).toBe(false);
		const preferring = ready();
		preferring.page.preferPin.set(true);
		preferring.page.savePin();
		expect(preferring.gateway.setPin).toHaveBeenLastCalledWith(
			expect.objectContaining({ preferredLoginMethod: 'pin' }),
		);
	});

	it('shows a refused PIN', () => {
		const { page, gateway } = ready();
		gateway.setPin.mockReturnValue(refused({}, 403));
		page.savePin();
		expect(page.securityError()).toBe('current_password_is_incorrect');
		expect(page.securityBusy()).toBe(false);
	});

	it('removes the PIN, asking for the password first', () => {
		const { page, gateway } = setup();
		page.removePin();
		expect(page.securityForm.touched).toBe(true);
		const busy = ready();
		busy.page.securityBusy.set(true);
		busy.page.removePin();
		expect(gateway.removePin).not.toHaveBeenCalled();
		const done = ready();
		done.page.removePin();
		expect(done.gateway.removePin).toHaveBeenCalledWith('pw');
		expect(done.notification.showSuccess).toHaveBeenCalledWith('pin_removed');
	});

	it('shows a refused removal', () => {
		const { page, gateway } = ready();
		gateway.removePin.mockReturnValue(refused({}, 403));
		page.removePin();
		expect(page.securityError()).toBe('current_password_is_incorrect');
		expect(page.securityBusy()).toBe(false);
	});
});

describe('Account password', () => {
	const strong = 'long-enough-password';
	const filled = () => {
		const parts = setup();
		parts.page.securityPasswordForm.patchValue({
			current_password: 'pw',
			password: strong,
			password_confirmation: strong,
		});
		return parts;
	};

	it('flags a mismatch once the confirmation was touched', () => {
		const { page } = setup();
		page.securityPasswordForm.patchValue({ password: strong, password_confirmation: 'other' });
		expect(page.securityPasswordMatchError).toBeFalsy();
		page.securityPasswordForm.get('password_confirmation')?.markAsTouched();
		expect(page.securityPasswordMatchError).toBe(true);
	});

	it('stops on an invalid form or while busy', () => {
		const { page, gateway } = setup();
		page.changeAdminPassword();
		expect(gateway.changePassword).not.toHaveBeenCalled();
		const busy = filled();
		busy.page.securityBusy.set(true);
		busy.page.changeAdminPassword();
		expect(busy.gateway.changePassword).not.toHaveBeenCalled();
	});

	it('changes it and signs out', () => {
		const { page, gateway, store, router } = filled();
		page.changeAdminPassword();
		expect(gateway.changePassword).toHaveBeenCalledWith({ currentPassword: 'pw', newPassword: strong });
		expect(store.clear).toHaveBeenCalledOnce();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('shows a refusal', () => {
		const { page, gateway } = filled();
		gateway.changePassword.mockReturnValue(refused({}, 403));
		page.changeAdminPassword();
		expect(page.securityError()).toBe('current_password_is_incorrect');
		expect(page.securityBusy()).toBe(false);
	});
});
