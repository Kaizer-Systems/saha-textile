import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { IdleLockService } from '@core/auth/idle-lock.service';
import { AuthStore } from '@core/state/auth.store';

import { IdleLockModal } from './idle-lock-modal';

const render = (template = '<ng-template #idleLockModal></ng-template>') => {
	const locked = signal(false);
	const authed = signal(true);
	const idle = { locked, unlock: vi.fn() };
	const auth = {
		isAuthenticated: authed,
		user: signal<unknown>(null),
		error: signal<string | null>(null),
		resumeWithPin: vi.fn(async () => true),
		resumeWithPassword: vi.fn(async () => true),
	};
	const close = vi.fn();
	const open = vi.fn(() => ({ close }));
	const router = { navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: IdleLockService, useValue: idle },
			{ provide: AuthStore, useValue: auth },
			{ provide: NgbModal, useValue: { open } },
			{ provide: Router, useValue: router },
		],
	});
	TestBed.overrideComponent(IdleLockModal, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(IdleLockModal);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, modal: fixture.componentInstance, locked, authed, idle, auth, open, close, router };
};

describe('IdleLockModal opening', () => {
	it('opens once however often the lock is reported', async () => {
		const { modal, locked, open } = render();
		locked.set(true);
		TestBed.tick();
		await (modal as unknown as { open: () => Promise<void> }).open();
		expect(open).toHaveBeenCalledOnce();
	});

	it('opens once when locked, and closes when unlocked', () => {
		const { locked, open, close } = render();
		locked.set(true);
		TestBed.tick();
		expect(open).toHaveBeenCalledOnce();
		locked.set(false);
		TestBed.tick();
		expect(close).toHaveBeenCalledOnce();
	});

	it('does not open twice while the session changes under it', () => {
		const { locked, authed, open } = render();
		locked.set(true);
		TestBed.tick();
		authed.set(false);
		TestBed.tick();
		authed.set(true);
		TestBed.tick();
		expect(open).toHaveBeenCalledTimes(2);
	});

	it('waits for its template', () => {
		const { locked, open } = render('');
		locked.set(true);
		TestBed.tick();
		expect(open).not.toHaveBeenCalled();
	});

	it('uses the PIN when one is configured', () => {
		const { modal, auth } = render();
		expect(modal.usePin()).toBe(false);
		auth.user.set({ pinConfigured: true });
		expect(modal.usePin()).toBe(true);
	});
});

describe('IdleLockModal.submitPin', () => {
	it('needs all six digits and no request running', async () => {
		const { modal, auth } = render();
		modal.pin.set('123');
		await modal.submitPin();
		modal.pin.set('123456');
		modal.busy.set(true);
		await modal.submitPin();
		expect(auth.resumeWithPin).not.toHaveBeenCalled();
	});

	it('unlocks on a right PIN', async () => {
		const { modal, idle } = render();
		modal.pin.set('123456');
		await modal.submitPin();
		expect(idle.unlock).toHaveBeenCalledOnce();
		expect(modal.busy()).toBe(false);
	});

	it('returns to login when the session has died', async () => {
		const { modal, auth, authed, idle, router } = render();
		auth.resumeWithPin.mockImplementation(async () => {
			authed.set(false);
			return false;
		});
		modal.pin.set('123456');
		await modal.submitPin();
		expect(idle.unlock).toHaveBeenCalledOnce();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('explains a wrong PIN and clears it', async () => {
		const { modal, auth } = render();
		auth.resumeWithPin.mockResolvedValue(false);
		modal.pin.set('123456');
		await modal.submitPin();
		expect(modal.error()).toBe('invalid_credentials');
		expect(modal.pin()).toBe('');
		auth.error.set('locked');
		modal.pin.set('123456');
		await modal.submitPin();
		expect(modal.error()).toBe('locked');
	});
});

describe('IdleLockModal.submitPassword', () => {
	it('needs a password and no request running', async () => {
		const { modal, auth } = render();
		await modal.submitPassword();
		modal.passwordForm.patchValue({ password: 'p' });
		modal.busy.set(true);
		await modal.submitPassword();
		expect(auth.resumeWithPassword).not.toHaveBeenCalled();
	});

	it('unlocks on the right password', async () => {
		const { modal, idle } = render();
		modal.passwordForm.patchValue({ password: 'p' });
		await modal.submitPassword();
		expect(idle.unlock).toHaveBeenCalledOnce();
	});

	it('returns to login when the session has died', async () => {
		const { modal, auth, authed, router } = render();
		auth.resumeWithPassword.mockImplementation(async () => {
			authed.set(false);
			return false;
		});
		modal.passwordForm.patchValue({ password: 'p' });
		await modal.submitPassword();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('explains a wrong password', async () => {
		const { modal, auth } = render();
		auth.resumeWithPassword.mockResolvedValue(false);
		modal.passwordForm.patchValue({ password: 'p' });
		await modal.submitPassword();
		expect(modal.error()).toBe('invalid_credentials');
		auth.error.set('locked');
		await modal.submitPassword();
		expect(modal.error()).toBe('locked');
	});
});
