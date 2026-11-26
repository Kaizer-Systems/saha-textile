import { PaymentGatewayError, type RefundInput } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import {
	TEST_ACCESS_CODE,
	TEST_WORKING_KEY,
	answering,
	apiFailure,
	apiSuccess,
	decryptForTest,
	encryptForTest,
	statusRecord,
	testGateway,
} from './support';

const refund = (overrides: Partial<RefundInput> = {}): RefundInput => ({
	gatewayReference: '311008298114',
	refundReference: 'REFUND1',
	amountMinor: 50_000,
	currency: 'INR',
	...overrides,
});

describe('fetchPaymentStatus', () => {
	it('sends the documented Status call', async () => {
		const { fetch, calls } = answering(apiSuccess(statusRecord()));
		await testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1', gatewayReference: '311008298114' });

		const [call] = calls;
		expect(call!.url).toBe('https://apitest.ccavenue.com/apis/servlet/DoWebTrans');
		expect(call!.init).toMatchObject({
			method: 'POST',
			redirect: 'error',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expect(call!.init.signal).toBeInstanceOf(AbortSignal);
		expect(Object.fromEntries(call!.form)).toMatchObject({
			access_code: TEST_ACCESS_CODE,
			command: 'orderStatusTracker',
			request_type: 'JSON',
			response_type: 'JSON',
			version: '1.2',
		});
		expect(JSON.parse(decryptForTest(call!.form.get('enc_request')!))).toEqual({
			order_no: 'attempt-1',
			reference_no: '311008298114',
		});
		expect(String(call!.init.body)).not.toContain(TEST_WORKING_KEY);
	});

	it('can enquire by order id alone, for an attempt that never came back', async () => {
		const { fetch, calls } = answering(apiSuccess(statusRecord()));
		await testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1', gatewayReference: null });
		expect(JSON.parse(decryptForTest(calls[0]!.form.get('enc_request')!))).toEqual({ order_no: 'attempt-1' });
	});

	it('maps the record to a report', async () => {
		const { fetch } = answering(apiSuccess(statusRecord({ order_status: 'Shipped' })));
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toMatchObject({
			gateway: 'ccavenue',
			attemptId: 'attempt-1',
			gatewayReference: '311008298114',
			state: 'captured',
			amountMinor: 149_900,
			currency: 'INR',
			failureReason: null,
		});
	});

	it('reads the `order_curr` spelling from the field table', async () => {
		const record = statusRecord({ order_currncy: undefined, order_curr: 'INR' });
		const { fetch } = answering(apiSuccess(record));
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toMatchObject({
			currency: 'INR',
		});
	});

	it('accepts numeric references', async () => {
		const { fetch } = answering(apiSuccess(statusRecord({ reference_no: 311008298114 })));
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toMatchObject({
			gatewayReference: '311008298114',
		});
	});

	it('accepts null in the fields that do not decide the outcome', async () => {
		const record = statusRecord({
			error_code: null,
			status: null,
			order_fraud_status: null,
			order_bank_response: null,
		});
		const { fetch } = answering(apiSuccess(record));
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toMatchObject({
			state: 'authorized',
		});
	});

	it.each(['reference_no', 'order_no', 'order_amt', 'order_status'])(
		'stays strict about a null %s',
		async (field) => {
			const { fetch } = answering(apiSuccess(statusRecord({ [field]: null })));
			await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).rejects.toMatchObject({
				failure: 'unreadable',
			});
		},
	);

	it('gives the bank text for a failed or cancelled order', async () => {
		for (const order_status of ['Unsuccessful', 'Aborted']) {
			const record = statusRecord({ order_status, order_bank_response: 'Declined' });
			const { fetch } = answering(apiSuccess(record));
			await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toMatchObject({
				failureReason: 'Declined',
			});
		}
	});

	it('keeps customer details out of the audit record', async () => {
		const { fetch } = answering(apiSuccess(statusRecord()));
		const report = await testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' });
		expect(report?.auditRecord).toMatchObject({
			order_no: 'attempt-1',
			order_amt: '1499',
			order_status: 'Successful',
		});
		const kept = JSON.stringify(report?.auditRecord);
		expect(kept).not.toContain('customer@example.test');
		expect(kept).not.toContain('Test Customer');
		expect(kept).not.toContain('192.0.2.10');
	});

	it.each([
		['the envelope', apiFailure('Enc_request: No record found', '51419')],
		[
			'the body with status 1',
			apiSuccess({ error_desc: 'Order List: Invalid Parameter', error_code: '51313', status: 1 }),
		],
		['the body with a padded code', apiSuccess({ error_code: '51308 ', status: 1 })],
	])('answers null when %s says there is no record', async (_label, body) => {
		const { fetch } = answering(body);
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toBeNull();
	});

	it.each([
		['an access code refusal', apiFailure('Access_code: Invalid Parameter', '51407.'), '51407'],
		['a request refusal', apiFailure('Enc_request: Invalid Request', '-1'), '-1'],
		['a refusal with no code', 'status=1&enc_response=Refused', null],
		['a refusal inside the body', apiSuccess({ error_code: '51002', status: 1 }), '51002'],
		['status 1 inside the body with no code', apiSuccess({ status: 1 }), null],
	])('reports %s', async (_label, body, gatewayCode) => {
		const { fetch } = answering(body);
		const refused = testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' });
		await expect(refused).rejects.toBeInstanceOf(PaymentGatewayError);
		await expect(refused).rejects.toMatchObject({ failure: 'rejected', gatewayCode });
	});

	it('does not echo the gateway error text, which it does not control', async () => {
		const { fetch } = answering(apiFailure('please quote key abc', '51407'));
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).rejects.not.toThrow('abc');
	});

	it.each([
		['an amount it cannot read', apiSuccess(statusRecord({ order_amt: 'lots' }))],
		['no currency', apiSuccess(statusRecord({ order_currncy: undefined }))],
		['two disagreeing currencies', apiSuccess(statusRecord({ order_curr: 'USD' }))],
		['a malformed reference', apiSuccess(statusRecord({ reference_no: 'abc' }))],
		['a body that is not an object', apiSuccess(['not', 'an', 'object'])],
		['a body that is not JSON', `status=0&enc_response=${encryptForTest('not json')}&enc_error_code=`],
		['a body under another key', `status=0&enc_response=${encryptForTest('{}', '0'.repeat(32))}&enc_error_code=`],
		['no body', 'status=0&enc_error_code='],
		['an envelope with no status', 'enc_response=abc'],
		['an unknown envelope status', 'status=2&enc_response=abc'],
		['a repeated envelope field', 'status=0&status=1&enc_response=abc'],
	])('fails closed on %s', async (_label, body) => {
		const { fetch } = answering(body);
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).rejects.toMatchObject({
			failure: 'unreadable',
		});
	});

	it('reports an HTTP error as unavailable', async () => {
		const { fetch } = answering('Bad gateway', 502);
		await expect(testGateway(fetch).fetchPaymentStatus({ attemptId: 'attempt-1' })).rejects.toMatchObject({
			failure: 'unavailable',
			message: 'CCAvenue orderStatusTracker answered HTTP 502',
		});
	});

	it('reports a network fault as unavailable and keeps its detail out', async () => {
		const broken = (async () => {
			throw new Error(`connect failed with ${TEST_WORKING_KEY}`);
		}) as typeof fetch;
		const refused = testGateway(broken).fetchPaymentStatus({ attemptId: 'attempt-1' });
		await expect(refused).rejects.toMatchObject({ failure: 'unavailable' });
		await expect(refused).rejects.not.toThrow(TEST_WORKING_KEY);
	});

	it.each([
		['a malformed order id', { attemptId: 'a&b=c' }],
		['a malformed reference', { attemptId: 'attempt-1', gatewayReference: 'abc' }],
	])('never sends %s', async (_label, query) => {
		const { fetch, calls } = answering(apiSuccess(statusRecord()));
		await expect(testGateway(fetch).fetchPaymentStatus(query)).rejects.toMatchObject({
			failure: 'invalid-request',
		});
		expect(calls).toHaveLength(0);
	});
});

