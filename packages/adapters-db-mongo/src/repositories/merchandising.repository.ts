import type { ProductBundle, ProductRelation, ProductVariant } from '@saha-textile/contracts';
import {
	type CatalogAudience,
	type Paginated,
	type ProductBundleRepository,
	type ProductRelationRepository,
	type ProductVariantRepository,
	type RelationFilter,
	type TransactionContext,
	type VariantFilter,
	resolveProductStatusFilter,
} from '@saha-textile/core-domain';

import {
	ProductBundleModel,
	type ProductBundleDoc,
	ProductRelationModel,
	type ProductRelationDoc,
	ProductVariantModel,
	type ProductVariantDoc,
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

const iso = (value?: Date): string | undefined => (value ? new Date(value).toISOString() : undefined);
const isoOrNull = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);

/** Fails closed: an omitted audience is `public`, so only `live` rows are visible. */
function statusClause(audience: CatalogAudience = 'public') {
	const statuses = resolveProductStatusFilter(audience);
	return statuses === undefined ? {} : { status: { $in: statuses } };
}

const toVariant = (doc: ProductVariantDoc): ProductVariant => ({
	id: doc._id,
	productId: doc.productId,
	sku: doc.sku,
	status: doc.status as ProductVariant['status'],
	optionSelections: doc.optionSelections ?? [],
	optionSelectionHash: doc.optionSelectionHash,
	isBaseVariant: doc.isBaseVariant ?? false,
	priceINR: doc.priceINR,
	compareAtPriceINR: doc.compareAtPriceINR ?? null,
	salePriceINR: doc.salePriceINR ?? null,
	saleWindow: doc.saleWindow
		? { startsAt: isoOrNull(doc.saleWindow.startsAt), endsAt: isoOrNull(doc.saleWindow.endsAt) }
		: undefined,
	stock: doc.stock ?? { tracked: true, quantity: 0, lowStockThreshold: null, allowBackorder: false },
	shippingProfile: doc.shippingProfile as ProductVariant['shippingProfile'],
	taxProfile: doc.taxProfile as ProductVariant['taxProfile'],
	media: doc.media as ProductVariant['media'],
	createdAt: iso(doc.createdAt),
	updatedAt: iso(doc.updatedAt),
});

export class MongoProductVariantRepository implements ProductVariantRepository {
	async findById(variantId: string, audience: CatalogAudience = 'public'): Promise<ProductVariant | null> {
		const doc = await ProductVariantModel.findOne({ _id: variantId, ...statusClause(audience) })
			.lean<ProductVariantDoc>()
			.exec();
		return doc ? toVariant(doc) : null;
	}

	async findBySku(sku: string, audience: CatalogAudience = 'public'): Promise<ProductVariant | null> {
		const doc = await ProductVariantModel.findOne({ sku, ...statusClause(audience) })
			.lean<ProductVariantDoc>()
			.exec();
		return doc ? toVariant(doc) : null;
	}

	/** The duplicate guard used when generating or regenerating a variant matrix. */
	async findByOptionSelectionHash(productId: string, hash: string): Promise<ProductVariant | null> {
		const doc = await ProductVariantModel.findOne({ productId, optionSelectionHash: hash })
			.lean<ProductVariantDoc>()
			.exec();
		return doc ? toVariant(doc) : null;
	}

	async listForProduct(productId: string, audience: CatalogAudience = 'public'): Promise<ProductVariant[]> {
		const docs = await ProductVariantModel.find({ productId, ...statusClause(audience) })
			.lean<ProductVariantDoc[]>()
			.exec();
		return docs.map(toVariant);
	}

	async list(filter: VariantFilter): Promise<Paginated<ProductVariant>> {
		const query: Record<string, unknown> = { ...statusClause(filter.audience) };
		if (filter.productId) query.productId = filter.productId;
		if (filter.purchasableOnly) {
			// Purchasable = live AND (untracked OR has stock OR backorder is allowed).
			query.$or = [
				{ 'stock.tracked': false },
				{ 'stock.quantity': { $gt: 0 } },
				{ 'stock.allowBackorder': true },
			];
		}

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

		const [docs, total] = await Promise.all([
			ProductVariantModel.find(query)
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<ProductVariantDoc[]>()
				.exec(),
			ProductVariantModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toVariant), total, page, pageSize };
	}

	async save(variant: ProductVariant, context?: TransactionContext): Promise<ProductVariant> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = variant;
		await ProductVariantModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, setDefaultsOnInsert: true, session: sessionFrom(context) },
		).exec();
		return variant;
	}

	/**
	 * Bulk save for matrix regeneration. Takes the transaction context because a product
	 * must never be left half-migrated between axis sets — either the whole new matrix
	 * lands or none of it does.
	 */
	async saveMany(variants: readonly ProductVariant[], context?: TransactionContext): Promise<ProductVariant[]> {
		const session = sessionFrom(context);
		const operations = variants.map((variant) => {
			const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = variant;
			return { updateOne: { filter: { _id: id }, update: { $set: rest }, upsert: true } };
		});
		await ProductVariantModel.bulkWrite(operations as Parameters<typeof ProductVariantModel.bulkWrite>[0], {
			session,
		});
		return [...variants];
	}

	async deleteById(variantId: string, context?: TransactionContext): Promise<void> {
		await ProductVariantModel.deleteOne({ _id: variantId }, { session: sessionFrom(context) }).exec();
	}
}

