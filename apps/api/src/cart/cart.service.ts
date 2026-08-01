import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Cart, type CartLine, Cart as CartSchema } from '@saha-textile/contracts';
import type { CartRepository, TransactionContext } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CART_REPOSITORY } from '../infra/tokens';

export interface AddLineInput {
	productId: string;
	variationId?: string | null;
	quantity: number;
	addons?: { code: string; value: string | number }[];
}

export interface CartActor {
	principal?: AuthenticatedPrincipal;
	/** Raw `st_guest` cookie value, when present. */
	guestToken?: string | null;
	/** Roles allowed to read (not mutate) any cart for support. */
	allowReadRoles?: readonly string[];
}

/** API-facing cart: never expose the stored guest-token hash. */
export function toPublicCart(cart: Cart): Cart {
	return { ...cart, guestToken: null };
}

@Injectable()
export class CartService {
	constructor(
		@Inject(CART_REPOSITORY) private readonly carts: CartRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	hashGuestToken(raw: string): string {
		const pepper = this.config.cookies.csrfSecret ?? this.config.jwt.refreshSecret;
		return createHmac('sha256', pepper).update(raw).digest('hex');
	}

	mintGuestToken(): { raw: string; hash: string } {
		const raw = randomBytes(32).toString('base64url');
		return { raw, hash: this.hashGuestToken(raw) };
	}

	/**
	 * Object-level cart authorization.
	 *
	 * Authenticated ownership is derived from Principal — never from a request-body
	 * userId. Guest carts require the unguessable `st_guest` bearer whose hash is stored
	 * on the cart. Cross-owner failures are indistinguishable from missing resources.
	 */
	assertCartAccess(cart: Cart, actor: CartActor, mode: 'read' | 'write'): void {
		if (mode === 'read' && actor.principal && actor.allowReadRoles?.includes(actor.principal.role)) {
			return;
		}

		if (actor.principal && cart.userId && cart.userId === actor.principal.userId) {
			return;
		}

		if (!cart.userId && cart.guestToken) {
			const presented = actor.guestToken;
			if (presented && this.hashGuestToken(presented) === cart.guestToken) {
				return;
			}
		}

		throw new NotFoundException('Cart not found');
	}

	async createCart(input: {
		principal?: AuthenticatedPrincipal;
		currency?: string;
	}): Promise<{ cart: Cart; guestTokenRaw: string | null }> {
		if (input.principal) {
			const existing = await this.carts.findByUserId(input.principal.userId);
			if (existing) return { cart: existing, guestTokenRaw: null };

			const cart = CartSchema.parse({
				id: `cart_${randomUUID()}`,
				userId: input.principal.userId,
				guestToken: null,
				currency: input.currency ?? 'INR',
				lines: [],
			});
			return { cart: await this.carts.save(cart), guestTokenRaw: null };
		}

		const guest = this.mintGuestToken();
		const cart = CartSchema.parse({
			id: `cart_${randomUUID()}`,
			userId: null,
			guestToken: guest.hash,
			currency: input.currency ?? 'INR',
			lines: [],
		});
		return { cart: await this.carts.save(cart), guestTokenRaw: guest.raw };
	}

	async getCart(id: string, actor: CartActor): Promise<Cart> {
		const cart = await this.carts.findById(id);
		if (!cart) throw new NotFoundException('Cart not found');
		this.assertCartAccess(cart, actor, 'read');
		return cart;
	}

	async addLine(cartId: string, input: AddLineInput, actor: CartActor): Promise<Cart> {
		const cart = await this.getAuthorizedCart(cartId, actor, 'write');
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

	async updateLineQuantity(cartId: string, lineId: string, quantity: number, actor: CartActor): Promise<Cart> {
		const cart = await this.getAuthorizedCart(cartId, actor, 'write');
		const line = cart.lines.find((l) => l.id === lineId);
		if (!line) throw new NotFoundException('Cart not found');
		line.quantity = quantity;
		return this.carts.save(cart);
	}

	async removeLine(cartId: string, lineId: string, actor: CartActor): Promise<Cart> {
		const cart = await this.getAuthorizedCart(cartId, actor, 'write');
		const before = cart.lines.length;
		cart.lines = cart.lines.filter((l) => l.id !== lineId);
		if (cart.lines.length === before) throw new NotFoundException('Cart not found');
		return this.carts.save(cart);
	}

	/**
	 * Order-creation ownership: the cart must belong to the principal, or be a guest cart
	 * the principal legitimately proves via `st_guest` (adoption at checkout).
	 */
	async getCartForOrder(cartId: string, actor: Required<Pick<CartActor, 'principal'>> & CartActor): Promise<Cart> {
		const cart = await this.carts.findById(cartId);
		if (!cart) throw new NotFoundException('Cart not found');

		if (cart.userId && cart.userId === actor.principal?.userId) return cart;

		if (!cart.userId && cart.guestToken) {
			const presented = actor.guestToken;
			if (presented && this.hashGuestToken(presented) === cart.guestToken) return cart;
		}

		throw new NotFoundException('Cart not found');
	}

	/** Consume a cart inside an outer commerce transaction (order placement). */
	consumeCart(cartId: string, context?: TransactionContext): Promise<void> {
		return this.carts.deleteById(cartId, context);
	}

	private async getAuthorizedCart(cartId: string, actor: CartActor, mode: 'read' | 'write'): Promise<Cart> {
		const cart = await this.carts.findById(cartId);
		if (!cart) throw new NotFoundException('Cart not found');
		this.assertCartAccess(cart, actor, mode);
		return cart;
	}
}
