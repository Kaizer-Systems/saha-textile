import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
	CheckoutAddressChoice,
	CheckoutQuote,
	CheckoutRequest,
	Customer,
	PayBlockedReason,
} from '@saha-textile/contracts';
import {
	applyCoupons,
	asksForAddressInHomeCountry,
	decideInvoiceAddress,
	firstCurrencyFor,
	isCompleteIndianAddress,
	warnIndiaBillingForeignCurrency,
	type CouponContext,
	type CouponDefinition,
	type CouponRepository,
	type CustomerRepository,
	type AdminOrderRepository,
	type OrderSettingsRepository,
	type ShippingRuleRepository,
} from '@saha-textile/core-domain';

import { AddressBookService, type CheckedPostalAddress } from '../addresses/address-book.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CartLinesService } from '../cart/cart-lines.service';
import { codedRefusal } from '../common/coded-refusal';
import { CurrencyService } from '../currency/currency.service';
import type { PaymentRequestPorts } from '../infra/payment-gateway-factory';
import {
	ADMIN_ORDER_REPOSITORY,
	COUPON_REPOSITORY,
	CUSTOMER_REPOSITORY,
	ORDER_SETTINGS_REPOSITORY,
	PAYMENT_REQUEST_PORTS,
	SHIPPING_RULE_REPOSITORY,
} from '../infra/tokens';
import { ZonePricingService } from '../orders-setup/zone-pricing.service';
import { DEFAULT_SHIPPING_SETTINGS, ShippingAdminService } from '../shipping/shipping-admin.service';

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

/**
 * The shop checkout's quote (shipping brief shop01–shop06; orders brief shop07–shop17): the shipping
 * line with its reason, the optional "Address in India" step (both addresses abroad, export-off
 * path), coupons, the quiet "Pay in ₹ instead" note for buyers billed in India (K2), the currency
 * picker for buyers billed abroad paying ₹ before the INR gateway takes foreign cards (S5/S7), and
 * Pay held off when a piece can't go to the delivery country. Shop words never mention invoices,
 * GST or gateways; the reasons are codes the shop turns into its own words.
 */
@Injectable()
export class ShopCheckoutService {
	constructor(
		private readonly cart: CartLinesService,
		private readonly addressBook: AddressBookService,
		private readonly shipping: ShippingAdminService,
		private readonly currency: CurrencyService,
		private readonly zones: ZonePricingService,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: AdminOrderRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(SHIPPING_RULE_REPOSITORY) private readonly shippingRules: ShippingRuleRepository,
		@Inject(PAYMENT_REQUEST_PORTS) private readonly gateways: PaymentRequestPorts,
	) {}

