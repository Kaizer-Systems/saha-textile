import { TestBed } from '@angular/core/testing';
import { provideEffects } from '@ngrx/effects';
import { provideState, provideStore } from '@ngrx/store';
import { EMPTY, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';

import { CartEffects } from './cart.effects';
import { CartFacade } from './cart.facade';
import { CART_FEATURE_KEY } from './cart.models';
import { cartReducer } from './cart.reducer';

function setup() {
	TestBed.configureTestingModule({
		providers: [
			provideStore(),
			provideState(CART_FEATURE_KEY, cartReducer),
			provideEffects(CartEffects),
			{ provide: CartService, useValue: { getCartItems: () => EMPTY } },
			{ provide: NotificationService, useValue: { showError: () => undefined } },
		],
	});
	return TestBed.inject(CartFacade);
}

function addPayload(variationId: string, quantity = 1) {
	const variation = { id: variationId, sku: variationId, quantity: 5, sale_price: 2400, attribute_values: [] };
	const product = { id: 'prd_1', slug: 'kurti', quantity: 5, sku: variationId, variations: [variation] };
	const payload = {
		id: null,
		product: product as unknown as IProduct,
		product_id: product.id,
		variation: variation as unknown as IVariation,
		variation_id: variation.id,
		quantity,
		unit_price: 2400,
	} as ICartAddOrUpdate;
	return { product, variation, payload };
}

describe('CartFacade', () => {
	it('leaves the product page free to keep editing the product it added', async () => {
		const facade = setup();
		const { product, variation, payload } = addPayload('KPS-1');

		facade.addToCart(payload);

		expect(Object.isFrozen(product)).toBe(false);
		expect(Object.isFrozen(variation)).toBe(false);
		expect(() => {
			product.sku = 'KPS-2';
			variation.quantity = 2;
		}).not.toThrow();
		const [line] = await firstValueFrom(facade.cartItems$);
		expect(line?.product.sku).toBe('KPS-1');
		expect(line?.variation_id).toBe('KPS-1');
	});

	it('adds to the quantity when the same string-id variant is added again', async () => {
		const facade = setup();
		facade.addToCart(addPayload('var_931_90169').payload);
		const [first] = await firstValueFrom(facade.cartItems$);

		facade.addToCart({ ...addPayload('var_931_90169').payload, id: first!.id });

		const lines = await firstValueFrom(facade.cartItems$);
		expect(lines).toHaveLength(1);
		expect(lines[0]?.quantity).toBe(2);
	});
});
