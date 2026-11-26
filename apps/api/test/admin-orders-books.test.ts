import {
	type ManualPaymentWrite,
	Order,
	OrderSettings,
	type OrderPayment,
	type PaymentRequest,
	type Shipment,
} from '@saha-textile/contracts';
import { NOT_CONNECTED_EINVOICE, NOT_CONNECTED_EWAYBILL, type EInvoicePort } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import {
	AdminOrdersService,
	attentionOf,
	attentionTimesOf,
	linesSummary,
	machineOrder,
	metaOf,
	paymentDetailOf,
} from '../src/admin-orders/admin-orders.service';

/**
 * The order page service: every path the older tests leave, and a payment received by hand posted to the books in the
 * same transaction (Postings and Convert brief P1; refused in words when the books can't take it, AP2).
 */

const NOW = new Date('2026-11-20T10:00:00.000Z');
const address = {
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
	country: 'IN',
};
const line = {
	lineId: 'l1',
	productId: 'p1',
	title: { en: 'Kanjivaram saree' },
	sku: 'SAR-1',
	quantity: 1,
	unitPriceINR: 6_000,
	unitPricePaid: 6_000,
	lineTotalINR: 6_000,
	lineTotalPaid: 6_000,
};
const balance = {
	goodsINR: 6_000,
	couponINR: 0,
	shippingINR: 0,
	totalINR: 6_000,
	paidINR: 0,
	dueINR: 6_000,
	paidAheadINR: 0,
};

const makeOrder = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [line],
		subtotalINR: 6_000,
		subtotalPaid: 6_000,
		totalINR: 6_000,
		totalPaid: 6_000,
		status: 'placed',
		paymentStatus: 'unpaid',
		channel: 'admin',
		buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das' },
		addresses: { billing: address, delivery: address },
		balance,
		createdAt: '2026-11-20T05:00:00.000Z',
		...over,
	});

const request = (over: Partial<PaymentRequest> = {}) =>
	({
		id: 'req_1',
		orderId: 'ord_1',
		number: 'ST-2611-482190/Q1',
		gateway: 'ccavenue',
		status: 'expired',
		expiresAt: '2026-11-19T10:00:00.000Z',
		attempts: [],
		createdBy: 'adm_2',
		createdAt: '2026-11-18T10:00:00.000Z',
		...over,
	}) as PaymentRequest;

const payment = (over: Partial<OrderPayment> = {}): OrderPayment => ({
	id: 'pay_1',
	orderId: 'ord_1',
	method: 'bankTransfer',
	state: 'pending',
	amountINR: 6_000,
	currency: 'INR',
	amount: 6_000,
	reference: 'UTR123',
	gateway: null,
	paypal: null,
	collector: null,
	collectedBy: null,
	receivedOn: null,
	receiptNumber: null,
	note: null,
	proofMediaId: null,
	recordedBy: 'adm_3',
	recordedAt: '2026-11-19T09:00:00.000Z',
	...over,
});

interface Options {
	order?: Order | null;
	payments?: OrderPayment[];
	requests?: PaymentRequest[];
	settings?: Record<string, unknown>;
	business?: unknown;
	edocs?: boolean;
	invoices?: { current?: unknown };
	staff?: Record<string, unknown>;
	notices?: boolean;
	books?: { refuse?: string };
	eInvoice?: EInvoicePort;
	list?: { orders: Order[]; total: number; counts: Record<string, number> };
}

