import type { TransferStatus } from '@saha-textile/contracts';

/** N3's chips, as drawn (the admin repeats the contract's list; a spec holds them equal). */
export const TRANSFER_CHIPS = ['all', 'requested', 'packing', 'in_transit', 'received_short'] as const;

/** A transfer's status as a pill. */
export const TRANSFER_PILL: Record<TransferStatus, string> = {
	requested: 'status-pending',
	packing: 'status-pending',
	in_transit: 'status-pending',
	received: 'status-success',
	received_short: 'status-danger',
	rejected: 'status-danger',
	cancelled: 'status-danger',
};

/** N4's steps in order; rejected and cancelled end the line where they happened. */
export const TRANSFER_STEPS = ['requested', 'packing', 'in_transit', 'received'] as const;

/** Pieces for a piece, a length of fabric in metres (quantities are tenths of a metre). */
export function quantityText(quantity: number, soldBy: 'piece' | 'metre'): string {
	return soldBy === 'metre' ? `${(quantity / 10).toLocaleString('en-IN')} m` : String(quantity);
}