describe('refundPayment', () => {
	it('sends the documented Refund call', async () => {
		const { fetch, calls } = answering(apiSuccess({ reason: '', error_code: '', refund_status: 0 }));
		await testGateway(fetch).refundPayment(refund());

		expect(Object.fromEntries(calls[0]!.form)).toMatchObject({ command: 'refundOrder', version: '1.1' });
		expect(JSON.parse(decryptForTest(calls[0]!.form.get('enc_request')!))).toEqual({
			reference_no: '311008298114',
			refund_amount: '500.00',
			refund_ref_no: 'REFUND1',
		});
	});

	it('reports an accepted refund', async () => {
		const { fetch } = answering(apiSuccess({ reason: '', error_code: '', refund_status: 0 }));
		await expect(testGateway(fetch).refundPayment(refund())).resolves.toEqual({
			outcome: 'accepted',
			refundReference: 'REFUND1',
			refusalReason: null,
			refusalCode: null,
			auditRecord: { refund_status: '0', reason: '', error_code: '' },
		});
	});

	it('reports a repeated refund reference as a duplicate, not a second refund', async () => {
		const reason = 'Reference number: Invalid Parameter';
		const { fetch } = answering(apiSuccess({ reason, error_code: '51309', refund_status: 1 }));
		await expect(testGateway(fetch).refundPayment(refund())).resolves.toMatchObject({
			outcome: 'duplicate',
			refusalCode: '51309',
			refusalReason: reason,
		});
	});

	it.each(['51310', '51311', '51312', '51314', '51315', '51328'])('reports refusal %s', async (error_code) => {
		const { fetch } = answering(apiSuccess({ reason: 'Refund not allowed', error_code, refund_status: 1 }));
		await expect(testGateway(fetch).refundPayment(refund())).resolves.toMatchObject({
			outcome: 'refused',
			refusalCode: error_code,
			refusalReason: 'Refund not allowed',
		});
	});

	it('accepts null reason and code on an accepted refund', async () => {
		const { fetch } = answering(apiSuccess({ reason: null, error_code: null, refund_status: 0 }));
		await expect(testGateway(fetch).refundPayment(refund())).resolves.toMatchObject({ outcome: 'accepted' });
	});

	it('reports a refund against an unknown payment as refused', async () => {
		const { fetch } = answering(apiFailure('No records', '51419'));
		await expect(testGateway(fetch).refundPayment(refund())).resolves.toMatchObject({
			outcome: 'refused',
			refusalCode: '51419',
			auditRecord: { error_code: '51419' },
		});
	});

	it('treats a body with no refund status as an unknown outcome', async () => {
		const { fetch } = answering(apiSuccess({ error_desc: 'Unexpected', error_code: '51420', status: 1 }));
		await expect(testGateway(fetch).refundPayment(refund())).rejects.toMatchObject({ failure: 'unreadable' });
	});

	it('reports a call-level refusal', async () => {
		const { fetch } = answering(apiFailure('Access_code: Invalid Parameter', '51407'));
		await expect(testGateway(fetch).refundPayment(refund())).rejects.toMatchObject({
			failure: 'rejected',
			gatewayCode: '51407',
		});
	});

	it.each([
		['a refund reference with symbols', { refundReference: 'A-1' }],
		['a refund reference over 30 characters', { refundReference: 'A'.repeat(31) }],
		['a malformed payment reference', { gatewayReference: 'abc' }],
		['a zero amount', { amountMinor: 0 }],
		['a foreign currency', { currency: 'USD' }],
	])('never sends %s', async (_label, overrides) => {
		const { fetch, calls } = answering(apiSuccess({ refund_status: 0 }));
		await expect(testGateway(fetch).refundPayment(refund(overrides))).rejects.toMatchObject({
			failure: 'invalid-request',
		});
		expect(calls).toHaveLength(0);
	});
});

