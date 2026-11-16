import { describe, expect, it } from 'vitest';

import { NUMBER_LIMITS, PURCHASE_STEPS, reopensBooks, settingNumber } from './purchase-settings';

describe('settings › purchases and stock (x02)', () => {
	it('takes figures only inside the limits the API enforces', () => {
		expect(settingNumber('10', NUMBER_LIMITS.priceChangeWarnPct)).toBe(10);
		expect(settingNumber('12.5', NUMBER_LIMITS.marginFloorPct)).toBe(12.5);
		expect(settingNumber('101', NUMBER_LIMITS.marginFloorPct)).toBeNull();
		expect(settingNumber('-1', NUMBER_LIMITS.priceChangeWarnPct)).toBeNull();
		expect(settingNumber('21.5', NUMBER_LIMITS.heldReminderDays)).toBeNull();
		expect(settingNumber('0', NUMBER_LIMITS.heldReminderDays)).toBeNull();
		expect(settingNumber('0', NUMBER_LIMITS.defaultPaymentTermsDays)).toBe(0);
		expect(settingNumber('', NUMBER_LIMITS.unpaidAlertDays)).toBeNull();
		expect(settingNumber('abc', NUMBER_LIMITS.unpaidAlertDays)).toBeNull();
	});

	it('asks before the books open again, never when they close further', () => {
		expect(reopensBooks(null, '2026-10-31')).toBe(false);
		expect(reopensBooks('2026-10-31', '2026-11-30')).toBe(false);
		expect(reopensBooks('2026-10-31', '2026-10-31')).toBe(false);
		expect(reopensBooks('2026-10-31', '2026-09-30')).toBe(true);
		expect(reopensBooks('2026-10-31', null)).toBe(true);
	});

	it('lists the four steps with the permission each needs; only later steps can need a second person', () => {
		expect(PURCHASE_STEPS.map((row) => [row.step, row.permission])).toEqual([
			['draft', 'purchase.create'],
			['check', 'purchase.check'],
			['post', 'purchase.post'],
			['payment', 'purchase.payment'],
		]);
		expect(PURCHASE_STEPS[0]?.differentKey).toBeNull();
		expect(PURCHASE_STEPS.slice(1).every((row) => row.differentKey)).toBe(true);
	});
});
