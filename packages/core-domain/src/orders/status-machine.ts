import type { AllowedNextStatus, OrderStatus, StatusBlockReason, StatusNeed } from '@saha-textile/contracts';

/**
 * The order status machine (brief st01–st05, concern K4; owner OD12 cancellation rules).
 *
 * The admin's status menu only shows what this answers: each next status with whether it is
 * allowed, why not, which fields it needs and what the customer will be told. Nothing outside the
 * machine moves an order's status.
 *
 * - Open → Awaiting payment (closed and waiting for money) or Placed (closed and paid / on account),
 *   or Cancelled.
 * - Awaiting payment → Placed (the gateway's confirmation, or staff recording the money), Cancelled.
 * - Placed → Processing → Packed → Shipped → (Out for delivery, from a connected courier only) → Delivered.
 * - Packed needs a complete invoice address when the order needs one.
 * - Cancelled: never after Shipped; made-to-order pieces not after Processing; ready pieces not after
 *   Packed (OD12, Processing = Accepted).
 * - E-invoice / e-way bill before Shipped on business orders: a named setting (`DEC-EDOCS-GATE`).
 */

/** What the machine needs to know about an order. */
export interface StatusMachineOrder {
	status: OrderStatus;
	/** Business orders carry the e-documents block. */
	buyerKind: 'person' | 'business';
	invoiceAddressNeeded: boolean;
	/** Lines still on the order. */
	lines: ReadonlyArray<{ madeToOrder: boolean }>;
	/** Money settled enough to place: paid in full, cash on delivery or on account. */
	placeable: boolean;
	hasEInvoice: boolean;
	hasEWayBill: boolean;
}

export interface StatusMachineSettings {
	outForDeliveryOnlyFromCourier: boolean;
	eDocumentsBeforeShipped: 'off' | 'warn' | 'block';
	/** True when a courier adapter is connected (none now). */
	courierConnected: boolean;
}

/** The order in which statuses run, for "before/after" questions. */
const RANK: Readonly<Record<OrderStatus, number>> = {
	open: 0,
	awaiting_payment: 1,
	placed: 2,
	processing: 3,
	packed: 4,
	shipped: 5,
	out_for_delivery: 6,
	delivered: 7,
	cancelled: 99,
};

/** Statuses that can follow each status, before the guards. */
const NEXT: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
	open: ['awaiting_payment', 'placed', 'cancelled'],
	awaiting_payment: ['placed', 'cancelled'],
	placed: ['processing', 'cancelled'],
	processing: ['packed', 'cancelled'],
	packed: ['shipped', 'cancelled'],
	shipped: ['out_for_delivery', 'delivered'],
	out_for_delivery: ['delivered'],
	delivered: [],
	cancelled: [],
};

/** Everything the menu lists from a status: the next steps, plus later ones shown greyed with a reason. */
const SHOWN: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
	open: ['placed', 'awaiting_payment', 'cancelled'],
	awaiting_payment: ['placed', 'cancelled'],
	placed: ['processing', 'packed', 'cancelled'],
	processing: ['packed', 'shipped', 'cancelled'],
	packed: ['shipped', 'delivered', 'cancelled'],
	shipped: ['out_for_delivery', 'delivered', 'cancelled'],
	out_for_delivery: ['delivered'],
	delivered: [],
	cancelled: [],
};

/** What the customer is told when an order reaches a status (template names; Communications switches decide channels). */
export const STATUS_MESSAGES: Readonly<Record<OrderStatus, readonly string[]>> = {
	open: [],
	awaiting_payment: [],
	placed: ['order_confirmed'],
	processing: [],
	packed: [],
	shipped: ['order_shipped'],
	out_for_delivery: [],
	delivered: ['order_delivered'],
	cancelled: ['order_cancelled'],
};

const NEEDS: Readonly<Partial<Record<OrderStatus, readonly StatusNeed[]>>> = {
	shipped: ['courier', 'trackingNumber'],
	delivered: ['deliveredOn'],
	cancelled: ['cancelReason'],
};

function blockFor(
	to: OrderStatus,
	order: StatusMachineOrder,
	settings: StatusMachineSettings,
): StatusBlockReason | null {
	const from = order.status;
	if (!NEXT[from].includes(to)) {
		if (to === 'cancelled') return 'alreadyShipped';
		if (to === 'shipped' || to === 'out_for_delivery') return 'packFirst';
		if (to === 'delivered') return 'shipFirst';
		if (to === 'packed') return from === 'open' || from === 'awaiting_payment' ? 'notPaid' : 'packFirst';
		return 'packFirst';
	}
	if (to === 'placed' && !order.placeable) return 'notPaid';
	if (to === 'placed' && from === 'open' && order.lines.length === 0) return 'closeOpenOrderFirst';
	if (to === 'packed' && order.invoiceAddressNeeded) return 'addInvoiceAddressFirst';
	if (to === 'out_for_delivery' && settings.outForDeliveryOnlyFromCourier && !settings.courierConnected)
		return 'onlyFromCourier';
	if (to === 'shipped' && settings.eDocumentsBeforeShipped === 'block' && order.buyerKind === 'business') {
		if (!order.hasEInvoice || !order.hasEWayBill) return 'eDocumentsMissing';
	}
	if (to === 'cancelled') {
		if (RANK[from] >= RANK.shipped) return 'alreadyShipped';
		if (RANK[from] > RANK.processing && order.lines.some((line) => !line.madeToOrder)) return 'readyPastPacked';
		if (RANK[from] >= RANK.processing && order.lines.some((line) => line.madeToOrder)) {
			// Made-to-order pieces can't be cancelled once accepted (Processing).
			return 'madeToOrderPastProcessing';
		}
	}
	return null;
}

/**
 * The menu for an order: each status it lists, allowed or not, with the fields it needs and what
 * the customer will be told. Out for delivery is left out entirely while it can only come from a
 * courier and none is connected.
 */
export function allowedNextStatuses(order: StatusMachineOrder, settings: StatusMachineSettings): AllowedNextStatus[] {
	const shown = SHOWN[order.status].filter(
		(to) => !(to === 'out_for_delivery' && settings.outForDeliveryOnlyFromCourier && !settings.courierConnected),
	);
	return shown.map((to) => {
		const reason = blockFor(to, order, settings);
		const needs = [...(NEEDS[to] ?? [])];
		const warning =
			!reason &&
			to === 'shipped' &&
			order.buyerKind === 'business' &&
			settings.eDocumentsBeforeShipped === 'warn' &&
			(!order.hasEInvoice || !order.hasEWayBill)
				? ('eDocumentsMissing' as const)
				: null;
		return { to, allowed: reason === null, reason, needs, warning, tells: [...STATUS_MESSAGES[to]] };
	});
}

/** Whether one move is allowed (the server checks this on every status change). */
export function canMoveTo(
	order: StatusMachineOrder,
	to: OrderStatus,
	settings: StatusMachineSettings,
): { allowed: true } | { allowed: false; reason: StatusBlockReason } {
	if (!NEXT[order.status].includes(to))
		return { allowed: false, reason: blockFor(to, order, settings) ?? 'packFirst' };
	const reason = blockFor(to, order, settings);
	return reason ? { allowed: false, reason } : { allowed: true };
}

/** True once the order has left the stage where its pieces can still change. */
export function isPastStatus(status: OrderStatus, than: OrderStatus): boolean {
	return status !== 'cancelled' && RANK[status] > RANK[than];
}
