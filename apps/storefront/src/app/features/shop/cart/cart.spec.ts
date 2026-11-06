import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';

import { Cart } from './cart';

const render = () => {
	const cart = { cartItems$: of([]), cartTotal$: of(0), updateCart: vi.fn(), deleteCart: vi.fn() };
	const wishlist = { addToWishlist: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: cart },
			{ provide: WishlistFacade, useValue: wishlist },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('Cart') } },
		],
	});
	TestBed.overrideComponent(Cart, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(Cart).componentInstance, cart, wishlist };
};

describe('Cart page', () => {
	it('prefers the composed price, then the variation, then the product', () => {
		const { page } = render();
		expect(page.unitPrice({ unit_price: 9, product: {} } as never)).toBe(9);
		expect(page.unitPrice({ variation: { sale_price: 8 }, product: {} } as never)).toBe(8);
		expect(page.unitPrice({ product: { sale_price: 7 } } as never)).toBe(7);
	});

	it('updates a line', () => {
		const { page, cart } = render();
		page.updateQuantity({ id: 1, product: { id: 7 }, variation_id: 3, variation: { id: 3 } } as never, 2);
		expect(cart.updateCart).toHaveBeenLastCalledWith({
			id: 1,
			product: { id: 7 },
			product_id: 7,
			variation: { id: 3 },
			variation_id: 3,
			quantity: 2,
		});
		page.updateQuantity({ id: 2, product: { id: 8 } } as never, 1);
		expect(cart.updateCart.mock.lastCall?.[0]).toMatchObject({ variation_id: null });
	});

	it('deletes a line and saves one for later', () => {
		const { page, cart, wishlist } = render();
		page.delete(4);
		page.addToWishlist(7);
		expect(cart.deleteCart).toHaveBeenCalledWith(4);
		expect(wishlist.addToWishlist).toHaveBeenCalledWith({ product_id: 7 });
	});
});
