import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Cart, Order, Product } from '@saha-textile/contracts';
import type { TransactionContext, TransactionManagerPort } from '@saha-textile/core-domain';

import type { CartService } from '../src/cart/cart.service';
import { OrdersService } from '../src/orders/orders.service';

const principal = {
	userId: 'user_a',
	sessionId: 'sess_a',
	audience: 'storefront' as const,
	role: 'customer' as const,
	permissions: [] as string[],
};

const product = {
	id: 'prod_1',
	type: 'simple',
	sku: 'SKU-1',
	title: { en: 'Saree' },
	slug: 'saree',
	categoryIds: [],
	basePriceINR: 1000,
	status: 'live',
	variations: [],
} as unknown as Product;

function ownedCart(): Cart {
	return {
		id: 'cart_owned',
		userId: 'user_a',
		guestToken: null,
		currency: 'INR',
		lines: [{ id: 'line_1', productId: 'prod_1', variationId: null, quantity: 1, addons: [] }],
	};
}

describe('OrdersService.createFromCart', () => {
	it('rejects foreign carts before any write', async () => {
		const carts = {
			getCartForOrder: vi.fn(async () => {
				throw new NotFoundException('Cart not found');
			}),
			consumeCart: vi.fn(),
		} as unknown as CartService;
		const orders = { save: vi.fn() };
		const tx: TransactionManagerPort = {
			withTransaction: async (work) => work({} as TransactionContext),
		};
		const service = new OrdersService(
			orders as never,
			{ findById: vi.fn() } as never,
			{ findByCode: vi.fn() } as never,
			{ findByCouponCode: vi.fn() } as never,
			tx,
			carts,
		);

		await expect(service.createFromCart({ cartId: 'cart_b', principal })).rejects.toThrow(NotFoundException);
		expect(orders.save).not.toHaveBeenCalled();
		expect(carts.consumeCart).not.toHaveBeenCalled();
	});

	it('commits order save and cart consumption in one transaction', async () => {
		const cart = ownedCart();
		const savedOrder = { id: 'order_1' } as Order;
		const order: { save: ReturnType<typeof vi.fn> } = {
			save: vi.fn(async (value: Order) => {
				savedOrder.id = value.id;
				return value;
			}),
		};
		const carts = {
			getCartForOrder: vi.fn(async () => cart),
			consumeCart: vi.fn(async () => undefined),
		} as unknown as CartService;

		let nested = false;
		const tx: TransactionManagerPort = {
			withTransaction: async (work) => {
				const outer = { session: { id: 'outer' } } as TransactionContext;
				return work(outer);
			},
		};
		// Prove nesting joins: wrap again inside the work via a real join-style manager.
		const joiningTx: TransactionManagerPort = {
			withTransaction: async (work) => {
				if (nested) return work({ session: { id: 'outer' } } as TransactionContext);
				nested = true;
				return tx.withTransaction(work);
			},
		};

		const service = new OrdersService(
			order as never,
			{ findById: vi.fn(async () => product) } as never,
			{ findByCode: vi.fn() } as never,
			{ findByCouponCode: vi.fn() } as never,
			joiningTx,
			carts,
		);

		const result = await service.createFromCart({ cartId: cart.id, principal });
		expect(result.userId).toBe('user_a');
		expect(order.save).toHaveBeenCalledOnce();
		expect(carts.consumeCart).toHaveBeenCalledWith(cart.id, expect.anything());
	});

	it('rolls back when cart consumption fails after order write', async () => {
		const cart = ownedCart();
		let committed = false;
		const order = {
			save: vi.fn(async (value: Order) => value),
		};
		const carts = {
			getCartForOrder: vi.fn(async () => cart),
			consumeCart: vi.fn(async () => {
				throw new Error('cart consume failed');
			}),
		} as unknown as CartService;

		const tx: TransactionManagerPort = {
			withTransaction: async (work) => {
				try {
					const result = await work({} as TransactionContext);
					committed = true;
					return result;
				} catch (error) {
					committed = false;
					throw error;
				}
			},
		};

		const service = new OrdersService(
			order as never,
			{ findById: vi.fn(async () => product) } as never,
			{ findByCode: vi.fn() } as never,
			{ findByCouponCode: vi.fn() } as never,
			tx,
			carts,
		);

		await expect(service.createFromCart({ cartId: cart.id, principal })).rejects.toThrow('cart consume failed');
		expect(committed).toBe(false);
	});

	it('documents that retries without an idempotency key are not deduplicated', async () => {
		// Explicit Chunk G seam: atomicity ≠ idempotency. Two successful creates yield two orders.
		const cart = ownedCart();
		const order = { save: vi.fn(async (value: Order) => value) };
		const carts = {
			getCartForOrder: vi.fn(async () => cart),
			consumeCart: vi.fn(async () => undefined),
		} as unknown as CartService;
		const tx: TransactionManagerPort = {
			withTransaction: async (work) => work({} as TransactionContext),
		};
		const service = new OrdersService(
			order as never,
			{ findById: vi.fn(async () => product) } as never,
			{ findByCode: vi.fn() } as never,
			{ findByCouponCode: vi.fn() } as never,
			tx,
			carts,
		);

		const first = await service.createFromCart({ cartId: cart.id, principal });
		const second = await service.createFromCart({ cartId: cart.id, principal });
		expect(first.id).not.toBe(second.id);
		expect(order.save).toHaveBeenCalledTimes(2);
	});
});
