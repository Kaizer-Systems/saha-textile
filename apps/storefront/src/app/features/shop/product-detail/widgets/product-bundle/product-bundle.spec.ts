import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';

import { ProductBundle } from './product-bundle';

const related = signal<unknown>(undefined);
vi.mock('@data-access/queries/product.queries', () => ({
	injectRelatedProductsData: () => ({ data: related }),
}));

const cards = [
	{ id: 1, sale_price: 100 },
	{ id: 2, sale_price: 200 },
	{ id: 3, sale_price: 300 },
];

const render = (product: unknown = { cross_sell_products: [1, '2'] }) => {
	related.set(cards);
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { cartItems$: items, addToCart: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: CartFacade, useValue: cart }] });
	TestBed.overrideComponent(ProductBundle, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductBundle);
	fixture.componentRef.setInput('product', product);
	const bundle = fixture.componentInstance;
	bundle.ngOnChanges();
	TestBed.tick();
	return { fixture, bundle, items, cart };
};
const box = (value: string, checked: boolean) => ({ target: { value, checked } }) as never;

describe('ProductBundle', () => {
	it('shows only the cross-sell cards the product names', () => {
		expect(render().bundle.crossSellproducts.map((card) => card.id)).toEqual([1, 2]);
	});

	it('shows none for a product without cross-sells, or when the list empties', () => {
		expect(render({}).bundle.crossSellproducts).toEqual([]);
		expect(render({ cross_sell_products: 'x' }).bundle.crossSellproducts).toEqual([]);
		expect(render(null).bundle.crossSellproducts).toEqual([]);
		const { fixture, bundle } = render();
		fixture.componentRef.setInput('product', null);
		related.set(undefined);
		TestBed.tick();
		expect(bundle.crossSellproducts).toEqual([]);
	});

	it('totals what is ticked and drops what is unticked', () => {
		const { bundle } = render();
		bundle.select(box('1', true));
		bundle.select(box('2', true));
		expect(bundle.total).toBe(300);
		bundle.select(box('1', false));
		expect(bundle.selectedProductIds).toEqual(['2']);
		expect(bundle.total).toBe(200);
	});

	it('copes with an event that has no target', () => {
		const { bundle } = render();
		bundle.select({ target: null } as never);
		bundle.select(undefined as never);
		expect(bundle.total).toBe(0);
	});

	it('adds each ticked card, reusing a line already in the cart', () => {
		const { bundle, items, cart } = render();
		items.next([{ id: 'line', product: { id: 1 } }]);
		bundle.select(box('1', true));
		bundle.select(box('2', true));
		bundle.addToCartAll();
		expect(cart.addToCart.mock.calls.map(([params]) => params.id)).toEqual(['line', null]);
		expect(cart.addToCart.mock.calls[1]?.[0]).toMatchObject({ product_id: 2, quantity: 1, variation: null });
	});

	it('skips an empty entry', () => {
		const { bundle, cart } = render();
		bundle.selectedProduct = [undefined as never];
		bundle.addToCartAll();
		expect(cart.addToCart).not.toHaveBeenCalled();
	});
});
