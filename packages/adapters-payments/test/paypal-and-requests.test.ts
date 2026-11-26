import type { CreatePaymentRequestInput } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import {
	ccavenueMerchantReference,
	parsePayPalConfig,
	PayPalPaymentGateway,
	type PayPalOrdersApi,
	type PayPalPaymentsApi,
} from '../src/index';
import { generateQuickInvoice, quickInvoiceStatus } from '../src/ccavenue/ccavenue-quick-invoice';
import { answering, apiFailure, apiSuccess, decryptForTest, testGateway } from './support';

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
		expect(parsePayPalConfig({ ...keys, env: ' SANDBOX ', webhookId: 'wh_test' })).toMatchObject({
			configured: true,
			environment: 'sandbox',
			webhookId: 'wh_test',
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
		expect(parsePayPalConfig({ clientSecret: 'secret', env: 'sandbox' })).toEqual({
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

	it.each([null, { attempt: 1, token: 2 }, { attempt: 'att_1', token: 'x' }])(
		'rejects an invalid return %j',
		async (payload) => {
			await expect(gateway({}).verifyCallback(payload)).rejects.toMatchObject({ failure: 'unreadable' });
		},
	);

	it('uses the explicit cancellation URL and accepts the approve relation', async () => {
		const createOrder = vi.fn(async () => ({
			result: {
				id: 'PPORDER1',
				links: [{ rel: 'self' }, { rel: 'approve', href: 'https://shop.test/approve' }],
			},
		}));
		await expect(
			gateway({ createOrder }).createPayment({
				attemptId: 'att_1',
				amountMinor: 100,
				currency: 'USD',
				returnUrl: 'https://shop.test/return',
				cancelUrl: 'https://shop.test/cancel',
			}),
		).resolves.toMatchObject({ handoff: { kind: 'redirect', url: 'https://shop.test/approve' } });
		expect(createOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({
					paymentSource: {
						paypal: {
							experienceContext: expect.objectContaining({ cancelUrl: 'https://shop.test/cancel' }),
						},
					},
				}),
			}),
		);
	});

	it.each([{ id: 'PPORDER1' }, { links: [{ rel: 'approve', href: 'https://shop.test/approve' }] }])(
		'rejects an order missing its id or approval link %j',
		async (result) => {
			await expect(
				gateway({ createOrder: vi.fn().mockResolvedValue({ result }) }).createPayment({
					attemptId: 'att_1',
					amountMinor: 100,
					currency: 'USD',
					returnUrl: 'https://shop.test/return',
				}),
			).rejects.toMatchObject({ failure: 'unreadable' });
		},
	);

	const statusQuery = { attemptId: 'att_1', gatewayReference: 'PPORDER1' };

	it('does not query without a reference and reports a voided order without purchase units', async () => {
		const getOrder = vi.fn().mockResolvedValue({ result: { status: 'VOIDED' } });
		const payments = gateway({ getOrder });
		await expect(payments.fetchPaymentStatus({ attemptId: 'att_1' })).resolves.toBeNull();
		expect(getOrder).not.toHaveBeenCalled();
		await expect(payments.fetchPaymentStatus(statusQuery)).resolves.toMatchObject({
			...statusQuery,
			state: 'cancelled',
			amountMinor: 0,
			currency: '',
		});
		getOrder.mockResolvedValueOnce({ result: { purchaseUnits: [{}] } });
		await expect(payments.fetchPaymentStatus(statusQuery)).resolves.toMatchObject({
			state: 'pending',
			auditRecord: { paypal_order_id: 'PPORDER1', status: '' },
		});
		getOrder.mockResolvedValueOnce({ result: { purchaseUnits: [{ payments: {} }] } });
		await expect(payments.fetchPaymentStatus(statusQuery)).resolves.toMatchObject({ state: 'pending' });
	});

	it.each([
		['PENDING', 'pending'],
		['DECLINED', 'failed'],
		['FAILED', 'failed'],
		['REFUNDED', 'refunded'],
		['PARTIALLY_REFUNDED', 'refunded'],
		[undefined, 'review'],
	])('maps PayPal capture status %s to %s', async (status, state) => {
		const getOrder = vi.fn().mockResolvedValue({
			result: {
				purchaseUnits: [
					{ payments: { captures: [{ status, statusDetails: { reason: 'PROCESSOR_DECLINED' } }] } },
				],
			},
		});
		await expect(gateway({ getOrder }).fetchPaymentStatus(statusQuery)).resolves.toMatchObject({
			...statusQuery,
			state,
			amountMinor: 0,
			currency: '',
			failureReason: 'PROCESSOR_DECLINED',
			auditRecord: { status: status ?? '', capture_id: '' },
		});
	});

	it.each([
		[{}, null],
		[
			{ exchangeRate: { value: '90' }, receivableAmount: { currencyCode: 'EUR', value: '10' } },
			{ sourceCurrency: 'USD', targetCurrency: 'INR', value: 90 },
		],
	])(
		'reads incomplete receivable details without inventing fee, net or INR amounts',
		async (details, exchangeRate) => {
			const getOrder = vi.fn().mockResolvedValue({
				result: {
					purchaseUnits: [
						{
							payments: {
								captures: [
									{
										sellerReceivableBreakdown: {
											grossAmount: { currencyCode: 'USD', value: '12.00' },
											...details,
										},
									},
								],
							},
						},
					],
				},
			});
			await expect(gateway({ getOrder }).fetchPaymentStatus(statusQuery)).resolves.toMatchObject({
				receivable: {
					grossAmount: 12,
					grossCurrency: 'USD',
					fee: null,
					net: null,
					receivableINR: null,
					exchangeRate,
				},
			});
		},
	);

	it.each([
		[404, 'rejected'],
		[503, 'unavailable'],
		[undefined, 'unavailable'],
	])('classifies SDK failures (HTTP %s)', async (statusCode, failure) => {
		const getOrder = vi.fn().mockRejectedValue({ statusCode });
		await expect(gateway({ getOrder }).fetchPaymentStatus(statusQuery)).rejects.toMatchObject({ failure });
	});

	const refund = { gatewayReference: 'CAP1', refundReference: 'RF-1', amountMinor: 100, currency: 'USD' };

	it.each([400, 422])('reports HTTP %s as a refused refund', async (statusCode) => {
		const refundCapturedPayment = vi.fn().mockRejectedValue({ statusCode });
		await expect(gateway({}, { refundCapturedPayment }).refundPayment(refund)).resolves.toMatchObject({
			outcome: 'refused',
			refusalCode: String(statusCode),
			refundReference: 'RF-1',
		});
	});

	it('distinguishes a refund with no returned metadata from a network failure', async () => {
		const refundCapturedPayment = vi
			.fn()
			.mockResolvedValueOnce({ result: {} })
			.mockRejectedValueOnce(new Error('offline'));
		const payments = gateway({}, { refundCapturedPayment });
		await expect(payments.refundPayment(refund)).resolves.toMatchObject({
			outcome: 'accepted',
			auditRecord: { refund_id: '', status: '' },
		});
		await expect(payments.refundPayment(refund)).rejects.toMatchObject({ failure: 'unavailable' });
		await expect(payments.fetchRefunds('CAP1')).resolves.toEqual([]);
	});
});

