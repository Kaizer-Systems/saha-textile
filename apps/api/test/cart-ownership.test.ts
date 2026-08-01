import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Cart } from '@saha-textile/contracts';

import { CartService, toPublicCart } from '../src/cart/cart.service';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

function cart(overrides: Partial<Cart> = {}): Cart {
	return {
		id: 'cart_1',
		userId: 'user_a',
		guestToken: null,
		currency: 'INR',
		lines: [],
		...overrides,
	};
}

describe('CartService ownership / BOLA', () => {
	const repo = {
		findById: vi.fn(),
		findByUserId: vi.fn(),
		findByGuestToken: vi.fn(),
		save: vi.fn(async (c: Cart) => c),
		deleteById: vi.fn(),
	};
	const service = new CartService(repo as never, config);

	it('lets user A read their own cart', async () => {
		repo.findById.mockResolvedValueOnce(cart());
		await expect(
			service.getCart('cart_1', {
				principal: {
					userId: 'user_a',
					sessionId: 's',
					audience: 'storefront',
					role: 'customer',
					permissions: [],
				},
			}),
		).resolves.toMatchObject({ id: 'cart_1' });
	});

	it('hides user B cart from user A (404, no existence leak)', async () => {
		repo.findById.mockResolvedValueOnce(cart({ userId: 'user_b' }));
		await expect(
			service.getCart('cart_1', {
				principal: {
					userId: 'user_a',
					sessionId: 's',
					audience: 'storefront',
					role: 'customer',
					permissions: [],
				},
			}),
		).rejects.toThrow(NotFoundException);
	});

	it('rejects guest proof A against guest cart B', async () => {
		const guest = service.mintGuestToken();
		const other = service.mintGuestToken();
		repo.findById.mockResolvedValueOnce(cart({ userId: null, guestToken: guest.hash }));
		await expect(service.getCart('cart_1', { guestToken: other.raw })).rejects.toThrow(NotFoundException);
	});

	it('allows the matching guest proof', async () => {
		const guest = service.mintGuestToken();
		repo.findById.mockResolvedValueOnce(cart({ userId: null, guestToken: guest.hash }));
		await expect(service.getCart('cart_1', { guestToken: guest.raw })).resolves.toMatchObject({ id: 'cart_1' });
	});

	it('rejects missing guest proof', async () => {
		const guest = service.mintGuestToken();
		repo.findById.mockResolvedValueOnce(cart({ userId: null, guestToken: guest.hash }));
		await expect(service.getCart('cart_1', { guestToken: null })).rejects.toThrow(NotFoundException);
	});

	it('never lets caller-supplied userId claim another account on create', async () => {
		repo.findByUserId.mockResolvedValueOnce(null);
		const { cart: created } = await service.createCart({
			principal: { userId: 'user_a', sessionId: 's', audience: 'storefront', role: 'customer', permissions: [] },
		});
		expect(created.userId).toBe('user_a');
		expect(created.guestToken).toBeNull();
	});

	it('stores only the guest-token hash and strips it from public carts', async () => {
		const { cart: created, guestTokenRaw } = await service.createCart({});
		expect(guestTokenRaw).toBeTruthy();
		expect(created.guestToken).toBe(service.hashGuestToken(guestTokenRaw!));
		expect(toPublicCart(created).guestToken).toBeNull();
	});

	it('allows staff/admin read bypass but not write', async () => {
		repo.findById.mockResolvedValue(cart({ userId: 'user_b' }));
		const staff = {
			principal: {
				userId: 'staff_1',
				sessionId: 's',
				audience: 'admin' as const,
				role: 'staff' as const,
				permissions: [],
			},
			allowReadRoles: ['staff', 'admin'] as const,
		};
		await expect(service.getCart('cart_1', staff)).resolves.toMatchObject({ id: 'cart_1' });
		await expect(service.addLine('cart_1', { productId: 'p1', quantity: 1 }, staff)).rejects.toThrow(
			NotFoundException,
		);
	});

	it('blocks foreign-cart order adoption without guest proof', async () => {
		repo.findById.mockResolvedValueOnce(cart({ userId: 'user_b' }));
		await expect(
			service.getCartForOrder('cart_1', {
				principal: {
					userId: 'user_a',
					sessionId: 's',
					audience: 'storefront',
					role: 'customer',
					permissions: [],
				},
			}),
		).rejects.toThrow(NotFoundException);
	});
});
