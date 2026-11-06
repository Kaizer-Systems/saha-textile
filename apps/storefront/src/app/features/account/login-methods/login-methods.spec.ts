import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';

import { LoginMethods } from './login-methods';

const refused = () => throwError(() => ({ error: { code: 'LAST_CREDENTIAL' } }));
const withPassword = { passwordSet: true, stepUpMethod: 'password', emailVerified: true, phoneVerified: true };
const strongPassword = 'long-enough-password';

const render = async (
	view: unknown = withPassword,
	platform = 'browser',
	result: Promise<unknown> = new Promise(() => undefined),
) => {
	const gateway = {
		loginMethods: vi.fn(() => (view instanceof Error ? refused() : of(view))),
		requestStepUp: vi.fn(() => of<unknown>(undefined)),
		setPassword: vi.fn(() => of<unknown>({ passwordSet: true })),
		disconnectIdentity: vi.fn(() => of<unknown>({ passwordSet: true })),
		connectIdentity: vi.fn(() => of<unknown>({ passwordSet: true })),
	};
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(LoginMethods, { set: { imports: [], template: '' } });
	const screen = TestBed.createComponent(LoginMethods).componentInstance;
	await Promise.resolve();
	await Promise.resolve();
	return { screen, gateway, open, dismissAll };
};

describe('LoginMethods loading', () => {
	it('shows what the server says', async () => {
		const { screen } = await render();
		expect(screen.loading()).toBe(false);
		expect(screen.needsFirstPassword()).toBe(false);
		expect(screen.stepUpByCode()).toBe(false);
	});

	it('shows the refusal when the read fails', async () => {
		const { screen } = await render(new Error('x'));
		expect(screen.refusal()).toBe('LAST_CREDENTIAL');
		expect(screen.loading()).toBe(false);
	});

	it.each([
		[{ emailVerified: true, phoneVerified: true }, 'one_time_code_email_and_phone'],
		[{ emailVerified: true, phoneVerified: false }, 'one_time_code_email_only'],
		[{ emailVerified: false, phoneVerified: true }, 'one_time_code_phone_only'],
		[{ emailVerified: false, phoneVerified: false }, 'one_time_code_no_channel'],
	])('describes the code channels for %j', async (view, key) => {
		expect((await render(view)).screen.oneTimeCodeChannels()).toBe(key);
	});

	it('describes no channel before the first load answers', async () => {
		const { screen } = await render();
		screen.methods.set(null);
		expect(screen.oneTimeCodeChannels()).toBe('one_time_code_no_channel');
	});
});

describe('LoginMethods dialog', () => {
	it('opens nothing on the server', async () => {
		const { screen, open } = await render(withPassword, 'server');
		screen.begin({ kind: 'password' });
		expect(open).not.toHaveBeenCalled();
	});

	it('names itself after the action', async () => {
		const { screen } = await render();
		screen.begin({ kind: 'password' });
		expect(screen.stepUpTitle()).toBe('change_password');
		screen.methods.set({ passwordSet: false } as never);
		expect(screen.stepUpTitle()).toBe('set_password');
		screen.begin({ kind: 'disconnect', provider: 'google' });
		expect(screen.stepUpTitle()).toBe('disconnect');
		screen.onCredential({ provider: 'google' } as never);
		expect(screen.stepUpTitle()).toBe('connect');
	});

	it('drops the action when dismissed', async () => {
		const { screen } = await render(withPassword, 'browser', Promise.reject(new Error('closed')));
		screen.begin({ kind: 'password' });
		await Promise.resolve();
		await Promise.resolve();
		expect(screen.pending()).toBeNull();
	});

	it('reports a mismatch only after the confirmation was touched', async () => {
		const { screen } = await render();
		screen.form.patchValue({ newPassword: strongPassword, confirmation: 'other' });
		expect(screen.passwordMatchError).toBeFalsy();
		screen.form.get('confirmation')?.markAsTouched();
		expect(screen.passwordMatchError).toBe(true);
	});
});

