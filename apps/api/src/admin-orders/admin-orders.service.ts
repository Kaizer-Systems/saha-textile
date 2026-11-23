import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	type AdminOrderDetail,
	AttentionReason,
	type EInvoiceWrite,
	type EWayBillWrite,
	type InvoiceAddressWrite,
	type ManualPaymentWrite,
	type MarkPaymentReceivedWrite,
	type Order,
	type OrderHistoryEntry,
	type OrderListQuery,
	type OrderListResponse,
	type OrderListRow,
	type OrderPayment,
	type OrderSettings,
	type PaymentRequest,
	type RaiseEDocumentResult,
	type StatusChangeWrite,
} from '@saha-textile/contracts';
import {
	allowedNextStatuses,
	canMoveTo,
	derivePaymentStatus,
	manualPaymentPrefill,
	orderBalance,
	eDocumentsRequired,
	isPlaceable,
	packLines,
	packListIncomplete,
	isRequestActive,
	openTooLong,
	type AdminOrderRepository,
	type OrderNotice,
	type AdminUserRepository,
	type BusinessRepository,
	type EInvoicePort,
	type EWayBillPort,
	type LedgerRepository,
	type OrderPaymentRepository,
	type OrderSettingsRepository,
	type PaymentRequestRepository,
	type ShipmentRepository,
	type StatusMachineOrder,
	type StatusMachineSettings,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { EDocsService } from '../edocs/edocs.service';
import { InvoicesService } from '../invoicing/invoices.service';
import { AddressBookService } from '../addresses/address-book.service';
import { codedRefusal } from '../common/coded-refusal';
import {
	ADMIN_ORDER_REPOSITORY,
	ADMIN_USER_REPOSITORY,
	BUSINESS_REPOSITORY,
	EINVOICE_PORT,
	EWAYBILL_PORT,
	LEDGER_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	ORDER_SETTINGS_REPOSITORY,
	PAYMENT_REQUEST_REPOSITORY,
	SHIPMENT_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { OrderNoticesService, type OrderNoticeFacts } from './order-notices.service';
import { OrderStock } from './order-stock';
import { refuseStale } from '../orders-setup/orders-audit';

export interface Actor {
	id: string | null;
	name: string | null;
}

/** The status machine's view of an order. */
export function machineOrder(order: Order): StatusMachineOrder {
	return {
		status: order.status,
		buyerKind: order.buyer?.kind ?? 'person',
		invoiceAddressNeeded: order.addresses?.invoice.needed ?? false,
		lines: order.lines.map((line) => ({ madeToOrder: line.madeToOrder ?? false })),
		placeable: isPlaceable(order.paymentStatus),
		hasEInvoice: !!order.eInvoice,
		hasEWayBill: !!order.eWayBill,
		goodsINR: order.balance?.goodsINR ?? order.subtotalINR,
		packListIncomplete: packListIncomplete(order),
	};
}

/**
 * `eInvoiceEnabled`: whether this business's GSTIN is e-invoice enabled today (Settings › E-invoice and e-way bill,
 * accounts brief addendum 2). A GSTIN that isn't enabled can't get an IRN, so Shipped doesn't wait for one.
 */
export function machineSettings(settings: OrderSettings, eInvoiceEnabled = true): StatusMachineSettings {
	return {
		outForDeliveryOnlyFromCourier: settings.outForDeliveryOnlyFromCourier,
		eInvoiceRequired: settings.eInvoiceRequired && eInvoiceEnabled,
		eWayBillThresholdINR: settings.eWayBillThresholdINR,
		courierConnected: false,
	};
}

/** What the list's "Needs attention" filter finds, stored with each save (time-based reasons are worked out on read). */
export function metaOf(order: Order): { attention: AttentionReason[] } {
	const attention: AttentionReason[] = [];
	if (order.addresses?.invoice.needed) attention.push('invoiceAddressNeeded');
	if (order.paymentStatus === 'pending_at_bank') attention.push('pendingAtBank');
	if (order.paymentReview) attention.push('paymentReview');
	return { attention };
}

/** Why an order waits on staff (ol03): worked out from the order, its payments and its requests. */
export function attentionOf(
	order: Order,
	requests: readonly PaymentRequest[],
	settings: OrderSettings,
	now: Date,
): AttentionReason[] {
	const reasons: AttentionReason[] = [];
	if (order.addresses?.invoice.needed) reasons.push('invoiceAddressNeeded');
	if (
		order.status === 'awaiting_payment' &&
		requests.length > 0 &&
		!requests.some((request) => isRequestActive(request, now)) &&
		requests.some((request) => request.status !== 'paid')
	) {
		reasons.push('requestExpiredUnpaid');
	}
	if (order.paymentStatus === 'pending_at_bank') reasons.push('pendingAtBank');
	if (order.paymentReview) reasons.push('paymentReview');
	if (
		order.status === 'open' &&
		settings.openOrders.enabled &&
		order.openedAt &&
		openTooLong(order.openedAt, now, settings.openOrders.remindAfterDays)
	) {
		reasons.push('openTooLong');
	}
	return reasons;
}

/**
 * The line under the payment chip (ol02), as data: the live request, the last payment received, or
 * how an unpaid order will be paid (cash on delivery, on account with its due day).
 */
export function paymentDetailOf(
	payments: readonly OrderPayment[],
	requests: readonly PaymentRequest[],
	now: Date,
	order?: Pick<Order, 'paymentStatus' | 'onAccountDueOn'>,
): OrderListRow['paymentDetail'] {
	const live = requests.find((request) => isRequestActive(request, now));
	if (live) return { kind: 'request', gateway: live.gateway, until: live.expiresAt };
	if (order?.paymentStatus === 'due_on_delivery') return { kind: 'cashOnDelivery' };
	if (order?.paymentStatus === 'on_account') return { kind: 'onAccount', dueOn: order.onAccountDueOn ?? null };
	const last = [...payments].reverse().find((payment) => payment.state === 'received');
	if (!last) return null;
	return {
		kind: 'payment',
		method: last.method,
		referenceStart: last.reference ? last.reference.slice(0, 4) : null,
		reference: last.method === 'gateway' ? null : last.reference,
		gateway: last.gateway?.id ?? null,
	};
}

/**
 * When each reason started (ol03): the newest request that ran out unpaid, the payment the bank left
 * pending, the gateway answer under review, the day an open order was opened.
 */
export function attentionTimesOf(
	order: Order,
	reasons: readonly AttentionReason[],
	payments: readonly OrderPayment[],
	requests: readonly PaymentRequest[],
): OrderListRow['attentionAt'] {
	const at: OrderListRow['attentionAt'] = {};
	if (reasons.includes('requestExpiredUnpaid')) {
		const last = [...requests]
			.filter((request) => request.status !== 'paid')
			.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
			.pop();
		if (last) at.requestExpiredUnpaid = last.expiresAt;
	}
	if (reasons.includes('pendingAtBank')) {
		const pending = [
			...payments.filter((payment) => payment.state === 'pending').map((payment) => payment.recordedAt),
			...requests.flatMap((request) =>
				request.attempts.filter((attempt) => attempt.state === 'pending').map((attempt) => attempt.at),
			),
		].sort();
		const latest = pending.pop();
		if (latest) at.pendingAtBank = latest;
	}
	if (reasons.includes('paymentReview') && order.paymentReview) at.paymentReview = order.paymentReview.at;
	if (reasons.includes('openTooLong') && order.openedAt) at.openTooLong = order.openedAt;
	return at;
}

/**
 * The admin order list and order page (brief ol02–ol04, od05–od08, st01–st05; owner 2026-11-16 to
 * 2026-11-20): server search and date range, attention reasons, the status machine's menu, comments,
 * the staff-only invoice address, and the e-invoice / e-way bill details, typed by hand until an
 * integration exists (Raise asks the port first; "not connected" opens the manual popup).
 */
@Injectable()
export class AdminOrdersService {
	constructor(
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: AdminOrderRepository,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: OrderPaymentRepository,
		@Inject(PAYMENT_REQUEST_REPOSITORY) private readonly requests: PaymentRequestRepository,
		@Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Inject(LEDGER_REPOSITORY) private readonly ledgers: LedgerRepository,
		@Inject(EINVOICE_PORT) private readonly eInvoice: EInvoicePort,
		@Inject(EWAYBILL_PORT) private readonly eWayBill: EWayBillPort,
		private readonly numbers: DocumentNumbersService,
		private readonly addressBook: AddressBookService,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		private readonly stock: OrderStock,
		@Optional() @Inject(ADMIN_USER_REPOSITORY) private readonly adminUsers: AdminUserRepository | null = null,
		@Optional() @Inject(OrderNoticesService) private readonly notices: OrderNoticesService | null = null,
		@Optional() @Inject(EDocsService) private readonly edocs: EDocsService | null = null,
		@Optional() @Inject(InvoicesService) private readonly invoicesSvc: InvoicesService | null = null,
	) {}

	/** Without the e-document settings (tests), the old rule stands: business orders need an IRN. */
	private eInvoiceEnabled(): Promise<boolean> {
		return this.edocs ? this.edocs.eInvoiceEnabled() : Promise.resolve(true);
	}

	/**
	 * After a change is saved: the messages its status move tells the customer (order_confirmed when
	 * a payment placed it, and so on). Never inside a transaction, so nothing goes out for a change
	 * that was rolled back.
	 */
	async tell(before: Order, after: Order, facts: OrderNoticeFacts = {}): Promise<void> {
		await this.notices?.afterChange(before, after, facts);
	}

	/** The history's "Customer told" for these messages: only the ones that have somewhere to go. */
	told(order: Order, templates: readonly string[]): OrderNotice[] {
		return this.notices?.plan(order, templates) ?? [];
	}

	/** Staff names by id for the order page; an unknown or removed account is simply left out. */
	private async staffNames(ids: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
		const names: Record<string, string> = {};
		if (!this.adminUsers) return names;
		for (const id of new Set(ids.filter((value): value is string => !!value))) {
			const user = await this.adminUsers.findById(id).catch(() => null);
			const name = user?.displayName?.trim() || user?.username?.trim() || user?.email?.split('@')[0];
			if (name) names[id] = name;
		}
		return names;
	}

	/**
	 * bz06: a business receipt's share of one order on account, recorded on the order as a payment with
	 * the receipt's number and settled (the order moves on when nothing is left due).
	 */
	async settleFromReceipt(
		orderId: string,
		share: { amountINR: number; receiptNumber: string | null; reference: string; receivedOn: string },
		actor: Actor,
		context: TransactionContext,
		now = new Date(),
	): Promise<void> {
		const order = await this.get(orderId);
		const at = now.toISOString();
		await this.payments.save(
			{
				id: `pay_${randomUUID()}`,
				orderId,
				method: 'onAccount',
				state: 'received',
				amountINR: share.amountINR,
				currency: 'INR',
				amount: share.amountINR,
				reference: share.reference,
				gateway: null,
				paypal: null,
				collector: null,
				collectedBy: null,
				receivedOn: share.receivedOn,
				receiptNumber: share.receiptNumber,
				note: null,
				proofMediaId: null,
				recordedBy: actor.id,
				recordedAt: at,
			},
			context,
		);
		await this.settle(order, order.revision, actor, at, context, {
			kind: 'payment',
			detail: {
				method: 'onAccount',
				amountINR: share.amountINR,
				reference: share.reference,
				receipt: share.receiptNumber,
			},
		});
	}

	async list(query: OrderListQuery, now = new Date()): Promise<OrderListResponse> {
		const [{ orders, total }, counts, settings] = await Promise.all([
			this.orders.list(query),
			this.orders.counts(query),
			this.settings.get(),
		]);
		const items = await Promise.all(orders.map((order) => this.row(order, settings, now)));
		const count = (key: string) => counts[key] ?? 0;
		return {
			items,
			total,
			counts: Object.fromEntries(
				[
					'all',
					'needsAttention',
					'open',
					'awaitingPayment',
					'placed',
					'processing',
					'packed',
					'shipped',
					'delivered',
					'cancelled',
				].map((key) => [key, count(key)]),
			) as OrderListResponse['counts'],
			tiles: {
				needsAttention: count('needsAttention'),
				awaitingPayment: count('awaitingPayment'),
				toPack: count('toPack'),
				shippedNotDelivered: count('shipped'),
				attentionBy: Object.fromEntries(
					AttentionReason.options
						.map((reason) => [reason, count(`attention:${reason}`)] as const)
						.filter(([, value]) => value > 0),
				),
			},
		};
	}

	private async row(order: Order, settings: OrderSettings, now: Date): Promise<OrderListRow> {
		const [payments, requests] = await Promise.all([
			this.payments.listByOrder(order.id),
			this.requests.listByOrder(order.id),
		]);
		const balance = order.balance;
		const attention = attentionOf(order, requests, settings, now);
		return {
			id: order.id,
			orderNumber: order.orderNumber,
			createdAt: order.createdAt ?? now.toISOString(),
			channel: order.channel,
			buyerName: order.buyer?.name ?? '',
			buyerKind: order.buyer?.kind ?? 'person',
			currency: order.currency,
			total: order.totalPaid,
			totalINR: order.totalINR,
			status: order.status,
			paymentStatus: order.paymentStatus,
			paymentDetail: paymentDetailOf(payments, requests, now, order),
			deliveryCountry:
				order.addresses?.delivery.countryCode ??
				order.addresses?.delivery.country ??
				order.shipping?.deliveryCountry ??
				null,
			attention,
			attentionAt: attentionTimesOf(order, attention, payments, requests),
			open:
				order.status === 'open' && order.openedAt
					? {
							openedAt: order.openedAt,
							piecesHeld: order.lines
								.filter((line) => line.held)
								.reduce((sum, line) => sum + line.quantity, 0),
							goodsINR: balance?.goodsINR ?? order.subtotalINR,
							paidINR: balance?.paidINR ?? 0,
							dueINR: balance?.dueINR ?? 0,
							paidAheadINR: balance?.paidAheadINR ?? 0,
						}
					: null,
		};
	}

	async get(id: string): Promise<Order> {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException(codedRefusal('order_missing', 'That order does not exist', 'id'));
		return order;
	}

	async detail(id: string, now = new Date()): Promise<AdminOrderDetail> {
		const order = await this.get(id);
		const [payments, requests, shipments, settings, courierNames] = await Promise.all([
			this.payments.listByOrder(id),
			this.requests.listByOrder(id),
			this.shipments.listByOrder(id),
			this.settings.get(),
			this.shipments.courierNames(20),
		]);
		const machine = machineOrder(order);
		const rules = machineSettings(settings, await this.eInvoiceEnabled());
		return {
			order,
			payments,
			requests,
			shipments,
			allowedNext: allowedNextStatuses(machine, rules),
			attention: attentionOf(order, requests, settings, now),
			credit: await this.credit(order),
			eDocuments: {
				shown: eDocumentsRequired(machine, rules),
				eInvoice: {
					required: rules.eInvoiceRequired && machine.buyerKind === 'business',
					present: machine.hasEInvoice,
					connected: this.eInvoice.connected,
				},
				eWayBill: {
					required: machine.goodsINR >= rules.eWayBillThresholdINR,
					present: machine.hasEWayBill,
					connected: this.eWayBill.connected,
				},
			},
			courierNames,
			staff: await this.staffNames([
				order.createdBy,
				...order.history.map((entry) => entry.by),
				...payments.map((payment) => payment.recordedBy),
				...requests.map((request) => request.createdBy),
			]),
		};
	}

	private async credit(order: Order): Promise<AdminOrderDetail['credit']> {
		const businessId = order.buyer?.kind === 'business' ? order.buyer.businessId : null;
		if (!businessId) return null;
		const business = await this.businesses.findById(businessId);
		const customer = business?.roles.customer;
		if (!customer) return null;
		const used = await this.ledgers.balance(businessId, 'receivable');
		return {
			limitINR: customer.creditLimitINR,
			usedINR: Math.max(0, used),
			// Never below ₹0 on the page: past the limit (an approved one-off), Used shows by how much.
			availableINR: Math.max(0, customer.creditLimitINR - Math.max(0, used)),
			standing: customer.standing,
			creditDays: customer.creditDays,
		};
	}

	/** One step on the status machine; the server decides, the menu only shows its answer (K4). */
	async changeStatus(
		id: string,
		input: StatusChangeWrite,
		actor: Actor,
		now = new Date(),
	): Promise<AdminOrderDetail> {
		const order = await this.get(id);
		const settings = await this.settings.get();
		const verdict = canMoveTo(
			machineOrder(order),
			input.to,
			machineSettings(settings, await this.eInvoiceEnabled()),
		);
		if (!verdict.allowed) {
			throw new ConflictException(
				codedRefusal('status_blocked', 'That step is not allowed yet', 'to', { reason: verdict.reason }),
			);
		}
		if (input.to === 'shipped' && !input.shipped) {
			throw new BadRequestException(
				codedRefusal('courier_needed', 'Type the courier and tracking number', 'shipped'),
			);
		}
		if (input.to === 'delivered' && !input.delivered) {
			throw new BadRequestException(codedRefusal('delivered_on_needed', 'Give the delivery date', 'delivered'));
		}
		if (input.to === 'cancelled' && !input.cancel) {
			throw new BadRequestException(codedRefusal('cancel_reason_needed', 'Give a reason', 'cancel'));
		}
		const at = now.toISOString();
		const tells = allowedNextStatuses(
			machineOrder(order),
			machineSettings(settings, await this.eInvoiceEnabled()),
		).find((row) => row.to === input.to)?.tells;
		// od06: "Customer told · Email · SMS": the messages that have somewhere to go (Settings ›
		// Communications can still hold one back when it is sent).
		const told = this.notices?.plan(order, tells ?? []) ?? [];
		const saved = await this.transactions.withTransaction(async (context) => {
			let lines = order.lines;
			if (input.to === 'cancelled') {
				// Cancelled: the kept pieces go back on sale at once.
				await this.stock.release(order, lines, actor.id, context, at);
				lines = lines.map((line) => ({ ...line, held: false }));
			}
			if (input.shipped) {
				// Shipped: the kept pieces leave on-hand, costed from the oldest layers.
				const costs = await this.stock.sell(order, lines, actor.id, context, at);
				lines = lines.map((line) => ({
					...line,
					held: false,
					unitCostINR: (line.lineId ? costs.get(line.lineId) : undefined) ?? line.unitCostINR ?? null,
				}));
				const existing = await this.shipments.listByOrder(id);
				// A parcel holds physical pieces: a set's own line carries nothing, its pieces are lines of their own.
				const physical = order.lines.flatMap((line) =>
					line.lineId && line.role !== 'bundle' ? [line.lineId] : [],
				);
				const shipmentId = `shp_${randomUUID()}`;
				const parcelLineIds = (input.shipped.lineIds ?? physical).filter((lineId) => physical.includes(lineId));
				await this.shipments.save(
					{
						id: shipmentId,
						orderId: id,
						number: await this.numbers.childNumber('parcel', order.orderNumber, existing.length + 1),
						lineIds: parcelLineIds,
						mode: 'manual',
						provider: null,
						courierName: input.shipped.courierName,
						trackingNumber: input.shipped.trackingNumber,
						trackingUrl: input.shipped.trackingUrl,
						shippedOn: input.shipped.shippedOn,
						deliveredOn: null,
						pod: null,
						events: [{ at, status: 'shipped', note: input.comment }],
						createdBy: actor.id,
						createdAt: at,
					},
					context,
				);
				// The parcel's tax invoice, when Tax invoices at dispatch is on (accounts brief D1, D3).
				await this.invoicesSvc?.issueAtDispatch(
					{ order: { ...order, lines }, shipmentId, lineIds: parcelLineIds, actorId: actor.id, at },
					context,
				);
			}
			if (input.delivered) {
				const latest = (await this.shipments.listByOrder(id)).at(-1);
				if (latest) {
					await this.shipments.save(
						{
							...latest,
							deliveredOn: input.delivered.deliveredOn,
							pod: {
								source: 'staff',
								reference: input.delivered.podReference,
								receivedBy: input.delivered.receivedBy,
								url: null,
								note: null,
							},
							events: [...latest.events, { at, status: 'delivered', note: input.comment }],
						},
						context,
					);
				}
			}
			const next: Order = {
				...order,
				lines,
				status: input.to,
				statusTimeline: [
					...order.statusTimeline,
					{ status: input.to, at, ...(input.comment ? { note: input.comment } : {}) },
				],
				closedAt: input.to === 'cancelled' || input.to === 'delivered' ? at : (order.closedAt ?? null),
				history: [
					...order.history,
					historyEntry(actor, at, 'status', {
						from: order.status,
						to: input.to,
						comment: input.comment ?? input.cancel?.note ?? null,
						messages: told,
						detail: {
							...(input.cancel ? { reason: input.cancel.reason } : {}),
							...(input.shipped
								? { courier: input.shipped.courierName, tracking: input.shipped.trackingNumber }
								: {}),
							...(input.delivered
								? {
										proof: input.delivered.receivedBy ?? input.delivered.podReference ?? null,
										deliveredOn: input.delivered.deliveredOn,
									}
								: {}),
						},
					}),
				],
			};
			return refuseStale(
				() => this.orders.update(next, input.revision, context, metaOf(next)),
				'Someone else changed this order first',
			);
		});
		await this.notices?.send(saved, tells ?? [], {
			...(input.shipped
				? {
						shipment: {
							courierName: input.shipped.courierName,
							trackingNumber: input.shipped.trackingNumber,
							trackingUrl: input.shipped.trackingUrl ?? null,
						},
					}
				: {}),
		});
		return this.detail(id, now);
	}

	async comment(
		id: string,
		comment: string,
		revision: number,
		actor: Actor,
		now = new Date(),
	): Promise<AdminOrderDetail> {
		const order = await this.get(id);
		const next = {
			...order,
			history: [...order.history, historyEntry(actor, now.toISOString(), 'comment', { comment })],
		};
		await refuseStale(
			() => this.orders.update(next, revision, undefined, metaOf(next)),
			'Someone else changed this order first',
		);
		return this.detail(id, now);
	}

	/**
	 * One Pack list tick (bundle builder brief E08): a line goes in the parcel or comes back out. Ticks are kept until
	 * Packed; a set's own line is never a piece, and a shipped or cancelled order has nothing left to pack.
	 */
	async packTick(id: string, input: { lineId: string; ticked: boolean; revision: number }, now = new Date()) {
		const order = await this.get(id);
		if (!['placed', 'processing'].includes(order.status)) {
			throw new ConflictException(codedRefusal('pack_closed', 'This order is not being packed', 'status'));
		}
		if (!packLines(order.lines).some((line) => line.lineId === input.lineId)) {
			throw new BadRequestException(codedRefusal('pack_line_unknown', 'No such piece on this order', 'lineId'));
		}
		const ticks = new Set(order.packTicks);
		if (input.ticked) ticks.add(input.lineId);
		else ticks.delete(input.lineId);
		const next = { ...order, packTicks: [...ticks] };
		await refuseStale(
			() => this.orders.update(next, input.revision, undefined, metaOf(next)),
			'Someone else changed this order first',
		);
		return this.detail(id, now);
	}

	/** The staff-only invoice address (od04): checked like every address, recorded with how it was confirmed. */
	async setInvoiceAddress(id: string, input: InvoiceAddressWrite, actor: Actor, now = new Date()) {
		const order = await this.get(id);
		if (!order.addresses) {
			throw new ConflictException(codedRefusal('no_addresses', 'This order has no addresses to add to', 'id'));
		}
		if (input.address.countryCode !== 'IN') {
			throw new BadRequestException(
				codedRefusal('invoice_address_india', 'The invoice address must be in India', 'address'),
			);
		}
		const checked = await this.addressBook.check(input.address);
		const at = now.toISOString();
		const next: Order = {
			...order,
			addresses: {
				...order.addresses,
				invoice: {
					source: 'staff',
					address: { ...checked, savedAddressId: null },
					needed: false,
					addedBy: actor.id,
					confirmedHow: input.confirmedHow,
					at,
				},
			},
			history: [...order.history, historyEntry(actor, at, 'invoiceAddress', { comment: input.confirmedHow })],
		};
		await refuseStale(
			() => this.orders.update(next, input.revision, undefined, metaOf(next)),
			'Someone else changed this order first',
		);
		return this.detail(id, now);
	}

	/** Raise e-invoice / e-way bill: the integration when one is connected, else the manual popup. */
	async raise(
		id: string,
		kind: 'eInvoice' | 'eWayBill',
		actor: Actor,
		now = new Date(),
	): Promise<RaiseEDocumentResult> {
		const order = await this.get(id);
		const outcome = kind === 'eInvoice' ? await this.eInvoice.raise(order) : await this.eWayBill.raise(order);
		if (outcome.kind === 'notConnected') return { outcome: 'notConnected' };
		if (outcome.kind === 'refused') return { outcome: 'refused', message: outcome.message };
		const at = now.toISOString();
		const record = { ...outcome.record, by: actor.id ?? 'unknown', at };
		const next: Order = {
			...order,
			...(kind === 'eInvoice'
				? { eInvoice: record as Order['eInvoice'] }
				: { eWayBill: record as Order['eWayBill'] }),
			history: [...order.history, historyEntry(actor, at, 'eDocument', { detail: { kind, source: 'api' } })],
		};
		const saved = await this.orders.update(next, order.revision, undefined, metaOf(next));
		await this.edocs?.recordForOrder(
			saved,
			kind,
			kind === 'eInvoice' ? 'irpDirect' : 'ewbDirect',
			actor.id ?? 'unknown',
		);
		return { outcome: 'raised', order: saved };
	}

	async setEInvoice(id: string, input: EInvoiceWrite, actor: Actor, now = new Date()) {
		const order = await this.get(id);
		const at = now.toISOString();
		const { revision, ...fields } = input;
		const next: Order = {
			...order,
			eInvoice: { ...fields, signedQr: fields.signedQr ?? null, source: 'manual', by: actor.id ?? 'unknown', at },
			history: [
				...order.history,
				historyEntry(actor, at, 'eDocument', { detail: { kind: 'eInvoice', ackNo: input.ackNo } }),
			],
		};
		await refuseStale(
			() => this.orders.update(next, revision, undefined, metaOf(next)),
			'Someone else changed this order first',
		);
		const saved = await this.get(id);
		await this.edocs?.recordForOrder(saved, 'eInvoice', 'manual', actor.id ?? 'unknown');
		return this.detail(id, now);
	}

	async setEWayBill(id: string, input: EWayBillWrite, actor: Actor, now = new Date()) {
		const order = await this.get(id);
		const at = now.toISOString();
		const { revision, ...fields } = input;
		const next: Order = {
			...order,
			eWayBill: { ...fields, source: 'manual', by: actor.id ?? 'unknown', at },
			history: [
				...order.history,
				historyEntry(actor, at, 'eDocument', { detail: { kind: 'eWayBill', number: input.number } }),
			],
		};
		await refuseStale(
			() => this.orders.update(next, revision, undefined, metaOf(next)),
			'Someone else changed this order first',
		);
		const saved = await this.get(id);
		await this.edocs?.recordForOrder(saved, 'eWayBill', 'manual', actor.id ?? 'unknown');
		return this.detail(id, now);
	}

	/* ------------------------------------------------------------------------------------------ */
	/* Payments typed by hand (ck03–ck05, od08, oo03–oo05; K3: always rupees at rupee prices)      */
	/* ------------------------------------------------------------------------------------------ */

	/** What the Record payment popup opens with: the amount due now. */
	async paymentPrefill(id: string): Promise<{ amountINR: number }> {
		const order = await this.get(id);
		return { amountINR: order.balance ? manualPaymentPrefill(order.balance) : order.totalINR };
	}

	async recordPayment(id: string, input: ManualPaymentWrite, actor: Actor, now = new Date()) {
		const order = await this.get(id);
		const settings = await this.settings.get();
		if (!settings.adminPaymentMethods[input.method]) {
			throw new ConflictException(codedRefusal('method_off', 'That payment method is switched off', 'method'));
		}
		if (order.status === 'cancelled') {
			throw new ConflictException(codedRefusal('order_cancelled', 'This order is cancelled', 'id'));
		}
		const at = now.toISOString();
		// od08: a payment received on an order already placed gets a receipt email; a payment that
		// places the order is in its Order confirmed message instead.
		const receipt = input.received && order.status !== 'awaiting_payment' ? ['payment_receipt'] : [];
		const { saved, payment } = await this.transactions.withTransaction(async (context) => {
			const payment: OrderPayment = {
				id: `pay_${randomUUID()}`,
				orderId: id,
				method: input.method,
				state: input.received ? 'received' : 'pending',
				amountINR: input.amountINR,
				currency: 'INR',
				amount: input.amountINR,
				reference: input.reference,
				gateway: null,
				paypal: null,
				collector: input.method === 'cashOnDelivery' ? (input.collector ?? 'staff') : null,
				collectedBy: input.method === 'cashOnDelivery' ? (input.collectedBy ?? null) : null,
				receivedOn: input.received ? input.receivedOn : null,
				receiptNumber: input.received ? await this.numbers.issue('receipt', context, now) : null,
				note: input.note,
				proofMediaId: input.proofMediaId,
				recordedBy: actor.id,
				recordedAt: at,
			};
			await this.payments.save(payment, context);
			if (input.received) await this.ledgerReceipt(order, payment, actor, at, context);
			const saved = await this.settle(order, input.revision, actor, at, context, {
				kind: 'payment',
				comment: input.note,
				messages: this.notices?.plan(order, receipt) ?? [],
				detail: {
					method: input.method,
					amountINR: input.amountINR,
					reference: input.reference,
					received: input.received,
				},
			});
			return { saved, payment };
		});
		await this.tell(order, saved);
		if (receipt.length) await this.notices?.send(saved, receipt, { payment }, payment.id);
		return this.detail(id, now);
	}

	/** A bank transfer recorded as not yet arrived, now in the bank. */
	async markReceived(id: string, paymentId: string, input: MarkPaymentReceivedWrite, actor: Actor, now = new Date()) {
		const order = await this.get(id);
		const payment = await this.payments.findById(paymentId);
		if (!payment || payment.orderId !== id) {
			throw new NotFoundException(codedRefusal('payment_missing', 'That payment does not exist', 'paymentId'));
		}
		if (payment.state !== 'pending' || payment.gateway) {
			throw new ConflictException(
				codedRefusal('payment_not_pending', 'That payment is not waiting', 'paymentId'),
			);
		}
		const at = now.toISOString();
		const receipt = order.status !== 'awaiting_payment' ? ['payment_receipt'] : [];
		const { saved, received } = await this.transactions.withTransaction(async (context) => {
			const received: OrderPayment = {
				...payment,
				state: 'received',
				reference: input.reference,
				receivedOn: input.receivedOn,
				receiptNumber: await this.numbers.issue('receipt', context, now),
			};
			await this.payments.save(received, context);
			await this.ledgerReceipt(order, received, actor, at, context);
			const saved = await this.settle(order, input.revision, actor, at, context, {
				kind: 'payment',
				messages: this.notices?.plan(order, receipt) ?? [],
				detail: { paymentId, received: true, reference: input.reference },
			});
			return { saved, received };
		});
		await this.tell(order, saved);
		if (receipt.length) await this.notices?.send(saved, receipt, { payment: received }, received.id);
		return this.detail(id, now);
	}

	/** A business's account: a payment on an order placed on account lowers what it owes. */
	private async ledgerReceipt(
		order: Order,
		payment: OrderPayment,
		actor: Actor,
		at: string,
		context: TransactionContext,
	) {
		const businessId = order.buyer?.kind === 'business' ? order.buyer.businessId : null;
		if (!businessId || order.placedWith !== 'onAccount') return;
		await this.ledgers.append(
			{
				id: `led_${randomUUID()}`,
				businessId,
				side: 'receivable',
				kind: 'receipt',
				amountINR: -payment.amountINR,
				documentType: 'payment',
				documentId: payment.id,
				documentNumber: payment.receiptNumber,
				dueOn: null,
				note: `Order ${order.orderNumber}`,
				reversalOf: null,
				agreement: null,
				at,
				by: actor.id ?? 'unknown',
			},
			context,
		);
	}

	/** Saves an order the caller built whole, with the revision check and the stored attention list. */
	updateRaw(next: Order, revision: number, context?: TransactionContext): Promise<Order> {
		return refuseStale(
			() => this.orders.update(next, revision, context, metaOf(next)),
			'Someone else changed this order first',
		);
	}

	/**
	 * Works the balance and payment status out again from every payment, places an order that was
	 * waiting for its money, and records the change in the history.
	 */
	async settle(
		order: Order,
		revision: number,
		actor: Actor,
		at: string,
		context: TransactionContext,
		entry: Partial<Omit<OrderHistoryEntry, 'at' | 'by' | 'byName'>> & { kind: OrderHistoryEntry['kind'] },
	): Promise<Order> {
		const [payments, requests] = await Promise.all([
			this.payments.listByOrder(order.id),
			this.requests.listByOrder(order.id),
		]);
		const balance = orderBalance({
			lineTotalsINR: order.lines.map((line) => line.lineTotalINR),
			couponINR: order.balance?.couponINR ?? 0,
			shippingINR: order.balance?.shippingINR ?? 0,
			payments,
		});
		const paymentStatus = derivePaymentStatus({
			balance,
			cashOnDelivery: order.placedWith === 'cashOnDelivery',
			onAccount: order.placedWith === 'onAccount',
			activeRequest: requests.some((request) => isRequestActive(request, new Date(at))),
			pendingAtBank: payments.some((payment) => payment.state === 'pending'),
		});
		const placeNow = order.status === 'awaiting_payment' && isPlaceable(paymentStatus);
		const { kind, ...extra } = entry;
		const next: Order = {
			...order,
			balance,
			paymentStatus,
			status: placeNow ? 'placed' : order.status,
			statusTimeline: placeNow ? [...order.statusTimeline, { status: 'placed', at }] : order.statusTimeline,
			history: [
				...order.history,
				historyEntry(actor, at, kind, extra),
				...(placeNow
					? [
							historyEntry(actor, at, 'status', {
								from: order.status,
								to: 'placed',
								messages: this.notices?.plan(order, ['order_confirmed']) ?? [],
							}),
						]
					: []),
			],
		};
		// Stored with the order so the list's "Needs attention" filter finds an unpaid request that ran out.
		const meta = metaOf(next);
		const nowAt = new Date(at);
		if (
			next.status === 'awaiting_payment' &&
			requests.length > 0 &&
			!requests.some((request) => isRequestActive(request, nowAt)) &&
			requests.some((request) => request.status !== 'paid')
		) {
			meta.attention.push('requestExpiredUnpaid');
		}
		return refuseStale(
			() => this.orders.update(next, revision, context, meta),
			'Someone else changed this order first',
		);
	}
}

export function historyEntry(
	actor: Actor,
	at: string,
	kind: OrderHistoryEntry['kind'],
	extra: Partial<Omit<OrderHistoryEntry, 'at' | 'by' | 'byName' | 'kind'>> = {},
): OrderHistoryEntry {
	return {
		at,
		by: actor.id,
		byName: actor.name,
		kind,
		from: extra.from ?? null,
		to: extra.to ?? null,
		comment: extra.comment ?? null,
		messages: extra.messages ?? [],
		detail: extra.detail ?? {},
	};
}

/** "3 × Blush Pink Georgette Saree, 1 × …" for the history (oo02); long lists end with "+N more". */
export function linesSummary(lines: ReadonlyArray<Pick<Order['lines'][number], 'quantity' | 'title'>>): string {
	const shown = lines.slice(0, 3).map((line) => `${line.quantity} × ${line.title.en}`);
	return lines.length > 3 ? `${shown.join(', ')} +${lines.length - 3}` : shown.join(', ');
}
