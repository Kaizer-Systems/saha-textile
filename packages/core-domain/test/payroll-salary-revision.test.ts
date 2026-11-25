import { describe, expect, it } from 'vitest';

import type { SalaryStructure } from '../src/payroll/payroll-rules';
import {
	arrears,
	arrearsDue,
	breakup,
	minimumWageShortfall,
	revisedCtc,
	structureFromCtc,
	structureOn,
	typedOver,
	type CtcComponent,
	type EmployerCost,
} from '../src/payroll/salary-revision';

/** Brief 26 SR1-SR4: the brief's own example, Priya at ₹3,60,000 a year, then revised by 8%. */
const r = (rupees: number) => rupees * 100;
const STORE_STAFF: CtcComponent[] = [
	{ head: 'special', how: 'rest', value: 0 },
	{ head: 'hra', how: 'percent_basic', value: 40 },
	{ head: 'conveyance', how: 'fixed', value: r(1_600) },
	{ head: 'da', how: 'percent_basic', value: 10 },
	{ head: 'basic', how: 'percent', value: 45 },
];
/** PF 12% of code wages up to ₹15,000, gratuity 15/26 of Basic a year, whole rupees. */
const cost: EmployerCost = (s) =>
	Math.round((Math.min(s.basic + s.da + s.special, r(15_000)) * 12) / 100 / 100) * 100 +
	Math.round((s.basic * 15) / 26 / 12 / 100) * 100;

describe('a structure from the CTC (SR1)', () => {
	it('splits the brief’s ₹30,000 a month: Basic, the heads on Basic, the fixed ones, then the rest', () => {
		const split = structureFromCtc(STORE_STAFF, r(30_000), cost);
		expect(split.structure).toEqual({
			basic: r(13_500),
			da: r(1_350),
			hra: r(5_400),
			conveyance: r(1_600),
			special: r(5_701),
			other: 0,
		});
		expect([split.grossPaise, split.employerPaise, split.fits]).toEqual([r(27_551), r(2_449), true]);
	});

	it('settles the rest when the employer’s share moves with it (PF under its ceiling)', () => {
		const split = structureFromCtc(STORE_STAFF, r(12_000), cost);
		expect(split.structure.basic + split.structure.da + split.structure.special).toBeLessThan(r(15_000));
		expect(split.grossPaise + split.employerPaise).toBe(r(12_000));
	});

	it('refuses a structure whose other heads take more than the CTC, and needs no rest', () => {
		const over = structureFromCtc(
			[...STORE_STAFF, { head: 'other', how: 'fixed', value: r(40_000) }],
			r(30_000),
			cost,
		);
		expect([over.fits, over.structure.special]).toEqual([false, 0]);
		const fixed = structureFromCtc([{ head: 'basic', how: 'percent', value: 50 }], r(30_000), () => 0);
		expect(fixed).toMatchObject({ grossPaise: r(15_000), fits: true });
	});
});

describe('revising one person (SR2)', () => {
	const now = structureFromCtc(STORE_STAFF, r(30_000), cost).structure;

	it('gives the same heads by 8% and by a new CTC of ₹3,88,800, as the brief draws', () => {
		const byPct = revisedCtc(r(30_000), { kind: 'percent', pct: 8 }, cost);
		const byCtc = revisedCtc(r(30_000), { kind: 'ctc', yearPaise: r(388_800) }, cost);
		expect([byPct, byCtc]).toEqual([r(32_400), r(32_400)]);
		const next = structureFromCtc(STORE_STAFF, byPct, cost);
		expect(next.structure).toMatchObject({ basic: r(14_580), da: r(1_458), hra: r(5_832), special: r(6_429) });
		expect(next.employerPaise).toBe(r(2_501));
		expect(breakup(now, next.structure)).toEqual([
			{ head: 'basic', now: r(13_500), next: r(14_580), change: r(1_080) },
			{ head: 'da', now: r(1_350), next: r(1_458), change: r(108) },
			{ head: 'hra', now: r(5_400), next: r(5_832), change: r(432) },
			{ head: 'conveyance', now: r(1_600), next: r(1_600), change: 0 },
			{ head: 'special', now: r(5_701), next: r(6_429), change: r(728) },
		]);
	});

	it('takes an amount a month, a decrease, or the heads typed with the CTC following', () => {
		expect(revisedCtc(r(30_000), { kind: 'amount', monthPaise: r(1_500) }, cost)).toBe(r(31_500));
		expect(revisedCtc(r(30_000), { kind: 'percent', pct: -5 }, cost)).toBe(r(28_500));
		expect(revisedCtc(r(30_000), { kind: 'heads', structure: now }, cost)).toBe(r(30_000));
	});

	it('moves the rest to keep a locked CTC when a head is typed over, or lets the CTC follow', () => {
		const lock = { ctcPaise: r(30_000), rest: 'special' as const };
		const locked = typedOver(now, 'hra', r(6_000), lock, cost);
		expect(locked.structure).toMatchObject({ hra: r(6_000), special: r(5_101) });
		expect(locked.grossPaise + locked.employerPaise).toBe(r(30_000));
		const free = typedOver(now, 'hra', r(6_000), null, cost);
		expect(free.grossPaise + free.employerPaise).toBe(r(30_600));
		expect(typedOver(now, 'special', r(6_000), lock, cost).structure.special).toBe(r(6_000));
	});
});

