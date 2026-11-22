import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareStore } from '@core/state/compare/compare.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';

import { ProductBoxHorizontal } from './product-box-horizontal';

const render = (product?: unknown) => {
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { cartItems$: items, addToCart: vi.fn() };
	const wishlist = { saved: signal(new Set(['1'])), toggle: vi.fn(async () => {}) };
	const compare = { chosen: signal(new Set(['red'])), toggle: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: cart },
			{ provide: WishlistStore, useValue: wishlist },
			{ provide: CompareStore, useValue: compare },
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

	it('toggles the wishlist and compare for its product, and shows their state', () => {
		const { box, wishlist, compare } = render({ id: 1, slug: 'red' });
		expect(box.saved()).toBe(true);
		expect(box.compared()).toBe(true);
		box.toggleWishlist();
		box.toggleCompare();
		expect(wishlist.toggle).toHaveBeenCalledWith({ id: 1, slug: 'red' });
		expect(compare.toggle).toHaveBeenCalledWith({ id: 1, slug: 'red' });
		const empty = render();
		expect(empty.box.saved()).toBe(false);
		expect(empty.box.compared()).toBe(false);
	});

	it('a set with choices opens them; a fixed set adds straight away with an empty choice (G02)', () => {
		const choose = render({ id: 's1', slug: 'set-1', sale_price: 2600, set_card: { pieces: 2, choose: true } });
		expect(choose.box.isConfigurable(choose.box.product())).toBe(true);
		const fixed = render({ id: 's2', slug: 'set-2', sale_price: 44900, set_card: { pieces: 2, choose: false } });
		expect(fixed.box.isConfigurable(fixed.box.product())).toBe(false);
		fixed.box.addToCart(fixed.box.product()!, 1);
		expect(fixed.cart.addToCart).toHaveBeenCalledWith(
			expect.objectContaining({
				quantity: 1,
				line_config: expect.objectContaining({
					raw: { set_choice: { picks: {}, variants: {}, extras: [], free: {} }, free_items: [] },
				}),
			}),
		);
	});
});
