import type { PurchaseEntry, PurchaseReturn, SupplierPayment } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { describeUnits, roundPaise, roundUnitCost } from '../src/purchasing/money';
import { entryOutstanding, returnsCredit, supplierStatement } from '../src/purchasing/supplier-account';

describe('purchase money helpers: the remaining cases', () => {
	it('rounds negative paise and unit costs away from zero', () => {
		expect(roundPaise(-12.5)).toBe(-13);
		expect(roundPaise(12.5)).toBe(13);
		expect(roundUnitCost(-1.23456)).toBe(-1.2346);
		expect(roundUnitCost(1.23456)).toBe(1.2346);
	});

	it('describes pieces, metres, both, and nothing at all', () => {
		expect(describeUnits([])).toBe('0 pieces');
		expect(describeUnits([{ units: 1, soldBy: 'piece' }])).toBe('1 piece');
		expect(describeUnits([{ units: 25, soldBy: 'metre' }])).toBe('2.5 m');
		expect(
			describeUnits([
				{ units: 3, soldBy: 'piece' },
				{ units: 25, soldBy: 'metre' },
			]),
		).toBe('3 pieces and 2.5 m');
	});
});

const entry = (over: Partial<PurchaseEntry> = {}) =>
	({
		id: 'pe1',
		number: null,
		billNumber: 'B-7',
		billDate: '2026-11-01',
		status: 'posted',
		totals: { totalINR: 1000 },
		paidINR: 0,
		...over,
	}) as unknown as PurchaseEntry;
const ret = (over: Partial<PurchaseReturn> = {}) =>
	({
		id: 'pr1',
		number: null,
		status: 'sent',
		sentAt: '2026-11-03T10:00:00Z',
		totalINR: 200,
		purchaseEntryNumber: null,
		...over,
	}) as unknown as PurchaseReturn;
const payment = (over: Partial<SupplierPayment> = {}) =>
	({
		purchaseEntryId: 'pe1',
		paidOn: '2026-11-05',
		reference: null,
		mode: 'bank',
		amountINR: 300,
		...over,
	}) as unknown as SupplierPayment;

describe('supplier account: the remaining cases', () => {
	it('owes a bill without credits, and counts returns without settlements', () => {
		expect(entryOutstanding({ totals: { totalINR: 1000 }, paidINR: 250 } as never)).toBe(750);
		expect(returnsCredit([ret({ status: 'draft' }), ret()])).toBe(200);
		expect(
			returnsCredit([
				ret({ settlements: [{ how: 'credit_note', amountINR: 200, date: '2026-11-04' }] } as never),
			]),
		).toBe(200);
	});

	it('lists void bills with and without a reason, and skips drafts', () => {
		const rows = supplierStatement({
			entries: [
				entry({ status: 'draft' } as never),
				entry({
					id: 'pe2',
					number: 'PE-2',
					status: 'void',
					voidedAt: '2026-11-02T09:00:00Z',
					voidReason: 'Duplicate',
				} as never),
				entry({ id: 'pe3', status: 'void', voidedAt: '2026-11-02T09:00:00Z' } as never),
				entry({ id: 'pe4', status: 'void' } as never),
			],
			payments: [],
			returns: [],
		});
		expect(rows.map((row) => [row.kind, row.documentNumber, row.details])).toEqual([
			['bill', 'PE-2', 'Bill B-7'],
			['bill', 'B-7', 'Bill B-7'],
			['bill', 'B-7', 'Bill B-7'],
			['credit_note', 'PE-2', 'Voided: Duplicate'],
			['credit_note', 'B-7', 'Voided:'],
		]);
	});

	it('lists returns with every kind of settlement, numbered or not, and skips unsent ones', () => {
		const rows = supplierStatement({
			entries: [],
			payments: [],
			returns: [
				ret({ id: 'draft', status: 'draft' }),
				ret({ id: 'unsent', sentAt: null } as never),
				ret({
					number: 'DN-1',
					purchaseEntryNumber: 'PE-9',
					settlements: [
						{ how: 'refund', amountINR: 50, date: '2026-11-04', reference: 'UTR1' },
						{ how: 'written_off', amountINR: 10, date: '2026-11-04' },
						{ how: 'credit_note', amountINR: 100, date: '2026-11-04', reference: 'CN-7' },
						{ how: 'credit_note', amountINR: 20, date: '2026-11-04' },
						{ how: 'adjusted', amountINR: 20, date: '2026-11-04', reference: 'B-12' },
						{ how: 'adjusted', amountINR: 0, date: '2026-11-04' },
					],
				} as never),
				ret({ id: 'pr2' }),
			],
		});
		expect(rows.map((row) => [row.kind, row.documentNumber, row.details])).toEqual([
			['debit_note', 'DN-1', 'Against PE-9'],
			['debit_note', '', ''],
			['refund_received', 'DN-1', 'UTR1'],
			['claim_written_off', 'DN-1', ''],
			['credit_note', 'DN-1', 'Their credit note CN-7'],
			['credit_note', 'DN-1', 'Their credit note'],
			['credit_note', 'DN-1', 'Taken off a later bill B-12'],
			['credit_note', 'DN-1', 'Taken off a later bill'],
		]);
	});

	it('lists payments, and a reversed one twice, with or without a reference and reason', () => {
		const rows = supplierStatement({
			entries: [],
			returns: [],
			payments: [
				payment({ reference: 'UTR9', reversedAt: '2026-11-06T10:00:00Z', reverseReason: 'Bounced' } as never),
				payment({ reversedAt: '2026-11-07T10:00:00Z' } as never),
			],
		});
		expect(rows.map((row) => [row.kind, row.documentNumber, row.details])).toEqual([
			['payment', 'UTR9', 'bank'],
			['payment', '', 'bank'],
			['payment_reversed', 'UTR9', 'Bounced'],
			['payment_reversed', '', ''],
		]);
	});
});
