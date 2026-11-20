import { describe, expect, it, vi } from 'vitest';

import {
	ccavenueMerchantReference,
	parsePayPalConfig,
	PayPalPaymentGateway,
	type PayPalOrdersApi,
	type PayPalPaymentsApi,
} from '../src/index';
import { generateQuickInvoice, quickInvoiceStatus } from '../src/ccavenue/ccavenue-quick-invoice';

describe('PayPal settings (PAYPAL_ENV, owner 2026-11-20)', () => {
	const keys = { clientId: 'id', clientSecret: 'secret' };

	it('runs sandbox outside production and live only in production', () => {
		expect(parsePayPalConfig({ ...keys, env: 'sandbox', deployEnv: 'staging' })).toMatchObject({
			configured: true,
			environment: 'sandbox',
			apiBase: 'https://api-m.sandbox.paypal.com',
		});
		expect(parsePayPalConfig({ ...keys, env: 'live', deployEnv: 'production' })).toMatchObject({
			configured: true,
			apiBase: 'https://api-m.paypal.com',
		});
	});

	it('fails closed on a mismatch or a gap', () => {
		expect(parsePayPalConfig({ ...keys, env: 'live', deployEnv: 'staging' })).toEqual({
			configured: false,
			reason: 'liveOutsideProduction',
		});
		expect(parsePayPalConfig({ ...keys, env: 'live' })).toEqual({
			configured: false,
			reason: 'liveOutsideProduction',
		});
		expect(parsePayPalConfig({ ...keys, env: 'sandbox', deployEnv: 'production' })).toEqual({
			configured: false,
			reason: 'sandboxInProduction',
		});
		expect(parsePayPalConfig({ ...keys })).toEqual({ configured: false, reason: 'envMissing' });
		expect(parsePayPalConfig({ ...keys, env: 'test' })).toEqual({ configured: false, reason: 'envUnknown' });
		expect(parsePayPalConfig({ clientId: 'id', env: 'sandbox' })).toEqual({
			configured: false,
			reason: 'keysMissing',
		});
	});
});

const config = parsePayPalConfig({ clientId: 'id', clientSecret: 'secret', env: 'sandbox', webhookId: 'wh_1' });
if (!config.configured) throw new Error('test config');

const capturedOrder = {
	id: 'PPORDER1',
	status: 'COMPLETED',
	purchaseUnits: [
		{
			customId: 'att_1',
			amount: { currencyCode: 'USD', value: '121.00' },
			payments: {
				captures: [
					{
						id: 'CAP1',
						status: 'COMPLETED',
						amount: { currencyCode: 'USD', value: '121.00' },
						sellerReceivableBreakdown: {
							grossAmount: { currencyCode: 'USD', value: '121.00' },
							paypalFee: { currencyCode: 'USD', value: '5.62' },
							netAmount: { currencyCode: 'USD', value: '115.38' },
							receivableAmount: { currencyCode: 'INR', value: '10450.12' },
							exchangeRate: { sourceCurrency: 'USD', targetCurrency: 'INR', value: '90.5715' },
						},
					},
				],
			},
		},
	],
};

const gateway = (orders: Record<string, unknown>, payments: Record<string, unknown> = {}, fetchImpl?: typeof fetch) =>
	new PayPalPaymentGateway({
		config,
		orders: orders as unknown as PayPalOrdersApi,
		payments: payments as unknown as PayPalPaymentsApi,
		fetch: fetchImpl,
	});

