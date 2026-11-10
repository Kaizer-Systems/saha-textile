import { describe, expect, it, vi } from 'vitest';

import { brandStripLogo, refreshBrandStrips } from '../src/index.js';

const logoAsset = {
	derivatives: [
		{ role: 'brand_logo', width: 240, storageKey: 'logo-240' },
		{ role: 'brand_icon', width: 512, storageKey: 'icon-512' },
		{ role: 'brand_logo', width: 640, storageKey: 'logo-640' },
		{ role: 'brand_logo', width: 960, storageKey: 'logo-960' },
	],
};

describe('brandStripLogo', () => {
	it('reads the Brand Kit logo file nearest 640 px wide', async () => {
		const download = vi.fn(async (key: string) => new TextEncoder().encode(key));
		const bytes = await brandStripLogo({
			settings: { get: async () => ({ shopName: 'Shop', logoAssetId: 'med_logo', sealAssetId: null }) } as never,
			assets: { findById: async () => logoAsset } as never,
			storage: { download },
		});
		expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe('logo-640');
	});

	it('answers null with no logo, a missing asset, or no logo sizes', async () => {
		const download = vi.fn();
		const storage = { download };
		const none = { get: async () => null } as never;
		const set = { get: async () => ({ shopName: '', logoAssetId: 'x', sealAssetId: null }) } as never;
		expect(
			await brandStripLogo({ settings: none, assets: { findById: async () => null } as never, storage }),
		).toBeNull();
		expect(
			await brandStripLogo({ settings: set, assets: { findById: async () => null } as never, storage }),
		).toBeNull();
		expect(
			await brandStripLogo({
				settings: set,
				assets: { findById: async () => ({ derivatives: [] }) } as never,
				storage,
			}),
		).toBeNull();
		expect(download).not.toHaveBeenCalled();
	});
});

describe('refreshBrandStrips', () => {
	it('moves only the roles that carry the strip to their next version', async () => {
		const save = vi.fn(async (role: unknown) => role);
		const moved = await refreshBrandStrips({
			list: async () =>
				[
					{ key: 'share', brandStrip: true, version: 2 },
					{ key: 'card', version: 1 },
				] as never,
			save: save as never,
		});
		expect(moved).toEqual(['share']);
		expect(save).toHaveBeenCalledExactlyOnceWith({ key: 'share', brandStrip: true, version: 3 });
	});
});
