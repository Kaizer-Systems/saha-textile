import { TestBed } from '@angular/core/testing';

import { NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';

import { ProductBoxHorizontal } from './product-box-horizontal';

const render = (product?: unknown) => {
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { cartItems$: items, addToCart: vi.fn() };
	const wishlist = { addToWishlist: vi.fn(), deleteWishlist: vi.fn() };
	const compare = { addToCompare: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: cart },
			{ provide: WishlistFacade, useValue: wishlist },
			{ provide: CompareFacade, useValue: compare },
		],
	});
	TestBed.overrideComponent(ProductBoxHorizontal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductBoxHorizontal);
	if (product) fixture.componentRef.setInput('product', product);
	fixture.detectChanges();
	return { box: fixture.componentInstance, items, cart, wishlist, compare };
};

describe('ProductBoxHorizontal', () => {
	it('sets the stars to read-only', () => {
		render();
		expect(TestBed.inject(NgbRatingConfig)).toMatchObject({ max: 5, readonly: true });
	});

	it('has no srcset without pipeline images', () => {
		expect(render({ id: 1 }).box.thumbnail()).toEqual({ srcset: null, sizes: null, width: null, height: null });
	});

	it('offers the card widths from the pipeline', () => {
		const image = {
			width: 700,
			height: 900,
			roles: { card: [{ url: 'https://cdn/4.webp', width: 400, height: 500, format: 'webp' }] },
		};
		const { box } = render({ id: 1, product_thumbnail: { image } });
		expect(box.thumbnail().width).toBe(700);
		expect(box.thumbnail().height).toBe(900);
	});

	it('finds its line in the cart', () => {
		const { box, items } = render({ id: 7 });
		items.next([{ id: 'line', product: { id: 7 } }]);
		expect(box.cartItem).toMatchObject({ id: 'line' });
	});

	it.each([
		[undefined, false],
		[{}, false],
		[{ attributes: [{}], variations: [] }, false],
		[{ attributes: [], variations: [{}] }, false],
		[{ attributes: [{}], variations: [{}] }, true],
		[{ addon_groups: [{}] }, true],
		[{ bundle: {} }, true],
	])('decides whether %j needs a configurator', (product, expected) => {
		expect(render().box.isConfigurable(product as never)).toBe(expected);
	});

	it('adds a new line, or increments the existing one', () => {
		const { box, cart } = render({ id: 7 });
		box.addToCart({ id: 7 } as never, 1);
		expect(cart.addToCart).toHaveBeenLastCalledWith({
			id: null,
			product: { id: 7 },
			product_id: 7,
			variation_id: null,
			variation: null,
			quantity: 1,
		});
		box.cartItem = { id: 'line', variation_id: 3, variation: { id: 3 } } as never;
		box.addToCart({ id: 7 } as never, 2);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ id: 'line', variation_id: 3, quantity: 2 });
	});

	it('forwards the wishlist and compare actions', () => {
		const { box, wishlist, compare } = render();
		box.addToWishlist(1);
		box.removeWishlist(1);
		box.addToCompar(2);
		expect(wishlist.addToWishlist).toHaveBeenCalledWith({ product_id: 1 });
		expect(wishlist.deleteWishlist).toHaveBeenCalledWith(1);
		expect(compare.addToCompare).toHaveBeenCalledWith({ product_id: 2 });
	});
});
