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
 * Whether Packed must wait: the order holds a set or free items and a piece is still unticked. Orders of plain
 * products keep today's packing, with the ticks there to use.
 */
export function packListIncomplete(order: { lines: readonly PackLine[]; packTicks?: readonly string[] }): boolean {
	if (!order.lines.some((line) => line.role !== undefined && line.role !== 'product')) return false;
	const ticked = new Set(order.packTicks ?? []);
	return packLines(order.lines).some((line) => !ticked.has(line.lineId ?? ''));
}
