import { ExpenseBill, PaymentVoucher } from '@saha-textile/contracts';
import { normalizeBillNumber, rule37 } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { Gstr2bService } from '../src/gst/gstr2b.service';
import { Gstr3bInputs } from '../src/gst/gstr3b-inputs';
import { StockReportsService } from '../src/purchasing/stock-reports.service';
import { SuppliersService } from '../src/purchasing/suppliers.service';

/**
 * Posted expense bills in the rest of the books (brief 25 EB2): what each supplier is owed and their statement, the
 * unpaid bills report, the bills GSTR-2B looks for at a GSTIN, and rule 37's reversal once 180 days pass unpaid.
 */

const bill = (id: string, over: Record<string, unknown> = {}) =>
	ExpenseBill.parse({
		supplierId: 'sup_wb',
		supplierName: 'Kolkata Rentals',
		supplierGstin: '19AAACK1234A1Z5',
		billNumber: `KR/${id}`,
		billDate: '2026-05-10',
		locationId: 'loc_pune',
		lines: [{ expenseLedgerId: 'led_rent', what: 'Rent', taxableINR: 20_000, gstRatePct: 18 }],
		id,
		number: `EB/26-27/${id}`,
		status: 'posted',
		interState: true,
		taxableINR: 20_000,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 3_600,
		blockedTaxINR: 0,
		totalINR: 23_600,
		paidINR: 0,
		createdAt: '2026-05-10T06:00:00.000Z',
		updatedAt: '2026-05-10T06:00:00.000Z',
		version: 1,
		...over,
	});
const voucher = (id: string, amountINR: number, date: string, status: 'paid' | 'cancelled' = 'paid') =>
	PaymentVoucher.parse({
		id,
		number: `PV/26-27/${id}`,
		date,
		supplierId: 'sup_wb',
		payeeName: 'Kolkata Rentals',
		payeeAddress: '',
		against: { kind: 'expenseBill', id: 'eb_due', number: 'EB/26-27/eb_due', detail: 'Rent' },
		amountINR,
		mode: 'bank_transfer',
		reference: null,
		paidFromLedgerId: 'led_hdfc',
		reverseChargeTaxINR: null,
		supplierPaymentId: null,
		journalVoucherId: 'jv_1',
		locationId: 'loc_pune',
		createdAt: `${date}T06:00:00.000Z`,
		createdBy: null,
		status,
	});

/** An expense bill store that filters as the real one does: by supplier and status. */
const store = (bills: ExpenseBill[]) => ({
	list: vi.fn(async (query: { supplierId?: string; status?: string }) =>
		bills.filter(
			(b) =>
				(!query.supplierId || b.supplierId === query.supplierId) &&
				(!query.status || b.status === query.status),
		),
	),
});

describe('what a supplier is owed, with expense bills (EB2)', () => {
	function suppliers(bills: ExpenseBill[], vouchers: PaymentVoucher[] = []) {
		const repo = {
			findById: async (id: string) => ({ id, legalName: 'Kolkata Rentals Pvt Ltd' }),
			list: vi.fn(async (_query: unknown, _owed: Map<string, number>) => ({
				items: [{ id: 'sup_wb' }, { id: 'sup_mh' }],
				total: 2,
			})),
			countActive: async () => ({ all: 2, inactive: 0 }),
		};
		const none = { forSupplier: async () => [] };
		const service = new SuppliersService(
			repo as never,
			{} as never,
			{ openPayables: async () => [], forSupplier: async () => [] } as never,
			none as never,
			none as never,
			{ today: () => '2026-11-25' } as never,
			none as never,
			{ forSupplier: async () => vouchers } as never,
			store(bills) as never,
		);
		return { service, repo };
	}

	it('counts each posted bill’s unpaid part, leaving out bills paid to the paisa', async () => {
		const { service, repo } = suppliers([
			bill('eb_1', { paidINR: 10_000 }),
			bill('eb_2', { totalINR: 5_000 }),
			bill('eb_3', { supplierId: 'sup_mh', totalINR: 1_000, paidINR: 1_000 }),
			bill('eb_4', { supplierId: 'sup_mh', totalINR: 1_000, paidINR: 999.996 }),
			bill('eb_5', { status: 'draft', number: null }),
		]);
		const page = await service.list({ filter: 'all', page: 1, pageSize: 25 } as never);
		expect([...(repo.list.mock.calls[0]?.[1] ?? new Map()).entries()]).toEqual([['sup_wb', 18_600]]);
		expect(page.items.map((s) => [s.id, s.owedINR])).toEqual([
			['sup_wb', 18_600],
			['sup_mh', 0],
		]);
		expect(page.counts.owed).toBe(1);
	});

	it('adds the unpaid part of posted bills to the supplier page, with the bills and their vouchers on the statement', async () => {
		const { service } = suppliers(
			[
				bill('eb_1', { paidINR: 10_000 }),
				// Paid more than its total: nothing owed, never less.
				bill('eb_6', { totalINR: 500, paidINR: 600 }),
				bill('eb_5', { status: 'draft', number: null }),
				bill('eb_7', { status: 'cancelled', paidINR: 0 }),
				// Due a month after its day.
				bill('eb_8', { billDate: '2026-09-01', dueOn: '2026-10-01', totalINR: 1_180 }),
			],
			[voucher('pv_1', 10_000, '2026-06-01')],
		);
		const summary = await service.summary('sup_wb');
		expect(summary.owedINR).toBe(14_780);
		// Both open bills count: one saved before due days (due on its day, 10 May), and the oldest is 199 days old.
		expect([summary.owedBills, summary.nextDueOn, summary.oldestUnpaidDays]).toEqual([2, '2026-05-10', 199]);
		expect(summary.statement.map((row) => [row.kind, row.documentNumber])).toEqual(
			expect.arrayContaining([
				['expense_bill', 'EB/26-27/eb_1'],
				['expense_bill_payment', 'PV/26-27/pv_1'],
			]),
		);
	});
});