const toBundle = (doc: ProductBundleDoc): ProductBundle =>
	({
		id: doc._id,
		productId: doc.productId,
		bundleType: doc.bundleType,
		pricePolicy: doc.pricePolicy,
		fixedPriceINR: doc.fixedPriceINR ?? null,
		groups: doc.groups,
		status: doc.status,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as ProductBundle;

export class MongoProductBundleRepository implements ProductBundleRepository {
	async findByProductId(productId: string, audience: CatalogAudience = 'public'): Promise<ProductBundle | null> {
		const doc = await ProductBundleModel.findOne({ productId, ...statusClause(audience) })
			.lean<ProductBundleDoc>()
			.exec();
		return doc ? toBundle(doc) : null;
	}

	/**
	 * The `DEC-BUNDLE-NESTING` write guard. A schema cannot look up whether a referenced
	 * product is itself a bundle, so the use case asks this before accepting a component.
	 * Deliberately status-agnostic: a DRAFT bundle is still a bundle, and allowing it to be
	 * nested now would create an invalid tree the moment it goes live.
	 */
	async isBundleProduct(productId: string): Promise<boolean> {
		return (await ProductBundleModel.countDocuments({ productId }).exec()) > 0;
	}

	async save(bundle: ProductBundle, context?: TransactionContext): Promise<ProductBundle> {
		const { id, ...rest } = bundle as ProductBundle & { id: string };
		await ProductBundleModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, setDefaultsOnInsert: true, session: sessionFrom(context) },
		).exec();
		return bundle;
	}

	async deleteById(bundleId: string, context?: TransactionContext): Promise<void> {
		await ProductBundleModel.deleteOne({ _id: bundleId }, { session: sessionFrom(context) }).exec();
	}
}

const toRelation = (doc: ProductRelationDoc): ProductRelation =>
	({
		id: doc._id,
		sourceProductId: doc.sourceProductId,
		relationType: doc.relationType,
		targetType: doc.targetType,
		targetId: doc.targetId,
		surfaces: doc.surfaces,
		rank: doc.rank ?? 0,
		source: doc.source,
		insightSetId: doc.insightSetId ?? null,
		reason: doc.reason ?? null,
		startsAt: isoOrNull(doc.startsAt),
		endsAt: isoOrNull(doc.endsAt),
		status: doc.status,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as ProductRelation;

export class MongoProductRelationRepository implements ProductRelationRepository {
	async listForProduct(filter: RelationFilter): Promise<ProductRelation[]> {
		const query: Record<string, unknown> = { ...statusClause(filter.audience) };
		if (filter.sourceProductId) query.sourceProductId = filter.sourceProductId;
		if (filter.relationType) query.relationType = filter.relationType;
		if (filter.surface) query.surfaces = filter.surface;

		// A scheduled relation is only surfaced inside its window.
		const now = new Date();
		query.$and = [
			{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
			{ $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
		];

		const docs = await ProductRelationModel.find(query)
			.sort({ rank: 1 })
			.limit(filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 24)
			.lean<ProductRelationDoc[]>()
			.exec();
		return docs.map(toRelation);
	}

	async save(relation: ProductRelation, context?: TransactionContext): Promise<ProductRelation> {
		const { id, ...rest } = relation as ProductRelation & { id: string };
		await ProductRelationModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, setDefaultsOnInsert: true, session: sessionFrom(context) },
		).exec();
		return relation;
	}

	/**
	 * Replaces one weekly insight set atomically: the old rows disappear and the new ones
	 * land together, so a storefront rail never renders a half-updated mix of two runs.
	 */
	async replaceFromInsightSet(
		input: { insightSetId: string; relations: readonly ProductRelation[] },
		context?: TransactionContext,
	): Promise<number> {
		const session = sessionFrom(context);
		await ProductRelationModel.deleteMany({ insightSetId: input.insightSetId }, { session }).exec();
		if (input.relations.length === 0) return 0;

		await ProductRelationModel.insertMany(
			input.relations.map((relation) => {
				const { id, startsAt, endsAt, ...rest } = relation;
				return {
					_id: id,
					...rest,
					startsAt: startsAt ? new Date(startsAt) : null,
					endsAt: endsAt ? new Date(endsAt) : null,
				};
			}),
			{ session },
		);
		return input.relations.length;
	}

	/** Auto-pause: a target that is no longer live must stop appearing in other rails. */
	async disableForTarget(targetId: string, context?: TransactionContext): Promise<number> {
		const result = await ProductRelationModel.updateMany(
			{ targetId, status: 'live' },
			{ $set: { status: 'disabled' } },
			{ session: sessionFrom(context) },
		).exec();
		return result.modifiedCount;
	}

	async deleteById(relationId: string, context?: TransactionContext): Promise<void> {
		await ProductRelationModel.deleteOne({ _id: relationId }, { session: sessionFrom(context) }).exec();
	}
}
