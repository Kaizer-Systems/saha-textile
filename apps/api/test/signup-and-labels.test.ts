import { beforeEach, describe, expect, it, vi } from 'vitest';

import { labelFromUserAgent, shouldBackfillDeviceLabel } from '../src/auth/device-label';
import { SignupError, SignupService } from '../src/auth/signup.service';

const field = (overrides: Record<string, unknown> = {}) => ({
	value: 'a@example.test',
	verified: false,
	locked: false,
	sends: 0,
	lastSentAt: null,
	...overrides,
});

const record = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'ps1',
		origin: 'password',
		email: field(),
		phone: field({ value: '+91' }),
		displayName: 'A',
		expiresAt: '2099-01-01T00:00:00.000Z',
		absoluteExpiresAt: '2099-06-01T00:00:00.000Z',
		...overrides,
	}) as never;

const harness = () => {
	const pending = {
		start: vi.fn(async (row: unknown) => row),
		findBySessionKey: vi.fn(async () => null as unknown),
		setFieldValue: vi.fn(async () => 'set' as unknown),
		recordSend: vi.fn(async () => 'sent' as unknown),
		markVerified: vi.fn(async () => 'verified' as unknown),
		consume: vi.fn(async () => 'consumed' as unknown),
		attachProvider: vi.fn(async () => 'attached' as unknown),
	};
	const customers = {
		findById: vi.fn(async () => ({ status: 'active' }) as unknown),
		findByPhone: vi.fn(async () => null as unknown),
	};
	const customerAuth = { findAuthStateByEmail: vi.fn(async () => null as unknown) };
	const auth = {
		normalizeEmail: (value: string) => value.trim().toLowerCase(),
		issueOtp: vi.fn(async () => {}),
		verifyOtp: vi.fn(async () => ({ userId: null }) as unknown),
	};
	const service = new SignupService(
		{} as never,
		pending as never,
		customers as never,
		customerAuth as never,
		auth as never,
	);
	return { service, pending, customers, customerAuth, auth };
};

let h: ReturnType<typeof harness>;

beforeEach(() => {
	h = harness();
});

describe('starting', () => {
	it('mints a key', () => {
		expect(h.service.newSessionKey()).toMatch(/^psk_/);
	});

	it('fills what it is given, and leaves the rest empty', async () => {
		const full = (await h.service.start({
			sessionKey: 'k',
			origin: 'password',
			email: ' A@Example.test ',
			phone: '+91',
			displayName: 'A',
			marketingOptIn: false,
			guestCartId: 'g',
		} as never)) as unknown as Record<string, { value: unknown }>;
		expect(full['email']?.value).toBe('a@example.test');
		expect(full['phone']?.value).toBe('+91');
		const bare = (await h.service.start({
			sessionKey: 'k',
			origin: 'google',
			marketingOptIn: false,
		} as never)) as unknown as Record<string, unknown>;
		expect(bare).toMatchObject({
			email: { value: null },
			phone: { value: null },
			displayName: null,
			guestCartId: null,
		});
	});
});

describe('requiring a record', () => {
	it('refuses when there is none', async () => {
		await expect(h.service.require(null)).rejects.toBeInstanceOf(SignupError);
	});
});

describe('setting a field', () => {
	it('leaves a locked field alone', async () => {
		const locked = record({ email: field({ locked: true }) });
		expect(await h.service.setField(locked, 'email', 'x')).toBe(locked);
	});

	it('normalises each kind, and keeps the record if the write missed', async () => {
		await h.service.setField(record(), 'email', ' B@Example.test ');
		expect(h.pending.setFieldValue).toHaveBeenLastCalledWith('ps1', 'email', 'b@example.test');
		await h.service.setField(record(), 'phone', ' +91 ');
		expect(h.pending.setFieldValue).toHaveBeenLastCalledWith('ps1', 'phone', '+91');
		h.pending.setFieldValue.mockResolvedValue(null);
		const kept = record();
		expect(await h.service.setField(kept, 'email', 'x')).toBe(kept);
	});
});

describe('sending a code', () => {
	it('needs a value and budget', async () => {
		await expect(h.service.requestOtp(record({ email: field({ value: null }) }), 'email')).rejects.toMatchObject({
			code: 'otp_invalid',
		});
		await expect(h.service.requestOtp(record({ email: field({ sends: 99 }) }), 'email')).rejects.toMatchObject({
			code: 'otp_send_limit_reached',
		});
	});

	it('respects the wait since the last send', async () => {
		const recent = record({ email: field({ sends: 1, lastSentAt: new Date().toISOString() }) });
		await expect(h.service.requestOtp(recent, 'email')).rejects.toMatchObject({ code: 'otp_send_limit_reached' });
		const old = record({ email: field({ sends: 1, lastSentAt: '2000-01-01T00:00:00.000Z' }) });
		await expect(h.service.requestOtp(old, 'email')).resolves.toBe('sent');
	});

	it('uses the right channel, and keeps the record if the write missed', async () => {
		await h.service.requestOtp(record(), 'email');
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'email' }));
		h.pending.recordSend.mockResolvedValue(null);
		const kept = record();
		expect(await h.service.requestOtp(kept, 'phone')).toBe(kept);
		expect(h.auth.issueOtp).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'sms' }));
	});
});

