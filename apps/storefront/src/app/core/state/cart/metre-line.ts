import { readLength } from '@core/catalog/metre-length';
import { ICart } from '@data-access/interfaces/cart.interface';

/** M1: − and + move a metre line by 0.5 m. */
export const METRE_STEP_TENTHS = 5;

export const isMetreLine = (item: Pick<ICart, 'sold_by'>): boolean => item.sold_by === 'metre';

/** The least a line may hold: one piece, or the product's shortest cut. */
export const lineFloor = (item: Pick<ICart, 'sold_by' | 'shortest_cut_tenths'>): number =>
	isMetreLine(item) ? (item.shortest_cut_tenths ?? 1) : 1;

/** At its floor the minus becomes the delete icon (M09: the minus shows while above the shortest cut). */
export const minusDeletes = (item: Pick<ICart, 'sold_by' | 'shortest_cut_tenths' | 'quantity'>): boolean =>
	item.quantity <= lineFloor(item);

/**
 * What a stepper tap does to a line: pieces by one, metres by 0.5 m between the shortest cut and
 * what is free to sell. At the floor, minus removes the line.
 */
export function stepLine(
	item: Pick<ICart, 'sold_by' | 'shortest_cut_tenths' | 'quantity' | 'available'>,
	direction: 1 | -1,
): { kind: 'delete' } | { kind: 'change'; delta: number } | { kind: 'none' } {
	if (direction < 0 && minusDeletes(item)) return { kind: 'delete' };
	if (!isMetreLine(item)) return { kind: 'change', delta: direction };
	const floor = lineFloor(item);
	const ceiling = item.available ?? Number.POSITIVE_INFINITY;
	const next =
		direction < 0
			? Math.max(floor, item.quantity - METRE_STEP_TENTHS)
			: Math.min(item.quantity + METRE_STEP_TENTHS, Math.max(item.quantity, ceiling));
	return next === item.quantity ? { kind: 'none' } : { kind: 'change', delta: next - item.quantity };
}

/**
 * A length typed into a metre line's box (M09): snapped to 0.1 m, kept between the shortest cut
 * and what is free to sell. Null when it cannot be read or nothing changes.
 */
export function typedLineLength(
	item: Pick<ICart, 'sold_by' | 'shortest_cut_tenths' | 'quantity' | 'available'>,
	text: string,
): number | null {
	const read = readLength(text);
	if (!read) return null;
	const floor = lineFloor(item);
	const ceiling = item.available ?? Number.POSITIVE_INFINITY;
	const tenths = Math.min(Math.max(read.tenths, floor), Math.max(floor, ceiling));
	return tenths === item.quantity ? null : tenths;
}
