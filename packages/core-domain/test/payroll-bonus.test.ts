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
		expect(bonusDue(84_000_00, BONUS_2026, 365)).toBe(6_997_20);
		expect(bonusDue(1_000_00, BONUS_2026, 365)).toBe(100_00);
		expect(bonusDue(0, BONUS_2026, 365)).toBe(0);
		expect(bonusDue(84_000_00, { ...BONUS_2026, ratePct: 20 }, 365)).toBe(16_800_00);
	});
});

describe('statutory bonus at its edges', () => {
	const month = { basicDaPaise: 9_000_00, fullBasicDaPaise: 9_000_00, paidDays: 30, daysInMonth: 30 };

	it('starts from the Act’s figures: 8.33% on up to ₹7,000 a month for people on up to ₹21,000, at least ₹100', () => {
		expect(BONUS_2026).toEqual({
			ratePct: 8.33,
			wageCeilingPaise: 7_000_00,
			eligibleUpToPaise: 21_000_00,
			minimumPaise: 100_00,
			provision: 'monthly',
		});
	});

	it('covers someone on exactly ₹21,000 a month, and judges cover on the full month’s pay, not the days paid', () => {
		expect(bonusWages({ ...month, fullBasicDaPaise: 21_000_00 }, BONUS_2026)).toBe(7_000_00);
		expect(
			bonusWages({ ...month, fullBasicDaPaise: 22_000_00, basicDaPaise: 3_000_00, paidDays: 4 }, BONUS_2026),
		).toBe(0);
	});

	it('holds the ceiling to the days paid, never past the whole month, rounded to the paisa', () => {
		expect(bonusWages({ ...month, paidDays: 31 }, BONUS_2026)).toBe(7_000_00);
		expect(bonusWages({ ...month, paidDays: 0, basicDaPaise: 0 }, BONUS_2026)).toBe(0);
		// ₹7,000 for 10 of 31 days is ₹2,258.0645.
		expect(bonusWages({ ...month, daysInMonth: 31, paidDays: 10, basicDaPaise: 2_903_23 }, BONUS_2026)).toBe(
			2_258_06,
		);
		expect(bonusWages({ ...month, daysInMonth: -1 }, BONUS_2026)).toBe(0);
	});

	it('takes a State’s higher minimum wage when it is entered as the ceiling', () => {
		const state = { ...BONUS_2026, wageCeilingPaise: 12_000_00 };
		expect(bonusWages(month, state)).toBe(9_000_00);
		expect(bonusWages({ ...month, basicDaPaise: 15_000_00, fullBasicDaPaise: 15_000_00 }, state)).toBe(12_000_00);
	});

	it('rounds the bonus to the paisa, the minimum only once there are wages', () => {
		expect(bonusOn(1, BONUS_2026)).toBe(0);
		expect(bonusOn(7_000_00, BONUS_2026)).toBe(583_10);
		expect(bonusDue(-1, BONUS_2026, 365)).toBe(0);
		expect(bonusDue(1, BONUS_2026, 365)).toBe(100_00);
		// ₹1,200.48 at 8.33% is ₹100 by itself.
		expect(bonusDue(1_200_48, BONUS_2026, 365)).toBe(100_00);
		expect(bonusDue(1_300_00, BONUS_2026, 365)).toBe(108_29);
		expect(bonusDue(1_000_00, { ...BONUS_2026, minimumPaise: 0 }, 365)).toBe(83_30);
		// s.8: fewer than 30 days worked in the year earns nothing, the minimum included; 30 days earns it.
		expect(bonusDue(84_000_00, BONUS_2026, 29)).toBe(0);
		expect(bonusDue(1_000_00, BONUS_2026, 30)).toBe(100_00);
	});
});
