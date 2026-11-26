import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExpenseBill as ExpenseBillSchema, type ExpenseBill, type ExpenseBillWrite } from '@saha-textile/contracts';
import { expenseBillPosting, expenseBillTotals } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { ExpenseBillsController, ExpenseBillsModule, ExpenseBillsService } from '../src/expense-bills/expense-bills';
import { LedgerModule } from '../src/ledger/ledger.module';
import { OrdersSetupModule } from '../src/orders-setup/orders-setup.module';

/**
 * Purchases › Expense bills (brief 25 EB1): a registered supplier's bill for something that isn't stock, saved as a
 * draft, posted once with its EB number, and cancelled by posting the opposite of its voucher.
 */

const at = '2026-11-25T10:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.post'] } as never;

/** A West Bengal supplier known by a short name, a Maharashtra one by its legal name only, and a carpenter without a GSTIN. */
const SUPPLIERS: Record<string, unknown> = {
	sup_wb: {
		id: 'sup_wb',
		shortName: 'Kolkata Rentals',
		legalName: 'Kolkata Rentals Pvt Ltd',
		gstin: '19AAACK1234A1Z5',
		paymentTermsDays: 30,
		address: { line: '12 Park Street', city: 'Kolkata', pin: '700016' },
	},
	sup_mh: {
		id: 'sup_mh',
		shortName: '',
		legalName: 'Pune Software LLP',
		gstin: '27AAACP1234A1Z5',
		paymentTermsDays: 30,
		address: { line: '', city: 'Pune', pin: '' },
	},
	sup_none: {
		id: 'sup_none',
		shortName: 'Carpenter',
		legalName: 'Ramesh Mistri',
		gstin: null,
		paymentTermsDays: 30,
		address: { line: '', city: '', pin: '' },
	},
};
/** Each location bills under its GSTIN: the fair stall has none, Siliguri is on composition, the old shop is closed. */
const LOCATIONS = [
	{ id: 'loc_bar', name: 'Barasat', active: true, stateCode: '19', gstRegistrationId: 'reg_wb' },
	{ id: 'loc_pune', name: 'Pune', active: true, stateCode: '27', gstRegistrationId: 'reg_mh' },
	{ id: 'loc_stall', name: 'Fair stall', active: true, stateCode: '19', gstRegistrationId: null },
	{ id: 'loc_comp', name: 'Siliguri', active: true, stateCode: '19', gstRegistrationId: 'reg_comp' },
	{ id: 'loc_shut', name: 'Old shop', active: false, stateCode: '19', gstRegistrationId: 'reg_wb' },
];
/** Maharashtra's registration has no terms until 2099, so it is on no scheme yet. */
const REGISTRATIONS = [
	{ id: 'reg_wb', gstin: '19DBYPS6736R1ZZ', terms: [{ from: '2020-01-01', kind: 'regular', scheme: 'monthly' }] },
	{ id: 'reg_mh', gstin: '27DBYPS6736R1ZZ', terms: [{ from: '2099-01-01', kind: 'regular', scheme: 'monthly' }] },
	{
		id: 'reg_comp',
		gstin: '19AAACC1234A1Z5',
		terms: [{ from: '2020-01-01', kind: 'composition', scheme: 'monthly' }],
	},
];
/** Expense ledgers open to postings, and ones that aren't: closed, a control ledger, an asset, a firm's appropriation. */
const CHART = {
	groups: [{ id: 'g_appropriation', systemKey: 'appropriation', parentId: null }],
	ledgers: [
		{
			id: 'led_partner_interest',
			name: "Interest on partners' capital",
			nature: 'expense',
			active: true,
			handPosting: true,
			groupId: 'g_appropriation',
		},
		{ id: 'led_rent', name: 'Rent', nature: 'expense', active: true, handPosting: true },
		{ id: 'led_audit', name: 'Audit fees', nature: 'expense', active: true, handPosting: true },
		{ id: 'led_old', name: 'Old expense', nature: 'expense', active: false, handPosting: true },
		{ id: 'led_cogs', name: 'Cost of goods sold', nature: 'expense', active: true, handPosting: false },
		{ id: 'led_cash', name: 'Cash', nature: 'asset', active: true, handPosting: true },
	],
};
const write = (over: Partial<ExpenseBillWrite> = {}): ExpenseBillWrite => ({
	supplierId: 'sup_wb',
	billNumber: 'KR/1123',
	billDate: '2026-11-20',
	locationId: 'loc_bar',
	lines: [
		{
			expenseLedgerId: 'led_rent',
			what: 'Shop rent, November',
			sac: '997212',
			taxableINR: 20_000,
			gstRatePct: 18,
			credit: 'claim',
			blockedClause: '',
		},
	],
	note: '',
	...over,
});
/** A saved bill as the contract reads it (defaults filled, the shape checked). */
const bill = (over: Partial<ExpenseBill> = {}): ExpenseBill =>
	ExpenseBillSchema.parse({
		...write(),
		...expenseBillTotals(write().lines, false),
		id: 'eb_1',
		number: null,
		status: 'draft',
		interState: false,
		voucherId: null,
		postedAt: null,
		postedBy: null,
		createdAt: '2026-11-20T06:00:00.000Z',
		updatedAt: '2026-11-20T06:00:00.000Z',
		version: 2,
		...over,
	});

