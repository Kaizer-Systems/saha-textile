import { describe, expect, it } from 'vitest';

import {
	PT_ANYONE,
	PT_YEAR_CAP_PAISE,
	ageOn,
	ptPersonOf,
	ptPeriodMonths,
	ptYearMost,
	statePt,
	type StateRules,
} from '../src/payroll/state-rules';
import { PT_STARTING_SETS, ptStartingSetsFor } from '../src/payroll/pt-starting-sets';

/** Brief 26 PT1–PT4: women's slabs, a differing month, exemptions, actual-pay periods and the year's most. */
const set = (over: Partial<StateRules>): StateRules => ({
	stateCode: '27',
	ptFrequency: 'monthly',
	ptSlabs: [],
	ptMonths: [],
	ptDueDay: 31,
	lwfEmployeePaise: 0,
	lwfEmployerPaise: 0,
	lwfMonths: [],
	lwfDueDay: 15,
	...over,
});
const maharashtra = set({ ...(ptStartingSetsFor('27')[0]?.rules ?? {}) });
const woman = { ...PT_ANYONE, woman: true };

describe('a monthly State with separate slabs for women and a differing month (PT1)', () => {
	it('charges the slab, and its other amount in its month', () => {
		expect(statePt('2026-11', 8_000_00, maharashtra)).toBe(175_00);
		expect(statePt('2026-11', 30_000_00, maharashtra)).toBe(200_00);
		expect(statePt('2027-02', 30_000_00, maharashtra)).toBe(300_00);
		// Women's slabs: nothing up to ₹25,000.
		expect(statePt('2026-11', 20_000_00, maharashtra, woman)).toBe(0);
		expect(statePt('2027-02', 26_000_00, maharashtra, woman)).toBe(300_00);
	});

	it('uses the slabs for everyone when the State keeps no women’s slabs, or an empty list', () => {
		const one = set({ ptSlabs: [{ upToPaise: null, taxPaise: 150_00 }] });
		expect(statePt('2026-11', 20_000_00, one, woman)).toBe(150_00);
		expect(statePt('2026-11', 20_000_00, { ...one, ptWomenSlabs: [] }, woman)).toBe(150_00);
		expect(statePt('2026-11', 20_000_00, { ...one, ptWomenSlabs: null }, woman)).toBe(150_00);
	});

	it('charges nothing when no slab holds the pay (a list without an open top slab)', () => {
		expect(statePt('2026-11', 50_000_00, set({ ptSlabs: [{ upToPaise: 10_000_00, taxPaise: 100_00 }] }))).toBe(0);
	});
});

describe('exemptions (PT1, PT3)', () => {
	it('frees someone the State exempts by age, by disability, or for another reason', () => {
		expect(statePt('2026-11', 30_000_00, maharashtra, { ...PT_ANYONE, age: 65 })).toBe(0);
		expect(statePt('2026-11', 30_000_00, maharashtra, { ...PT_ANYONE, age: 64 })).toBe(200_00);
		expect(statePt('2026-11', 30_000_00, maharashtra, { ...PT_ANYONE, disability: true })).toBe(0);
		expect(statePt('2026-11', 30_000_00, maharashtra, { ...PT_ANYONE, exempt: true })).toBe(0);
	});

	it('taxes them all where the State exempts no one', () => {
		const plain = set({ ptSlabs: [{ upToPaise: null, taxPaise: 200_00 }] });
		expect(statePt('2026-11', 30_000_00, plain, { ...PT_ANYONE, age: 90, disability: true })).toBe(200_00);
		expect(statePt('2026-11', 30_000_00, { ...plain, ptExemptFromAge: 65 }, { ...PT_ANYONE, age: null })).toBe(
			200_00,
		);
	});
});

describe('half-yearly on the period’s actual pay (PT2)', () => {
	const chennai = set({
		stateCode: '33',
		ptFrequency: 'half_yearly',
		ptBasis: 'actual',
		ptMonths: [9, 3],
		ptSlabs: [
			{ upToPaise: 45_000_00, taxPaise: 0 },
			{ upToPaise: 75_000_00, taxPaise: 270_00 },
			{ upToPaise: null, taxPaise: 1_250_00 },
		],
	});

	it('takes it in the period’s month on what the period paid, or on leaving earlier', () => {
		expect(statePt('2026-09', 18_000_00, chennai, PT_ANYONE, { grossPaise: 36_000_00, leaving: false })).toBe(0);
		expect(statePt('2026-09', 18_000_00, chennai, PT_ANYONE, { grossPaise: 72_000_00, leaving: false })).toBe(
			270_00,
		);
		expect(statePt('2026-07', 18_000_00, chennai, PT_ANYONE, { grossPaise: 72_000_00, leaving: true })).toBe(
			270_00,
		);
		expect(statePt('2026-07', 18_000_00, chennai, PT_ANYONE, { grossPaise: 72_000_00, leaving: false })).toBe(0);
	});

	it('falls back to six times the month when no period pay is given, or the State taxes it that way', () => {
		expect(statePt('2026-09', 18_000_00, chennai)).toBe(1_250_00);
		expect(statePt('2026-07', 18_000_00, chennai, PT_ANYONE, null)).toBe(0);
		const projected = { ...chennai, ptBasis: 'projected' as const };
		expect(statePt('2026-09', 10_000_00, projected, PT_ANYONE, { grossPaise: 10_000_00, leaving: false })).toBe(
			270_00,
		);
		// Leaving early taxes nothing on the projected basis outside the period's month.
		expect(statePt('2026-07', 10_000_00, projected, PT_ANYONE, { grossPaise: 40_000_00, leaving: true })).toBe(0);
	});
});