describe('PayPal payments (Orders v2)', () => {
	it('creates an order to approve on PayPal, with our attempt id', async () => {
		const createOrder = vi.fn(async (_args: unknown) => ({
			result: {
				id: 'PPORDER1',
				links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER1' }],
			},
		}));
		const intent = await gateway({ createOrder }).createPayment({
			attemptId: 'att_1',
			amountMinor: 12100,
			currency: 'USD',
			returnUrl: 'https://shop/pay/return',
		});
		expect(intent.handoff).toEqual({
			kind: 'redirect',
			url: 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER1',
		});
		const args = createOrder.mock.calls[0]?.[0] as unknown as {
			body: { purchaseUnits: Array<{ customId: string; amount: { value: string } }> };
			paypalRequestId: string;
		};
		expect(args.paypalRequestId).toBe('att_1');
		expect(args.body.purchaseUnits[0]).toMatchObject({ customId: 'att_1', amount: { value: '121.00' } });
	});

	it('captures an approved order and keeps PayPal’s own rate, fee and rupees', async () => {
		const getOrder = vi.fn(async (_args: unknown) => ({
			result: { id: 'PPORDER1', status: 'APPROVED', purchaseUnits: [{ customId: 'att_1' }] },
		}));
		const captureOrder = vi.fn(async (_args: unknown) => ({ result: capturedOrder }));
		const report = await gateway({ getOrder, captureOrder }).fetchPaymentStatus({
			attemptId: 'att_1',
			gatewayReference: 'PPORDER1',
		});
		expect(captureOrder).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'PPORDER1', paypalRequestId: 'att_1-capture' }),
		);
		expect(report).toMatchObject({
			state: 'captured',
			gatewayReference: 'CAP1',
			amountMinor: 12100,
			currency: 'USD',
			receivable: {
				fee: 5.62,
				receivableINR: 10450.12,
				exchangeRate: { sourceCurrency: 'USD', targetCurrency: 'INR', value: 90.5715 },
			},
		});
	});

	it('leaves an order the buyer has not approved as pending', async () => {
		const getOrder = vi.fn(async (_args: unknown) => ({
			result: {
				id: 'PPORDER1',
				status: 'PAYER_ACTION_REQUIRED',
				purchaseUnits: [{ customId: 'att_1', amount: { currencyCode: 'USD', value: '121.00' } }],
			},
		}));
		const captureOrder = vi.fn();
		const report = await gateway({ getOrder, captureOrder }).fetchPaymentStatus({
			attemptId: 'att_1',
			gatewayReference: 'PPORDER1',
		});
		expect(captureOrder).not.toHaveBeenCalled();
		expect(report?.state).toBe('pending');
	});

	it('refunds with our reference as PayPal’s request id', async () => {
		const refundCapturedPayment = vi.fn(async (_args: unknown) => ({
			result: { id: 'REF1', status: 'COMPLETED' },
		}));
		const result = await gateway({}, { refundCapturedPayment }).refundPayment({
			gatewayReference: 'CAP1',
			refundReference: 'RF-1',
			amountMinor: 5000,
			currency: 'USD',
		});
		expect(result.outcome).toBe('accepted');
		expect(refundCapturedPayment).toHaveBeenCalledWith(
			expect.objectContaining({ captureId: 'CAP1', paypalRequestId: 'RF-1' }),
		);
	});

	it('reads the return from PayPal as a claim only', async () => {
		await expect(gateway({}).verifyCallback({ attempt: 'att_1', token: 'PPORDER1' })).resolves.toMatchObject({
			state: 'pending',
			gatewayReference: 'PPORDER1',
		});
		await expect(gateway({}).verifyCallback({ attempt: 'att 1', token: 'x' })).rejects.toThrow();
	});
});

describe('PayPal payment requests (Invoicing v2)', () => {
	it('drafts, sends and returns the payer’s link', async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			const path = String(url).replace(config.apiBase, '');
			calls.push(`${init?.method} ${path}`);
			const json = (body: unknown) =>
				new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
			if (path === '/v1/oauth2/token') return json({ access_token: 'tok', expires_in: 3600 });
			if (path === '/v2/invoicing/invoices' && init?.method === 'POST') return json({ id: 'INV2-1' });
			if (path.endsWith('/send')) return json({});
			return json({
				detail: { metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#INV2-1' } },
				status: 'SENT',
			});
		}) as unknown as typeof fetch;
		const created = await gateway({}, {}, fetchImpl).createPaymentRequest({
			reference: 'ST-48213-90761/Q1',
			orderNumber: 'ST-48213-90761',
			currency: 'GBP',
			amountMinor: 3444,
			customer: {
				name: 'Jane',
				email: 'jane@example.test',
				mobile: { countryCallingCode: '44', number: '7700900123' },
			},
			validDays: 7,
			emailSubject: 'Pay for your order',
			smsText: null,
			items: [{ name: 'Saree', quantity: 1, unitAmountMinor: 3444 }],
		});
		expect(created).toMatchObject({
			gatewayRequestId: 'INV2-1',
			url: 'https://www.sandbox.paypal.com/invoice/p/#INV2-1',
		});
		expect(calls).toEqual([
			'POST /v1/oauth2/token',
			'POST /v2/invoicing/invoices',
			'POST /v2/invoicing/invoices/INV2-1/send',
			'GET /v2/invoicing/invoices/INV2-1',
		]);
	});

	it('refuses an invoice with no email (PayPal sends no SMS)', async () => {
		await expect(
			gateway({}).createPaymentRequest({
				reference: 'r',
				orderNumber: 'o',
				currency: 'USD',
				amountMinor: 100,
				customer: { name: 'A', email: null, mobile: null },
				validDays: 7,
				emailSubject: 's',
				smsText: null,
				items: [],
			}),
		).rejects.toThrow('email');
	});
});

