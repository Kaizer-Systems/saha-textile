import { describe, expect, it } from 'vitest';

import { EDocListQuery } from '../src/edocs';

/** E-way bills listed by validity (brief 25 follow-ups): still valid, ending within a day, or ended. */

describe('the e-documents list query', () => {
	it('asks for no validity unless one is chosen, and pages 25 at a time from the first', () => {
		expect(EDocListQuery.parse({ kind: 'eWayBill' })).toEqual({ kind: 'eWayBill', page: 1, pageSize: 25 });
	});

	it('takes still valid, ending soon or ended, and nothing else', () => {
		for (const validity of ['current', 'endsSoon', 'ended'])
			expect(EDocListQuery.parse({ kind: 'eWayBill', validity }).validity).toBe(validity);
		expect(EDocListQuery.safeParse({ kind: 'eWayBill', validity: 'expired' }).success).toBe(false);
	});

	it('reads the page from the address as numbers, with the other filters beside it', () => {
		expect(
			EDocListQuery.parse({
				kind: 'eWayBill',
				validity: 'endsSoon',
				status: 'active',
				from: '2026-11-01',
				q: ' 3410 ',
				page: '2',
				pageSize: '50',
			}),
		).toEqual({
			kind: 'eWayBill',
			validity: 'endsSoon',
			status: 'active',
			from: '2026-11-01',
			q: '3410',
			page: 2,
			pageSize: 50,
		});
		expect(EDocListQuery.safeParse({ kind: 'eWayBill', pageSize: 101 }).success).toBe(false);
	});
});
