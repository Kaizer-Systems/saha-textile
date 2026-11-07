import type { ProductOptionGroup, VariantOptionSelection } from '@saha-textile/contracts';

export interface VariantCombination {
	selections: VariantOptionSelection[];
	hash: string;
	isBase: boolean;
}

/** Stable for a combination, whatever order its axes arrive in. */
export function selectionHash(selections: readonly VariantOptionSelection[]): string {
	return selections
		.map((selection) => `${selection.attributeCode}:${selection.termCode}`)
		.sort()
		.join('|');
}

/** Every combination of the variation axes. Add-ons and filters create no rows. */
export function variantMatrix(groups: readonly ProductOptionGroup[]): VariantCombination[] {
	const axes = groups.filter((group) => group.semanticRole === 'variation_axis');
	if (!axes.length) return [];
	const combos = axes.reduce<VariantOptionSelection[][]>(
		(rows, group) =>
			rows.flatMap((row) =>
				group.terms.map((term) => [...row, { attributeCode: group.attributeCode, termCode: term.code }]),
			),
		[[]],
	);
	return combos.map((selections, index) => ({ selections, hash: selectionHash(selections), isBase: index === 0 }));
}