describe('PayPal payment requests (Invoicing v2)', () => {
	const input: CreatePaymentRequestInput = {
		reference: 'ST-48213-90761/Q1',
		orderNumber: 'ST-48213-90761',
		currency: 'GBP',
		amountMinor: 3444,
		customer: { name: 'Jane', email: 'jane@example.test', mobile: null },
		validDays: 7,
		emailSubject: 'Pay for your order',
		smsText: null,
		items: [{ name: 'Saree', quantity: 1, unitAmountMinor: 3444 }],
	};

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
		const created = await gateway({}, {}, fetchImpl).createPaymentRequest(input);
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
				...input,
				customer: { ...input.customer, email: null },
			}),
		).rejects.toThrow('email');
	});

	it.each([{}, { detail: {} }, { detail: { metadata: {} } }])(
		'requires the payer link in the sent invoice %j',
		async (invoice) => {
			const fetch = vi
				.fn<typeof globalThis.fetch>()
				.mockResolvedValueOnce(Response.json({ access_token: 'test' }))
				.mockResolvedValueOnce(Response.json({ id: 'INV2-1' }))
				.mockResolvedValueOnce(new Response(null, { status: 204 }))
				.mockResolvedValueOnce(Response.json(invoice));
			await expect(gateway({}, {}, fetch).createPaymentRequest(input)).rejects.toThrow('invoice link');
			expect(fetch).toHaveBeenCalledTimes(4);
		},
	);

	it('does not send an invoice when the draft has no id', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: 'test' }))
			.mockResolvedValueOnce(Response.json({}));
		await expect(gateway({}, {}, fetch).createPaymentRequest(input)).rejects.toThrow('invoice answer');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('reads settled payments, ignores entries without ids, and accepts an empty cancel response', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: 'test', expires_in: 15 }))
			.mockResolvedValueOnce(
				Response.json({
					status: 'PARTIALLY_PAID',
					payments: {
						transactions: [
							{
								payment_id: 'PAY1',
								amount: { value: '34.44', currency_code: 'GBP' },
								payment_date: '2026-11-20',
								method: 'PAYPAL',
							},
							{ payment_id: 'PAY2' },
							{ amount: { value: '99.99' } },
						],
					},
				}),
			)
			.mockResolvedValueOnce(Response.json({ access_token: 'test-next' }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(Response.json({ payments: {} }));
		const invoices = gateway({}, {}, fetch);
		const path = `${config.apiBase}/v2/invoicing/invoices/INV%2F1`;
		await expect(invoices.fetchPaymentRequestStatus('INV/1')).resolves.toMatchObject({
			state: 'partlyPaid',
			payments: [
				{ gatewayReference: 'PAY1', amountMinor: 3444, currency: 'GBP', at: '2026-11-20', method: 'PAYPAL' },
				{ gatewayReference: 'PAY2', amountMinor: 0, currency: '', at: '', method: null },
			],
		});
		await expect(invoices.cancelPaymentRequest('INV/1')).resolves.toBeUndefined();
		expect(fetch).toHaveBeenNthCalledWith(
			4,
			`${path}/cancel`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ authorization: 'Bearer test-next' }),
				body: JSON.stringify({ send_to_recipient: false, send_to_invoicer: false }),
			}),
		);
		await expect(invoices.fetchPaymentRequestStatus('INV/1')).resolves.toMatchObject({
			state: 'unknown',
			payments: [],
			auditRecord: { invoice_id: 'INV/1', status: '' },
		});
	});

	it.each([
		[401, 'rejected'],
		[503, 'unavailable'],
	])('classifies an invoice REST response with HTTP %s', async (status, failure) => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: 'test' }))
			.mockResolvedValueOnce(new Response(null, { status }));
		await expect(gateway({}, {}, fetch).fetchPaymentRequestStatus('INV1')).rejects.toMatchObject({ failure });
	});

	it('distinguishes a failed invoice request from an unreadable response', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: 'test' }))
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(new Response('<html>'));
		const invoices = gateway({}, {}, fetch);
		await expect(invoices.fetchPaymentRequestStatus('INV1')).rejects.toMatchObject({ failure: 'unavailable' });
		await expect(invoices.fetchPaymentRequestStatus('INV1')).rejects.toMatchObject({ failure: 'unreadable' });
	});

	it('rejects sign-in failures without attempting the invoice request', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(Response.json({}));
		const invoices = gateway({}, {}, fetch);
		await expect(invoices.fetchPaymentRequestStatus('INV1')).rejects.toMatchObject({ failure: 'unavailable' });
		await expect(invoices.fetchPaymentRequestStatus('INV1')).rejects.toMatchObject({ failure: 'rejected' });
		await expect(invoices.fetchPaymentRequestStatus('INV1')).rejects.toMatchObject({ failure: 'unreadable' });
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(3).fill(`${config.apiBase}/v1/oauth2/token`));
	});
});

