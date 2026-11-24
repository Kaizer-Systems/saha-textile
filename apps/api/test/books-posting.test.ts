import { describe, expect, it, vi } from 'vitest';

import { BooksPostingService } from '../src/ledger/books-posting';

/** Receipts and purchases in the books, inline (Postings and Convert brief P1–P3, AP-D2). */

interface Line {
	ledgerId: string;
	locationId: string;
	debitPaise: number;
	creditPaise: number;
}

const landingNone: Record<string, string | null> = {
	receivedByGateway: null,
	receivedByUpi: null,
	receivedByBank: null,
	cashOnDelivery: null,
	paidByBank: null,
	paidInCash: null,
	updatedAt: null,
	updatedBy: null,
};
const landingSet = { ...landingNone, receivedByBank: 'led_hdfc', paidByBank: 'led_hdfc', receivedByUpi: 'led_hdfc' };

function setup(
	options: {
		landing?: Record<string, string | null>;
		locations?: unknown[];
		invoices?: { id: string; status: string }[];
		vouchers?: Record<string, { lines: Line[] }>;
		advancesLedgers?: unknown[];
		postFails?: Error;
		notSetUp?: boolean;
	} = {},
) {
	const vouchers = new Map(Object.entries(options.vouchers ?? {}));
	const ledger = {
		post: vi.fn(async (request: { idempotencyKey: string; lines: unknown[] }) => {
			if (options.postFails) throw options.postFails;
			return { id: `jv_${request.idempotencyKey}`, number: 'JV/26-27/000013', lines: request.lines };
		}),
		voucherByKey: vi.fn(async (key: string) => vouchers.get(key) ?? null),
		chart: vi.fn(async () => ({
			ledgers: options.advancesLedgers ?? [{ id: 'led_adv', systemKey: 'customer_advances', active: true }],
		})),
	};
	const service = new BooksPostingService(
		ledger as never,
		{ get: async () => options.landing ?? landingSet } as never,
		{
			list: async () =>
				options.locations ?? [
					{ id: 'loc_wh', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-01-01' },
				],
		} as never,
		{ listForOrder: async () => options.invoices ?? [] } as never,
		{ listByOrder: async () => [{ id: 'pay_1' }, { id: 'pay_2' }] } as never,
		{ listForOrder: async () => [{ id: 'rf_1' }] } as never,
		{ booksSetUp: async () => !options.notSetUp } as never,
	);
	const posted = () => ledger.post.mock.calls.map(([request]) => request);
	return { service, ledger, posted };
}

const ctx = {} as never;
const entry = {
	id: 'pe_1',
	number: 'PE/26-27/000004',
	supplierName: 'Bose Textiles',
	billNumber: 'B-77',
	itcClaimable: true,
	postedAt: '2026-11-24T05:00:00.000Z',
	voidedAt: '2026-11-25T05:00:00.000Z',
	totals: { taxableINR: 1_000, cgstINR: 25, sgstINR: 25, igstINR: 0, totalINR: 1_050 },
} as never;

describe('before the books are set up', () => {
	it('saves documents without posting: Post them catches them up later', async () => {
		const { service, ledger } = setup({ notSetUp: true, landing: landingNone, locations: [] });
		const order = { id: 'ord_1', orderNumber: 'ST-1', shipsFromLocationId: null };
		const results = await Promise.all([
			service.purchaseEntryPosted(entry, ctx, null),
			service.purchaseEntryVoided(entry, ctx, null),
			service.supplierPaid({ id: 'p', mode: 'upi' } as never, entry, ctx, null),
			service.supplierPaymentReversed({ id: 'p' } as never, ctx, null),
			service.purchaseReturnSent({ id: 'r' } as never, true, ctx, null),
			service.purchaseReturnSettled({ id: 'r' } as never, { how: 'refund' } as never, ctx, null),
			service.paymentReceived({ id: 'p', state: 'received', method: 'bankTransfer' } as never, order, ctx, null),
			service.paymentUndone({ id: 'p' } as never, '2026-11-24', ctx, null),
			service.businessReceipt(
				{ id: 'r', number: null, businessName: 'B' },
				{ method: 'upi', amountINR: 1, receivedOn: '2026-11-24' },
				ctx,
				null,
			),
		]);
		expect(results.every((result) => result === null)).toBe(true);
		expect(ledger.post).not.toHaveBeenCalled();
	});
});

describe('purchases in the books', () => {
	it('posts a purchase entry as stock and input tax against the supplier, on the day it was posted', async () => {
		const { service, posted } = setup();
		await service.purchaseEntryPosted(entry, ctx, 'adm_1');
		expect(posted()[0]).toMatchObject({
			date: '2026-11-24',
			idempotencyKey: 'purchaseEntry:pe_1',
			source: { type: 'purchaseEntry', id: 'pe_1', number: 'PE/26-27/000004' },
			lines: [
				{ ledger: { role: 'stock_in_hand' }, debitPaise: 100_000, locationId: 'loc_wh' },
				{ ledger: { role: 'input_cgst' }, debitPaise: 2_500, locationId: 'loc_wh' },
				{ ledger: { role: 'input_sgst' }, debitPaise: 2_500, locationId: 'loc_wh' },
				{ ledger: { role: 'creditors_control' }, creditPaise: 105_000, locationId: 'loc_wh' },
			],
		});
		const blocked = setup();
		await blocked.service.purchaseEntryPosted(
			{ ...(entry as object), itcClaimable: false, postedAt: null } as never,
			ctx,
			null,
		);
		expect(blocked.posted()[0]?.lines[0]).toMatchObject({ ledger: { role: 'stock_in_hand' }, debitPaise: 105_000 });
	});

	it('refuses in words when the books have no stock location', async () => {
		const { service } = setup({ locations: [] });
		await expect(service.purchaseEntryPosted(entry, ctx, null)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'books_need_a_location' })] },
		});
	});

	it('reverses what an entry posted when it is voided, and nothing when it never posted', async () => {
		const original = {
			lines: [
				{ ledgerId: 'led_stock', locationId: 'loc_wh', debitPaise: 100_000, creditPaise: 0 },
				{ ledgerId: 'led_cred', locationId: 'loc_wh', debitPaise: 0, creditPaise: 100_000 },
			],
		};
		const { service, posted } = setup({ vouchers: { 'purchaseEntry:pe_1': original } });
		await service.purchaseEntryVoided(entry, ctx, 'adm_1');
		expect(posted()[0]).toMatchObject({
			date: '2026-11-25',
			idempotencyKey: 'purchaseEntry:pe_1:void',
			lines: [
				{ ledger: { id: 'led_stock' }, locationId: 'loc_wh', debitPaise: 0, creditPaise: 100_000 },
				{ ledger: { id: 'led_cred' }, locationId: 'loc_wh', debitPaise: 100_000, creditPaise: 0 },
			],
		});
		const never = setup();
		expect(
			await never.service.purchaseEntryVoided({ ...(entry as object), voidedAt: null } as never, ctx, null),
		).toBeNull();
		expect(never.ledger.post).not.toHaveBeenCalled();
	});

	it('pays a supplier from the bank or cash set, refuses a bank payment with no bank set, and reverses a payment', async () => {
		const payment = {
			id: 'pay_9',
			amountINR: 500,
			mode: 'upi',
			paidOn: '2026-11-24',
			reversedAt: '2026-11-26T05:00:00.000Z',
		} as never;
		const { service, posted } = setup();
		await service.supplierPaid(payment, entry, ctx, 'adm_1');
		expect(posted()[0]).toMatchObject({
			date: '2026-11-24',
			idempotencyKey: 'supplierPayment:pay_9',
			lines: [
				{ ledger: { role: 'creditors_control' }, debitPaise: 50_000 },
				{ ledger: { id: 'led_hdfc' }, creditPaise: 50_000 },
			],
		});
		const cash = setup({ landing: landingNone });
		await cash.service.supplierPaid({ ...(payment as object), mode: 'cash' } as never, entry, ctx, null);
		expect(cash.posted()[0]?.lines[1]).toMatchObject({ ledger: { role: 'cash' } });
		await expect(cash.service.supplierPaid(payment, entry, ctx, null)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'money_lands_not_set:paid_by_bank' })] },
		});
		const reversing = setup({
			vouchers: {
				'supplierPayment:pay_9': {
					lines: [{ ledgerId: 'led_cred', locationId: 'loc_wh', debitPaise: 50_000, creditPaise: 0 }],
				},
			},
		});
		await reversing.service.supplierPaymentReversed(payment, ctx, null);
		expect(reversing.posted()[0]).toMatchObject({
			date: '2026-11-26',
			idempotencyKey: 'supplierPayment:pay_9:reversed',
		});
		expect(
			await setup().service.supplierPaymentReversed(
				{ ...(payment as object), reversedAt: null } as never,
				ctx,
				null,
			),
		).toBeNull();
	});

	it('posts a debit note on sending, and only a refund among its settlements', async () => {
		const doc = {
			id: 'prt_1',
			number: 'DN/26-27/000002',
			supplierName: 'Bose Textiles',
			taxableINR: 200,
			cgstINR: 5,
			sgstINR: 5,
			igstINR: 0,
			totalINR: 210,
			sentAt: '2026-11-24T06:00:00.000Z',
		} as never;
		const { service, posted } = setup();
		await service.purchaseReturnSent(doc, true, ctx, 'adm_1');
		expect(posted()[0]).toMatchObject({
			idempotencyKey: 'purchaseReturn:prt_1',
			lines: [
				{ ledger: { role: 'stock_in_hand' }, creditPaise: 20_000 },
				{ ledger: { role: 'input_cgst' }, creditPaise: 500 },
				{ ledger: { role: 'input_sgst' }, creditPaise: 500 },
				{ ledger: { role: 'creditors_control' }, debitPaise: 21_000 },
			],
		});
		await service.purchaseReturnSent({ ...(doc as object), sentAt: null } as never, false, ctx, null);
		expect(posted()[1]?.lines[0]).toMatchObject({ ledger: { role: 'stock_in_hand' }, creditPaise: 21_000 });
		const settlement = { id: 'prs_1', how: 'refund', amountINR: 210, date: '2026-11-28' } as never;
		await service.purchaseReturnSettled(doc, settlement, ctx, null);
		expect(posted()[2]).toMatchObject({
			date: '2026-11-28',
			idempotencyKey: 'purchaseReturn:prt_1:refund:prs_1',
			lines: [
				{ ledger: { id: 'led_hdfc' }, debitPaise: 21_000 },
				{ ledger: { role: 'creditors_control' }, creditPaise: 21_000 },
			],
		});
		expect(
			await service.purchaseReturnSettled(
				doc,
				{ ...(settlement as object), how: 'credit_note' } as never,
				ctx,
				null,
			),
		).toBeNull();
		expect(posted()).toHaveLength(3);
	});
});

