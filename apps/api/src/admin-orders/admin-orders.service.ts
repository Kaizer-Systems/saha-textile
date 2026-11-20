import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type AdminOrderDetail,
	type AttentionReason,
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
	isRequestActive,
	openTooLong,
	type AdminOrderRepository,
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

import { AddressBookService } from '../addresses/address-book.service';
import { codedRefusal } from '../common/coded-refusal';
import {
	ADMIN_ORDER_REPOSITORY,
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
	};
}

export function machineSettings(settings: OrderSettings): StatusMachineSettings {
	return {
		outForDeliveryOnlyFromCourier: settings.outForDeliveryOnlyFromCourier,
		eInvoiceRequired: settings.eInvoiceRequired,
		eWayBillThresholdINR: settings.eWayBillThresholdINR,
		courierConnected: false,
	};
}

/** What the list's "Needs attention" filter finds, stored with each save (time-based reasons are worked out on read). */
export function metaOf(order: Order): { attention: AttentionReason[] } {
	const attention: AttentionReason[] = [];
	if (order.addresses?.invoice.needed) attention.push('invoiceAddressNeeded');
	if (order.paymentStatus === 'pending_at_bank') attention.push('pendingAtBank');
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

const METHOD_WORDS: Record<string, string> = {
	upi: 'UPI',
	bankTransfer: 'Bank transfer',
	cashOnDelivery: 'Cash on delivery',
	gateway: 'Online',
	onAccount: 'On account',
};

/** The line under the payment chip: "UPI · 4021…", "Link sent · PayPal · until 2026-11-27". */
export function paymentDetailOf(payments: readonly OrderPayment[], requests: readonly PaymentRequest[], now: Date) {
	const live = requests.find((request) => isRequestActive(request, now));
	if (live) return `Link sent · ${live.gateway} · until ${live.expiresAt.slice(0, 10)}`;
	const last = [...payments].reverse().find((payment) => payment.state === 'received');
	if (!last) return null;
	const reference = last.reference ? ` · ${last.reference.slice(0, 4)}…` : '';
	return `${METHOD_WORDS[last.method] ?? last.method}${reference}`;
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
	) {}

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
			},
		};
	}

	private async row(order: Order, settings: OrderSettings, now: Date): Promise<OrderListRow> {
		const [payments, requests] = await Promise.all([
			this.payments.listByOrder(order.id),
			this.requests.listByOrder(order.id),
		]);
		const balance = order.balance;
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
			paymentDetail: paymentDetailOf(payments, requests, now),
			attention: attentionOf(order, requests, settings, now),
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
		const [payments, requests, shipments, settings] = await Promise.all([
			this.payments.listByOrder(id),
			this.requests.listByOrder(id),
			this.shipments.listByOrder(id),
			this.settings.get(),
		]);
		const machine = machineOrder(order);
		const rules = machineSettings(settings);
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
			availableINR: customer.creditLimitINR - Math.max(0, used),
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
		const verdict = canMoveTo(machineOrder(order), input.to, machineSettings(settings));
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
		const tells = allowedNextStatuses(machineOrder(order), machineSettings(settings)).find(
			(row) => row.to === input.to,
		)?.tells;
		await this.transactions.withTransaction(async (context) => {
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
				await this.shipments.save(
					{
						id: `shp_${randomUUID()}`,
						orderId: id,
						number: await this.numbers.childNumber('parcel', order.orderNumber, existing.length + 1),
						lineIds:
							input.shipped.lineIds ?? order.lines.flatMap((line) => (line.lineId ? [line.lineId] : [])),
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
						messages: (tells ?? []).map((template) => ({ channel: 'email' as const, template })),
						detail: input.cancel ? { reason: input.cancel.reason } : {},
					}),
				],
			};
			await refuseStale(
				() => this.orders.update(next, input.revision, context, metaOf(next)),
				'Someone else changed this order first',
			);
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
		return { outcome: 'raised', order: await this.orders.update(next, order.revision, undefined, metaOf(next)) };
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
		await this.transactions.withTransaction(async (context) => {
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
				receivedOn: input.received ? input.receivedOn : null,
				receiptNumber: input.received ? await this.numbers.issue('receipt', context, now) : null,
				note: input.note,
				proofMediaId: input.proofMediaId,
				recordedBy: actor.id,
				recordedAt: at,
			};
			await this.payments.save(payment, context);
			if (input.received) await this.ledgerReceipt(order, payment, actor, at, context);
			await this.settle(order, input.revision, actor, at, context, {
				kind: 'payment',
				comment: input.note,
				detail: {
					method: input.method,
					amountINR: input.amountINR,
					reference: input.reference,
					received: input.received,
				},
			});
		});
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
		await this.transactions.withTransaction(async (context) => {
			const received: OrderPayment = {
				...payment,
				state: 'received',
				reference: input.reference,
				receivedOn: input.receivedOn,
				receiptNumber: await this.numbers.issue('receipt', context, now),
			};
			await this.payments.save(received, context);
			await this.ledgerReceipt(order, received, actor, at, context);
			await this.settle(order, input.revision, actor, at, context, {
				kind: 'payment',
				detail: { paymentId, received: true, reference: input.reference },
			});
		});
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
				...(placeNow ? [historyEntry(actor, at, 'status', { from: order.status, to: 'placed' })] : []),
			],
		};
		return refuseStale(
			() => this.orders.update(next, revision, context, metaOf(next)),
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
