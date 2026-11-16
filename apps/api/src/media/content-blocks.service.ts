import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
	type ContentBlock,
	type ContentBlockInput,
	type ContentBlockListQuery,
	type HomeHeroLayout,
	type MediaAsset,
	type ResolvedBanner,
	type StorefrontBannersQuery,
	type StorefrontBannersResponse,
	contentBlockAssetIds,
	contentBlockKey,
} from '@saha-textile/contracts';
import {
	type ContentBlockRepository,
	type MediaAssetRepository,
	type SiteSettingsRepository,
	type StoragePort,
	resolveImage,
	servesProfile,
} from '@saha-textile/core-domain';

import { mediaRefusal } from './media-refusal';
import { LanguageStore } from '../languages/language-store';
import {
	CONTENT_BLOCK_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';

/** Every banner profile makes the banner sizes: the slot keeps the picture's shape (option A) or a fixed one. */
const BANNER_PROFILES = ['banner_keep_shape', 'hero_21x9', 'hero_16x9', 'phone_banner_4x5'];

/**
 * Banners (owner log § Media → Banners and content blocks). One record per page position and
 * slot, named by position and shape. The admin picks the home hero layout; the storefront asks
 * for the live banners of a page and gets them resolved for its locale.
 */
@Injectable()
export class ContentBlocksService {
	constructor(
		@Inject(CONTENT_BLOCK_REPOSITORY) private readonly blocks: ContentBlockRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		private readonly languages: LanguageStore,
	) {}

	list(query: ContentBlockListQuery): Promise<ContentBlock[]> {
		return this.blocks.list({ ownerType: query.ownerType, ownerId: query.ownerId, position: query.position });
	}

	/**
	 * Creates or replaces the block at its position. Every image must be a processed banner
	 * asset; an ACTIVE block needs alt text in every active locale, because a banner image is
	 * meaningless to a screen reader or a crawler without it — and when the art carries text,
	 * the alt must repeat it.
	 */
	async upsert(input: ContentBlockInput): Promise<ContentBlock> {
		const key = contentBlockKey(input);
		const ids = contentBlockAssetIds(input);
		const found = await this.assets.findManyByIds(ids);
		const unusable = ids.filter((id) => {
			const asset = found.find((candidate) => candidate.id === id);
			return (
				!asset ||
				asset.deletedAt ||
				!servesProfile(asset, BANNER_PROFILES) ||
				asset.processing.state !== 'ready'
			);
		});
		if (unusable.length > 0) {
			throw mediaRefusal(
				HttpStatus.UNPROCESSABLE_ENTITY,
				'banner_image_not_ready',
				'Every banner image must be a processed banner upload.',
			);
		}
		if (input.status === 'active') {
			const missing = this.languages.shop().filter((locale) => !input.alt[locale]?.trim());
			if (missing.length > 0) {
				throw mediaRefusal(
					HttpStatus.UNPROCESSABLE_ENTITY,
					'alt_missing',
					`Add alt text for: ${missing.join(', ')}.`,
				);
			}
		}
		const existing = await this.blocks.findByKey(key);
		const block: ContentBlock = { ...input, id: existing?.id ?? `cbk_${randomUUID()}`, key };
		await this.blocks.save(block);
		return block;
	}

	async remove(key: string): Promise<void> {
		if (!(await this.blocks.findByKey(key))) throw new NotFoundException('No such banner');
		await this.blocks.deleteByKey(key);
	}

	async heroLayout(): Promise<HomeHeroLayout> {
		return (await this.settings.get('storefront.home'))?.heroLayout ?? 'hero_full';
	}

	async setHeroLayout(heroLayout: HomeHeroLayout): Promise<HomeHeroLayout> {
		await this.settings.set('storefront.home', { heroLayout });
		return heroLayout;
	}

	/** The live banners of one page, resolved for the request locale. */
	async storefront(query: StorefrontBannersQuery): Promise<StorefrontBannersResponse> {
		const blocks = await this.blocks.listLive({
			ownerType: query.ownerType,
			ownerId: query.ownerId ?? null,
			now: new Date().toISOString(),
		});
		const assets = new Map(
			(await this.assets.findManyByIds([...new Set(blocks.flatMap(contentBlockAssetIds))])).map((asset) => [
				asset.id,
				asset,
			]),
		);
		const banners = blocks
			.map((block) => this.resolve(block, assets, query.locale))
			.filter((banner): banner is ResolvedBanner => banner !== null);
		return { heroLayout: await this.heroLayout(), banners };
	}

	private resolve(block: ContentBlock, assets: Map<string, MediaAsset>, locale: string): ResolvedBanner | null {
		const set = (block.containsText && block.localeImages[locale]) || block.images;
		const image = (id: string | null) => {
			const asset = id ? assets.get(id) : undefined;
			return asset
				? resolveImage({
						asset,
						getUrl: (key) => this.storage.getUrl(key),
						locale,
						fallbackLocale: 'en',
						altOverride: block.alt,
					})
				: null;
		};
		const desktop = image(set.desktop);
		if (!desktop) return null;
		const text = (map: Record<string, string>) => (block.containsText ? null : map[locale] || map.en || null);
		return {
			key: block.key,
			position: block.position,
			slot: block.slot,
			containsText: block.containsText,
			images: { desktop, tablet: image(set.tablet), phone: image(set.phone) },
			heading: text(block.heading),
			subheading: text(block.subheading),
			ctaLabel: text(block.ctaLabel),
			link: block.link,
			alt: block.alt[locale] || block.alt.en || '',
		};
	}
}
