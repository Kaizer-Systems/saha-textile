import { describe, expect, it } from 'vitest';

import {
	AdminMeResponse,
	AdminPin,
	AdminPinSetupRequest,
	AuditLog,
	AuthSessionResponse,
	ConsentCategories,
	ConsentUpdateRequest,
	MessageOutboxEntry,
	NotificationChannelSettings,
	OtpCode,
	Password,
	RegisterStorefrontRequest,
	SessionInfo,
} from '../src/index';

/**
 * Representative valid/invalid coverage for the Chunk B Pass 1a families
 * (session, auth, admin-auth, consent, audit, notification). These assert the
 * security-relevant locks — password floor, OTP/PIN shape, anti-leak response
 * shapes, kill-switch structure — not every field.
 */

describe('Password policy floor (12 characters, storefront and admin)', () => {
	it('rejects anything shorter than 12 characters', () => {
		expect(Password.safeParse('Sh0rt!Pass1').success).toBe(false); // 11
		expect(Password.safeParse('L0ngEnough!!').success).toBe(true); // 12
	});

	it('rejects an absurdly long password (hashing DoS guard)', () => {
		expect(Password.safeParse('a'.repeat(257)).success).toBe(false);
	});

	it('applies the floor on registration', () => {
		const request = {
			email: 'customer@example.com',
			password: 'CorrectHorse12',
		};
		expect(RegisterStorefrontRequest.safeParse(request).success).toBe(true);
		expect(RegisterStorefrontRequest.safeParse({ ...request, password: 'tooshort' }).success).toBe(false);
		expect(RegisterStorefrontRequest.safeParse({ ...request, email: 'not-an-email' }).success).toBe(false);
	});
});

describe('OTP and admin PIN shapes', () => {
	it('accepts exactly six digits', () => {
		expect(OtpCode.safeParse('012345').success).toBe(true);
		expect(AdminPin.safeParse('012345').success).toBe(true);
	});

	it('rejects wrong length or non-digits', () => {
		for (const value of ['01234', '0123456', '01234a', '', ' 12345']) {
			expect(OtpCode.safeParse(value).success).toBe(false);
			expect(AdminPin.safeParse(value).success).toBe(false);
		}
	});

	it('always requires password proof to set a PIN', () => {
		expect(AdminPinSetupRequest.safeParse({ pin: '135790' }).success).toBe(false);
		expect(AdminPinSetupRequest.safeParse({ currentPassword: 'CorrectHorse12', pin: '135790' }).success).toBe(true);
	});
});

describe('Browser auth responses never carry tokens', () => {
	const session = {
		audience: 'storefront' as const,
		expiresAt: '2026-07-31T10:00:00.000Z',
		refreshExpiresAt: '2026-08-30T10:00:00.000Z',
	};

	it('SessionInfo strips anything token-shaped', () => {
		const parsed = SessionInfo.parse({ ...session, accessToken: 'leak', refreshToken: 'leak' });
		expect(parsed).toEqual(session);
		expect('accessToken' in parsed).toBe(false);
		expect('refreshToken' in parsed).toBe(false);
	});

	it('AuthSessionResponse returns only sanitized user plus session metadata', () => {
		const parsed = AuthSessionResponse.parse({
			user: { id: 'user_1', email: 'customer@example.com', passwordHash: 'argon2id$leak' },
			session,
		});
		expect('passwordHash' in parsed.user).toBe(false);
		expect(parsed.session.audience).toBe('storefront');
	});

	it('AdminMeResponse exposes no credential material or version counters', () => {
		const parsed = AdminMeResponse.parse({
			user: {
				id: 'user_admin',
				email: 'admin@example.com',
				role: 'admin',
				status: 'active',
				pinHash: 'argon2id$leak',
				tokenVersion: 7,
			},
			session: { ...session, audience: 'admin' },
		});
		expect('pinHash' in parsed.user).toBe(false);
		expect('tokenVersion' in parsed.user).toBe(false);
		expect(parsed.user.preferredLoginMethod).toBe('password');
		expect(parsed.user.pinConfigured).toBe(false);
		expect(parsed.permissions).toEqual([]);
	});
});

describe('Consent', () => {
	it('keeps `necessary` always true and every optional category off by default', () => {
		const categories = ConsentCategories.parse({});
		expect(categories).toEqual({
			necessary: true,
			functional: false,
			analytics: false,
			targeting: false,
			marketing: false,
			promotional: false,
		});
	});

	it('rejects opting out of strictly necessary cookies', () => {
		expect(ConsentCategories.safeParse({ necessary: false }).success).toBe(false);
	});

	it('requires a policy version on every consent write', () => {
		expect(ConsentUpdateRequest.safeParse({ categories: {} }).success).toBe(false);
		expect(ConsentUpdateRequest.safeParse({ categories: {}, policyVersion: '2026-07-01' }).success).toBe(true);
	});
});

describe('Audit log', () => {
	const base = {
		id: 'audit_1',
		audience: 'admin' as const,
		action: 'product.status.change',
		createdAt: '2026-07-31T10:00:00.000Z',
	};

	it('defaults to the five-year catalog/admin retention tier', () => {
		const entry = AuditLog.parse(base);
		expect(entry.retentionTier).toBe('catalog_admin');
		expect(entry.severity).toBe('info');
		expect(entry.actorUserId).toBeNull();
		expect(entry.diffs).toEqual([]);
	});

	it('accepts the seven-year financial/security tier and rejects an unknown one', () => {
		expect(AuditLog.safeParse({ ...base, retentionTier: 'financial_security' }).success).toBe(true);
		expect(AuditLog.safeParse({ ...base, retentionTier: 'forever' }).success).toBe(false);
	});

	it('requires an action and a creation timestamp', () => {
		expect(AuditLog.safeParse({ ...base, action: '' }).success).toBe(false);
		expect(AuditLog.safeParse({ id: 'a', audience: 'admin', action: 'x' }).success).toBe(false);
	});
});

describe('Notification kill-switches', () => {
	it('models one setting per channel × category with spend guards', () => {
		const settings = NotificationChannelSettings.parse({
			id: 'notif_sms_marketing',
			channel: 'sms',
			category: 'marketing',
		});
		expect(settings.enabled).toBe(true);
		expect(settings.planLimit).toBeNull();
		expect(settings.warnThresholdPct).toBe(80);
		expect(settings.autoDisableAtLimit).toBe(false);
	});

	it('rejects an unknown channel or category', () => {
		const base = { id: 'n', channel: 'sms', category: 'marketing' };
		expect(NotificationChannelSettings.safeParse({ ...base, channel: 'push' }).success).toBe(false);
		expect(NotificationChannelSettings.safeParse({ ...base, category: 'promotional' }).success).toBe(false);
	});

	it('records suppression as a first-class outbox status and hashes the destination', () => {
		const entry = MessageOutboxEntry.parse({
			id: 'msg_1',
			channel: 'whatsapp',
			category: 'marketing',
			templateKey: 'promo_launch',
			destinationHash: 'sha256:abc',
			status: 'suppressed_no_consent',
			createdAt: '2026-07-31T10:00:00.000Z',
		});
		expect(entry.status).toBe('suppressed_no_consent');
		expect(entry.attempts).toBe(0);
		expect(entry.sentAt).toBeNull();
	});

	it('requires a destination hash — never a raw phone or email', () => {
		expect(
			MessageOutboxEntry.safeParse({
				id: 'msg_2',
				channel: 'sms',
				category: 'transactional',
				templateKey: 'otp_login',
				destinationHash: '',
				createdAt: '2026-07-31T10:00:00.000Z',
			}).success,
		).toBe(false);
	});
});