function harness(options: Options = {}) {
	let stored = options.order === undefined ? makeOrder() : options.order;
	const payments = [...(options.payments ?? [])];
	const shipments: Shipment[] = [];
	const ledger: unknown[] = [];
	const metas: unknown[] = [];
	const stockMoves: string[] = [];
	const edocs = { eInvoiceEnabled: vi.fn(async () => false), recordForOrder: vi.fn(async () => undefined) };
	const invoices = {
		issueAtDispatch: vi.fn(async () => undefined),
		issueBeforeDispatch: vi.fn(async () => undefined),
		currentFor: vi.fn(async () => options.invoices?.current ?? null),
	};
	const notices = {
		plan: vi.fn((_order: Order, templates: readonly string[]) =>
			templates.map((template) => ({ template, channel: 'email' })),
		),
		afterChange: vi.fn(async () => undefined),
		send: vi.fn(async () => undefined),
	};
	const books = {
		paymentReceived: vi.fn(async (row: OrderPayment) => {
			if (options.books?.refuse && row.state === 'received') throw new Error(options.books.refuse);
			return null;
		}),
	};
	const service = new AdminOrdersService(
		{
			findById: async () => stored,
			update: async (next: Order, _revision: number, _context: unknown, meta: unknown) => {
				metas.push(meta);
				stored = { ...next, revision: next.revision + 1 };
				return stored;
			},
			list: async () => ({ orders: options.list?.orders ?? [], total: options.list?.total ?? 0 }),
			counts: async () => options.list?.counts ?? {},
		} as never,
		{
			listByOrder: async () => payments,
			findById: async (id: string) => payments.find((row) => row.id === id) ?? null,
			save: async (row: OrderPayment) => {
				const index = payments.findIndex((each) => each.id === row.id);
				if (index >= 0) payments[index] = row;
				else payments.push(row);
				return row;
			},
		} as never,
		{ listByOrder: async () => options.requests ?? [] } as never,
		{
			listByOrder: async () => shipments,
			courierNames: async () => [],
			save: async (row: Shipment) => {
				const index = shipments.findIndex((each) => each.id === row.id);
				if (index >= 0) shipments[index] = row;
				else shipments.push(row);
				return row;
			},
		} as never,
		{ get: async () => OrderSettings.parse(options.settings ?? {}) } as never,
		{ findById: async () => options.business ?? null } as never,
		{ balance: async () => 0, append: async (entry: unknown) => ledger.push(entry) } as never,
		options.eInvoice ?? NOT_CONNECTED_EINVOICE,
		NOT_CONNECTED_EWAYBILL,
		{
			childNumber: async (_kind: string, number: string, n: number) => `${number}/P${n}`,
			issue: async () => `RC/26-27/00000${payments.length + 1}`,
		} as never,
		{ check: async (input: object) => ({ ...input, gstStateCode: '19' }) } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({ tx: 1 }) } as never,
		{
			release: async () => stockMoves.push('release'),
			sell: async () => {
				stockMoves.push('sell');
				return new Map<string, number>();
			},
		} as never,
		options.staff
			? ({
					findById: async (id: string) => {
						const found = options.staff?.[id];
						if (found instanceof Error) throw found;
						return found ?? null;
					},
				} as never)
			: null,
		options.notices ? (notices as never) : null,
		options.edocs ? (edocs as never) : null,
		options.invoices ? (invoices as never) : null,
		options.books ? (books as never) : null,
	);
	return {
		service,
		payments,
		shipments,
		ledger,
		metas,
		stockMoves,
		edocs,
		invoices,
		notices,
		books,
		current: () => stored as Order,
	};
}

const actor = { id: 'adm_1', name: 'Staff' };
const nobody = { id: null, name: null };
const step = {
	comment: null,
	shipped: null,
	delivered: null,
	cancel: null,
	lineIds: [],
	revision: 0,
};

