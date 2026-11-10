import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WISHLIST_ACCOUNT_LIMIT } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontCatalogController } from '../src/catalog/storefront-catalog.controller';
import { WishlistController } from '../src/wishlist/wishlist.controller';
import { WishlistService } from '../src/wishlist/wishlist.service';

const NOW = new Date('2026-11-08T10:00:00.000Z');

const build = (saved: string[] = [], live: string[] = ['p1', 'p2', 'p3']) => {
	const wishlist = {
		listProductIds: vi.fn(async () => [...saved]),
		add: vi.fn(async () => {}),
		addMany: vi.fn(async () => {}),
		remove: vi.fn(async () => {}),
		removeAllForCustomer: vi.fn(async () => {}),
	};
	const products = {
		findById: vi.fn(async (id: string) => (live.includes(id) ? { id } : null)),
	};
	const catalog = { cardsForIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))) };
	const service = new WishlistService(wishlist as never, products as never, catalog as never);
	return { service, wishlist, products, catalog };
};

describe('WishlistService', () => {
	it('shows every saved id and cards for those on sale', async () => {
		const { service, catalog } = build(['p2', 'gone']);
		expect(await service.view('c1')).toEqual({ productIds: ['p2', 'gone'], items: [{ id: 'p2' }, { id: 'gone' }] });
		expect(catalog.cardsForIds).toHaveBeenCalledWith(['p2', 'gone']);
	});

	it('saves a product on sale once, newest first', async () => {
		const { service, wishlist } = build(['p2']);
		expect(await service.add('c1', 'p1', NOW)).toEqual({ productIds: ['p1', 'p2'] });
		expect(wishlist.add).toHaveBeenCalledWith({ customerId: 'c1', productId: 'p1', at: NOW.toISOString() });
		const again = build(['p1']);
		expect(await again.service.add('c1', 'p1')).toEqual({ productIds: ['p1'] });
		expect(again.wishlist.add).not.toHaveBeenCalled();
	});

	it('refuses a product not on sale, and a full list', async () => {
		await expect(build().service.add('c1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
		const full = build(Array.from({ length: WISHLIST_ACCOUNT_LIMIT }, (_, i) => `s${i}`));
		await expect(full.service.add('c1', 'p1')).rejects.toBeInstanceOf(HttpException);
		expect(full.wishlist.add).not.toHaveBeenCalled();
	});

	it('removes and answers with what is left', async () => {
		const { service, wishlist } = build(['p2']);
		expect(await service.remove('c1', 'p1')).toEqual({ productIds: ['p2'] });
		expect(wishlist.remove).toHaveBeenCalledWith({ customerId: 'c1', productId: 'p1' });
	});

	it('merges the guest list: on sale, new, unique, within the ceiling', async () => {
		const { service, wishlist } = build(['p2']);
		await service.merge('c1', ['p1', 'p1', 'p2', 'gone', 'p3'], NOW);
		expect(wishlist.addMany).toHaveBeenCalledWith({
			customerId: 'c1',
			productIds: ['p1', 'p3'],
			at: NOW.toISOString(),
		});
		const full = build(Array.from({ length: WISHLIST_ACCOUNT_LIMIT }, (_, i) => `s${i}`));
		await full.service.merge('c1', ['p1']);
		expect(full.wishlist.addMany).toHaveBeenCalledWith(expect.objectContaining({ productIds: [] }));
	});
});

describe('WishlistController', () => {
	const setup = () => {
		const wishlist = {
			view: vi.fn(async () => 'view'),
			add: vi.fn(async () => 'added'),
			merge: vi.fn(async () => 'merged'),
			remove: vi.fn(async () => 'removed'),
		};
		const limits = { enforce: vi.fn(async () => {}) };
		const controller = new WishlistController(wishlist as never, limits as never);
		return { controller, wishlist, limits };
	};
	const shopper = { userId: 'c1' } as never;
	const request = { ip: '1.1.1.1' } as never;

	it('takes the customer from the session and limits writes', async () => {
		const { controller, wishlist, limits } = setup();
		expect(await controller.view(shopper)).toBe('view');
		expect(await controller.add(shopper, { productId: 'p1' }, request)).toBe('added');
		expect(wishlist.add).toHaveBeenCalledWith('c1', 'p1');
		expect(await controller.merge(shopper, { productIds: ['p1'] }, request)).toBe('merged');
		expect(wishlist.merge).toHaveBeenCalledWith('c1', ['p1']);
		expect(await controller.remove(shopper, 'p1', request)).toBe('removed');
		expect(wishlist.remove).toHaveBeenCalledWith('c1', 'p1');
		expect(limits.enforce).toHaveBeenCalledTimes(3);
		expect(limits.enforce).toHaveBeenCalledWith('wishlist_write', { ip: '1.1.1.1' });
	});

	it('refuses a guest before counting anything', async () => {
		const { controller, limits } = setup();
		expect(() => controller.view(undefined)).toThrow(UnauthorizedException);
		await expect(controller.add(undefined, { productId: 'p1' }, request)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(controller.merge(undefined, { productIds: [] }, request)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(controller.remove(undefined, 'p1', request)).rejects.toBeInstanceOf(UnauthorizedException);
		expect(limits.enforce).not.toHaveBeenCalled();
	});
});

describe('catalog cards by id', () => {
	it('reads ids when given, slugs otherwise', async () => {
		const catalog = {
			cardsForIds: vi.fn(async () => 'by-id'),
			cardsForSlugs: vi.fn(async () => 'by-slug'),
		};
		const controller = new StorefrontCatalogController(catalog as never, {} as never, {} as never, {} as never);
		expect(await controller.cards({ id: ['p1', 'p2'] })).toBe('by-id');
		expect(catalog.cardsForIds).toHaveBeenCalledWith(['p1', 'p2']);
		expect(await controller.cards({ id: 'p1' })).toBe('by-id');
		expect(catalog.cardsForIds).toHaveBeenLastCalledWith(['p1']);
		expect(await controller.cards({ slug: 'red' })).toBe('by-slug');
	});
});
