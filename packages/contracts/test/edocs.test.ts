import { describe, expect, it } from 'vitest';

import { EWayBillNumber } from '../src/edocs';
import { EWayBillWrite } from '../src/order-admin';

describe('e-way bill numbers (12 digits, 14 from 23 Nov 2026)', () => {
	it('accepts 12 or 14 digits, ignoring spaces', () => {
		expect(EWayBillNumber.parse('3410 1234 5512 70')).toBe('34101234551270');
		expect(EWayBillNumber.parse('341012345512')).toBe('341012345512');
		expect(EWayBillNumber.safeParse('3410123455127').success).toBe(false);
	});
	it('is what the order page’s by-hand entry checks', () => {
		const at = '2026-11-23T11:00:00.000Z';
		expect(
			EWayBillWrite.safeParse({ number: '34101234551270', generatedOn: at, validUntil: at, revision: 1 }).success,
		).toBe(true);
	});
});
