import { HttpException, UnauthorizedException } from '@nestjs/common';
import {
	DuplicateIdentifierError,
	OAuthProviderUnavailableError,
	OAuthTokenInvalidError,
} from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cookieNames } from '../src/common/cookies';
import { OAuthIdentityConflictError, OAuthStateInvalidError } from '../src/auth/oauth.service';
import { SignupError } from '../src/auth/signup.service';
import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';

const principal = { userId: 'cus_1', sessionId: 's1' } as never;
const session = { audience: 'storefront', expiresAt: 'e', absoluteExpiresAt: 'a', userId: 'cus_1' };
const activeUser = {
	id: 'cus_1',
	status: 'active',
	tokenVersion: 3,
	email: 'a@example.test',
	emailVerified: false,
	passwordHash: 'h',
};

const harness = () => {
	const repo = {
		findAuthStateById: vi.fn(async () => activeUser as unknown),
		findAuthStateByEmail: vi.fn(async () => null as unknown),
		setPasswordHash: vi.fn(async () => {}),
		recordSuccessfulLogin: vi.fn(async () => {}),
	};
	const auth = {
		normalizeEmail: (value: string) => value.toLowerCase(),
		customerAuthRepository: repo,
		customerRepository: { save: vi.fn(async (row: { id: string }) => row) },
		publicCustomer: vi.fn(
			async () =>
				({
					id: 'cus_1',
					email: 'a@example.test',
					phone: '+91',
					emailVerified: true,
					phoneVerified: true,
				}) as unknown,
		),
		hashPassword: vi.fn(async () => 'hashed'),
		consumeRateLimit: vi.fn(async () => ({ allowed: true }) as unknown),
		checkRateLimit: vi.fn(async () => ({ allowed: true }) as unknown),
		recordRateLimitFailure: vi.fn(async () => {}),
		clearRateLimitIdentifier: vi.fn(async () => {}),
		issueOtp: vi.fn(async () => {}),
		verifyOtp: vi.fn(async () => ({ userId: 'cus_1' }) as unknown),
		assertStepUp: vi.fn(async () => {}),
		findCustomerByIdentifier: vi.fn(async () => activeUser as unknown),
		verifyPassword: vi.fn(async () => true),
		startPasswordReset: vi.fn(async () => {}),
		completePasswordReset: vi.fn(async () => ({ userId: 'cus_1' }) as unknown),
		activateCustomer: vi.fn(async () => ({ userId: 'cus_1' }) as unknown),
		completeEmailVerification: vi.fn(async () => true),
		issueEmailVerification: vi.fn(async () => {}),
	};
	const sessions = {
		establish: vi.fn(async () => ({ session })),
		refresh: vi.fn(async () => ({ session })),
		revoke: vi.fn(async () => {}),
		revokeAllForUser: vi.fn(async () => {}),
		clearCookies: vi.fn(),
		revokeOtherSessions: vi.fn(async () => 2),
		listOwnSessions: vi.fn(async () => ({ items: [] })),
		revokeOwnSession: vi.fn(async () => ({ wasCurrent: false })),
	};
	const carts = { mergeGuestCartForUser: vi.fn(async () => {}) };
	const record = {
		id: 'ps1',
		origin: 'password',
		email: { value: 'a@example.test' },
		phone: { value: '+91' },
		displayName: 'A',
		guestCartId: null,
		provider: null,
		providerSubject: null,
	};
	const signup = {
		find: vi.fn(async () => record as unknown),
		toState: vi.fn(() => 'state'),
		discard: vi.fn(async () => {}),
		newSessionKey: vi.fn(() => 'new-key'),
		start: vi.fn(async () => record),
		require: vi.fn(async () => record as unknown),
		setField: vi.fn(async () => record),
		requestOtp: vi.fn(async () => record),
		verifyOtp: vi.fn(async () => ({ record, existingCustomerId: null as string | null, accountUsable: true })),
		provenOwner: vi.fn(async () => 'cus_1' as string | null),
		consume: vi.fn(async () => record as unknown),
		resolve: vi.fn(async () => ({ kind: 'new' }) as { kind: string }),
		attachProvider: vi.fn(async () => {}),
	};
	const oauth = {
		start: vi.fn(async () => 'started'),
		verify: vi.fn(async () => ({
			identity: {
				provider: 'google',
				subject: 's',
				email: 'g@example.test',
				emailVerified: true,
				displayName: 'G',
			} as Record<string, unknown>,
			guestCartId: null,
		})),
		signInCustomerIdFor: vi.fn(async () => null as string | null),
		link: vi.fn(async () => {}),
		unlink: vi.fn(async () => {}),
		listIdentities: vi.fn(async () => [] as unknown[]),
	};
	const transactions = { withTransaction: vi.fn(async (work: () => Promise<unknown>) => work()) };
	const config = { cookies: {}, nodeEnv: 'test', cookieDomain: undefined, sessions: {} };
	const controller = new StorefrontAuthController(
		auth as never,
		sessions as never,
		carts as never,
		signup as never,
		oauth as never,
		transactions as never,
		config as never,
	);
	return { controller, auth, repo, sessions, carts, signup, oauth, transactions, record };
};