describe('CCAvenue quick invoice (HDFC API § 13, § 15)', () => {
	const base: CreatePaymentRequestInput = {
		reference: 'ST-48213-90761/Q1',
		orderNumber: 'ST-48213-90761',
		currency: 'INR',
		amountMinor: 234_500,
		customer: { name: 'Example customer', email: 'customer@example.test', mobile: null },
		validDays: 7,
		emailSubject: 'Pay for your order',
		smsText: 'Pay your bill',
		items: [],
	};

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

	it('sends only by email when the number is foreign, and encodes the merchant command', async () => {
		const { fetch, calls } = answering(apiSuccess({ invoice_id: '9876543', tiny_url: 'https://payit.cc/request' }));
		const gateway = testGateway(fetch);
		await expect(
			gateway.createPaymentRequest({
				...base,
				customer: {
					...base.customer,
					name: 'A'.repeat(72),
					mobile: { countryCallingCode: '44', number: '7700900123' },
				},
			}),
		).resolves.toMatchObject({ gatewayRequestId: '9876543', url: 'https://payit.cc/request' });
		const form = calls[0]?.form;
		expect(form?.get('command')).toBe('generateQuickInvoice');
		expect(form?.get('version')).toBe('1.2');
		const body: unknown = JSON.parse(decryptForTest(form?.get('enc_request') ?? ''));
		expect(body).toMatchObject({
			bill_delivery_type: 'EMAIL',
			customer_name: 'A'.repeat(60),
			customer_mobile_no: '',
		});
		expect(body).not.toHaveProperty('sms_content');
	});

	it('sends by SMS alone and refuses an invalid mobile or non-INR request before calling the provider', async () => {
		const { fetch, calls } = answering(apiSuccess({ invoice_id: '9876543', tiny_url: 'https://payit.cc/request' }));
		const gateway = testGateway(fetch);
		const mobile = { countryCallingCode: '91', number: '9830012345' };
		await expect(gateway.createPaymentRequest({ ...base, currency: 'GBP' })).rejects.toThrow('rupees');
		await expect(
			gateway.createPaymentRequest({
				...base,
				customer: { ...base.customer, email: null, mobile: { ...mobile, number: '1111111111' } },
			}),
		).rejects.toThrow('email or an Indian mobile');
		expect(calls).toHaveLength(0);
		await gateway.createPaymentRequest({ ...base, customer: { ...base.customer, email: null, mobile } });
		const body: unknown = JSON.parse(decryptForTest(calls[0]?.form.get('enc_request') ?? ''));
		expect(body).toMatchObject({ bill_delivery_type: 'SMS', customer_email_id: '', sms_content: base.smsText });
	});

	it('treats a missing remote invoice as unknown and lets a cancelled local request expire', async () => {
		const { fetch, calls } = answering(apiFailure('No invoice', '51419'));
		const gateway = testGateway(fetch);
		await expect(gateway.fetchPaymentRequestStatus('9876543')).resolves.toMatchObject({
			state: 'unknown',
			payments: [],
		});
		expect(calls[0]?.form.get('command')).toBe('invoiceList');
		await expect(gateway.fetchPaymentRequestStatus('invalid')).rejects.toThrow('not numeric');
		await expect(gateway.cancelPaymentRequest('9876543')).resolves.toBeUndefined();
		expect(calls).toHaveLength(1);
	});

	it('preserves a provider rejection code when creating an invoice', async () => {
		const { fetch } = answering(apiFailure('No invoice', '51419'));
		await expect(testGateway(fetch).createPaymentRequest(base)).rejects.toMatchObject({
			failure: 'rejected',
			gatewayCode: '51419',
		});
	});

	it.each([
		[{ tiny_url: 'https://payit.cc/request' }, null],
		[{ invoice_id: '9876543' }, null],
		[
			{ invoice_id: '9876543', tiny_url: 'https://payit.cc/request', invoice_status: '1', error_code: '51499' },
			'51499',
		],
	])('rejects a refused or incomplete invoice response %j', async (body, gatewayCode) => {
		const { fetch } = answering(apiSuccess(body));
		await expect(testGateway(fetch).createPaymentRequest({ ...base, smsText: null })).rejects.toMatchObject({
			failure: 'rejected',
			gatewayCode,
		});
	});

	it('keeps provider order details and excludes unpaid rows and rows without a payment reference', async () => {
		const { fetch } = answering(
			apiSuccess({
				order_Status_List: [
					{
						order_status: 'Success',
						reference_no: '1',
						order_amt: '49.95',
						order_currncy: 'INR',
						order_option_type: 'OPTCRDC',
					},
					{ order_status: 'Delivered', reference_no: '2', order_curr: 'INR' },
					{ order_status: 'Successful' },
					{ reference_no: '3' },
				],
			}),
		);
		await expect(testGateway(fetch).fetchPaymentRequestStatus('9876543')).resolves.toEqual({
			gatewayRequestId: '9876543',
			state: 'paid',
			payments: [
				{ gatewayReference: '1', amountMinor: 4995, currency: 'INR', at: '', method: 'OPTCRDC' },
				{ gatewayReference: '2', amountMinor: 0, currency: 'INR', at: '', method: null },
			],
			auditRecord: { invoice_id: '9876543', records: '4' },
		});
	});

	it('reports a known invoice with no payments as open', async () => {
		const { fetch } = answering(apiSuccess({}));
		await expect(testGateway(fetch).fetchPaymentRequestStatus('9876543')).resolves.toMatchObject({
			state: 'open',
			payments: [],
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
		expect(
			await gateway('SUCCESS').gw.verifyWebhook({ ...headers, 'paypal-transmission-sig': undefined }, '{}'),
		).toBe(false);
		expect(await gateway('SUCCESS').gw.verifyWebhook(headers, 'not json')).toBe(false);
	});

	it('does not contact PayPal when no webhook id is configured', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const gw = new PayPalPaymentGateway({ config: { ...config, webhookId: null }, fetch });
		await expect(gw.verifyWebhook(headers, '{}')).resolves.toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('uses the live API base with production configuration', async () => {
		const live = parsePayPalConfig({
			clientId: 'id',
			clientSecret: 'secret',
			env: 'live',
			deployEnv: 'production',
		});
		if (!live.configured) throw new Error('expected live test configuration');
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ access_token: 'test' }))
			.mockResolvedValueOnce(Response.json({ status: 'PAID' }));
		const gw = new PayPalPaymentGateway({ config: live, fetch });
		await expect(gw.fetchPaymentRequestStatus('INV1')).resolves.toMatchObject({ state: 'paid' });
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			'https://api-m.paypal.com/v1/oauth2/token',
			'https://api-m.paypal.com/v2/invoicing/invoices/INV1',
		]);
	});
});
