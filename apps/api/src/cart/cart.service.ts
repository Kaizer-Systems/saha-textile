import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Cart, type CartLine, Cart as CartSchema } from '@saha/contracts';
import type { CartRepository } from '@saha/core-domain';

import { CART_REPOSITORY } from '../infra/tokens';

export interface AddLineInput {
	productId: string;
	variationId?: string | null;
	quantity: number;
	addons?: { code: string; value: string | number }[];
}

@Injectable()
export class CartService {
	constructor(@Inject(CART_REPOSITORY) private readonly carts: CartRepository) {}

	createCart(input: { userId?: string | null; guestToken?: string | null; currency?: string }): Promise<Cart> {
		const cart = CartSchema.parse({
			id: `cart_${randomUUID()}`,
			userId: input.userId ?? null,
			guestToken: input.guestToken ?? (input.userId ? null : randomUUID()),
			currency: input.currency ?? 'INR',
			lines: [],
		});
		return this.carts.save(cart);
	}

	async getCart(id: string): Promise<Cart> {
		const cart = await this.carts.findById(id);
		if (!cart) throw new NotFoundException(`Cart not found: ${id}`);
		return cart;
	}

	async addLine(cartId: string, input: AddLineInput): Promise<Cart> {
		const cart = await this.getCart(cartId);
		const line: CartLine = {
			id: `line_${randomUUID()}`,
			productId: input.productId,
			variationId: input.variationId ?? null,
			quantity: input.quantity,
			addons: input.addons ?? [],
		};
		cart.lines.push(line);
		return this.carts.save(cart);
	}

	async updateLineQuantity(cartId: string, lineId: string, quantity: number): Promise<Cart> {
		const cart = await this.getCart(cartId);
		const line = cart.lines.find((l) => l.id === lineId);
		if (!line) throw new NotFoundException(`Cart line not found: ${lineId}`);
		line.quantity = quantity;
		return this.carts.save(cart);
	}

	async removeLine(cartId: string, lineId: string): Promise<Cart> {
		const cart = await this.getCart(cartId);
		const before = cart.lines.length;
		cart.lines = cart.lines.filter((l) => l.id !== lineId);
		if (cart.lines.length === before) throw new NotFoundException(`Cart line not found: ${lineId}`);
		return this.carts.save(cart);
	}
}
