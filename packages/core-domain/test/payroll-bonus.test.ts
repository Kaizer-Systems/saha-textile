import { describe, expect, it } from 'vitest';

import { BONUS_2026, bonusDue, bonusOn, bonusWages } from '../src/payroll/bonus';

/** Statutory bonus (brief 25 BN1). */

describe('statutory bonus', () => {
	it('counts basic and DA up to ₹7,000 a month for the days paid, for people within ₹21,000', () => {
		const month = { basicDaPaise: 9_000_00, fullBasicDaPaise: 9_000_00, paidDays: 30, daysInMonth: 30 };
		expect(bonusWages(month, BONUS_2026)).toBe(7_000_00);
		expect(bonusWages({ ...month, paidDays: 15, basicDaPaise: 4_500_00 }, BONUS_2026)).toBe(3_500_00);
		expect(bonusWages({ ...month, basicDaPaise: 5_000_00, fullBasicDaPaise: 5_000_00 }, BONUS_2026)).toBe(5_000_00);
		expect(bonusWages({ ...month, fullBasicDaPaise: 21_000_01 }, BONUS_2026)).toBe(0);
		expect(bonusWages({ ...month, daysInMonth: 0 }, BONUS_2026)).toBe(0);
	});

	it('pays the rate on the year’s wages, at least ₹100, nothing without wages', () => {
		expect(bonusOn(84_000_00, BONUS_2026)).toBe(6_997_20);
		expect(bonusDue(84_000_00, BONUS_2026)).toBe(6_997_20);
		expect(bonusDue(1_000_00, BONUS_2026)).toBe(100_00);
		expect(bonusDue(0, BONUS_2026)).toBe(0);
		expect(bonusDue(84_000_00, { ...BONUS_2026, ratePct: 20 })).toBe(16_800_00);
	});
});