const names = cookieNames({ cookies: {}, nodeEnv: 'test', cookieDomain: undefined, sessions: {} } as never);
const request = (cookies: Record<string, string> = {}) => ({ cookies, ip: '1.2.3.4' }) as never;
const reply = () => ({ setCookie: vi.fn(), header: vi.fn() });

const code = async (work: Promise<unknown>) => {
	const error = (await work.catch((caught: unknown) => caught)) as HttpException;
	return (
		(error.getResponse() as { reason?: string; code?: string; message?: string }).reason ??
		JSON.stringify(error.getResponse())
	);
};

let h: ReturnType<typeof harness>;

beforeEach(() => {
	h = harness();
});

describe('signup steps', () => {
	it('reads the signup in flight, or none', async () => {
		expect(await h.controller.currentSignup(request())).toEqual({ pending: 'state' });
		h.signup.find.mockResolvedValue(null);
		expect(await h.controller.currentSignup(request())).toEqual({ pending: null });
	});

	it('drops the signup and its cookie', async () => {
		const response = reply();
		await h.controller.discardSignup(request(), response as never);
		expect(h.signup.discard).toHaveBeenCalledWith(null);
		expect(response.setCookie).toHaveBeenCalledTimes(1);
	});

	it('starts with a new key, or the key already on the browser', async () => {
		const body = { email: 'a@example.test', phone: '+91', displayName: 'A', marketingOptIn: false };
		await h.controller.startSignup({ ...body, guestCartId: 'g1' } as never, request(), reply() as never);
		expect(h.signup.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ sessionKey: 'new-key', guestCartId: 'g1' }),
		);
		await h.controller.startSignup(body as never, request({ [names.signup]: 'kept' }), reply() as never);
		expect(h.signup.newSessionKey).toHaveBeenCalledTimes(1);
		expect(h.signup.start).toHaveBeenLastCalledWith(expect.objectContaining({ guestCartId: null }));
	});

	it('sets a field, sends a code, and verifies it', async () => {
		expect(await h.controller.updateSignupField({ field: 'email', value: 'x' } as never, request())).toBe('state');
		expect(await h.controller.requestSignupOtp({ field: 'email' } as never, request())).toBe('state');
		expect(await h.controller.verifySignupOtp({ field: 'email', code: '1' } as never, request())).toEqual({
			state: 'state',
			existingAccount: false,
			accountUsable: true,
		});
		h.signup.verifyOtp.mockResolvedValue({ record: h.record, existingCustomerId: 'cus_9', accountUsable: false });
		expect(
			(await h.controller.verifySignupOtp({ field: 'email', code: '1' } as never, request())).existingAccount,
		).toBe(true);
	});

	it.each([
		[
			'field',
			(c: StorefrontAuthController) => c.updateSignupField({ field: 'email', value: 'x' } as never, request()),
		],
		['otp request', (c: StorefrontAuthController) => c.requestSignupOtp({ field: 'email' } as never, request())],
		[
			'otp verify',
			(c: StorefrontAuthController) => c.verifySignupOtp({ field: 'email', code: '1' } as never, request()),
		],
	])('turns a signup error into a coded refusal on %s', async (_label, call) => {
		h.signup.require.mockRejectedValue(new SignupError('signup_expired' as never));
		expect(await code(call(h.controller))).toContain('signup_expired');
	});
});

