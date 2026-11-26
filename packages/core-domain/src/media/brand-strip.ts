import type { MediaAssetRepository } from '../ports/media.repository';
import type { MediaRoleRepository } from '../ports/media-role.repository';
import type { SiteSettingsRepository } from '../ports/site-settings.repository';
import type { StoragePort } from '../ports/storage.port';

import { shownDerivatives } from './resolve-image';

/** The strip is about 63 px tall on a 1200×630 card, so the 640 px logo is ample and small to read. */
const STRIP_LOGO_WIDTH = 640;

/**
 * The Brand Kit logo's bytes for the link-preview strip (share brief J2): its `brand_logo` file
 * nearest 640 px wide. Null when the shop has no logo yet, so cards stay plain.
 */
export const brandStripLogo = async (deps: {
	settings: Pick<SiteSettingsRepository, 'get'>;
	assets: Pick<MediaAssetRepository, 'findById'>;
	storage: Pick<StoragePort, 'download'>;
}): Promise<Uint8Array | null> => {
	const logoAssetId = (await deps.settings.get('brand'))?.logoAssetId;
	const asset = logoAssetId ? await deps.assets.findById(logoAssetId) : null;
	const files = (asset ? shownDerivatives(asset) : [])
		.filter((file) => file.role === 'brand_logo')
		.sort((a, b) => Math.abs(a.width - STRIP_LOGO_WIDTH) - Math.abs(b.width - STRIP_LOGO_WIDTH));
	const file = files[0];
	return file ? deps.storage.download(file.storageKey) : null;
};

/**
 * A new logo: every role that carries the strip moves to its next version, so the stale sweep
 * redraws each product's preview card in the background. Returns the keys it moved.
 */
export const refreshBrandStrips = async (roles: Pick<MediaRoleRepository, 'list' | 'save'>): Promise<string[]> => {
	const moved: string[] = [];
	for (const role of await roles.list()) {
		if (!role.brandStrip) continue;
		await roles.save({ ...role, version: role.version + 1 });
		moved.push(role.key);
	}
	return moved;
};
