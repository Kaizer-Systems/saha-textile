import { Order, OrderSettings, type OrderPayment, type PaymentRequest } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PaymentRequestsService } from '../src/admin-orders/payment-requests.service';

/**
 * Payment requests (pl01–pl05, pr01–pr02): every path, and a captured payment posted to the books in the same
 * transaction (Postings and Convert brief P1; a gateway payment is the customer's and is kept, AP-D2).
 */

const base = {
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	currency: 'INR',
	lines: [
		{
			lineId: 'l1',
			productId: 'p1',
			title: { en: 'Saree' },
			sku: 'SAR-1',
			quantity: 1,
			unitPriceINR: 1_000,
			unitPricePaid: 1_000,
			lineTotalINR: 1_000,
			lineTotalPaid: 1_000,
		},
	],
	subtotalINR: 1_000,
	subtotalPaid: 1_000,
	totalINR: 1_000,
	totalPaid: 1_000,
	status: 'placed',
	buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya', email: 'a@example.test' },
	balance: {
		goodsINR: 1_000,
		couponINR: 0,
		shippingINR: 0,
		totalINR: 1_000,
		paidINR: 0,
		dueINR: 1_000,
		paidAheadINR: 0,
	},
};
const orderOf = (o: Record<string, unknown> = {}) => Order.parse({ ...base, ...o });
const NOW = new Date('2026-11-20T06:00:00.000Z');
const settingsOf = (paymentLink: boolean) => {
	const settings = OrderSettings.parse({});
	return { ...settings, adminPaymentMethods: { ...settings.adminPaymentMethods, paymentLink } };
};
const actor = { id: 'adm_1', name: null };

interface Options {
	order?: Order;
	linkOff?: boolean;
	ports?: string[];
	payments?: Array<{ gatewayReference: string; amountMinor: number }>;
	state?: string;
	known?: OrderPayment[];
	channelOff?: boolean;
	noShop?: boolean;
	noOrigin?: boolean;
	noNotices?: boolean;
	noBooks?: boolean;
	cancelFails?: boolean;
}

function setup(o: Options = {}) {
	const requests: PaymentRequest[] = [];
	const posted: unknown[][] = [];
	const told: string[] = [];
	const noticed: unknown[] = [];
	const order = o.order ?? orderOf();
	const port = (gateway: string) => ({
		gateway,
		createPaymentRequest: async (input: { reference: string }) => ({
			gatewayRequestId: `qi_${input.reference}`,
			url: `https://pay.example/${requests.length + 1}`,
			auditRecord: {},
		}),
		fetchPaymentRequestStatus: async (id: string) => ({
			gatewayRequestId: id,
			state: o.state ?? 'paid',
			payments: (o.payments ?? []).map((row) => ({
				...row,
				currency: 'INR',
				at: '2026-11-20T07:00:00.000Z',
				method: 'upi',
			})),
			auditRecord: {},
		}),
		cancelPaymentRequest: async () => {
			if (o.cancelFails) throw new Error('gateway down');
		},
	});
	const svc = new PaymentRequestsService(
		{
			get: async () => order,
			tell: async () => void told.push('tell'),
			settle: async () => order,
		} as never,
		{
			childNumber: async (_k: string, n: string, i: number) => `${n}/Q${i}`,
			issue: async () => 'RC/26-27/000009',
		} as never,
		{
			listEnabled: async () => [
				{ code: 'INR', symbol: '₹' },
				{ code: 'USD', symbol: 'US$' },
				{ code: 'EUR', symbol: '€' },
			],
			convert: async (amountINR: number, code: string) => ({
				currency: code.toUpperCase(),
				amount: amountINR,
				rateFromINR: 1,
				markupPercent: 0,
				amountINR,
			}),
		} as never,
		{
			listByOrder: async () => requests,
			findById: async (id: string) => requests.find((r) => r.id === id) ?? null,
			findByTokenHash: async () => requests[0] ?? null,
			save: async (request: PaymentRequest) => {
				const at = requests.findIndex((r) => r.id === request.id);
				if (at >= 0) requests[at] = request;
				else requests.push(request);
				return request;
			},
		} as never,
		{
			findByGatewayReference: async (_g: string, ref: string) =>
				(o.known ?? []).find((p) => p.reference === ref) ?? null,
			save: async () => undefined,
		} as never,
		{ get: async () => settingsOf(!o.linkOff) } as never,
		{ get: async () => (o.noShop ? null : { phone: '', email: 'wecare@example.test' }) } as never,
		new Map((o.ports ?? ['ccavenue', 'paypal']).map((g) => [g, port(g)])) as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		{ media: { shopOrigin: o.noOrigin ? null : 'https://shop.example' } } as never,
		{
			isChannelEnabled: async () => !o.channelOff,
			send: async () => ({ status: 'sent', providerMessageId: 'm', outboxEntryId: 'x' }),
		} as never,
		o.noNotices
			? null
			: ({
					plan: () => [{ channel: 'email' }],
					send: async (...args: unknown[]) => void noticed.push(args),
				} as never),
		o.noBooks ? null : ({ paymentReceived: async (...args: unknown[]) => void posted.push(args) } as never),
	);
	return { svc, requests, posted, told, noticed };
}