describe('refusals', () => {
	it.each([
		['state', new OAuthStateInvalidError(), 'oauth_state_invalid'],
		['conflict', new OAuthIdentityConflictError(), 'oauth_identity_conflict'],
		['provider', new OAuthProviderUnavailableError('google'), 'oauth_provider_unavailable'],
		['token', new OAuthTokenInvalidError('google', 'bad'), 'oauth_token_invalid'],
		['duplicate', new DuplicateIdentifierError('email'), 'signup_identifier_taken'],
	])('codes %s', async (_label, error, expected) => {
		h.oauth.start.mockRejectedValue(error);
		expect(await code(h.controller.startOAuth({ provider: 'google' } as never))).toContain(expected);
	});

	it('passes on anything else', async () => {
		h.oauth.start.mockRejectedValue(new Error('disk full'));
		await expect(h.controller.startOAuth({ provider: 'google', guestCartId: 'g' } as never)).rejects.toThrow(
			'disk full',
		);
		h.oauth.start.mockRejectedValue('text');
		await expect(h.controller.startOAuth({ provider: 'google' } as never)).rejects.toBe('text');
	});

	it('starts a provider round trip', async () => {
		expect(await h.controller.startOAuth({ provider: 'google', guestCartId: 'g' } as never)).toBe('started');
		expect(h.oauth.start).toHaveBeenLastCalledWith({ provider: 'google', guestCartId: 'g' });
		await h.controller.startOAuth({ provider: 'google' } as never);
		expect(h.oauth.start).toHaveBeenLastCalledWith({ provider: 'google', guestCartId: null });
	});
});

describe('signing in from a signup', () => {
	const body = { field: 'email' } as never;

	it('needs a proven owner on an active account', async () => {
		h.signup.provenOwner.mockResolvedValue(null);
		expect(await code(h.controller.signInFromSignup(body, request(), reply() as never))).toContain(
			'signup_no_existing_account',
		);
		h.signup.provenOwner.mockResolvedValue('cus_1');
		h.repo.findAuthStateById.mockResolvedValue(null);
		expect(await code(h.controller.signInFromSignup(body, request(), reply() as never))).toContain(
			'account_not_accessible',
		);
		h.repo.findAuthStateById.mockResolvedValue({ ...activeUser, status: 'disabled' });
		expect(await code(h.controller.signInFromSignup(body, request(), reply() as never))).toContain(
			'account_not_accessible',
		);
	});

	it('spends the proof and opens a session', async () => {
		const result = await h.controller.signInFromSignup(body, request(), reply() as never);
		expect(result.session).toEqual({ audience: 'storefront', expiresAt: 'e', refreshExpiresAt: 'a' });
		expect(h.signup.consume).toHaveBeenCalledTimes(1);
		expect(h.carts.mergeGuestCartForUser).toHaveBeenCalledWith('cus_1', null);
	});
});

describe('guest cart adoption', () => {
	it('clears the guest cookie after a merge', async () => {
		const response = reply();
		await h.controller.login(
			{ identifier: 'a@example.test', password: 'p' } as never,
			request({ [names.guest]: 'token' }),
			response as never,
		);
		expect(h.carts.mergeGuestCartForUser).toHaveBeenCalledWith('cus_1', 'token');
		expect(response.setCookie).toHaveBeenCalledTimes(1);
	});

	it('never fails a sign-in because a merge failed', async () => {
		h.carts.mergeGuestCartForUser.mockRejectedValue(new Error('cart down'));
		await expect(
			h.controller.login({ identifier: 'a@example.test', password: 'p' } as never, request(), reply() as never),
		).resolves.toBeDefined();
	});

	it('copes with a request that has no cookies at all', async () => {
		await expect(
			h.controller.login(
				{ email: 'A@Example.test', password: 'p' } as never,
				{ ip: '1.2.3.4' } as never,
				reply() as never,
			),
		).resolves.toBeDefined();
		expect(h.auth.findCustomerByIdentifier).toHaveBeenCalledWith('a@example.test');
		await expect(h.controller.currentSignup({ ip: '1' } as never)).resolves.toBeDefined();
	});
});

