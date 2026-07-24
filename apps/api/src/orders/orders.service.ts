import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
	type AppliedPromotion,
	type Order,
	type OrderLine,
	type OrderStatus,
	Order as OrderSchema,
} from '@saha-textile/contracts';
import {
	type CartRepository,
	type CurrencyRepository,
	type OrderRepository,
	type PageQuery,
	type Paginated,
	type ProductRepository,
	type PromotionRepository,
	applyDiscountINR,
	convertFromINR,
	discountAmountINR,
	roundMoney,
} from '@saha-textile/core-domain';

import {
	CART_REPOSITORY,
	CURRENCY_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	PROMOTION_REPOSITORY,
} from '../infra/tokens';

export interface CreateOrderInput {
	cartId: string;
	currency?: string;
	gateway?: 'ccavenue' | 'paypal';
	couponCode?: string;
	userId?: string | null;
}

@Injectable()
export class OrdersService {
	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
		@Inject(CART_REPOSITORY) private readonly carts: CartRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(CURRENCY_REPOSITORY) private readonly currencies: CurrencyRepository,
		@Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepository,
	) {}

	async createFromCart(input: CreateOrderInput): Promise<Order> {
		const cart = await this.carts.findById(input.cartId);
		if (!cart) throw new NotFoundException(`Cart not found: ${input.cartId}`);
		if (cart.lines.length === 0) throw new BadRequestException('Cannot create an order from an empty cart');

		const currencyCode = (input.currency ?? cart.currency ?? 'INR').toUpperCase();
		const rateFromINR = await this.resolveRate(currencyCode);

		const lines: OrderLine[] = [];
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
			userId: input.userId ?? cart.userId ?? null,
			currency: currencyCode,
			lines,
			subtotalINR,
			subtotalPaid: roundMoney(convertFromINR(subtotalINR, rateFromINR)),
			promotionsApplied,
			totalINR,
			totalPaid: roundMoney(convertFromINR(totalINR, rateFromINR)),
			gateway: input.gateway,
			status: 'pending',
			statusTimeline: [{ status: 'pending', at: new Date().toISOString() }],
		});

		const saved = await this.orders.save(order);
		await this.carts.deleteById(cart.id);
		return saved;
	}

	async getOrder(id: string): Promise<Order> {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException(`Order not found: ${id}`);
		return order;
	}

	listByUser(userId: string, query: PageQuery): Promise<Paginated<Order>> {
		return this.orders.listByUser(userId, query);
	}

	updateStatus(id: string, status: OrderStatus, note?: string): Promise<Order> {
		return this.orders.updateStatus(id, status, note);
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