interface Options {
	/** The books' chart (the expense ledgers' by default). */
	chart?: unknown;
	stored?: ExpenseBill | null;
	saveFails?: unknown;
	original?: unknown;
}

function build(options: Options = {}) {
	const bills = {
		list: vi.fn(async () => ['bill']),
		get: vi.fn(async () => (options.stored === undefined ? bill() : options.stored)),
		save: vi.fn(async (next: ExpenseBill, _expected: number | null, _context?: unknown) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			return next;
		}),
	};
	const ledger = {
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: 'jv_9' })),
		voucherByKey: vi.fn(async (_key: string, _context: unknown) => options.original ?? null),
		chart: async () => options.chart ?? CHART,
	};
	const company = { listRegistrations: vi.fn(async () => REGISTRATIONS) };
	const vouchers = {
		insert: vi.fn(async (_voucher: unknown, _context: unknown) => undefined),
		forDocument: vi.fn(async () => ['pv']),
	};
	const log = { append: vi.fn(async (..._args: unknown[]) => undefined) };
	const numbers = {
		issue: vi.fn(async (kind: string, _context?: unknown, _at?: Date) =>
			kind === 'paymentVoucher' ? 'PV/26-27/000011' : 'EB/26-27/000003',
		),
	};
	const transactions = {
		withTransaction: vi.fn(async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' })),
	};
	const service = new ExpenseBillsService(
		bills as never,
		{ findById: async (id: string) => SUPPLIERS[id] ?? null } as never,
		{ list: async () => LOCATIONS } as never,
		company as never,
		ledger as never,
		numbers as never,
		transactions as never,
		vouchers as never,
		log as never,
	);
	return { service, bills, ledger, numbers, transactions, company, vouchers, log };
}

describe('reading expense bills', () => {
	it('lists them as the store finds them, and refuses one it doesn’t have', async () => {
		const { service, bills } = build({ stored: null });
		const query = { supplierId: 'sup_wb', status: 'draft', from: '2026-11-01', to: '2026-11-30' } as const;
		expect(await service.list(query)).toEqual(['bill']);
		expect(bills.list).toHaveBeenCalledWith(query);
		await expect(service.get('eb_gone')).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.get('eb_gone')).rejects.toMatchObject(refusal('expense_bill_not_found'));
	});
});

