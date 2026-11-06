import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductService } from './product.service';

vi.mock('@core/catalog/from-api', () => ({
	cardToProduct: (card: { id: number }) => ({ mapped: card.id }),
	galleryAttachment: (frame: { id: number }) => ({ frame: frame.id }),
	pageToProduct: (page: { id: number }) => ({ page: page.id }),
	placementToCatalog: (placement: { id: number }) => ({ placement: placement.id }),
}));

describe('ProductService', () => {
	const get = vi.fn();
	let service: ProductService;
	const options = () => get.mock.lastCall?.[1];
	const url = () => String(get.mock.lastCall?.[0]);

	beforeEach(() => {
		get.mockReset();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get } }] });
		service = TestBed.inject(ProductService);
	});

	it('asks for a listing, defaulting the page size', async () => {
		get.mockReturnValue(of({ id: 1 }));
		await expect(firstValueFrom(service.getCatalog())).resolves.toEqual({ placement: 1 });
		expect(options().params).toEqual({ pageSize: 24 });
		await firstValueFrom(service.getCatalog({ limit: 10, page: 2 }));
		expect(options().params).toEqual({ page: 2, pageSize: 10 });
	});

	it('maps the home rails', async () => {
		get.mockReturnValue(
			of({ newArrivals: [{ id: 1 }], bestsellers: [{ id: 2 }], featured: [], sale: [{ id: 3 }] }),
		);
		await expect(firstValueFrom(service.home())).resolves.toEqual({
			newArrivals: [{ mapped: 1 }],
			bestsellers: [{ mapped: 2 }],
			featured: [],
			sale: [{ mapped: 3 }],
		});
	});

	it('maps recent purchases', async () => {
		get.mockReturnValue(of({ items: [{ card: { id: 1 }, purchasedAt: 'now' }] }));
		await expect(firstValueFrom(service.recentPurchases())).resolves.toEqual([
			{ product: { mapped: 1 }, purchasedAt: 'now' },
		]);
	});

	it('searches', async () => {
		get.mockReturnValue(of({ items: [{ id: 1 }] }));
		await expect(firstValueFrom(service.search('silk'))).resolves.toEqual([{ mapped: 1 }]);
		expect(options().params).toEqual({ q: 'silk' });
	});

	it('reads cards for slugs', async () => {
		get.mockReturnValue(of([{ id: 1 }]));
		await expect(firstValueFrom(service.cardsFor(['a']))).resolves.toEqual([{ mapped: 1 }]);
		expect(options().params).toEqual({ slug: ['a'] });
	});

	it('maps the relation rails, escaping the slug', async () => {
		get.mockReturnValue(of({ related: [{ id: 1 }], upsell: [], crossSell: [{ id: 2 }], boughtTogether: [] }));
		await expect(firstValueFrom(service.getRelations('red saree'))).resolves.toEqual({
			related: [{ mapped: 1 }],
			upsell: [],
			crossSell: [{ mapped: 2 }],
			boughtTogether: [],
		});
		expect(url()).toContain('/catalog/products/red%20saree/relations');
	});

	it('reads a product page with or without a variant', async () => {
		get.mockReturnValue(of({ id: 1 }));
		await expect(firstValueFrom(service.getProductPage('red'))).resolves.toEqual({ page: 1 });
		expect(options().params).toEqual({});
		await firstValueFrom(service.getProductPage('red', 'SKU-1'));
		expect(options().params).toEqual({ variant: 'SKU-1' });
	});

	it('maps the gallery frames', async () => {
		get.mockReturnValue(of({ frames: [{ id: 1 }] }));
		await expect(firstValueFrom(service.getGallery('red'))).resolves.toEqual([{ frame: 1 }]);
	});
});
