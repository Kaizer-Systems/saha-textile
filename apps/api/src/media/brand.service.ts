import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
	BRAND_SOCIAL_NETWORKS,
	BrandSettings,
	type BrandImage,
	type BrandLogoSet,
	type ResolvedBrandLogos,
	type ResolvedImage,
	type StorefrontBrand,
} from '@saha-textile/contracts';
import {
	type MediaAssetRepository,
	type MediaRoleRepository,
	refreshBrandStrips,
	resolveImage,
	type SiteSettingsRepository,
	type StoragePort,
} from '@saha-textile/core-domain';

import { MEDIA_ASSET_REPOSITORY, MEDIA_ROLE_REPOSITORY, SITE_SETTINGS_REPOSITORY, STORAGE_PORT } from '../infra/tokens';

const LOGO_ROLE = 'brand_logo';
const ICON_ROLE = 'brand_icon';
const SHARE_ROLE = 'site_share';
/** Every page render reads the brand, and it changes about once in a shop's life. */
const CACHE_MS = 60_000;

const EMPTY: BrandSettings = BrandSettings.parse({});

type Resolved = Map<string, ResolvedImage>;

function brandImage(image: ResolvedImage | undefined): BrandImage | null {
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

function icons(image: ResolvedImage | undefined): Record<string, string> {
	return Object.fromEntries((image?.roles[ICON_ROLE] ?? []).map((row) => [String(row.width), row.url]));
}

/** Every image id a Brand Kit value points at. */
function assetIds(value: BrandSettings): string[] {
	const set = (logos: Partial<BrandLogoSet> | undefined) => [
		logos?.logoAssetId,
		logos?.logoDarkAssetId,
		logos?.sealAssetId,
		logos?.sealDarkAssetId,
		logos?.faviconAssetId,
	];
	return [...set(value), ...set(value.admin), value.shareImageAssetId].filter(
		(id): id is string => typeof id === 'string' && id.length > 0,
	);
}

/**
 * One logo set as screens read it. `fallback` fills each empty slot (the admin's own set falls
 * back to the shop's). The browser icon is the phone logo while `sealAsFavicon` is on, else the
 * chosen icon; the dark-browser icon is the dark phone logo, only while `sealAsFavicon` is on.
 */
function logoSet(set: Partial<BrandLogoSet> | undefined, images: Resolved, fallback?: ResolvedBrandLogos) {
	const image = (id: string | null | undefined) => (id ? images.get(id) : undefined);
	const sealIsIcon = set?.sealAsFavicon !== false;
	const ownIcons = icons(image(sealIsIcon ? set?.sealAssetId : set?.faviconAssetId));
	const ownDarkIcons = sealIsIcon ? icons(image(set?.sealDarkAssetId)) : {};
	const resolved: ResolvedBrandLogos = {
		logo: brandImage(image(set?.logoAssetId)) ?? fallback?.logo ?? null,
		logoDark: brandImage(image(set?.logoDarkAssetId)) ?? fallback?.logoDark ?? null,
		seal: brandImage(image(set?.sealAssetId)) ?? fallback?.seal ?? null,
		sealDark: brandImage(image(set?.sealDarkAssetId)) ?? fallback?.sealDark ?? null,
		icons: Object.keys(ownIcons).length ? ownIcons : (fallback?.icons ?? {}),
		iconsDark: Object.keys(ownDarkIcons).length ? ownDarkIcons : (fallback?.iconsDark ?? {}),
	};
	return resolved;
}

/** The Brand Kit: the shop's name, images, profiles and colour, read by every screen and set in admin. */
@Injectable()
export class BrandService {
	private cached: { brand: StorefrontBrand; until: number } | null = null;

	constructor(
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(MEDIA_ROLE_REPOSITORY) private readonly roles: MediaRoleRepository,
	) {}

	async settingsValue(): Promise<BrandSettings> {
		return (await this.settings.get('brand')) ?? EMPTY;
	}

	async save(value: BrandSettings): Promise<BrandSettings> {
		await Promise.all(assetIds(value).map((id) => this.requireBrandAsset(id)));
		const before = await this.settingsValue();
		await this.settings.set('brand', value);
		// The link-preview cards carry the logo on their strip: a new logo redraws them in the background.
		if (before.logoAssetId !== value.logoAssetId) await refreshBrandStrips(this.roles);
		this.cached = null;
		return value;
	}

	async storefront(now = Date.now()): Promise<StorefrontBrand> {
		if (this.cached && this.cached.until > now) return this.cached.brand;
		const value = await this.settingsValue();
		const youtube = await this.settings.get('youtube');
		const images: Resolved = new Map();
		await Promise.all(
			[...new Set(assetIds(value))].map(async (id) => {
				const resolved = await this.resolved(id);
				if (resolved) images.set(id, resolved);
			}),
		);
		const shop = logoSet(value, images);
		const shareSource =
			(value.shareImageAssetId && images.get(value.shareImageAssetId)) ||
			(value.logoAssetId ? images.get(value.logoAssetId) : undefined);
		const socials: Record<string, string> = Object.fromEntries(
			BRAND_SOCIAL_NETWORKS.map((network) => [network, value.socials?.[network] ?? '']),
		);
		socials['youtube'] = youtube?.channelHandle ? `https://www.youtube.com/${youtube.channelHandle}` : '';
		const brand: StorefrontBrand = {
			shopName: value.shopName,
			...shop,
			admin: value.adminOwnLogos ? logoSet(value.admin, images, shop) : shop,
			shareImage: shareSource?.roles[SHARE_ROLE]?.at(-1)?.url ?? null,
			socials,
			apps: { android: value.apps?.android ?? '', ios: value.apps?.ios ?? '' },
			modeSwitch: value.modeSwitch ?? EMPTY.modeSwitch,
			themeColor: value.themeColor ?? EMPTY.themeColor,
			adminThemeColor: value.adminThemeColor ?? EMPTY.adminThemeColor,
		};
		this.cached = { brand, until: now + CACHE_MS };
		return brand;
	}

	private async resolved(assetId: string): Promise<ResolvedImage | null> {
		const asset = await this.assets.findById(assetId);
		return asset
			? resolveImage({ asset, getUrl: (key) => this.storage.getUrl(key), locale: 'en', fallbackLocale: 'en' })
			: null;
	}

	private async requireBrandAsset(assetId: string): Promise<void> {
		const asset = await this.assets.findById(assetId);
		if (asset?.purpose !== 'brand') {
			throw new BadRequestException({
				issues: [
					{ path: 'assetId', message: 'Upload this image from the Brand screen', code: 'not_a_brand_image' },
				],
			});
		}
	}
}