describe('fetchRefunds', () => {
	const details = (overrides: Record<string, unknown> = {}) => ({
		refund_list: [
			{
				refund_amt: '1.00',
				refund_issue_date: '2014-09-12 15:11:07.877',
				refund_processed_on: '',
				refund_completion_date: '2014-09-12 15:12:07.77',
				refund_bank_ref_no: '2492',
				refund_mer_ref_no: 'A1',
				refund_status: 'TS-REFC',
			},
			{ refund_amt: '2.50', refund_mer_ref_no: '', refund_status: 'TS-REFA' },
		],
		reference_no: '311008298114',
		order_no: 'attempt-1',
		order_amt: '10.00',
		order_curr: 'INR',
		order_status: 'Refunded',
		error_desc: '',
		error_code: '',
		...overrides,
	});

	it('sends the documented call and lists each refund', async () => {
		const { fetch, calls } = answering(apiSuccess(details()));
		await expect(testGateway(fetch).fetchRefunds('311008298114')).resolves.toEqual([
			{
				refundReference: 'A1',
				amountMinor: 100,
				state: 'completed',
				auditRecord: {
					refund_amt: '1.00',
					refund_status: 'TS-REFC',
					refund_mer_ref_no: 'A1',
					refund_bank_ref_no: '2492',
					refund_issue_date: '2014-09-12 15:11:07.877',
					refund_processed_on: '',
					refund_completion_date: '2014-09-12 15:12:07.77',
				},
			},
			{
				refundReference: null,
				amountMinor: 250,
				state: 'pending',
				auditRecord: { refund_amt: '2.50', refund_status: 'TS-REFA', refund_mer_ref_no: '' },
			},
		]);
		expect(Object.fromEntries(calls[0]!.form)).toMatchObject({ command: 'getRefundDetails', version: '1.1' });
		expect(JSON.parse(decryptForTest(calls[0]!.form.get('enc_request')!))).toEqual({
			reference_no: '311008298114',
		});
	});

	it('answers an empty list when CCAvenue has no refunds on the payment', async () => {
		const { fetch } = answering(apiSuccess({ ...details({ refund_list: undefined }) }));
		await expect(testGateway(fetch).fetchRefunds('311008298114')).resolves.toEqual([]);
	});

	it('answers an empty list for no record', async () => {
		const { fetch } = answering(
			apiSuccess({ reference_no: '311008298114', error_desc: 'No record', error_code: '51419' }),
		);
		await expect(testGateway(fetch).fetchRefunds('311008298114')).resolves.toEqual([]);
	});

	it('refuses an answer about another payment', async () => {
		const { fetch } = answering(apiSuccess(details({ reference_no: '999999999999' })));
		await expect(testGateway(fetch).fetchRefunds('311008298114')).rejects.toMatchObject({ failure: 'unreadable' });
	});

	it('refuses an answer it cannot read', async () => {
		const { fetch } = answering(
			apiSuccess(details({ refund_list: [{ refund_amt: 'x', refund_status: 'TS-REFC' }] })),
		);
		await expect(testGateway(fetch).fetchRefunds('311008298114')).rejects.toMatchObject({ failure: 'unreadable' });
	});

	it('never sends a malformed reference', async () => {
		const { fetch, calls } = answering(apiSuccess(details()));
		await expect(testGateway(fetch).fetchRefunds('abc')).rejects.toMatchObject({ failure: 'invalid-request' });
		expect(calls).toHaveLength(0);
	});
});
