import type { CartViewChild } from '@saha-textile/contracts';

/** One row beneath a staff cart line: a set's piece (numbered), a piece's free item, an extra, a product's free item. */
export interface CartKidRow {
	child: CartViewChild;
	depth: 1 | 2;
	number: number | null;
	imageUrl: string | null;
}

/**
 * A staff cart line's children in the order the shop's cart and the order page list them (bundle builder brief E09,
 * approved 2026-11-22): pieces numbered, each followed by its free items; then the set's extras; then a product's own
 * free items.
 */
export function cartKidRows(children: readonly CartViewChild[]): CartKidRow[] {
	const image = (child: CartViewChild) =>
		child.image?.roles['card']?.[0]?.url ?? child.image?.roles['gallery']?.[0]?.url ?? null;
	const row = (child: CartViewChild, depth: 1 | 2, number: number | null): CartKidRow => ({
		child,
		depth,
		number,
		imageUrl: image(child),
	});
	const rows: CartKidRow[] = [];
	children
		.filter((child) => child.role === 'piece')
		.forEach((piece, at) => {
			rows.push(row(piece, 1, at + 1));
			for (const free of children.filter((child) => child.role === 'free' && child.parentKey === piece.key)) {
				rows.push(row(free, 2, null));
			}
		});
	for (const extra of children.filter((child) => child.role === 'extra')) rows.push(row(extra, 1, null));
	for (const free of children.filter((child) => child.role === 'free' && child.parentKey === null)) {
		rows.push(row(free, 1, null));
	}
	return rows;
}
