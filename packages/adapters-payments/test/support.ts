import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

import { CcavenuePaymentGateway } from '../src';

/**
 * Made with `openssl rand -hex 16` for these tests alone. It has never been a CCAvenue key.
 * The helpers below use `node:crypto` directly, so a fault in the adapter's cipher cannot hide
 * itself by being on both sides of a test; `cipher.test.ts` pins that cipher to OpenSSL output.
 */
export const TEST_WORKING_KEY = 'ee2218722c8c4933764c35175455c308';

export const TEST_ACCESS_CODE = 'TESTACCESSCODE';
export const RETURN_URL = 'https://api.example.test/payments/return';

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const aesKey = (workingKey: string): Buffer => createHash('md5').update(workingKey).digest();

export function encryptBytesForTest(bytes: Buffer, workingKey = TEST_WORKING_KEY): string {
	const cipher = createCipheriv('aes-128-cbc', aesKey(workingKey), IV);
	return Buffer.concat([cipher.update(bytes), cipher.final()]).toString('hex');
}

export const encryptForTest = (plainText: string, workingKey = TEST_WORKING_KEY): string =>
	encryptBytesForTest(Buffer.from(plainText, 'utf8'), workingKey);

export function decryptForTest(cipherHex: string): string {
	const decipher = createDecipheriv('aes-128-cbc', aesKey(TEST_WORKING_KEY), IV);
	return Buffer.concat([decipher.update(cipherHex, 'hex'), decipher.final()]).toString('utf8');
}

export interface RecordedCall {
	url: string;
	init: RequestInit;
	form: URLSearchParams;
}

export function answering(body: string, status = 200): { fetch: typeof fetch; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const respond = (async (url: string, init: RequestInit) => {
		calls.push({ url, init, form: new URLSearchParams(String(init.body)) });
		return new Response(body, { status });
	}) as typeof fetch;
	return { fetch: respond, calls };
}

export const testGateway = (fetchImpl?: typeof fetch): CcavenuePaymentGateway =>
	new CcavenuePaymentGateway({
		merchantId: '123456',
		accessCode: TEST_ACCESS_CODE,
		workingKey: TEST_WORKING_KEY,
		baseUrl: 'https://test.ccavenue.com',
		apiUrl: 'https://apitest.ccavenue.com',
		returnUrl: RETURN_URL,
		...(fetchImpl ? { fetch: fetchImpl } : {}),
	});

/** The API guide prints uppercase hex, so these replies use it. */
export const apiSuccess = (body: unknown): string =>
	`status=0&enc_response=${encryptForTest(JSON.stringify(body)).toUpperCase()}&enc_error_code=\n`;

export const apiFailure = (message: string, code: string): string =>
	`status=1&enc_response=${message}&enc_error_code=${code}`;

/** A decrypted callback, shaped like the sample in the Integration Document. */
export function hostedResponse(overrides: Record<string, string> = {}): string {
	const fields = {
		order_id: 'attempt-1',
		tracking_id: '311008298114',
		bank_ref_no: '1652448720867',
		order_status: 'Success',
		failure_message: '',
		payment_mode: 'Net Banking',
		card_name: 'AvenuesTest',
		status_code: 'null',
		status_message: 'Y',
		currency: 'INR',
		amount: '1499.00',
		billing_name: 'Test Customer',
		billing_address: 'Room 11, Test Road',
		billing_tel: '9000000000',
		billing_email: 'customer@example.test',
		delivery_name: 'Test Customer',
		mer_amount: '1499.00',
		trans_date: '13/05/2022 19:04:51',
		...overrides,
	};
	return Object.entries(fields)
		.map(([name, value]) => `${name}=${value}`)
		.join('&');
}

export const callbackForm = (plainText: string, orderNo = 'attempt-1'): Record<string, string> => ({
	encResp: encryptForTest(plainText),
	orderNo,
});

/** A Status API record, shaped like the sample in the merchant API guide. */
export const statusRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	reference_no: '311008298114',
	order_no: 'attempt-1',
	order_currncy: 'INR',
	order_amt: 1499.0,
	order_status: 'Successful',
	order_fraud_status: 'NA',
	order_status_date_time: '2026-11-07 15:06:13.243',
	order_bill_name: 'Test Customer',
	order_bill_email: 'customer@example.test',
	order_bill_tel: '9000000000',
	order_ip: '192.0.2.10',
	order_bank_ref_no: '035944',
	order_bank_response: 'Transaction Successful',
	order_gtw_id: 'ICICI',
	order_option_type: 'OPTCRDC',
	error_desc: '',
	status: 0,
	error_code: '',
	...overrides,
});