describe('saving a draft', () => {
	it('works out the figures in the location’s State: CGST and SGST from a supplier there', async () => {
		const { service, bills } = build();
		const saved = await service.create(write(), now);
		expect(saved).toMatchObject({
			...write(),
			// Saved with the supplier's short name, as lists show it.
			supplierName: 'Kolkata Rentals',
			interState: false,
			taxableINR: 20_000,
			cgstINR: 1_800,
			sgstINR: 1_800,
			igstINR: 0,
			totalINR: 23_600,
			number: null,
			status: 'draft',
			voucherId: null,
			postedAt: null,
			postedBy: null,
			// Due on the supplier's 30 days' terms from the bill's day.
			dueOn: '2026-12-20',
			createdAt: at,
			updatedAt: at,
			version: 0,
		});
		expect(saved.id).toMatch(/^eb_[0-9a-f-]{36}$/);
		expect(bills.save.mock.calls[0]?.[1]).toBeNull();
	});

	it('takes IGST from another State’s supplier, and no tax from one without a GSTIN charging none', async () => {
		const { service } = build();
		expect(await service.create(write({ supplierId: 'sup_mh' }), now)).toMatchObject({
			// No short name: its legal name.
			supplierName: 'Pune Software LLP',
			interState: true,
			cgstINR: 0,
			igstINR: 3_600,
		});
		const zero = write({
			supplierId: 'sup_none',
			lines: [{ ...write().lines[0], gstRatePct: 0 } as ExpenseBillWrite['lines'][number]],
		});
		expect(await service.create(zero, now)).toMatchObject({ interState: false, totalINR: 20_000 });
	});

	it('refuses an unknown supplier or location, and GST on an unregistered supplier’s bill', async () => {
		const { service, bills } = build();
		await expect(service.create(write({ supplierId: 'sup_gone' }))).rejects.toMatchObject(
			refusal('supplier_unknown'),
		);
		await expect(service.create(write({ locationId: 'loc_gone' }))).rejects.toMatchObject(
			refusal('location_unknown'),
		);
		// A closed location is no place to bill to either.
		await expect(service.create(write({ locationId: 'loc_shut' }))).rejects.toMatchObject(
			refusal('location_unknown'),
		);
		await expect(service.create(write({ supplierId: 'sup_none' }))).rejects.toMatchObject(
			refusal('use_self_invoice'),
		);
		await expect(service.create(write({ supplierId: 'sup_none' }))).rejects.toBeInstanceOf(BadRequestException);
		expect(bills.save).not.toHaveBeenCalled();
	});
});

describe('the form’s choices and the bill’s checks (EB1)', () => {
	const line = (over: Partial<ExpenseBillWrite['lines'][number]>) =>
		({ ...write().lines[0], ...over }) as ExpenseBillWrite['lines'][number];

	it('offers the active locations with the GSTIN they bill under, and the expense ledgers by name', async () => {
		expect(await build().service.form()).toEqual({
			locations: [
				{ id: 'loc_bar', name: 'Barasat', stateCode: '19', gstin: '19DBYPS6736R1ZZ', composition: false },
				{ id: 'loc_pune', name: 'Pune', stateCode: '27', gstin: '27DBYPS6736R1ZZ', composition: false },
				{ id: 'loc_stall', name: 'Fair stall', stateCode: '19', gstin: null, composition: false },
				{ id: 'loc_comp', name: 'Siliguri', stateCode: '19', gstin: '19AAACC1234A1Z5', composition: true },
			],
			ledgers: [
				{ id: 'led_audit', name: 'Audit fees' },
				{ id: 'led_rent', name: 'Rent' },
			],
		});
	});

	it('books lines only to active expense ledgers open to postings, before anything about tax', async () => {
		const { service, bills } = build();
		for (const expenseLedgerId of ['led_old', 'led_cogs', 'led_cash', 'led_gone'])
			await expect(
				service.create(write({ lines: [write().lines[0] as never, line({ expenseLedgerId })] })),
			).rejects.toMatchObject(refusal('expense_bill_not_an_expense'));
		// An unregistered supplier's GST on a ledger that isn't an expense: the ledger is named first.
		await expect(
			service.create(write({ supplierId: 'sup_none', lines: [line({ expenseLedgerId: 'led_cash' })] })),
		).rejects.toMatchObject(refusal('expense_bill_not_an_expense'));
		expect(bills.save).not.toHaveBeenCalled();
	});

	it('claims credit only at a location billing under a GSTIN not on composition on the bill’s day', async () => {
		const { service } = build();
		await expect(service.create(write({ locationId: 'loc_stall' }))).rejects.toMatchObject(
			refusal('expense_bill_no_gstin'),
		);
		await expect(service.create(write({ locationId: 'loc_comp' }))).rejects.toMatchObject(
			refusal('expense_bill_composition_no_credit'),
		);
		// Pune's GSTIN has no terms on the bill's day: not composition, so the West Bengal supplier's IGST is claimed.
		expect(await service.create(write({ locationId: 'loc_pune' }), now)).toMatchObject({
			interState: true,
			igstINR: 3_600,
		});
	});

	it('reads no registration for a bill claiming no credit: blocked tax, or no GST', async () => {
		const { service, company } = build();
		const blocked = await service.create(
			write({ locationId: 'loc_stall', lines: [line({ credit: 'blocked', blockedClause: 'b' })] }),
			now,
		);
		expect(blocked).toMatchObject({ cgstINR: 0, blockedTaxINR: 3_600, totalINR: 23_600 });
		const untaxed = await service.create(write({ locationId: 'loc_comp', lines: [line({ gstRatePct: 0 })] }), now);
		expect(untaxed).toMatchObject({ totalINR: 20_000 });
		expect(company.listRegistrations).not.toHaveBeenCalled();
	});
});

