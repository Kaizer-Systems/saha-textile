import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { freeToSellOf } from '../src/catalog/catalog-read-model';
import { AdminQuestionsController } from '../src/catalog/content.controller';
import { applyProductContent } from '../src/catalog/product-content';
import { TaxonomyService } from '../src/catalog/taxonomy.service';

/** An instance holding only the parts this test reads. */
const withParts = <T extends object>(type: { prototype: T }, parts: object): T =>
	Object.assign(Object.create(type.prototype), parts) as T;

const taxonomy = (category: unknown, products: unknown[] = []) =>
	withParts(TaxonomyService, {
		categories: { findById: async () => category },
		products: { listByMainCategory: async () => products },
	});

describe('the catalogue: the last cases', () => {
	it('answers "not found" for the HSN impact of a category that does not exist', async () => {
		await expect(taxonomy(null).hsnImpact('cat_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('counts products under a category with no HSN: empty ones follow it, any code is their own', async () => {
		const impact = await taxonomy({ id: 'cat_1' }, [
			{ id: 'p1', sku: 'A', title: { en: 'A' }, hsnCode: null },
			{ id: 'p2', sku: 'B', title: { en: 'B' }, hsnCode: '5007' },
			{ id: 'p3', sku: 'C', title: { en: 'C' } },
		]).hsnImpact('cat_1');
		expect(impact).toEqual({
			categoryHsn: null,
			using: 1,
			own: [
				{ id: 'p2', sku: 'B', title: 'B', hsnCode: '5007' },
				{ id: 'p3', sku: 'C', title: 'C', hsnCode: '' },
			],
		});
	});

	it('reads free-to-sell stock with nothing held or kept when those counts were never saved', () => {
		expect(freeToSellOf({ stock: { quantity: 4 } } as never)).toBe(4);
	});

	it('clears the share picture when the form sends none', () => {
		const product = { media: { shareImage: { assetId: 'med_1' } } } as never;
		const content = {
			title: { en: 'Red saree' },
			shortDescription: {},
			description: {},
			metaTitle: {},
			metaDescription: {},
			estimatedDeliveryText: {},
			shareImage: null,
		} as never;
		expect(applyProductContent(product, content).media?.shareImage).toBeNull();
	});

	it('rejects a question with nobody named when no one is signed in', async () => {
		const reject = vi.fn(async () => undefined);
		await new AdminQuestionsController({ reject } as never).reject('q_1', undefined);
		expect(reject).toHaveBeenCalledWith('q_1', null);
	});
});
