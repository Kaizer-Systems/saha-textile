import type { TaxInvoiceLine } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	creditLinesFor,
	creditNoteCancelAllowed,
	creditNoteDeadline,
	creditNotePosting,
	creditNoteProblems,
	debitNotePosting,
	inputTaxReversalPosting,
	oppositePosting,
	writeOffInputTax,
	deliveryShareLine,
	NOTE_DELIVERY_SAC,
	noteTotals,
	priceAdjustmentLines,
	restockCost,
	returnWindow,
} from '../src/invoicing/credit-note-rules';

const line = (patch: Partial<TaxInvoiceLine> = {}): TaxInvoiceLine => ({
	lineId: 'a',
	sku: 'BAN-3',
	title: 'Banarasi Silk Saree',
	hsn: '5007',
	quantity: 3,
	unit: 'PCS',
	unitPriceINR: 4_680,
	ratePercent: 5,
	taxableINR: 13_371.43,
	cgstINR: 334.28,
	sgstINR: 334.29,
	igstINR: 0,
	totalINR: 14_040,
	...patch,
});

describe('credit note dates (s.34, D4)', () => {
	it('gives 30 November after the invoice’s financial year', () => {
		expect(creditNoteDeadline('2026-11-18')).toBe('2027-11-30');
		expect(creditNoteDeadline('2027-02-10')).toBe('2027-11-30');
		expect(creditNoteDeadline('2027-04-01')).toBe('2028-11-30');
	});

	it('opens the return window for N days after delivery, and not before delivery', () => {
		expect(returnWindow('2026-11-21', 7, '2026-11-28')).toEqual({ ends: '2026-11-28', open: true });
		expect(returnWindow('2026-11-21', 7, '2026-11-29')).toEqual({ ends: '2026-11-28', open: false });
		expect(returnWindow(null, 7, '2026-11-29')).toEqual({ ends: null, open: false });
	});
});

describe('credit note lines from the invoice (B4, B10, B7.3)', () => {
	it('gives back a part line’s share, and the last pieces exactly what is left of the line', () => {
		const invoice = [line()];
		const first = creditLinesFor(invoice, [{ lineId: 'a', quantity: 1, outcome: 'restock', unitCostINR: 3_120 }]);
		expect(first[0]).toMatchObject({
			quantity: 1,
			taxableINR: 4_457.14,
			cgstINR: 111.43,
			totalINR: 4_680,
			outcome: 'restock',
		});
		const rest = creditLinesFor(invoice, [{ lineId: 'a', quantity: 2 }], new Map([['a', 1]]));
		expect(rest[0]).toMatchObject({
			quantity: 2,
			taxableINR: 8_914.29,
			sgstINR: 222.86,
			totalINR: 9_360,
			outcome: null,
		});
		expect(first[0]!.taxableINR + rest[0]!.taxableINR).toBeCloseTo(13_371.43, 2);
		expect(
			creditLinesFor(invoice, [
				{ lineId: 'zz', quantity: 1 },
				{ lineId: 'a', quantity: 0 },
			]),
		).toEqual([]);
	});

	it('takes the tax out of a price adjustment at the line’s own rate, and skips lines not lowered', () => {
		const lowered = priceAdjustmentLines(
			[line({ quantity: 1, totalINR: 4_680 }), line({ lineId: 'b' })],
			[
				{ lineId: 'a', lowerByINR: 500 },
				{ lineId: 'b', lowerByINR: 0 },
				{ lineId: 'x', lowerByINR: 100 },
			],
			false,
		);
		expect(lowered).toHaveLength(1);
		expect(lowered[0]).toMatchObject({
			taxableINR: 476.19,
			cgstINR: 11.9,
			sgstINR: 11.91,
			totalINR: 500,
			unitPriceINR: 500,
		});
	});

	it('adds a delivery share of nothing, saying why', () => {
		expect(deliveryShareLine({ shippingINR: 0 })).toMatchObject({
			hsn: NOTE_DELIVERY_SAC,
			totalINR: 0,
			note: 'free_delivery',
			delivery: true,
		});
		expect(deliveryShareLine({ shippingINR: 105 }).note).toBe('waits_for_ca');
	});

	it('adds up to the rupee, rounding either way', () => {
		expect(noteTotals([{ taxableINR: 476.19, cgstINR: 11.9, sgstINR: 11.91, igstINR: 0 }])).toEqual({
			taxableINR: 476.19,
			cgstINR: 11.9,
			sgstINR: 11.91,
			igstINR: 0,
			roundOffINR: 0,
			totalINR: 500,
		});
		expect(noteTotals([{ taxableINR: 100.4, cgstINR: 0, sgstINR: 0, igstINR: 0 }]).roundOffINR).toBe(-0.4);
		expect(noteTotals([{ taxableINR: 100.6, cgstINR: 0, sgstINR: 0, igstINR: 0 }]).roundOffINR).toBe(0.4);
	});
});

