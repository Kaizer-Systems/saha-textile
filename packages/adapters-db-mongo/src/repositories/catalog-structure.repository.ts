import type { AttributeDefinition, CategoryFacetConfig, CategoryPlacement } from '@saha-textile/contracts';
import {
	type AttributeDefinitionRepository,
	type CatalogAudience,
	type CategoryFacetConfigRepository,
	type CategoryPlacementRepository,
	type TransactionContext,
	resolveProductStatusFilter,
} from '@saha-textile/core-domain';

import {
	AttributeDefinitionModel,
	type AttributeDefinitionDoc,
	CategoryFacetConfigModel,
	type CategoryFacetConfigDoc,
	CategoryPlacementModel,
	type CategoryPlacementDoc,
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

const iso = (value?: Date): string | undefined => (value ? new Date(value).toISOString() : undefined);

/**
 * Status clause for catalog structure. Placements share the product lifecycle vocabulary,
 * so the same public-visible resolution applies: an omitted audience is `public` and
 * therefore only `live`.
 */
function statusClause(audience: CatalogAudience = 'public') {
	const statuses = resolveProductStatusFilter(audience);
	return statuses === undefined ? {} : { status: { $in: statuses } };
}

const toPlacement = (doc: CategoryPlacementDoc): CategoryPlacement => ({
	id: doc._id,
	categoryId: doc.categoryId,
	parentCategoryId: doc.parentCategoryId ?? null,
	pathCategoryIds: doc.pathCategoryIds,
	pathSlugs: doc.pathSlugs,
	pathLabel: doc.pathLabel,
	depth: doc.depth,
	isCanonical: doc.isCanonical ?? false,
	displayOrder: doc.displayOrder ?? 0,
	status: doc.status as CategoryPlacement['status'],
	createdAt: iso(doc.createdAt),
	updatedAt: iso(doc.updatedAt),
});

export class MongoCategoryPlacementRepository implements CategoryPlacementRepository {
	async findById(placementId: string): Promise<CategoryPlacement | null> {
		const doc = await CategoryPlacementModel.findById(placementId).lean<CategoryPlacementDoc>().exec();
		return doc ? toPlacement(doc) : null;
	}

	async findByPath(
		pathSlugs: readonly string[],
		audience: CatalogAudience = 'public',
	): Promise<CategoryPlacement | null> {
		const doc = await CategoryPlacementModel.findOne({ pathKey: pathSlugs.join('/'), ...statusClause(audience) })
			.lean<CategoryPlacementDoc>()
			.exec();
		return doc ? toPlacement(doc) : null;
	}

	async listForCategory(categoryId: string): Promise<CategoryPlacement[]> {
		const docs = await CategoryPlacementModel.find({ categoryId }).lean<CategoryPlacementDoc[]>().exec();
		return docs.map(toPlacement);
	}

	async findCanonical(categoryId: string): Promise<CategoryPlacement | null> {
		const doc = await CategoryPlacementModel.findOne({ categoryId, isCanonical: true })
			.lean<CategoryPlacementDoc>()
			.exec();
		return doc ? toPlacement(doc) : null;
	}

	async listChildren(
		parentCategoryId: string | null,
		audience: CatalogAudience = 'public',
	): Promise<CategoryPlacement[]> {
		const docs = await CategoryPlacementModel.find({ parentCategoryId, ...statusClause(audience) })
			.sort({ displayOrder: 1 })
			.lean<CategoryPlacementDoc[]>()
			.exec();
		return docs.map(toPlacement);
	}

	/** Everything under a placement, found by ancestor id rather than by walking levels. */
	async listSubtree(rootPlacementId: string, audience: CatalogAudience = 'public'): Promise<CategoryPlacement[]> {
		const root = await CategoryPlacementModel.findById(rootPlacementId).lean<CategoryPlacementDoc>().exec();
		if (!root) return [];

		const docs = await CategoryPlacementModel.find({
			pathCategoryIds: root.categoryId,
			...statusClause(audience),
		})
			.sort({ depth: 1, displayOrder: 1 })
			.lean<CategoryPlacementDoc[]>()
			.exec();
		return docs.map(toPlacement);
	}

	async save(placement: CategoryPlacement, context?: TransactionContext): Promise<CategoryPlacement> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = placement;
		// `pathKey` is derived, never client-supplied, so it cannot drift from `pathSlugs`.
		await CategoryPlacementModel.findByIdAndUpdate(
			id,
			{ $set: { ...rest, pathKey: placement.pathSlugs.join('/') } },
			{ upsert: true, setDefaultsOnInsert: true, session: sessionFrom(context) },
		).exec();
		return placement;
	}

	/**
	 * Repoints a placement and recomputes every descendant path.
	 *
	 * One transactional operation, not a loop of updates: a move that failed halfway would
	 * leave part of the tree pointing at the old path, which is both a broken menu and a
	 * duplicate-content problem. The caller supplies the transaction.
	 */
	async moveSubtree(
		input: { placementId: string; newParentCategoryId: string | null },
		context?: TransactionContext,
	): Promise<CategoryPlacement[]> {
		const session = sessionFrom(context);
		const placement = await CategoryPlacementModel.findById(input.placementId)
			.session(session ?? null)
			.lean<CategoryPlacementDoc>()
			.exec();
		if (!placement) return [];

		const parent = input.newParentCategoryId
			? await CategoryPlacementModel.findOne({ categoryId: input.newParentCategoryId, isCanonical: true })
					.session(session ?? null)
					.lean<CategoryPlacementDoc>()
					.exec()
			: null;

		if (input.newParentCategoryId && !parent) return [];
		// A placement may never become its own descendant.
		if (parent?.pathCategoryIds.includes(placement.categoryId)) {
			throw new Error('cycle: the new parent is a descendant of the placement being moved');
		}

		const descendants = await CategoryPlacementModel.find({ pathCategoryIds: placement.categoryId })
			.session(session ?? null)
			.lean<CategoryPlacementDoc[]>()
			.exec();

		const basePathIds = parent ? [...parent.pathCategoryIds] : [];
		const basePathSlugs = parent ? [...parent.pathSlugs] : [];
		const cutIndex = placement.pathCategoryIds.indexOf(placement.categoryId);

		const moved: CategoryPlacement[] = [];
		for (const descendant of descendants) {
			const tailIds = descendant.pathCategoryIds.slice(cutIndex);
			const tailSlugs = descendant.pathSlugs.slice(cutIndex);
			const pathCategoryIds = [...basePathIds, ...tailIds];
			const pathSlugs = [...basePathSlugs, ...tailSlugs];

			const updated = await CategoryPlacementModel.findByIdAndUpdate(
				descendant._id,
				{
					$set: {
						pathCategoryIds,
						pathSlugs,
						pathKey: pathSlugs.join('/'),
						depth: pathCategoryIds.length - 1,
						parentCategoryId: pathCategoryIds.at(-2) ?? null,
					},
				},
				{ returnDocument: 'after', session },
			)
				.lean<CategoryPlacementDoc>()
				.exec();

			if (updated) moved.push(toPlacement(updated));
		}

		return moved;
	}

	async deleteById(placementId: string, context?: TransactionContext): Promise<void> {
		await CategoryPlacementModel.deleteOne({ _id: placementId }, { session: sessionFrom(context) }).exec();
	}
}

