import { Inject, Injectable } from '@nestjs/common';
import {
	type MediaAsset,
	type PublicStoreLocation,
	type ResolvedImage,
	type StoreLocation,
	displayPhone,
	summariseStoreHours,
} from '@saha-textile/contracts';
import {
	type MediaAssetRepository,
	type StoragePort,
	type StoreLocationRepository,
	resolveImage,
} from '@saha-textile/core-domain';

import { MEDIA_ASSET_REPOSITORY, STORAGE_PORT, STORE_LOCATION_REPOSITORY } from '../infra/tokens';

const FALLBACK = 'en';

/** Contact Us: the active stores in display order, in the language asked for. */
@Injectable()
export class StoreLocationsPublicService {
	constructor(
		@Inject(STORE_LOCATION_REPOSITORY) private readonly stores: StoreLocationRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
	) {}

	async list(locale: string): Promise<PublicStoreLocation[]> {
		const active = (await this.stores.list()).filter((store) => store.active);
		const ids = [...new Set(active.flatMap((store) => store.photoAssetIds))];
		const assets = ids.length
			? new Map((await this.assets.findManyByIds(ids)).map((asset) => [asset.id, asset]))
			: new Map<string, MediaAsset>();
		return active.map((store) => this.card(store, locale, assets));
	}

	private card(store: StoreLocation, locale: string, assets: Map<string, MediaAsset>): PublicStoreLocation {
		const text = (values: Readonly<Record<string, string>>) => values[locale] || values[FALLBACK] || '';
		const landmark = text(store.landmark);
		return {
			id: store.id,
			name: text(store.name),
			address: text(store.address),
			landmark: landmark || null,
			pinCode: store.pinCode,
			mapUrl: store.mapUrl,
			phone: store.phone,
			phoneDisplay: store.phone ? displayPhone(store.phone) : null,
			hoursSummary: summariseStoreHours(store.hours, locale),
			hours: store.hours,
			geo: store.geo,
			photos: store.photoAssetIds
				.map((id) => this.photo(assets.get(id), locale, store.imageVersions?.[id]))
				.filter((photo): photo is ResolvedImage => !!photo),
		};
	}

	/** A finished, public photo in the store sizes; anything still processing is left out. */
	private photo(asset: MediaAsset | undefined, locale: string, versionId?: string | null): ResolvedImage | null {
		if (!asset || asset.deletedAt || asset.visibility !== 'public') return null;
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale,
			fallbackLocale: FALLBACK,
			roles: ['store_photo'],
			versionId: versionId ?? null,
		});
		const sources = resolved?.roles['store_photo'] ?? [];
		return sources.length ? resolved : null;
	}
}
