import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { MediaAsset, PublicShopEventsResponse, ResolvedImage, ShopEvent } from '@saha-textile/contracts';
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
			const shown = publicShopEvent(event, locale, now, await this.images(event, locale));
			if (shown) items.push(shown);
		}
		return { serverNow: now.toISOString(), items };
	}

	/**
	 * The admin's Preview: one event's popup as it would show, whatever its state, through a
	 * link that works for 30 minutes. An unknown or expired link shows nothing.
	 */
	async preview(token: string, locale: string, now = new Date()): Promise<PublicShopEventsResponse> {
		const hash = createHash('sha256').update(token).digest('hex');
		const event = await this.events.findByPreview(hash, now.toISOString());
		if (!event) return { serverNow: now.toISOString(), items: [] };
		// Shown as if published, so a draft's popup reads exactly as it will.
		const shown = publicShopEvent({ ...event, status: 'scheduled' }, locale, now, await this.images(event, locale));
		return { serverNow: now.toISOString(), items: shown ? [shown] : [] };
	}

	/** The popup pictures that can be shown, in order; a deleted or unfinished one is left out. */
	private async images(event: ShopEvent, locale: string): Promise<ResolvedImage[]> {
		if (!event.showPopup || !event.popupAssetIds.length || !this.media) return [];
		const media = this.media;
		const assets = await Promise.all(event.popupAssetIds.map((id) => media.findById(id)));
		return assets
			.map((asset, index) =>
				this.image(asset ?? undefined, locale, event.imageVersions?.[event.popupAssetIds[index] ?? '']),
			)
			.filter((image): image is ResolvedImage => image !== null);
	}

	/** A popup picture drawn from the version the event stored for it (else the shop's own pick, R4-1). */
	private image(asset: MediaAsset | undefined, locale: string, versionId?: string | null): ResolvedImage | null {
		if (!asset || asset.deletedAt || !this.storage) return null;
		const storage = this.storage;
		return resolveImage({
			asset,
			getUrl: (key) => storage.getUrl(key),
			locale,
			fallbackLocale: 'en',
			roles: POPUP_ROLES,
			versionId: versionId ?? null,
		});
	}
}
