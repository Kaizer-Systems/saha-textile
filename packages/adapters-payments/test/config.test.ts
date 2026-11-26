import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CcavenuePaymentGateway, type CcavenueGatewayOptions } from '../src';
import { RETURN_URL, TEST_ACCESS_CODE, TEST_WORKING_KEY, testGateway } from './support';

const options = (overrides: Partial<CcavenueGatewayOptions> = {}): CcavenueGatewayOptions => ({
	merchantId: '123456',
	accessCode: TEST_ACCESS_CODE,
	workingKey: TEST_WORKING_KEY,
	baseUrl: 'https://test.ccavenue.com',
	apiUrl: 'https://apitest.ccavenue.com',
	returnUrl: RETURN_URL,
	...overrides,
});

const build = (overrides: Partial<CcavenueGatewayOptions>) => () => new CcavenuePaymentGateway(options(overrides));

describe('CCAvenue configuration', () => {
	it('accepts a trailing slash on a host', () => {
		expect(build({ baseUrl: 'https://secure.ccavenue.com/', apiUrl: 'https://api.ccavenue.com/' })).not.toThrow();
	});

	it.each([
		['merchantId', { merchantId: 'ABC' }],
		['accessCode', { accessCode: 'HAS SPACE' }],
		['workingKey', { workingKey: 'short' }],
		['baseUrl', { baseUrl: 'http://test.ccavenue.com' }],
		['baseUrl', { baseUrl: 'not a url' }],
		['baseUrl', { baseUrl: 'https://test.ccavenue.com.example.test' }],
		['baseUrl', { baseUrl: 'https://test.ccavenue.com/transaction' }],
		['apiUrl', { apiUrl: 'https://180.179.175.17' }],
		['apiUrl', { apiUrl: 'https://login.ccavenue.ae' }],
		['returnUrl', { returnUrl: 'http://api.example.test/payments/return' }],
		['returnUrl', { returnUrl: 'not a url' }],
		['returnUrl', { returnUrl: `${RETURN_URL}?a=1` }],
		['returnUrl', { returnUrl: `${RETURN_URL}#top` }],
		['returnUrl', { returnUrl: 'https://api.example.test/payment-return' }],
		['returnUrl', { returnUrl: `https://api.example.test/${'a'.repeat(100)}` }],
		['timeoutMs', { timeoutMs: 0 }],
	])('names %s when it is wrong', (name, overrides) => {
		expect(build(overrides)).toThrow(`CCAvenue configuration is invalid: ${name}`);
	});

	it('never repeats a credential in its error', () => {
		const wrongKey = 'x'.repeat(31);
		let message = '';
		try {
			build({ workingKey: wrongKey, accessCode: 'SECRET VALUE' })();
		} catch (error) {
			message = `${String(error)} ${inspect(error, { depth: 8 })}`;
		}
		expect(message).toContain('workingKey');
		expect(message).not.toContain(wrongKey);
		expect(message).not.toContain('SECRET VALUE');
	});

	it('keeps every credential out of what a logger can print', () => {
		const gateway = testGateway();
		const printed = `${JSON.stringify(gateway)} ${inspect(gateway, { showHidden: true, depth: 8 })}`;
		expect(printed).not.toContain(TEST_WORKING_KEY);
		expect(printed).not.toContain(TEST_ACCESS_CODE);
		expect(gateway.gateway).toBe('ccavenue');
	});

	it('uses the platform fetch unless one is given', async () => {
		const original = globalThis.fetch;
		const calls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			calls.push(url);
			return new Response('status=1&enc_response=No records&enc_error_code=51419');
		}) as typeof fetch;
		try {
			await expect(testGateway().fetchPaymentStatus({ attemptId: 'attempt-1' })).resolves.toBeNull();
		} finally {
			globalThis.fetch = original;
		}
		expect(calls).toEqual(['https://apitest.ccavenue.com/apis/servlet/DoWebTrans']);
	});
});
