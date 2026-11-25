import { describe, expect, it } from 'vitest';

import { PAYROLL_RULES_2026 } from '../src/payroll/payroll-rules';
import { NO_EDITS, payslipChecks, payslipFromLines, type PayslipEdits } from '../src/payroll/payslip-edits';

/** Brief 26 PE2: a payslip worked out from its lines, typed over and added to, and the checks before publishing. */
const r = (rupees: number) => Math.round(rupees * 100);
const HEADS = { basic: r(8_700), da: 0, hra: r(3_480), conveyance: 0, special: r(5_220), other: 0 };
const ptFor = (gross: number) => (gross > r(15_000) ? r(150) : r(110));
const base = (edits: PayslipEdits = NO_EDITS, over: Partial<Parameters<typeof payslipFromLines>[0]> = {}) =>
	payslipFromLines({
		rulesHeads: HEADS,
		edits,
		pfOn: true,
		esiOn: true,
		rules: PAYROLL_RULES_2026,
		ptFor,
		tdsPaise: r(500),
		advancePaise: r(1_000),
		...over,
	});
const edits = (over: Partial<PayslipEdits>): PayslipEdits => ({ ...NO_EDITS, ...over });

describe('a payslip from its lines (PE2)', () => {
	it('works the rules’ payslip: PF on Basic and DA, ESI rounded up, the State’s tax, TDS and the advance', () => {
		expect(base()).toMatchObject({
			grossPaise: r(17_400),
			pfWagesPaise: r(8_700),
			pfEmployeePaise: r(1_044),
			pfEmployerPaise: r(1_044),
			esiEmployeePaise: r(131),
			ptPaise: r(150),
			tdsPaise: r(500),
			advancePaise: r(1_000),
			netPaise: r(17_400 - 1_044 - 131 - 150 - 500 - 1_000),
		});
	});

	it('follows a head typed over and an added earning: PF, ESI and the gross move with them', () => {
		const p = base(
			edits({
				heads: { basic: r(9_000) },
				added: [{ id: 'l1', kind: 'taxable', name: 'Shop incentive', paise: r(500), oneOff: true }],
			}),
		);
		// Basic ₹9,000 is over half the heads (₹17,700), so it is the PF wages; the one-off incentive is not a head.
		expect(p).toMatchObject({
			grossPaise: r(18_200),
			pfWagesPaise: r(9_000),
			pfEmployeePaise: r(1_080),
			esiEmployeePaise: r(137),
		});
	});

	it('pays a reimbursement beside the wages, takes added deductions, and keeps a deduction typed over', () => {
		const p = base(
			edits({
				added: [
					{ id: 'a', kind: 'reimbursement', name: 'Travel', paise: r(300), oneOff: true },
					{ id: 'b', kind: 'before_tax', name: 'Loan', paise: r(200), oneOff: false },
					{ id: 'c', kind: 'tax_adjustment', name: 'TDS correction', paise: r(50), oneOff: true },
					{ id: 'd', kind: 'arrears', name: 'Arrears', paise: r(1_000), oneOff: true },
				],
				deductions: { advance: r(500) },
			}),
		);
		expect(p).toMatchObject({
			grossPaise: r(18_400),
			pfWagesPaise: r(8_700 + 1_000),
			reimbursementsPaise: r(300),
			otherDeductionsPaise: r(250),
			advancePaise: r(500),
		});
		expect(p.netPaise).toBe(
			r(18_400) - p.pfEmployeePaise - p.esiEmployeePaise - r(150) - r(500) - r(500) - r(250) + r(300),
		);
	});

	it('takes no PF or ESI for someone outside them, none above the ESI limit, no tax on nothing, PF by the Codes’ heads', () => {
		expect(base(NO_EDITS, { pfOn: false, esiOn: false })).toMatchObject({
			pfEmployeePaise: 0,
			pfEmployerPaise: 0,
			epsPaise: 0,
			esiEmployeePaise: 0,
		});
		expect(base(edits({ heads: { special: r(20_000) } })).esiEmployeePaise).toBe(0);
		const none = { basic: 0, da: 0, hra: 0, conveyance: 0, special: 0, other: 0 };
		expect(base(edits({ heads: none }))).toMatchObject({ grossPaise: 0, ptPaise: 0, esiEmployeePaise: 0 });
		const codes = base(NO_EDITS, { rules: { ...PAYROLL_RULES_2026, pfUsesCodeWages: true } });
		expect(codes.pfWagesPaise).toBe(r(8_700 + 5_220));
		const own = base(NO_EDITS, {
			rules: { ...PAYROLL_RULES_2026, pfUsesCodeWages: true, wageHeads: ['basic', 'hra'] },
		});
		expect(own.pfWagesPaise).toBe(r(8_700 + 3_480));
	});
});

describe('the checks before publishing (PE-D2)', () => {
	const check = (e: PayslipEdits, shortfall = 0) =>
		payslipChecks({ edited: base(e), byRules: base(), edits: e, ptFor, minimumWageShortfallPaise: shortfall }).map(
			(c) => [c.code, c.blocking, c.line ?? null],
		);

	it('passes the rules’ payslip with nothing to say', () => {
		expect(check(NO_EDITS)).toEqual([]);
	});

	it('blocks PF or ESI below the law, TDS lowered without a reason, net below nothing, deductions over half', () => {
		expect(check(edits({ deductions: { pf: r(1_000), esi: r(100) }, reasons: { pf: 'x', esi: 'y' } }))).toEqual([
			['pf_below_law', true, 'pf'],
			['esi_below_law', true, 'esi'],
		]);
		expect(check(edits({ deductions: { tds: 0 } }))).toEqual([['tds_lowered_without_reason', true, 'tds']]);
		expect(check(edits({ deductions: { tds: 0 }, reasons: { tds: 'Proof of rent came in' } }))).toEqual([]);
		expect(check(edits({ deductions: { tds: r(600) } }))).toEqual([]);
		expect(
			check(edits({ added: [{ id: 'x', kind: 'after_tax', name: 'Recovery', paise: r(30_000), oneOff: true }] })),
		).toEqual([
			['net_below_zero', true, null],
			['deductions_over_half', true, null],
		]);
	});

	it('warns of a line changed without a reason, tax off the slab, and pay under the minimum wage', () => {
		expect(check(edits({ heads: { basic: r(9_000) }, deductions: { pt: 0 } }), r(400))).toEqual([
			['reason_needed', false, 'basic'],
			['reason_needed', false, 'pt'],
			['pt_off_slab', false, 'pt'],
			['below_minimum_wage', false, null],
		]);
		expect(
			check(edits({ heads: { basic: r(9_000) }, reasons: { basic: 'Paid for a day marked absent in error' } })),
		).toEqual([]);
		const none = { basic: 0, da: 0, hra: 0, conveyance: 0, special: 0, other: 0 };
		// No pay, and nothing taken from it: nothing to say about the deductions.
		const reasons = Object.fromEntries([...Object.keys(none), 'tds', 'advance'].map((k) => [k, 'left']));
		expect(check(edits({ heads: none, deductions: { tds: 0, advance: 0 }, reasons }))).toEqual([]);
	});
});
