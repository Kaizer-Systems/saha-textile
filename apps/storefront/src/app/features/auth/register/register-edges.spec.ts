import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { ProviderSdkLoader } from '@core/auth/provider-sdk.loader';
import { AuthStore } from '@core/state/auth.store';

import { Register } from './register';

const fieldState = (value: string | null, overrides: Record<string, unknown> = {}) => ({
	value,
	verified: false,
	locked: false,
	sendsRemaining: 5,
	resendAvailableAt: null,
	codeSent: false,
	...overrides,
});
const record = (overrides: Record<string, unknown> = {}) => ({
	origin: 'password',
	email: fieldState('a@b.co'),
	phone: fieldState(null),
	displayName: null,
	complete: false,
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
	...overrides,
});
const refused = () => throwError(() => ({ error: { code: 'too_many_requests' } }));

const render = async (pending: unknown = null, platform = 'browser') => {
	const gateway = {
		currentSignup: vi.fn(() => of<unknown>(pending)),
		discardSignup: vi.fn(() => of(undefined)),
		startSignup: vi.fn(() => of<unknown>(record())),
		updateSignupField: vi.fn(() => of<unknown>(record())),
		requestSignupOtp: vi.fn(() => of<unknown>(record())),
		verifySignupOtp: vi.fn(() => of<unknown>({ state: record(), existingAccount: false, accountUsable: false })),
	};
	const store = {
		error: vi.fn((): string | null => null),
		pending: vi.fn(() => false),
		finaliseSignup: vi.fn(async () => true),
		signInFromSignup: vi.fn(async () => true),
	};
	const router = { navigateByUrl: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: ProviderSdkLoader, useValue: { revokeGoogleGrant: async () => true } },
			{ provide: AuthStore, useValue: store },
			{ provide: Router, useValue: router },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } },
		],
	});
	TestBed.overrideComponent(Register, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Register);
	fixture.detectChanges();
	await fixture.whenStable();
	return { screen: fixture.componentInstance, gateway, store, router };
};
const email = (screen: Register, value: string) => screen.form.patchValue({ email: value });

describe('Register on the server', () => {
	it('asks nothing, because only a browser holds the signup cookie', async () => {
		const { gateway } = await render(null, 'server');
		expect(gateway.currentSignup).not.toHaveBeenCalled();
	});
});

describe('Register reading the record', () => {
	it('names the provider and exposes the phone state', async () => {
		const { screen } = await render(record({ origin: 'google', phone: fieldState('+919000000000') }));
		expect(screen.providerKey()).toBe('provider_google');
		expect(screen.phoneState()?.value).toBe('+919000000000');
		expect(screen.form.getRawValue()).toMatchObject({ country_code: '91', phone: '9000000000' });
	});

	it('has no field state before a signup exists', async () => {
		const { screen } = await render();
		expect(screen.emailState()).toBeNull();
		expect(screen.phoneState()).toBeNull();
	});

	it('keeps a number it cannot split, and accepts one without a plus', async () => {
		const odd = await render(record({ phone: fieldState('+0000') }));
		expect(odd.screen.form.getRawValue()).toMatchObject({ country_code: '91', phone: '0000' });
		const plain = await render(record({ phone: fieldState('919000000000') }));
		expect(plain.screen.form.getRawValue()).toMatchObject({ country_code: '91', phone: '9000000000' });
	});

	it('keeps what was typed when the server has nothing for a field', async () => {
		const { screen, gateway } = await render();
		screen.form.patchValue({ name: 'Typed', email: 'typed@b.co' });
		gateway.startSignup.mockReturnValue(of(record({ displayName: null, email: fieldState(null) })));
		gateway.requestSignupOtp.mockReturnValue(of(record({ displayName: null, email: fieldState(null) })));
		await screen.verify('email');
		expect(screen.form.getRawValue()).toMatchObject({ name: 'Typed', email: 'typed@b.co' });
		screen.form.patchValue({ name: null, email: null });
		await screen.verify('phone');
	});

	it('flags a password mismatch once the confirmation was touched', async () => {
		const { screen } = await render();
		screen.form.patchValue({ password: 'long-enough-password', password_confirmation: 'other' });
		expect(screen.passwordMatchError).toBeFalsy();
		screen.form.get('password_confirmation')?.markAsTouched();
		expect(screen.passwordMatchError).toBe(true);
	});
});

