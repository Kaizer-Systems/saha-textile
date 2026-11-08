import { Inject, Injectable, Optional } from '@nestjs/common';
import type { MediaAsset, PublicShopEventsResponse, ResolvedImage } from '@saha-textile/contracts';
import {
	type MediaAssetRepository,
	type ShopEventRepository,
	type StoragePort,
	publicShopEvent,
	resolveImage,
} from '@saha-textile/core-domain';

import { MEDIA_ASSET_REPOSITORY, SHOP_EVENT_REPOSITORY, STORAGE_PORT } from '../infra/tokens';

/** Sizes a popup picture may come in, best first. Any library image can be the popup's. */
const POPUP_ROLES = ['banner', 'blog', 'gallery', 'card'];

/** Published events as the shop shows them, with the server's clock for the countdowns. */
@Injectable()
export class EventsPublicService {
	constructor(
		@Inject(SHOP_EVENT_REPOSITORY) private readonly events: ShopEventRepository,
		@Optional() @Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository | null = null,
		@Optional() @Inject(STORAGE_PORT) private readonly storage: StoragePort | null = null,
	) {}

	async list(locale: string, now = new Date()): Promise<PublicShopEventsResponse> {
		const published = await this.events.listPublished();
		const items = [];
		for (const event of published) {
			const asset = event.showPopup && event.popupAssetId ? await this.media?.findById(event.popupAssetId) : null;
			const shown = publicShopEvent(event, locale, now, this.image(asset ?? undefined, locale));
			if (shown) items.push(shown);
		}
		return { serverNow: now.toISOString(), items };
	}

	private image(asset: MediaAsset | undefined, locale: string): ResolvedImage | null {
		if (!asset || asset.deletedAt || !this.storage) return null;
		const storage = this.storage;
		return resolveImage({ asset, getUrl: (key) => storage.getUrl(key), locale, fallbackLocale: 'en', roles: POPUP_ROLES });
	}
}
