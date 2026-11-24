import { VoucherKind } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { Gstr3bInputs } from '../src/gst/gstr3b-inputs';

/** GSTR-3B's figures from the books and 2B (accounts brief G6): self-invoices, 2B credit, reversals, rule 37. */

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
		id: 'loc_shop',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-02',
		gstRegistrationId: 'reg_wb',
	},
	{
		id: 'loc_tr',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-03',
		gstRegistrationId: 'reg_tr',
	},
];
const CHART = {
	groups: [],
	ledgers: [
		{ id: 'led_igst', roles: ['input_igst'] },
		{ id: 'led_cgst', roles: ['input_cgst'] },
		{ id: 'led_sgst', roles: ['input_sgst'] },
	],
};
const line = (ledgerId: string, locationId: string, creditPaise: number, debitPaise = 0) => ({
	ledgerId,
	locationId,
	creditPaise,
	debitPaise,
});
const VOUCHERS = [
	// Stock written off at the warehouse: its input IGST taken back.
	{ id: 'jv_1', source: { type: 'stockAdjustment' }, lines: [line('led_igst', 'loc_bar', 300)] },
	// A purchase is not a reversal.
	{ id: 'jv_2', source: { type: 'purchaseEntry' }, lines: [line('led_igst', 'loc_bar', 999)] },
	// A returned piece written off: at the shop counts, at another GSTIN's location doesn't.
	{
		id: 'jv_3',
		source: { type: 'creditNoteInputTax' },
		lines: [line('led_cgst', 'loc_tr', 100), line('led_sgst', 'loc_shop', 70, 20)],
	},
];

const row = (over: Record<string, unknown>) => ({
	key: 'k',
	result: 'matched',
	kind: 'invoice',
	supplierGstin: '27AAKFR1234M1Z2',
	supplierName: 'Rang Mahal',
	number: 'RM/101',
	date: '2026-11-05',
	reverseCharge: false,
	itcAvailable: true,
	books: { taxable: 10_000, igst: 500, cgst: 0, sgst: 0 },
	twoB: { taxable: 10_000, igst: 500, cgst: 0, sgst: 0 },
	entryId: 'pe_1',
	entryNumber: 'PE/1',
	action: 'accept',
	...over,
});
const TWO_B_ROWS = [
	row({ key: 'a' }),
	row({ key: 'b', result: 'only_2b', books: null, entryId: null, entryNumber: null }),
	row({ key: 'c', result: 'only_2b', books: null, entryId: null, entryNumber: null, action: 'pending' }),
];

const entry = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	itcClaimable: true,
	supplierGstin: '27AAKFR1234M1Z2',
	billDate: '2026-05-20',
	creditedINR: 0,
	totals: { taxableINR: 1000, igstINR: 180, cgstINR: 0, sgstINR: 0, totalINR: 1180 },
	...over,
});
const ENTRIES = [
	// 180 days end on 16 November with 680 unpaid: that part's credit goes back.
	entry('pe_due'),
	// 180 days ended in August, unpaid then, paid in full in November: its credit comes back.
	entry('pe_reclaim', {
		billDate: '2026-03-01',
		totals: { taxableINR: 1000, igstINR: 0, cgstINR: 25, sgstINR: 25, totalINR: 1050 },
	}),
	// Not yet 180 days, no credit claimed, no supplier GSTIN: rule 37 doesn't look at them.
	entry('pe_later', { billDate: '2026-11-01' }),
	entry('pe_no_credit', { itcClaimable: false }),
	entry('pe_no_gstin', { supplierGstin: null }),
];
const PAYMENTS: Record<string, unknown[]> = {
	pe_due: [
		{ paidOn: '2026-06-01', amountINR: 500, reversedAt: null },
		{ paidOn: '2026-06-02', amountINR: 680, reversedAt: '2026-06-03T06:00:00.000Z' },
	],
	pe_reclaim: [{ paidOn: '2026-11-10', amountINR: 1050, reversedAt: null }],
};

