import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AttributeDefinitionModel,
	CategoryPlacementModel,
	ProductBundleModel,
	ProductRelationModel,
	ProductVariantModel,
} from '../src/models/index';
import {
	MongoAttributeDefinitionRepository,
	MongoCategoryPlacementRepository,
} from '../src/repositories/catalog-structure.repository';
import {
	MongoProductBundleRepository,
	MongoProductRelationRepository,
	MongoProductVariantRepository,
} from '../src/repositories/merchandising.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

/**
 * Catalog persistence against a real replica set: the index invariants and the
 * transactional subtree move. These are properties a unit test with a fake cannot check —
 * a unique index either exists in MongoDB or it does not.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const TEST_PREFIX = 'it_cat_';

const placement = (overrides: Record<string, unknown> = {}) => ({
	id: `${TEST_PREFIX}plc_${randomUUID()}`,
	categoryId: `${TEST_PREFIX}cat_${randomUUID()}`,
	parentCategoryId: null,
	pathCategoryIds: [`${TEST_PREFIX}root`],
	pathSlugs: [`${TEST_PREFIX}root`],
	pathLabel: 'Root',
	depth: 0,
	isCanonical: false,
	displayOrder: 0,
	status: 'live' as const,
	...overrides,
});

const variant = (overrides: Record<string, unknown> = {}) => ({
	id: `${TEST_PREFIX}var_${randomUUID()}`,
	productId: `${TEST_PREFIX}prod`,
	sku: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
	status: 'live' as const,
	optionSelections: [{ attributeCode: 'design', termCode: 'd1' }],
	optionSelectionHash: `design:d1:${randomUUID()}`,
	isBaseVariant: false,
	priceINR: 1000,
	compareAtPriceINR: null,
	salePriceINR: null,
	stock: { tracked: true, quantity: 5, lowStockThreshold: null, allowBackorder: false },
	...overrides,
});

describe.skipIf(!hasMongoEnv())('catalog persistence (integration, rs0)', () => {
	const placements = new MongoCategoryPlacementRepository();
	const variants = new MongoProductVariantRepository();
	const bundles = new MongoProductBundleRepository();
	const relations = new MongoProductRelationRepository();
	const attributes = new MongoAttributeDefinitionRepository();
	const transactions = new MongoTransactionManager();

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			CategoryPlacementModel.syncIndexes(),
			ProductVariantModel.syncIndexes(),
			ProductBundleModel.syncIndexes(),
			ProductRelationModel.syncIndexes(),
			AttributeDefinitionModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const filter = { _id: new RegExp(`^${TEST_PREFIX}`) };
		await Promise.all([
			CategoryPlacementModel.deleteMany(filter).exec(),
			ProductVariantModel.deleteMany(filter).exec(),
			ProductBundleModel.deleteMany(filter).exec(),
			ProductRelationModel.deleteMany(filter).exec(),
			AttributeDefinitionModel.deleteMany(filter).exec(),
		]);
		await disconnectMongo();
	});

	describe('category placements', () => {
		it('allows one category in several places but only one canonical', async () => {
			const categoryId = `${TEST_PREFIX}cat_${randomUUID()}`;
			await placements.save(placement({ categoryId, isCanonical: true, pathSlugs: [`${TEST_PREFIX}a`] }));
			// A second placement of the same category is fine…
			await placements.save(placement({ categoryId, isCanonical: false, pathSlugs: [`${TEST_PREFIX}b`] }));

			// …but a second CANONICAL one is rejected by the partial unique index.
			await expect(
				placements.save(placement({ categoryId, isCanonical: true, pathSlugs: [`${TEST_PREFIX}c`] })),
			).rejects.toThrow();

			expect(await placements.listForCategory(categoryId)).toHaveLength(2);
			expect((await placements.findCanonical(categoryId))?.pathSlugs).toEqual([`${TEST_PREFIX}a`]);
		});

		it('rejects two placements claiming the same URL path', async () => {
			const path = [`${TEST_PREFIX}shared`, 'path'];
			await placements.save(placement({ pathSlugs: path, pathCategoryIds: ['a', 'b'], depth: 1 }));
			await expect(
				placements.save(placement({ pathSlugs: path, pathCategoryIds: ['c', 'd'], depth: 1 })),
			).rejects.toThrow();
		});

		it('hides non-live placements from a public path lookup', async () => {
			const path = [`${TEST_PREFIX}${randomUUID().slice(0, 6)}`];
			await placements.save(placement({ pathSlugs: path, status: 'draft' }));

			expect(await placements.findByPath(path)).toBeNull();
			expect(await placements.findByPath(path, 'admin')).not.toBeNull();
		});

		it('rewrites the whole subtree atomically on a move', async () => {
			const rootCat = `${TEST_PREFIX}cat_root_${randomUUID()}`;
			const childCat = `${TEST_PREFIX}cat_child_${randomUUID()}`;
			const newParentCat = `${TEST_PREFIX}cat_newparent_${randomUUID()}`;

			await placements.save(
				placement({
					categoryId: newParentCat,
					pathCategoryIds: [newParentCat],
					pathSlugs: ['newparent'],
					depth: 0,
					isCanonical: true,
				}),
			);
			const root = placement({
				categoryId: rootCat,
				pathCategoryIds: [rootCat],
				pathSlugs: ['root'],
				depth: 0,
				isCanonical: true,
			});
			await placements.save(root);
			await placements.save(
				placement({
					categoryId: childCat,
					parentCategoryId: rootCat,
					pathCategoryIds: [rootCat, childCat],
					pathSlugs: ['root', 'child'],
					depth: 1,
					isCanonical: true,
				}),
			);

			const moved = await transactions.withTransaction((context) =>
				placements.moveSubtree({ placementId: root.id, newParentCategoryId: newParentCat }, context),
			);

			expect(moved).toHaveLength(2);
			const child = moved.find((entry) => entry.categoryId === childCat);
			// The descendant's path was recomputed, not just the moved node's.
			expect(child?.pathSlugs).toEqual(['newparent', 'root', 'child']);
			expect(child?.depth).toBe(2);
			expect(child?.parentCategoryId).toBe(rootCat);
		});

		it('refuses a move that would make a placement its own ancestor', async () => {
			const parentCat = `${TEST_PREFIX}cyc_parent_${randomUUID()}`;
			const childCat = `${TEST_PREFIX}cyc_child_${randomUUID()}`;

			const parent = placement({
				categoryId: parentCat,
				pathCategoryIds: [parentCat],
				pathSlugs: [`${TEST_PREFIX}cycp`],
				depth: 0,
				isCanonical: true,
			});
			await placements.save(parent);
			await placements.save(
				placement({
					categoryId: childCat,
					parentCategoryId: parentCat,
					pathCategoryIds: [parentCat, childCat],
					pathSlugs: [`${TEST_PREFIX}cycp`, 'child'],
					depth: 1,
					isCanonical: true,
				}),
			);

			await expect(
				transactions.withTransaction((context) =>
					placements.moveSubtree({ placementId: parent.id, newParentCategoryId: childCat }, context),
				),
			).rejects.toThrow(/cycle/);
		});
	});

	describe('product variants', () => {
		it('rejects a duplicate option combination for one product', async () => {
			const productId = `${TEST_PREFIX}prod_${randomUUID()}`;
			const hash = `design:d1:${randomUUID()}`;
			await variants.save(variant({ productId, optionSelectionHash: hash }));
			await expect(variants.save(variant({ productId, optionSelectionHash: hash }))).rejects.toThrow();
		});

		it('rejects a duplicate SKU across products (DEC-SKU: globally unique)', async () => {
			const sku = `${TEST_PREFIX}dupe_${randomUUID().slice(0, 8)}`;
			await variants.save(variant({ sku }));
			await expect(variants.save(variant({ sku, productId: `${TEST_PREFIX}other` }))).rejects.toThrow();
		});

		it('hides non-live variants from public reads', async () => {
			const draft = variant({ status: 'draft' });
			await variants.save(draft);
			expect(await variants.findById(draft.id)).toBeNull();
			expect(await variants.findById(draft.id, 'admin')).not.toBeNull();
		});

		it('filters to purchasable rows', async () => {
			const productId = `${TEST_PREFIX}prod_stock_${randomUUID()}`;
			await variants.save(
				variant({
					productId,
					stock: { tracked: true, quantity: 0, lowStockThreshold: null, allowBackorder: false },
				}),
			);
			await variants.save(
				variant({
					productId,
					stock: { tracked: true, quantity: 3, lowStockThreshold: null, allowBackorder: false },
				}),
			);
			await variants.save(
				variant({
					productId,
					stock: { tracked: true, quantity: 0, lowStockThreshold: null, allowBackorder: true },
				}),
			);

			const all = await variants.list({ productId });
			const purchasable = await variants.list({ productId, purchasableOnly: true });
			expect(all.total).toBe(3);
			// The out-of-stock, non-backorderable row drops out.
			expect(purchasable.total).toBe(2);
		});

		it('saves a whole matrix atomically, or not at all', async () => {
			const productId = `${TEST_PREFIX}prod_matrix_${randomUUID()}`;
			const rows = [variant({ productId }), variant({ productId })];

			await expect(
				transactions.withTransaction(async (context) => {
					await variants.saveMany(rows, context);
					throw new Error('fail after the matrix was written');
				}),
			).rejects.toThrow('fail after the matrix was written');

			expect((await variants.list({ productId, audience: 'admin' })).total).toBe(0);
		});
	});

	describe('bundles and relations', () => {
		it('answers the nesting guard regardless of bundle status', async () => {
			const productId = `${TEST_PREFIX}prod_bundle_${randomUUID()}`;
			expect(await bundles.isBundleProduct(productId)).toBe(false);

			await bundles.save({
				id: `${TEST_PREFIX}bundle_${randomUUID()}`,
				productId,
				bundleType: 'fixed_kit',
				pricePolicy: 'sum_components',
				fixedPriceINR: null,
				groups: [
					{
						code: 'core',
						label: { en: 'Core' },
						minSelections: 0,
						maxSelections: 1,
						components: [
							{
								productId: `${TEST_PREFIX}component`,
								variantId: null,
								quantity: 1,
								required: true,
								priceAdjustmentINR: null,
							},
						],
					},
				],
				// Draft on purpose: a draft bundle is still a bundle for nesting purposes.
				status: 'draft',
			});

			expect(await bundles.isBundleProduct(productId)).toBe(true);
		});

		it('auto-pauses every relation pointing at a target that left `live`', async () => {
			const targetId = `${TEST_PREFIX}target_${randomUUID()}`;
			const base = {
				targetType: 'product' as const,
				targetId,
				surfaces: ['product_detail' as const],
				rank: 0,
				source: 'manual' as const,
				insightSetId: null,
				reason: null,
				startsAt: null,
				endsAt: null,
				status: 'live' as const,
			};
			await relations.save({
				...base,
				id: `${TEST_PREFIX}rel_${randomUUID()}`,
				sourceProductId: `${TEST_PREFIX}s1`,
				relationType: 'related',
			});
			await relations.save({
				...base,
				id: `${TEST_PREFIX}rel_${randomUUID()}`,
				sourceProductId: `${TEST_PREFIX}s2`,
				relationType: 'related',
			});

			expect(await relations.disableForTarget(targetId)).toBe(2);
			expect(await relations.listForProduct({ sourceProductId: `${TEST_PREFIX}s1` })).toHaveLength(0);
		});

		it('replaces an insight set as a unit', async () => {
			const insightSetId = `${TEST_PREFIX}insight_${randomUUID()}`;
			const sourceProductId = `${TEST_PREFIX}s_insight_${randomUUID()}`;
			const row = (targetId: string) => ({
				id: `${TEST_PREFIX}rel_${randomUUID()}`,
				sourceProductId,
				relationType: 'cross_sell' as const,
				targetType: 'product' as const,
				targetId,
				surfaces: ['cart' as const],
				rank: 0,
				source: 'insight_set' as const,
				insightSetId,
				reason: null,
				startsAt: null,
				endsAt: null,
				status: 'live' as const,
			});

			expect(await relations.replaceFromInsightSet({ insightSetId, relations: [row('t1'), row('t2')] })).toBe(2);
			// A later run replaces, never accumulates.
			expect(await relations.replaceFromInsightSet({ insightSetId, relations: [row('t3')] })).toBe(1);
			expect(await relations.listForProduct({ sourceProductId })).toHaveLength(1);
		});

		it('excludes a relation outside its scheduled window', async () => {
			const sourceProductId = `${TEST_PREFIX}s_window_${randomUUID()}`;
			await relations.save({
				id: `${TEST_PREFIX}rel_${randomUUID()}`,
				sourceProductId,
				relationType: 'related',
				targetType: 'product',
				targetId: `${TEST_PREFIX}t`,
				surfaces: ['product_detail'],
				rank: 0,
				source: 'manual',
				insightSetId: null,
				reason: null,
				startsAt: new Date(Date.now() + 86_400_000).toISOString(),
				endsAt: null,
				status: 'live',
			});

			expect(await relations.listForProduct({ sourceProductId })).toHaveLength(0);
		});
	});

	describe('attribute definitions', () => {
		it('keeps attribute codes unique', async () => {
			const code = `${TEST_PREFIX}color_${randomUUID().slice(0, 6)}`;
			await attributes.save({
				id: `${TEST_PREFIX}attr_${randomUUID()}`,
				code,
				label: { en: 'Colour' },
				defaultRole: 'filter_only',
				defaultDisplayStyle: 'color_swatch',
				valueType: 'color',
				terms: [],
			});

			await expect(
				attributes.save({
					id: `${TEST_PREFIX}attr_${randomUUID()}`,
					code,
					label: { en: 'Colour again' },
					defaultRole: 'filter_only',
					defaultDisplayStyle: 'color_swatch',
					valueType: 'color',
					terms: [],
				}),
			).rejects.toThrow();

			expect((await attributes.findByCode(code))?.label.en).toBe('Colour');
		});
	});
});