describe('the order page helpers', () => {
	it('reads an order with nothing optional as a person’s order with no addresses', () => {
		const bare = { ...makeOrder(), buyer: undefined, addresses: undefined, balance: undefined } as unknown as Order;
		expect(machineOrder(bare)).toMatchObject({
			buyerKind: 'person',
			invoiceAddressNeeded: false,
			lines: [{ madeToOrder: false }],
			goodsINR: 6_000,
		});
		expect(machineOrder(makeOrder({ lines: [{ ...line, madeToOrder: true }] })).lines).toEqual([
			{ madeToOrder: true },
		]);
	});

	it('stores every reason an order waits on staff, and works the time-based ones out on read', () => {
		const waiting = makeOrder({
			status: 'awaiting_payment',
			paymentStatus: 'pending_at_bank',
			paymentReview: { attemptId: 'att_1', reason: 'amountDiffers', at: '2026-11-19T08:00:00.000Z' },
			addresses: {
				billing: address,
				delivery: address,
				invoice: { source: 'none', needed: true },
			},
		});
		expect(metaOf(waiting).attention).toEqual(['invoiceAddressNeeded', 'pendingAtBank', 'paymentReview']);
		const settings = OrderSettings.parse({});
		expect(attentionOf(waiting, [request()], settings, NOW)).toEqual([
			'invoiceAddressNeeded',
			'requestExpiredUnpaid',
			'pendingAtBank',
			'paymentReview',
		]);
		// A live request, or every request paid, is nothing to chase.
		expect(
			attentionOf(
				waiting,
				[request(), request({ status: 'active', expiresAt: '2026-11-21T00:00:00.000Z' })],
				settings,
				NOW,
			),
		).not.toContain('requestExpiredUnpaid');
		expect(attentionOf(waiting, [request({ status: 'paid' })], settings, NOW)).not.toContain(
			'requestExpiredUnpaid',
		);
		const open = makeOrder({ status: 'open', openedAt: '2026-11-10T10:00:00.000Z' });
		const remind = OrderSettings.parse({ openOrders: { enabled: true, remindAfterDays: 3 } });
		expect(attentionOf(open, [], remind, NOW)).toEqual(['openTooLong']);
		expect(
			attentionOf(open, [], OrderSettings.parse({ openOrders: { enabled: false, remindAfterDays: 3 } }), NOW),
		).toEqual([]);
		expect(attentionOf(makeOrder({ status: 'open' }), [], remind, NOW)).toEqual([]);
		expect(
			attentionOf(open, [], OrderSettings.parse({ openOrders: { enabled: true, remindAfterDays: 30 } }), NOW),
		).toEqual([]);
	});

	it('words the payment line from the live request, how it will be paid, or the last payment received', () => {
		const live = request({ status: 'active', expiresAt: '2026-11-21T00:00:00.000Z' });
		expect(paymentDetailOf([], [live], NOW)).toEqual({
			kind: 'request',
			gateway: 'ccavenue',
			until: live.expiresAt,
		});
		expect(paymentDetailOf([], [], NOW, { paymentStatus: 'due_on_delivery', onAccountDueOn: null })).toEqual({
			kind: 'cashOnDelivery',
		});
		expect(paymentDetailOf([], [], NOW, { paymentStatus: 'on_account', onAccountDueOn: '2026-12-20' })).toEqual({
			kind: 'onAccount',
			dueOn: '2026-12-20',
		});
		expect(paymentDetailOf([], [], NOW, { paymentStatus: 'on_account' } as never)).toEqual({
			kind: 'onAccount',
			dueOn: null,
		});
		expect(paymentDetailOf([payment()], [], NOW)).toBeNull();
		expect(
			paymentDetailOf(
				[
					payment({
						state: 'received',
						method: 'gateway',
						reference: null,
						gateway: { id: 'ccavenue' } as never,
					}),
				],
				[],
				NOW,
			),
		).toEqual({ kind: 'payment', method: 'gateway', referenceStart: null, reference: null, gateway: 'ccavenue' });
		expect(paymentDetailOf([payment({ state: 'received' })], [], NOW)).toEqual({
			kind: 'payment',
			method: 'bankTransfer',
			referenceStart: 'UTR1',
			reference: 'UTR123',
			gateway: null,
		});
	});

	it('dates each reason, and leaves out a reason with nothing to date it', () => {
		const order = makeOrder({
			openedAt: '2026-11-10T10:00:00.000Z',
			paymentReview: { attemptId: 'att_1', reason: 'x', at: '2026-11-19T08:00:00.000Z' },
		});
		const all = ['requestExpiredUnpaid', 'pendingAtBank', 'paymentReview', 'openTooLong'] as const;
		expect(
			attentionTimesOf(
				order,
				all,
				[payment({ recordedAt: '2026-11-19T07:00:00.000Z' }), payment({ id: 'pay_2', state: 'received' })],
				[
					request({ expiresAt: '2026-11-19T10:00:00.000Z' }),
					request({ id: 'req_0', expiresAt: '2026-11-18T10:00:00.000Z' }),
					request({ id: 'req_p', status: 'paid', expiresAt: '2026-11-19T23:00:00.000Z' }),
					request({
						id: 'req_2',
						attempts: [
							{ state: 'pending', at: '2026-11-19T09:30:00.000Z' },
							{ state: 'failed', at: '2026-11-19T11:30:00.000Z' },
						] as never,
					}),
				],
			),
		).toEqual({
			requestExpiredUnpaid: '2026-11-19T10:00:00.000Z',
			pendingAtBank: '2026-11-19T09:30:00.000Z',
			paymentReview: '2026-11-19T08:00:00.000Z',
			openTooLong: '2026-11-10T10:00:00.000Z',
		});
		expect(attentionTimesOf(makeOrder(), all, [], [request({ status: 'paid' })])).toEqual({});
		expect(attentionTimesOf(order, [], [payment()], [request()])).toEqual({});
	});

	it('sums up long line lists with how many more', () => {
		const rows = ['A', 'B', 'C', 'D', 'E'].map((title) => ({ quantity: 2, title: { en: title } }));
		expect(linesSummary(rows as never)).toBe('2 × A, 2 × B, 2 × C +2');
		expect(linesSummary(rows.slice(0, 2) as never)).toBe('2 × A, 2 × B');
	});
});