const toFacetConfig = (doc: CategoryFacetConfigDoc): CategoryFacetConfig =>
	({
		id: doc._id,
		scope: doc.scope,
		categoryId: doc.categoryId ?? undefined,
		categoryPlacementId: doc.categoryPlacementId ?? undefined,
		productGroupId: doc.productGroupId ?? undefined,
		facets: doc.facets,
		status: doc.status,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as CategoryFacetConfig;

export class MongoCategoryFacetConfigRepository implements CategoryFacetConfigRepository {
	/**
	 * Most-specific-first cascade, performed here so no caller has to re-implement the
	 * precedence and get it subtly wrong.
	 */
	async resolveFor(input: {
		categoryPlacementId?: string;
		categoryId?: string;
		productGroupId?: string;
	}): Promise<CategoryFacetConfig | null> {
		const candidates: Array<Record<string, string>> = [];
		if (input.categoryPlacementId) candidates.push({ categoryPlacementId: input.categoryPlacementId });
		if (input.categoryId) candidates.push({ categoryId: input.categoryId });
		if (input.productGroupId) candidates.push({ productGroupId: input.productGroupId });
		candidates.push({ scope: 'global' });

		for (const candidate of candidates) {
			const doc = await CategoryFacetConfigModel.findOne({ ...candidate, status: 'live' })
				.lean<CategoryFacetConfigDoc>()
				.exec();
			if (doc) return toFacetConfig(doc);
		}
		return null;
	}

	async findById(configId: string): Promise<CategoryFacetConfig | null> {
		const doc = await CategoryFacetConfigModel.findById(configId).lean<CategoryFacetConfigDoc>().exec();
		return doc ? toFacetConfig(doc) : null;
	}

	async save(config: CategoryFacetConfig): Promise<CategoryFacetConfig> {
		const { id, ...rest } = config as CategoryFacetConfig & { id: string };
		await CategoryFacetConfigModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, setDefaultsOnInsert: true },
		).exec();
		return config;
	}

	async deleteById(configId: string): Promise<void> {
		await CategoryFacetConfigModel.deleteOne({ _id: configId }).exec();
	}
}

const toAttributeDefinition = (doc: AttributeDefinitionDoc): AttributeDefinition => ({
	id: doc._id,
	code: doc.code,
	label: doc.label as AttributeDefinition['label'],
	defaultRole: doc.defaultRole as AttributeDefinition['defaultRole'],
	defaultDisplayStyle: doc.defaultDisplayStyle as AttributeDefinition['defaultDisplayStyle'],
	valueType: doc.valueType as AttributeDefinition['valueType'],
	terms: (doc.terms ?? []) as AttributeDefinition['terms'],
	filterConfig: doc.filterConfig as AttributeDefinition['filterConfig'],
	createdAt: iso(doc.createdAt),
	updatedAt: iso(doc.updatedAt),
});

export class MongoAttributeDefinitionRepository implements AttributeDefinitionRepository {
	async findByCode(code: string): Promise<AttributeDefinition | null> {
		const doc = await AttributeDefinitionModel.findOne({ code }).lean<AttributeDefinitionDoc>().exec();
		return doc ? toAttributeDefinition(doc) : null;
	}

	async listAll(): Promise<AttributeDefinition[]> {
		const docs = await AttributeDefinitionModel.find().sort({ code: 1 }).lean<AttributeDefinitionDoc[]>().exec();
		return docs.map(toAttributeDefinition);
	}

	async save(definition: AttributeDefinition): Promise<AttributeDefinition> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = definition;
		await AttributeDefinitionModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, setDefaultsOnInsert: true },
		).exec();
		return definition;
	}

	async deleteByCode(code: string): Promise<void> {
		await AttributeDefinitionModel.deleteOne({ code }).exec();
	}
}
