import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
	type AdminCartLine,
	type AdminCheckoutQuote,
	type AdminOrderAddressChoice,
	type AdminOrderCreate,
	type AppliedCoupon,
	type Business,
	type Customer,
	type Order,
	type OrderAddress,
	type OrderLine,
	type OrderPayment,
	type SavedAddressRow,
} from '@saha-textile/contracts';
import {
	DuplicateOrderKeyError,
	applyCoupons,
	canOrderAtAll,
	checkCredit,
	decideInvoiceAddress,
	derivePaymentStatus,
	isPlaceable,
	onAccountDueDate,
	orderBalance,
	warnIndiaBillingForeignCurrency,
	type AdminOrderRepository,
	type BusinessRepository,
	type CouponContext,
	type CouponDefinition,
	type CouponLine,
	type CouponRepository,
	type CustomerRepository,
	type LedgerRepository,
	type OrderPaymentRepository,
	type OrderSettingsRepository,
	type ShippingRuleRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { AddressBookService, type CheckedPostalAddress } from '../addresses/address-book.service';
import { codedRefusal } from '../common/coded-refusal';
import { CurrencyService } from '../currency/currency.service';
import {
	ADMIN_ORDER_REPOSITORY,
	BUSINESS_REPOSITORY,
	COUPON_REPOSITORY,
	CUSTOMER_REPOSITORY,
	LEDGER_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	ORDER_SETTINGS_REPOSITORY,
	SHIPPING_RULE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { ZonePricingService } from '../orders-setup/zone-pricing.service';
import { DEFAULT_SHIPPING_SETTINGS, ShippingAdminService } from '../shipping/shipping-admin.service';
import { AdminCartService } from './admin-cart.service';
import { historyEntry, metaOf, type Actor } from './admin-orders.service';
import { OrderStock } from './order-stock';

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;
const istDay = (at: Date): string => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Who may do what at checkout, from the person's permissions. */
export interface CheckoutRights {
	/** stock.cost: sell a zone price below cost (P8 cost guard). */
	belowCost: boolean;
	/** business.approve: let an order on account go over the limit once, with a reason (K9). */
	creditOverride: boolean;
}

interface Built {
	quote: AdminCheckoutQuote;
	buyer: { kind: 'person'; customer: Customer } | { kind: 'business'; business: Business };
	delivery: CheckedPostalAddress & { savedAddressId: string | null };
	billing: CheckedPostalAddress & { savedAddressId: string | null };
	lines: AdminCartLine[];
	coupons: CouponDefinition[];
	zone: Order['zone'];
	rate: { currency: string; rateFromINR: number; markupPercent: number };
	couponByLine: Map<string, number>;
	invoice: NonNullable<Order['addresses']>['invoice'];
	addressInIndia: CheckedPostalAddress | null;
}

/**
 * Create order and its checkout (brief oc01–oc03, ck01–ck08; owner 2026-11-16 to 2026-11-20). The
 * cart is priced the way the create-order screen shows it (shop pricing, or the business's zone);
 * addresses pass every country rule; the invoice address follows the shop's abroad policy; shipping
 * comes from the live rule sets; coupons follow OD4 with "Usable on zone prices"; credit is enforced
 * on the server (K9). Saving takes the order number, keeps the pieces (K7) and, for a payment typed
 * at checkout, records it, all in one transaction. A repeated idempotency key returns the first order.
 */
@Injectable()
export class AdminOrderCreateService {
	constructor(
		private readonly cart: AdminCartService,
		private readonly zones: ZonePricingService,
		private readonly currency: CurrencyService,
		private readonly addressBook: AddressBookService,
		private readonly shipping: ShippingAdminService,
		private readonly numbers: DocumentNumbersService,
		private readonly stock: OrderStock,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: AdminOrderRepository,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: OrderPaymentRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(LEDGER_REPOSITORY) private readonly ledgers: LedgerRepository,
		@Inject(COUPON_REPOSITORY) private readonly couponRepo: CouponRepository,
		@Inject(SHIPPING_RULE_REPOSITORY) private readonly shippingRules: ShippingRuleRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	async quote(input: AdminOrderCreate, rights: CheckoutRights, now = new Date()): Promise<AdminCheckoutQuote> {
		return (await this.build(input, rights, now)).quote;
	}

	async create(input: AdminOrderCreate, actor: Actor, rights: CheckoutRights, now = new Date()): Promise<Order> {
		const repeat = await this.orders.findByIdempotencyKey(input.idempotencyKey);
		if (repeat) return repeat;
		const built = await this.build(input, rights, now);
		const { quote } = built;
		if (quote.shipping.cannotShip.length) {
			throw new ConflictException(codedRefusal('cannot_ship', 'Remove the pieces that cannot go there', 'lines'));
		}
		const method = input.payment.method;
		const off = quote.methodsOff.find((row) => row.method === method);
		if (off && !(method === 'onAccount' && off.reason === 'overLimit' && this.overrideAllowed(input, rights))) {
			throw new ConflictException(
				codedRefusal('method_off', 'That payment method cannot be used here', 'payment', {
					reason: off.reason,
				}),
			);
		}
		const at = now.toISOString();
		const lines = this.orderLines(built, at, actor.id);
		const placedWith = method === 'manual' ? 'manual' : method === 'keepOpen' ? 'keepOpen' : method;
		const base: Omit<Order, 'id' | 'orderNumber'> = {
			userId: built.buyer.kind === 'person' ? built.buyer.customer.id : null,
			currency: quote.currency,
			lines,
			subtotalINR: quote.totals.goodsINR,
			subtotalPaid: round2(quote.lines.reduce((sum, line) => sum + line.lineTotal, 0)),
			shipping: {
				value: quote.shipping.charge,
				currency: quote.currency,
				chargeINR: quote.shipping.chargeINR,
				zone: quote.shipping.zone,
				deliveryCountry: built.delivery.countryCode ?? built.delivery.country,
				trace: quote.shipping.trace,
				ruleSets: quote.shipping.ruleSets.map((row) => ({ id: row.id, version: row.version })),
				pending: false,
			},
			promotionsApplied: [],
			totalINR: quote.totals.totalINR,
			totalPaid: quote.totals.total,
			status: 'awaiting_payment',
			statusTimeline: [],
			channel: 'admin',
			createdBy: actor.id,
			buyer: this.buyerRecord(built),
			addresses: {
				billing: built.billing,
				delivery: built.delivery,
				billingSameAsDelivery: input.billing === null,
				addressInIndia: built.addressInIndia ? { ...built.addressInIndia, savedAddressId: null } : null,
				invoice: built.invoice,
			},
			currencyRecord: {
				code: quote.currency,
				rateFromINR: built.rate.rateFromINR,
				inrPerUnit: built.rate.rateFromINR > 0 ? round2(1 / built.rate.rateFromINR) : null,
				source: quote.currency === 'INR' ? 'home' : 'fetch',
				rateSetAt: null,
				markupPercent: built.rate.markupPercent,
				pricedAt: at,
			},
			zone: built.zone,
			coupons: quote.coupons,
			balance: orderBalance({
				lineTotalsINR: lines.map((line) => line.lineTotalINR),
				couponINR: quote.totals.couponINR,
				shippingINR: quote.totals.shippingINR,
				payments: [],
			}),
			paymentStatus: 'unpaid',
			placedWith,
			openedAt: method === 'keepOpen' ? at : null,
			closedAt: null,
			eInvoice: null,
			eWayBill: null,
			history: [historyEntry(actor, at, 'created', { comment: input.comment, detail: { method } })],
			revision: 0,
			createdAt: at,
			updatedAt: at,
		};
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.transactions.withTransaction(async (context) => {
					const orderNumber = await this.numbers.orderNumber(context, now);
					let order: Order = { ...base, id: `ord_${randomUUID()}`, orderNumber };
					await this.stock.reserve(order, order.lines, actor.id, context, at);
					const payments: OrderPayment[] = [];
					if (input.payment.method === 'manual') {
						const typed = input.payment.payment;
						const payment: OrderPayment = {
							id: `pay_${randomUUID()}`,
							orderId: order.id,
							method: typed.method,
							state: typed.received ? 'received' : 'pending',
							amountINR: typed.amountINR,
							currency: 'INR',
							amount: typed.amountINR,
							reference: typed.reference,
							gateway: null,
							paypal: null,
							collector: null,
							receivedOn: typed.received ? typed.receivedOn : null,
							receiptNumber: typed.received ? await this.numbers.issue('receipt', context, now) : null,
							note: typed.note,
							proofMediaId: typed.proofMediaId,
							recordedBy: actor.id,
							recordedAt: at,
						};
						payments.push(payment);
					}
					const balance = orderBalance({
						lineTotalsINR: order.lines.map((line) => line.lineTotalINR),
						couponINR: quote.totals.couponINR,
						shippingINR: quote.totals.shippingINR,
						payments,
					});
					const paymentStatus = derivePaymentStatus({
						balance,
						cashOnDelivery: method === 'cashOnDelivery',
						onAccount: method === 'onAccount',
						activeRequest: false,
						pendingAtBank: payments.some((payment) => payment.state === 'pending'),
					});
					const status: Order['status'] =
						method === 'keepOpen' ? 'open' : isPlaceable(paymentStatus) ? 'placed' : 'awaiting_payment';
					order = {
						...order,
						balance,
						paymentStatus,
						status,
						statusTimeline: [{ status, at }],
						lines: order.lines.map((line) => ({ ...line, held: !line.madeToOrder })),
					};
					const saved = await this.orders.create(order, input.idempotencyKey, context, metaOf(order));
					for (const payment of payments) await this.payments.save(payment, context);
					for (const coupon of built.coupons) {
						await this.couponRepo.recordUse(coupon.id, this.buyerKey(built), saved.id, context);
					}
					if (method === 'onAccount' && built.buyer.kind === 'business') {
						const customer = built.buyer.business.roles.customer;
						await this.ledgers.append(
							{
								id: `led_${randomUUID()}`,
								businessId: built.buyer.business.id,
								side: 'receivable',
								kind: 'orderOnAccount',
								amountINR: quote.totals.totalINR,
								documentType: 'order',
								documentId: saved.id,
								documentNumber: saved.orderNumber,
								dueOn: onAccountDueDate(istDay(now), customer?.creditDays ?? 0),
								note: input.payment.method === 'onAccount' ? input.payment.creditOverrideReason : null,
								reversalOf: null,
								agreement: null,
								at,
								by: actor.id ?? 'unknown',
							},
							context,
						);
					}
					return saved;
				});
			} catch (error) {
				if (error instanceof DuplicateOrderKeyError && error.key === 'orderNumber' && attempt < 4) continue;
				if (error instanceof DuplicateOrderKeyError && error.key === 'idempotencyKey') {
					const first = await this.orders.findByIdempotencyKey(input.idempotencyKey);
					if (first) return first;
				}
				throw error;
			}
		}
	}

	private overrideAllowed(input: AdminOrderCreate, rights: CheckoutRights): boolean {
		return input.payment.method === 'onAccount' && rights.creditOverride && !!input.payment.creditOverrideReason;
	}

	private async build(input: AdminOrderCreate, rights: CheckoutRights, now: Date): Promise<Built> {
		const settings = await this.settings.get();
		const buyer = await this.buyer(input);
		const view = await this.cart.price(input.cart, now);
		const problems = view.lines.filter((line) => line.problem && line.problem !== 'limited');
		if (problems.length) {
			throw new ConflictException(
				codedRefusal('cart_problems', 'Some lines cannot be ordered as they are', 'lines', {
					skus: problems.map((line) => line.sku).join(','),
				}),
			);
		}
		if (
			!rights.belowCost &&
			view.lines.some((line) => line.zonePrice?.kind === 'priced' && line.zonePrice.belowCost)
		) {
			throw new ForbiddenException(
				codedRefusal(
					'zone_price_below_cost',
					'A zone price is below cost; someone with the cost permission must place it',
					'lines',
				),
			);
		}
		const { zone } = await this.cart.buyerZone(input.cart.buyer);
		const delivery = await this.address(input.delivery, buyer, 'delivery');
		const billing = input.billing ? await this.address(input.billing, buyer, 'billing') : delivery;
		const addressInIndia = input.indianInvoiceAddress
			? await this.addressBook.check(input.indianInvoiceAddress)
			: null;
		const shippingSettings = (await this.shippingRules.getSettings()) ?? DEFAULT_SHIPPING_SETTINGS;
		const decision = decideInvoiceAddress({
			policy: shippingSettings.abroadPolicy,
			homeCountry: shippingSettings.homeCountry,
			billing: { ...billing, country: billing.countryCode ?? billing.country },
			delivery: { ...delivery, country: delivery.countryCode ?? delivery.country },
			givenAtCheckout: addressInIndia,
			addedByStaff: null,
		});
		if (decision.status === 'notAllowed') {
			throw new ConflictException(
				codedRefusal('delivery_not_allowed', 'The shop does not send orders there', 'delivery', {
					reason: decision.reason,
				}),
			);
		}
		const invoice: Built['invoice'] =
			decision.status === 'ready'
				? {
						source:
							decision.source === 'givenAtCheckout'
								? 'addressInIndia'
								: decision.source === 'addedByStaff'
									? 'staff'
									: decision.source,
						address: {
							...(decision.source === 'billing'
								? billing
								: decision.source === 'delivery'
									? delivery
									: { ...(addressInIndia as CheckedPostalAddress), savedAddressId: null }),
						},
						needed: false,
						addedBy: null,
						confirmedHow: null,
						at: null,
					}
				: { source: 'none', address: null, needed: true, addedBy: null, confirmedHow: null, at: null };

		// Shipping from the live rule sets; a length of fabric is one unit.
		const shippingResult = await this.shipping.tryCart({
			lines: input.cart.lines.map((line, index) => ({
				productId: line.productId,
				variationId: view.lines[index]?.variationId ?? line.variationId,
				quantity: Math.min(99, line.quantity),
			})),
			delivery: {
				country: delivery.countryCode ?? delivery.country,
				state: delivery.state ?? null,
				pincode: delivery.postalCode || null,
			},
			shopper: { signedIn: true, groups: [], firstOrder: false },
		});
		const rate = { currency: view.currency, rateFromINR: 1, markupPercent: view.markupPercent };
		if (view.currency !== 'INR') {
			const sample = await this.currency.convert(0, view.currency);
			rate.rateFromINR = sample.rateFromINR;
		}
		const convert = (amountINR: number) =>
			view.currency === 'INR' ? amountINR : round2(amountINR * rate.rateFromINR * (1 + rate.markupPercent / 100));

		// Coupons (OD4): sale lines left out unless included; zone lines only when the coupon allows them.
		const facts = await this.zones.factsFor(
			view.lines.map((line, index) => ({
				productId: line.productId,
				variantId: line.variationId,
				quantity: input.cart.lines[index]?.quantity ?? line.quantity,
			})),
			now,
		);
		const couponLines: CouponLine[] = view.lines.map((line, index) => ({
			lineId: line.lineId,
			productId: line.productId,
			categoryIds: [...new Set(facts[index]?.facts.categoryPaths.flat() ?? [])],
			amountINR: round2(line.unitPriceINR * line.quantity),
			onSale:
				!line.zonePrice &&
				facts[index]?.facts.currentSaleINR !== null &&
				facts[index]?.facts.currentSaleINR !== undefined,
			zonePriced: line.zonePrice?.kind === 'priced' && line.zonePrice.rule.tier !== 'retail',
		}));
		const codes = [...new Set(input.couponCodes.map((code) => code.toUpperCase()))];
		const definitions: CouponDefinition[] = [];
		const contexts = new Map<string, CouponContext>();
		const refusedUnknown: Array<{ code: string; refusal: string }> = [];
		const buyerKey = this.buyerKey({ buyer } as Built);
		const firstOrder =
			buyer.kind === 'person' ? (await this.orders.countPlacedByCustomer(buyer.customer.id)) === 0 : false;
		for (const code of codes) {
			const coupon = await this.couponRepo.findByCode(code);
			if (!coupon) {
				refusedUnknown.push({ code, refusal: 'unknown' });
				continue;
			}
			definitions.push(coupon);
			contexts.set(coupon.id, {
				channel: 'admin',
				now: now.toISOString(),
				buyer:
					buyer.kind === 'person'
						? { kind: 'person', customerId: buyer.customer.id, isFirstOrder: firstOrder }
						: { kind: 'business', businessId: buyer.business.id },
				usesByThisBuyer: await this.couponRepo.usesBy(coupon.id, buyerKey),
				usesInAll: coupon.usedCount ?? 0,
				deliveryINR: shippingResult.amountINR ?? 0,
			});
		}
		const run = applyCoupons(definitions, couponLines, contexts);
		const applied: AppliedCoupon[] = run.applied;
		const couponByLine = new Map<string, number>();
		for (const coupon of applied) {
			for (const line of coupon.lines)
				couponByLine.set(line.lineId, round2((couponByLine.get(line.lineId) ?? 0) + line.amountINR));
		}
		const goodsINR = view.subtotalINR;
		const couponINR = round2(applied.reduce((sum, row) => sum + row.amountINR, 0));
		const deliveryOffINR = round2(applied.reduce((sum, row) => sum + (row.deliveryAmountINR ?? 0), 0));
		const shippingINR = round2(Math.max(0, (shippingResult.amountINR ?? 0) - deliveryOffINR));
		const totalINR = round2(goodsINR - couponINR + shippingINR);

		// Payment methods this order can't use, with the reason.
		const methodsOff: AdminCheckoutQuote['methodsOff'] = [];
		for (const method of ['paymentLink', 'upi', 'bankTransfer', 'cashOnDelivery', 'onAccount'] as const) {
			if (!settings.adminPaymentMethods[method]) methodsOff.push({ method, reason: 'switchedOff' });
		}
		let credit: AdminCheckoutQuote['credit'] = null;
		if (buyer.kind === 'business') {
			const customer = buyer.business.roles.customer;
			if (!customer || !canOrderAtAll(customer.standing)) {
				throw new ConflictException(
					codedRefusal('business_blocked', 'This business cannot order now', 'buyer'),
				);
			}
			const outstanding = Math.max(0, await this.ledgers.balance(buyer.business.id, 'receivable'));
			const check = checkCredit({
				standing: customer.standing,
				limitINR: customer.creditLimitINR,
				outstandingINR: outstanding,
				orderINR: totalINR,
				businessAccounts: settings.businessAccounts,
			});
			credit = {
				limitINR: customer.creditLimitINR,
				usedINR: outstanding,
				thisOrderINR: totalINR,
				availableINR: check.availableINR,
				dueOn: onAccountDueDate(istDay(now), customer.creditDays),
			};
			if (check.refusal) methodsOff.push({ method: 'onAccount', reason: check.refusal });
		} else {
			methodsOff.push({ method: 'onAccount', reason: 'notABusiness' });
		}
		if (view.currency !== 'INR') {
			for (const method of ['upi', 'bankTransfer', 'cashOnDelivery'] as const) {
				if (settings.manualPaymentCurrency === 'homeCurrencyOnly') continue;
				methodsOff.push({ method, reason: 'foreignCurrency' });
			}
		}
		const warnings: AdminCheckoutQuote['warnings'] = [];
		if (
			settings.warnIndiaBillingForeignCurrency &&
			warnIndiaBillingForeignCurrency(billing.countryCode ?? billing.country, view.currency)
		) {
			warnings.push('indiaBillingForeignCurrency');
		}
		if (billing.mobile && billing.mobile.countryCallingCode !== '91') warnings.push('smsNotIndianMobile');

		const quote: AdminCheckoutQuote = {
			currency: view.currency,
			lines: view.lines,
			coupons: applied,
			couponRefusals: [...refusedUnknown, ...run.refused],
			shipping: {
				chargeINR: shippingINR,
				charge: convert(shippingINR),
				zone: shippingResult.zone,
				trace: shippingResult.groups
					.flatMap((group) => group.trace.map((entry) => JSON.stringify(entry)))
					.slice(0, 40),
				ruleSets: shippingResult.groups.flatMap((group) =>
					group.ruleSetId && group.version
						? [{ id: group.ruleSetId, version: group.version, name: group.ruleSetName ?? '' }]
						: [],
				),
				cannotShip: shippingResult.lines.flatMap((line, index) =>
					line.route === 'cantShip'
						? [{ lineId: view.lines[index]?.lineId ?? line.lineId, reason: 'cantShip' }]
						: [],
				),
			},
			totals: { goodsINR, couponINR, shippingINR, totalINR, total: convert(totalINR) },
			gateway: view.currency === 'INR' ? 'ccavenue' : 'paypal',
			warnings,
			invoiceAddress: { source: invoice.source, needed: invoice.needed },
			credit,
			methodsOff,
		};
		return {
			quote,
			buyer,
			delivery,
			billing,
			lines: view.lines,
			coupons: definitions.filter((coupon) => applied.some((row) => row.couponId === coupon.id)),
			zone: zone ? { zoneId: zone.id, code: zone.code, name: zone.name, version: zone.version } : null,
			rate,
			couponByLine,
			invoice,
			addressInIndia,
		};
	}

	private orderLines(built: Built, at: string, actorId: string | null): OrderLine[] {
		const convert = (amountINR: number) =>
			built.rate.currency === 'INR'
				? amountINR
				: round2(amountINR * built.rate.rateFromINR * (1 + built.rate.markupPercent / 100));
		return built.lines.map((line) => {
			const lineTotalINR = round2(line.unitPriceINR * line.quantity);
			const zoneRule =
				line.zonePrice?.kind === 'priced' && line.zonePrice.rule.tier !== 'retail' ? line.zonePrice.rule : null;
			return {
				lineId: line.lineId,
				productId: line.productId,
				variationId: line.variationId,
				title: { en: line.title },
				sku: line.sku,
				quantity: line.quantity,
				attributes: {},
				addons: [],
				imageAssetId: null,
				unitPriceINR: line.unitPriceINR,
				unitPricePaid: line.unitPrice,
				lineTotalINR,
				lineTotalPaid: convert(lineTotalINR),
				pricing: {
					regularUnitINR:
						line.zonePrice?.kind === 'priced' ? line.zonePrice.retailUnitPriceINR : line.unitPriceINR,
					saleUnitINR: null,
					saleEventId: null,
					zoneRule,
					discounted: false,
				},
				couponINR: built.couponByLine.get(line.lineId) ?? 0,
				categoryIds: [],
				held: false,
				addedAt: at,
				addedBy: actorId,
			} as OrderLine;
		});
	}

	private buyerRecord(built: Built): Order['buyer'] {
		if (built.buyer.kind === 'person') {
			const customer = built.buyer.customer;
			return {
				kind: 'person',
				customerId: customer.id,
				businessId: null,
				name: customer.displayName ?? built.billing.fullName,
				email: customer.email ?? null,
				mobile: built.billing.mobile ?? null,
				gstin: null,
			};
		}
		const business = built.buyer.business;
		const accounts = business.contacts.find((contact) => contact.isAccounts) ?? business.contacts[0];
		return {
			kind: 'business',
			customerId: null,
			businessId: business.id,
			name: business.legalName,
			email: accounts?.email ?? null,
			mobile: accounts?.mobile ?? built.billing.mobile ?? null,
			gstin: business.gstin,
		};
	}

	private buyerKey(built: Pick<Built, 'buyer'>): string {
		return built.buyer.kind === 'person'
			? `customer:${built.buyer.customer.id}`
			: `business:${built.buyer.business.id}`;
	}

	private async buyer(input: AdminOrderCreate): Promise<Built['buyer']> {
		const ref = input.cart.buyer;
		if (ref.kind === 'person') {
			const customer = await this.customers.findById(ref.customerId);
			if (!customer || customer.status === 'deleted') {
				throw new BadRequestException(
					codedRefusal('customer_missing', 'That customer does not exist', 'buyer'),
				);
			}
			return { kind: 'person', customer };
		}
		const business = await this.businesses.findById(ref.businessId);
		if (!business?.roles.customer) {
			throw new BadRequestException(
				codedRefusal('not_a_customer', 'This business does not buy from us', 'buyer'),
			);
		}
		return { kind: 'business', business };
	}

	/** A saved address (checked again) or a new one, saved to the customer's addresses when asked. */
	private async address(
		choice: AdminOrderAddressChoice,
		buyer: Built['buyer'],
		path: 'delivery' | 'billing',
	): Promise<OrderAddress & CheckedPostalAddress> {
		if (choice.kind === 'saved') {
			const rows: SavedAddressRow[] =
				buyer.kind === 'person'
					? (buyer.customer.addresses as unknown as SavedAddressRow[])
					: buyer.business.addresses;
			const row = rows.find((candidate) => candidate.id === choice.savedAddressId);
			if (!row)
				throw new BadRequestException(
					codedRefusal('address_missing', 'That saved address does not exist', path),
				);
			return { ...(row as unknown as CheckedPostalAddress), savedAddressId: row.id };
		}
		const checked = await this.addressBook.check(choice.address);
		if (choice.saveAs && buyer.kind === 'person') {
			await this.addressBook.add(buyer.customer.id, {
				...choice.address,
				label: choice.saveAs,
				isDefault: false,
			});
		}
		return { ...checked, savedAddressId: null };
	}
}
