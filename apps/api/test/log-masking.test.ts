import { describe, expect, it } from 'vitest';

import { maskPersonalData } from '../src/infra/log-masking';

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