describe('CCAvenue quick invoice (HDFC API § 13, § 15)', () => {
	it('keeps our reference within CCAvenue’s characters', () => {
		expect(ccavenueMerchantReference('ST-48213-90761/Q1')).toBe('ST-48213-90761-Q1');
	});

	it('sends by email and SMS to an Indian mobile and returns the short link', async () => {
		const call = vi.fn(async (_args: unknown) => ({
			kind: 'found' as const,
			body: { invoice_status: '0', invoice_id: '9876543', tiny_url: 'http://payit.cc/I5122841' },
		}));
		const created = await generateQuickInvoice({ call } as never, {
			reference: 'ST-48213-90761/Q1',
			orderNumber: 'ST-48213-90761',
			currency: 'INR',
			amountMinor: 2770000,
			customer: {
				name: 'Ananya Sen',
				email: 'a@example.test',
				mobile: { countryCallingCode: '91', number: '9830012345' },
			},
			validDays: 7,
			emailSubject: 'Pay for your order',
			smsText: 'Pay your bill',
			items: [],
		});
		expect(created).toEqual({
			gatewayRequestId: '9876543',
			url: 'https://payit.cc/I5122841',
			auditRecord: expect.any(Object),
		});
		expect(call).toHaveBeenCalledWith(
			'generateQuickInvoice',
			expect.objectContaining({
				amount: '27700.00',
				bill_delivery_type: 'BOTH',
				merchant_reference_no: 'ST-48213-90761-Q1',
				valid_type: 'days',
			}),
		);
	});

	it('reads a paid quick invoice from the invoice lookup', async () => {
		const call = vi.fn(async (_args: unknown) => ({
			kind: 'found' as const,
			body: {
				invoice_List: [
					{
						order_status: 'Shipped',
						reference_no: '313012345678',
						order_amt: '27700.00',
						order_date_time: '2026-11-20 10:00:00',
					},
				],
			},
		}));
		const status = await quickInvoiceStatus({ call } as never, '9876543');
		expect(status).toMatchObject({
			state: 'paid',
			payments: [{ gatewayReference: '313012345678', amountMinor: 2770000 }],
		});
	});
});

describe('PayPal webhook check', () => {
	const headers = {
		'paypal-auth-algo': 'SHA256withRSA',
		'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
		'paypal-transmission-id': 't-1',
		'paypal-transmission-sig': 'sig',
		'paypal-transmission-time': '2026-11-20T10:00:00Z',
	};

	function gateway(answer: string) {
		const bodies: string[] = [];
		const fetchFn = vi.fn(async (url: string, init?: { body?: string }) => {
			if (url.endsWith('/v1/oauth2/token'))
				return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
			bodies.push(init?.body ?? '');
			return new Response(JSON.stringify({ verification_status: answer }), { status: 200 });
		});
		const gw = new PayPalPaymentGateway({
			config: config as Extract<typeof config, { configured: true }>,
			fetch: fetchFn as unknown as typeof fetch,
			orders: {} as PayPalOrdersApi,
			payments: {} as PayPalPaymentsApi,
		});
		return { gw, bodies };
	}

	it('sends PayPal its own bytes, unchanged, beside the webhook id', async () => {
		const raw = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"121.00"}}}';
		const { gw, bodies } = gateway('SUCCESS');
		expect(await gw.verifyWebhook(headers, raw)).toBe(true);
		expect(bodies[0]).toContain(`"webhook_event":${raw}}`);
		expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ webhook_id: 'wh_1', transmission_id: 't-1' });
	});

	it('says no to a failed check, a missing header or a body that is not JSON', async () => {
		expect(await gateway('FAILURE').gw.verifyWebhook(headers, '{}')).toBe(false);
		expect(await gateway('SUCCESS').gw.verifyWebhook({ ...headers, 'paypal-transmission-sig': undefined }, '{}')).toBe(false);
		expect(await gateway('SUCCESS').gw.verifyWebhook(headers, 'not json')).toBe(false);
	});
});
