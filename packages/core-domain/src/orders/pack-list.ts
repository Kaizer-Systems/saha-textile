/**
 * The Pack list (bundle builder brief E08, approved 2026-11-22): every physical piece in the parcel, flat. A set's
 * own line is not a piece; its pieces, their free items and its extras are, as are products and their free items.
 */
interface PackLine {
	lineId?: string | undefined;
	role?: 'product' | 'bundle' | 'piece' | 'free' | 'extra' | undefined;
}

/** The lines that go in the parcel, in order. */
export function packLines<T extends PackLine>(lines: readonly T[]): T[] {
	return lines.filter((line) => line.role !== 'bundle');
}

/**
 * Whether Packed must wait: a piece of the parcel is still unticked. Every order is packed against its Pack list
 * (owner, 23 Nov 2026: "a good order process should have pack lists for any kind of order whether big or small").
 * A line saved before lines had ids can't be ticked, so it never holds the order.
 */
export function packListIncomplete(order: { lines: readonly PackLine[]; packTicks?: readonly string[] }): boolean {
	const ticked = new Set(order.packTicks ?? []);
	return packLines(order.lines).some((line) => Boolean(line.lineId) && !ticked.has(line.lineId ?? ''));
}