describe('Register code box', () => {
	it('follows the phone value as well as the address', async () => {
		const { screen } = await render(
			record({
				email: fieldState('a@b.co', { codeSent: true }),
				phone: fieldState('+919000000000', { codeSent: true }),
			}),
		);
		expect(screen.codeSentFor('email')).toBe(true);
		expect(screen.codeSentFor('phone')).toBe(true);
		screen.form.patchValue({ phone: '9111111111' });
		expect(screen.codeSentFor('phone')).toBe(false);
	});
});

describe('Register.verify', () => {
	it('stops on an invalid field, or while busy', async () => {
		const { screen, gateway } = await render();
		email(screen, 'not-an-address');
		await screen.verify('email');
		email(screen, 'a@b.co');
		screen.busyField.set('phone');
		await screen.verify('email');
		expect(gateway.startSignup).not.toHaveBeenCalled();
	});

	it('starts the signup, then sends a code', async () => {
		const { screen, gateway } = await render();
		screen.form.patchValue({ name: 'Asha', email: 'a@b.co', phone: '9000000000' });
		screen.marketingOptIn.setValue(true);
		await screen.verify('email');
		expect(gateway.startSignup).toHaveBeenCalledWith({
			email: 'a@b.co',
			phone: '+919000000000',
			displayName: 'Asha',
			marketingOptIn: true,
		});
		expect(gateway.requestSignupOtp).toHaveBeenCalledWith('email');
		expect(screen.busyField()).toBeNull();
	});

	it('sends no empty display name', async () => {
		const { screen, gateway } = await render();
		screen.form.patchValue({ name: '', email: 'a@b.co' });
		await screen.verify('email');
		expect(gateway.startSignup.mock.lastCall).toBeDefined();
		expect((gateway.startSignup.mock.lastCall as unknown[])[0]).toMatchObject({ displayName: undefined });
	});

	it('updates the field of a signup already in flight', async () => {
		const { screen, gateway } = await render(record());
		email(screen, 'new@b.co');
		await screen.verify('email');
		expect(gateway.updateSignupField).toHaveBeenCalledWith('email', 'new@b.co');
		screen.form.patchValue({ phone: '9000000000', country_code: null });
		await screen.verify('phone');
		expect(gateway.updateSignupField).toHaveBeenLastCalledWith('phone', '+919000000000');
	});

	it('shows a refusal and frees the button', async () => {
		const { screen, gateway } = await render(record());
		gateway.requestSignupOtp.mockReturnValue(refused());
		await screen.verify('email');
		expect(screen.refusal()).toBe('too_many_requests');
		expect(screen.busyField()).toBeNull();
	});
});

describe('Register.submitCode', () => {
	it('ignores a second press', async () => {
		const { screen, gateway } = await render(record());
		screen.busyField.set('email');
		await screen.submitCode('email', '123456');
		expect(gateway.verifySignupOtp).not.toHaveBeenCalled();
	});

	it('adopts the answer when no account exists', async () => {
		const { screen } = await render(record());
		await screen.submitCode('email', '123456');
		expect(screen.existingAccount()).toBe(false);
		expect(screen.refusal()).toBeNull();
	});

	it('explains an account that cannot be entered', async () => {
		const { screen, gateway } = await render(record());
		gateway.verifySignupOtp.mockReturnValue(of({ state: record(), existingAccount: true, accountUsable: false }));
		await screen.submitCode('email', '123456');
		expect(screen.refusal()).toBe('account_not_accessible');
		expect(screen.existingAccountField()).toBeNull();
	});

	it('shows a refused code', async () => {
		const { screen, gateway } = await render(record());
		gateway.verifySignupOtp.mockReturnValue(refused());
		await screen.submitCode('email', '000000');
		expect(screen.refusal()).toBe('too_many_requests');
	});
});

