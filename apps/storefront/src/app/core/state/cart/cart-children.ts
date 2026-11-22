import { ICart, ICartChild } from '@data-access/interfaces/cart.interface';

/**
 * A line's child rows in the order the cart draws them (bundle builder brief E02, approved 2026-11-22): a set's
 * pieces, numbered, each followed by its own free items one step further in; then the set's extras; then a
 * product's own free items.
 */
export interface CartChildRow {
	child: ICartChild;
	/** 1 under the line, 2 under a piece. */
	depth: 1 | 2;
	/** A piece's number in the set; null for free items and extras. */
	number: number | null;
	/** Hidden on phones while the set is folded (E03); a product's own free items always show. */
	folds: boolean;
}

export function cartChildRows(item: ICart): CartChildRow[] {
	const children = item.children ?? [];
	const set = !!item.set_heading;
	const rows: CartChildRow[] = [];
	children
		.filter((child) => child.role === 'piece')
		.forEach((piece, at) => {
			rows.push({ child: piece, depth: 1, number: at + 1, folds: set });
			for (const free of children.filter((child) => child.role === 'free' && child.parent_key === piece.key)) {
				rows.push({ child: free, depth: 2, number: null, folds: set });
			}
		});
	for (const extra of children.filter((child) => child.role === 'extra')) {
		rows.push({ child: extra, depth: 1, number: null, folds: set });
	}
	for (const free of children.filter((child) => child.role === 'free' && child.parent_key === null)) {
		rows.push({ child: free, depth: 1, number: null, folds: false });
	}
	return rows;
}

/** What a line holds, counted: pieces, extras, and free items (a set's and a product's own). */
export function cartChildCounts(item: ICart): { pieces: number; extras: number; free: number; folded: number } {
	const children = item.children ?? [];
	const count = (role: ICartChild['role']) => children.filter((child) => child.role === role).length;
	return {
		pieces: count('piece'),
		extras: count('extra'),
		free: count('free'),
		folded: cartChildRows(item).filter((row) => row.folds).length,
	};
}

/** What a set saves against its pieces bought separately; 0 when it saves nothing. */
export function cartSetSaving(item: ICart): number {
	const unit = item.unit_price ?? item.product.sale_price;
	return Math.max(0, (item.product.price ?? 0) - unit);
}