describe('the unpaid bills report, with expense bills (EB2)', () => {
	it('lists purchase entries and posted expense bills left to pay, each saying which, oldest first', async () => {
		const entry = {
			id: 'pe_1',
			number: 'PE/26-27/000001',
			supplierId: 'sup_mh',
			supplierName: 'Pune Software',
			billNumber: 'PS/77',
			billDate: '2026-08-01',
			dueOn: '2026-08-31',
			totals: { totalINR: 4_000 },
			paidINR: 1_000,
			creditedINR: 0,
		};
		const service = new StockReportsService(
			{} as never,
			{ openPayables: async () => [entry, { ...entry, id: 'pe_paid', paidINR: 4_000 }] } as never,
			{} as never,
			{ settings: async () => ({ unpaidAlertDays: 150 }), today: () => '2026-11-25' } as never,
			store([
				bill('eb_old', { billDate: '2026-05-10', paidINR: 3_600.004 }),
				bill('eb_new', { billDate: '2026-11-20', dueOn: '2026-12-20', totalINR: 1_180 }),
				bill('eb_paid', { paidINR: 23_600 }),
				bill('eb_draft', { status: 'draft', number: null }),
			]) as never,
		);
		const report = await service.unpaidBills();
		expect(report.alertDays).toBe(150);
		expect(report.rows.map((r) => [r.kind, r.id, r.dueOn, r.leftINR, r.days, r.nearLimit])).toEqual([
			['expenseBill', 'eb_old', '2026-05-10', 20_000, 199, true],
			['purchaseEntry', 'pe_1', '2026-08-31', 3_000, 116, false],
			['expenseBill', 'eb_new', '2026-12-20', 1_180, 5, false],
		]);
		expect(report.rows[0]).toMatchObject({
			number: 'EB/26-27/eb_old',
			supplierId: 'sup_wb',
			supplierName: 'Kolkata Rentals',
			billNumber: 'KR/eb_old',
			billDate: '2026-05-10',
			totalINR: 23_600,
		});
	});
});

/** The bar is the stock location under West Bengal's GSTIN; Pune bills under Maharashtra's; Delhi's has no location. */
const LOCATIONS = [
	{
		id: 'loc_bar',
		active: true,
		warehouse: true,
		shipsOnline: true,
		createdAt: '2026-01-01',
		gstRegistrationId: 'reg_wb',
	},
	{
		id: 'loc_pune',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-02-01',
		gstRegistrationId: 'reg_mh',
	},
];

