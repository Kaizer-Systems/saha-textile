import { BannerPosition, ContentBlockOwnerType, ContentBlockStatus } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Banners and editorial blocks (`contentBlocks`), one per page position and slot.
 *
 * `assetIds` is a denormalized list of every asset the block's image sets point at
 * (`contentBlockAssetIds`), written on every save. The per-locale image map has dynamic
 * keys that no index can cover; this flat array is what the media reference counter and GC
 * query, so a banner's images can never be collected while the banner exists.
 */
export interface ContentBlockDoc {
	_id: string;
	key: string;
	ownerType: string;
	ownerId: string | null;
	position: string;
	slot: string;
	images: { desktop: string; tablet: string | null; phone: string | null };
	containsText: boolean;
	localeImages: Record<string, { desktop: string; tablet: string | null; phone: string | null }>;
	assetIds: string[];
	heading: Record<string, string>;
	subheading: Record<string, string>;
	ctaLabel: Record<string, string>;
	link: { href: string; external: boolean } | null;
	alt: Record<string, string>;
	status: string;
	startsAt: Date | null;
	endsAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const ContentBlockSchema = new Schema<ContentBlockDoc>(
	{
		_id: { type: String, required: true },
		key: { type: String, required: true },
		ownerType: { type: String, enum: ContentBlockOwnerType.options, required: true },
		ownerId: { type: String, default: null },
		position: { type: String, enum: BannerPosition.options, required: true },
		slot: { type: String, required: true },
		images: { type: Schema.Types.Mixed, required: true },
		containsText: { type: Boolean, default: false },
		localeImages: { type: Schema.Types.Mixed, default: {} },
		assetIds: { type: [String], default: [] },
		heading: { type: Schema.Types.Mixed, default: {} },
		subheading: { type: Schema.Types.Mixed, default: {} },
		ctaLabel: { type: Schema.Types.Mixed, default: {} },
		link: { type: Schema.Types.Mixed, default: null },
		alt: { type: Schema.Types.Mixed, default: {} },
		status: { type: String, enum: ContentBlockStatus.options, default: 'draft' },
		startsAt: { type: Date, default: null },
		endsAt: { type: Date, default: null },
	},
	{ collection: 'contentBlocks', timestamps: true },
);

ContentBlockSchema.index({ key: 1 }, { unique: true });
/** The storefront read: live blocks of one owner. */
ContentBlockSchema.index({ ownerType: 1, ownerId: 1, status: 1 });
/** Media reference counting. */
ContentBlockSchema.index({ assetIds: 1 });

export const ContentBlockModel: Model<ContentBlockDoc> =
	(models.ContentBlock as Model<ContentBlockDoc>) ?? model<ContentBlockDoc>('ContentBlock', ContentBlockSchema);

/** Typed site settings (`siteSettings`): `_id` is the setting key, `value` its document. */
export interface SiteSettingDoc {
	_id: string;
	value: unknown;
	updatedAt?: Date;
}

const SiteSettingSchema = new Schema<SiteSettingDoc>(
	{
		_id: { type: String, required: true },
		value: { type: Schema.Types.Mixed, required: true },
	},
	{ collection: 'siteSettings', timestamps: { createdAt: false, updatedAt: true }, minimize: false },
);

export const SiteSettingModel: Model<SiteSettingDoc> =
	(models.SiteSetting as Model<SiteSettingDoc>) ?? model<SiteSettingDoc>('SiteSetting', SiteSettingSchema);