describe('finalising a signup', () => {
	const body = { password: 'Strong-Pass-123!' } as never;

	it('needs a strong password on a password signup, before spending the proof', async () => {
		expect(await code(h.controller.finaliseSignup({} as never, request(), reply() as never))).toContain(
			'signup_incomplete',
		);
		await expect(
			h.controller.finaliseSignup({ password: 'x' } as never, request(), reply() as never),
		).rejects.toBeDefined();
		expect(h.signup.consume).not.toHaveBeenCalled();
	});

	it('refuses a clash without spending the proof', async () => {
		h.signup.resolve.mockResolvedValue({ kind: 'conflict' });
		expect(await code(h.controller.finaliseSignup(body, request(), reply() as never))).toContain(
			'signup_identifier_conflict',
		);
		h.signup.resolve.mockResolvedValue({ kind: 'existing' });
		expect(await code(h.controller.finaliseSignup(body, request(), reply() as never))).toContain(
			'signup_identifier_taken',
		);
		expect(h.signup.consume).not.toHaveBeenCalled();
	});

	it('creates the account with its password', async () => {
		const result = await h.controller.finaliseSignup(body, request(), reply() as never);
		expect(result.user).toBeDefined();
		expect(h.repo.setPasswordHash).toHaveBeenCalledTimes(1);
		expect(h.oauth.link).not.toHaveBeenCalled();
	});

	it('links the provider on a social signup, with no password needed', async () => {
		h.signup.require.mockResolvedValue({ ...h.record, origin: 'google' });
		h.signup.consume.mockResolvedValue({
			...h.record,
			origin: 'google',
			displayName: null,
			provider: 'google',
			providerSubject: 'sub',
		});
		h.repo.findAuthStateById.mockResolvedValue(null);
		await h.controller.finaliseSignup({} as never, request(), reply() as never);
		expect(h.oauth.link).toHaveBeenCalledWith(expect.any(String), {
			provider: 'google',
			subject: 'sub',
			email: 'a@example.test',
		});
		expect(h.repo.setPasswordHash).not.toHaveBeenCalled();
		expect(h.sessions.establish).toHaveBeenCalledWith(
			expect.objectContaining({ user: expect.objectContaining({ tokenVersion: 0 }) }),
		);
	});

	it('skips the link when only half the provider is known', async () => {
		h.signup.consume.mockResolvedValue({ ...h.record, provider: 'google', providerSubject: null });
		await h.controller.finaliseSignup(body, request(), reply() as never);
		expect(h.oauth.link).not.toHaveBeenCalled();
	});
});

