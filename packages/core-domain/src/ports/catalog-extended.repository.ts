import type {
	AttributeDefinition,
	CategoryFacetConfig,
	CategoryPlacement,
	FaqEntry,
	ProductBundle,
	ProductQuestion,
	ProductRelation,
	ProductVariant,
	RatingAggregate,
	Review,
} from '@saha-textile/contracts';

import type { CatalogAudience } from '../catalog/product-visibility';
import type { PageQuery, Paginated } from './pagination';
import type { TransactionContext } from './transaction-manager.port';

/**
 * Category placements — the taxonomy DAG.
 *
 * `findByPath` resolves a storefront URL to a placement; `listSubtree` powers menus and
 * subtree listings. A move rewrites the whole subtree's paths and must emit redirects,
 * so `moveSubtree` is one transactional operation rather than a loop of updates.
 */
export interface CategoryPlacementRepository {
	findById(placementId: string): Promise<CategoryPlacement | null>;
	findByPath(pathSlugs: readonly string[], audience?: CatalogAudience): Promise<CategoryPlacement | null>;
	listForCategory(categoryId: string): Promise<CategoryPlacement[]>;
	findCanonical(categoryId: string): Promise<CategoryPlacement | null>;
	listChildren(parentCategoryId: string | null, audience?: CatalogAudience): Promise<CategoryPlacement[]>;
	listSubtree(rootPlacementId: string, audience?: CatalogAudience): Promise<CategoryPlacement[]>;
	save(placement: CategoryPlacement, context?: TransactionContext): Promise<CategoryPlacement>;
	/** Repoints a placement and recomputes every descendant path; returns the moved rows. */
	moveSubtree(
		input: { placementId: string; newParentCategoryId: string | null },
		context?: TransactionContext,
	): Promise<CategoryPlacement[]>;
	deleteById(placementId: string, context?: TransactionContext): Promise<void>;
}

/**
 * Facet configuration, resolved most-specific-first: placement → category → product
 * group → global. `resolveFor` performs that cascade in one call so no caller has to
 * re-implement the precedence and get it subtly wrong.
 */
export interface CategoryFacetConfigRepository {
	resolveFor(input: {
		categoryPlacementId?: string;
		categoryId?: string;
		productGroupId?: string;
	}): Promise<CategoryFacetConfig | null>;
	findById(configId: string): Promise<CategoryFacetConfig | null>;
	save(config: CategoryFacetConfig): Promise<CategoryFacetConfig>;
	deleteById(configId: string): Promise<void>;
}

/** Reusable attribute definitions (`attributeDefinitions`) — the option-group master. */
export interface AttributeDefinitionRepository {
	findByCode(code: string): Promise<AttributeDefinition | null>;
	listAll(): Promise<AttributeDefinition[]>;
	save(definition: AttributeDefinition): Promise<AttributeDefinition>;
	deleteByCode(code: string): Promise<void>;
}

export interface VariantFilter extends PageQuery {
	productId?: string;
	audience?: CatalogAudience;
	/** Restrict to rows that are purchasable right now (live and, if tracked, in stock). */
	purchasableOnly?: boolean;
}

/**
 * Purchasable SKU rows (`productVariants`).
 *
 * `findByOptionSelectionHash` is the duplicate guard used when generating the matrix.
 * Bulk `saveMany` is transactional because regenerating a matrix must not leave a
 * product half-migrated between axis sets.
 */
export interface ProductVariantRepository {
	findById(variantId: string, audience?: CatalogAudience): Promise<ProductVariant | null>;
	findBySku(sku: string, audience?: CatalogAudience): Promise<ProductVariant | null>;
	findByOptionSelectionHash(productId: string, hash: string): Promise<ProductVariant | null>;
	listForProduct(productId: string, audience?: CatalogAudience): Promise<ProductVariant[]>;
	list(filter: VariantFilter): Promise<Paginated<ProductVariant>>;
	save(variant: ProductVariant, context?: TransactionContext): Promise<ProductVariant>;
	saveMany(variants: readonly ProductVariant[], context?: TransactionContext): Promise<ProductVariant[]>;
	deleteById(variantId: string, context?: TransactionContext): Promise<void>;
}

/**
 * Bundles (`productBundles`).
 *
 * `isBundleProduct` exists specifically to enforce `DEC-BUNDLE-NESTING` at the write
 * path: before accepting a component, the use case asks whether the referenced product
 * is itself a bundle and rejects it if so. The schema cannot perform that lookup, so the
 * port must make it cheap and obvious.
 */