describe('the order page service', () => {
	it('lists orders with their rows, counts and tiles', async () => {
		const open = {
			...makeOrder({
				id: 'ord_2',
				status: 'open',
				openedAt: '2026-11-19T10:00:00.000Z',
				lines: [
					{ ...line, held: true, quantity: 2 },
					{ ...line, lineId: 'l2', held: false },
				],
			}),
			balance: undefined,
			buyer: undefined,
			addresses: undefined,
			createdAt: undefined,
			shipping: { deliveryCountry: 'GB' },
		} as unknown as Order;
		const paid = makeOrder({
			addresses: { billing: address, delivery: { ...address, countryCode: 'IN' } },
		});
		const { service } = harness({
			list: {
				orders: [
					open,
					paid,
					makeOrder({ id: 'ord_3', addresses: undefined }),
					makeOrder({ id: 'ord_4', status: 'open', openedAt: '2026-11-19T10:00:00.000Z' }),
				],
				total: 4,
				counts: { all: 4, open: 2, toPack: 1, 'attention:pendingAtBank': 1 },
			},
		});
		const result = await service.list({} as never, NOW);
		expect(result.total).toBe(4);
		expect(result.counts).toMatchObject({ all: 4, open: 2, placed: 0 });
		expect(result.tiles).toEqual({
			needsAttention: 0,
			awaitingPayment: 0,
			toPack: 1,
			shippedNotDelivered: 0,
			attentionBy: { pendingAtBank: 1 },
		});
		expect(result.items[0]).toMatchObject({
			createdAt: NOW.toISOString(),
			buyerName: '',
			buyerKind: 'person',
			deliveryCountry: 'GB',
			open: { piecesHeld: 2, goodsINR: 6_000, paidINR: 0, dueINR: 0, paidAheadINR: 0 },
		});
		expect(result.items[1]).toMatchObject({ deliveryCountry: 'IN', open: null, buyerName: 'Ananya Das' });
		expect(result.items[2]?.deliveryCountry).toBeNull();
		expect(result.items[3]?.open).toMatchObject({ goodsINR: 6_000, dueINR: 6_000 });
	});

	it('names the staff on the page, leaving out unknown and broken accounts', async () => {
		const order = makeOrder({
			createdBy: 'adm_1',
			history: [
				{
					at: NOW.toISOString(),
					by: 'adm_2',
					byName: null,
					kind: 'comment',
					from: null,
					to: null,
					comment: 'x',
					messages: [],
					detail: {},
				},
				{
					at: NOW.toISOString(),
					by: null,
					byName: null,
					kind: 'comment',
					from: null,
					to: null,
					comment: 'y',
					messages: [],
					detail: {},
				},
			],
		});
		const { service } = harness({
			order,
			payments: [payment({ recordedBy: 'adm_3' }), payment({ id: 'pay_2', recordedBy: 'adm_4' })],
			requests: [request({ createdBy: 'adm_5' })],
			staff: {
				adm_1: { displayName: ' Rina Saha Textile ' },
				adm_2: { displayName: ' ', username: 'mitra' },
				adm_3: { email: 'ops@saha-textile.test' },
				adm_4: new Error('down'),
				adm_5: { displayName: null, username: null, email: null },
			},
		});
		expect((await service.detail('ord_1', NOW)).staff).toEqual({
			adm_1: 'Rina Saha Textile',
			adm_2: 'mitra',
			adm_3: 'ops',
		});
		expect((await harness().service.detail('ord_1', NOW)).staff).toEqual({});
	});

	it('asks the e-document settings whether the GSTIN can get an IRN, and plans messages only with notices', async () => {
		const { service, edocs } = harness({
			edocs: true,
			order: makeOrder({ buyer: { kind: 'business', businessId: 'biz_1', name: 'Nila' } }),
		});
		const detail = await service.detail('ord_1', NOW);
		expect(edocs.eInvoiceEnabled).toHaveBeenCalled();
		expect(detail.eDocuments.eInvoice.required).toBe(false);
		expect(service.told(makeOrder(), ['order_shipped'])).toEqual([]);
		const told = harness({ notices: true });
		expect(told.service.told(makeOrder(), ['order_shipped'])).toEqual([
			{ template: 'order_shipped', channel: 'email' },
		]);
	});

	it('says when the order is gone', async () => {
		await expect(harness({ order: null }).service.get('ord_x')).rejects.toMatchObject({
			response: { issues: [{ code: 'order_missing' }] },
		});
	});

	it('records a business receipt’s share as a payment on account and settles the order', async () => {
		const { service, payments, current } = harness();
		await service.settleFromReceipt(
			'ord_1',
			{ amountINR: 6_000, receiptNumber: 'BR/26-27/000001', reference: 'NEFT9', receivedOn: '2026-11-20' },
			actor,
			{} as never,
			NOW,
		);
		expect(payments[0]).toMatchObject({
			method: 'onAccount',
			state: 'received',
			amountINR: 6_000,
			recordedBy: 'adm_1',
		});
		expect(current().paymentStatus).toBe('paid');
		expect(current().history.at(-1)).toMatchObject({ kind: 'payment', detail: { receipt: 'BR/26-27/000001' } });
		const fresh = harness();
		await fresh.service.settleFromReceipt(
			'ord_1',
			{ amountINR: 6_000, receiptNumber: null, reference: 'NEFT9', receivedOn: '2026-11-20' },
			actor,
			{} as never,
		);
		expect(fresh.payments).toHaveLength(1);
	});
});