describe('changing a draft', () => {
	it('saves the change with its figures worked again, at the version the screen had', async () => {
		const { service, bills } = build();
		// The screen read version 1; the store holds version 2 and decides.
		const changed = await service.update('eb_1', { ...write({ supplierId: 'sup_mh' }), version: 1 }, now);
		expect(changed).toMatchObject({
			id: 'eb_1',
			supplierId: 'sup_mh',
			supplierName: 'Pune Software LLP',
			interState: true,
			igstINR: 3_600,
			updatedAt: at,
		});
		expect(bills.save.mock.calls[0]?.[1]).toBe(1);
		expect(bills.save.mock.calls[0]?.[0].version).toBe(2);
	});

	it('refuses a bill no longer a draft, one changed meanwhile, and passes any other failure on', async () => {
		const edit = { ...write(), version: 2 };
		await expect(build({ stored: bill({ status: 'posted' }) }).service.update('eb_1', edit)).rejects.toMatchObject(
			refusal('expense_bill_not_draft'),
		);
		const changed = build({ saveFails: new Error('expense_bill_changed') }).service.update('eb_1', edit);
		await expect(changed).rejects.toBeInstanceOf(ConflictException);
		await expect(
			build({ saveFails: new Error('expense_bill_changed') }).service.update('eb_1', edit),
		).rejects.toMatchObject(refusal('expense_bill_changed'));
		const diskFull = new Error('disk full');
		await expect(build({ saveFails: diskFull }).service.update('eb_1', edit)).rejects.toBe(diskFull);
		await expect(build({ saveFails: 'odd' }).service.update('eb_1', edit)).rejects.toBe('odd');
	});
});

