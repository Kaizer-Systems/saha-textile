import { type SetPricing } from '@saha-textile/core-domain/set-price';

import { IBundle } from '@data-access/interfaces/product-detail.interface';

/**
 * A set's pieces in the shape core prices (owner, 21 Nov 2026: "Follow each set's price setting"). The API sends
 * each piece's own set price (after its adjustment, times quantity), so the shop adds those up; a fixed-price set's
 * own price is the one the page shows. Pieces without a group (older pages) form one group that takes them all.
 */
export function setPricing(bundle: IBundle): SetPricing {
	// The page's own price is the set's price unless the set is priced by its pieces.
	const fixed = bundle.price_policy !== 'sum-components' && bundle.price_policy !== 'discounted-components';
	const components = bundle.components ?? [];
	const groups = bundle.groups?.length
		? bundle.groups
		: [{ code: '', label: '', min: components.length, max: Math.max(1, components.length) }];
	return {
		policy: fixed ? 'fixed_bundle_price' : 'sum_components',
		fixedPriceINR: fixed ? bundle.bundle_price : null,
		groups: groups.map((group) => ({
			code: group.code,
			maxSelections: group.max,
			pieces: components
				.filter((piece) => (piece.group ?? '') === group.code)
				.map((piece) => ({
					id: piece.code,
					priceINR: piece.set_price ?? (piece.price ?? 0) * (piece.quantity || 1),
					quantity: 1,
					required: piece.required ?? true,
				})),
		})),
	};
}
