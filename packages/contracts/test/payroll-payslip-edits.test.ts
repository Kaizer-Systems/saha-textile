import { describe, expect, it } from 'vitest';

import { AddedPayslipLine, PayrollRow, PayslipByRules, PayslipCheck, PayslipEditsInput } from '../src/payroll';

/** Editing a payslip on a draft run (brief 26 PE2–PE4): added lines, what was typed over and why, and the checks. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const diwali = { id: 'line_1', kind: 'taxable', name: ' Diwali gift ', paise: 2_000_00 };

describe('a line added to a payslip', () => {
	it('is one-off unless kept, its name trimmed', () => {
		expect(AddedPayslipLine.parse(diwali)).toEqual({ ...diwali, name: 'Diwali gift', oneOff: true });
		expect(AddedPayslipLine.parse({ ...diwali, oneOff: false }).oneOff).toBe(false);
	});

	it('goes in any of seven sections', () => {
		for (const kind of [
			'taxable',
			'exempt',
			'reimbursement',
			'arrears',
			'after_tax',
			'before_tax',
			'tax_adjustment',
		])
			accepted(AddedPayslipLine.safeParse({ ...diwali, kind }).success);
		refused(AddedPayslipLine.safeParse({ ...diwali, kind: 'bonus' }).success);
	});

	it('keeps an id of 1 to 40 letters, a name of 1 to 80, and whole paise up to ₹1 crore', () => {
		refused(AddedPayslipLine.safeParse({ ...diwali, id: '' }).success);
		accepted(AddedPayslipLine.safeParse({ ...diwali, id: 'x'.repeat(40) }).success);
		refused(AddedPayslipLine.safeParse({ ...diwali, id: 'x'.repeat(41) }).success);
		refused(AddedPayslipLine.safeParse({ ...diwali, name: '  ' }).success);
		refused(AddedPayslipLine.safeParse({ ...diwali, name: 'x'.repeat(81) }).success);
		accepted(AddedPayslipLine.safeParse({ ...diwali, paise: 0 }).success);
		accepted(AddedPayslipLine.safeParse({ ...diwali, paise: 1_000_000_000 }).success);
		for (const paise of [-1, 0.5, 1_000_000_001]) refused(AddedPayslipLine.safeParse({ ...diwali, paise }).success);
	});
});

describe('what was changed on a payslip', () => {
	it('starts with nothing typed over, added or explained', () => {
		expect(PayslipEditsInput.parse({})).toEqual({ heads: {}, added: [], deductions: {}, reasons: {} });
	});

	it('keeps only the heads and deductions typed over, never an untouched one at nothing', () => {
		const edits = PayslipEditsInput.parse({
			heads: { special: 6_000_00 },
			deductions: { tds: 0 },
			reasons: { tds: ' Declaration came late ' },
		});
		expect(edits).toEqual({
			heads: { special: 6_000_00 },
			added: [],
			deductions: { tds: 0 },
			reasons: { tds: 'Declaration came late' },
		});
		accepted(
			PayslipEditsInput.safeParse({
				heads: { basic: 1, da: 1, hra: 1, special: 1, conveyance: 1, other: 1 },
				deductions: { pf: 1, esi: 1, pt: 1, tds: 1, advance: 1 },
			}).success,
		);
	});

	it('refuses money below nothing or in part, more than 20 added lines, and a reason over 300 letters', () => {
		refused(PayslipEditsInput.safeParse({ heads: { basic: -1 } }).success);
		refused(PayslipEditsInput.safeParse({ deductions: { pf: 0.5 } }).success);
		refused(PayslipEditsInput.safeParse({ deductions: { advance: 1_000_000_001 } }).success);
		accepted(PayslipEditsInput.safeParse({ added: Array.from({ length: 20 }, () => diwali) }).success);
		refused(PayslipEditsInput.safeParse({ added: Array.from({ length: 21 }, () => diwali) }).success);
		accepted(PayslipEditsInput.safeParse({ reasons: { pf: 'x'.repeat(300) } }).success);
		refused(PayslipEditsInput.safeParse({ reasons: { pf: 'x'.repeat(301) } }).success);
		refused(PayslipEditsInput.safeParse({ reasons: { pf: 1 } }).success);
	});
});

describe('a payslip’s checks and the payslip by the rules', () => {
	it('names eight checks, blocking or warning, on a line or the whole payslip', () => {
		const codes = [
			'net_below_zero',
			'deductions_over_half',
			'pf_below_law',
			'esi_below_law',
			'tds_lowered_without_reason',
			'reason_needed',
			'pt_off_slab',
			'below_minimum_wage',
		];
		for (const code of codes)
			expect(PayslipCheck.parse({ code, blocking: true })).toEqual({ code, blocking: true });
		expect(PayslipCheck.parse({ code: 'reason_needed', blocking: false, line: 'tds' }).line).toBe('tds');
		refused(PayslipCheck.safeParse({ code: 'too_high', blocking: true }).success);
		refused(PayslipCheck.safeParse({ code: 'pt_off_slab' }).success);
	});

	const byRules = {
		headsPaise: { basic: 12_000_00, hra: 4_800_00, special: 5_200_00 },
		grossPaise: 22_000_00,
		pfEmployeePaise: 1_440_00,
		pfEmployerPaise: 1_440_00,
		esiEmployeePaise: 0,
		esiEmployerPaise: 0,
		ptPaise: 150_00,
		tdsPaise: 0,
		advancePaise: 0,
		netPaise: 20_410_00,
	};

	it('keeps the payslip as the rules made it, in whole paise', () => {
		expect(PayslipByRules.parse(byRules)).toEqual(byRules);
		refused(PayslipByRules.safeParse({ ...byRules, netPaise: 0.5 }).success);
		refused(PayslipByRules.safeParse({ ...byRules, headsPaise: { basic: 1.5 } }).success);
		refused(PayslipByRules.safeParse({ ...byRules, ptPaise: undefined }).success);
	});

	it('keeps an edited payslip’s changes, the rules’ payslip, its checks and the added lines’ totals on the run’s row', () => {
		const row = {
			employeeId: 'emp_1',
			name: 'Priya Sen',
			locationId: 'loc_kolkata',
			paidDays: 30,
			grossPaise: 22_000_00,
			pfWagesPaise: 12_000_00,
			pfEmployeePaise: 1_440_00,
			pfEmployerPaise: 1_440_00,
			epsPaise: 1_000_00,
			esiEmployeePaise: 0,
			esiEmployerPaise: 0,
			ptPaise: 150_00,
			tdsPaise: 0,
			advancePaise: 0,
			netPaise: 20_410_00,
		};
		const parsed = PayrollRow.parse(row);
		for (const key of ['edits', 'byRules', 'checks', 'otherDeductionsPaise', 'reimbursementsPaise'])
			expect(parsed).not.toHaveProperty(key);
		const edited = PayrollRow.parse({
			...row,
			edits: { added: [diwali] },
			byRules,
			checks: [{ code: 'reason_needed', blocking: true, line: 'tds' }],
			otherDeductionsPaise: 500_00,
			reimbursementsPaise: 1_200_00,
		});
		expect(edited.edits).toEqual({
			heads: {},
			added: [{ ...diwali, name: 'Diwali gift', oneOff: true }],
			deductions: {},
			reasons: {},
		});
		expect([edited.byRules, edited.checks?.length, edited.otherDeductionsPaise]).toEqual([byRules, 1, 500_00]);
		refused(PayrollRow.safeParse({ ...row, otherDeductionsPaise: -1 }).success);
		refused(PayrollRow.safeParse({ ...row, reimbursementsPaise: 0.5 }).success);
	});
});