describe('posting a bill (EB1)', () => {
	it('gives it its EB number and one voucher on the bill’s day, then saves it posted, all in one transaction', async () => {
		const { service, bills, ledger, numbers, transactions } = build();
		const posted = await service.post('eb_1', ca, now);
		expect(transactions.withTransaction).toHaveBeenCalledOnce();
		expect(numbers.issue).toHaveBeenCalledWith('expenseBill', { session: 'tx' }, new Date('2026-11-20T06:30:00Z'));
		expect(ledger.post).toHaveBeenCalledWith(
			{
				kind: 'document',
				date: '2026-11-20',
				narration: 'Expense bill EB/26-27/000003 (KR/1123)',
				source: { type: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000003' },
				idempotencyKey: 'expenseBill:eb_1',
				lines: expenseBillPosting(bill()),
			},
			{ session: 'tx' },
			'adm_ca',
		);
		expect(posted).toMatchObject({
			number: 'EB/26-27/000003',
			status: 'posted',
			voucherId: 'jv_9',
			postedAt: at,
			postedBy: 'adm_ca',
			updatedAt: at,
		});
		expect(bills.save.mock.calls[0]?.slice(1)).toEqual([2, { session: 'tx' }]);
	});

	it('posts as no one when no one is signed in, and refuses a bill already posted', async () => {
		const { service, ledger } = build();
		expect((await service.post('eb_1', undefined)).postedBy).toBeNull();
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
		await expect(build({ stored: bill({ status: 'posted' }) }).service.post('eb_1', ca)).rejects.toMatchObject(
			refusal('expense_bill_not_draft'),
		);
	});
});

describe('cancelling a bill', () => {
	const ORIGINAL = {
		id: 'jv_9',
		lines: [
			{ ledgerId: 'led_rent', locationId: 'loc_bar', debitPaise: 20_000_00, creditPaise: 0 },
			{ ledgerId: 'led_input_cgst', locationId: 'loc_bar', debitPaise: 1_800_00, creditPaise: 0 },
			{ ledgerId: 'led_creditors', locationId: 'loc_bar', debitPaise: 0, creditPaise: 21_800_00 },
		],
	};

	it('posts the opposite of a posted bill’s voucher on the day it is cancelled, and keeps its number', async () => {
		const { service, ledger, bills } = build({
			stored: bill({ status: 'posted', number: 'EB/26-27/000003', voucherId: 'jv_9' }),
			original: ORIGINAL,
		});
		// 25 Nov 2026, 23:30 in India.
		const cancelled = await service.cancel('eb_1', 'Billed twice', ca, new Date('2026-11-25T18:00:00Z'));
		expect(ledger.voucherByKey).toHaveBeenCalledWith('expenseBill:eb_1', { session: 'tx' });
		expect(ledger.post).toHaveBeenCalledWith(
			{
				kind: 'document',
				date: '2026-11-25',
				narration: 'Cancelled expense bill EB/26-27/000003: Billed twice',
				source: { type: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000003' },
				idempotencyKey: 'expenseBill:eb_1:cancel',
				lines: [
					{ ledger: { id: 'led_rent' }, locationId: 'loc_bar', debitPaise: 0, creditPaise: 20_000_00 },
					{ ledger: { id: 'led_input_cgst' }, locationId: 'loc_bar', debitPaise: 0, creditPaise: 1_800_00 },
					{ ledger: { id: 'led_creditors' }, locationId: 'loc_bar', debitPaise: 21_800_00, creditPaise: 0 },
				],
			},
			{ session: 'tx' },
			'adm_ca',
		);
		expect(cancelled).toMatchObject({ status: 'cancelled', number: 'EB/26-27/000003' });
		expect(bills.save.mock.calls[0]?.slice(1)).toEqual([2, { session: 'tx' }]);
	});

	it('names a bill without its EB number by the supplier’s, as no one when no one is signed in', async () => {
		const { service, ledger } = build({ stored: bill({ status: 'posted' }), original: ORIGINAL });
		await service.cancel('eb_1', 'Wrong supplier', undefined, now);
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			narration: 'Cancelled expense bill KR/1123: Wrong supplier',
			source: { number: null },
		});
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
	});

	it('cancels a draft without posting, and refuses one cancelled already', async () => {
		const { service, ledger } = build();
		expect(await service.cancel('eb_1', 'Not needed', ca, now)).toMatchObject({
			status: 'cancelled',
			updatedAt: at,
		});
		expect(ledger.post).not.toHaveBeenCalled();
		await expect(
			build({ stored: bill({ status: 'cancelled' }) }).service.cancel('eb_1', 'Again', ca),
		).rejects.toMatchObject(refusal('expense_bill_cancelled'));
	});
});

