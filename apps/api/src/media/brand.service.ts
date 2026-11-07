import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { BrandImage, BrandSettings, ResolvedImage, StorefrontBrand } from '@saha-textile/contracts';
import {
	type MediaAssetRepository,
	resolveImage,
	type SiteSettingsRepository,
	type StoragePort,
} from '@saha-textile/core-domain';

import { MEDIA_ASSET_REPOSITORY, SITE_SETTINGS_REPOSITORY, STORAGE_PORT } from '../infra/tokens';

const LOGO_ROLE = 'brand_logo';
const ICON_ROLE = 'brand_icon';
/** Every page render reads the brand, and it changes about once in a shop's life. */
const CACHE_MS = 60_000;

const EMPTY: BrandSettings = { shopName: '', logoAssetId: null, sealAssetId: null };

function brandImage(image: ResolvedImage | null): BrandImage | null {
	const sources = image?.roles[LOGO_ROLE] ?? [];
	const largest = sources.at(-1);
	if (!largest) return null;
	return {
		url: largest.url,
		srcset: sources.map((source) => `${source.url} ${source.width}w`).join(', '),
		width: largest.width,
		height: largest.height,
	};
}

/** The Brand Kit: the shop's name and images, read by every screen and set in admin. */
@Injectable()
export class BrandService {
	private cached: { brand: StorefrontBrand; until: number } | null = null;

	constructor(
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
	) {}

	async settingsValue(): Promise<BrandSettings> {
		return (await this.settings.get('brand')) ?? EMPTY;
	}

	async save(value: BrandSettings): Promise<BrandSettings> {
		await Promise.all([this.requireBrandAsset(value.logoAssetId), this.requireBrandAsset(value.sealAssetId)]);
		await this.settings.set('brand', value);
		this.cached = null;
		return value;
	}

	async storefront(now = Date.now()): Promise<StorefrontBrand> {
		if (this.cached && this.cached.until > now) return this.cached.brand;
		const { shopName, logoAssetId, sealAssetId } = await this.settingsValue();
		const [logo, seal] = await Promise.all([this.resolved(logoAssetId), this.resolved(sealAssetId)]);
		const brand: StorefrontBrand = {
			shopName,
			logo: brandImage(logo),
			seal: brandImage(seal),
			icons: Object.fromEntries((seal?.roles[ICON_ROLE] ?? []).map((row) => [String(row.width), row.url])),
		};
		this.cached = { brand, until: now + CACHE_MS };
		return brand;
	}

	private async resolved(assetId: string | null): Promise<ResolvedImage | null> {
		const asset = assetId ? await this.assets.findById(assetId) : null;
		return asset
			? resolveImage({ asset, getUrl: (key) => this.storage.getUrl(key), locale: 'en', fallbackLocale: 'en' })
			: null;
	}

	private async requireBrandAsset(assetId: string | null): Promise<void> {
		if (!assetId) return;
		const asset = await this.assets.findById(assetId);
		if (asset?.purpose !== 'brand') {
			throw new BadRequestException({
				issues: [{ path: 'assetId', message: 'Upload this image from the Brand screen', code: 'not_a_brand_image' }],
			});
		}
	}
}