describe('arrears and the minimum wage (SR4)', () => {
	const old: SalaryStructure = {
		basic: r(13_500),
		da: r(1_350),
		hra: r(5_400),
		conveyance: r(1_600),
		special: r(5_701),
		other: 0,
	};
	const next: SalaryStructure = { ...old, basic: r(14_580), da: r(1_458), hra: r(5_832), special: r(6_429) };

	it('pays the difference for the days paid in each month already paid, naming the months', () => {
		const due = arrears(old, next, [
			{ month: '2026-09', paidDays: 30, daysInMonth: 30 },
			{ month: '2026-10', paidDays: 31, daysInMonth: 31 },
			{ month: '2026-11', paidDays: 15, daysInMonth: 30 },
			{ month: '2026-12', paidDays: 0, daysInMonth: 31 },
		]);
		expect(due).toEqual({ paise: r(2_348) * 2 + r(1_174), months: ['2026-09', '2026-10', '2026-11'] });
	});

	it('finds basic and DA under the State’s minimum for the skill level in force, and checks nothing without one', () => {
		const wages = [
			{ from: '2026-01-01', levels: { unskilled: r(10_000), skilled: r(16_000) } },
			{ from: '2026-07-01', levels: { unskilled: r(10_500), skilled: r(15_500) } },
			{ from: '2027-01-01', levels: { skilled: r(18_000) } },
		];
		expect(minimumWageShortfall(old, 'skilled', wages, '2026-11-30')).toBe(r(650));
		expect(minimumWageShortfall(old, 'unskilled', wages, '2026-11-30')).toBe(0);
		expect(minimumWageShortfall(old, 'semi_skilled', wages, '2026-11-30')).toBe(0);
		expect(minimumWageShortfall(old, null, wages, '2026-11-30')).toBe(0);
		expect(minimumWageShortfall(old, 'skilled', undefined, '2026-11-30')).toBe(0);
		expect(minimumWageShortfall(old, 'skilled', wages, '2025-12-31')).toBe(0);
	});
});

describe('the structure in force, and arrears paid in a later month (SR2, SR4)', () => {
	const v1: SalaryStructure = { basic: r(10_000), da: 0, hra: r(4_000), conveyance: 0, special: r(6_000), other: 0 };
	const v2: SalaryStructure = { ...v1, basic: r(11_000), special: r(6_600) };
	const now: SalaryStructure = { ...v2, other: r(100) };
	const history = [
		{ from: '2025-01-01', structure: v1 },
		{ from: '2026-09-01', structure: v2 },
	];

	it('takes the version from on or before the day, the latest as the person stands, the first before them all', () => {
		expect(structureOn(now, undefined, '2026-10-31')).toBe(now);
		expect(structureOn(now, [], '2026-10-31')).toBe(now);
		expect(structureOn(now, history, '2026-08-31')).toBe(v1);
		expect(structureOn(now, history, '2026-09-30')).toBe(now);
		expect(structureOn(now, history, '2024-12-31')).toBe(v1);
	});

	it('owes the difference for each month paid on the old structure since the revision, once', () => {
		const months = [
			{ month: '2026-08', paidDays: 31, daysInMonth: 31, paidPaise: r(20_000), paidPfWagesPaise: r(10_000) },
			{ month: '2026-09', paidDays: 30, daysInMonth: 30, paidPaise: r(20_000), paidPfWagesPaise: r(10_000) },
			{ month: '2026-10', paidDays: 15, daysInMonth: 31, paidPaise: 967_742, paidPfWagesPaise: 483_871 },
			{ month: '2026-11', paidDays: 0, daysInMonth: 0, paidPaise: 0, paidPfWagesPaise: 0 },
		];
		const due = arrearsDue({
			since: '2026-09-01',
			months,
			dueOn: (m) => (m >= '2026-09' ? v2 : v1),
			pfHeads: ['basic', 'da'],
			arrearsPaid: (m) => (m === '2026-10' ? r(500) : 0),
		});
		// September: ₹21,600 due, ₹20,000 paid; October: 15 of 31 days of ₹21,600, less what was paid and ₹500.
		expect(due.byMonth).toEqual([
			{ month: '2026-09', paise: r(1_600) },
			{ month: '2026-10', paise: 1_045_161 - 967_742 - r(500) },
		]);
		expect(due.paise).toBe(r(1_600) + 1_045_161 - 967_742 - r(500));
		// PF wages owed, never more than the arrears themselves (October's are under its PF wages owed).
		expect(due.pfWagesPaise).toBe(r(1_000) + (1_045_161 - 967_742 - r(500)));
		expect(
			arrearsDue({ since: '2026-09-01', months, dueOn: () => v1, pfHeads: ['basic'], arrearsPaid: () => 0 })
				.paise,
		).toBe(0);
	});
});