/** The books with two banks (one closed, one under a sub-group), and the cash and rent ledgers that aren't banks. */
const BANKS = {
	groups: [
		{ id: 'g_bank', parentId: null, systemKey: 'bank_accounts' },
		{ id: 'g_bank_sub', parentId: 'g_bank', systemKey: null },
		{ id: 'g_cash', parentId: null, systemKey: 'cash_in_hand' },
	],
	ledgers: [
		{ id: 'led_hdfc', name: 'HDFC', groupId: 'g_bank', active: true },
		{ id: 'led_sbi', name: 'SBI', groupId: 'g_bank_sub', active: true },
		{ id: 'led_old_bank', name: 'Old bank', groupId: 'g_bank', active: false },
		{ id: 'led_cash', name: 'Cash', groupId: 'g_cash', active: true },
	],
};
const ONE_BANK = { ...BANKS, ledgers: BANKS.ledgers.filter((l) => l.id !== 'led_sbi') };
/** Posted for ₹23,600 on 20 November; ₹10,000 of it paid already. */
const POSTED = (over: Partial<ExpenseBill> = {}) =>
	bill({
		status: 'posted',
		number: 'EB/26-27/000003',
		supplierName: 'Kolkata Rentals',
		supplierGstin: '19AAACK1234A1Z5',
		voucherId: 'jv_1',
		paidINR: 10_000,
		paymentVouchers: [{ id: 'pv_0', number: 'PV/26-27/000010' }],
		...over,
	});
const pay = (over: Record<string, unknown> = {}) =>
	({
		amountINR: 13_600,
		paidOn: '2026-11-24',
		mode: 'bank_transfer',
		reference: 'UTR 123',
		paidFromLedgerId: null,
		version: 2,
		...over,
	}) as never;

