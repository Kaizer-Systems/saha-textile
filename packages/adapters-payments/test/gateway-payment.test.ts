import { PaymentGatewayError, type CreatePaymentInput } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import {
	RETURN_URL,
	TEST_ACCESS_CODE,
	TEST_WORKING_KEY,
	callbackForm,
	decryptForTest,
	encryptForTest,
	hostedResponse,
	testGateway,
} from './support';

const input = (overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput => ({
	attemptId: 'attempt-1',
	amountMinor: 149_900,
	currency: 'INR',
	returnUrl: RETURN_URL,
	...overrides,
});

describe('createPayment', () => {
	it('builds the encrypted form the billing page expects', async () => {
		const intent = await testGateway().createPayment(input());
		if (intent.handoff.kind !== 'form-post') throw new Error('expected a form post');

		expect(intent.attemptId).toBe('attempt-1');
		expect(intent.handoff.url).toBe(
			'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction',
		);
		expect(Object.keys(intent.handoff.fields).sort()).toEqual(['access_code', 'encRequest']);
		expect(intent.handoff.fields.access_code).toBe(TEST_ACCESS_CODE);
		expect(decryptForTest(intent.handoff.fields.encRequest!)).toBe(
			`merchant_id=123456&order_id=attempt-1&currency=INR&amount=1499.00&redirect_url=${RETURN_URL}&cancel_url=${RETURN_URL}&language=EN&`,
		);
	});

	it('keeps an audit record with no credential in it', async () => {
		const { auditRecord } = await testGateway().createPayment(input());
		expect(auditRecord).toEqual({
			order_id: 'attempt-1',
			currency: 'INR',
			amount: '1499.00',
			redirect_url: RETURN_URL,
			cancel_url: RETURN_URL,
			language: 'EN',
		});
		expect(JSON.stringify(auditRecord)).not.toContain(TEST_WORKING_KEY);
	});

	it('accepts the registered address as an explicit cancel address', async () => {
		await expect(testGateway().createPayment(input({ cancelUrl: RETURN_URL }))).resolves.toBeDefined();
	});

	it.each([
		['an order id that adds a field', { attemptId: 'a&amount=1.00' }],
		['an order id with a slash', { attemptId: 'a/1' }],
		['an order id with an underscore', { attemptId: 'a_1' }],
		['an order id over 30 characters', { attemptId: 'a'.repeat(31) }],
		['an empty order id', { attemptId: '' }],
		['a zero amount', { amountMinor: 0 }],
		['a negative amount', { amountMinor: -100 }],
		['a fractional amount', { amountMinor: 1499.5 }],
		['an amount too large for the gateway', { amountMinor: 1_000_000_000_000 }],
		['a foreign currency', { currency: 'USD' }],
		['another return address', { returnUrl: 'https://attacker.example.test/payments/return' }],
		['another cancel address', { cancelUrl: 'https://attacker.example.test/payments/return' }],
	])('refuses %s', async (_label, overrides) => {
		const refused = testGateway().createPayment(input(overrides));
		await expect(refused).rejects.toBeInstanceOf(PaymentGatewayError);
		await expect(refused).rejects.toMatchObject({ failure: 'invalid-request' });
	});
});

describe('verifyCallback', () => {
	it('reads a successful return as a claim of payment', async () => {
		const report = await testGateway().verifyCallback(callbackForm(hostedResponse()));
		expect(report).toMatchObject({
			gateway: 'ccavenue',
			attemptId: 'attempt-1',
			gatewayReference: '311008298114',
			state: 'authorized',
			amountMinor: 149_900,
			currency: 'INR',
			failureReason: null,
		});
	});

	it('ignores other posted fields, and works when orderNo is absent', async () => {
		const { encResp } = callbackForm(hostedResponse());
		await expect(testGateway().verifyCallback({ encResp, crossSellUrl: 'x' })).resolves.toMatchObject({
			attemptId: 'attempt-1',
		});
	});

	it('reads the printed `Amount` spelling', async () => {
		const plain = hostedResponse().replace('&amount=1499.00', '&Amount=1499.00');
		await expect(testGateway().verifyCallback(callbackForm(plain))).resolves.toMatchObject({
			amountMinor: 149_900,
		});
	});

	it('reports a failed payment with its reason', async () => {
		const plain = hostedResponse({ order_status: 'Failure', failure_message: 'Declined by bank' });
		await expect(testGateway().verifyCallback(callbackForm(plain))).resolves.toMatchObject({
			state: 'failed',
			failureReason: 'Declined by bank',
		});
	});

	it('reports a return with no CCAvenue reference', async () => {
		const plain = hostedResponse({ order_status: 'Aborted', tracking_id: 'null' });
		await expect(testGateway().verifyCallback(callbackForm(plain))).resolves.toMatchObject({
			state: 'cancelled',
			gatewayReference: null,
		});
	});

	it('fails closed on an order status it does not know', async () => {
		const plain = hostedResponse({ order_status: 'Successful' });
		await expect(testGateway().verifyCallback(callbackForm(plain))).resolves.toMatchObject({ state: 'review' });
	});

	it('keeps customer details out of the audit record', async () => {
		const { auditRecord } = await testGateway().verifyCallback(callbackForm(hostedResponse()));
		expect(auditRecord).toMatchObject({ order_id: 'attempt-1', amount: '1499.00', order_status: 'Success' });
		const kept = JSON.stringify(auditRecord);
		expect(kept).not.toContain('customer@example.test');
		expect(kept).not.toContain('9000000000');
		expect(kept).not.toContain('Test Road');
		expect(kept).not.toContain('Test Customer');
	});

	it('gives the same answer twice for a replayed form', async () => {
		const form = callbackForm(hostedResponse());
		const gateway = testGateway();
		await expect(gateway.verifyCallback(form)).resolves.toEqual(await gateway.verifyCallback(form));
	});

	const unreadable = [
		['a payload that is not a form', 'encResp=abc'],
		['no ciphertext', { orderNo: 'attempt-1' }],
		['oversized ciphertext', { encResp: 'a'.repeat(65_537) }],
		['ciphertext that is not hex', { encResp: 'not hex at all' }],
		['ciphertext from another key', { encResp: encryptForTest(hostedResponse(), '0'.repeat(32)) }],
		['a clear order number that disagrees', callbackForm(hostedResponse(), 'attempt-2')],
		['a status smuggled in as a second field', callbackForm(`${hostedResponse()}&order_status=Success`)],
		['an amount smuggled in as a second field', callbackForm(`${hostedResponse()}&amount=1.00`)],
		['both spellings of the amount', callbackForm(`${hostedResponse()}&Amount=1.00`)],
		['no amount', callbackForm(hostedResponse().replace('&amount=1499.00', ''))],
		['an unusable amount', callbackForm(hostedResponse({ amount: '14,99.00' }))],
		['a malformed order id', callbackForm(hostedResponse({ order_id: 'a b' }), 'a b')],
		['a malformed currency', callbackForm(hostedResponse({ currency: 'inr' }))],
		['a malformed reference', callbackForm(hostedResponse({ tracking_id: 'abc' }))],
		['plaintext with no fields', callbackForm('nothing useful')],
	] as const;

	it.each(unreadable)('refuses %s with the same single error', async (_label, payload) => {
		const refused = testGateway().verifyCallback(payload);
		await expect(refused).rejects.toBeInstanceOf(PaymentGatewayError);
		await expect(refused).rejects.toMatchObject({
			failure: 'unreadable',
			message: 'CCAvenue callback could not be read',
			gatewayCode: null,
		});
	});
});
