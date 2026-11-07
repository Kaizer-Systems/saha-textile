import type { Product } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { rebuildSearchIndex } from '../src/catalog/search-index';
import type { SearchPort } from '../src/ports/search.port';

const product = (id: string, status: Product['status']): Product =>
	({ id, status, slug: id, sku: id, title: { en: id }, type: 'simple', basePriceINR: 1 }) as Product;

describe('rebuildSearchIndex', () => {
	it('replaces the index with live products only, and says how many', async () => {
		const written: string[][] = [];
		const search: SearchPort = {
			indexProduct: async () => undefined,
			replaceIndex: async (entries) => {
				written.push(entries.map((entry) => entry.product.id));
			},
			removeProduct: async () => undefined,
			search: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
		};
		const rows = [product('live', 'live'), product('draft', 'draft')].map((row) => ({
			product: row,
			variants: [],
		}));
		expect(await rebuildSearchIndex(rows, search)).toBe(1);
		await rebuildSearchIndex(rows, search);
		expect(written).toEqual([['live'], ['live']]);
	});
});