describe('the months of a period (PT2)', () => {
	it('runs from the month after the previous deduction month', () => {
		const half = set({ ptFrequency: 'half_yearly', ptMonths: [9, 3] });
		expect(ptPeriodMonths('2026-09', half)).toEqual([
			'2026-04',
			'2026-05',
			'2026-06',
			'2026-07',
			'2026-08',
			'2026-09',
		]);
		expect(ptPeriodMonths('2026-07', half)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
		expect(ptPeriodMonths('2027-01', half)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
		const yearly = set({ ptFrequency: 'yearly', ptMonths: [3] });
		expect(ptPeriodMonths('2027-03', yearly)).toHaveLength(12);
		expect(ptPeriodMonths('2027-03', yearly)[0]).toBe('2026-04');
	});

	it('is the month itself for a monthly State, one without the tax, or one with no months set', () => {
		expect(ptPeriodMonths('2026-11', set({}))).toEqual(['2026-11']);
		expect(ptPeriodMonths('2026-11', set({ ptFrequency: 'none' }))).toEqual(['2026-11']);
		expect(ptPeriodMonths('2026-11', set({ ptFrequency: 'yearly', ptMonths: [] }))).toEqual(['2026-11']);
	});
});

describe('the year’s most (PT1)', () => {
	it('adds a differing month once, and reads both slab lists', () => {
		expect(ptYearMost(maharashtra)).toBe(2_500_00);
		expect(ptYearMost(set({ ptSlabs: [{ upToPaise: null, taxPaise: 200_00 }] }))).toBe(2_400_00);
		expect(
			ptYearMost(
				set({
					ptSlabs: [{ upToPaise: null, taxPaise: 100_00 }],
					ptWomenSlabs: [{ upToPaise: null, taxPaise: 150_00 }],
				}),
			),
		).toBe(1_800_00);
	});

	it('counts a half-yearly differing month only when it is a deduction month', () => {
		const slab = { upToPaise: null, taxPaise: 1_000_00 };
		const half = (month: number) =>
			set({
				ptFrequency: 'half_yearly',
				ptMonths: [9, 3],
				ptSlabs: [{ ...slab, otherMonth: { month, taxPaise: 1_200_00 } }],
			});
		expect(ptYearMost(half(3))).toBe(2_200_00);
		expect(ptYearMost(half(2))).toBe(2_000_00);
	});

	it('is nothing for a State without the tax or without slabs', () => {
		expect(ptYearMost(set({ ptFrequency: 'none' }))).toBe(0);
		expect(ptYearMost(set({ ptSlabs: [] }))).toBe(0);
	});
});

describe('the starting sets (PT4)', () => {
	it('stay within the Constitution’s ₹2,500 a year, and are found by State', () => {
		for (const s of PT_STARTING_SETS)
			expect(ptYearMost(set({ ...s.rules }))).toBeLessThanOrEqual(PT_YEAR_CAP_PAISE);
		expect(ptStartingSetsFor('29').map((s) => s.label)).toEqual(['Karnataka']);
		expect(ptStartingSetsFor('07')).toEqual([]);
	});
});

describe('the person the rules read (PT3)', () => {
	it('reaches an age on the day before the birthday', () => {
		expect(ageOn('1961-12-01', '2026-11-30')).toBe(65);
		expect(ageOn('1961-12-02', '2026-11-30')).toBe(64);
		expect(ageOn('1960-02-29', '2026-02-28')).toBe(66);
	});

	it('reads gender, age on the month’s last day, disability and another reason', () => {
		expect(
			ptPersonOf(
				{ gender: 'woman', dateOfBirth: '1961-12-01', disability: true, ptExemptReason: ' armed forces ' },
				'2026-11',
			),
		).toEqual({ woman: true, age: 65, disability: true, exempt: true });
		expect(ptPersonOf({ gender: 'man', dateOfBirth: null, ptExemptReason: '  ' }, '2026-02')).toEqual(PT_ANYONE);
		expect(ptPersonOf({}, '2026-12')).toEqual(PT_ANYONE);
	});
});
