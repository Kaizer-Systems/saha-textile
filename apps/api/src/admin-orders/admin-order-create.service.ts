import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	Optional,
} from '@nestjs/common';
import {
	type AdminCartLine,
	type AdminCheckoutQuote,
	type AdminOrderAddressChoice,
	type AdminOrderBuyerRef,
	type AdminOrderCreate,
	type AppliedCoupon,
	type Business,
	type CouponOption,
	type CouponTryRequest,
	type CouponTryResult,
	type Customer,
	type CustomerBuyerOption,
	type Order,
	type OrderAddress,
	type OrderLine,
	type OrderPayment,
	type SavedAddressRow,
} from '@saha-textile/contracts';
import {
	DuplicateOrderKeyError,
	applyCoupons,
	couponLineReason,
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
import { adminLineConfig } from './admin-line-snapshot';
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
import { historyEntry, linesSummary, metaOf, type Actor } from './admin-orders.service';
import { OrderNoticesService } from './order-notices.service';
import { OrderStock } from './order-stock';

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;
const istDay = (at: Date): string => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Who may do what at checkout, from the person's permissions. */
export interface CheckoutRights {
	/** stock.cost: sell a zone price below cost (P8 cost guard). */
	belowCost: boolean;
	/** business.approve: let an order on account go over the limit once, with a reason (K9). */
	creditOverride: boolean;
	/** order.open: keep an order open to add pieces over time ("Keep the order open"). */
	keepOpen: boolean;
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
		@Optional() @Inject(OrderNoticesService) private readonly notices: OrderNoticesService | null = null,
	) {}

	/** The shop-customer picker on Create order: name, phone or email, active customers only. */
	async searchCustomers(q: string, limit: number): Promise<CustomerBuyerOption[]> {
		const page = await this.customers.list({ q, page: 1, pageSize: limit });
		return page.items
			.filter((customer) => customer.status === 'active' || customer.status === 'pending')
			.map((customer) => ({
				id: customer.id,
				name: customer.displayName?.trim() || customer.email || customer.phone || customer.id,
				email: customer.email,
				phone: customer.phone,
				addressCount: customer.addresses.length,
			}));
	}

	/**
	 * The admin checkout's coupon popup (cp06): every coupon the admin can use now, with what it
	 * would take off this order (on top of the coupons already applied) or why it can't be used.
	 */
	async couponOptions(input: AdminOrderCreate, rights: CheckoutRights, now = new Date()): Promise<CouponOption[]> {
		const applied = new Set(input.couponCodes.map((code) => code.toUpperCase()));
		const usable = (await this.couponRepo.listUsable('admin', now)).filter((coupon) => !applied.has(coupon.code));
		const options: CouponOption[] = [];
		for (const coupon of usable.slice(0, 30)) {
			const quote = await this.quote({ ...input, couponCodes: [...input.couponCodes, coupon.code] }, rights, now);
			const hit = quote.coupons.find((row) => row.code === coupon.code);
			const refused = quote.couponRefusals.find((row) => row.code === coupon.code);
			options.push({
				couponId: coupon.id,
				code: coupon.code,
				title: coupon.title,
				kind: coupon.kind,
				value: coupon.value,
				combines: coupon.combines,
				wouldTakeINR: hit ? round2(hit.amountINR + (hit.deliveryAmountINR ?? 0)) : 0,
				refusal: hit ? null : ((refused?.refusal as CouponOption['refusal']) ?? 'nothingEligible'),
			});
		}
		return options.sort((a, b) => Number(!!a.refusal) - Number(!!b.refusal) || b.wouldTakeINR - a.wouldTakeINR);
	}

	/**
	 * Try it on the coupon builder (cp02): the coupon as typed, unsaved, on a real cart at shop
	 * prices, with why each line did or didn't get money off. Who may use it, its dates and its use
	 * counts are left out here: Try it shows what the coupon does to the pieces.
	 */
	async couponTry(request: CouponTryRequest, now = new Date()): Promise<CouponTryResult> {
		const view = await this.cart.price(
			{
				buyer: null,
				currency: 'INR',
				lines: request.items.map((item) => ({
					productId: item.productId,
					variationId: item.variantId,
					quantity: item.quantity,
					addons: [],
				})),
			},
			now,
		);
		const facts = await this.zones.factsFor(
			view.lines.map((line, index) => ({
				productId: line.productId,
				variantId: line.variationId,
				quantity: request.items[index]?.quantity ?? line.quantity,
			})),
			now,
		);
		const lines: CouponLine[] = view.lines.map((line, index) => ({
			lineId: line.lineId,
			productId: line.productId,
			categoryIds: [...new Set(facts[index]?.facts.categoryPaths.flat() ?? [])],
			amountINR: line.lineTotalINR,
			onSale: facts[index]?.facts.currentSaleINR !== null && facts[index]?.facts.currentSaleINR !== undefined,
			zonePriced: false,
		}));
		const definition: CouponDefinition = {
			...request.coupon,
			id: 'coupon_try',
			enabled: true,
			audience: { kind: 'everyone' },
			channels: { shop: true, admin: true },
			usesPerCustomer: null,
			totalUses: null,
			validFrom: null,
			validUntil: null,
		};
		// cp04: the switched-on coupons that combine, tried together with this one.
		const others: CouponDefinition[] = [];
		if (request.coupon.combines) {
			for (const code of request.withCodes ?? []) {
				const coupon = await this.couponRepo.findByCode(code);
				if (coupon && coupon.enabled && coupon.combines && coupon.code !== request.coupon.code) others.push(coupon);
			}
		}
		// The delivery charge for this cart in the home country, unless the caller gave one.
		let deliveryINR = request.deliveryINR;
		if (!deliveryINR) {
			const settings = (await this.shippingRules.getSettings()) ?? DEFAULT_SHIPPING_SETTINGS;
			const shipping = await this.shipping
				.tryCart({
					lines: request.items.map((item) => ({
						productId: item.productId,
						variationId: item.variantId,
						quantity: item.quantity,
					})),
					delivery: { country: settings.homeCountry, state: null, pincode: null },
					shopper: { signedIn: true, groups: [], firstOrder: false },
				})
				.catch(() => null);
			deliveryINR = shipping?.status === 'priced' ? (shipping.amountINR ?? 0) : 0;
		}
		const context = {
			channel: 'admin' as const,
			now: now.toISOString(),
			buyer: { kind: 'person' as const, customerId: null, isFirstOrder: true },
			usesByThisBuyer: 0,
			usesInAll: 0,
			deliveryINR,
		};
		const all = [definition, ...others];
		const run = applyCoupons(all, lines, new Map(all.map((row) => [row.id, context])));
		const applied = run.applied.find((row) => row.couponId === definition.id) ?? null;
		const before = round2(view.subtotalINR + deliveryINR);
		const off = round2(
			run.applied.reduce((sum, row) => sum + row.amountINR + (row.deliveryAmountINR ?? 0), 0),
		);
		const freeDelivery = run.applied.find((row) => (row.deliveryAmountINR ?? 0) > 0) ?? null;
		return {
			refusal: run.refused.find((row) => row.code === definition.code)?.refusal ?? null,
			applied,
			lines: view.lines.map((line, index) => {
				const share = applied?.lines.find((row) => row.lineId === line.lineId);
				const couponLine = lines[index] as CouponLine;
				return {
					lineId: line.lineId,
					title: line.title,
					unitPriceINR: line.unitPriceINR,
					quantity: line.quantity,
					onSale: couponLine.onSale,
					reason: share?.reason ?? couponLineReason(definition, couponLine),
					amountINR: round2(
						run.applied.reduce(
							(sum, row) => sum + (row.lines.find((part) => part.lineId === line.lineId)?.amountINR ?? 0),
							0,
						),
					),
					byCoupon: run.applied.flatMap((row) => {
						const part = row.lines.find((piece) => piece.lineId === line.lineId);
						return part && part.amountINR > 0 ? [{ code: row.code, amountINR: part.amountINR }] : [];
					}),
				};
			}),
			deliveryINR,
			deliveryOff: freeDelivery
				? { code: freeDelivery.code, amountINR: freeDelivery.deliveryAmountINR ?? 0 }
				: null,
			used: run.applied.map((row) => ({
				code: row.code,
				amountINR: round2(row.amountINR + (row.deliveryAmountINR ?? 0)),
			})),
			totalBeforeINR: before,
			totalAfterINR: round2(before - off),
		};
	}

	/** The buyer's saved addresses for the checkout's address boxes (ck01, ad07). */
	async buyerAddresses(ref: AdminOrderBuyerRef): Promise<SavedAddressRow[]> {
		const buyer = await this.buyer({ cart: { buyer: ref } } as AdminOrderCreate);
		return buyer.kind === 'person'
			? (buyer.customer.addresses as unknown as SavedAddressRow[])
			: buyer.business.addresses;
	}

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
				ruleSets: quote.shipping.ruleSets.map((row) => ({ id: row.id, version: row.version, name: row.name })),
				pending: false,
				pieces: quote.shipping.pieces,
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
			history: [
				historyEntry(actor, at, 'created', {
					comment: input.comment,
					detail: { method, items: linesSummary(lines) },
				}),
			],
			revision: 0,
			createdAt: at,
			updatedAt: at,
		};
		for (let attempt = 0; ; attempt += 1) {
			try {
				const placed = await this.transactions.withTransaction(async (context) => {
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
							collectedBy: null,
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
						// Placed at once (paid, cash on delivery or on account): the customer is sent Order
						// confirmed once it is saved. A payment link sends the gateway's own request instead.
						history:
							status === 'placed'
								? order.history.map((entry) =>
										entry.kind === 'created'
											? { ...entry, messages: this.notices?.plan(order, ['order_confirmed']) ?? [] }
											: entry,
									)
								: order.history,
						lines: order.lines.map((line) => ({ ...line, held: !line.madeToOrder })),
						onAccountDueOn:
							method === 'onAccount' && built.buyer.kind === 'business'
								? onAccountDueDate(istDay(now), built.buyer.business.roles.customer?.creditDays ?? 0)
								: null,
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
				await this.saveNewAddresses(input, built.buyer);
				if (placed.status === 'placed') await this.notices?.send(placed, ['order_confirmed']);
				return placed;
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
			amountINR: line.lineTotalINR,
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
		// "Keep the order open" (owner, 21 Nov: a sixth payment card): only while open orders are on, and
		// only for staff who may keep orders open. Placing it otherwise is refused like any method that is off.
		if (!settings.openOrders.enabled) methodsOff.push({ method: 'keepOpen', reason: 'switchedOff' });
		else if (!rights.keepOpen) methodsOff.push({ method: 'keepOpen', reason: 'noPermission' });
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
				pieces: shippingResult.lines.map((line) => ({
					lineId: line.lineId,
					units: line.units,
					discounted: line.discounted,
				})),
			},
			totals: { goodsINR, couponINR, shippingINR, totalINR, total: convert(totalINR) },
			gateway: view.currency === 'INR' ? 'ccavenue' : 'paypal',
			warnings,
			invoiceAddress: { source: invoice.source, needed: invoice.needed },
			credit,
			methodsOff,
			linkValidDays: settings.paymentLinkDays,
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
		return built.lines.map((line, index) => {
			const lineTotalINR = line.lineTotalINR;
			const zoneRule =
				line.zonePrice?.kind === 'priced' && line.zonePrice.rule.tier !== 'retail' ? line.zonePrice.rule : null;
			return {
				lineId: line.lineId,
				productId: line.productId,
				variationId: line.variationId,
				title: { en: line.title },
				sku: line.sku,
				quantity: line.quantity,
				...adminLineConfig(line),
				imageAssetId: null,
				imageUrl: line.imageUrl,
				unitPriceINR: line.unitPriceINR,
				unitPricePaid: line.unitPrice,
				lineTotalINR,
				lineTotalPaid: convert(lineTotalINR),
				pricing: {
					regularUnitINR:
						line.zonePrice?.kind === 'priced' ? line.zonePrice.retailUnitPriceINR : line.unitPriceINR,
					mrpUnitINR: line.mrpINR !== null && line.mrpINR > line.unitPriceINR ? line.mrpINR : null,
					saleUnitINR: null,
					saleEventId: null,
					zoneRule,
					// The shipping try prices the lines in cart order, so its pieces line up by position.
					discounted: built.quote.shipping.pieces[index]?.discounted ?? false,
					addOnsZonePriced: line.addOnsZonePriced,
				},
				couponINR: built.couponByLine.get(line.lineId) ?? 0,
				categoryIds: [],
				held: false,
				addedAt: at,
				addedBy: actorId,
				role: 'product',
				parentLineId: null,
				set: null,
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
		return { ...checked, savedAddressId: null };
	}

	/**
	 * "Save to the customer's addresses" (ad07) saves once the order is placed, never while the
	 * checkout is only being priced (a quote runs on every change).
	 */
	private async saveNewAddresses(input: AdminOrderCreate, buyer: Built['buyer']): Promise<void> {
		if (buyer.kind !== 'person') return;
		for (const choice of [input.delivery, input.billing]) {
			if (choice?.kind !== 'new' || !choice.saveAs) continue;
			await this.addressBook.add(buyer.customer.id, {
				...choice.address,
				label: choice.saveAs,
				isDefault: false,
			});
		}
	}
}
