import { describe, expect, it } from 'vitest';

import { searchOf } from './search-of';

describe('searchOf', () => {
	it("gives the search box's text, and nothing for a missing or non-text value", () => {
		expect(searchOf({ search: 'silk', page: 2 })).toBe('silk');
		expect(searchOf({ search: '' })).toBe('');
		expect(searchOf({ page: 2 })).toBeUndefined();
		expect(searchOf({ search: 3 })).toBeUndefined();
	});
});