describe('verifying a code', () => {
	it('needs a value and a right code', async () => {
		await expect(
			h.service.verifyOtp(record({ email: field({ value: null }) }), 'email', '1'),
		).rejects.toMatchObject({ code: 'otp_invalid' });
		h.auth.verifyOtp.mockResolvedValue(null);
		await expect(h.service.verifyOtp(record(), 'email', '1')).rejects.toMatchObject({ code: 'otp_invalid' });
	});

	it('reports no owner for a fresh address', async () => {
		expect(await h.service.verifyOtp(record(), 'email', '1')).toEqual({
			record: 'verified',
			existingCustomerId: null,
			accountUsable: true,
		});
	});

	it('names an owner, and says if the account can be used', async () => {
		h.customerAuth.findAuthStateByEmail.mockResolvedValue({ id: 'cus_1' });
		expect(await h.service.verifyOtp(record(), 'email', '1')).toMatchObject({
			existingCustomerId: 'cus_1',
			accountUsable: true,
		});
		h.customers.findById.mockResolvedValue({ status: 'deleted' });
		expect((await h.service.verifyOtp(record(), 'email', '1')).accountUsable).toBe(false);
		h.customers.findById.mockResolvedValue(null);
		expect((await h.service.verifyOtp(record(), 'email', '1')).accountUsable).toBe(false);
	});

	it('finds a phone owner, and keeps the record if the write missed', async () => {
		h.customers.findByPhone.mockResolvedValue({ id: 'cus_2' });
		h.pending.markVerified.mockResolvedValue(null);
		const kept = record();
		const result = await h.service.verifyOtp(kept, 'phone', '1');
		expect(result).toMatchObject({ record: kept, existingCustomerId: 'cus_2' });
	});
});

describe('resolving and consuming', () => {
	const verified = () => record({ email: field({ verified: true }), phone: field({ value: '+91', verified: true }) });

	it('needs both fields proven', async () => {
		await expect(h.service.resolve(record())).rejects.toMatchObject({ code: 'signup_incomplete' });
		await expect(h.service.resolve(record({ email: field({ verified: true }) }))).rejects.toMatchObject({
			code: 'signup_incomplete',
		});
	});

	it('resolves a fresh signup', async () => {
		expect((await h.service.resolve(verified())).kind).toBeDefined();
	});

	it('spends the proof once', async () => {
		expect(await h.service.consume(record())).toBe('consumed');
		h.pending.consume.mockResolvedValue(null);
		await expect(h.service.consume(record())).rejects.toMatchObject({ code: 'signup_expired' });
	});

	it('names the owner of a proven field only', async () => {
		await expect(h.service.provenOwner(record(), 'email')).rejects.toMatchObject({ code: 'signup_incomplete' });
		expect(
			await h.service.provenOwner(record({ email: field({ verified: true, value: null }) }), 'email'),
		).toBeNull();
	});

	it('attaches a provider, keeping the record if the write missed', async () => {
		const identity = { provider: 'google', subject: 's' } as never;
		expect(await h.service.attachProvider(record(), identity)).toBe('attached');
		h.pending.attachProvider.mockResolvedValue(null);
		const kept = record();
		expect(await h.service.attachProvider(kept, identity)).toBe(kept);
	});
});

describe('the browser view', () => {
	it('shows a wait after a recent send, and none before', () => {
		const state = h.service.toState(
			record({
				email: field({ sends: 1, lastSentAt: new Date().toISOString() }),
				phone: field({ sends: 1, lastSentAt: '2000-01-01T00:00:00.000Z' }),
			}),
		);
		expect(state.email.resendAvailableAt).toEqual(expect.any(String));
		expect(state.phone.resendAvailableAt).toBeNull();
		expect(state.email.codeSent).toBe(true);
		expect(h.service.toState(record()).email.resendAvailableAt).toBeNull();
	});
});

describe('device labels', () => {
	it.each([
		['Mozilla/5.0 (X11; Linux x86_64) Chrome/120 OPR/100', 'Opera on Linux'],
		['Mozilla/5.0 (Windows NT 10.0; rv:120) Gecko Firefox/120.0', 'Firefox'],
		['Mozilla/5.0 (iPhone) CriOS/120 Mobile', 'Chrome'],
		['Mozilla/5.0 (iPhone) FxiOS/120 Mobile', 'Firefox'],
		['Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Chromium/120', 'Chromium'],
		['Mozilla/5.0 (Linux; Android 13; SM-S901) SamsungBrowser/20 Mobile', 'Samsung Internet'],
		['Mozilla/5.0 (iPad; CPU OS 16) Version/16 Safari/605', 'iPad'],
		['Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile', 'Phone'],
		['Mozilla/5.0 (Linux; Android 13) Chrome/120', 'Tablet'],
		['Mozilla/5.0 (X11; CrOS x86_64) Chrome/120', 'ChromeOS'],
	])('reads %s', (agent, expected) => {
		expect(labelFromUserAgent(agent, 'abcdef0123')).toContain(expected);
	});

	it('leaves the suffix off when there is no hash', () => {
		expect(labelFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/120', null)).toBe(
			'Firefox on Linux (Desktop)',
		);
		expect(labelFromUserAgent(undefined, '!!!')).toBe('Unknown browser');
	});

	it('knows when to rewrite a label', () => {
		expect(shouldBackfillDeviceLabel('Chrome on Mac', ' ')).toBe(false);
	});
});