function build(
	options: {
		locations?: unknown[];
		chart?: unknown;
		pages?: { items: unknown[]; total: number }[];
		doc?: unknown;
	} = {},
) {
	const pages = options.pages ?? [
		{ items: VOUCHERS.slice(0, 2), total: 3 },
		{ items: VOUCHERS.slice(2), total: 3 },
	];
	const gstr2b = {
		rows: vi.fn(async () => ({ doc: options.doc === undefined ? { id: 'g2b_1' } : options.doc, rows: TWO_B_ROWS })),
	};
	const selfInvoices = {
		issuedForGstin: vi.fn(async (_registration: string, _from: string, _to: string) => [
			{ taxableINR: 600, igstINR: 0, cgstINR: 54, sgstINR: 54 },
		]),
	};
	const ledger = {
		chart: async () => options.chart ?? CHART,
		listVouchers: vi.fn(async (query: { page: number }) => pages[query.page - 1] ?? { items: [], total: 0 }),
	};
	const entries = { postedBetween: vi.fn(async (_from: string, _to: string) => ENTRIES) };
	const payments = { forEntry: vi.fn(async (id: string) => PAYMENTS[id] ?? []) };
	const inputs = new Gstr3bInputs(
		gstr2b as never,
		selfInvoices as never,
		ledger as never,
		{ list: async () => options.locations ?? LOCATIONS } as never,
		entries as never,
		payments as never,
	);
	return { inputs, gstr2b, selfInvoices, ledger, entries, payments };
}

describe('GSTR-3B’s figures from the books and 2B (G6)', () => {
	it('takes the month’s self-invoices, 2B’s accepted credit, the books’ reversals and rule 37, in paise', async () => {
		const { inputs, gstr2b, selfInvoices, ledger, entries, payments } = build();
		const books = await inputs.collect('reg_wb', '2026-11');
		expect(selfInvoices.issuedForGstin).toHaveBeenCalledWith('reg_wb', '2026-11-01', '2026-11-30');
		expect(gstr2b.rows).toHaveBeenCalledWith('reg_wb', '2026-11');
		expect(entries.postedBetween).toHaveBeenCalledWith('2024-04-01', '2026-11-30');
		expect(payments.forEntry.mock.calls.map(([id]) => id)).toEqual(['pe_due', 'pe_reclaim']);
		expect(ledger.listVouchers).toHaveBeenCalledTimes(2);
		expect(ledger.listVouchers).toHaveBeenCalledWith({
			from: '2026-11-01',
			to: '2026-11-30',
			kinds: VoucherKind.options,
			search: '',
			page: 1,
			pageSize: 200,
		});
		expect(books).toEqual({
			selfInvoices: [{ taxable: 60_000, igst: 0, cgst: 5_400, sgst: 5_400 }],
			twoBImported: true,
			// The matched row and the accepted bill only in 2B; the pending one claims nothing.
			itc2b: { igst: 500, cgst: 0, sgst: 0 },
			acceptedNotInBooks: 1,
			reversedInBooks: { igst: 300, cgst: 0, sgst: 50 },
			// 680 of 1,180 unpaid: 18,000 × 68,000 / 118,000 paise of IGST.
			rule37: { igst: 10_373, cgst: 0, sgst: 0 },
			reclaimed: { igst: 0, cgst: 2_500, sgst: 2_500 },
		});
	});

	it('stops reading vouchers at an empty page, whatever the total says', async () => {
		const { inputs, ledger } = build({ pages: [{ items: VOUCHERS.slice(0, 1), total: 5 }] });
		expect((await inputs.collect('reg_wb', '2026-11')).reversedInBooks).toEqual({ igst: 300, cgst: 0, sgst: 0 });
		expect(ledger.listVouchers).toHaveBeenCalledTimes(2);
	});

	it('takes nothing back before the input tax ledgers are mapped, and runs rule 37 only for the stock location’s GSTIN', async () => {
		const { inputs, ledger, entries } = build({ chart: { groups: [], ledgers: [] }, doc: null });
		const other = await inputs.collect('reg_tr', '2026-11');
		expect(ledger.listVouchers).not.toHaveBeenCalled();
		expect(entries.postedBetween).not.toHaveBeenCalled();
		expect(other).toMatchObject({
			twoBImported: false,
			reversedInBooks: { igst: 0, cgst: 0, sgst: 0 },
			rule37: { igst: 0, cgst: 0, sgst: 0 },
			reclaimed: { igst: 0, cgst: 0, sgst: 0 },
		});
		const noStock = build({ locations: [] });
		expect((await noStock.inputs.collect('reg_wb', '2026-11')).rule37).toEqual({ igst: 0, cgst: 0, sgst: 0 });
		expect(noStock.entries.postedBetween).not.toHaveBeenCalled();
	});
});
