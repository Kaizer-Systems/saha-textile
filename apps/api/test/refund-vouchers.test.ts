import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RefundVoucher } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { refundVoucherData } from '../src/documents/refund-voucher-print';
import { CancelAndRefundController, RefundVouchersController } from '../src/returns/refund-vouchers.controller';
import { RefundVouchersService } from '../src/returns/refund-vouchers.service';

/** Refund vouchers (accounts brief C1, C2, Rule 51) with in-memory stores. */

const NOW = new Date('2026-11-22T08:35:00.000Z');
const payment = (patch: Record<string, unknown> = {}) => ({
	id: 'pay_1',
	orderId: 'ord_1',
	method: 'gateway',
	state: 'received',
	amountINR: 2_600,
	currency: 'INR',
	amount: 2_600,
	reference: 'R2611688796',
	gateway: { id: 'ccavenue', attemptId: 'att_1', reference: '113000123', requestId: null },
	receivedOn: '2026-11-22',
	receiptNumber: 'RC/26-27/000013',
	...patch,
});

interface Options {
	payments?: ReturnType<typeof payment>[];
	invoices?: { status: string }[];
	answer?: 'accepted' | 'duplicate' | 'refused' | 'throw';
	noGateways?: boolean;
	shipsFrom?: string | null;
	locations?: unknown[];
	noBuyer?: boolean;
	noOrder?: boolean;
	staleSave?: boolean;
}

function setup(options: Options = {}) {
	const payments = options.payments ?? [payment()];
	const vouchers: RefundVoucher[] = [];
	const saved: { id: string; state: string }[] = [];
	const posted: { lines: { ledger: unknown; debitPaise?: number; creditPaise?: number }[] }[] = [];
	const logged: { action: string; actor: string | null }[] = [];
	const changed: unknown[] = [];
	const asked: unknown[] = [];
	let n = 0;
	const order = {
		id: 'ord_1',
		orderNumber: 'ST-2611-688796',
		shipsFromLocationId: options.shipsFrom === undefined ? 'loc_bar' : options.shipsFrom,
		...(options.noBuyer ? {} : { buyer: { name: 'Priya Sharma' } }),
	};
	const port = {
		gateway: 'ccavenue',
		refundPayment: async (input: unknown) => {
			asked.push(input);
			if (options.answer === 'throw') throw new Error('timeout');
			return {
				outcome: options.answer ?? 'accepted',
				refundReference: 'x',
				refusalReason: options.answer === 'refused' ? 'E31' : null,
			};
		},
	};
	const service = new RefundVouchersService(
		{ changeStatus: async (...args: unknown[]) => void changed.push(args) } as never,
		{ findById: async (id: string) => (options.noOrder || id !== 'ord_1' ? null : order) } as never,
		{
			listByOrder: async () => payments,
			findById: async (id: string) => payments.find((p) => p.id === id) ?? null,
			save: async (p: { id: string; state: string }) => (saved.push(p), p),
		} as never,
		{ listForOrder: async () => options.invoices ?? [] } as never,
		{
			insert: async (v: RefundVoucher) => void vouchers.push(v),
			get: async (id: string) => vouchers.find((v) => v.id === id) ?? null,
			listForOrder: async () => [...vouchers],
			list: async () => ({ items: vouchers, total: vouchers.length }),
			save: async (v: RefundVoucher, expected: string) => {
				const i = vouchers.findIndex((x) => x.id === v.id);
				if (options.staleSave || vouchers[i]?.updatedAt !== expected) throw new Error('refund_voucher_changed');
				vouchers[i] = v;
			},
		} as never,
		{ list: async () => options.locations ?? [] } as never,
		(options.noGateways ? { inr: null, paypal: null } : { inr: port, paypal: null }) as never,
		{ withTransaction: async <T>(work: (context: never) => Promise<T>) => work({} as never) } as never,
		{ issue: async () => `RF/26-27/00000${++n}` } as never,
		{
			post: async (request: (typeof posted)[number]) => (posted.push(request), { id: `jv_${posted.length}` }),
			chart: async () => ({
				ledgers: [
					{ id: 'led_hdfc', groupId: 'g_bank' },
					{ id: 'led_rent', groupId: 'g_exp' },
				],
				groups: [
					{ id: 'g_bank', systemKey: 'bank_accounts', parentId: null },
					{ id: 'g_exp', systemKey: 'indirect_expenses', parentId: null },
				],
			}),
		} as never,
		{ append: async (actor: string | null, action: string) => void logged.push({ action, actor }) } as never,
	);
	return { service, vouchers, saved, posted, logged, changed, asked };
}

