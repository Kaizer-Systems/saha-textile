import type { Product } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { rebuildSearchIndex } from '../src/catalog/search-index';
import type { SearchPort } from '../src/ports/search.port';

const product = (id: string, status: Product['status']): Product =>
	({ id, status, slug: id, sku: id, title: { en: id }, type: 'simple', basePriceINR: 1 }) as Product;

describe('rebuildSearchIndex', () => {
	it('indexes live products and removes the rest, and a second run writes the same ids', async () => {
		const indexed: string[] = [];
		const removed: string[] = [];
		const search: SearchPort = {
			indexProduct: async (row) => {
				indexed.push(row.id);
			},
			removeProduct: async (id) => {
				removed.push(id);
			},
			search: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
		};
		const rows = [product('live', 'live'), product('draft', 'draft')];
		expect(await rebuildSearchIndex(rows, search)).toBe(1);
		expect(indexed).toEqual(['live']);
		expect(removed).toEqual(['draft']);
		await rebuildSearchIndex(rows, search);
		expect(indexed).toEqual(['live', 'live']);
	});
});
