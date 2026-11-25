import { describe, expect, it } from 'vitest';

import { BONUS_2026, bonusDue, bonusRulesOn, bonusWages, type BonusRules } from '../src/payroll/bonus';
import {
	BASIC_DA_HEADS,
	CODE_WAGE_HEADS,
	PAYROLL_RULES_2026,
	codeWages,
	monthPay,
	type SalaryStructure,
} from '../src/payroll/payroll-rules';

/** Brief 26 BN2, BN-D3: bonus under the Code on Wages, its wages, and PF on them once switched on. */
const rupees = (n: number) => n * 100;
/** BN2's example: Priya's month, gross ₹18,000. */
const PRIYA: SalaryStructure = {
	basic: rupees(7_200),
	da: rupees(900),
	hra: rupees(3_600),
	conveyance: rupees(1_600),
	special: rupees(4_700),
	other: 0,
};

describe('the Code’s wages (BN-D3)', () => {
	it('counts the listed heads, and adds back what the left-out heads hold above half the pay', () => {
		expect(codeWages(PRIYA, CODE_WAGE_HEADS)).toBe(rupees(12_800));
		// Basic and DA alone are 8,100: under half the pay (9,000), so 900 is added back.
		expect(codeWages(PRIYA)).toBe(rupees(9_000));
		expect(codeWages(PRIYA, ['basic', 'basic', 'da'])).toBe(rupees(9_000));
		expect(BASIC_DA_HEADS).toEqual(['basic', 'da']);
	});

	it('works PF on them only once switched on', () => {
		const pay = (rules = PAYROLL_RULES_2026) =>
			monthPay({
				structure: PRIYA,
				daysInMonth: 30,
				paidDays: 30,
				pfOn: true,
				esiOn: false,
				advanceDuePaise: 0,
				tdsPaise: 0,
				rules,
			}).pfWagesPaise;
		expect(pay()).toBe(rupees(9_000));
		expect(pay({ ...PAYROLL_RULES_2026, pfUsesCodeWages: true })).toBe(rupees(12_800));
		expect(pay({ ...PAYROLL_RULES_2026, pfUsesCodeWages: true, wageHeads: ['basic', 'da', 'special'] })).toBe(
			rupees(12_800),
		);
	});
});

describe('bonus law and wages by the version’s date (BN-D2)', () => {
	const bare: BonusRules = { ...BONUS_2026, law: undefined, wageBasis: undefined, minDays: undefined };

	it('reads a version from 21 Nov 2025 under the Code, and one before under the Act', () => {
		expect(bonusRulesOn(bare, '2025-11-21')).toMatchObject({
			law: 'code_on_wages',
			wageBasis: 'code',
			minDays: 30,
		});
		expect(bonusRulesOn(bare, '2025-04-01')).toMatchObject({
			law: 'bonus_act',
			wageBasis: 'basic_da',
			minDays: 30,
		});
		expect(bonusRulesOn({ ...bare, wageBasis: 'basic_da', minDays: 45 }, '2026-04-01')).toMatchObject({
			law: 'code_on_wages',
			wageBasis: 'basic_da',
			minDays: 45,
		});
	});

	it('takes bonus wages from the Code’s wages or basic and DA, as the basis says', () => {
		const month = {
			basicDaPaise: rupees(3_000),
			fullBasicDaPaise: rupees(3_000),
			paidDays: 30,
			daysInMonth: 30,
			codeWagesPaise: rupees(6_000),
			fullCodeWagesPaise: rupees(6_000),
		};
		expect(bonusWages(month, BONUS_2026)).toBe(rupees(6_000));
		expect(bonusWages(month, { ...BONUS_2026, wageBasis: 'basic_da' })).toBe(rupees(3_000));
		// No Code wages given: basic and DA stand in.
		const { codeWagesPaise: _a, fullCodeWagesPaise: _b, ...plain } = month;
		expect(bonusWages(plain, BONUS_2026)).toBe(rupees(3_000));
		// Covered by the full month's Code wages: over ₹21,000 is out.
		expect(bonusWages({ ...month, fullCodeWagesPaise: rupees(22_000) }, BONUS_2026)).toBe(0);
	});

	it('asks for the rules’ qualifying days', () => {
		expect(bonusDue(rupees(84_000), { ...BONUS_2026, minDays: 60 }, 45)).toBe(0);
		expect(bonusDue(rupees(84_000), { ...BONUS_2026, minDays: undefined }, 45)).toBeGreaterThan(0);
	});
});