describe('status steps', () => {
	it('asks for the delivery date and a reason to cancel', async () => {
		const shipped = harness({ order: makeOrder({ status: 'shipped', paymentStatus: 'paid' }) });
		await expect(shipped.service.changeStatus('ord_1', { ...step, to: 'delivered' }, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'delivered_on_needed' }] },
		});
		const placed = harness();
		await expect(placed.service.changeStatus('ord_1', { ...step, to: 'cancelled' }, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'cancel_reason_needed' }] },
		});
	});

	it('cancels: the kept pieces go back on sale, the order closes and the reason is in the history', async () => {
		const { service, stockMoves, current, notices } = harness({
			order: makeOrder({ lines: [{ ...line, held: true }] }),
			notices: true,
		});
		await service.changeStatus(
			'ord_1',
			{ ...step, to: 'cancelled', cancel: { reason: 'customerAsked', note: 'Changed her mind' } },
			actor,
			NOW,
		);
		expect(stockMoves).toEqual(['release']);
		expect(current()).toMatchObject({ status: 'cancelled', closedAt: NOW.toISOString(), lines: [{ held: false }] });
		expect(current().history.at(-1)).toMatchObject({
			comment: 'Changed her mind',
			detail: { reason: 'customerAsked' },
		});
		expect(notices.send).toHaveBeenCalled();
	});

	it('delivers with proof on the last parcel, or with no parcel recorded', async () => {
		const shippedOrder = makeOrder({ status: 'shipped', paymentStatus: 'paid' });
		const withParcel = harness({ order: shippedOrder });
		withParcel.shipments.push({ id: 'shp_1', events: [] } as never);
		await withParcel.service.changeStatus(
			'ord_1',
			{
				...step,
				to: 'delivered',
				comment: 'Left with the guard',
				delivered: { deliveredOn: '2026-11-20', podReference: null, receivedBy: 'Guard' },
			},
			actor,
			NOW,
		);
		expect(withParcel.shipments[0]).toMatchObject({
			deliveredOn: '2026-11-20',
			pod: { source: 'staff', receivedBy: 'Guard' },
			events: [{ status: 'delivered', note: 'Left with the guard' }],
		});
		expect(withParcel.current()).toMatchObject({ status: 'delivered', closedAt: NOW.toISOString() });
		expect(withParcel.current().history.at(-1)?.detail).toMatchObject({
			proof: 'Guard',
			deliveredOn: '2026-11-20',
		});
		const none = harness({ order: shippedOrder });
		await none.service.changeStatus(
			'ord_1',
			{
				...step,
				to: 'delivered',
				delivered: { deliveredOn: '2026-11-20', podReference: 'POD1', receivedBy: null },
			},
			actor,
			NOW,
		);
		expect(none.shipments).toEqual([]);
		expect(none.current().history.at(-1)?.detail).toMatchObject({ proof: 'POD1' });
		const noProof = harness({ order: shippedOrder });
		await noProof.service.changeStatus(
			'ord_1',
			{
				...step,
				to: 'delivered',
				delivered: { deliveredOn: '2026-11-20', podReference: null, receivedBy: null },
			},
			actor,
			NOW,
		);
		expect(noProof.current().history.at(-1)?.detail).toMatchObject({ proof: null });
	});

	it('ships chosen pieces, issues the parcel’s tax invoice, and keeps a closed order’s close date', async () => {
		const { service, shipments, invoices, current } = harness({
			order: makeOrder({
				status: 'packed',
				paymentStatus: 'paid',
				closedAt: null,
				lines: [
					{ ...line, held: true, unitCostINR: 3_000 },
					{ ...line, lineId: undefined, held: false },
				],
			}),
			invoices: {},
		});
		await service.changeStatus(
			'ord_1',
			{
				...step,
				to: 'shipped',
				shipped: {
					mode: 'manual',
					courierName: 'DTDC',
					trackingNumber: 'D1',
					trackingUrl: 'https://track.example/D1',
					shippedOn: '2026-11-20',
					lineIds: ['l1', 'gone'],
				},
			},
			actor,
			NOW,
		);
		expect(shipments[0]?.lineIds).toEqual(['l1']);
		expect(invoices.issueAtDispatch).toHaveBeenCalled();
		expect(current().lines.map((row) => row.unitCostINR)).toEqual([3_000, null]);
		expect(current().closedAt).toBeNull();
	});
});