describe('receipts in the books', () => {
	const order = { id: 'ord_1', orderNumber: 'ST-2611-482190', shipsFromLocationId: 'loc_shop' };
	const payment = {
		id: 'pay_1',
		method: 'bankTransfer',
		state: 'received',
		amountINR: 4_680,
		receivedOn: '2026-11-24',
		recordedAt: '2026-11-24T05:00:00.000Z',
		recordedBy: 'adm_1',
		receiptNumber: 'RC/26-27/000010',
	};

	it('posts money received before the invoice to the advance, and after it to the customer’s debt', async () => {
		const { service, posted } = setup();
		await service.paymentReceived(payment as never, order, ctx, 'adm_1');
		expect(posted()[0]).toMatchObject({
			date: '2026-11-24',
			idempotencyKey: 'receipt:pay_1',
			source: { type: 'orderPayment', id: 'pay_1', number: 'RC/26-27/000010' },
			lines: [
				{ ledger: { id: 'led_hdfc' }, debitPaise: 468_000, locationId: 'loc_shop' },
				{ ledger: { role: 'customer_advances' }, creditPaise: 468_000, locationId: 'loc_shop' },
			],
		});
		const invoiced = setup({
			invoices: [
				{ id: 'ti_0', status: 'cancelled' },
				{ id: 'ti_1', status: 'issued' },
			],
		});
		await invoiced.service.paymentReceived(
			{ ...payment, receivedOn: null, receiptNumber: null } as never,
			{ ...order, shipsFromLocationId: undefined },
			ctx,
			null,
		);
		expect(invoiced.posted()[0]).toMatchObject({
			date: '2026-11-24',
			source: { number: 'ST-2611-482190' },
			lines: [{ locationId: 'loc_wh' }, { ledger: { role: 'debtors_control' } }],
		});
	});

	it('after the invoice, fills first what the invoice took from an advance never received', async () => {
		const { service, posted } = setup({
			invoices: [{ id: 'ti_1', status: 'issued' }],
			vouchers: {
				'taxInvoice:ti_1': {
					lines: [{ ledgerId: 'led_adv', locationId: 'loc_shop', debitPaise: 300_000, creditPaise: 0 }],
				},
			},
		});
		await service.paymentReceived(payment as never, order, ctx, null);
		expect(posted()[0]?.lines.slice(1)).toMatchObject([
			{ ledger: { role: 'customer_advances' }, creditPaise: 300_000 },
			{ ledger: { role: 'debtors_control' }, creditPaise: 168_000 },
		]);
	});

	it('gives "Post them" the failure of a payment the customer made, to list it', async () => {
		const gateway = { ...payment, method: 'gateway', recordedBy: null };
		await expect(
			setup({ postFails: new Error('voucher_problem:period_locked') }).service.paymentReceived(
				gateway as never,
				order,
				ctx,
				null,
				{ keepCustomerPayment: false },
			),
		).rejects.toThrow('period_locked');
	});

	it('posts a counter payment to the ledger it landed in, whatever its method (accounts brief P2)', async () => {
		const { service, posted } = setup();
		await service.paymentReceived({ ...payment, method: 'cash', ledgerId: 'led_till' } as never, order, ctx, null);
		expect(posted()[0]?.lines[0]).toMatchObject({ ledger: { id: 'led_till' } });
	});

	it('posts nothing for a payment not received or one that moves no money', async () => {
		const { service, ledger } = setup();
		expect(await service.paymentReceived({ ...payment, state: 'pending' } as never, order, ctx, null)).toBeNull();
		expect(
			await service.paymentReceived({ ...payment, method: 'onAccount' } as never, order, ctx, null),
		).toBeNull();
		expect(ledger.post).not.toHaveBeenCalled();
	});

	it('refuses a staff step in words, but keeps a gateway payment the customer already made (AP-D2)', async () => {
		const staff = setup({ landing: landingNone });
		await expect(staff.service.paymentReceived(payment as never, order, ctx, null)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'money_lands_not_set:received_by_bank' })] },
		});
		const shop = setup({ postFails: new Error('voucher_problem:month_locked') });
		const gateway = { ...payment, method: 'gateway', recordedBy: null };
		expect(await shop.service.paymentReceived(gateway as never, order, ctx, null)).toBeNull();
		const link = setup({ postFails: new Error('voucher_problem:month_locked') });
		expect(
			await link.service.paymentReceived({ ...gateway, recordedBy: 'adm_1' } as never, order, ctx, null),
		).toBeNull();
	});

	it('reverses a received payment that is undone, and nothing for one never posted', async () => {
		const { service, posted } = setup({
			vouchers: {
				'receipt:pay_1': {
					lines: [{ ledgerId: 'led_hdfc', locationId: 'loc_shop', debitPaise: 468_000, creditPaise: 0 }],
				},
			},
		});
		await service.paymentUndone(payment as never, '2026-11-25', ctx, null);
		expect(posted()[0]).toMatchObject({ date: '2026-11-25', idempotencyKey: 'receipt:pay_1:void' });
		expect(
			await setup().service.paymentUndone({ ...payment, receivedOn: null } as never, '2026-11-25', ctx, null),
		).toBeNull();
	});

	it('posts a business receipt against what the business owes, from cash, UPI or the bank', async () => {
		const { service, posted } = setup({ landing: { ...landingNone, receivedByBank: 'led_hdfc' } });
		const receipt = { id: 'rcpt_1', number: 'RC/26-27/000011', businessName: 'Ganguly Stores' };
		for (const method of ['cash', 'upi', 'bankTransfer', 'cheque'] as const)
			await service.businessReceipt(receipt, { method, amountINR: 100, receivedOn: '2026-11-24' }, ctx, null);
		expect(posted().map((request) => request.lines[0])).toMatchObject([
			{ ledger: { role: 'cash' } },
			{ ledger: { role: 'upi_card_clearing' } },
			{ ledger: { id: 'led_hdfc' } },
			{ ledger: { id: 'led_hdfc' } },
		]);
		expect(posted()[0]).toMatchObject({
			idempotencyKey: 'businessReceipt:rcpt_1',
			lines: [{}, { ledger: { role: 'debtors_control' }, creditPaise: 10_000 }],
		});
	});

	it('works out the advance an order still holds from its receipts, invoices and refunds', async () => {
		const line = (ledgerId: string, debitPaise: number, creditPaise: number) => ({
			ledgerId,
			locationId: 'loc_shop',
			debitPaise,
			creditPaise,
		});
		const { service } = setup({
			invoices: [{ id: 'ti_1', status: 'issued' }],
			vouchers: {
				'receipt:pay_1': { lines: [line('led_hdfc', 300_000, 0), line('led_adv', 0, 300_000)] },
				'receipt:pay_2': { lines: [line('led_adv', 0, 200_000)] },
				'receipt:pay_2:void': { lines: [line('led_adv', 50_000, 0)] },
				'taxInvoice:ti_1': { lines: [line('led_adv', 100_000, 0)] },
				'refundVoucher:rf_1': { lines: [line('led_adv', 25_000, 0)] },
			},
		});
		expect(await service.advanceHeldINR('ord_1')).toBe(3_250);
		const spent = setup({
			vouchers: { 'taxInvoice:ti_1': { lines: [line('led_adv', 100, 0)] } },
			invoices: [{ id: 'ti_1', status: 'issued' }],
		});
		expect(await spent.service.advanceHeldINR('ord_1')).toBe(0);
		expect(await setup({ advancesLedgers: [] }).service.advanceHeldINR('ord_1')).toBe(0);
	});
});

