import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AdminOrderDetail,
	OpenOrderAddLines,
	OpenOrderClose,
	OpenOrderClosePreview,
	OpenOrderRemoveLine,
	Order,
	OrderLine,
} from '@saha-textile/contracts';
import {
	canChangeLines,
	checkCredit,
	derivePaymentStatus,
	onAccountDueDate,
	orderBalance,
	statusAfterClose,
	statusNotices,
	type BusinessRepository,
	type LedgerRepository,
	type OrderPaymentRepository,
	type OrderSettingsRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { adminLineConfig } from './admin-line-snapshot';
import {
	BUSINESS_REPOSITORY,
	LEDGER_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	ORDER_SETTINGS_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { ShippingAdminService } from '../shipping/shipping-admin.service';
import { AdminCartService } from './admin-cart.service';
import type { CheckoutRights } from './admin-order-create.service';
import { AdminOrdersService, historyEntry, linesSummary, type Actor } from './admin-orders.service';
import { childLines, keepsStock, setLine } from '../orders/order-tree';
import { OrderStock } from './order-stock';

const istDay = (at: Date): string => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Open orders (owner message 18; brief oo01–oo08; K10): a buyer collects pieces over weeks and takes
 * them in one shipment. Pieces are kept from the moment they are added and go back on sale the
 * moment they are removed; the balance stays in rupees; payments come in as they come. Closing
 * stops adding, prices the shipping for one parcel, and either waits for the rest (request it online
 * or record it later) or, for a business, puts it on its account.
 */
@Injectable()
export class OpenOrdersService {
	constructor(
		private readonly orders: AdminOrdersService,
		private readonly cart: AdminCartService,
		private readonly shipping: ShippingAdminService,
		private readonly stock: OrderStock,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: OrderPaymentRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Inject(LEDGER_REPOSITORY) private readonly ledgers: LedgerRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	private async openOrder(id: string): Promise<Order> {
		const order = await this.orders.get(id);
		const refusal = canChangeLines(order.status, (await this.settings.get()).openOrders.enabled);
		if (refusal)
			throw new ConflictException(
				codedRefusal(
					refusal === 'notOpen' ? 'order_not_open' : 'open_orders_off',
					'This order is not open',
					'id',
				),
			);
		return order;
	}

	async addLines(
		id: string,
		input: OpenOrderAddLines,
		actor: Actor,
		rights: CheckoutRights,
		now = new Date(),
	): Promise<AdminOrderDetail> {
		const order = await this.openOrder(id);
		const buyer =
			order.buyer?.kind === 'business' && order.buyer.businessId
				? { kind: 'business' as const, businessId: order.buyer.businessId }
				: order.buyer?.customerId
					? { kind: 'person' as const, customerId: order.buyer.customerId }
					: null;
		// K10: an open order's balance stays in rupees, whatever currency a later request uses.
		const view = await this.cart.price({ buyer, currency: 'INR', lines: input.lines }, now);
		const problems = view.lines.filter((line) => line.problem && line.problem !== 'limited');
		if (problems.length) {
			throw new ConflictException(
				codedRefusal('cart_problems', 'Some lines cannot be added as they are', 'lines', {
					skus: problems.map((line) => line.sku).join(','),
				}),
			);
		}
		if (
			!rights.belowCost &&
			view.lines.some((line) => line.zonePrice?.kind === 'priced' && line.zonePrice.belowCost)
		) {
			throw new ForbiddenException(codedRefusal('zone_price_below_cost', 'A zone price is below cost', 'lines'));
		}
		const at = now.toISOString();
		const added: OrderLine[] = view.lines.flatMap((line) => {
			const own: OrderLine = {
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
				unitPricePaid: line.unitPriceINR,
				lineTotalINR: line.lineTotalINR,
				lineTotalPaid: line.lineTotalINR,
				pricing: {
					regularUnitINR:
						line.zonePrice?.kind === 'priced' ? line.zonePrice.retailUnitPriceINR : line.unitPriceINR,
					mrpUnitINR: line.mrpINR !== null && line.mrpINR > line.unitPriceINR ? line.mrpINR : null,
					saleUnitINR: null,
					saleEventId: null,
					zoneRule:
						line.zonePrice?.kind === 'priced' && line.zonePrice.rule.tier !== 'retail'
							? line.zonePrice.rule
							: null,
					discounted: line.mrpINR !== null && line.unitPriceINR < line.mrpINR,
					addOnsZonePriced: line.addOnsZonePriced,
				},
				couponINR: 0,
				categoryIds: [],
				held: false,
				addedAt: at,
				addedBy: actor.id,
				role: 'product',
				parentLineId: null,
				set: null,
			};
			// A set joins as its own line with its pieces, free items and extras beneath it (bundle builder brief E09).
			const tree = {
				id: line.lineId,
				productId: line.productId,
				variationId: line.variationId,
				quantity: line.quantity,
				soldBy: line.soldBy,
				unitPriceINR: line.unitPriceINR,
				mrpINR: line.mrpINR,
				setHeading: line.setHeading,
				children: line.children,
			};
			const children = childLines(tree, own, (amount) => amount, 0, at).map((row) => ({
				...row,
				addedBy: actor.id,
			}));
			return [...setLine(own, tree), ...children];
		});
		await this.transactions.withTransaction(async (context) => {
			await this.stock.reserve(order, added, actor.id, context, at);
			const withLines: Order = {
				...order,
				lines: [...order.lines, ...added.map((line) => ({ ...line, held: keepsStock(line) }))],
			};
			await this.orders.settle(withLines, input.revision, actor, at, context, {
				kind: 'lineAdded',
				detail: {
					lines: added.length,
					skus: added.map((line) => line.sku).join(','),
					items: linesSummary(added),
				},
			});
		});
		return this.orders.detail(id, now);
	}

	async removeLine(
		id: string,
		input: OpenOrderRemoveLine,
		actor: Actor,
		now = new Date(),
	): Promise<AdminOrderDetail> {
		const order = await this.openOrder(id);
		const line = order.lines.find((row) => row.lineId === input.lineId);
		if (!line) throw new NotFoundException(codedRefusal('line_missing', 'That line is not on the order', 'lineId'));
		const at = now.toISOString();
		await this.transactions.withTransaction(async (context) => {
			// The pieces go back on sale at once (oo06).
			await this.stock.release(order, [line], actor.id, context, at);
			await this.orders.settle(
				{ ...order, lines: order.lines.filter((row) => row !== line) },
				input.revision,
				actor,
				at,
				context,
				{
					kind: 'lineRemoved',
					comment: input.reason,
					detail: {
						sku: line.sku,
						quantity: line.quantity,
						title: line.title.en,
						amountINR: line.lineTotalINR,
					},
				},
			);
		});
		return this.orders.detail(id, now);
	}

	/** Shipping for the whole order as one parcel to its delivery address (oo08). */
	private async parcelQuote(order: Order) {
		const delivery = order.addresses?.delivery;
		if (!delivery) return { problem: 'no_addresses' as const, quote: null, delivery: null };
		const quote = await this.shipping.tryCart({
			lines: order.lines.map((line) => ({
				productId: line.productId,
				variationId: line.variationId,
				quantity: Math.min(99, line.quantity),
			})),
			delivery: {
				country: delivery.countryCode ?? delivery.country,
				state: delivery.state ?? null,
				pincode: delivery.postalCode || null,
			},
			shopper: { signedIn: true, groups: [], firstOrder: false },
		});
		if (quote.status !== 'priced' || quote.amountINR === null)
			return { problem: 'cannot_ship' as const, quote, delivery };
		return { problem: null, quote: { ...quote, amountINR: quote.amountINR }, delivery };
	}

	/** Whether the buyer is a business that can take `dueINR` on its account now (K9). */
	private async accountFor(order: Order, dueINR: number) {
		const businessId = order.buyer?.kind === 'business' ? order.buyer.businessId : null;
		const business = businessId ? await this.businesses.findById(businessId) : null;
		const customer = business?.roles.customer;
		if (!business || !customer) return null;
		const check = checkCredit({
			standing: customer.standing,
			limitINR: customer.creditLimitINR,
			outstandingINR: Math.max(0, await this.ledgers.balance(business.id, 'receivable')),
			orderINR: dueINR,
			businessAccounts: (await this.settings.get()).businessAccounts,
		});
		return { business, customer, refusal: check.refusal ?? null };
	}

	/** What closing would do (oo08): goods, one parcel's shipping, paid so far, due to close. */
	async closePreview(id: string): Promise<OpenOrderClosePreview> {
		const order = await this.openOrder(id);
		const payments = await this.payments.listByOrder(id);
		const parcel = order.lines.length ? await this.parcelQuote(order) : null;
		const shippingINR = parcel?.problem === null ? parcel.quote.amountINR : null;
		const balance = orderBalance({
			lineTotalsINR: order.lines.map((line) => line.lineTotalINR),
			couponINR: order.balance?.couponINR ?? 0,
			shippingINR: shippingINR ?? 0,
			payments,
		});
		const account = await this.accountFor(order, balance.dueINR);
		return {
			pieces: order.lines.reduce((sum, line) => sum + (line.role === 'bundle' ? 0 : line.quantity), 0),
			goodsINR: balance.goodsINR,
			shippingINR,
			zone: parcel?.problem === null ? (parcel.quote.zone ?? null) : null,
			shippingTrace:
				parcel?.problem === null
					? parcel.quote.groups
							.flatMap((group) => group.trace.map((entry) => JSON.stringify(entry)))
							.slice(0, 40)
					: [],
			shippingPieces:
				parcel?.problem === null
					? parcel.quote.lines.map((line) => ({
							lineId: line.lineId,
							units: line.units,
							discounted: line.discounted,
						}))
					: [],
			totalINR: balance.totalINR,
			paidINR: balance.paidINR,
			dueINR: balance.dueINR,
			paidAheadINR: balance.paidAheadINR,
			toAccount: account ? { allowed: !account.refusal, reason: account.refusal } : null,
			problem: !order.lines.length ? 'nothing_to_close' : (parcel?.problem ?? null),
		};
	}

	/** Close (oo08): shipping for one parcel, then the rest by request, later, or on account. */
	async close(id: string, input: OpenOrderClose, actor: Actor, now = new Date()): Promise<AdminOrderDetail> {
		const order = await this.openOrder(id);
		if (!order.lines.length)
			throw new ConflictException(codedRefusal('nothing_to_close', 'Add pieces before closing', 'id'));
		const parcel = await this.parcelQuote(order);
		if (parcel.problem === 'no_addresses')
			throw new ConflictException(codedRefusal('no_addresses', 'This order has no delivery address', 'id'));
		if (parcel.problem === 'cannot_ship') {
			throw new ConflictException(
				codedRefusal('cannot_ship', 'The shipping for this parcel could not be worked out', 'id', {
					status: parcel.quote.status,
				}),
			);
		}
		const { quote, delivery } = parcel;
		const payments = await this.payments.listByOrder(id);
		const balance = orderBalance({
			lineTotalsINR: order.lines.map((line) => line.lineTotalINR),
			couponINR: order.balance?.couponINR ?? 0,
			shippingINR: quote.amountINR,
			payments,
		});
		let dueOn: string | null = null;
		if (input.then === 'toAccount') {
			const account = await this.accountFor(order, balance.dueINR);
			if (!account)
				throw new ConflictException(
					codedRefusal('not_a_business', 'Only a business can take it on account', 'then'),
				);
			if (account.refusal)
				throw new ConflictException(
					codedRefusal('credit_refused', 'It cannot go on account', 'then', { reason: account.refusal }),
				);
			dueOn = onAccountDueDate(istDay(now), account.customer.creditDays);
		}
		const status = statusAfterClose(balance.dueINR, input.then);
		const at = now.toISOString();
		const next: Order = {
			...order,
			balance,
			status,
			placedWith: input.then === 'toAccount' ? 'onAccount' : order.placedWith,
			onAccountDueOn: input.then === 'toAccount' ? dueOn : (order.onAccountDueOn ?? null),
			paymentStatus: derivePaymentStatus({
				balance,
				cashOnDelivery: false,
				onAccount: input.then === 'toAccount',
				activeRequest: false,
				pendingAtBank: payments.some((payment) => payment.state === 'pending'),
			}),
			shipping: {
				value: quote.amountINR,
				currency: 'INR',
				chargeINR: quote.amountINR,
				zone: quote.zone,
				deliveryCountry: delivery.countryCode ?? delivery.country,
				trace: quote.groups.flatMap((group) => group.trace.map((entry) => JSON.stringify(entry))).slice(0, 40),
				ruleSets: quote.groups.flatMap((group) =>
					group.ruleSetId && group.version
						? [{ id: group.ruleSetId, version: group.version, name: group.ruleSetName ?? '' }]
						: [],
				),
				pending: false,
				pieces: quote.lines.map((line) => ({
					lineId: line.lineId,
					units: line.units,
					discounted: line.discounted,
				})),
			},
			statusTimeline: [...order.statusTimeline, { status, at }],
			history: [
				...order.history,
				historyEntry(actor, at, 'closed', {
					from: 'open',
					to: status,
					// Closed and placed (paid up, or on account): Order confirmed goes once it is saved.
					messages: this.orders.told(order, statusNotices(order.status, status)),
					detail: { shippingINR: quote.amountINR, then: input.then },
				}),
			],
		};
		const saved = await this.transactions.withTransaction(async (context) => {
			const saved = await this.orders.updateRaw(next, input.revision, context);
			if (input.then === 'toAccount' && order.buyer?.businessId && balance.dueINR > 0) {
				await this.ledgers.append(
					{
						id: `led_${randomUUID()}`,
						businessId: order.buyer.businessId,
						side: 'receivable',
						kind: 'orderOnAccount',
						amountINR: balance.dueINR,
						documentType: 'order',
						documentId: saved.id,
						documentNumber: saved.orderNumber,
						dueOn,
						note: null,
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
		await this.orders.tell(order, saved);
		return this.orders.detail(id, now);
	}
}
