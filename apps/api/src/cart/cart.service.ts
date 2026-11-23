import { randomBytes } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Cart, CartLine } from '@saha-textile/contracts';
import type { CartRepository, TransactionContext } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TokenHasher } from '../auth/token-hasher';
import { CART_REPOSITORY } from '../infra/tokens';

export interface CartActor {
	principal?: AuthenticatedPrincipal;
	/** Raw `st_guest` cookie value, when present. */
	guestToken?: string | null;
	/** Permissions that authorize support-read (not mutate) of any cart (`DEC-ACCOUNT-SEPARATION` D4). */
	allowReadPermissions?: readonly string[];
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

	private tokenHasher?: TokenHasher;

	/** The current token key, and the previous one for 30 days after a planned change. */
	private get tokens(): TokenHasher {
		return (this.tokenHasher ??= new TokenHasher(this.config));
	}

	hashGuestToken(raw: string): string {
		return this.tokens.hash(raw);
	}

	/**
	 * The guest cart an `st_guest` token opens, under the current or the previous token key. One found
	 * under the previous key is stored again under the current one, so it outlives the grace period.
	 */
	async findGuestCart(raw: string): Promise<Cart | null> {
		const hit = await this.tokens.find(raw, (hash) => this.carts.findByGuestToken(hash));
		if (!hit) return null;
		if (hit.current) return hit.found;
		return this.carts.save({ ...hit.found, guestToken: this.tokens.hash(raw) });
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
	assertCartAccess(cart: Cart, actor: CartActor): void {
		if (
			actor.principal?.audience === 'admin' &&
			actor.allowReadPermissions?.some((code) => actor.principal!.permissions.includes(code))
		) {
			return;
		}

		if (actor.principal && cart.userId && cart.userId === actor.principal.userId) {
			return;
		}

		if (!cart.userId && cart.guestToken) {
			const presented = actor.guestToken;
			if (presented && this.tokens.matches(presented, cart.guestToken)) {
				return;
			}
		}

		throw new NotFoundException('Cart not found');
	}

	async getCart(id: string, actor: CartActor): Promise<Cart> {
		const cart = await this.carts.findById(id);
		if (!cart) throw new NotFoundException('Cart not found');
		this.assertCartAccess(cart, actor);
		return cart;
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
			if (presented && this.tokens.matches(presented, cart.guestToken)) return cart;
		}

		throw new NotFoundException('Cart not found');
	}

	/** Consume a cart inside an outer commerce transaction (order placement). */
	consumeCart(cartId: string, context?: TransactionContext): Promise<void> {
		return this.carts.deleteById(cartId, context);
	}

	/**
	 * Guest → authenticated cart merge on login/register (Chunk G seam).
	 *
	 * Requires the raw `st_guest` cookie — a guessed cart id alone is not enough.
	 * Stolen cookies that already belong to another user are ignored (no leak, no merge).
	 * Duplicate lines (same product/variation/addons) have quantities summed. A merged line
	 * that no longer fits the stock stays in the cart and reads as `limited`.
	 */
	async mergeGuestCartForUser(userId: string, guestTokenRaw: string | null | undefined): Promise<Cart | null> {
		if (!guestTokenRaw) return this.carts.findByUserId(userId);

		const guest = await this.findGuestCart(guestTokenRaw);
		if (!guest || guest.userId) {
			// Missing, already adopted, or bound to someone else — never leak which.
			return this.carts.findByUserId(userId);
		}

		const owned = await this.carts.findByUserId(userId);
		if (!owned) {
			guest.userId = userId;
			guest.guestToken = null;
			return this.carts.save(guest);
		}

		owned.lines = mergeCartLines(owned.lines, guest.lines);
		await this.carts.save(owned);
		await this.carts.deleteById(guest.id);
		return owned;
	}
}

/** Two lines with this key are the same choice, so they hold one quantity. */
export function lineKey(line: CartLine): string {
	const addons = [...(line.addons ?? [])]
		.map((addon) => `${addon.code}=${String(addon.value)}`)
		.sort()
		.join('|');
	// A set's choices and a product's free items make a line of their own (two sets with different picks are two lines).
	const choices = JSON.stringify({ bundle: line.bundle ?? null, free: line.free ?? [] });
	return `${line.productId}\0${line.variationId ?? ''}\0${addons}\0${choices}`;
}

function mergeCartLines(into: CartLine[], from: CartLine[]): CartLine[] {
	const merged = [...into];
	const indexByKey = new Map(merged.map((line, index) => [lineKey(line), index]));
	for (const line of from) {
		const key = lineKey(line);
		const existing = indexByKey.get(key);
		if (existing === undefined) {
			indexByKey.set(key, merged.length);
			merged.push(line);
			continue;
		}
		merged[existing] = {
			...merged[existing]!,
			quantity: merged[existing]!.quantity + line.quantity,
		};
	}
	return merged;
}
