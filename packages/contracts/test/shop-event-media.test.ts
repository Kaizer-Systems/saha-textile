import { describe, expect, it } from 'vitest';

import { shopEventAssetIds } from '../src/shop-event';

describe('event media', () => {
	it('lists the popup picture, or nothing', () => {
		expect(shopEventAssetIds({ popupAssetId: 'asset_1' })).toEqual(['asset_1']);
		expect(shopEventAssetIds({ popupAssetId: null })).toEqual([]);
	});
});
