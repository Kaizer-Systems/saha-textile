import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
	CartView,
	CheckoutAddressChoice,
	CheckoutHandoff,
	CheckoutPlace,
	CheckoutQuote,
	CheckoutRequest,
	Customer,
	Order,
	OrderLine,
	PayBlockedReason,
	ShippingCartTryResult,
} from '@saha-textile/contracts';
import {
	DuplicateOrderKeyError,
	applyCoupons,
	asksForAddressInHomeCountry,
	decideInvoiceAddress,
	firstCurrencyFor,
	holdIsLive,
	holdUntilFrom,
	isCompleteIndianAddress,
	orderBalance,
	warnIndiaBillingForeignCurrency,
	type AdminOrderRepository,
	type CouponContext,
	type CouponDefinition,
	type CouponRepository,
	type CustomerRepository,
	type OrderSettingsRepository,
	type ShippingRuleRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { AddressBookService, type CheckedPostalAddress } from '../addresses/address-book.service';
import { historyEntry, metaOf } from '../admin-orders/admin-orders.service';
import { OrderStock } from '../admin-orders/order-stock';
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
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { ZonePricingService } from '../orders-setup/zone-pricing.service';
import { DEFAULT_SHIPPING_SETTINGS, ShippingAdminService } from '../shipping/shipping-admin.service';
import { ShopPaymentsService } from './shop-payments.service';

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

/** Everything the quote worked out, kept for placing the order from the same figures. */
interface Built {
	quote: CheckoutQuote;
	customer: Customer;
	view: CartView;
	delivery: CheckedPostalAddress;
	billing: CheckedPostalAddress;
	india: (CheckedPostalAddress & { country: string }) | null;
	invoice: NonNullable<Order['addresses']>['invoice'];
	shipping: ShippingCartTryResult | null;
	facts: Awaited<ReturnType<ZonePricingService['factsFor']>>;
	conversion: { rateFromINR: number; markupPercent: number };
	couponByLine: Map<string, number>;
}

/**
 * The shop checkout (shipping brief shop01–shop06; orders brief shop07–shop17): the shipping line
 * with its reason, the optional "Address in India" step (both addresses abroad, export-off path),
 * coupons, the quiet "Pay in ₹ instead" note for buyers billed in India (K2), the currency picker
 * for buyers billed abroad paying ₹ before the INR gateway takes foreign cards (S5/S7), and Pay held
 * off when a piece can't go to the delivery country. Shop words never mention invoices, GST or
 * gateways; the reasons are codes the shop turns into its own words.
 *
 * Pay (`place`) saves the order from the same figures the quote showed, takes its number, holds the
 * pieces for 15 minutes (OD1) and starts the payment; `ShopPaymentsService` takes it from there.
 */
@Injectable()
export class ShopCheckoutService {
	constructor(
		private readonly cart: CartLinesService,
		private readonly addressBook: AddressBookService,
		private readonly shipping: ShippingAdminService,
		private readonly currency: CurrencyService,
		private readonly zones: ZonePricingService,
		private readonly numbers: DocumentNumbersService,
		private readonly stock: OrderStock,
		private readonly payments: ShopPaymentsService,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: AdminOrderRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(SHIPPING_RULE_REPOSITORY) private readonly shippingRules: ShippingRuleRepository,
		@Inject(PAYMENT_REQUEST_PORTS) private readonly gateways: PaymentRequestPorts,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	async quote(
		input: CheckoutRequest,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CheckoutQuote> {
		return (await this.build(input, principal, now)).quote;
	}

	/**
	 * Pay. A repeated key (a double press, or Pay again after an unfinished payment) reuses the order:
	 * its pieces are held again when the hold has ended, and a new attempt starts.
	 */
	async place(
		input: CheckoutPlace,
		principal: AuthenticatedPrincipal | undefined,
		locale: string,
		now = new Date(),
	): Promise<CheckoutHandoff> {
		if (!principal || principal.audience !== 'storefront') throw new UnauthorizedException('Sign in to check out');
		const key = `shop:${principal.userId}:${input.idempotencyKey}`;
		const existing = await this.orders.findByIdempotencyKey(key);
		const order = existing
			? await this.reuse(existing, now)
			: await this.create(input, principal, key, locale, now);
		const attempt = await this.payments.start(order, order.locale ?? locale, now);
		if (!attempt.handoff) {
			throw new ConflictException(codedRefusal('payment_not_started', 'The payment could not start', 'pay'));
		}
		return { orderId: order.id, orderNumber: order.orderNumber, handoff: attempt.handoff };
	}

	private async reuse(order: Order, now: Date): Promise<Order> {
		if (order.status !== 'awaiting_payment') {
			throw new ConflictException(
				codedRefusal('order_not_payable', 'This order is no longer waiting for payment', 'pay', {
					status: order.status,
					orderNumber: order.orderNumber,
				}),
			);
		}
		if (holdIsLive(order.holdUntil, now) && order.lines.some((line) => line.held)) return order;
		const at = now.toISOString();
		return this.transactions.withTransaction(async (context) => {
			const current = (await this.orders.findById(order.id)) ?? order;
			const held = current.lines.some((line) => line.held);
			if (!held) await this.stock.reserve(current, current.lines, null, context, at);
			const next: Order = {
				...current,
				holdUntil: holdUntilFrom(now),
				lines: current.lines.map((line) => ({ ...line, held: !line.madeToOrder })),
				history: [...current.history, historyEntry(SHOPPER, at, 'payment', { detail: { hold: 'set' } })],
			};
			return this.orders.update(next, current.revision, context, metaOf(next));
		});
	}

	private async create(
		input: CheckoutPlace,
		principal: AuthenticatedPrincipal,
		key: string,
		locale: string,
		now: Date,
	): Promise<Order> {
		const built = await this.build(input, principal, now);
		const { quote } = built;
		if (quote.payBlocked) {
			throw new ConflictException(
				codedRefusal('pay_blocked', 'Pay is off for this checkout', 'checkout', { reason: quote.payBlocked }),
			);
		}
		// "Save to my addresses" with "Name this address" (shop17): saved when Pay is pressed.
		for (const choice of [input.delivery, input.billing]) {
			if (choice?.kind === 'new' && choice.saveAs) {
				await this.addressBook.add(built.customer.id, {
					...choice.address,
					label: choice.saveAs,
					isDefault: false,
				});
			}
		}
		const at = now.toISOString();
		const actor = { id: built.customer.id, name: built.customer.displayName ?? built.billing.fullName };
		const lines = this.orderLines(built, at);
		const deliveryCountry = built.delivery.countryCode ?? built.delivery.country;
		const base: Omit<Order, 'id' | 'orderNumber'> = {
			userId: built.customer.id,
			currency: quote.currency,
			locale,
			lines,
			subtotalINR: round2(built.view.lines.reduce((sum, line) => sum + line.lineTotalINR, 0)),
			subtotalPaid: quote.totals.goods,
			shipping: {
				value: quote.shipping.charge,
				currency: quote.currency,
				chargeINR: quote.shipping.chargeINR,
				zone: quote.shipping.zone,
				deliveryCountry,
				trace: quote.shipping.reason,
				ruleSets: (built.shipping?.groups ?? []).flatMap((group) =>
					group.ruleSetId && group.version
						? [{ id: group.ruleSetId, version: group.version, name: group.ruleSetName ?? '' }]
						: [],
				),
				pending: false,
				pieces: (built.shipping?.lines ?? []).map((line) => ({
					lineId: line.lineId,
					units: line.units,
					discounted: line.discounted,
				})),
			},
			promotionsApplied: [],
			totalINR: quote.totals.totalINR,
			totalPaid: quote.totals.total,
			gateway: quote.currency === 'INR' ? 'ccavenue' : 'paypal',
			status: 'awaiting_payment',
			statusTimeline: [{ status: 'awaiting_payment', at }],
			channel: 'shop',
			createdBy: null,
			buyer: {
				kind: 'person',
				customerId: built.customer.id,
				businessId: null,
				name: built.customer.displayName ?? built.billing.fullName,
				email: built.customer.email ?? null,
				mobile: built.billing.mobile ?? null,
				gstin: null,
			},
			addresses: {
				billing: { ...built.billing, savedAddressId: savedId(input.billing ?? input.delivery) },
				delivery: { ...built.delivery, savedAddressId: savedId(input.delivery) },
				billingSameAsDelivery: input.billing === null,
				addressInIndia: built.india ? { ...built.india, savedAddressId: null } : null,
				invoice: built.invoice,
			},
			currencyRecord: {
				code: quote.currency,
				rateFromINR: built.conversion.rateFromINR,
				inrPerUnit: built.conversion.rateFromINR > 0 ? round2(1 / built.conversion.rateFromINR) : null,
				source: quote.currency === 'INR' ? 'home' : 'fetch',
				rateSetAt: null,
				markupPercent: built.conversion.markupPercent,
				pricedAt: at,
			},
			zone: null,
			coupons: quote.coupons,
			balance: orderBalance({
				lineTotalsINR: lines.map((line) => line.lineTotalINR),
				couponINR: round2(quote.coupons.reduce((sum, row) => sum + row.amountINR, 0)),
				shippingINR: quote.shipping.chargeINR,
				payments: [],
			}),
			paymentStatus: 'unpaid',
			placedWith: null,
			holdUntil: holdUntilFrom(now),
			openedAt: null,
			closedAt: null,
			eInvoice: null,
			eWayBill: null,
			history: [historyEntry(actor, at, 'created', { detail: { channel: 'shop', currency: quote.currency } })],
			revision: 0,
			createdAt: at,
			updatedAt: at,
		};
		for (let retry = 0; ; retry += 1) {
			try {
				return await this.transactions.withTransaction(async (context) => {
					const orderNumber = await this.numbers.orderNumber(context, now);
					const order: Order = {
						...base,
						id: `ord_${randomUUID()}`,
						orderNumber,
						lines: base.lines.map((line) => ({ ...line, held: !line.madeToOrder })),
					};
					await this.stock.reserve(order, order.lines, built.customer.id, context, at);
					return this.orders.create(order, key, context, metaOf(order));
				});
			} catch (error) {
				if (error instanceof DuplicateOrderKeyError && error.key === 'orderNumber' && retry < 4) continue;
				if (error instanceof DuplicateOrderKeyError && error.key === 'idempotencyKey') {
					const first = await this.orders.findByIdempotencyKey(key);
					if (first) return this.reuse(first, now);
				}
				throw error;
			}
		}
	}

	/** The order's lines, frozen from the cart as the shopper saw it (DEC-ORDER-SNAPSHOT A). */
	private orderLines(built: Built, at: string): OrderLine[] {
		const { rateFromINR, markupPercent } = built.conversion;
		const convert = (amountINR: number) =>
			built.quote.currency === 'INR' ? amountINR : round2(amountINR * rateFromINR * (1 + markupPercent / 100));
		return built.view.lines.map((line, index) => {
			const fact = built.facts[index]?.facts;
			return {
				lineId: line.id,
				productId: line.productId,
				variationId: line.variationId,
				title: { en: line.title },
				sku: line.sku || line.productId,
				quantity: line.quantity,
				attributes: Object.fromEntries(
					line.options.map((option) => [option.group || option.code, option.value]),
				),
				addons: [
					...line.options
						.filter((option) => option.priceDeltaINR !== 0)
						.map((option) => ({
							code: option.code,
							label: option.group,
							value: option.value,
							priceINR: option.priceDeltaINR,
						})),
					...line.measurements.map((field) => ({
						code: field.code,
						label: field.label,
						value: `${field.value} ${field.unit}`,
					})),
				],
				imageAssetId: line.image?.assetId ?? null,
				imageUrl: line.image?.roles['card']?.[0]?.url ?? null,
				unitPriceINR: line.unitPriceINR,
				unitPricePaid: convert(line.unitPriceINR),
				lineTotalINR: line.lineTotalINR,
				lineTotalPaid: convert(line.lineTotalINR),
				pricing: {
					regularUnitINR: fact?.regularSellingINR ?? line.basePriceINR,
					mrpUnitINR: line.mrpINR !== null && line.mrpINR > line.unitPriceINR ? line.mrpINR : null,
					saleUnitINR: fact?.currentSaleINR ?? null,
					saleEventId: null,
					zoneRule: null,
					discounted: line.mrpINR !== null && line.basePriceINR < line.mrpINR,
				},
				couponINR: built.couponByLine.get(line.id) ?? 0,
				categoryIds: [...new Set(fact?.categoryPaths.flat() ?? [])],
				held: false,
				addedAt: at,
				addedBy: null,
			};
		});
	}

	private async build(
		input: CheckoutRequest,
		principal: AuthenticatedPrincipal | undefined,
		now: Date,
	): Promise<Built> {
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
		const indiaAddress = india as unknown as (CheckedPostalAddress & { country: string }) | null;
		const invoice: Built['invoice'] =
			decision.status === 'ready'
				? {
						source:
							decision.source === 'givenAtCheckout' ? 'addressInIndia' : (decision.source as 'billing'),
						address: {
							...((decision.source === 'billing'
								? billing
								: decision.source === 'delivery'
									? delivery
									: indiaAddress) as CheckedPostalAddress),
							savedAddressId: null,
						},
						needed: false,
						addedBy: null,
						confirmedHow: null,
						at: null,
					}
				: { source: 'none', address: null, needed: true, addedBy: null, confirmedHow: null, at: null };

		// Shipping from the live rule sets; a length of fabric is one unit.
		const shippingResult = view.lines.length
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
		shippingResult?.lines.forEach((line, index) => {
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
				deliveryINR: shippingResult?.amountINR ?? 0,
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
				(shippingResult?.amountINR ?? 0) -
					run.applied.reduce((sum, row) => sum + (row.deliveryAmountINR ?? 0), 0),
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

		const quote: CheckoutQuote = {
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
				reason: (shippingResult?.groups ?? [])
					.flatMap((group) => group.trace.map((entry) => JSON.stringify(entry)))
					.slice(0, 20),
				zone:
					shippingResult?.zone ??
					(deliveryCountry === shippingSettings.homeCountry ? 'domestic' : 'international'),
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
		return {
			quote,
			customer,
			view,
			delivery,
			billing,
			india: indiaAddress,
			invoice,
			shipping: shippingResult,
			facts,
			conversion: { rateFromINR: conversion.rateFromINR, markupPercent: conversion.markupPercent },
			couponByLine,
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
		const checked = await this.addressBook.check(choice.address);
		return checked;
	}
}

/** The shopper, as the order's history names them when the shop changes the order for them. */
const SHOPPER = { id: null, name: 'Shop checkout' };

function savedId(choice: CheckoutAddressChoice): string | null {
	return choice.kind === 'saved' ? choice.savedAddressId : null;
}
