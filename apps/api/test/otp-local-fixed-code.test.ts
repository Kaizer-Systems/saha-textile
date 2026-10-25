import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/app-config';

const baseEnv = {
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const load = (overrides: Record<string, string | undefined>) =>
	loadConfig({ ...baseEnv, ...overrides } as NodeJS.ProcessEnv);

describe('OTP_LOCAL_FIXED_CODE', () => {
	it('is absent unless asked for, so codes stay random by default', () => {
		expect(load({}).otp.localFixedCode).toBeUndefined();
	});

	it('is accepted in development with the console notification adapter', () => {
		expect(load({ OTP_LOCAL_FIXED_CODE: '424242' }).otp.localFixedCode).toBe('424242');
	});

	it('refuses to boot in production', () => {
		expect(() => load({ OTP_LOCAL_FIXED_CODE: '424242', NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
	});

	it('refuses to boot when a real provider would deliver the code', () => {
		expect(() => load({ OTP_LOCAL_FIXED_CODE: '424242', NOTIFICATION_PROVIDER: 'msg91' })).toThrow(
			/NOTIFICATION_PROVIDER=console/,
		);
	});

	it.each([['12345'], ['1234567'], ['abcdef']])('rejects %s as not six digits', (value) => {
		expect(() => load({ OTP_LOCAL_FIXED_CODE: value })).toThrow(/six digits/);
	});
});