describe('Register.signInToExisting', () => {
	it('does nothing without a proven field, or while busy', async () => {
		const { screen, store } = await render(record());
		await screen.signInToExisting();
		screen.existingAccountField.set('email');
		store.pending.mockReturnValue(true);
		await screen.signInToExisting();
		expect(store.signInFromSignup).not.toHaveBeenCalled();
	});

	it('explains a refused sign-in', async () => {
		const { screen, store } = await render(record());
		screen.existingAccountField.set('email');
		store.signInFromSignup.mockResolvedValue(false);
		await screen.signInToExisting();
		expect(screen.refusal()).toBe('registration_failed');
		store.error.mockReturnValue('expired');
		screen.existingAccountField.set('email');
		await screen.signInToExisting();
		expect(screen.refusal()).toBe('expired');
	});
});

describe('Register.useDifferentDetails', () => {
	it('reopens the matched field, or just clears the message', async () => {
		const { screen } = await render(record());
		screen.refusal.set('signup_identifier_taken');
		screen.useDifferentDetails();
		expect(screen.refusal()).toBeNull();
		screen.existingAccountField.set('phone');
		screen.useDifferentDetails();
		expect(screen.existingAccountField()).toBeNull();
	});
});

describe('Register empty controls', () => {
	it('sends empty text for controls that hold nothing', async () => {
		const { screen, gateway } = await render();
		screen.form.patchValue({ name: null, email: null, phone: '9000000000' });
		await screen.verify('phone');
		expect(gateway.startSignup.mock.lastCall).toBeDefined();
		expect((gateway.startSignup.mock.lastCall as unknown[])[0]).toMatchObject({
			email: '',
			displayName: undefined,
		});
		const second = await render();
		second.screen.form.patchValue({ email: 'a@b.co', phone: null });
		await second.screen.verify('email');
		expect((second.gateway.startSignup.mock.lastCall as unknown[])[0]).toMatchObject({ phone: '+91' });
	});

	it('adopts a record with nothing in it over an empty form', async () => {
		const { screen, gateway } = await render();
		const empty = record({ displayName: null, email: fieldState(null) });
		gateway.startSignup.mockReturnValue(of(empty));
		gateway.requestSignupOtp.mockReturnValue(of(empty));
		screen.form.patchValue({ name: null, email: null, phone: '9000000000' });
		await screen.verify('phone');
		expect(screen.form.getRawValue()).toMatchObject({ name: '', email: '' });
	});
});

describe('Register.submit', () => {
	const ready = async () => {
		const verified = fieldState('a@b.co', { verified: true });
		const parts = await render(
			record({ email: verified, phone: fieldState('+919000000000', { verified: true }), complete: true }),
		);
		parts.screen.tnc.setValue(true);
		parts.screen.form.patchValue({
			password: 'long-enough-password',
			password_confirmation: 'long-enough-password',
		});
		return parts;
	};

	it('stops without consent, or while busy', async () => {
		const noConsent = await ready();
		noConsent.screen.tnc.setValue(false);
		await noConsent.screen.submit();
		expect(noConsent.store.finaliseSignup).not.toHaveBeenCalled();
		const busy = await ready();
		busy.store.pending.mockReturnValue(true);
		await busy.screen.submit();
		expect(busy.store.finaliseSignup).not.toHaveBeenCalled();
	});

	it('sends empty text for a password control that holds nothing', async () => {
		const { screen, store } = await ready();
		screen.form.patchValue({ password: null });
		await screen.submit();
		expect(store.finaliseSignup).toHaveBeenCalledWith('');
	});

	it('reports a generic refusal when the store has no code', async () => {
		const { screen, store } = await ready();
		store.finaliseSignup.mockResolvedValue(false);
		await screen.submit();
		expect(screen.refusal()).toBe('registration_failed');
	});
});