describe('provider sign-in', () => {
	it('signs in a known subject', async () => {
		h.oauth.signInCustomerIdFor.mockResolvedValue('cus_1');
		const result = await h.controller.verifyGoogle(
			{ stateId: 's', credential: 'c', nonce: 'n' } as never,
			request(),
			reply() as never,
		);
		expect(result).toMatchObject({ outcome: 'signed_in', pendingSignup: null });
		expect(h.oauth.verify).toHaveBeenCalledWith({ provider: 'google', stateId: 's', credential: 'c', nonce: 'n' });
	});

	it('copes with a known subject whose state is gone', async () => {
		h.oauth.signInCustomerIdFor.mockResolvedValue('cus_1');
		h.repo.findAuthStateById.mockResolvedValue(null);
		await h.controller.verifyGoogle({ stateId: 's', credential: 'c' } as never, request(), reply() as never);
		expect(h.oauth.verify).toHaveBeenCalledWith(expect.objectContaining({ nonce: null }));
		expect(h.sessions.establish).toHaveBeenCalledWith(
			expect.objectContaining({ user: expect.objectContaining({ tokenVersion: 0 }) }),
		);
	});

	it('offers a code when a verified address has an account', async () => {
		h.repo.findAuthStateByEmail.mockResolvedValue({ status: 'active', email: 'stored@example.test' });
		expect(
			await h.controller.verifyGoogle({ stateId: 's', credential: 'c' } as never, request(), reply() as never),
		).toMatchObject({
			outcome: 'account_exists',
			existingAccountEmail: 'stored@example.test',
		});
		h.repo.findAuthStateByEmail.mockResolvedValue({ status: 'active', email: null });
		expect(
			(await h.controller.verifyGoogle({ stateId: 's', credential: 'c' } as never, request(), reply() as never))
				.existingAccountEmail,
		).toBe('g@example.test');
	});

	it('refuses an account that cannot be used', async () => {
		h.repo.findAuthStateByEmail.mockResolvedValue({ status: 'disabled' });
		expect(
			await code(
				h.controller.verifyGoogle({ stateId: 's', credential: 'c' } as never, request(), reply() as never),
			),
		).toContain('account_not_accessible');
	});

	it('begins a signup for a new person', async () => {
		const response = reply();
		const result = await h.controller.verifyGoogle(
			{ stateId: 's', credential: 'c' } as never,
			request({ [names.signup]: 'kept' }),
			response as never,
		);
		expect(result).toMatchObject({ outcome: 'signup_required', pendingSignup: 'state' });
		expect(h.signup.attachProvider).toHaveBeenCalledTimes(1);
		expect(h.signup.start).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: 'kept', emailLocked: true }));
	});

	it('treats a Facebook address as a suggestion, and copes with nothing supplied', async () => {
		h.oauth.verify.mockResolvedValue({
			identity: { provider: 'facebook', subject: 's', email: null, emailVerified: false, displayName: null },
			guestCartId: null,
		});
		await h.controller.verifyFacebook({ stateId: 's', accessToken: 't' } as never, request(), reply() as never);
		expect(h.repo.findAuthStateByEmail).not.toHaveBeenCalled();
		expect(h.signup.start).toHaveBeenCalledWith(
			expect.objectContaining({ sessionKey: 'new-key', email: undefined, displayName: undefined }),
		);
		h.oauth.verify.mockResolvedValue({
			identity: {
				provider: 'facebook',
				subject: 's',
				email: 'f@example.test',
				emailVerified: false,
				displayName: 'F',
			},
			guestCartId: null,
		});
		await h.controller.verifyFacebook({ stateId: 's', accessToken: 't' } as never, request(), reply() as never);
		expect(h.repo.findAuthStateByEmail).not.toHaveBeenCalled();
	});

	it('skips the lookup for a verified identity with no address', async () => {
		h.oauth.verify.mockResolvedValue({
			identity: { provider: 'google', subject: 's', email: null, emailVerified: true, displayName: null },
			guestCartId: null,
		});
		await h.controller.verifyGoogle({ stateId: 's', credential: 'c' } as never, request(), reply() as never);
		expect(h.repo.findAuthStateByEmail).not.toHaveBeenCalled();
	});

	it('codes a verification failure', async () => {
		h.oauth.verify.mockRejectedValue(new OAuthTokenInvalidError('google', 'bad'));
		expect(
			await code(
				h.controller.verifyGoogle({ stateId: 's', credential: 'c' } as never, request(), reply() as never),
			),
		).toContain('oauth_token_invalid');
	});
});

