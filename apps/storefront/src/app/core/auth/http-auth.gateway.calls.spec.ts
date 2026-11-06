import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CsrfTokens } from './csrf-tokens';
import { HttpStorefrontAuthGateway } from './http-auth.gateway';

/**
 * What each gateway call sends and how it treats the answer. The classification spec beside
 * this file owns the URLs, so no path is written here.
 */
describe('HttpStorefrontAuthGateway calls', () => {
	const get = vi.fn();
	const post = vi.fn();
	const del = vi.fn();
	const remember = vi.fn();
	let gateway: HttpStorefrontAuthGateway;

	beforeEach(() => {
		get.mockReset();
		post.mockReset().mockReturnValue(of({ ok: true }));
		del.mockReset();
		remember.mockReset();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: HttpClient, useValue: { get, post, delete: del } },
				{ provide: CsrfTokens, useValue: { remember } },
			],
		});
		gateway = TestBed.inject(HttpStorefrontAuthGateway);
	});

	it('reads the current user, and treats any failure as signed out', async () => {
		get.mockReturnValueOnce(of({ user: { id: 'c1' } }));
		await expect(firstValueFrom(gateway.currentUser())).resolves.toEqual({ id: 'c1' });
		get.mockReturnValueOnce(of({}));
		await expect(firstValueFrom(gateway.currentUser())).resolves.toBeNull();
		get.mockReturnValueOnce(throwError(() => new Error('401')));
		await expect(firstValueFrom(gateway.currentUser())).resolves.toBeNull();
	});

	it('remembers the CSRF token', async () => {
		get.mockReturnValueOnce(of({ csrfToken: 'tok' }));
		await expect(firstValueFrom(gateway.ensureCsrfToken())).resolves.toBeUndefined();
		expect(remember).toHaveBeenCalledWith('tok');
	});

	it('reads the pending signup, and treats no answer as none', async () => {
		get.mockReturnValueOnce(of({ pending: { email: 'a@b.co' } }));
		await expect(firstValueFrom(gateway.currentSignup())).resolves.toEqual({ email: 'a@b.co' });
		get.mockReturnValueOnce(of({}));
		await expect(firstValueFrom(gateway.currentSignup())).resolves.toBeNull();
		get.mockReturnValueOnce(throwError(() => new Error('down')));
		await expect(firstValueFrom(gateway.currentSignup())).resolves.toBeNull();
	});

	it('discards a signup on a best-effort basis', async () => {
		del.mockReturnValueOnce(of({ ok: true }));
		await expect(firstValueFrom(gateway.discardSignup())).resolves.toBeUndefined();
		del.mockReturnValueOnce(throwError(() => new Error('down')));
		await expect(firstValueFrom(gateway.discardSignup())).resolves.toBeUndefined();
	});

	it('sends a password to finalise only when there is one', async () => {
		await firstValueFrom(gateway.finaliseSignup('pass'));
		expect(post.mock.calls[0]?.[1]).toEqual({ password: 'pass' });
		await firstValueFrom(gateway.finaliseSignup());
		expect(post.mock.calls[1]?.[1]).toEqual({});
	});

	const passedThrough: [string, () => unknown, unknown][] = [
		['startSignup', () => gateway.startSignup({ email: 'a@b.co' } as never), { email: 'a@b.co' }],
		['updateSignupField', () => gateway.updateSignupField('email', 'a@b.co'), { field: 'email', value: 'a@b.co' }],
		['requestSignupOtp', () => gateway.requestSignupOtp('phone'), { field: 'phone' }],
		['verifySignupOtp', () => gateway.verifySignupOtp('phone', '1'), { field: 'phone', code: '1' }],
		['signInFromSignup', () => gateway.signInFromSignup('email'), { field: 'email' }],
		['startOAuth', () => gateway.startOAuth('google'), { provider: 'google' }],
		[
			'verifyGoogle',
			() => gateway.verifyGoogle({ stateId: 's', credential: 'c', nonce: null }),
			{ stateId: 's', credential: 'c', nonce: null },
		],
		[
			'verifyFacebook',
			() => gateway.verifyFacebook({ stateId: 's', accessToken: 't' }),
			{ stateId: 's', accessToken: 't' },
		],
		['requestStepUp', () => gateway.requestStepUp('sms'), { channel: 'sms' }],
		['connectIdentity', () => gateway.connectIdentity({ provider: 'google' } as never), { provider: 'google' }],
		['setPassword', () => gateway.setPassword({ newPassword: 'p' } as never), { newPassword: 'p' }],
		[
			'disconnectIdentity',
			() => gateway.disconnectIdentity({ provider: 'google' } as never),
			{ provider: 'google' },
		],
		['loginWithPassword', () => gateway.loginWithPassword({ identifier: 'a' } as never), { identifier: 'a' }],
		['requestLoginOtp', () => gateway.requestLoginOtp('a', 'register'), { identifier: 'a', purpose: 'register' }],
		['verifyLoginOtp', () => gateway.verifyLoginOtp({ identifier: 'a' } as never), { identifier: 'a' }],
		['requestPasswordReset', () => gateway.requestPasswordReset('a'), { identifier: 'a' }],
		['resetPassword', () => gateway.resetPassword({ token: 't' } as never), { token: 't' }],
		['activateAccount', () => gateway.activateAccount({ token: 't' } as never), { token: 't' }],
		['logout', () => gateway.logout(), {}],
	];

	it.each(passedThrough)('%s posts its input', async (_name, call, body) => {
		await firstValueFrom(call() as never);
		expect(post.mock.calls[0]?.[1]).toEqual(body);
	});

	it('hides the answer of the calls that only send something', async () => {
		await expect(firstValueFrom(gateway.requestStepUp('email'))).resolves.toBeUndefined();
		await expect(firstValueFrom(gateway.requestLoginOtp('a', 'login'))).resolves.toBeUndefined();
		await expect(firstValueFrom(gateway.requestPasswordReset('a'))).resolves.toBeUndefined();
	});

	it('reads the login methods', async () => {
		get.mockReturnValueOnce(of({ hasPassword: true }));
		await expect(firstValueFrom(gateway.loginMethods())).resolves.toEqual({ hasPassword: true });
	});

	it('refreshes the session, then the CSRF token, and survives a CSRF failure', async () => {
		get.mockReturnValueOnce(of({ csrfToken: 'new' }));
		await firstValueFrom(gateway.refreshSession());
		expect(remember).toHaveBeenCalledWith('new');
		get.mockReturnValueOnce(throwError(() => new Error('down')));
		await expect(firstValueFrom(gateway.refreshSession())).resolves.toBeUndefined();
	});

	it('classifies a URL by path, and survives one that cannot be parsed', () => {
		expect(gateway.isCredentialEndpoint('http://[bad?x=1')).toBe(false);
		expect(gateway.isSessionEstablishingEndpoint('http://[bad?x=1')).toBe(false);
	});
});