describe('pack list, comments and the invoice address', () => {
	it('adds a comment to the history', async () => {
		const { service, current } = harness();
		await service.comment('ord_1', 'Called her', 0, actor, NOW);
		expect(current().history.at(-1)).toMatchObject({ kind: 'comment', comment: 'Called her' });
	});

	it('ticks and unticks a piece while packing, and refuses other orders or unknown pieces', async () => {
		const { service, current } = harness({ order: makeOrder({ status: 'processing' }) });
		await service.packTick('ord_1', { lineId: 'l1', ticked: true, revision: 0 }, NOW);
		expect(current().packTicks).toEqual(['l1']);
		await service.packTick('ord_1', { lineId: 'l1', ticked: false, revision: 1 }, NOW);
		expect(current().packTicks).toEqual([]);
		await expect(service.packTick('ord_1', { lineId: 'zz', ticked: true, revision: 2 })).rejects.toMatchObject({
			response: { issues: [{ code: 'pack_line_unknown' }] },
		});
		await expect(
			harness({ order: makeOrder({ status: 'shipped' }) }).service.packTick('ord_1', {
				lineId: 'l1',
				ticked: true,
				revision: 0,
			}),
		).rejects.toMatchObject({ response: { issues: [{ code: 'pack_closed' }] } });
	});

	it('refuses an invoice address with nothing to add it to, or outside India', async () => {
		const input = {
			address: { ...address, countryCode: 'IN' },
			confirmedHow: 'Phone call',
			revision: 0,
		} as never;
		await expect(
			harness({ order: makeOrder({ addresses: undefined }) }).service.setInvoiceAddress('ord_1', input, actor),
		).rejects.toMatchObject({ response: { issues: [{ code: 'no_addresses' }] } });
		await expect(
			harness().service.setInvoiceAddress(
				'ord_1',
				{ address: { ...address, countryCode: 'GB' }, confirmedHow: 'x', revision: 0 } as never,
				actor,
			),
		).rejects.toMatchObject({ response: { issues: [{ code: 'invoice_address_india' }] } });
	});
});

describe('e-invoice and e-way bill', () => {
	const record = {
		irn: 'a'.repeat(64),
		ackNo: '112010036563310',
		ackDate: '2026-11-20T06:00:00.000Z',
		signedQr: 'QR',
	};

	it('says what the portal refused', async () => {
		const { service } = harness({
			eInvoice: { connected: true, raise: async () => ({ kind: 'refused', message: 'GSTIN inactive' }) },
		});
		expect(await service.raise('ord_1', 'eInvoice', actor)).toEqual({
			outcome: 'refused',
			message: 'GSTIN inactive',
		});
	});

	it('raises through the connection: the tax invoice first, then the record with its document', async () => {
		const { service, edocs, invoices, current } = harness({
			eInvoice: { connected: true, raise: async () => ({ kind: 'raised', record: record as never }) },
			edocs: true,
			invoices: { current: { id: 'inv_1' } },
		});
		const result = await service.raise('ord_1', 'eInvoice', nobody, NOW);
		expect(result.outcome).toBe('raised');
		expect(invoices.issueBeforeDispatch).toHaveBeenCalledWith(expect.anything(), null, NOW.toISOString());
		expect(current().eInvoice).toMatchObject({ irn: record.irn, by: 'unknown' });
		expect(edocs.recordForOrder).toHaveBeenCalledWith(expect.anything(), 'eInvoice', 'irpDirect', 'unknown', {
			id: 'inv_1',
		});
		const bill = harness({ edocs: true });
		(bill.service as unknown as { eWayBill: unknown }).eWayBill = {
			connected: true,
			raise: async () => ({ kind: 'raised', record: { number: '331001234567' } }),
		};
		await bill.service.raise('ord_1', 'eWayBill', actor, NOW);
		expect(bill.current().eWayBill).toMatchObject({ number: '331001234567', by: 'adm_1' });
		expect(bill.edocs.recordForOrder).toHaveBeenCalledWith(
			expect.anything(),
			'eWayBill',
			'ewbDirect',
			'adm_1',
			null,
		);
	});

	it('records documents typed by hand with the e-document settings, by an unnamed actor too', async () => {
		const { service, edocs, current } = harness({ edocs: true, invoices: {} });
		await service.setEInvoice('ord_1', { ...record, revision: 0 }, nobody, NOW);
		expect(current().eInvoice).toMatchObject({ signedQr: 'QR', source: 'manual', by: 'unknown' });
		await service.setEWayBill(
			'ord_1',
			{
				number: '331001234567',
				generatedOn: '2026-11-20T06:10:00.000Z',
				validUntil: '2026-11-21T06:10:00.000Z',
				transporterName: null,
				transporterId: null,
				vehicleOrDocumentNo: null,
				distanceKm: 12,
				revision: 1,
			},
			nobody,
			NOW,
		);
		expect(current().eWayBill).toMatchObject({ by: 'unknown' });
		expect(edocs.recordForOrder).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			'eInvoice',
			'manual',
			'unknown',
			null,
		);
		expect(edocs.recordForOrder).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			'eWayBill',
			'manual',
			'unknown',
			null,
		);
		const later = harness({ edocs: true, invoices: { current: { id: 'inv_1' } } });
		await later.service.setEInvoice('ord_1', { ...record, revision: 0 }, actor, NOW);
		expect(later.edocs.recordForOrder).toHaveBeenCalledWith(expect.anything(), 'eInvoice', 'manual', 'adm_1', {
			id: 'inv_1',
		});
	});
});