describe('stock adjustments in the books (D5)', () => {
	const adjustment = {
		id: 'sa_1',
		number: 'SA/26-27/0004',
		action: 'remove' as const,
		outcome: 'writtenOff' as const,
		reasonCode: 'damage' as const,
		valueINR: 620,
		ratePercent: 5,
		at: '2026-11-22T06:00:00.000Z',
	};

	it('posts a write-off and its input tax reversal in one journal voucher (E1: ₹620 at 5%)', async () => {
		const { service, posted } = setup();
		expect(await service.stockAdjusted(adjustment, ctx, 'adm_owner')).toEqual({
			journalNumber: 'JV/26-27/000013',
			itcINR: 31,
		});
		expect(posted()[0]).toMatchObject({
			date: '2026-11-22',
			idempotencyKey: 'stockAdjustment:sa_1',
			narration: 'Stock adjustment SA/26-27/0004; input tax reversed, s.17(5)(h)',
			source: { type: 'stockAdjustment', id: 'sa_1', number: 'SA/26-27/0004' },
			lines: [
				{ ledger: { role: 'stock_loss' }, debitPaise: 62_000, locationId: 'loc_wh' },
				{ ledger: { role: 'stock_in_hand' }, creditPaise: 62_000, locationId: 'loc_wh' },
				{ ledger: { role: 'stock_loss' }, debitPaise: 3_100, locationId: 'loc_wh' },
				{ ledger: { role: 'input_cgst' }, creditPaise: 1_550, locationId: 'loc_wh' },
				{ ledger: { role: 'input_sgst' }, creditPaise: 1_550, locationId: 'loc_wh' },
			],
		});
	});

	it('posts an addition back into stock without tax, and nothing for no value or before the books are set up', async () => {
		const { service, posted } = setup();
		const added = await service.stockAdjusted(
			{ ...adjustment, action: 'add', outcome: null, reasonCode: 'manual_recount_correction', valueINR: 310 },
			ctx,
			null,
		);
		expect(added).toEqual({ journalNumber: 'JV/26-27/000013', itcINR: null });
		expect(posted()[0]).toMatchObject({ narration: 'Stock adjustment SA/26-27/0004' });
		expect(
			await service.stockAdjusted({ ...adjustment, reasonCode: 'supplier_shortage', valueINR: 0 }, ctx, null),
		).toEqual({ journalNumber: null, itcINR: null });
		const early = setup({ notSetUp: true });
		expect(await early.service.stockAdjusted(adjustment, ctx, null)).toEqual({ journalNumber: null, itcINR: null });
		expect(await early.service.willPost()).toBe(false);
		expect(await service.willPost()).toBe(true);
		expect(early.ledger.post).not.toHaveBeenCalled();
	});

	it('reverses a posted adjustment once, and nothing when it never posted', async () => {
		const original = {
			lines: [{ ledgerId: 'led_loss', locationId: 'loc_wh', debitPaise: 62_000, creditPaise: 0 }],
		};
		const { service, posted } = setup({ vouchers: { 'stockAdjustment:sa_1': original as never } });
		const reversal = {
			id: 'sa_1',
			number: 'SA/26-27/0004',
			reversalId: 'sa_2',
			reversalNumber: 'SA/26-27/0005',
			at: adjustment.at,
		};
		expect(await service.stockAdjustmentReversed(reversal, ctx, 'adm_owner')).toBe('JV/26-27/000013');
		expect(posted()[0]).toMatchObject({
			idempotencyKey: 'stockAdjustment:sa_1:reversed',
			narration: 'Reversal of stock adjustment SA/26-27/0004 by SA/26-27/0005',
			source: { type: 'stockAdjustment', id: 'sa_2', number: 'SA/26-27/0005' },
			lines: [{ ledger: { id: 'led_loss' }, debitPaise: 0, creditPaise: 62_000 }],
		});
		expect(await setup().service.stockAdjustmentReversed(reversal, ctx, null)).toBeNull();
	});
});