describe('the bills GSTR-2B looks for, with expense bills (EB2)', () => {
	function twoB(bills: ExpenseBill[]) {
		const expenseBills = store(bills);
		const entries = { postedBetween: vi.fn(async () => []) };
		const service = new Gstr2bService(
			{
				listForRegistration: async () => [
					// Found in October's 2B: not looked for again. November's own import doesn't count.
					{
						month: '2026-10',
						lines: [
							{ kind: 'invoice', key: `19AAACK1234A1Z5|invoice|${normalizeBillNumber('KR/eb_seen')}` },
							{
								kind: 'credit_note',
								key: `19AAACK1234A1Z5|invoice|${normalizeBillNumber('KR/eb_note')}`,
							},
						],
					},
					{
						month: '2026-11',
						lines: [
							{ kind: 'invoice', key: `19AAACK1234A1Z5|invoice|${normalizeBillNumber('KR/eb_due')}` },
						],
					},
				],
			} as never,
			{} as never,
			entries as never,
			{ list: async () => LOCATIONS } as never,
			{} as never,
			{} as never,
			expenseBills as never,
		);
		return { service, expenseBills, entries };
	}
	const BILLS = [
		bill('eb_due', { supplierGstin: '19aaack1234a1z5' }),
		bill('eb_note'),
		bill('eb_seen'),
		// Blocked tax only: looked for, with no claimable tax of its own.
		bill('eb_blocked', { igstINR: 0, blockedTaxINR: 3_600 }),
		bill('eb_numberless', { number: null }),
		bill('eb_untaxed', { igstINR: 0 }),
		bill('eb_unregistered', { supplierGstin: null }),
		bill('eb_bar', { locationId: 'loc_bar' }),
		// From two years before: past the s.16(4) limit by November 2026.
		bill('eb_stale', { billDate: '2025-03-10' }),
	];

	it('finds expense bills billed to the GSTIN’s locations, with their claimable tax, not seen in an earlier 2B', async () => {
		const { service, expenseBills, entries } = twoB(BILLS);
		const books = await service.booksBills('reg_mh', '2026-11');
		expect(expenseBills.list).toHaveBeenCalledWith({ status: 'posted', from: '2024-04-01', to: '2026-11-30' });
		expect(books.map((b) => [b.entryId, b.entryNumber, b.supplierGstin, b.igst, b.cgst, b.sgst])).toEqual([
			['eb_due', 'EB/26-27/eb_due', '19AAACK1234A1Z5', 3_600_00, 0, 0],
			['eb_note', 'EB/26-27/eb_note', '19AAACK1234A1Z5', 3_600_00, 0, 0],
			['eb_blocked', 'EB/26-27/eb_blocked', '19AAACK1234A1Z5', 0, 0, 0],
			['eb_numberless', '', '19AAACK1234A1Z5', 3_600_00, 0, 0],
		]);
		expect(books[0]).toMatchObject({
			supplierName: 'Kolkata Rentals',
			billNumber: 'KR/eb_due',
			billDate: '2026-05-10',
			taxable: 20_000_00,
		});
		// Maharashtra's GSTIN doesn't hold the stock: no purchase entries.
		expect(entries.postedBetween).not.toHaveBeenCalled();
	});

	it('adds the purchase entries at the stock location’s GSTIN, and reads no expense bills for a GSTIN with no location', async () => {
		const { service, entries } = twoB(BILLS);
		expect((await service.booksBills('reg_wb', '2026-11')).map((b) => b.entryId)).toEqual(['eb_bar']);
		expect(entries.postedBetween).toHaveBeenCalledWith('2024-04-01', '2026-11-30');
		const nowhere = twoB(BILLS);
		expect(await nowhere.service.booksBills('reg_dl', '2026-11')).toEqual([]);
		expect(nowhere.expenseBills.list).not.toHaveBeenCalled();
	});
});

describe('rule 37 over expense bills (EB2)', () => {
	/** December 2026: bills from 10 May reach 180 days on 6 November. */
	function inputs(bills: ExpenseBill[], vouchers: PaymentVoucher[]) {
		const entries = { postedBetween: vi.fn(async () => []) };
		const forDocument = vi.fn(async (_kind: string, id: string) => (id === 'eb_due' ? vouchers : []));
		const service = new Gstr3bInputs(
			{ rows: async () => ({ doc: null, rows: [] }) } as never,
			{ issuedForGstin: async () => [] } as never,
			{ chart: async () => ({ groups: [], ledgers: [] }), listVouchers: vi.fn() } as never,
			{ list: async () => LOCATIONS } as never,
			entries as never,
			{ forEntry: async () => [] } as never,
			store(bills) as never,
			{ forDocument } as never,
		);
		return { service, entries, forDocument };
	}

	it('takes back the credit on the unpaid part of bills at the GSTIN’s locations once 180 days pass', async () => {
		const { service, entries, forDocument } = inputs(
			[
				bill('eb_due'),
				bill('eb_claim_none', { igstINR: 0, blockedTaxINR: 3_600 }),
				bill('eb_unregistered', { supplierGstin: null }),
				bill('eb_bar', { locationId: 'loc_bar' }),
				bill('eb_recent', { billDate: '2026-11-01' }),
			],
			[voucher('pv_1', 5_000, '2026-06-01'), voucher('pv_2', 10_000, '2026-07-01', 'cancelled')],
		);
		const books = await service.collect('reg_mh', '2026-12');
		const expected = rule37(
			[
				{
					entryId: 'eb_due',
					billDate: '2026-05-10',
					totalPaise: 23_600_00,
					creditedPaise: 0,
					tax: { igst: 3_600_00, cgst: 0, sgst: 0 },
					// The cancelled voucher paid nothing.
					payments: [{ paidOn: '2026-06-01', paise: 5_000_00 }],
				},
			],
			'2026-12',
		);
		expect(books.rule37).toEqual(expected.reversed);
		expect(books.rule37.igst).toBeGreaterThan(0);
		expect(books.reclaimed).toEqual(expected.reclaimed);
		expect(forDocument.mock.calls).toEqual([['expenseBill', 'eb_due']]);
		// Maharashtra's GSTIN doesn't hold the stock: no purchase entries.
		expect(entries.postedBetween).not.toHaveBeenCalled();
	});
});
