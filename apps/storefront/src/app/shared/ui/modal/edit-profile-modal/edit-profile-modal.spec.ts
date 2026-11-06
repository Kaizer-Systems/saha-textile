import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { AccountStore } from '@core/state/account.store';
import { ContactChangeService } from '@data-access/services/contact-change.service';

import { EditProfileModal } from './edit-profile-modal';

const held = { field: 'email', resendAvailableAt: null };
const refused = () => throwError(() => ({ error: { code: 'WRONG_PASSWORD' } }));

const render = (platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	const account = {
		user: signal<unknown>({ name: 'Asha', email: 'a@b.co', phone: '9000000000', country_code: 91 }),
		adoptUser: vi.fn(),
		updateProfile: vi.fn(async () => true),
	};
	const contact = {
		pending: vi.fn(() => of<unknown>(null)),
		cancel: vi.fn(() => of<unknown>(undefined)),
		startEmailChange: vi.fn(() => of<unknown>(held)),
		startPhoneChange: vi.fn(() => of<unknown>({ ...held, field: 'phone' })),
		resend: vi.fn(() => of<unknown>(held)),
		confirm: vi.fn(() => of<unknown>({ email: 'new@b.co', phone: '9111111111' })),
	};
	const gateway = {
		loginMethods: vi.fn(() => of<unknown>({ stepUpMethod: 'password' })),
		requestStepUp: vi.fn(() => of<unknown>(undefined)),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: AccountStore, useValue: account },
			{ provide: ContactChangeService, useValue: contact },
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(EditProfileModal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(EditProfileModal);
	fixture.detectChanges();
	return { fixture, modal: fixture.componentInstance, open, dismissAll, account, contact, gateway };
};
const settle = async () => {
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe('EditProfileModal form', () => {
	it('rebuilds from the account, and settles the flicker flag', () => {
		vi.useFakeTimers();
		const { modal } = render();
		TestBed.tick();
		expect(modal.form.value).toMatchObject({ name: 'Asha', email: 'a@b.co' });
		expect(modal.flicker).toBe(true);
		vi.advanceTimersByTime(200);
		expect(modal.flicker).toBe(false);
	});

	it('copes with no account yet', () => {
		const { modal, account } = render();
		account.user.set(null);
		TestBed.tick();
		expect(modal.form.value.name).toBeNull();
	});
});

describe('EditProfileModal.openModal', () => {
	it('opens nothing on the server', () => {
		const { modal, open } = render('server');
		TestBed.tick();
		modal.openModal();
		expect(modal.isBrowser).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});

	it('opens at once, then reads the proof method and any change in flight', async () => {
		const { modal, open, contact, gateway } = render();
		TestBed.tick();
		gateway.loginMethods.mockReturnValue(of({ stepUpMethod: 'otp' }));
		contact.pending.mockReturnValue(of(held));
		modal.openModal();
		expect(open).toHaveBeenCalledOnce();
		await settle();
		expect(modal.stepUpByCode()).toBe(true);
		expect(modal.awaitingCode()).toBe(true);
		expect(modal.changingField()).toBe('email');
	});

	it('starts clean when nothing is in flight', async () => {
		const { modal } = render();
		TestBed.tick();
		modal.openModal();
		await settle();
		expect(modal.changingField()).toBeNull();
		expect(modal.awaitingCode()).toBe(false);
	});

	it('still opens when the reads fail', async () => {
		const { modal, open, gateway } = render();
		TestBed.tick();
		gateway.loginMethods.mockReturnValue(refused());
		modal.openModal();
		await settle();
		expect(open).toHaveBeenCalledOnce();
		expect(modal.stepUpMethod()).toBe('password');
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render('browser', Promise.reject(reason));
		TestBed.tick();
		modal.openModal();
		await settle();
		expect(modal.closeResult).toBe(text);
	});
});

describe('EditProfileModal contact change', () => {
	const ready = () => {
		const parts = render();
		TestBed.tick();
		return parts;
	};

	it('opens the proof step without sending anything', () => {
		const { modal, contact } = ready();
		modal.refusal.set('x');
		modal.beginChange('phone');
		expect(modal.changingField()).toBe('phone');
		expect(modal.refusal()).toBeNull();
		expect(contact.startPhoneChange).not.toHaveBeenCalled();
	});

	it('does nothing to start with no field chosen', async () => {
		const { modal, contact } = ready();
		await modal.startChange();
		expect(contact.startEmailChange).not.toHaveBeenCalled();
	});

	it('proves with the password for an email change', async () => {
		const { modal, contact } = ready();
		modal.beginChange('email');
		modal.form.patchValue({ email: ' new@b.co ', currentPassword: 'pw' });
		await modal.startChange();
		expect(contact.startEmailChange).toHaveBeenCalledWith('new@b.co', { password: 'pw' });
		expect(modal.awaitingCode()).toBe(true);
		expect(modal.notice()).toBe('contact_change_code_sent');
		expect(modal.form.value.currentPassword).toBe('');
	});

	it('proves with a code for a phone change on an account with no password', async () => {
		const { modal, contact } = ready();
		modal.stepUpMethod.set('otp');
		modal.beginChange('phone');
		modal.form.patchValue({ phone: '9111111111', stepUpCode: '123456' });
		await modal.startChange();
		expect(contact.startPhoneChange).toHaveBeenCalledWith('9111111111', { otpCode: '123456' });
	});

	it('sends empty text for missing proof and values', async () => {
		const { modal, contact } = ready();
		modal.beginChange('email');
		modal.form.patchValue({ email: null, currentPassword: null });
		await modal.startChange();
		expect(contact.startEmailChange).toHaveBeenCalledWith('', { password: '' });
		modal.stepUpMethod.set('otp');
		modal.form.patchValue({ stepUpCode: null });
		await modal.startChange();
		expect(contact.startEmailChange).toHaveBeenLastCalledWith('', { otpCode: '' });
	});

	it('shows a refusal, and is ready again afterwards', async () => {
		const { modal, contact } = ready();
		contact.startEmailChange.mockReturnValue(refused());
		modal.beginChange('email');
		await modal.startChange();
		expect(modal.refusal()).toBe('WRONG_PASSWORD');
		expect(modal.busy()).toBe(false);
	});

	it('ignores a second request while one is running', async () => {
		const { modal, contact } = ready();
		modal.busy.set(true);
		await modal.resendCode();
		expect(contact.resend).not.toHaveBeenCalled();
	});

	it('sends a step-up code and resends the change code', async () => {
		const { modal, gateway, contact } = ready();
		await modal.sendStepUpCode('sms');
		expect(gateway.requestStepUp).toHaveBeenCalledWith('sms');
		expect(modal.notice()).toBe('step_up_code_sent');
		await modal.resendCode();
		expect(contact.resend).toHaveBeenCalledOnce();
		expect(modal.notice()).toBe('contact_change_code_sent');
	});

	it('moves the value only when the code is spent', async () => {
		const { modal, contact, account } = ready();
		modal.pendingChange.set(held as never);
		modal.changingField.set('email');
		modal.form.patchValue({ confirmationCode: '123456' });
		await modal.confirmChange();
		expect(contact.confirm).toHaveBeenCalledWith('123456');
		expect(account.adoptUser).toHaveBeenCalledOnce();
		expect(modal.form.value).toMatchObject({ email: 'new@b.co', confirmationCode: '' });
		expect(modal.changingField()).toBeNull();
		expect(modal.notice()).toBe('contact_change_done');
		modal.form.patchValue({ confirmationCode: null });
		await modal.confirmChange();
		expect(contact.confirm).toHaveBeenLastCalledWith('');
	});

	it('cancels a held change on the server, even when that call fails', async () => {
		const { modal, contact } = ready();
		modal.pendingChange.set(held as never);
		modal.changingField.set('email');
		contact.cancel.mockReturnValue(refused());
		await modal.cancelChange();
		expect(contact.cancel).toHaveBeenCalledOnce();
		expect(modal.pendingChange()).toBeNull();
		expect(modal.changingField()).toBeNull();
	});

	it('cancels locally when nothing is held', async () => {
		const { modal, contact } = ready();
		modal.beginChange('email');
		await modal.cancelChange();
		expect(contact.cancel).not.toHaveBeenCalled();
	});
});

describe('EditProfileModal name', () => {
	it('refuses an empty name', async () => {
		const { modal, account } = render();
		TestBed.tick();
		modal.form.patchValue({ name: '' });
		await modal.submit();
		expect(account.updateProfile).not.toHaveBeenCalled();
	});

	it('closes after saving, and stays open on failure', async () => {
		const { modal, account, dismissAll } = render();
		TestBed.tick();
		account.updateProfile.mockResolvedValueOnce(false);
		await modal.submit();
		expect(dismissAll).not.toHaveBeenCalled();
		await modal.submit();
		expect(account.updateProfile).toHaveBeenLastCalledWith('Asha');
		expect(dismissAll).toHaveBeenCalledOnce();
	});
});

describe('EditProfileModal leaving', () => {
	it('closes an open dialog, and leaves others alone', () => {
		const { fixture, dismissAll } = render();
		TestBed.tick();
		fixture.destroy();
		expect(dismissAll).not.toHaveBeenCalled();
		const open = render();
		TestBed.tick();
		open.modal.modalOpen = true;
		open.fixture.destroy();
		expect(open.dismissAll).toHaveBeenCalledOnce();
	});
});
