import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AdminOrderDetail,
	OpenOrderAddLines,
	OpenOrderClose,
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
	type BusinessRepository,
	type LedgerRepository,
	type OrderPaymentRepository,
	type OrderSettingsRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
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
import { AdminOrdersService, historyEntry, type Actor } from './admin-orders.service';
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
		const added: OrderLine[] = view.lines.map((line) => ({
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
			unitPricePaid: line.unitPriceINR,
			lineTotalINR: line.lineTotalINR,
			lineTotalPaid: line.lineTotalINR,
			pricing: {
				regularUnitINR:
					line.zonePrice?.kind === 'priced' ? line.zonePrice.retailUnitPriceINR : line.unitPriceINR,
				saleUnitINR: null,
				saleEventId: null,
				zoneRule:
					line.zonePrice?.kind === 'priced' && line.zonePrice.rule.tier !== 'retail'
						? line.zonePrice.rule
						: null,
				discounted: false,
			},
			couponINR: 0,
			categoryIds: [],
			held: false,
			addedAt: at,
			addedBy: actor.id,
		}));
		await this.transactions.withTransaction(async (context) => {
			await this.stock.reserve(order, added, actor.id, context, at);
			const withLines: Order = {
				...order,
				lines: [...order.lines, ...added.map((line) => ({ ...line, held: !line.madeToOrder }))],
			};
			await this.orders.settle(withLines, input.revision, actor, at, context, {
				kind: 'lineAdded',
				detail: { lines: added.length, skus: added.map((line) => line.sku).join(',') },
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
					detail: { sku: line.sku, quantity: line.quantity },
				},
			);
		});
		return this.orders.detail(id, now);
	}

	/** Close (oo08): shipping for one parcel, then the rest by request, later, or on account. */
	async close(id: string, input: OpenOrderClose, actor: Actor, now = new Date()): Promise<AdminOrderDetail> {
		const order = await this.openOrder(id);
		if (!order.lines.length)
			throw new ConflictException(codedRefusal('nothing_to_close', 'Add pieces before closing', 'id'));
		const delivery = order.addresses?.delivery;
		if (!delivery)
			throw new ConflictException(codedRefusal('no_addresses', 'This order has no delivery address', 'id'));
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
		if (quote.status !== 'priced' || quote.amountINR === null) {
			throw new ConflictException(
				codedRefusal('cannot_ship', 'The shipping for this parcel could not be worked out', 'id', {
					status: quote.status,
				}),
			);
		}
		const payments = await this.payments.listByOrder(id);
		const balance = orderBalance({
			lineTotalsINR: order.lines.map((line) => line.lineTotalINR),
			couponINR: order.balance?.couponINR ?? 0,
			shippingINR: quote.amountINR,
			payments,
		});
		let dueOn: string | null = null;
		if (input.then === 'toAccount') {
			const businessId = order.buyer?.kind === 'business' ? order.buyer.businessId : null;
			const business = businessId ? await this.businesses.findById(businessId) : null;
			const customer = business?.roles.customer;
			if (!business || !customer)
				throw new ConflictException(
					codedRefusal('not_a_business', 'Only a business can take it on account', 'then'),
				);
			const check = checkCredit({
				standing: customer.standing,
				limitINR: customer.creditLimitINR,
				outstandingINR: Math.max(0, await this.ledgers.balance(business.id, 'receivable')),
				orderINR: balance.dueINR,
				businessAccounts: (await this.settings.get()).businessAccounts,
			});
			if (check.refusal)
				throw new ConflictException(
					codedRefusal('credit_refused', 'It cannot go on account', 'then', { reason: check.refusal }),
				);
			dueOn = onAccountDueDate(istDay(now), customer.creditDays);
		}
		const status = statusAfterClose(balance.dueINR, input.then);
		const at = now.toISOString();
		const next: Order = {
			...order,
			balance,
			status,
			placedWith: input.then === 'toAccount' ? 'onAccount' : order.placedWith,
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
				trace: [],
				ruleSets: quote.groups.flatMap((group) =>
					group.ruleSetId && group.version ? [{ id: group.ruleSetId, version: group.version }] : [],
				),
				pending: false,
			},
			statusTimeline: [...order.statusTimeline, { status, at }],
			history: [
				...order.history,
				historyEntry(actor, at, 'closed', {
					from: 'open',
					to: status,
					detail: { shippingINR: quote.amountINR, then: input.then },
				}),
			],
		};
		await this.transactions.withTransaction(async (context) => {
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
		});
		return this.orders.detail(id, now);
	}
}