const cancel = { reason: 'customerAsked' as const, note: null };
const write = (refund: Record<string, unknown> = { how: 'gateway' }) =>
	({ comment: null, cancel, revision: 4, refund }) as never;
const actor = { id: 'adm_1', name: null };

describe('cancel a paid order and refund it (C1)', () => {
	it('cancels through the order’s own step, refunds through the gateway once and issues the voucher', async () => {
		const made = setup();
		const [voucher] = await made.service.cancelAndRefund('ord_1', write(), actor, NOW);
		expect(made.changed[0]).toEqual([
			'ord_1',
			{ to: 'cancelled', comment: null, shipped: null, delivered: null, cancel, lineIds: [], revision: 4 },
			actor,
			NOW,
		]);
		expect(made.asked[0]).toEqual({
			gatewayReference: '113000123',
			refundReference: 'RFpay1',
			amountMinor: 260_000,
			currency: 'INR',
		});
		expect(voucher).toMatchObject({
			number: 'RF/26-27/000001',
			date: '2026-11-22',
			payee: 'Priya Sharma',
			receiptNumber: 'RC/26-27/000013',
			how: 'gateway',
			status: 'refunded',
			reason: 'order_cancelled',
			locationId: 'loc_bar',
			voucherId: 'jv_1',
		});
		expect(made.saved).toEqual([expect.objectContaining({ id: 'pay_1', state: 'refunded' })]);
		expect(made.posted[0]?.lines).toEqual([
			{ ledger: { role: 'customer_advances' }, debitPaise: 260_000, locationId: 'loc_bar' },
			{ ledger: { role: 'gateway_clearing' }, creditPaise: 260_000, locationId: 'loc_bar' },
		]);
		expect(made.logged.map((l) => [l.action, l.actor])).toEqual([
			['refundVoucher.issue', 'adm_1'],
			['refundVoucher.outcome', null],
		]);
	});

	it('pays by bank transfer from a cash or bank ledger, and refuses any other ledger', async () => {
		const made = setup({
			payments: [payment({ method: 'upi', gateway: null })],
			noBuyer: true,
			shipsFrom: null,
			locations: [{ id: 'loc_wh', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-01-01' }],
		});
		const [voucher] = await made.service.cancelAndRefund(
			'ord_1',
			write({ how: 'bank_transfer', ledgerId: 'led_hdfc', reference: 'NEFT0001' }),
			actor,
			NOW,
		);
		expect(voucher).toMatchObject({
			how: 'bank_transfer',
			reference: 'NEFT0001',
			ledgerId: 'led_hdfc',
			status: 'refunded',
			payee: 'ST-2611-688796',
			locationId: 'loc_wh',
		});
		expect(made.posted[0]?.lines[1]).toMatchObject({ ledger: { id: 'led_hdfc' } });
		expect(made.asked).toEqual([]);
		for (const ledgerId of ['led_rent', 'led_x'])
			await expect(
				setup().service.cancelAndRefund(
					'ord_1',
					write({ how: 'bank_transfer', ledgerId, reference: 'NEFT0001' }),
					actor,
					NOW,
				),
			).rejects.toThrow('refund_needs_cash_or_bank');
	});

	it('refuses an unknown order, one already invoiced, one with nothing to give back, and the gateway for money that didn’t come by it', async () => {
		await expect(
			setup({ noOrder: true }).service.cancelAndRefund('ord_1', write(), actor, NOW),
		).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			setup({ invoices: [{ status: 'cancelled' }, { status: 'issued' }] }).service.cancelAndRefund(
				'ord_1',
				write(),
				actor,
				NOW,
			),
		).rejects.toThrow('refund_after_invoice_needs_credit_note');
		await expect(
			setup({ payments: [payment({ state: 'refunded' })] }).service.cancelAndRefund('ord_1', write(), actor, NOW),
		).rejects.toThrow('nothing_to_refund');
		for (const other of [
			payment({ method: 'upi' }),
			payment({ gateway: { id: 'ccavenue', attemptId: 'a', reference: null } }),
		])
			await expect(
				setup({ payments: [other] }).service.cancelAndRefund('ord_1', write(), actor, NOW),
			).rejects.toBeInstanceOf(BadRequestException);
		await expect(setup({ shipsFrom: null }).service.cancelAndRefund('ord_1', write(), actor, NOW)).rejects.toThrow(
			'refund_needs_a_location',
		);
	});

	it('keeps a refused refund as Failed and an unanswered one as Waiting, moving nothing in the books', async () => {
		for (const [answer, status] of [
			['refused', 'failed'],
			['throw', 'waiting_for_gateway'],
			['duplicate', 'refunded'],
		] as const) {
			const made = setup({ answer });
			const [voucher] = await made.service.cancelAndRefund('ord_1', write(), actor, NOW);
			expect(voucher?.status).toBe(status);
			expect(made.posted).toHaveLength(status === 'refunded' ? 1 : 0);
		}
		const none = setup({ noGateways: true });
		expect((await none.service.cancelAndRefund('ord_1', write(), actor, NOW))[0]?.status).toBe(
			'waiting_for_gateway',
		);
		expect(
			(await setup({ answer: 'refused' }).service.cancelAndRefund('ord_1', write(), actor, NOW))[0]?.refusal,
		).toBe('E31');
	});
});

describe('a refund voucher afterwards (C2)', () => {
	it('tries a refused refund again with the same reference, and records what the gateway says', async () => {
		const made = setup({ answer: 'refused' });
		const [failed] = await made.service.cancelAndRefund('ord_1', write(), actor, NOW);
		const again = await made.service.retry(failed!.id, 'adm_1', new Date('2026-11-23T05:00:00.000Z'));
		expect([again.status, made.asked.length]).toEqual(['failed', 2]);
		expect((made.asked[1] as { refundReference: string }).refundReference).toBe('RFpay1');
		const ok = setup({ answer: 'throw' });
		const [waiting] = await ok.service.cancelAndRefund('ord_1', write(), actor, NOW);
		const port = setup();
		port.vouchers.push(waiting!);
		const done = await port.service.retry(waiting!.id, null, new Date('2026-11-23T05:00:00.000Z'));
		expect(done).toMatchObject({ status: 'refunded', date: '2026-11-23', voucherId: 'jv_1' });
		expect(port.logged.at(-1)).toEqual({ action: 'refundVoucher.retry', actor: null });
		await expect(port.service.retry(waiting!.id, null)).rejects.toThrow('refund_voucher_already_refunded');
	});

	it('pays a refused refund by bank transfer instead, and refuses a bank-transfer voucher a gateway retry', async () => {
		const made = setup({ answer: 'refused' });
		const [failed] = await made.service.cancelAndRefund('ord_1', write(), actor, NOW);
		await expect(
			made.service.byHand(failed!.id, { ledgerId: 'led_rent', reference: 'NEFT0001' }, 'adm_1'),
		).rejects.toThrow('refund_needs_cash_or_bank');
		const paid = await made.service.byHand(
			failed!.id,
			{ ledgerId: 'led_hdfc', reference: 'NEFT0001' },
			'adm_1',
			NOW,
		);
		expect(paid).toMatchObject({ how: 'bank_transfer', status: 'refunded', ledgerId: 'led_hdfc', refusal: null });
		expect(made.posted[0]?.lines[1]).toMatchObject({ ledger: { id: 'led_hdfc' } });
		const byBank = setup({ answer: 'refused' });
		const [stored] = await byBank.service.cancelAndRefund('ord_1', write(), actor, NOW);
		byBank.vouchers[0] = { ...stored!, how: 'bank_transfer', status: 'failed', receiptNumber: null };
		await expect(byBank.service.retry(stored!.id, null)).rejects.toThrow('refund_voucher_not_by_gateway');
		expect(
			(await byBank.service.byHand(stored!.id, { ledgerId: 'led_hdfc', reference: 'NEFT0002' }, null, NOW))
				.status,
		).toBe('refunded');
	});

	it('says when the voucher, its payment or the copy read is gone, and asks no gateway for a payment without one', async () => {
		const made = setup({ answer: 'refused' });
		await expect(made.service.get('rf_x')).rejects.toBeInstanceOf(NotFoundException);
		await expect(made.service.retry('rf_x', null)).rejects.toBeInstanceOf(NotFoundException);
		const [failed] = await made.service.cancelAndRefund('ord_1', write(), actor, NOW);
		expect(await made.service.listForOrder('ord_1')).toHaveLength(1);
		made.vouchers[0] = { ...failed!, paymentId: 'pay_gone' };
		await expect(made.service.retry(failed!.id, null)).rejects.toThrow('payment_not_found');
		const lost = setup({ payments: [payment({ gateway: null })] });
		lost.vouchers.push({ ...failed! });
		expect((await lost.service.retry(failed!.id, null, NOW)).status).toBe('waiting_for_gateway');
		const raced = setup({ staleSave: true });
		raced.vouchers.push({ ...failed! });
		await expect(raced.service.retry(failed!.id, null, NOW)).rejects.toBeInstanceOf(ConflictException);
		await made.service.printed(failed!.id, 'adm_1');
		expect(made.logged.at(-1)?.action).toBe('refundVoucher.print');
	});
});

describe('refund voucher routes and print', () => {
	const voucher = RefundVoucher.parse({
		id: 'rf_1',
		number: 'RF/26-27/000003',
		date: '2026-11-22',
		orderId: 'ord_1',
		orderNumber: 'ST-2611-688796',
		paymentId: 'pay_1',
		receiptNumber: 'RC/26-27/000013',
		receiptDate: '2026-11-22',
		payee: 'Priya Sharma',
		amountINR: 2_600,
		currency: 'INR',
		amount: 2_600,
		how: 'gateway',
		reference: 'RFpay1',
		reason: 'order_cancelled',
		status: 'refunded',
		locationId: 'loc_bar',
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
	});

	it('prints the receipt it gives back, how, to whom and why, with no GST on an advance', () => {
		const data = refundVoucherData(voucher, { name: 'K.R. Marketing', lines: [] });
		expect(data.values).toMatchObject({
			voucherNo: 'RF/26-27/000003',
			receiptNo: 'RC/26-27/000013',
			amount: '₹2,600.00',
			method: 'Gateway refund',
			reason: 'Order cancelled before dispatch',
			taxReversed: 'None: an advance for goods carries no GST',
		});
		expect(data.parties?.['payee']?.lines).toEqual(['Priya Sharma']);
		const byHand = refundVoucherData(
			{ ...voucher, how: 'bank_transfer', receiptNumber: null, reason: 'paid_after_cancel' },
			{ name: 'K', lines: [] },
		);
		expect([byHand.values['method'], byHand.values['receiptNo']]).toEqual(['Bank transfer', '—']);
	});

	it('passes each route to the service with who is acting, prints and logs the print', async () => {
		const calls: unknown[][] = [];
		const service = new Proxy(
			{ get: async () => voucher },
			{
				get: (target, name) =>
					(target as Record<string | symbol, unknown>)[name] ??
					((...args: unknown[]) => (calls.push([name, ...args]), Promise.resolve(name))),
			},
		);
		const rendered: string[] = [];
		const formats = {
			seller: async () => ({ name: 'K', lines: [] }),
			renderActive: async (doc: string) => (rendered.push(doc), new Uint8Array([37])),
		};
		const editLog = { entries: async (type: string, id: string) => [type, id] };
		const routes = new RefundVouchersController(service as never, formats as never, editLog as never);
		const cancel = new CancelAndRefundController(service as never);
		const principal = { userId: 'adm_1' } as never;
		await cancel.cancelAndRefund('ord_1', write(), principal);
		await cancel.cancelAndRefund('ord_1', write());
		expect(await routes.get('rf_1')).toBe(voucher);
		expect(await routes.log('rf_1')).toEqual(['refundVoucher', 'rf_1']);
		const headers: Record<string, string> = {};
		const reply = {
			header(name: string, value: string) {
				headers[name] = value;
				return this;
			},
			send: () => undefined,
		};
		await routes.pdf('rf_1', reply as never, principal);
		await routes.pdf('rf_1', reply as never);
		expect(headers['Content-Disposition']).toBe('inline; filename="RF-26-27-000003.pdf"');
		await routes.retry('rf_1', principal);
		await routes.retry('rf_1');
		await routes.byHand('rf_1', { ledgerId: 'led_hdfc', reference: 'NEFT0001' }, principal);
		await routes.byHand('rf_1', { ledgerId: 'led_hdfc', reference: 'NEFT0001' });
		expect(calls.map((c) => [c[0], c.at(-1)])).toEqual([
			['cancelAndRefund', { id: 'adm_1', name: null }],
			['cancelAndRefund', { id: null, name: null }],
			['printed', 'adm_1'],
			['printed', null],
			['retry', 'adm_1'],
			['retry', null],
			['byHand', 'adm_1'],
			['byHand', null],
		]);
		expect(rendered).toEqual(['refundVoucher', 'refundVoucher']);
	});
});

describe('the shop’s own refunds (OD1)', () => {
	const shopOrder = (shipsFrom: string | null = 'loc_bar') =>
		({
			id: 'ord_1',
			orderNumber: 'ST-2611-688796',
			shipsFromLocationId: shipsFrom,
			buyer: { name: 'Priya Sharma' },
		}) as never;
	const refund = (outcome: 'accepted' | 'duplicate' | 'refused' | 'unknown') =>
		({ reference: 'Ratt1', outcome, reason: 'sold_out_before_payment' }) as const;

	it('gives a refund the shop already asked for its voucher, posted by the system, once per payment', async () => {
		const made = setup();
		const voucher = await made.service.automatic(shopOrder(), payment() as never, refund('accepted'), NOW);
		expect(voucher).toMatchObject({
			number: 'RF/26-27/000001',
			reference: 'Ratt1',
			reason: 'sold_out_before_payment',
			how: 'gateway',
			status: 'refunded',
			createdBy: null,
			locationId: 'loc_bar',
			voucherId: 'jv_1',
		});
		expect(made.asked).toEqual([]);
		expect(made.saved).toEqual([expect.objectContaining({ id: 'pay_1', state: 'refunded' })]);
		expect(made.logged.map((row) => row.actor)).toEqual([null, null]);
		const again = await made.service.automatic(shopOrder(), payment() as never, refund('duplicate'), NOW);
		expect(again?.id).toBe(voucher?.id);
		expect(made.vouchers).toHaveLength(1);
		expect(made.posted).toHaveLength(1);
		// Every voucher made: the default is "now".
		expect((await setup().service.automatic(shopOrder(), payment() as never, refund('accepted')))?.status).toBe(
			'refunded',
		);
	});

	it('keeps an unanswered refund Waiting and a refused one Failed, posting nothing', async () => {
		const waiting = setup();
		expect((await waiting.service.automatic(shopOrder(), payment() as never, refund('unknown'), NOW))?.status).toBe(
			'waiting_for_gateway',
		);
		const refused = setup();
		expect((await refused.service.automatic(shopOrder(), payment() as never, refund('refused'), NOW))?.status).toBe(
			'failed',
		);
		expect([...waiting.posted, ...refused.posted]).toEqual([]);
	});

	it('keeps it at the warehouse when the order names no location, and makes none with no location at all', async () => {
		const warehouse = setup({
			locations: [{ id: 'loc_wh', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-01-01' }],
		});
		expect(
			(await warehouse.service.automatic(shopOrder(null), payment() as never, refund('accepted'), NOW))
				?.locationId,
		).toBe('loc_wh');
		const nowhere = setup();
		expect(
			await nowhere.service.automatic(shopOrder(null), payment() as never, refund('accepted'), NOW),
		).toBeNull();
		expect(nowhere.vouchers).toEqual([]);
	});
});
