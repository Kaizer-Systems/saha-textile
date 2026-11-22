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
	ProductBundleModel,
	ProductModel,
	ProductVariantModel,
	ReviewModel,
	ShopEventModel,
	StoreLocationModel,
	OrderModel,
	PaymentModel,
	SupplierModel,
	LedgerEntryModel,
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
	entry('product share picture (Meta image)', as(ProductModel), 'media.shareImage.assetId'),
	// A bundle's optional styled photo (brief A5); stored free-form, so the schema walk cannot find it.
	entry('bundle styled photo', as(ProductBundleModel), 'styledPhoto.assetId'),
	entry('attribute swatch', as(AttributeDefinitionModel), 'terms.swatchAssetId'),
	// A product's own option swatches (and add-on picture tiles), photos or swatch cuts (brief P11); option groups are
	// stored free-form, so the schema walk below cannot find this path by itself.
	entry('product option swatch', as(ProductModel), 'optionGroups.terms.swatchAssetId'),
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
	entry('order line picture (kept with the order)', as(OrderModel), 'lines.imageAssetId'),
	entry('payment proof', as(PaymentModel), 'proofMediaId'),
	entry('signed set-off agreement (business)', as(SupplierModel), 'setOff.mediaId'),
	entry('signed set-off agreement (one-off entry)', as(LedgerEntryModel), 'agreement.mediaId'),
];
