import { describe, expect, it } from 'vitest';

import { PAYROLL_RULES_2026, monthPay } from '../src/payroll/payroll-rules';
import { PAYROLL_SCHEMES_2026 } from '../src/payroll/payroll-statutory';
import {
	LEGACY_STATE_CODE,
	stateDue,
	stateLwf,
	statePt,
	stateRulesFor,
	stateRulesOf,
	type StateRules,
} from '../src/payroll/state-rules';

/** Professional tax and the welfare fund per State (brief 25 ST1, ST2). */

const legacy = {
	ptSlabs: PAYROLL_RULES_2026.ptSlabs,
	ptDueDay: PAYROLL_SCHEMES_2026.ptDueDay,
	lwfEmployeePaise: PAYROLL_SCHEMES_2026.lwfEmployeePaise,
	lwfEmployerPaise: PAYROLL_SCHEMES_2026.lwfEmployerPaise,
	lwfMonths: PAYROLL_SCHEMES_2026.lwfMonths,
	lwfDueDay: PAYROLL_SCHEMES_2026.lwfDueDay,
};

/** An example half-yearly State: slabs on six months' gross, taken in September and March. */
const halfYearly: StateRules = {
	stateCode: '33',
	ptFrequency: 'half_yearly',
	ptSlabs: [
		{ upToPaise: 21_000_00, taxPaise: 0 },
		{ upToPaise: 75_000_00, taxPaise: 135_00 },
		{ upToPaise: null, taxPaise: 1_250_00 },
	],
	ptMonths: [9, 3],
	ptDueDay: 30,
	lwfEmployeePaise: 0,
	lwfEmployerPaise: 0,
	lwfMonths: [],
	lwfDueDay: 15,
};

describe('a version’s State sets', () => {
	it('reads an older version’s company-wide figures as one State’s set', () => {
		const [only] = stateRulesOf(legacy);
		expect(only).toMatchObject({
			stateCode: LEGACY_STATE_CODE,
			ptFrequency: 'monthly',
			ptDueDay: 21,
			lwfMonths: [6, 12],
		});
		expect(stateRulesOf({ ...legacy, states: [halfYearly] })).toEqual([halfYearly]);
		expect(stateRulesFor([halfYearly], '33')).toBe(halfYearly);
		expect(stateRulesFor([halfYearly], '16')).toBeNull();
	});
});