describe('LoginMethods.sendCode', () => {
	it('sends a code and starts the wait', async () => {
		const { screen, gateway } = await render();
		await screen.sendCode('email');
		expect(gateway.requestStepUp).toHaveBeenCalledWith('email');
		expect(screen.codeSent()).toBe(true);
		expect(screen.notice()).toBe('step_up_code_sent');
		expect(screen.busy()).toBe(false);
	});

	it('ignores a second press and shows a refusal', async () => {
		const { screen, gateway } = await render();
		screen.busy.set(true);
		await screen.sendCode('sms');
		expect(gateway.requestStepUp).not.toHaveBeenCalled();
		screen.busy.set(false);
		gateway.requestStepUp.mockReturnValue(refused());
		await screen.sendCode('sms');
		expect(screen.refusal()).toBe('LAST_CREDENTIAL');
	});
});

describe('LoginMethods.confirm', () => {
	it('does nothing with no action or while busy', async () => {
		const { screen, gateway } = await render();
		await screen.confirm();
		screen.begin({ kind: 'password' });
		screen.form.patchValue({ currentPassword: 'pw' });
		screen.busy.set(true);
		await screen.confirm();
		expect(gateway.setPassword).not.toHaveBeenCalled();
	});

	it('asks for proof first', async () => {
		const { screen } = await render();
		screen.begin({ kind: 'disconnect', provider: 'google' });
		await screen.confirm();
		expect(screen.refusal()).toBe('step_up_required');
		screen.form.patchValue({ currentPassword: null });
		await screen.confirm();
		expect(screen.refusal()).toBe('step_up_required');
	});

	it('accepts only a whole code from a code account', async () => {
		const { screen, gateway } = await render({ passwordSet: false, stepUpMethod: 'otp' });
		screen.begin({ kind: 'disconnect', provider: 'facebook' });
		screen.form.patchValue({ code: '123' });
		await screen.confirm();
		expect(screen.refusal()).toBe('step_up_required');
		screen.form.patchValue({ code: null });
		await screen.confirm();
		expect(screen.refusal()).toBe('step_up_required');
		screen.form.patchValue({ code: '123456' });
		await screen.confirm();
		expect(gateway.disconnectIdentity).toHaveBeenCalledWith({ provider: 'facebook', otpCode: '123456' });
		expect(screen.notice()).toBe('provider_disconnected');
	});

	it('holds back a weak or mismatched new password', async () => {
		const { screen, gateway } = await render();
		screen.begin({ kind: 'password' });
		screen.form.patchValue({ currentPassword: 'pw', newPassword: 'short', confirmation: 'short' });
		await screen.confirm();
		screen.form.patchValue({ newPassword: null, confirmation: null });
		await screen.confirm();
		screen.form.patchValue({ newPassword: strongPassword, confirmation: 'other' });
		await screen.confirm();
		expect(gateway.setPassword).not.toHaveBeenCalled();
	});

	it('sets the password and renders the server answer', async () => {
		const { screen, gateway, dismissAll } = await render();
		screen.begin({ kind: 'password' });
		screen.form.patchValue({ currentPassword: 'pw', newPassword: strongPassword, confirmation: strongPassword });
		await screen.confirm();
		expect(gateway.setPassword).toHaveBeenCalledWith({ newPassword: strongPassword, password: 'pw' });
		expect(screen.methods()).toEqual({ passwordSet: true });
		expect(screen.pending()).toBeNull();
		expect(dismissAll).toHaveBeenCalledOnce();
		expect(screen.notice()).toBe('password_updated');
	});

	it('connects with the held credential', async () => {
		const { screen, gateway } = await render();
		screen.onCredential({ provider: 'google', stateId: 's', credential: 'c', nonce: null });
		screen.form.patchValue({ currentPassword: 'pw' });
		await screen.confirm();
		expect(gateway.connectIdentity).toHaveBeenCalledWith({
			provider: 'google',
			stateId: 's',
			credential: 'c',
			nonce: null,
			password: 'pw',
		});
		expect(screen.notice()).toBe('provider_connected');
	});

	it('shows the refusal and keeps the dialog open', async () => {
		const { screen, gateway, dismissAll } = await render();
		gateway.disconnectIdentity.mockReturnValue(refused());
		screen.begin({ kind: 'disconnect', provider: 'google' });
		screen.form.patchValue({ currentPassword: 'pw' });
		await screen.confirm();
		expect(screen.refusal()).toBe('LAST_CREDENTIAL');
		expect(dismissAll).not.toHaveBeenCalled();
		expect(screen.busy()).toBe(false);
	});
});
