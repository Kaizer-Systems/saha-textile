import { describe, expect, it } from 'vitest';

import { isConfiguredCategory } from './configured-category';

describe('isConfiguredCategory', () => {
	it('matches a seeded category by its demo number, or any category by its id', () => {
		expect(isConfiguredCategory({ id: 'cat_2001' } as never, [2001])).toBe(true);
		expect(isConfiguredCategory({ id: 7 } as never, [7])).toBe(true);
		expect(isConfiguredCategory({ id: 'cat_2001' } as never, [2002])).toBe(false);
	});
});
