import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Product, ProductVariant, SeoRedirect, SeoRedirectWrite } from '@saha-textile/contracts';
import { collapseRedirectTarget } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { AdminRedirectsController } from '../src/catalog/admin-redirects.controller';
import { CatalogService } from '../src/catalog/catalog.service';
import { ProductsController } from '../src/catalog/products.controller';
import { PERMISSIONS_KEY, PUBLIC_ROUTE_KEY } from '../src/auth/session.guard';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

type Variant = z.output<typeof ProductVariant>;
type RedirectRow = z.output<typeof SeoRedirect>;

const product = Product.parse({
	id: 'prod_silk',
	type: 'variable',
	sku: 'SILK-1',
	title: { en: 'Banarasi' },
	slug: 'banarasi',
	basePriceINR: 2450,
	status: 'live',
	lifecycle: { liveAt: '2026-10-01T00:00:00.000Z' },
});

function variant(sku: string, priceINR: number, quantity: number): Variant {
	return ProductVariant.parse({
		id: `var_${sku}`,
		productId: product.id,
		sku,
		status: 'live',
		optionSelections: [{ attributeCode: 'color', termCode: sku }],
		optionSelectionHash: `color:${sku}`,
		isBaseVariant: sku.endsWith('red'),
		priceINR,
		stock: { quantity },
	});
}

function serviceFor(rows: Variant[], status: typeof product.status = 'live') {
	const stored = new Map<string, RedirectRow>();
	const current = { ...product, status };
	const products = {
		findById: async () => null,
		findBySlug: async (slug: string, audience?: string) =>
			slug === current.slug && (audience === 'admin' || current.status === 'live') ? current : null,
		list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
		save: async (row: typeof current) => row,
		deleteById: async () => undefined,
	};
	const variants = {
		listForProduct: async () => rows,
	};
	const redirects = {
		list: async () => [...stored.values()],
		findBySource: async (sourcePath: string) => stored.get(sourcePath) ?? null,
		save: async (row: SeoRedirect) => {
			const others = [...stored.values()].filter((existing) => existing.sourcePath !== row.sourcePath);
			const collapsed = collapseRedirectTarget(row.sourcePath, row.targetPath, row.statusCode, others);
			if ('error' in collapsed) throw new Error('redirect loop');
			const saved = { ...row, statusCode: collapsed.statusCode, targetPath: collapsed.targetPath };
			stored.set(saved.sourcePath, saved);
			return saved;
		},
	};
	return {
		catalog: new CatalogService(products as never, {} as never, variants as never, redirects as never),
		stored,
	};
}

describe('catalog read model', () => {
	it('returns a range and the default SKU without the variant matrix', async () => {
		const { catalog } = serviceFor([variant('red', 2450, 2), variant('green', 3950, 1)]);
		const view = await catalog.productRead('banarasi');
		expect(view.price).toEqual({ kind: 'range', minINR: 2450, maxINR: 3950 });
		expect(view.selected?.sku).toBe('red');
		expect(view).not.toHaveProperty('variants');
	});

	it('selects a real SKU and flags an unknown one without dropping the default', async () => {
		const { catalog } = serviceFor([variant('red', 2950, 2), variant('green', 2950, 2)]);
		const known = await catalog.productRead('banarasi', 'green');
		expect(known.unknownVariant).toBe(false);
		expect(known.selected?.sku).toBe('green');
		expect(known.price).toMatchObject({ kind: 'single', sellingINR: 2950 });
		const unknown = await catalog.productRead('banarasi', 'missing');
		expect(unknown.unknownVariant).toBe(true);
		expect(unknown.selected?.sku).toBe('red');
	});

	it('hides a disabled product the same way as a missing one', async () => {
		const missing = serviceFor([]).catalog;
		await expect(missing.productRead('nope')).rejects.toBeInstanceOf(NotFoundException);
		const hidden = serviceFor([variant('red', 2950, 1)], 'disabled').catalog;
		await expect(hidden.productRead('banarasi')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('collapses a redirect chain and refuses a loop without replacing the row', async () => {
		const { catalog, stored } = serviceFor([]);
		await catalog.saveRedirect({
			sourcePath: '/en/product/b',
			statusCode: 301,
			targetPath: '/en/product/c',
			reason: 'slug_change',
		});
		const collapsed = await catalog.saveRedirect({
			sourcePath: '/en/product/a',
			statusCode: 301,
			targetPath: '/en/product/b',
			reason: 'slug_change',
		});
		expect(collapsed.targetPath).toBe('/en/product/c');
		await expect(
			catalog.saveRedirect({
				sourcePath: '/en/product/c',
				statusCode: 301,
				targetPath: '/en/product/a',
				reason: 'slug_change',
			}),
		).rejects.toThrow('That redirect would loop');
		expect(stored.has('/en/product/c')).toBe(false);
	});
});

describe('catalog route guards', () => {
	const reflector = new Reflector();

	it('leaves the public product read open and locks redirect writes to product.edit', () => {
		expect(reflector.get(PUBLIC_ROUTE_KEY, ProductsController)).toBe(true);
		expect(reflector.get(PERMISSIONS_KEY, AdminRedirectsController.prototype.list)).toEqual(['product.index']);
		expect(reflector.get(PERMISSIONS_KEY, AdminRedirectsController.prototype.save)).toEqual(['product.edit']);
	});

	it('rejects a 301 that has no target', () => {
		const pipe = new ZodValidationPipe(SeoRedirectWrite);
		expect(() => pipe.transform({ sourcePath: '/old', statusCode: 301, reason: 'manual' })).toThrow(
			BadRequestException,
		);
	});
});