	async quote(
		input: CheckoutRequest,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CheckoutQuote> {
		if (!principal || principal.audience !== 'storefront') throw new UnauthorizedException('Sign in to check out');
		const customer = await this.customers.findById(principal.userId);
		if (!customer) throw new UnauthorizedException('Account not found');
		const view = await this.cart.current({ principal });
		const settings = await this.settings.get();
		const shippingSettings = (await this.shippingRules.getSettings()) ?? DEFAULT_SHIPPING_SETTINGS;
		const delivery = await this.address(input.delivery, customer, 'delivery');
		const billing = input.billing ? await this.address(input.billing, customer, 'billing') : delivery;
		const billingCountry = billing.countryCode ?? billing.country;
		const deliveryCountry = delivery.countryCode ?? delivery.country;

		let payBlocked: PayBlockedReason | null = view.lines.length ? null : 'cartEmpty';
		if (!payBlocked && view.lines.some((line) => line.problem && line.problem !== 'limited'))
			payBlocked = 'lineProblem';

		const india = input.addressInIndia ? { ...input.addressInIndia, country: shippingSettings.homeCountry } : null;
		const decision = decideInvoiceAddress({
			policy: shippingSettings.abroadPolicy,
			homeCountry: shippingSettings.homeCountry,
			billing: { ...billing, country: billingCountry },
			delivery: { ...delivery, country: deliveryCountry },
			givenAtCheckout: india,
			addedByStaff: null,
		});
		if (decision.status === 'notAllowed') payBlocked ??= 'deliveryAbroadNotOffered';
		const showAddressInIndia =
			asksForAddressInHomeCountry(
				shippingSettings.abroadPolicy,
				shippingSettings.homeCountry,
				billingCountry,
				deliveryCountry,
				shippingSettings.abroadOptions.askForHomeAddress,
			) && !(india && isCompleteIndianAddress(india));

		// Shipping from the live rule sets; a length of fabric is one unit.
		const quote = view.lines.length
			? await this.shipping.tryCart({
					lines: view.lines.map((line) => ({
						productId: line.productId,
						variationId: line.variationId,
						quantity: line.soldBy === 'metre' ? 1 : Math.min(99, line.quantity),
					})),
					delivery: {
						country: deliveryCountry,
						state: delivery.state ?? null,
						pincode: delivery.postalCode || null,
					},
					shopper: {
						signedIn: true,
						groups: [],
						firstOrder: (await this.orders.countPlacedByCustomer(customer.id)) === 0,
					},
				})
			: null;
		const cannotShip = new Map<number, string>();
		quote?.lines.forEach((line, index) => {
			if (line.route === 'cantShip') cannotShip.set(index, 'cantShipThere');
		});
		if (cannotShip.size) payBlocked ??= 'pieceCannotShip';

		const code = input.currency.toUpperCase();
		const conversion = await this.currency.convert(0, code).catch(() => {
			throw new BadRequestException(codedRefusal('currency_unknown', 'That currency is not on sale', 'currency'));
		});
		if (!this.gateways.get(code === 'INR' ? 'ccavenue' : 'paypal')) payBlocked ??= 'noGateway';
		const convert = (amountINR: number) =>
			code === 'INR'
				? round2(amountINR)
				: round2(amountINR * conversion.rateFromINR * (1 + conversion.markupPercent / 100));

		// Coupons (OD4): sale pieces left out unless the coupon includes them; never delivery.
		const facts = view.lines.length
			? await this.zones.factsFor(
					view.lines.map((line) => ({ productId: line.productId, variantId: line.variationId, quantity: 1 })),
					now,
				)
			: [];
		const couponLines = view.lines.map((line, index) => ({
			lineId: line.id,
			productId: line.productId,
			categoryIds: [...new Set(facts[index]?.facts.categoryPaths.flat() ?? [])],
			amountINR: line.lineTotalINR,
			onSale: facts[index]?.facts.currentSaleINR != null,
			zonePriced: false,
		}));
		const definitions: CouponDefinition[] = [];
		const contexts = new Map<string, CouponContext>();
		const unknown: CheckoutQuote['couponRefusals'] = [];
		const firstOrder = (await this.orders.countPlacedByCustomer(customer.id)) === 0;
		for (const typed of [...new Set(input.couponCodes.map((value) => value.toUpperCase()))]) {
			const coupon = await this.coupons.findByCode(typed);
			if (!coupon) {
				unknown.push({ code: typed, refusal: 'unknown' });
				continue;
			}
			definitions.push(coupon);
			contexts.set(coupon.id, {
				channel: 'shop',
				now: now.toISOString(),
				buyer: { kind: 'person', customerId: customer.id, isFirstOrder: firstOrder },
				usesByThisBuyer: await this.coupons.usesBy(coupon.id, `customer:${customer.id}`),
				usesInAll: coupon.usedCount ?? 0,
				deliveryINR: quote?.amountINR ?? 0,
			});
		}
		const run = applyCoupons(definitions, couponLines, contexts);
		const couponByLine = new Map<string, number>();
		for (const applied of run.applied) {
			for (const row of applied.lines)
				couponByLine.set(row.lineId, round2((couponByLine.get(row.lineId) ?? 0) + row.amountINR));
		}
		const goodsINR = round2(view.lines.reduce((sum, line) => sum + line.lineTotalINR, 0));
		const couponINR = round2(run.applied.reduce((sum, row) => sum + row.amountINR, 0));
		const shippingINR = round2(
			Math.max(
				0,
				(quote?.amountINR ?? 0) - run.applied.reduce((sum, row) => sum + (row.deliveryAmountINR ?? 0), 0),
			),
		);
		const totalINR = round2(goodsINR - couponINR + shippingINR);

		const notes: CheckoutQuote['notes'] = [];
		if (settings.warnIndiaBillingForeignCurrency && warnIndiaBillingForeignCurrency(billingCountry, code)) {
			notes.push('payFromIndiaInRupees');
		}
		if (settings.importDutyNotice === 'buyerPaysOnDelivery' && deliveryCountry !== shippingSettings.homeCountry) {
			notes.push('importDutyBuyerPays');
		}
		const enabled = (await this.currency.listEnabled()).map((row) => row.code);
		const currencyPicker =
			code === 'INR' && billingCountry !== shippingSettings.homeCountry && !settings.inrGatewayForeignCards
				? (() => {
						const first = firstCurrencyFor(billingCountry, enabled);
						return first ? { first } : null;
					})()
				: null;

		return {
			currency: code,
			lines: view.lines.map((line, index) => ({
				lineId: line.id,
				title: line.title,
				quantity: line.quantity,
				unitPrice: convert(line.unitPriceINR),
				lineTotal: convert(line.lineTotalINR),
				couponAmount: convert(couponByLine.get(line.id) ?? 0),
				cannotShipReason: cannotShip.get(index) ?? null,
			})),
			shipping: {
				charge: convert(shippingINR),
				chargeINR: shippingINR,
				reason: (quote?.groups ?? [])
					.flatMap((group) => group.trace.map((entry) => JSON.stringify(entry)))
					.slice(0, 20),
				zone: quote?.zone ?? (deliveryCountry === shippingSettings.homeCountry ? 'domestic' : 'international'),
			},
			coupons: run.applied,
			couponRefusals: [...unknown, ...run.refused.map((row) => ({ code: row.code, refusal: row.refusal }))],
			totals: {
				goods: convert(goodsINR),
				coupon: convert(couponINR),
				shipping: convert(shippingINR),
				total: convert(totalINR),
				totalINR,
			},
			showAddressInIndia,
			notes,
			currencyPicker,
			payBlocked,
		};
	}

	private async address(
		choice: CheckoutAddressChoice,
		customer: Customer,
		path: 'delivery' | 'billing',
	): Promise<CheckedPostalAddress> {
		if (choice.kind === 'saved') {
			const row = customer.addresses.find((candidate) => candidate.id === choice.savedAddressId);
			if (!row)
				throw new BadRequestException(
					codedRefusal('address_missing', 'That saved address does not exist', path),
				);
			return row as CheckedPostalAddress;
		}
		return this.addressBook.check(choice.address);
	}
}
