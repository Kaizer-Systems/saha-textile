import { describe, expect, it } from 'vitest';

import { PurchasingSupport, actorOf, shortWhen } from '../src/purchasing/purchasing-support';

/**
 * G2: whether the GSTIN that receives purchases (the stock location's) is under composition on a bill's day: then the
 * purchase takes no input credit and its GST stays in the stock's cost.
 */

const location = (id: string, gstRegistrationId: string | null, createdAt = '2026-01-01') => ({
	id,
	active: true,
	warehouse: true,
	shipsOnline: true,
	createdAt,
	gstRegistrationId,
});
const REGISTRATIONS: Record<string, unknown> = {
	reg_c: {
		id: 'reg_c',
		stateCode: '19',
		terms: [
			{ from: '2026-07-01', kind: 'composition' },
			{ from: '2026-04-01', kind: 'regular' },
		],
	},
};

function support(options: { locations?: unknown[] | null; company?: boolean } = {}) {
	const unused = {} as never;
	return new PurchasingSupport(
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		null,
		options.locations === null
			? null
			: ({ list: async () => options.locations ?? [location('loc_bar', 'reg_c')] } as never),
		options.company === false
			? null
			: ({ getRegistration: async (id: string) => REGISTRATIONS[id] ?? null } as never),
	);
}

describe('a buyer under composition', () => {
	it('is the stock location’s GSTIN on the day, composition from July', async () => {
		expect(await support().buyerUnderComposition('2026-07-01')).toBe(true);
		expect(await support().buyerUnderComposition('2026-06-30')).toBe(false);
		expect(await support().buyerUnderComposition('2026-03-31')).toBe(false);
	});

	it('is never so without the stores, a stock location with a GSTIN, or a known registration', async () => {
		expect(await support({ locations: null }).buyerUnderComposition('2026-08-01')).toBe(false);
		expect(await support({ company: false }).buyerUnderComposition('2026-08-01')).toBe(false);
		expect(await support({ locations: [] }).buyerUnderComposition('2026-08-01')).toBe(false);
		expect(await support({ locations: [location('loc_bar', null)] }).buyerUnderComposition('2026-08-01')).toBe(
			false,
		);
		expect(
			await support({ locations: [location('loc_bar', 'reg_gone')] }).buyerUnderComposition('2026-08-01'),
		).toBe(false);
	});
});

describe('the small helpers', () => {
	it('give nothing for a time that isn’t one, and no actor when no one is signed in', () => {
		expect(shortWhen('not a time')).toBe('');
		expect(actorOf(undefined)).toBeNull();
	});
});
