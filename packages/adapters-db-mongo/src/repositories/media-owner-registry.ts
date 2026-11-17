import type { Model } from 'mongoose';

import {
	AttributeDefinitionModel,
	BlogPostModel,
	LegalPageModel,
	LegalPageRevisionModel,
	BuilderPageModel,
	PageLayoutRevisionModel,
	SavedBlockModel,
	CategoryModel,
	ContentBlockModel,
	ProductModel,
	ProductVariantModel,
	ReviewModel,
	ShopEventModel,
	StoreLocationModel,
} from '../models/index';

/**
 * Every persisted place that can hold a media asset id.
 *
 * `countReferences` asks each entry and GC deletes only at zero, so a missing entry means a
 * referenced image can be collected — and the failure would surface as a broken image long
 * after the delete. That is why the list is not maintained by memory: the schema-walking
 * test (`test/media-owner-registry.test.ts`) fails CI whenever a model gains a field that
 * looks like a media reference and is not registered here.
 *
 * Over-registering is harmless (it only keeps an asset alive); under-registering is the bug.
 */
export interface MediaOwnerEntry {
	/** Human label for audits and the library's "used by" view. */
	owner: string;
	model: Model<never>;
	/** Dotted path; arrays and arrays of sub-documents both match with a plain equality. */
	path: string;
}

const entry = (owner: string, model: Model<never>, path: string): MediaOwnerEntry => ({ owner, model, path });
const as = <T>(model: Model<T>): Model<never> => model as unknown as Model<never>;

export const MEDIA_OWNER_REGISTRY: readonly MediaOwnerEntry[] = [
	entry('product gallery', as(ProductModel), 'media.gallery'),
	entry('product gallery attachment', as(ProductModel), 'media.gallery.assetId'),
	entry('variant image', as(ProductVariantModel), 'media.primaryAssetId'),
	entry('attribute swatch', as(AttributeDefinitionModel), 'terms.swatchAssetId'),
	entry('category banner', as(CategoryModel), 'media.bannerAssetId'),
	entry('category banner (legacy)', as(CategoryModel), 'media.bannerImage'),
	entry('category photo', as(CategoryModel), 'media.thumbnailAssetId'),
	entry('category icon', as(CategoryModel), 'media.iconAssetId'),
	entry('category share image', as(CategoryModel), 'seo.ogImageAssetId'),
	entry('review photos', as(ReviewModel), 'imageAssetIds'),
	entry('banner or content block', as(ContentBlockModel), 'assetIds'),
	entry('blog cover', as(BlogPostModel), 'coverAssetId'),
	entry('blog share image', as(BlogPostModel), 'shareImageAssetId'),
	entry('blog post picture', as(BlogPostModel), 'assetIds'),
	entry('legal page share picture', as(LegalPageModel), 'metaImageAssetId'),
	entry('legal page share picture (earlier version)', as(LegalPageRevisionModel), 'metaImageAssetId'),
	entry('page layout picture (Page Builder)', as(PageLayoutRevisionModel), 'assetIds'),
	entry('saved block picture (Page Builder)', as(SavedBlockModel), 'assetIds'),
	entry('page share picture (Page Builder settings)', as(BuilderPageModel), 'settings.shareImage.assetId'),
	entry('store photos', as(StoreLocationModel), 'photoAssetIds'),
	entry('event popup pictures', as(ShopEventModel), 'popupAssetIds'),
	entry('event popup picture (before 2026-11-10)', as(ShopEventModel), 'popupAssetId'),
];
