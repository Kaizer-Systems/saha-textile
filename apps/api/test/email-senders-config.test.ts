import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/app-config';
import { emailSenderFor } from '../src/infra/notification-factory';

const baseEnv = {
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const load = (overrides: Record<string, string | undefined> = {}) =>
	loadConfig({ ...baseEnv, ...overrides } as NodeJS.ProcessEnv).notifications.msg91EmailFrom;

describe('email senders (owner decision round 2026-11-20)', () => {
	it('uses the four agreed addresses when nothing is set, or a setting is blank', () => {
		const defaults = {
			account: 'no-reply@sahatextile.com',
			orders: 'orders@sahatextile.com',
			shop: 'notifications@sahatextile.com',
			marketing: 'newsletter@sahatextile.com',
		};
		expect(load()).toEqual(defaults);
		expect(load({ MSG91_EMAIL_FROM_ACCOUNT: '', MSG91_EMAIL_FROM_MARKETING: '' })).toEqual(defaults);
	});

	it('reads one setting per group', () => {
		expect(
			load({
				MSG91_EMAIL_FROM_ACCOUNT: 'no-reply@mail.example.test',
				MSG91_EMAIL_FROM_ORDERS: 'orders@mail.example.test',
				MSG91_EMAIL_FROM_SHOP: 'notifications@mail.example.test',
				MSG91_EMAIL_FROM_MARKETING: 'newsletter@news.example.test',
			}),
		).toEqual({
			account: 'no-reply@mail.example.test',
			orders: 'orders@mail.example.test',
			shop: 'notifications@mail.example.test',
			marketing: 'newsletter@news.example.test',
		});
	});

	it('refuses a sender that is not an email address', () => {
		expect(() => load({ MSG91_EMAIL_FROM_ORDERS: 'orders' })).toThrow();
	});

	it("sends each template from its group's address", () => {
		const from = emailSenderFor(load());
		expect(from('otp_login')).toBe('no-reply@sahatextile.com');
		expect(from('admin_invite')).toBe('no-reply@sahatextile.com');
		expect(from('back_in_stock')).toBe('notifications@sahatextile.com');
		expect(from('product_question_answered')).toBe('notifications@sahatextile.com');
		expect(from('shop_event_announcement')).toBe('newsletter@sahatextile.com');
		// Not on Settings › Communications: the automatic sender.
		expect(from('something_else')).toBe('no-reply@sahatextile.com');
	});
});
