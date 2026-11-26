import { describe, expect, it } from 'vitest';

import { EXPIRY_WARNING_DAYS, daysLeft } from './domains-screen';

describe('certificates and domains', () => {
	it('counts whole days to an expiry, and none without a date', () => {
		const now = Date.parse('2026-11-21T00:00:00Z');
		expect(daysLeft('2026-12-21T00:00:00Z', now)).toBe(30);
		expect(daysLeft('2026-11-20T12:00:00Z', now)).toBe(-1);
		expect(daysLeft(null, now)).toBeNull();
		expect(daysLeft('not a date', now)).toBeNull();
		expect(EXPIRY_WARNING_DAYS).toBe(30);
	});
});
