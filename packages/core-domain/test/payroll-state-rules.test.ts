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