export interface ProductBundleRepository {
	findByProductId(productId: string, audience?: CatalogAudience): Promise<ProductBundle | null>;
	/** True when the product is backed by a bundle — the nesting guard. */
	isBundleProduct(productId: string): Promise<boolean>;
	save(bundle: ProductBundle, context?: TransactionContext): Promise<ProductBundle>;
	deleteById(bundleId: string, context?: TransactionContext): Promise<void>;
}

export interface RelationFilter extends PageQuery {
	sourceProductId?: string;
	relationType?: ProductRelation['relationType'];
	surface?: ProductRelation['surfaces'][number];
	audience?: CatalogAudience;
}

/**
 * Merchandising relations (`productRelations`).
 *
 * A public read must only return relations whose TARGET is live, which is why the
 * audience is part of the query rather than a post-filter a caller might skip.
 * `disableForTarget` implements the locked auto-pause when a target leaves `live`.
 */
export interface ProductRelationRepository {
	listForProduct(filter: RelationFilter): Promise<ProductRelation[]>;
	save(relation: ProductRelation, context?: TransactionContext): Promise<ProductRelation>;
	/** Replaces the analytics-sourced rows of one insight set atomically. */
	replaceFromInsightSet(
		input: { insightSetId: string; relations: readonly ProductRelation[] },
		context?: TransactionContext,
	): Promise<number>;
	/** Auto-pause: disables every relation pointing at a target that is no longer live. */
	disableForTarget(targetId: string, context?: TransactionContext): Promise<number>;
	deleteById(relationId: string, context?: TransactionContext): Promise<void>;
}

export interface FaqFilter extends PageQuery {
	categoryId?: string;
	productId?: string;
	audience?: CatalogAudience;
}

/** Editorial FAQ (`faqEntries`). `resolveForSurface` applies scope matching and dedupe. */
export interface FaqRepository {
	findById(faqId: string): Promise<FaqEntry | null>;
	list(filter: FaqFilter): Promise<Paginated<FaqEntry>>;
	/** Global + category + product entries for one page, deduped, in display order. */
	resolveForSurface(input: { categoryIds?: readonly string[]; productId?: string }): Promise<FaqEntry[]>;
	save(entry: FaqEntry): Promise<FaqEntry>;
	deleteById(faqId: string): Promise<void>;
}

export interface QuestionFilter extends PageQuery {
	productId?: string;
	status?: ProductQuestion['status'];
}

/**
 * Product Q&A (`productQuestions`). Public reads must go through the answered-only path
 * and the public projection — a pending or rejected question is never visible, and the
 * asker's email never leaves the admin surface.
 */
export interface ProductQuestionRepository {
	findById(questionId: string): Promise<ProductQuestion | null>;
	listAnsweredForProduct(productId: string, page: PageQuery): Promise<Paginated<ProductQuestion>>;
	list(filter: QuestionFilter): Promise<Paginated<ProductQuestion>>;
	create(question: ProductQuestion): Promise<ProductQuestion>;
	answer(input: {
		questionId: string;
		answer: string;
		answeredByUserId: string;
		answeredAt: string;
	}): Promise<ProductQuestion | null>;
	updateStatus(questionId: string, status: ProductQuestion['status']): Promise<void>;
}

export interface ReviewFilter extends PageQuery {
	productId?: string;
	userId?: string;
	status?: Review['status'];
	rating?: number;
}

/**
 * Reviews and their aggregates.
 *
 * `hasVerifiedPurchase` backs the locked precondition that only a customer who actually
 * bought the product may review it. `recomputeAggregate` must read APPROVED reviews only
 * — pending and rejected content must never influence the public rating or its SEO
 * markup — and it runs in the same transaction as the moderation decision that triggered
 * it, so the aggregate can never disagree with the reviews behind it.
 */
export interface ReviewRepository {
	findById(reviewId: string): Promise<Review | null>;
	listApprovedForProduct(productId: string, page: PageQuery): Promise<Paginated<Review>>;
	list(filter: ReviewFilter): Promise<Paginated<Review>>;
	/** Whether this user has a delivered order line for this product. */
	hasVerifiedPurchase(input: { userId: string; productId: string }): Promise<boolean>;
	create(review: Review): Promise<Review>;
	moderate(
		input: {
			reviewId: string;
			status: Review['status'];
			moderatedByUserId: string;
			moderatedAt: string;
			note?: string;
		},
		context?: TransactionContext,
	): Promise<Review | null>;
	getAggregate(productId: string): Promise<RatingAggregate | null>;
	/** Recomputes from approved reviews only; returns the persisted aggregate. */
	recomputeAggregate(productId: string, context?: TransactionContext): Promise<RatingAggregate>;
}
