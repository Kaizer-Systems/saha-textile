import { describe, expect, it } from 'vitest';

import { MAX_POPUP_PICTURES, ShopEventWrite, shopEventAssetIds } from '../src/shop-event';

describe('event media', () => {
	it('lists the popup pictures in order, or nothing', () => {
		expect(shopEventAssetIds({ popupAssetIds: ['asset_1', 'asset_2'] })).toEqual(['asset_1', 'asset_2']);
		expect(shopEventAssetIds({ popupAssetIds: [] })).toEqual([]);
	});

	it('takes up to five pictures, on the right unless told otherwise', () => {
		const ids = (count: number) => Array.from({ length: count }, (_, i) => `asset_${i}`);
		const parsed = ShopEventWrite.parse({ name: 'Sale', popupAssetIds: ids(MAX_POPUP_PICTURES) });
		expect(parsed.popupImageSide).toBe('right');
		expect(ShopEventWrite.safeParse({ name: 'Sale', popupAssetIds: ids(MAX_POPUP_PICTURES + 1) }).success).toBe(
			false,
		);
		expect(ShopEventWrite.parse({ name: 'Sale', popupImageSide: 'left' }).popupAssetIds).toEqual([]);
	});
});
