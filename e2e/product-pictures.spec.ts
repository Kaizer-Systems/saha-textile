import { withDatabase } from './database';
import { expect, test } from './support';

/**
 * The product form's Meta image and Variation image on the shop (owner, 17 Nov). The product's share picture is laid
 * as a chosen photo version: link previews state that version's own file and size. One variant's own picture is a
 * photo outside the gallery: opening that variant starts the gallery at it. Everything is put back after.
 */
const PRODUCT = 'prd_931';
const SLUG = 'kurti-palazzo-set';
const VARIANT = 'var_931_90164';
const VARIANT_SKU = 'KPS-1';
const SHARE = 'med_e2e_share';
const OWN = 'med_e2e_variant';
const SHARE_VERSION = 'link_preview.crop';

let keptVariantMedia: unknown = null;
/**
 * The photo the variant's own picture is copied from: the gallery's last photo, under a new id outside the gallery,
 * so its files exist on the CDN. The variant's own picture is normally the first photo, so the gallery starts at
 * the last photo's file only when its own picture leads.
 */
let sourcePhoto = '';

// It changes a shared product and variant: run once (on the laptop project), both tests in one worker, so no other run
// of it puts them back mid-check.
test.describe('the product’s own share picture and a variant’s own picture', { tag: '@desktop-only' }, () => {
	test.describe.configure({ mode: 'default' });
	test.beforeAll(async () => {
		const now = new Date();
		await withDatabase(async (db) => {
			const product = await db.collection('products').findOne({ _id: PRODUCT as never });
			const firstPhoto = (product?.['media'] as { gallery: string[] } | undefined)?.gallery[0];
			const template = await db.collection('mediaAssets').findOne({ _id: firstPhoto as never });
			if (!template) throw new Error(`The e2e catalogue has no ${SLUG}`);
			const { _id: _ignored, ...rest } = template;
			// The variant's own picture: a copy of the gallery's last photo under a new id, outside the gallery.
			const gallery = (product?.['media'] as { gallery: string[] }).gallery;
			sourcePhoto = String(gallery.at(-1));
			const source = await db.collection('mediaAssets').findOne({ _id: sourcePhoto as never });
			if (!source || gallery.length < 2) throw new Error('The product needs two photos');
			const { _id: _sourceId, ...copy } = source;
			await db
				.collection('mediaAssets')
				.replaceOne({ _id: OWN as never }, { ...copy, slug: 'e2e-variant' }, { upsert: true });
			await db.collection('mediaAssets').replaceOne(
				{ _id: SHARE as never },
				{
					...rest,
					slug: 'e2e-share',
					versions: [
						{
							id: SHARE_VERSION,
							profileKey: 'link_preview',
							profileVersion: 1,
							fill: 'crop',
							state: 'ready',
							createdAt: now,
						},
					],
					derivatives: [600, 1200, 2400].map((width) => ({
						role: 'gallery',
						storageKey: `media/${SHARE}/e2e-share-${width}w.jpg`,
						width,
						height: Math.round(width / 1.91),
						byteSize: 0,
						format: 'image/jpeg',
						roleVersion: 1,
						versionId: SHARE_VERSION,
					})),
				},
				{ upsert: true },
			);
			await db
				.collection('products')
				.updateOne(
					{ _id: PRODUCT as never },
					{ $set: { 'media.shareImage': { assetId: SHARE, versionId: SHARE_VERSION } } },
				);
			const variant = await db.collection('productVariants').findOne({ _id: VARIANT as never });
			keptVariantMedia = variant?.['media'] ?? null;
			await db
				.collection('productVariants')
				.updateOne(
					{ _id: VARIANT as never },
					{ $set: { media: { primaryAssetId: OWN, primaryVersionId: null } } },
				);
		});
	});

	test.afterAll(async () => {
		await withDatabase(async (db) => {
			await db
				.collection('products')
				.updateOne({ _id: PRODUCT as never }, { $unset: { 'media.shareImage': '' } });
			await db
				.collection('productVariants')
				.updateOne({ _id: VARIANT as never }, { $set: { media: keptVariantMedia } });
			await db.collection('mediaAssets').deleteMany({ _id: { $in: [SHARE, OWN] as never[] } });
		});
	});

	test('link previews use the chosen version nearest 1200 wide, as JPEG, and state its own size', async ({
		page,
	}) => {
		await page.goto(`/en/product/${SLUG}`);
		const meta = (property: string) => page.locator(`meta[property="${property}"]`).first();
		await expect(meta('og:image')).toHaveAttribute('content', new RegExp(`media/${SHARE}/e2e-share-1200w\\.jpg$`));
		await expect(meta('og:image:width')).toHaveAttribute('content', '1200');
		await expect(meta('og:image:height')).toHaveAttribute('content', '628');
		await expect(meta('og:image:type')).toHaveAttribute('content', 'image/jpeg');
	});

	test('opening the variant starts its gallery at the variant’s own picture', async ({ page, problems }) => {
		await page.goto(`/en/product/${SLUG}?variant=${VARIANT_SKU}`);
		await expect(page.locator('app-buy-box')).toBeVisible();
		const first = page.locator('.product-main-1 .owl-item:not(.cloned) img').first();
		await expect(first).toHaveAttribute('src', new RegExp(`media/${sourcePhoto}/`));
		expect(problems.errors).toEqual([]);
	});
});