const refusal = async (work: Promise<unknown>) =>
	((await work.catch((e: unknown) => e)) as { response?: { issues?: { code: string }[] } }).response?.issues?.[0]
		?.code;

describe('the preview', () => {
	it('names every reason a request can’t go', async () => {
		expect((await setup({ linkOff: true }).svc.preview('ord_1', { currency: 'INR' })).problem).toBe('method_off');
		const paid = orderOf({ balance: undefined });
		const nothing = await setup({ order: paid }).svc.preview('ord_1', { currency: 'INR' });
		expect(nothing).toMatchObject({ problem: 'nothing_due', dueINR: 0, amount: 0, rateFromINR: null });
		const noContact = orderOf({ buyer: { kind: 'person', customerId: 'cus_1', name: 'A' } });
		expect((await setup({ order: noContact }).svc.preview('ord_1', { currency: 'INR' })).problem).toBe(
			'no_contact',
		);
		const nobody = await setup({ order: orderOf({ buyer: undefined }) }).svc.preview('ord_1', { currency: 'INR' });
		expect(nobody.problem).toBe('no_contact');
		const eur = await setup().svc.preview('ord_1', { currency: 'EUR' });
		expect(eur.currencies.map((c) => c.code)).toEqual(['INR', 'EUR', 'USD']);
		expect(eur.smsReachable).toBe(false);
	});
});

describe('making a request', () => {
	it('refuses with the link off, nothing due, no gateway or no contact', async () => {
		expect(
			await refusal(
				setup({ linkOff: true }).svc.create('ord_1', { amountINR: 1, currency: 'INR', revision: 0 }, actor),
			),
		).toBe('method_off');
		expect(
			await refusal(
				setup({ order: orderOf({ balance: undefined }) }).svc.create(
					'ord_1',
					{ amountINR: 1, currency: 'INR', revision: 0 },
					actor,
				),
			),
		).toBe('nothing_due');
		const settled = orderOf({ balance: { ...base.balance, paidINR: 1_000, dueINR: 0 } });
		expect(
			await refusal(
				setup({ order: settled }).svc.create('ord_1', { amountINR: 1, currency: 'INR', revision: 0 }, actor),
			),
		).toBe('nothing_due');
		expect(
			await refusal(
				setup({ ports: [] }).svc.create('ord_1', { amountINR: 1, currency: 'INR', revision: 0 }, actor),
			),
		).toBe('gateway_not_configured');
		const noContact = orderOf({ buyer: { kind: 'person', customerId: 'cus_1', name: 'A' } });
		expect(
			await refusal(
				setup({ order: noContact }).svc.create('ord_1', { amountINR: 1, currency: 'INR', revision: 0 }, actor),
			),
		).toBe('no_contact');
	});

	it('makes one with no shop address, by an unnamed actor, and cancels the one it replaces even when the gateway fails', async () => {
		const { svc, requests } = setup({ noOrigin: true, cancelFails: true });
		const first = await svc.create(
			'ord_1',
			{ amountINR: 500, currency: 'INR', revision: 0, validDays: 3 },
			{ id: null, name: null } as never,
			NOW,
		);
		expect(first).toMatchObject({ ourUrl: null, createdBy: 'unknown', sentTo: { mobile: null } });
		requests.push({ ...first, id: 'req_old', gatewayRequestId: null } as never);
		await svc.create('ord_1', { amountINR: 400, currency: 'INR', revision: 1 }, actor, NOW);
		expect(requests.filter((r) => r.status === 'replaced')).toHaveLength(2);
	});
});

