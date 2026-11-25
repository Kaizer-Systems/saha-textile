import { describe, expect, it } from 'vitest';

import { expenseBillPosting, expenseBillTotals } from '../src/ledger/expense-bills';

/** Expense bills (brief 25 EB1): the brief's rent and staff-welfare bill. */

const lines = [
	{
		expenseLedgerId: 'led_rent',
		what: 'Warehouse rent, November',
		sac: '997212',
		taxableINR: 25_000,
		gstRatePct: 18,
		credit: 'claim' as const,
		blockedClause: '',
	},
	{
		expenseLedgerId: 'led_welfare',
		what: 'Diwali sweets for staff',
		sac: '996331',
		taxableINR: 2_000,
		gstRatePct: 5,
		credit: 'blocked' as const,
		blockedClause: 'b',
	},
];

describe('expense bills', () => {
	it('splits claimable tax CGST and SGST in the State, keeps blocked tax apart, and totals ₹31,600', () => {
		expect(expenseBillTotals(lines, false)).toEqual({
			taxableINR: 27_000,
			cgstINR: 2_250,
			sgstINR: 2_250,
			igstINR: 0,
			blockedTaxINR: 100,
			totalINR: 31_600,
		});
		expect(expenseBillTotals(lines, true)).toMatchObject({ cgstINR: 0, sgstINR: 0, igstINR: 4_500 });
	});

	it('posts rent ₹25,000 and staff welfare ₹2,100, input CGST and SGST, the supplier ₹31,600', () => {
		const posted = expenseBillPosting({
			lines,
			locationId: 'loc_bar',
			billNumber: 'LP/26/1104',
			interState: false,
		});
		expect(
			posted.map((l) => ['id' in l.ledger ? l.ledger.id : l.ledger.role, l.debitPaise ?? 0, l.creditPaise ?? 0]),
		).toEqual([
			['led_rent', 2_500_000, 0],
			['led_welfare', 210_000, 0],
			['input_cgst', 225_000, 0],
			['input_sgst', 225_000, 0],
			['creditors_control', 0, 3_160_000],
		]);
	});

	it('posts nothing for a line of ₹0, and IGST for another State', () => {
		const posted = expenseBillPosting({
			lines: [
				{ ...lines[0], taxableINR: 1_000, gstRatePct: 18 },
				{ ...lines[0], what: 'Free trial month', taxableINR: 0, gstRatePct: 0 },
			],
			locationId: 'loc_bar',
			billNumber: 'SW/1',
			interState: true,
		});
		expect(
			posted.map((l) => ['id' in l.ledger ? l.ledger.id : l.ledger.role, l.debitPaise ?? 0, l.creditPaise ?? 0]),
		).toEqual([
			['led_rent', 100_000, 0],
			['input_igst', 18_000, 0],
			['creditors_control', 0, 118_000],
		]);
	});
});
