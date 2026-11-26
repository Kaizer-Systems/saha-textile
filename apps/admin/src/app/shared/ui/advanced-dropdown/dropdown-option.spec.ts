import { describe, expect, it } from 'vitest';

import { childrenOf, labelOf } from './dropdown-option';

describe('dropdown option fields', () => {
	const silk = { id: 'cat_2', name: 'Silk', rank: 3, note: null, subcategories: [] };
	const sarees = { id: 'cat_1', name: 'Sarees', subcategories: [silk] };

	it('reads the label under the key the screen names, as text, and nothing for a missing one', () => {
		expect(labelOf(sarees, 'name')).toBe('Sarees');
		expect(labelOf(silk, 'rank')).toBe('3');
		expect(labelOf(silk, 'note')).toBe('');
		expect(labelOf(silk, 'title')).toBe('');
	});

	it('reads the children under the key the screen names, and none for a leaf, another value or no key', () => {
		expect(childrenOf(sarees, 'subcategories')).toEqual([silk]);
		expect(childrenOf(silk, 'subcategories')).toEqual([]);
		expect(childrenOf(sarees, 'name')).toEqual([]);
		expect(childrenOf(sarees, '')).toEqual([]);
	});
});