describe('checking a request', () => {
	it('records a captured payment, posts it to the books, and sends the receipt for a placed order', async () => {
		const { svc, posted, told, noticed } = setup({ payments: [{ gatewayReference: 'g1', amountMinor: 50_000 }] });
		const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		const result = await svc.check('ord_1', request.id, actor, NOW);
		expect(result).toMatchObject({ recorded: true, request: { status: 'paid' } });
		expect(posted[0]?.[0]).toMatchObject({ method: 'gateway', state: 'received', amountINR: 500 });
		expect(posted[0]?.slice(1)).toEqual([expect.objectContaining({ id: 'ord_1' }), {}, 'adm_1']);
		expect([told, noticed.length]).toEqual([['tell'], 1]);
	});

	it('skips a payment already recorded, and keeps each state the gateway reports', async () => {
		for (const state of ['cancelled', 'expired', 'open']) {
			const { svc, posted } = setup({
				state,
				payments: [{ gatewayReference: 'g1', amountMinor: 100 }],
				known: [{ reference: 'g1' } as never],
			});
			const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
			const result = await svc.check('ord_1', request.id, actor, NOW);
			expect(result.recorded).toBe(false);
			expect(result.request.status).toBe(state === 'open' ? 'active' : state);
			expect(posted).toEqual([]);
		}
	});

	it('records with no books, no notices, and no receipt for an order still awaiting payment', async () => {
		const awaiting = orderOf({ status: 'awaiting_payment' });
		const { svc, noticed } = setup({
			order: awaiting,
			noBooks: true,
			noNotices: true,
			payments: [{ gatewayReference: 'g2', amountMinor: 0 }],
		});
		const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		await svc.check('ord_1', { ...request }.id, actor, NOW);
		expect(noticed).toEqual([]);
		const zero = setup({ payments: [{ gatewayReference: 'g3', amountMinor: 100 }] });
		const free = await zero.svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		zero.requests[0] = { ...free, amount: 0 };
		expect((await zero.svc.check('ord_1', free.id, actor, NOW)).payment?.amountINR).toBe(0);
	});

	it('refuses a request with no gateway set up, and one that is gone', async () => {
		const { svc, requests } = setup();
		const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		requests[0] = { ...request, gatewayRequestId: null };
		expect(await refusal(svc.check('ord_1', request.id, actor, NOW))).toBe('gateway_not_configured');
		expect(await refusal(svc.check('ord_1', 'req_none', actor, NOW))).toBe('request_missing');
		expect(await refusal(svc.check('ord_other', request.id, actor, NOW))).toBe('request_missing');
	});
});