describe('professional tax by State', () => {
	const westBengal = stateRulesOf(legacy)[0] as StateRules;

	it('takes a monthly State’s slab on the month’s gross', () => {
		expect(statePt('2026-11', 17_400_00, westBengal)).toBe(130_00);
		expect(statePt('2026-11', 0, westBengal)).toBe(0);
	});

	it('takes a half-yearly State’s slab on six months’ gross, only in its months', () => {
		expect(statePt('2026-09', 10_000_00, halfYearly)).toBe(135_00);
		expect(statePt('2026-10', 10_000_00, halfYearly)).toBe(0);
		expect(statePt('2027-03', 20_000_00, halfYearly)).toBe(1_250_00);
		expect(statePt('2027-03', 12_000_00, { ...halfYearly, ptFrequency: 'yearly', ptMonths: [3] })).toBe(1_250_00);
	});

	it('takes nothing in a State without the tax', () => {
		expect(statePt('2026-09', 50_000_00, { ...halfYearly, ptFrequency: 'none' })).toBe(0);
	});

	it('lets a month’s pay use the State’s tax', () => {
		const pay = monthPay({
			structure: { basic: 10_000_00, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
			daysInMonth: 30,
			paidDays: 30,
			pfOn: false,
			esiOn: false,
			advanceDuePaise: 0,
			tdsPaise: 0,
			rules: PAYROLL_RULES_2026,
			ptFor: (gross) => statePt('2026-09', gross, halfYearly),
		});
		expect(pay.ptPaise).toBe(135_00);
		expect(pay.netPaise).toBe(10_000_00 - 135_00);
	});
});

describe('the welfare fund and due days by State', () => {
	const westBengal = stateRulesOf(legacy)[0] as StateRules;

	it('takes the fund in its months from someone paid', () => {
		expect(stateLwf('2026-12', 100, westBengal)).toEqual({ employeePaise: 3_00, employerPaise: 15_00 });
		expect(stateLwf('2026-11', 100, westBengal)).toEqual({ employeePaise: 0, employerPaise: 0 });
		expect(stateLwf('2026-12', 0, westBengal)).toEqual({ employeePaise: 0, employerPaise: 0 });
	});

	it('falls due on the State’s day of the next month, the month’s last day at most', () => {
		expect(stateDue('pt', '2026-11', westBengal)).toBe('2026-12-21');
		expect(stateDue('lwf', '2026-12', westBengal)).toBe('2027-01-15');
		expect(stateDue('pt', '2027-01', halfYearly)).toBe('2027-02-28');
	});
});

describe('State sets at their edges', () => {
	const westBengal = stateRulesOf(legacy)[0] as StateRules;
	const yearly: StateRules = { ...halfYearly, stateCode: '32', ptFrequency: 'yearly', ptMonths: [3] };

	it('reads a version whose States list is empty as the company-wide set, and copies a version’s own list', () => {
		expect(stateRulesOf({ ...legacy, states: [] })).toEqual([westBengal]);
		expect(westBengal).toEqual({
			stateCode: '19',
			ptFrequency: 'monthly',
			ptSlabs: PAYROLL_RULES_2026.ptSlabs,
			ptMonths: [],
			ptDueDay: 21,
			lwfEmployeePaise: 3_00,
			lwfEmployerPaise: 15_00,
			lwfMonths: [6, 12],
			lwfDueDay: 15,
		});
		const states = [halfYearly, yearly];
		const own = stateRulesOf({ ...legacy, states });
		expect(own).toEqual(states);
		expect(own).not.toBe(states);
		expect(stateRulesFor(own, '32')).toBe(yearly);
	});

	it('takes West Bengal’s slabs at each edge, every month whatever months are listed', () => {
		const at = (gross: number) => statePt('2026-11', gross, { ...westBengal, ptMonths: [3] });
		expect([at(10_000_00), at(10_000_01), at(15_000_00), at(25_000_00), at(40_000_00), at(40_000_01)]).toEqual([
			0, 110_00, 110_00, 130_00, 150_00, 200_00,
		]);
	});

	it('takes a yearly State’s tax once, in its month, on twelve months’ gross', () => {
		expect(statePt('2027-03', 1_750_00, yearly)).toBe(0);
		expect(statePt('2027-03', 1_750_01, yearly)).toBe(135_00);
		expect(statePt('2027-02', 50_000_00, yearly)).toBe(0);
		expect(statePt('2026-03', 50_000_00, yearly)).toBe(1_250_00);
	});

	it('takes nothing from someone not paid, even in a periodic State’s month', () => {
		expect(statePt('2026-09', 0, halfYearly)).toBe(0);
		expect(statePt('2026-09', -1, halfYearly)).toBe(0);
		expect(statePt('2026-11', -500_00, westBengal)).toBe(0);
		expect(stateLwf('2026-06', -1, westBengal)).toEqual({ employeePaise: 0, employerPaise: 0 });
	});

	it('takes the fund in June as in December, and none in a State without it', () => {
		expect(stateLwf('2027-06', 1, westBengal)).toEqual({ employeePaise: 3_00, employerPaise: 15_00 });
		expect(stateLwf('2026-12', 50_000_00, halfYearly)).toEqual({ employeePaise: 0, employerPaise: 0 });
	});

	it('rolls December’s dues into January, and keeps a due day to the next month’s last day', () => {
		expect(stateDue('pt', '2026-12', westBengal)).toBe('2027-01-21');
		expect(stateDue('lwf', '2026-06', westBengal)).toBe('2026-07-15');
		const late = { ...westBengal, ptDueDay: 31, lwfDueDay: 31 };
		expect(stateDue('pt', '2027-03', late)).toBe('2027-04-30');
		expect(stateDue('lwf', '2028-01', late)).toBe('2028-02-29');
		expect(stateDue('pt', '2027-07', late)).toBe('2027-08-31');
		expect(stateDue('pt', '2026-08', { ...westBengal, ptDueDay: 5 })).toBe('2026-09-05');
	});
});

describe('a month’s pay with the State’s tax', () => {
	const base = {
		structure: { basic: 30_000_00, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
		daysInMonth: 30,
		paidDays: 30,
		pfOn: false,
		esiOn: false,
		advanceDuePaise: 0,
		tdsPaise: 0,
		rules: PAYROLL_RULES_2026,
	};

	it('uses the rules’ own slabs when no State’s tax is given', () => {
		expect(monthPay(base).ptPaise).toBe(150_00);
	});

	it('takes the State’s tax on the gross, nothing in a month it is not due', () => {
		expect(monthPay({ ...base, ptFor: (gross) => statePt('2026-10', gross, halfYearly) }).ptPaise).toBe(0);
		const seen: number[] = [];
		const pay = monthPay({
			...base,
			paidDays: 15,
			ptFor: (gross) => {
				seen.push(gross);
				return statePt('2027-03', gross, halfYearly);
			},
		});
		// ₹15,000 for half the month: six times it is ₹90,000, the top slab.
		expect(seen).toEqual([15_000_00]);
		expect(pay.ptPaise).toBe(1_250_00);
		expect(pay.netPaise).toBe(15_000_00 - 1_250_00);
	});

	it('asks no State’s tax of someone with no pay', () => {
		const pay = monthPay({
			...base,
			paidDays: 0,
			ptFor: () => {
				throw new Error('not asked');
			},
		});
		expect(pay.ptPaise).toBe(0);
	});
});
