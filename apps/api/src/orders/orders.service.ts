import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
	type AppliedPromotion,
	type Order,
	type ShopOrderPage,
	type ShopOrderView,
	type OrderLineInput,
	type OrderStatus,
	Order as OrderSchema,
} from '@saha-textile/contracts';
import {
	type CurrencyRepository,
	type OrderRepository,
	type PageQuery,
	type Paginated,
	type ProductRepository,
	type PromotionRepository,
	type TransactionManagerPort,
	applyDiscountINR,
	convertFromINR,
	discountAmountINR,
	roundMoney,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CartService } from '../cart/cart.service';
import { shopOrderSummary, shopOrderView } from './shop-order-view';
import {
	CURRENCY_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	PROMOTION_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';

export interface CreateOrderInput {
	cartId: string;
	currency?: string;
	gateway?: 'ccavenue' | 'paypal';
	couponCode?: string;
	principal: AuthenticatedPrincipal;
	guestToken?: string | null;
	/** The page language the order was placed from (BN-13). */
	locale?: string;
}

@Injectable()
export class OrdersService {
	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(CURRENCY_REPOSITORY) private readonly currencies: CurrencyRepository,
		@Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		private readonly carts: CartService,
	) {}

	/**
	 * Creates an order from a cart inside one Mongo transaction (order save + cart
	 * consumption). Ownership/adoption is enforced before any write.
	 *
	 * Idempotency keys are a Chunk G seam: without one, a client retry after a commit
	 * that lost its response can create a second order. Atomicity here prevents the
	 * worse half-state (order saved, cart still present) — it does not dedupe retries.
	 */
	async createFromCart(input: CreateOrderInput): Promise<Order> {
		const cart = await this.carts.getCartForOrder(input.cartId, {
			principal: input.principal,
			guestToken: input.guestToken,
		});
		if (cart.lines.length === 0) throw new BadRequestException('Cannot create an order from an empty cart');

		const currencyCode = (input.currency ?? cart.currency ?? 'INR').toUpperCase();
		const rateFromINR = await this.resolveRate(currencyCode);

		const lines: OrderLineInput[] = [];
		for (const cartLine of cart.lines) {
			const product = await this.products.findById(cartLine.productId);
			if (!product) throw new BadRequestException(`Product not found: ${cartLine.productId}`);

			const variation = cartLine.variationId
				? product.variations.find((v) => v.id === cartLine.variationId)
				: undefined;
			if (cartLine.variationId && !variation) {
				throw new BadRequestException(`Variation not found: ${cartLine.variationId}`);
			}

			const unitPriceINR = variation ? (variation.salePriceINR ?? variation.priceINR) : product.basePriceINR;
			const lineTotalINR = roundMoney(unitPriceINR * cartLine.quantity);

			lines.push({
				productId: product.id,
				variationId: cartLine.variationId ?? null,
				title: product.title,
				sku: variation?.sku ?? product.sku,
				quantity: cartLine.quantity,
				attributes: variation?.attributes ?? {},
				addons: cartLine.addons.map((a) => ({ code: a.code, value: a.value })),
				unitPriceINR,
				unitPricePaid: roundMoney(convertFromINR(unitPriceINR, rateFromINR)),
				lineTotalINR,
				lineTotalPaid: roundMoney(convertFromINR(lineTotalINR, rateFromINR)),
			});
		}

		const subtotalINR = roundMoney(lines.reduce((sum, l) => sum + l.lineTotalINR, 0));
		const { totalINR, promotionsApplied } = await this.applyCoupon(subtotalINR, input.couponCode);

		const order = OrderSchema.parse({
			id: `order_${randomUUID()}`,
			orderNumber: this.generateOrderNumber(),
			userId: input.principal.userId,
			currency: currencyCode,
			locale: input.locale ?? 'en',
			lines,
			subtotalINR,
			subtotalPaid: roundMoney(convertFromINR(subtotalINR, rateFromINR)),
			promotionsApplied,
			totalINR,
			totalPaid: roundMoney(convertFromINR(totalINR, rateFromINR)),
			gateway: input.gateway,
			status: 'awaiting_payment',
			statusTimeline: [{ status: 'awaiting_payment', at: new Date().toISOString() }],
		});

		return this.transactions.withTransaction(async (context) => {
			const saved = await this.orders.save(order, context);
			await this.carts.consumeCart(cart.id, context);
			return saved;
		});
	}

	async getOrder(id: string): Promise<Order> {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException(`Order not found: ${id}`);
		return order;
	}

	/** A shopper's own orders, newest first, in the shape the shop shows (brief E06). */
	async shopList(userId: string, query: PageQuery): Promise<ShopOrderPage> {
		const page = await this.orders.listByUser(userId, query);
		return {
			items: page.items.map(shopOrderSummary),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		};
	}

	/** One of the shopper's own orders by its number (E05); another's is "not found", never "forbidden". */
	async shopView(userId: string, orderNumber: string): Promise<ShopOrderView> {
		// Shop addresses are lower case ("/account/order/details/st-2611-482190"); order numbers are kept upper case.
		const typed = orderNumber.trim();
		const order =
			(await this.orders.findByOrderNumber(typed)) ?? (await this.orders.findByOrderNumber(typed.toUpperCase()));
		return ownOrderView(order, userId);
	}

	listByUser(userId: string, query: PageQuery): Promise<Paginated<Order>> {
		return this.orders.listByUser(userId, query);
	}

	/**
	 * Advances an order's status.
	 *
	 * The repository throws a bare `Error` for an id it cannot find, which reached the client
	 * as a **500** — an operator mistyping an order reference was told the server had broken.
	 * A missing order is a 404: the caller's request was about something that is not there,
	 * which is their problem to correct rather than an incident to page somebody about.
	 *
	 * Narrow on purpose. Any OTHER repository failure still propagates as a 500, because a
	 * write that failed for a reason nobody has anticipated must not be reported as "no such
	 * order" — that would turn a genuine outage into a message telling the operator to check
	 * their typing.
	 */
	async updateStatus(id: string, status: OrderStatus, note?: string): Promise<Order> {
		try {
			return await this.orders.updateStatus(id, status, note);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Order not found')) {
				throw new NotFoundException('Order not found');
			}
			throw error;
		}
	}

	private async resolveRate(currencyCode: string): Promise<number> {
		if (currencyCode === 'INR') return 1;
		const currency = await this.currencies.findByCode(currencyCode);
		if (!currency || !currency.enabled) throw new BadRequestException(`Unsupported currency: ${currencyCode}`);
		return currency.rateFromINR;
	}

	private async applyCoupon(
		subtotalINR: number,
		couponCode?: string,
	): Promise<{ totalINR: number; promotionsApplied: AppliedPromotion[] }> {
		if (!couponCode) return { totalINR: subtotalINR, promotionsApplied: [] };

		const promo = await this.promotions.findByCouponCode(couponCode.trim().toUpperCase());
		if (!promo) throw new BadRequestException(`Invalid coupon: ${couponCode}`);
		if (subtotalINR < promo.conditions.minCartINR) {
			throw new BadRequestException(`Cart subtotal below the minimum for coupon ${couponCode}`);
		}

		const amountINR = roundMoney(discountAmountINR(subtotalINR, promo));
		const totalINR = roundMoney(applyDiscountINR(subtotalINR, promo));
		return {
			totalINR,
			promotionsApplied: [{ promotionId: promo.id, code: promo.couponCode, amountINR }],
		};
	}

	private generateOrderNumber(): string {
		const now = new Date();
		const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
		const rand = randomUUID().slice(0, 6).toUpperCase();
		return `SAHA-TEXTILE-${stamp}-${rand}`;
	}
}

/**
 * The shopper's own order as the shop shows it; anyone else's is "not found". Kept out of the async method: V8
 * counted the else of an if-throw right after an await as never run (or less than never).
 */
function ownOrderView(order: Order | null, userId: string): ShopOrderView {
	if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
	return shopOrderView(order);
}
