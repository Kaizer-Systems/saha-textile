import type { OrderStatus } from '@saha-textile/contracts';

/**
 * Open orders (owner message 18; brief oo01–oo08): an admin order kept open while a regular buyer
 * collects pieces over weeks. Pieces are held from the moment they are added; staff add and remove
 * pieces; payments come in as they come; shipping is worked out at close, for one parcel.
 */

export type OpenOrderRefusal = 'notOpen' | 'openOrdersOff' | 'lineNotFound' | 'nothingToClose';

/** Lines can be added or removed only while the order is open. */
export function canChangeLines(status: OrderStatus, openOrdersEnabled: boolean): OpenOrderRefusal | null {
	if (!openOrdersEnabled) return 'openOrdersOff';
	if (status !== 'open') return 'notOpen';
	return null;
}

/** Days an order has been open (for the list and the optional reminder). */
export function daysOpen(openedAt: string, now: Date): number {
	return Math.max(0, Math.floor((now.getTime() - Date.parse(openedAt)) / 86_400_000));
}

/** Whether the reminder (off by default) is due. */
export function openTooLong(openedAt: string, now: Date, remindAfterDays: number | null): boolean {
	return remindAfterDays !== null && daysOpen(openedAt, now) >= remindAfterDays;
}

/**
 * Where a closed open order goes: placed when nothing is due (paid ahead counts) or the business
 * takes it on account; otherwise it waits for payment.
 */
export function statusAfterClose(dueINR: number, then: 'requestOnline' | 'recordLater' | 'toAccount'): OrderStatus {
	if (dueINR <= 0 || then === 'toAccount') return 'placed';
	return 'awaiting_payment';
}