describe('sign-in methods', () => {
	it('needs a session everywhere', async () => {
		await expect(h.controller.loginMethods(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(
			h.controller.requestStepUp({ channel: 'email' } as never, undefined, reply() as never, request()),
		).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(h.controller.connectIdentity({} as never, undefined)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(h.controller.disconnectIdentity({} as never, undefined)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(h.controller.setPassword({} as never, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		expect(() => h.controller.listSessions(undefined)).toThrow(UnauthorizedException);
		await expect(h.controller.revokeSession('s', undefined, reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(h.controller.revokeOtherSessions(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(h.controller.resendVerification(undefined, request())).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
	});

	it('lists both providers and the step-up method', async () => {
		h.oauth.listIdentities.mockResolvedValue([
			{ provider: 'google', email: 'g@example.test', linkedAt: 'l' },
			{ provider: 'facebook' },
		]);
		const methods = await h.controller.loginMethods(principal);
		expect(methods.passwordSet).toBe(true);
		expect(methods.identities).toEqual([
			{ provider: 'google', connected: true, email: 'g@example.test', linkedAt: 'l' },
			{ provider: 'facebook', connected: true, email: null, linkedAt: null },
		]);
	});

	it('reads an account with no password or state', async () => {
		h.repo.findAuthStateById.mockResolvedValue(null);
		const methods = await h.controller.loginMethods(principal);
		expect(methods.passwordSet).toBe(false);
		expect(methods.identities[0]).toEqual({ provider: 'google', connected: false, email: null, linkedAt: null });
	});

	it('sends a step-up code to the chosen channel', async () => {
		await h.controller.requestStepUp({ channel: 'sms' } as never, principal, reply() as never, request());
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(
			expect.objectContaining({ identifier: '+91', channel: 'sms' }),
		);
		await h.controller.requestStepUp({ channel: 'email' } as never, principal, reply() as never, request());
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(
			expect.objectContaining({ identifier: 'a@example.test', channel: 'email' }),
		);
	});

	it('refuses a channel the account lacks, and a spent budget', async () => {
		h.auth.publicCustomer.mockResolvedValue({ email: null, phone: null });
		expect(
			await code(
				h.controller.requestStepUp({ channel: 'email' } as never, principal, reply() as never, request()),
			),
		).toContain('step_up_required');
		h.auth.publicCustomer.mockResolvedValue({ email: 'a@example.test', phone: null });
		h.auth.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
		const response = reply();
		await expect(
			h.controller.requestStepUp({ channel: 'email' } as never, principal, response as never, request()),
		).rejects.toBeInstanceOf(HttpException);
	});

	it('connects after step-up, with or without a nonce', async () => {
		const body = { provider: 'google', stateId: 's', credential: 'c', password: 'p', otpCode: '1' };
		await h.controller.connectIdentity({ ...body, nonce: 'n' } as never, principal);
		expect(h.auth.assertStepUp).toHaveBeenCalledWith('cus_1', { password: 'p', otpCode: '1' });
		expect(h.oauth.verify).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: 'n' }));
		await h.controller.connectIdentity(body as never, principal);
		expect(h.oauth.verify).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: null }));
		expect(h.oauth.link).toHaveBeenCalledTimes(2);
	});

	it('codes a failed connect', async () => {
		h.oauth.verify.mockRejectedValue(new OAuthIdentityConflictError());
		expect(await code(h.controller.connectIdentity({ provider: 'google' } as never, principal))).toContain(
			'oauth_identity_conflict',
		);
	});

	it('disconnects, unless it is the last way in', async () => {
		await h.controller.disconnectIdentity({ provider: 'google' } as never, principal);
		expect(h.oauth.unlink).toHaveBeenCalledWith('cus_1', 'google');
		h.repo.findAuthStateById.mockResolvedValue(null);
		h.auth.publicCustomer.mockResolvedValue({ emailVerified: false, phoneVerified: false });
		h.oauth.listIdentities.mockResolvedValue([{ provider: 'google' }]);
		await expect(
			h.controller.disconnectIdentity({ provider: 'google' } as never, principal),
		).rejects.toBeInstanceOf(HttpException);
		expect(h.oauth.unlink).toHaveBeenCalledTimes(1);
	});

	it('sets a password and signs other devices out', async () => {
		await h.controller.setPassword({ newPassword: 'Strong-Pass-123!' } as never, principal);
		expect(h.repo.setPasswordHash).toHaveBeenCalledWith('cus_1', 'hashed');
		expect(h.sessions.revokeOtherSessions).toHaveBeenCalledWith(principal);
	});

	it('codes a failed password change', async () => {
		h.auth.assertStepUp.mockRejectedValue(new SignupError('signup_expired' as never));
		expect(await code(h.controller.setPassword({ newPassword: 'Strong-Pass-123!' } as never, principal))).toContain(
			'signup_expired',
		);
	});
});

describe('password login', () => {
	const body = { identifier: 'A@Example.test', password: 'p' } as never;

	it('states a network limit, and hides an account limit', async () => {
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, scope: 'ip', retryAfterSeconds: 5 });
		const limited = await h.controller.login(body, request(), reply() as never).catch((caught: unknown) => caught);
		expect((limited as HttpException).getStatus()).toBe(429);
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, scope: 'identifier' });
		await expect(h.controller.login(body, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
	});

	it.each([
		['an unknown address', { user: null, valid: false }],
		['a wrong password', { user: activeUser, valid: false }],
		['a disabled account', { user: { ...activeUser, status: 'disabled' }, valid: true }],
	])('gives one answer for %s', async (_label, { user, valid }) => {
		h.auth.findCustomerByIdentifier.mockResolvedValue(user);
		h.auth.verifyPassword.mockResolvedValue(valid);
		await expect(h.controller.login(body, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		expect(h.auth.recordRateLimitFailure).toHaveBeenCalledTimes(1);
	});

	it('takes a phone number as typed, and honours remember me', async () => {
		await h.controller.login(
			{ identifier: ' +91 ', password: 'p', rememberMe: true } as never,
			request(),
			reply() as never,
		);
		expect(h.auth.findCustomerByIdentifier).toHaveBeenCalledWith('+91');
		expect(h.sessions.establish).toHaveBeenCalledWith(expect.objectContaining({ persistent: true }));
		await h.controller.login({ password: 'p' } as never, request(), reply() as never);
		expect(h.sessions.establish).toHaveBeenLastCalledWith(expect.objectContaining({ persistent: false }));
	});
});

describe('code login', () => {
	it('answers alike whatever happens', async () => {
		h.auth.consumeRateLimit.mockResolvedValue({ allowed: false });
		const refused = await h.controller.requestOtp(
			{ identifier: 'a@example.test', purpose: 'login' } as never,
			request(),
		);
		h.auth.consumeRateLimit.mockResolvedValue({ allowed: true });
		h.auth.findCustomerByIdentifier.mockResolvedValue(null);
		const unknown = await h.controller.requestOtp(
			{ identifier: 'a@example.test', purpose: 'login' } as never,
			request(),
		);
		h.auth.findCustomerByIdentifier.mockResolvedValue({ ...activeUser, status: 'disabled' });
		const disabled = await h.controller.requestOtp(
			{ identifier: 'a@example.test', purpose: 'login' } as never,
			request(),
		);
		expect(refused).toEqual(unknown);
		expect(unknown).toEqual(disabled);
		expect(h.auth.issueOtp).not.toHaveBeenCalled();
	});

	it('sends by the channel the person gave, and for any other purpose too', async () => {
		await h.controller.requestOtp({ identifier: '+91', purpose: 'login' } as never, request());
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'sms', userId: 'cus_1' }));
		await h.controller.requestOtp({ identifier: 'a@example.test', purpose: 'login' } as never, request());
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'email' }));
		h.auth.findCustomerByIdentifier.mockResolvedValue(null);
		await h.controller.requestOtp({ identifier: 'a@example.test', purpose: 'verify' } as never, request());
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(expect.objectContaining({ userId: null }));
	});

	const verify = { identifier: 'a@example.test', code: '1' } as never;

	it('states a network limit, and hides an account limit', async () => {
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, scope: 'ip', retryAfterSeconds: 5 });
		expect(
			(
				(await h.controller
					.verifyOtp(verify, request(), reply() as never)
					.catch((caught: unknown) => caught)) as HttpException
			).getStatus(),
		).toBe(429);
		h.auth.checkRateLimit.mockResolvedValue({ allowed: false, scope: 'identifier' });
		await expect(h.controller.verifyOtp(verify, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
	});

	it('counts a bad code', async () => {
		h.auth.verifyOtp.mockResolvedValue(null);
		await expect(h.controller.verifyOtp(verify, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		h.auth.verifyOtp.mockResolvedValue({ userId: null });
		await expect(h.controller.verifyOtp(verify, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		expect(h.auth.recordRateLimitFailure).toHaveBeenCalledTimes(2);
	});

	it('refuses an account that is gone or disabled', async () => {
		h.repo.findAuthStateById.mockResolvedValue(null);
		await expect(h.controller.verifyOtp(verify, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		h.repo.findAuthStateById.mockResolvedValue({ ...activeUser, status: 'disabled' });
		await expect(h.controller.verifyOtp(verify, request(), reply() as never)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
	});

	it('signs in, honouring remember me', async () => {
		await h.controller.verifyOtp(
			{ identifier: 'a@example.test', code: '1', rememberMe: true } as never,
			request(),
			reply() as never,
		);
		expect(h.sessions.establish).toHaveBeenLastCalledWith(expect.objectContaining({ persistent: true }));
		await h.controller.verifyOtp(verify, request(), reply() as never);
		expect(h.sessions.establish).toHaveBeenLastCalledWith(expect.objectContaining({ persistent: false }));
	});
});

describe('session and password routes', () => {
	it('refreshes and logs out', async () => {
		expect((await h.controller.refresh(request(), reply() as never)).session.audience).toBe('storefront');
		await h.controller.logout(request(), reply() as never);
		expect(h.sessions.revoke).toHaveBeenCalledTimes(1);
	});

	it('starts a reset only within budget, and answers alike', async () => {
		const sent = await h.controller.forgotPassword({ identifier: 'a@example.test' } as never, request());
		h.auth.consumeRateLimit.mockResolvedValue({ allowed: false });
		const refused = await h.controller.forgotPassword({ identifier: 'a@example.test' } as never, request());
		expect(sent).toEqual(refused);
		expect(h.auth.startPasswordReset).toHaveBeenCalledTimes(1);
	});

	it('completes a reset and an activation, signing everyone out', async () => {
		await h.controller.resetPassword({ token: 't', newPassword: 'n' } as never, reply() as never);
		await h.controller.activate({ token: 't', newPassword: 'n' } as never, reply() as never);
		expect(h.sessions.revokeAllForUser).toHaveBeenCalledTimes(2);
		expect(h.sessions.clearCookies).toHaveBeenCalledTimes(2);
	});

	it('refuses a bad token', async () => {
		h.auth.completePasswordReset.mockResolvedValue(null);
		await expect(
			h.controller.resetPassword({ token: 't', newPassword: 'n' } as never, reply() as never),
		).rejects.toBeInstanceOf(UnauthorizedException);
		h.auth.activateCustomer.mockResolvedValue(null);
		await expect(
			h.controller.activate({ token: 't', newPassword: 'n' } as never, reply() as never),
		).rejects.toBeInstanceOf(UnauthorizedException);
		h.auth.completeEmailVerification.mockResolvedValue(false);
		await expect(h.controller.verifyEmail({ token: 't' } as never)).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('verifies an email', async () => {
		await expect(h.controller.verifyEmail({ token: 't' } as never)).resolves.toBeUndefined();
	});

	it('reads who is signed in', async () => {
		expect(await h.controller.me(undefined)).toEqual({ user: null });
		expect((await h.controller.me(principal)).user).toBeDefined();
	});

	it('lists and revokes own sessions, clearing cookies for the current one', async () => {
		expect(await h.controller.listSessions(principal)).toEqual({ items: [] });
		await h.controller.revokeSession('s', principal, reply() as never);
		expect(h.sessions.clearCookies).not.toHaveBeenCalled();
		h.sessions.revokeOwnSession.mockResolvedValue({ wasCurrent: true });
		await h.controller.revokeSession('s', principal, reply() as never);
		expect(h.sessions.clearCookies).toHaveBeenCalledTimes(1);
		expect(await h.controller.revokeOtherSessions(principal)).toEqual({ revoked: 2 });
	});

	it('resends a verification only when it is needed and within budget', async () => {
		await h.controller.resendVerification(principal, request());
		expect(h.auth.issueEmailVerification).toHaveBeenCalledTimes(1);
		h.auth.consumeRateLimit.mockResolvedValue({ allowed: false });
		await h.controller.resendVerification(principal, request());
		expect(h.auth.issueEmailVerification).toHaveBeenCalledTimes(1);
		h.repo.findAuthStateById.mockResolvedValue({ ...activeUser, emailVerified: true });
		await h.controller.resendVerification(principal, request());
		h.repo.findAuthStateById.mockResolvedValue({ ...activeUser, email: null });
		await h.controller.resendVerification(principal, request());
		h.repo.findAuthStateById.mockResolvedValue(null);
		await h.controller.resendVerification(principal, request());
		expect(h.auth.issueEmailVerification).toHaveBeenCalledTimes(1);
	});
});
