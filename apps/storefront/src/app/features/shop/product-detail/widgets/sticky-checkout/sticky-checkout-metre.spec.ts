import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';

import { StickyCheckout } from './sticky-checkout';

const RULE = { shortestCutTenths: 10, stepTenths: 5, quickLengths: [], widthInches: 44 };

const render = (product: Record<string, unknown>) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [{ provide: CartFacade, useValue: { cartItems$: new BehaviorSubject([]), addToCart: vi.fn() } }],
	});
	TestBed.overrideComponent(StickyCheckout, { set: { imports: [], template: '' } });
	const sticky = TestBed.createComponent(StickyCheckout).componentInstance;
	sticky.ngOnChanges({ product: new SimpleChange(undefined, { id: 7, ...product }, true) });
	return sticky;
};

describe('StickyCheckout: fabric by the metre (M07)', () => {
	it('starts a metre product at its shortest cut and writes the box as a length', () => {
		const sticky = render({ sold_by: 'metre', metre_rule: RULE, quantity: 30 });
		expect(sticky.productQty).toBe(10);
		expect(sticky.qtyText('m')).toBe('1.0 m');
		expect(render({ quantity: 3 }).qtyText('m')).toBe('1');
	});

	it('starts at one when a metre product came without its rule', () => {
		const sticky = render({ sold_by: 'metre', metre_rule: null, quantity: 30 });
		expect(sticky.productQty).toBe(1);
		sticky.updateQuantity(1);
		expect(sticky.productQty).toBe(2);
	});

	it('steps by half a metre up to the chosen colour’s stock, or the product’s', () => {
		const sticky = render({ sold_by: 'metre', metre_rule: RULE, quantity: 12 });
		sticky.updateQuantity(1);
		sticky.updateQuantity(1);
		expect(sticky.productQty).toBe(12);
		sticky.selectVariation({ id: 1, quantity: 30 } as never);
		sticky.updateQuantity(1);
		expect(sticky.productQty).toBe(17);
		sticky.updateQuantity(-1);
		expect(sticky.productQty).toBe(12);
	});

	it('sets no ceiling for made-to-order fabric or one without a stock figure', () => {
		const made = render({ sold_by: 'metre', metre_rule: RULE, made_to_order: true, quantity: 10 });
		made.updateQuantity(1);
		expect(made.productQty).toBe(15);
		const unknown = render({ sold_by: 'metre', metre_rule: RULE });
		unknown.updateQuantity(1);
		expect(unknown.productQty).toBe(15);
	});
});