describe('paying a bill (EB2)', () => {
	it('issues a payment voucher and posts it from the one bank at the bill’s location, all in one transaction', async () => {
		const { service, ledger, numbers, vouchers, bills, log } = build({ stored: POSTED(), chart: ONE_BANK });
		const { bill: paid, voucher } = await service.pay('eb_1', pay(), ca, now);
		expect(numbers.issue).toHaveBeenCalledWith('paymentVoucher', { session: 'tx' }, now);
		expect(voucher.id).toMatch(/^pv_[0-9a-f-]{36}$/);
		expect(ledger.post).toHaveBeenCalledWith(
			{
				date: '2026-11-24',
				narration: 'Payment voucher PV/26-27/000011 · Kolkata Rentals · EB/26-27/000003',
				lines: [
					{ ledger: { role: 'creditors_control' }, debitPaise: 13_600_00, locationId: 'loc_bar' },
					{ ledger: { id: 'led_hdfc' }, creditPaise: 13_600_00, locationId: 'loc_bar' },
				],
				source: { type: 'paymentVoucher', id: voucher.id, number: 'PV/26-27/000011' },
				idempotencyKey: `paymentVoucher:${voucher.id}`,
			},
			{ session: 'tx' },
			'adm_ca',
		);
		expect(voucher).toMatchObject({
			number: 'PV/26-27/000011',
			date: '2026-11-24',
			supplierId: 'sup_wb',
			payeeName: 'Kolkata Rentals',
			payeeAddress: '12 Park Street, Kolkata 700016',
			against: { kind: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000003', detail: 'Shop rent, November' },
			amountINR: 13_600,
			mode: 'bank_transfer',
			reference: 'UTR 123',
			paidFromLedgerId: 'led_hdfc',
			reverseChargeTaxINR: null,
			supplierPaymentId: null,
			journalVoucherId: 'jv_9',
			locationId: 'loc_bar',
			createdAt: at,
			createdBy: 'adm_ca',
			status: 'paid',
		});
		expect(vouchers.insert).toHaveBeenCalledWith(voucher, { session: 'tx' });
		// Paid in full: ₹10,000 before and the ₹13,600 left.
		expect(paid).toMatchObject({
			paidINR: 23_600,
			paymentVouchers: [
				{ id: 'pv_0', number: 'PV/26-27/000010' },
				{ id: voucher.id, number: 'PV/26-27/000011' },
			],
			updatedAt: at,
		});
		expect(bills.save.mock.calls[0]?.slice(1)).toEqual([2, { session: 'tx' }]);
		expect(log.append).toHaveBeenCalledWith('adm_ca', 'paymentVoucher.issue', 'paymentVoucher', voucher.id, [], {
			number: 'PV/26-27/000011',
			against: 'EB/26-27/000003',
		});
	});

	it('pays in cash from the cash role without reading the banks, as no one when no one is signed in', async () => {
		const { service, ledger } = build({ stored: POSTED(), chart: BANKS });
		const { voucher } = await service.pay('eb_1', pay({ mode: 'cash', amountINR: 500 }), undefined, now);
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			lines: [{ ledger: { role: 'creditors_control' } }, { ledger: { role: 'cash' }, creditPaise: 500_00 }],
		});
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
		expect(voucher).toMatchObject({ paidFromLedgerId: null, createdBy: null });
	});

	it('pays from the bank picked among several, and names a bill without its number by the supplier’s', async () => {
		const { service, log } = build({
			stored: POSTED({ number: null, supplierId: 'sup_mh', supplierName: 'Pune Software LLP' }),
			chart: BANKS,
		});
		const { voucher } = await service.pay('eb_1', pay({ paidFromLedgerId: 'led_sbi', amountINR: 1 }), ca, now);
		expect(voucher).toMatchObject({
			paidFromLedgerId: 'led_sbi',
			against: { number: 'KR/1123' },
			// Its address has only the city.
			payeeAddress: 'Pune',
		});
		expect(log.append.mock.calls[0]?.[5]).toEqual({ number: 'PV/26-27/000011', against: 'KR/1123' });
	});

	it('leaves the address blank for a supplier no longer on the books, and pays today when no day is given', async () => {
		const { service } = build({ stored: POSTED({ supplierId: 'sup_gone' }), chart: ONE_BANK });
		const { voucher } = await service.pay('eb_1', pay({ amountINR: 100 }), ca);
		expect(voucher.payeeAddress).toBe('');
	});

	it('needs a bank ledger to pay from, and a pick when there are several', async () => {
		const banks = async (chart: unknown, picked: string | null) =>
			build({ stored: POSTED(), chart }).service.pay('eb_1', pay({ paidFromLedgerId: picked }), ca, now);
		await expect(banks(BANKS, null)).rejects.toMatchObject(refusal('payment_choose_bank_ledger'));
		await expect(banks(BANKS, 'led_old_bank')).rejects.toMatchObject(refusal('payment_needs_a_bank_ledger'));
		await expect(banks(BANKS, 'led_cash')).rejects.toMatchObject(refusal('payment_needs_a_bank_ledger'));
		await expect(
			banks(
				{ ...BANKS, ledgers: BANKS.ledgers.filter((l) => !l.groupId.startsWith('g_bank') || !l.active) },
				null,
			),
		).rejects.toMatchObject(refusal('payment_needs_a_bank_ledger'));
	});

	it('refuses a bill not posted, one changed since, more than is owed, a day ahead, or a day before the bill', async () => {
		const refused = async (stored: ExpenseBill, write: unknown) =>
			build({ stored, chart: ONE_BANK }).service.pay('eb_1', write as never, ca, now);
		await expect(refused(bill(), pay())).rejects.toBeInstanceOf(ConflictException);
		await expect(refused(bill(), pay())).rejects.toMatchObject(refusal('expense_bill_not_posted'));
		await expect(refused(POSTED(), pay({ version: 1 }))).rejects.toBeInstanceOf(ConflictException);
		await expect(refused(POSTED(), pay({ version: 1 }))).rejects.toMatchObject(refusal('expense_bill_changed'));
		await expect(refused(POSTED(), pay({ amountINR: 13_600.01 }))).rejects.toMatchObject(refusal('overpayment'));
		await expect(refused(POSTED(), pay({ paidOn: '2026-11-26' }))).rejects.toMatchObject(refusal('paid_in_future'));
		await expect(refused(POSTED(), pay({ paidOn: '2026-11-19' }))).rejects.toMatchObject(
			refusal('expense_bill_paid_before_bill'),
		);
		// Paid on the bill's own day: allowed.
		expect((await refused(POSTED(), pay({ paidOn: '2026-11-20' }))).voucher.date).toBe('2026-11-20');
	});

	it('lists the payment vouchers that paid a bill', async () => {
		const { service, vouchers } = build();
		expect(await service.paymentVouchers('eb_1')).toEqual(['pv']);
		expect(vouchers.forDocument).toHaveBeenCalledWith('expenseBill', 'eb_1');
	});
});

