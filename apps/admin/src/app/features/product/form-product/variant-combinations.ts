import type { ProductOptionGroup } from '@saha-textile/contracts';

export interface VariantCombination {
	hash: string;
	selections: Array<{ attributeCode: string; termCode: string }>;
}

/** Every combination of the variation axes. The hash matches the API's, so galleries line up. */
export function variantCombinations(groups: readonly ProductOptionGroup[]): VariantCombination[] {
	const axes = groups.filter((group) => group.semanticRole === 'variation_axis');
	if (!axes.length) return [];
	const rows = axes.reduce<VariantCombination['selections'][]>(
		(combos, group) =>
			combos.flatMap((combo) =>
				group.terms.map((term) => [...combo, { attributeCode: group.attributeCode, termCode: term.code }]),
			),
		[[]],
	);
	return rows.map((selections) => ({
		selections,
		hash: selections
			.map((row) => `${row.attributeCode}:${row.termCode}`)
			.sort()
			.join('|'),
	}));
}
