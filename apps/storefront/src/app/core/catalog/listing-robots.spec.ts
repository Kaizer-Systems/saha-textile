import { describe, expect, it } from 'vitest';

import { listingRobots } from './listing-robots';

describe('listing robots', () => {
	it('keeps a clean category indexable and a filtered one noindex,follow', () => {
		expect(listingRobots({})).toBe('index,follow');
		expect(listingRobots({ attribute: 'color:red' })).toBe('noindex,follow');
		expect(listingRobots({ page: 2 })).toBe('noindex,follow');
	});
});
