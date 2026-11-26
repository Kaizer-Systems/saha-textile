import type { ShopOrderLine, ShopOrderView } from '@saha-textile/contracts';

/** A line of its own (a set, or a product) with what came with it, in the order the page lists them. */
export interface OrderLineGroup {
	line: ShopOrderLine;
	/**
	 * A set's pieces (numbered), each followed by its free items; then the set's extras; then a product's free items.
	 * `rail`: a row of the first level comes after this one, so the rail beside them runs on past it.
	 */
	children: Array<{ line: ShopOrderLine; depth: 1 | 2; number: number | null; rail: boolean }>;
	counts: { pieces: number; extras: number; free: number };
}

/** The order's lines as groups (bundle builder brief E05; phone cards, owner 22 Nov 2026). */
export function orderLineGroups(lines: readonly ShopOrderLine[]): OrderLineGroup[] {
	const under = (id: string) => lines.filter((row) => row.parentLineId === id);
	return lines
		.filter((row) => !row.parentLineId)
		.map((line) => {
			const direct = under(line.lineId);
			const children: OrderLineGroup['children'] = [];
			direct
				.filter((row) => row.role === 'piece')
				.forEach((piece, at) => {
					children.push({ line: piece, depth: 1, number: at + 1, rail: false });
					for (const free of under(piece.lineId)) {
						children.push({ line: free, depth: 2, number: null, rail: false });
					}
				});
			for (const row of direct.filter((row) => row.role !== 'piece')) {
				children.push({ line: row, depth: 1, number: null, rail: false });
			}
			children.forEach((row, at) => {
				row.rail = children.slice(at + 1).some((later) => later.depth === 1);
			});
			return {
				line,
				children,
				counts: {
					pieces: direct.filter((row) => row.role === 'piece').length,
					extras: direct.filter((row) => row.role === 'extra').length,
					free: children.filter((row) => row.line.role === 'free').length,
				},
			};
		});
}

/**
 * What the shopper saved on the whole order: sets against their pieces bought separately, the coupon, and the printed
 * price of free items (rupee orders only; other currencies count the coupon). 0 when nothing was saved.
 */
export function orderSaved(order: Pick<ShopOrderView, 'lines' | 'coupon'>): number {
	const sets = order.lines.reduce((sum, row) => sum + (row.set?.saved ?? 0), 0);
	const free = order.lines.reduce((sum, row) => sum + (row.role === 'free' ? (row.mrp ?? 0) * row.quantity : 0), 0);
	return Math.round((sets + free + order.coupon) * 100) / 100;
}