describe('a paid bill', () => {
	it('can’t be cancelled while anything is paid on it, and a cancelled one keeps when and why', async () => {
		await expect(build({ stored: POSTED() }).service.cancel('eb_1', 'Billed twice', ca, now)).rejects.toMatchObject(
			refusal('expense_bill_paid'),
		);
		// Under half a paisa paid counts as nothing.
		const unpaid = await build({ stored: POSTED({ paidINR: 0.004, paymentVouchers: [] }) }).service.cancel(
			'eb_1',
			'Billed twice',
			ca,
			now,
		);
		expect(unpaid).toMatchObject({ status: 'cancelled', cancelledAt: at, cancelReason: 'Billed twice' });
	});

	it('keeps the supplier’s GSTIN on the bill, or none for an unregistered supplier', async () => {
		const { service } = build();
		expect((await service.create(write(), now)).supplierGstin).toBe('19AAACK1234A1Z5');
		const zero = write({ supplierId: 'sup_none', lines: [{ ...write().lines[0], gstRatePct: 0 } as never] });
		expect((await service.create(zero, now)).supplierGstin).toBeNull();
	});
});

describe('the expense bill routes', () => {
	it('hand each call to the service; reading needs accounts.index, drafts accounts.edit, posting accounts.post', () => {
		const service = new Proxy(
			{},
			{
				get:
					(_target, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new ExpenseBillsController(service as never);
		const body = write();
		expect([
			c.list({ status: 'posted' }),
			c.form(),
			c.get('eb_1'),
			c.create(body),
			c.update('eb_1', { ...body, version: 1 }),
			c.post('eb_1', ca),
			c.post('eb_1'),
			c.paymentVouchers('eb_1'),
			c.pay('eb_1', pay(), ca),
			c.pay('eb_1', pay()),
			c.cancel('eb_1', { reason: 'Billed twice' }, ca),
			c.cancel('eb_1', { reason: 'Billed twice' }),
		]).toEqual([
			['list', { status: 'posted' }],
			['form'],
			['get', 'eb_1'],
			['create', body],
			['update', 'eb_1', { ...body, version: 1 }],
			['post', 'eb_1', ca],
			['post', 'eb_1', undefined],
			['paymentVouchers', 'eb_1'],
			['pay', 'eb_1', pay(), ca],
			['pay', 'eb_1', pay(), undefined],
			['cancel', 'eb_1', 'Billed twice', ca],
			['cancel', 'eb_1', 'Billed twice', undefined],
		]);
		const perm = (m: keyof ExpenseBillsController) =>
			new Reflector().get(PERMISSIONS_KEY, ExpenseBillsController.prototype[m]);
		expect(
			['list', 'form', 'get', 'create', 'update', 'post', 'paymentVouchers', 'pay', 'cancel'].map((m) =>
				perm(m as never),
			),
		).toEqual([
			['accounts.index'],
			['accounts.index'],
			['accounts.index'],
			['accounts.edit'],
			['accounts.edit'],
			['accounts.post'],
			['accounts.index'],
			['purchase.payment'],
			['accounts.post'],
		]);
		expect(Reflect.getMetadata('path', ExpenseBillsController)).toBe('admin/expense-bills');
		expect(
			['form', 'get', 'update', 'post', 'paymentVouchers', 'pay', 'cancel'].map((m) =>
				Reflect.getMetadata('path', ExpenseBillsController.prototype[m as keyof ExpenseBillsController]),
			),
		).toEqual(['form', ':id', ':id', ':id/post', ':id/payment-vouchers', ':id/pay', ':id/cancel']);
		// The form's route is declared before ':id', so "form" is never read as a bill's id.
		const order = Object.getOwnPropertyNames(ExpenseBillsController.prototype);
		expect(order.indexOf('form')).toBeLessThan(order.indexOf('get'));
		expect(Reflect.getMetadata('imports', ExpenseBillsModule)).toEqual([LedgerModule, OrdersSetupModule]);
		expect(Reflect.getMetadata('controllers', ExpenseBillsModule)).toEqual([ExpenseBillsController]);
		expect(Reflect.getMetadata('providers', ExpenseBillsModule)).toEqual([ExpenseBillsService]);
	});
});