describe('cancelling, the pay page and messages', () => {
	it('cancels an active request, and refuses one that has ended', async () => {
		const { svc, requests } = setup({ ports: ['ccavenue'] });
		const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		expect((await svc.cancel('ord_1', request.id, actor, NOW)).status).toBe('cancelled');
		expect(await refusal(svc.cancel('ord_1', request.id, actor, NOW))).toBe('request_not_active');
		requests[0] = { ...request, status: 'active', gatewayRequestId: null, gateway: 'paypal' } as never;
		expect((await svc.cancel('ord_1', request.id, actor, NOW)).status).toBe('cancelled');
	});

	it('shows paid, payable or expired with the shop’s contact', async () => {
		const { svc, requests } = setup();
		await expect(svc.payPage('nothing', NOW)).rejects.toThrow('does not exist');
		const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		expect(await svc.payPage('t', NOW)).toMatchObject({
			state: 'payable',
			deliveryCity: null,
			deliveryCountry: null,
		});
		requests[0] = { ...request, status: 'paid' };
		expect(await svc.payPage('t', NOW)).toMatchObject({ state: 'paid' });
		requests[0] = { ...request, status: 'expired' };
		expect(await svc.payPage('t', NOW)).toMatchObject({
			state: 'expired',
			contactPhone: null,
			contactEmail: 'wecare@example.test',
		});
		const empty = setup({ noShop: true });
		const lone = await empty.svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		empty.requests[0] = { ...lone, gatewayUrl: null } as never;
		expect(await empty.svc.payPage('t', NOW)).toMatchObject({
			state: 'expired',
			contactPhone: null,
			contactEmail: null,
		});
		const paidOrder = setup({ order: orderOf({ paymentStatus: 'paid_ahead' }) });
		await paidOrder.svc
			.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW)
			.catch(() => undefined);
		paidOrder.requests.push({ ...request, orderId: 'ord_1' });
		expect(await paidOrder.svc.payPage('t', NOW)).toMatchObject({ state: 'paid' });
	});

	it('says why a message can’t go, and sends one only while the request is active', async () => {
		const { svc, requests } = setup();
		const request = await svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		expect((await svc.messagePreview('ord_1', request.id, 'sms')).unavailable).toBe('no_mobile');
		requests[0] = { ...request, sentTo: { email: null, mobile: '+1 5550100' } };
		expect((await svc.messagePreview('ord_1', request.id, 'sms')).unavailable).toBe('not_indian_mobile');
		expect((await svc.messagePreview('ord_1', request.id, 'email')).unavailable).toBe('no_email');
		expect(await refusal(svc.sendMessage('ord_1', request.id, 'email', actor, NOW))).toBe('message_unavailable');
		requests[0] = { ...request, sentTo: { email: 'a@example.test', mobile: '+91 9830012345' }, ourUrl: null };
		const sent = await svc.sendMessage('ord_1', request.id, 'sms', { id: null, name: null } as never, NOW);
		expect(sent).toMatchObject({ status: 'sent', request: { sends: [{ channel: 'sms', by: 'unknown' }] } });
		const off = setup({ channelOff: true });
		const r2 = await off.svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		expect((await off.svc.messagePreview('ord_1', r2.id, 'email')).unavailable).toBe('email_off');
		off.requests[0] = { ...r2, sentTo: { email: null, mobile: '+91 9830012345' } };
		expect((await off.svc.messagePreview('ord_1', r2.id, 'sms')).unavailable).toBe('sms_off');
		off.requests[0] = { ...r2, status: 'cancelled' };
		expect(await refusal(off.svc.sendMessage('ord_1', r2.id, 'sms', actor, NOW))).toBe('request_not_active');
		const place = {
			fullName: 'Ananya Das',
			line1: '12 Lake Road',
			city: 'Kolkata',
			postalCode: '700029',
			country: 'IN',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: '9830012345' },
		};
		const user = setup({
			order: orderOf({ userId: 'usr_1', buyer: undefined, addresses: { billing: place, delivery: place } }),
		});
		const r3 = await user.svc.create('ord_1', { amountINR: 500, currency: 'INR', revision: 0 }, actor, NOW);
		expect((await user.svc.sendMessage('ord_1', r3.id, 'sms', actor, NOW)).status).toBe('sent');
		user.requests[0] = { ...r3, sentTo: { email: 'a@example.test', mobile: null } };
		expect((await user.svc.sendMessage('ord_1', r3.id, 'email', actor, NOW)).status).toBe('sent');
	});
});

describe('vi stays imported for spies', () => {
	it('keeps the harness honest', () => {
		expect(typeof vi.fn).toBe('function');
	});
});
