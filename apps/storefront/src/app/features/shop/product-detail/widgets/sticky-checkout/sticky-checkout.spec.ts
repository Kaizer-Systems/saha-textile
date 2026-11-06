import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';

import { StickyCheckout } from './sticky-checkout';

const render = () => {
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { cartItems$: items, addToCart: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: CartFacade, useValue: cart }] });
	TestBed.overrideComponent(StickyCheckout, { set: { imports: [], template: '' } });
	const sticky = TestBed.createComponent(StickyCheckout).componentInstance;
	return { sticky, items, cart };
};
const product = () => ({ id: 7, quantity: 2, stock_status: 'in_stock' }) as never;
const change = (value: unknown) => ({ product: new SimpleChange(undefined, value, true) });

describe('StickyCheckout', () => {
	it('takes the product and finds its line', () => {
		const { sticky, items } = render();
		sticky.ngOnChanges(change(product()));
		items.next([{ id: 'other' }, { id: 'line', product: { id: 7 } }]);
		expect(sticky.cartItem).toMatchObject({ id: 'line' });
	});

	it('keeps the product when the change has none', () => {
		const { sticky } = render();
		sticky.product = product();
		sticky.ngOnChanges(change(null));
		sticky.ngOnChanges({});
		expect(sticky.product).toMatchObject({ id: 7 });
	});

	it('marks stock from the product, or the chosen variation', () => {
		const { sticky } = render();
		sticky.product = product();
		sticky.updateQuantity(-1);
		expect(sticky.productQty).toBe(1);
		sticky.updateQuantity(2);
		expect(sticky.product.stock_status).toBe('out_of_stock');
		sticky.updateQuantity(-1);
		expect(sticky.product.stock_status).toBe('in_stock');
		sticky.selectVariation({ id: 5, quantity: 1, stock_status: 'in_stock' } as never);
		sticky.updateQuantity(1);
		expect(sticky.selectedVariation?.stock_status).toBe('out_of_stock');
		sticky.updateQuantity(-2);
		expect(sticky.selectedVariation?.stock_status).toBe('in_stock');
	});

	it('adds a plain product, a variation, or increments the line', () => {
		const { sticky, cart } = render();
		sticky.addToCart({ id: 7 } as never);
		expect(cart.addToCart).toHaveBeenLastCalledWith({
			id: null,
			product_id: 7,
			product: { id: 7 },
			variation: null,
			variation_id: null,
			quantity: 1,
		});
		sticky.cartItem = { id: 'line' } as never;
		sticky.selectVariation({ id: 5 } as never);
		sticky.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ id: 'line', variation_id: 5 });
		sticky.selectVariation({} as never);
		sticky.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ variation_id: null });
	});

	it('adds nothing without a product', () => {
		const { sticky, cart } = render();
		sticky.addToCart(undefined as never);
		expect(cart.addToCart).not.toHaveBeenCalled();
	});
});
