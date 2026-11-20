import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ADDRESS_SECRET_NAMES, maskAddress, maskPersonalData } from '../src/infra/log-masking';

describe('maskPersonalData', () => {
	it.each([
		['Sign-in code sent to riya.sen@gmail.com', 'Sign-in code sent to r***@gmail.com'],
		['to=a@b.co.in', 'to=a***@b.co.in'],
		['OTP for 9876543210 expired', 'OTP for ********10 expired'],
		['phone +91 98765 43210 opted in', 'phone ********10 opted in'],
		['call 09876543210', 'call ********10'],
		['US buyer +1 415 555 2671', 'US buyer +********71'],
		['Authorization: Bearer abc.def-123', 'Authorization: Bearer [masked]'],
		['header Bearer abc.def-123', 'header Bearer [masked]'],
		['session eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fw', 'session [masked-jwt]'],
		['GET /auth/verify?token=a1b2c3&next=/en', 'GET /auth/verify?token=[masked]&next=/en'],
		['{"password":"hunter2","pin":"123456"}', '{"password":"[masked]","pin":"[masked]"}'],
		['otp=482913 accepted', 'otp=[masked] accepted'],
	])('masks %s', (input, output) => {
		expect(maskPersonalData(input)).toBe(output);
	});

	it.each([
		'Indexed 964 live products of 1000 into products_v1',
		'order 10482 paid ₹1,84,220 at 2026-11-10T03:00:00.000Z',
		'product prd_3347 sku ST-BAN-3347-3347-base',
		'took 1731234567 ms',
		'job mail.send #88213 attempt 3 of 3',
	])('leaves ordinary facts alone: %s', (input) => {
		expect(maskPersonalData(input)).toBe(input);
	});
});

describe('maskAddress (owner, 2026-11-21: placeholders keep the address shape, no secret is logged)', () => {
	it.each([
		['/en/auth/activate?token=s3cr3t&lang=en', '/en/auth/activate?token={{token}}&lang=en'],
		['/auth/accept-invite?token=s3cr3t', '/auth/accept-invite?token={{token}}'],
		[
			'/admin/mailboxes/oauth/callback?state=s1&code=s2&scope=email%20profile',
			'/admin/mailboxes/oauth/callback?state={{state}}&code={{code}}&scope=email%20profile',
		],
		['/storefront/pay/s3cr3t', '/storefront/pay/{{token}}'],
		['/en/pay/s3cr3t?x=1', '/en/pay/{{token}}?x=1'],
		[
			'/x?Token=a&access_token=b&mytoken=keep&token=',
			'/x?Token={{Token}}&access_token={{access_token}}&mytoken=keep&token={{token}}',
		],
		['/auth/verify?token=abc&email=riya@x.com', '/auth/verify?token={{token}}&email=r***@x.com'],
		['/en/collections/silk?page=2&sort=new', '/en/collections/silk?page=2&sort=new'],
		['', ''],
	])('%s', (input, output) => {
		expect(maskAddress(input)).toBe(output);
	});

	it('survives the logger masking a message a second time', () => {
		const line = `GET ${maskAddress('/en/pay/s3cr3t?token=abc')} failed`;
		expect(maskPersonalData(line)).toBe('GET /en/pay/{{token}}?token={{token}} failed');
	});

	it('names the same secrets as the edge log in the stack and production configs', () => {
		for (const file of ['docker/stack/nginx/edge.conf', 'docker/production/nginx/edge.conf.template']) {
			const text = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
			const lists = [...text.matchAll(/\((?:\?<log_[a-z]_name>|\?:)((?:[a-z_]+\|)+[a-z_]+)\)=/g)].map(
				(match) => match[1] ?? '',
			);
			expect(lists, file).toHaveLength(5);
			for (const list of lists) expect(list.split('|'), file).toEqual([...ADDRESS_SECRET_NAMES]);
		}
	});
});