describe('what a credit note may give back', () => {
	const base = {
		invoice: { totalINR: 14_040, lines: [line()] },
		creditedINR: 0,
		creditedPieces: new Map<string, number>(),
		kind: 'goods_returned' as const,
		deadline: '2027-11-30',
		today: '2026-11-25',
	};
	const goods = (quantity: number, totalINR: number) => ({ lineId: 'a', quantity, totalINR, delivery: false });

	it('accepts pieces and money still left on the invoice before the deadline', () => {
		expect(creditNoteProblems({ ...base, lines: [goods(1, 4_680), { ...goods(1, 0), delivery: true }] })).toEqual(
			[],
		);
	});

	it('refuses nothing to give back, more than invoiced, more pieces than left, and after the deadline', () => {
		expect(creditNoteProblems({ ...base, lines: [{ ...goods(1, 0), delivery: true }] })).toEqual([
			'nothing_to_credit',
		]);
		expect(
			creditNoteProblems({
				...base,
				lines: [goods(2, 9_360)],
				creditedINR: 9_360,
				creditedPieces: new Map([['a', 2]]),
				today: '2027-12-01',
			}),
		).toEqual(['more_than_invoiced', 'past_deadline', 'too_many_pieces']);
		expect(
			creditNoteProblems({ ...base, lines: [{ lineId: 'gone', quantity: 1, totalINR: 1, delivery: false }] }),
		).toEqual(['too_many_pieces']);
	});

	it('counts money, not pieces, for a price adjustment', () => {
		expect(
			creditNoteProblems({
				...base,
				kind: 'price_adjustment',
				lines: [goods(3, 500)],
				creditedPieces: new Map([['a', 3]]),
			}),
		).toEqual([]);
	});
});

describe('postings (posting rules)', () => {
	const totals = {
		taxableINR: 4_457.14,
		cgstINR: 111.43,
		sgstINR: 111.43,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 4_680,
	};

	it('takes the sale back, credits the customer and returns restocked pieces to stock at cost', () => {
		const rows = creditNotePosting({ totals, restockCostINR: 3_120 });
		expect(rows).toEqual([
			{ role: 'sales_returns', debitPaise: 445_714 },
			{ role: 'output_cgst', debitPaise: 11_143 },
			{ role: 'output_sgst', debitPaise: 11_143 },
			{ role: 'debtors_control', creditPaise: 468_000 },
			{ role: 'stock_in_hand', debitPaise: 312_000 },
			{ role: 'cost_of_goods_sold', creditPaise: 312_000 },
		]);
		const debit = rows.reduce((s, r) => s + (r.debitPaise ?? 0), 0);
		const credit = rows.reduce((s, r) => s + (r.creditPaise ?? 0), 0);
		expect(debit).toBe(credit);
	});

	it('balances rounding either way, and a debit note is the exact opposite', () => {
		const up = creditNotePosting({ totals: { ...totals, roundOffINR: 0.4 }, restockCostINR: 0 });
		expect(up.at(-1)).toEqual({ role: 'rounding_off', debitPaise: 40 });
		const down = creditNotePosting({ totals: { ...totals, igstINR: 1, roundOffINR: -0.4 }, restockCostINR: 0 });
		expect(down.at(-1)).toEqual({ role: 'rounding_off', creditPaise: 40 });
		expect(debitNotePosting({ totals, restockCostINR: 3_120 }).slice(0, 4)).toEqual([
			{ role: 'sales_returns', creditPaise: 445_714 },
			{ role: 'output_cgst', creditPaise: 11_143 },
			{ role: 'output_sgst', creditPaise: 11_143 },
			{ role: 'debtors_control', debitPaise: 468_000 },
		]);
	});

	it('costs restocked and damaged pieces back in, never written-off ones', () => {
		expect(
			restockCost([
				{ outcome: 'restock', quantity: 2, unitCostINR: 3_120 },
				{ outcome: 'damaged', quantity: 1, unitCostINR: null },
				{ outcome: 'damaged', quantity: 1, unitCostINR: 1_000 },
				{ outcome: 'write_off', quantity: 1, unitCostINR: 9_999 },
				{ outcome: null, quantity: 1, unitCostINR: 50 },
			]),
		).toBe(7_240);
	});
});

describe('cancelling an issued credit note (B8, B9)', () => {
	it('lets only a super admin cancel, and only while nothing has moved on', () => {
		const ok = { monthFiled: false, booksClosed: false, refundPaid: false, superAdmin: true };
		expect(creditNoteCancelAllowed(ok)).toBe(true);
		for (const change of [{ superAdmin: false }, { monthFiled: true }, { booksClosed: true }, { refundPaid: true }])
			expect(creditNoteCancelAllowed({ ...ok, ...change })).toBe(false);
	});
});

describe('input tax on written-off returns (D9, s.17(5)(h))', () => {
	it('takes back the input tax on written-off pieces only, at their cost and the line’s rate', () => {
		expect(
			writeOffInputTax([
				{ outcome: 'write_off', quantity: 2, unitCostINR: 3_120, ratePercent: 5 },
				{ outcome: 'write_off', quantity: 1, unitCostINR: null, ratePercent: 5 },
				{ outcome: 'damaged', quantity: 1, unitCostINR: 3_120, ratePercent: 5 },
				{ outcome: 'restock', quantity: 1, unitCostINR: 3_120, ratePercent: 5 },
			]),
		).toBe(312);
	});

	it('posts stock loss against input CGST and SGST, nothing for nothing, and its opposite', () => {
		expect(inputTaxReversalPosting(312.01)).toEqual([
			{ role: 'stock_loss', debitPaise: 31_201 },
			{ role: 'input_cgst', creditPaise: 15_600 },
			{ role: 'input_sgst', creditPaise: 15_601 },
		]);
		expect(inputTaxReversalPosting(0)).toEqual([]);
		expect(oppositePosting(inputTaxReversalPosting(312.01))[0]).toEqual({
			role: 'stock_loss',
			creditPaise: 31_201,
		});
	});
});