describe('payments typed by hand, posted to the books', () => {
	const manual: ManualPaymentWrite = {
		method: 'bankTransfer',
		amountINR: 6_000,
		reference: 'UTR777',
		received: true,
		receivedOn: '2026-11-20',
		note: null,
		proofMediaId: null,
		collector: null,
		collectedBy: null,
		revision: 0,
	};

	it('saves an order another step built whole, and settles an order kept without a balance', async () => {
		const { service, current, metas } = harness();
		await service.updateRaw({ ...makeOrder(), status: 'processing' }, 0);
		expect(current().status).toBe('processing');
		expect(metas).toEqual([{ attention: [] }]);
		const bare = harness({ order: { ...makeOrder(), balance: undefined } as unknown as Order });
		await bare.service.recordPayment('ord_1', manual, actor, NOW);
		expect(bare.current().balance).toMatchObject({ couponINR: 0, shippingINR: 0, paidINR: 6_000, dueINR: 0 });
	});

	it('opens Record payment with what is due, or the total on an order without a balance', async () => {
		expect(await harness().service.paymentPrefill('ord_1')).toEqual({ amountINR: 6_000 });
		expect(await harness({ order: makeOrder({ balance: undefined }) }).service.paymentPrefill('ord_1')).toEqual({
			amountINR: 6_000,
		});
	});

	it('posts a received payment in the same transaction, and nothing for one still on its way', async () => {
		const { service, books, payments } = harness({ books: {} });
		await service.recordPayment('ord_1', manual, actor, NOW);
		expect(books.paymentReceived).toHaveBeenCalledWith(
			payments[0],
			expect.objectContaining({ id: 'ord_1' }),
			{ tx: 1 },
			'adm_1',
		);
		expect(payments[0]).toMatchObject({ state: 'received', receiptNumber: 'RC/26-27/000001' });
		const waiting = harness({ books: { refuse: 'money_lands_not_set:received_by_bank' } });
		await waiting.service.recordPayment('ord_1', { ...manual, received: false }, actor, NOW);
		expect(waiting.payments[0]).toMatchObject({ state: 'pending', receivedOn: null, receiptNumber: null });
	});

	it('refuses the whole step, in the books’ words, when the books can’t take the payment (AP2)', async () => {
		const { service, current } = harness({ books: { refuse: 'money_lands_not_set:received_by_bank' } });
		await expect(service.recordPayment('ord_1', manual, actor, NOW)).rejects.toThrow(
			'money_lands_not_set:received_by_bank',
		);
		expect(current().history).toEqual([]);
	});

	it('refuses a cancelled order, and records cash on delivery with who collects it', async () => {
		await expect(
			harness({ order: makeOrder({ status: 'cancelled' }) }).service.recordPayment('ord_1', manual, actor),
		).rejects.toMatchObject({ response: { issues: [{ code: 'order_cancelled' }] } });
		const methods = OrderSettings.parse({}).adminPaymentMethods;
		const withCod = harness({ settings: { adminPaymentMethods: { ...methods, cashOnDelivery: true } } });
		await withCod.service.recordPayment(
			'ord_1',
			{ ...manual, method: 'cashOnDelivery', received: false },
			actor,
			NOW,
		);
		expect(withCod.payments[0]).toMatchObject({ collector: 'staff', collectedBy: null });
		await withCod.service.recordPayment(
			'ord_1',
			{
				...manual,
				method: 'cashOnDelivery',
				received: false,
				collector: 'courier',
				collectedBy: 'Delhivery',
				revision: 1,
			} as never,
			actor,
			NOW,
		);
		expect(withCod.payments[1]).toMatchObject({ collector: 'courier', collectedBy: 'Delhivery' });
	});

	it('marks a pending transfer received, posts it, and refuses anything else', async () => {
		const pending = payment();
		const { service, books, payments, notices } = harness({ payments: [pending], books: {}, notices: true });
		await service.markReceived(
			'ord_1',
			'pay_1',
			{ reference: 'UTR9', receivedOn: '2026-11-20', revision: 0 },
			actor,
			NOW,
		);
		expect(payments[0]).toMatchObject({ state: 'received', reference: 'UTR9', receiptNumber: 'RC/26-27/000002' });
		expect(books.paymentReceived).toHaveBeenCalledWith(payments[0], expect.anything(), { tx: 1 }, 'adm_1');
		expect(notices.send).toHaveBeenCalledWith(expect.anything(), ['payment_receipt'], expect.anything(), 'pay_1');
		const awaiting = harness({
			order: makeOrder({ status: 'awaiting_payment' }),
			payments: [payment()],
			notices: true,
		});
		await awaiting.service.markReceived(
			'ord_1',
			'pay_1',
			{ reference: 'U', receivedOn: '2026-11-20', revision: 0 },
			actor,
		);
		expect(awaiting.notices.send).not.toHaveBeenCalledWith(
			expect.anything(),
			['payment_receipt'],
			expect.anything(),
			'pay_1',
		);
		const input = { reference: 'U', receivedOn: '2026-11-20', revision: 0 };
		const others = harness({
			payments: [
				payment({ id: 'pay_x', orderId: 'ord_9' }),
				payment({ id: 'pay_r', state: 'received' }),
				payment({ id: 'pay_g', gateway: { id: 'ccavenue' } as never }),
			],
		});
		await expect(others.service.markReceived('ord_1', 'pay_none', input, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'payment_missing' }] },
		});
		await expect(others.service.markReceived('ord_1', 'pay_x', input, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'payment_missing' }] },
		});
		await expect(others.service.markReceived('ord_1', 'pay_r', input, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'payment_not_pending' }] },
		});
		await expect(others.service.markReceived('ord_1', 'pay_g', input, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'payment_not_pending' }] },
		});
	});

	it('takes an on-account business’s payment off its account, by an unnamed actor too', async () => {
		const { service, ledger } = harness({
			order: makeOrder({
				buyer: { kind: 'business', businessId: 'biz_1', name: 'Nila' },
				placedWith: 'onAccount',
			}),
		});
		await service.recordPayment('ord_1', manual, nobody, NOW);
		expect(ledger[0]).toMatchObject({ businessId: 'biz_1', amountINR: -6_000, by: 'unknown' });
		const person = harness({ order: makeOrder({ placedWith: 'onAccount' }) });
		await person.service.recordPayment('ord_1', manual, actor, NOW);
		expect(person.ledger).toEqual([]);
	});

	it('flags an order waiting on a request that ran out unpaid when it settles', async () => {
		const { service, metas } = harness({
			order: makeOrder({ status: 'awaiting_payment' }),
			requests: [request()],
		});
		await service.recordPayment('ord_1', { ...manual, amountINR: 1_000 }, actor, NOW);
		expect(metas.at(-1)).toEqual({ attention: ['requestExpiredUnpaid'] });
		const live = harness({
			order: makeOrder({ status: 'awaiting_payment' }),
			requests: [request({ status: 'active', expiresAt: '2026-11-21T00:00:00.000Z' })],
		});
		await live.service.recordPayment('ord_1', { ...manual, amountINR: 1_000 }, actor, NOW);
		expect(live.metas.at(-1)).toEqual({ attention: [] });
		const paidRequest = harness({
			order: makeOrder({ status: 'awaiting_payment' }),
			requests: [request({ status: 'paid' })],
		});
		await paidRequest.service.recordPayment('ord_1', { ...manual, amountINR: 1_000 }, actor, NOW);
		expect(paidRequest.metas.at(-1)).toEqual({ attention: [] });
	});
});
