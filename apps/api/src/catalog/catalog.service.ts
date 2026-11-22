import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
	AdminProductDetail,
	AdminProductList,
	AdminReplacementTarget,
	CatalogBadgeCode,
	FaqEntry,
	ProductRelation,
	type AddonTemplateWrite,
	type AdminProductListQuery,
	type AuditLog,
	type Category,
	type MediaAsset,
	type Product,
	type ProductMerchandisingWrite,
	type ProductVariant,
	mainCategoryId,
	type SeoRedirect,
	type SeoRedirectWrite,
} from '@saha-textile/contracts';
import {
	isShownOnShop,
	swatchesLeftBehind,
	normaliseSourcePath,
	productGallery,
	repointedRows,
	mrpPriceINR,
	resolveImage,
	sellingPriceINR,
	type AddonTemplateRepository,
	type AttributeDefinitionRepository,
	requestSearchSync,
	type SearchOutboxRepository,
	type SearchPort,
	valueSearchWords,
	type StockAlertRepository,
	type AuditLogRepository,
	type CatalogAudience,
	type CategoryPlacementRepository,
	type CategoryRepository,
	type FaqRepository,
	type MediaAssetRepository,
	type Paginated,
	type ProductFilter,
	type ProductRelationRepository,
	type ProductRepository,
	type ProductVariantRepository,
	type MediaJobQueuePort,
	type SeoRedirectRepository,
	type OrderRepository,
	soldByChangeProblem,
	type StockReadRepository,
	type StoragePort,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';
import { randomUUID } from 'node:crypto';

import { productReadModel, skuView } from './catalog-read-model';
import { applyProductContent, syncVariantRows } from './product-content';
import type { BundleStockService } from './bundles/bundle-stock.service';
import { SearchVocabularyService } from './search-vocabulary.service';
import {
	BUNDLE_STOCK,
	ADDON_TEMPLATE_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	FAQ_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_JOB_QUEUE,
	PRODUCT_REPOSITORY,
	PRODUCT_RELATION_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	ATTRIBUTE_DEFINITION_REPOSITORY,
	SEARCH_OUTBOX,
	SEARCH_PORT,
	SEO_REDIRECT_REPOSITORY,
	STOCK_ALERT_REPOSITORY,
	STORAGE_PORT,
	TRANSACTION_MANAGER,
	LANGUAGE_COVERAGE_REPOSITORY,
	ORDER_REPOSITORY,
	STOCK_READ_REPOSITORY,
} from '../infra/tokens';
import type { LanguageCoverageRepository } from '@saha-textile/core-domain';
import { missingFilter } from '../languages/missing-filter';

const RELATION_TYPES = ['related', 'upsell', 'cross_sell'] as const;

/** Every swatch picture a product's values hold. */
const swatchIdsOf = (product: Pick<Product, 'optionGroups'>): (string | undefined)[] =>
	product.optionGroups.flatMap((group) => group.terms.map((term) => term.swatchAssetId));

@Injectable()
export class CatalogService {
	private readonly logger = new Logger(CatalogService.name);

	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(SEO_REDIRECT_REPOSITORY) private readonly redirects: SeoRedirectRepository,
		@Optional()
		@Inject(ADDON_TEMPLATE_REPOSITORY)
		private readonly addons: AddonTemplateRepository | null = null,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
		@Optional() @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort | null = null,
		@Optional()
		@Inject(PRODUCT_RELATION_REPOSITORY)
		private readonly relations: ProductRelationRepository | null = null,
		@Optional()
		@Inject(CATEGORY_PLACEMENT_REPOSITORY)
		private readonly placements: CategoryPlacementRepository | null = null,
		@Optional() @Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository | null = null,
		@Optional() @Inject(STORAGE_PORT) private readonly storage: StoragePort | null = null,
		@Optional() @Inject(SEARCH_PORT) private readonly search: SearchPort | null = null,
		@Optional() @Inject(STOCK_ALERT_REPOSITORY) private readonly stockAlerts: StockAlertRepository | null = null,
		@Optional()
		@Inject(ATTRIBUTE_DEFINITION_REPOSITORY)
		private readonly attributes: AttributeDefinitionRepository | null = null,
		// Named outright: a `| null` type is recorded as Object, which Nest cannot resolve.
		@Optional() @Inject(SearchVocabularyService) private readonly vocabulary: SearchVocabularyService | null = null,
		@Optional() @Inject(FAQ_REPOSITORY) private readonly faqs: FaqRepository | null = null,
		@Optional() @Inject(MEDIA_JOB_QUEUE) private readonly mediaJobs: MediaJobQueuePort | null = null,
		@Optional() @Inject(SEARCH_OUTBOX) private readonly searchOutbox: SearchOutboxRepository | null = null,
		@Optional()
		@Inject(LANGUAGE_COVERAGE_REPOSITORY)
		private readonly coverage: LanguageCoverageRepository | null = null,
		@Optional() @Inject(STOCK_READ_REPOSITORY) private readonly stockRead: StockReadRepository | null = null,
		@Optional() @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository | null = null,
		@Optional() @Inject(BUNDLE_STOCK) private readonly bundleStock: BundleStockService | null = null,
	) {}

	/** P11: the unit is fixed once the product has stock, stock history or orders. */
	private async soldByFacts(product: Product, rows: readonly ProductVariant[]) {
		const hasStock = rows.some((row) => row.stock.quantity > 0 || (row.stock.held ?? 0) > 0);
		const moved = this.stockRead
			? await this.stockRead.withMovements(rows.map((row) => row.id))
			: new Set<string>();
		const hasOrders = this.orders ? await this.orders.hasLinesFor(product.id) : false;
		return { hasStock, hasMovements: moved.size > 0, hasOrders };
	}

	/** Stock, stock history and orders: what keeps a product from ever being deleted (bulk Delete, Q1 = A). */
	async deletionFacts(product: Product) {
		return this.soldByFacts(product, await this.variants.listForProduct(product.id, 'admin'));
	}

	/**
	 * Take off shop: a live product stays saved with everything in it, but the shop and search stop
	 * showing it until it goes live again. Its old links answer "not found" meanwhile.
	 */
	async takeOff(product: Product, actorUserId: string | null): Promise<Product> {
		const next: Product = {
			...product,
			status: 'disabled',
			lifecycle: { ...product.lifecycle, disabledAt: new Date().toISOString() },
		};
		await this.inTransaction(async () => {
			await this.products.save(next);
			await this.searchOutbox?.request([product.id], new Date());
		});
		await this.syncSearch(next);
		await this.record(actorUserId, 'catalog.product.take-off', product.id, { sku: product.sku });
		return next;
	}

	/**
	 * Deletes a product that never went live, was never stocked and is on no order, with its rows,
	 * its own questions and the links it offers. The caller has checked that it may.
	 */
	async removeNeverLive(product: Product, actorUserId: string | null): Promise<void> {
		const variants = await this.variants.listForProduct(product.id, 'admin');
		const faq = this.faqs ? await this.faqs.listForProduct(product.id) : [];
		const relations: ProductRelation[] = [];
		if (this.relations) {
			for (const relationType of RELATION_TYPES) {
				relations.push(
					...(await this.relations.listForProduct({
						sourceProductId: product.id,
						relationType,
						audience: 'admin',
						pageSize: 100,
					})),
				);
			}
		}
		await this.inTransaction(async () => {
			for (const row of variants) await this.variants.deleteById(row.id);
			for (const row of relations) await this.relations?.deleteById(row.id);
			// Others stop offering it as related, upsell or cross-sell.
			await this.relations?.disableForTarget(product.id);
			await this.products.deleteById(product.id);
		});
		for (const entry of faq) if (entry.productIds.length === 1) await this.faqs?.deleteById(entry.id);
		await this.record(actorUserId, 'catalog.product.delete', product.id, {
			sku: product.sku,
			title: product.title.en,
		});
	}

	/** A copy gets the original's own questions and the products it offers (related, upsell, cross-sell). */
	async copyExtras(fromId: string, toId: string): Promise<void> {
		const ids = await this.manualRelationIds(fromId);
		for (const relationType of RELATION_TYPES)
			await this.replaceManualRelations(toId, relationType, ids[relationType]);
		if (!this.faqs) return;
		for (const { createdAt: _created, updatedAt: _updated, ...entry } of await this.faqs.listForProduct(fromId)) {
			await this.faqs.save(FaqEntry.parse({ ...entry, id: `faq_${randomUUID()}`, productIds: [toId] }));
		}
	}

	/** The main category's HSN and returnability, the defaults the form shows (F02, PD3). */
	private async mainCategoryOf(product: Product) {
		const id = mainCategoryId(product.categoryIds);
		const category = id ? await this.categories.findById(id) : null;
		return category
			? {
					id: category.id,
					name: category.name.en ?? Object.values(category.name)[0] ?? category.slug,
					hsnCode: category.hsnCode ?? null,
					returnable: category.returnable,
					shipping: category.shipping ?? null,
				}
			: null;
	}

	/** A product's own FAQ questions, any status, in display order (the form and Go Live). */
	async productFaq(productId: string): Promise<FaqEntry[]> {
		return this.faqs ? this.faqs.listForProduct(productId) : [];
	}

	/**
	 * The FAQ tab's questions become product-scoped FAQ entries, so they also show in the FAQ
	 * screen. Saved in the form's order; a question removed from the form is deleted, unless an
	 * editor has since pointed it at other products too. Blank rows are skipped.
	 */
	private async syncProductFaq(productId: string, rows: NonNullable<ProductMerchandisingWrite['content']>['faq']) {
		if (!this.faqs) return;
		const existing = await this.faqs.listForProduct(productId);
		const known = new Set(existing.map((entry) => entry.id));
		const kept = new Set<string>();
		const filled = rows.filter((row) =>
			[...Object.values(row.question), ...Object.values(row.answer)].some((value) => value.trim()),
		);
		for (const [index, row] of filled.entries()) {
			const id = row.id && known.has(row.id) ? row.id : `faq_${randomUUID()}`;
			kept.add(id);
			const clean = (text: Readonly<Record<string, string>>) =>
				Object.fromEntries(Object.entries(text).map(([locale, value]) => [locale, value.trim()]));
			await this.faqs.save(
				FaqEntry.parse({
					id,
					question: { en: '', ...clean(row.question) },
					answer: { en: '', ...clean(row.answer) },
					scope: 'product',
					categoryIds: [],
					productIds: [productId],
					displayOrder: index,
					status: 'live',
				}),
			);
		}
		for (const entry of existing) {
			if (!kept.has(entry.id) && entry.productIds.length === 1) await this.faqs.deleteById(entry.id);
		}
	}

	listProducts(filter: ProductFilter): Promise<Paginated<Product>> {
		return this.products.list({ ...filter, audience: filter.audience ?? 'public' });
	}

	/**
	 * Resolves a product for the given audience. A non-live product is indistinguishable
	 * from a missing one to a public caller — same 404, no "exists but hidden" signal.
	 */
	async getProduct(idOrSlug: string, audience: CatalogAudience = 'public'): Promise<Product> {
		const byId = await this.products.findById(idOrSlug, audience);
		const product = byId ?? (await this.products.findBySlug(idOrSlug, audience));
		if (!product) throw new NotFoundException(`Product not found: ${idOrSlug}`);
		return product;
	}

	getCategoryTree(): Promise<Category[]> {
		return this.categories.tree();
	}

	async getCategory(slug: string): Promise<Category> {
		const category = await this.categories.findBySlug(slug);
		if (!category) throw new NotFoundException(`Category not found: ${slug}`);
		return category;
	}

	listRedirects(): Promise<SeoRedirect[]> {
		return this.redirects.list();
	}

	/**
	 * Saves by source path, so editing a row updates it. Rows that pointed at this source
	 * are repointed, which keeps every old address one hop from its page.
	 */
	async saveRedirect(input: SeoRedirectWrite, actorUserId: string | null = null): Promise<SeoRedirect> {
		const sourcePath = normaliseSourcePath(input.sourcePath);
		let saved: SeoRedirect | undefined;
		try {
			await this.inTransaction(async () => {
				saved = await this.upsertRedirect({ ...input, sourcePath });
			});
		} catch (error) {
			if (error instanceof Error && error.message === 'redirect loop') {
				throw new BadRequestException('That redirect would loop');
			}
			throw error;
		}
		const row = saved as unknown as SeoRedirect;
		await this.record(actorUserId, 'catalog.redirect.save', row.id, {
			sourcePath: row.sourcePath,
			statusCode: row.statusCode,
			targetPath: row.targetPath ?? null,
		});
		return row;
	}

	async upsertRedirect(input: Omit<SeoRedirect, 'id'>): Promise<SeoRedirect> {
		const existing = await this.redirects.findBySource(input.sourcePath);
		const saved = await this.redirects.save({ ...input, id: existing?.id ?? `redir_${randomUUID()}` });
		const others = (await this.redirects.list()).filter((row) => row.sourcePath !== saved.sourcePath);
		for (const row of repointedRows(others, saved)) await this.redirects.save(row);
		return saved;
	}

	/**
	 * Hides a product and writes its 410, or its 301 when a replacement is named,
	 * in the same transaction. The replacement must be a live product or collection.
	 */
	async discontinue(idOrSlug: string, replacementPath: string | null, actorUserId: string | null = null) {
		const product = await this.getProduct(idOrSlug, 'admin');
		const replacement = replacementPath ? await this.liveReplacement(replacementPath, product.slug) : null;
		const next: Product = {
			...product,
			status: 'discontinued',
			lifecycle: { ...product.lifecycle, discontinuedAt: new Date().toISOString() },
			replacementTarget: replacement,
		};
		const redirect: Omit<SeoRedirect, 'id'> = {
			sourcePath: `/product/${product.slug}`,
			statusCode: replacement ? 301 : 410,
			...(replacement ? { targetPath: replacement.path } : {}),
			reason: 'product_archived',
			entityType: 'product',
			entityId: product.id,
		};
		await this.inTransaction(async () => {
			await this.products.save(next);
			await this.upsertRedirect(redirect);
			// Auto-pause: other products stop offering this one as related, upsell or cross-sell.
			await this.relations?.disableForTarget(product.id);
			// In the same transaction, so a committed change is never missing from the queue.
			await this.searchOutbox?.request([product.id], new Date());
		});
		await this.syncSearch(next);
		await this.record(actorUserId, 'catalog.product.discontinue', product.id, {
			statusCode: redirect.statusCode,
			targetPath: replacement?.path ?? null,
		});
		return { slug: product.slug, statusCode: redirect.statusCode, targetPath: replacement?.path ?? null };
	}

	/** Refuses a replacement that is not a live product or collection, or is the product itself. */
	async liveReplacement(path: string, ownSlug: string): Promise<Product['replacementTarget']> {
		const [, kind, ...rest] = path.split('/');
		if (kind === 'product') {
			const slug = rest[0] ?? '';
			const target = slug === ownSlug ? null : await this.products.findBySlug(slug, 'public');
			if (target) return { kind: 'product', path };
		} else if (kind === 'collections' && this.placements) {
			const placement = await this.placements.findByPath(rest, 'public');
			if (placement) return { kind: 'collection', path };
		}
		throw new BadRequestException('The replacement must be a live product or collection');
	}

	async adminList(query: AdminProductListQuery): Promise<AdminProductList> {
		const page = await this.products.list({
			audience: 'admin',
			search: query.search,
			status: query.status,
			page: query.page,
			pageSize: query.pageSize,
			...(await missingFilter(this.coverage, 'products', query.missing)),
		});
		const rows = await Promise.all(
			page.items.map(async (product) => ({
				product,
				variants: await this.variants.listForProduct(product.id, 'admin'),
			})),
		);
		const assets = await this.assetsFor(rows.flatMap((row) => row.product.media.gallery.slice(0, 1)));
		return AdminProductList.parse({
			items: rows.map(({ product, variants }) => ({
				id: product.id,
				slug: product.slug,
				sku: product.sku,
				title: product.title.en,
				status: product.status,
				featured: product.featured,
				sellingFromINR: variants.length
					? Math.min(...variants.map((row) => sellingPriceINR(row.priceINR, row.salePriceINR)))
					: product.basePriceINR,
				stock: variants.reduce((sum, row) => sum + row.stock.quantity, 0),
				variantCount: variants.length,
				thumbnailUrl: this.thumbnail(assets.get(product.media.gallery[0] ?? '')),
				wasLive: isPublished(product),
			})),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		});
	}

	async adminDetail(idOrSlug: string): Promise<AdminProductDetail> {
		const product = await this.getProduct(idOrSlug, 'admin');
		const variants = await this.variants.listForProduct(product.id, 'admin');
		const facts = await this.soldByFacts(product, variants);
		const relationIds = await this.manualRelationIds(product.id);
		const termLabel = new Map(
			product.optionGroups.flatMap((group) =>
				group.terms.map((term) => [`${group.attributeCode}:${term.code}`, term.label.en] as const),
			),
		);
		return AdminProductDetail.parse({
			id: product.id,
			slug: product.slug,
			sku: product.sku,
			title: product.title.en,
			type: product.type,
			status: product.status,
			published: isPublished(product),
			featured: product.featured,
			showOnShop: product.showOnShop !== false,
			freeWith: product.freeWith ?? null,
			madeToOrder: product.madeToOrder,
			estimatedDeliveryText: product.estimatedDeliveryText?.en ?? null,
			lowStockThreshold: product.lowStockThreshold,
			pinnedBadges: product.pinnedBadges.filter(isBadgeCode),
			hiddenBadges: product.hiddenBadges.filter(isBadgeCode),
			addonPriceINR: product.addonPriceINR,
			replacementPath: product.replacementTarget?.path ?? null,
			shipping: product.shippingDefaults,
			shippingCharges: product.shippingCharges ?? null,
			freeShipping: product.freeShipping ?? false,
			hsnCode: product.hsnCode,
			soldBy: product.soldBy,
			soldByLocked: facts.hasStock || facts.hasMovements || facts.hasOrders,
			returnable: product.returnable,
			mainCategory: await this.mainCategoryOf(product),
			metre: {
				shortestCutTenths: product.shortestCutTenths,
				quickLengths: product.quickLengths,
				widthInches: product.widthInches,
				weightPerMetreGrams: product.weightPerMetreGrams,
			},
			content: {
				title: product.title,
				shortDescription: product.shortDescription,
				description: product.description ?? {},
				metaTitle: product.seo?.title ?? {},
				metaDescription: product.seo?.description ?? {},
				estimatedDeliveryText: product.estimatedDeliveryText ?? {},
				sareeLengthM: product.sareeLengthM ?? null,
				blousePieceM: product.blousePieceM ?? null,
				categoryIds: product.categoryIds,
				optionGroups: product.optionGroups,
				addonTemplateCode: product.addonTemplateCode ?? null,
				imageMode: product.imageMode,
				gallery: product.media.gallery,
				compound: product.media.compound,
				altOverrides: product.media.altOverrides,
				versions: product.media.versions ?? {},
				shareImage: product.media.shareImage ?? null,
				faqEnabled: product.faqEnabled,
				faq: (await this.productFaq(product.id)).map((entry) => ({
					id: entry.id,
					question: entry.question,
					answer: entry.answer,
				})),
			},
			images: await this.imageTiles(
				product,
				variants.flatMap((row) => row.media?.primaryAssetId ?? []),
			),
			relatedProductIds: relationIds.related,
			upsellProductIds: relationIds.upsell,
			crossSellProductIds: relationIds.cross_sell,
			videos: product.videos,
			updatedAt: product.updatedAt ?? null,
			variants: variants.map((row) => ({
				id: row.id,
				sku: row.sku,
				label:
					row.optionSelections
						.map((selection) => termLabel.get(`${selection.attributeCode}:${selection.termCode}`))
						.filter(Boolean)
						.join(' / ') || product.title.en,
				isBase: row.isBaseVariant,
				mrpINR: mrpPriceINR(row.priceINR, row.compareAtPriceINR, row.salePriceINR) ?? row.compareAtPriceINR,
				sellingINR: sellingPriceINR(row.priceINR, row.salePriceINR),
				quantity: row.stock.quantity,
				held: row.stock.held ?? 0,
				inOrders: row.stock.reserved ?? 0,
				freeToSell: row.stock.quantity - (row.stock.held ?? 0) - (row.stock.reserved ?? 0),
				available: row.status === 'live',
				weightGrams: row.shippingProfile?.weightGrams ?? null,
				lengthCm: row.shippingProfile?.lengthCm ?? null,
				widthCm: row.shippingProfile?.widthCm ?? null,
				heightCm: row.shippingProfile?.heightCm ?? null,
				barcode: row.barcode ?? null,
				hsnCode: row.taxProfile?.hsnCode ?? null,
				image: row.media?.primaryAssetId
					? { assetId: row.media.primaryAssetId, versionId: row.media.primaryVersionId ?? null }
					: null,
			})),
		});
	}

	/** Live products and live collections, the only targets a replacement may name. */
	async replacementTargets(): Promise<AdminReplacementTarget[]> {
		const [products, paths] = await Promise.all([
			this.products.list({ audience: 'public', page: 1, pageSize: 1000 }),
			this.placements?.listLivePaths() ?? Promise.resolve([]),
		]);
		return [
			...products.items.map((product) =>
				AdminReplacementTarget.parse({
					kind: 'product',
					path: `/product/${product.slug}`,
					label: product.title.en,
				}),
			),
			...paths.map((path) =>
				AdminReplacementTarget.parse({ kind: 'collection', path: `/collections/${path}`, label: path }),
			),
		];
	}

	/**
	 * Saves the admin product form. Status is live or disabled; discontinuing is its own
	 * action. A published product keeps its SKUs, and every variant row is written.
	 */
	async updateMerchandising(idOrSlug: string, body: ProductMerchandisingWrite, actorUserId: string | null = null) {
		const product = await this.getProduct(idOrSlug, 'admin');
		if (product.status === 'discontinued') {
			throw new BadRequestException('A discontinued product cannot be edited here');
		}
		if (body.status === 'live' && product.status !== 'live') {
			throw new BadRequestException('Use Go Live, which checks that the product is ready');
		}
		const published = isPublished(product);
		if (published && body.sku !== product.sku) {
			throw new BadRequestException('A published product keeps its SKU');
		}
		// Free items are real products (P8): never the product itself, never a bundle, never missing.
		for (const item of body.freeWith?.items ?? []) {
			if (item.productId === product.id) throw new BadRequestException('A product cannot be free with itself');
			const target = await this.products.findById(item.productId, 'admin');
			if (!target) throw new NotFoundException(`Product not found: ${item.productId}`);
			if (target.type === 'bundle') throw new BadRequestException('A bundle cannot be a free item');
		}
		const rows = new Map((await this.variants.listForProduct(product.id, 'admin')).map((row) => [row.id, row]));
		const soldBy = body.soldBy ?? product.soldBy;
		if (soldBy !== product.soldBy) {
			const problem = soldByChangeProblem({
				from: product.soldBy,
				to: soldBy,
				...(await this.soldByFacts(product, [...rows.values()])),
			});
			if (problem) throw new BadRequestException(problem.detail);
		}
		const metre = body.metre ?? {
			shortestCutTenths: product.shortestCutTenths,
			quickLengths: product.quickLengths,
			widthInches: product.widthInches,
			weightPerMetreGrams: product.weightPerMetreGrams,
		};
		if (soldBy === 'metre' && (metre.shortestCutTenths === null || metre.weightPerMetreGrams === null)) {
			throw new BadRequestException('Fabric sold by the metre needs a shortest cut and a weight per metre');
		}
		const nextRows: ProductVariant[] = body.variants.map((write) => {
			const row = rows.get(write.id);
			if (!row) throw new BadRequestException(`Unknown variant: ${write.id}`);
			if (published && write.sku !== row.sku) {
				throw new BadRequestException(`A published variant keeps its SKU: ${row.sku}`);
			}
			const discounted = write.mrpINR !== null && write.sellingINR < write.mrpINR;
			return {
				...row,
				sku: write.sku,
				status: write.available ? 'live' : 'disabled',
				priceINR: write.mrpINR ?? write.sellingINR,
				compareAtPriceINR: write.mrpINR,
				salePriceINR: discounted ? write.sellingINR : null,
				barcode: write.barcode,
				// Stock moves only through stock documents (purchases and stock brief, F01): the typed
				// quantity the form still sends is ignored; held and on-hand stay as the ledger left them.
				stock: row.stock,
				shippingProfile: {
					weightGrams: write.weightGrams,
					lengthCm: write.lengthCm,
					widthCm: write.widthCm,
					heightCm: write.heightCm,
				},
				taxProfile: { hsnCode: write.hsnCode, taxClassId: row.taxProfile?.taxClassId ?? null },
				// The variant's own picture, shown first when it is chosen (owner, 17 Nov).
				media:
					write.image === undefined
						? row.media
						: {
								primaryAssetId: write.image?.assetId ?? null,
								primaryVersionId: write.image?.versionId ?? null,
							},
			};
		});
		const now = new Date().toISOString();
		const priced = [...rows.values()].map((row) => nextRows.find((next) => next.id === row.id) ?? row);
		const live = priced.filter((row) => row.status === 'live');
		const selling = (live.length ? live : priced).map((row) => sellingPriceINR(row.priceINR, row.salePriceINR));
		const next: Product = {
			...product,
			sku: body.sku,
			slug: body.slug ?? product.slug,
			status: body.status,
			lifecycle: {
				...product.lifecycle,
				liveAt: product.lifecycle.liveAt ?? (body.status === 'live' ? now : null),
				disabledAt:
					body.status === 'disabled' && product.status !== 'disabled' ? now : product.lifecycle.disabledAt,
			},
			featured: body.featured,
			showOnShop: body.showOnShop === undefined ? product.showOnShop : body.showOnShop,
			freeWith: body.freeWith === undefined ? product.freeWith : body.freeWith,
			madeToOrder: body.madeToOrder,
			estimatedDeliveryText: body.estimatedDeliveryText
				? { ...(product.estimatedDeliveryText ?? {}), en: body.estimatedDeliveryText }
				: null,
			lowStockThreshold: body.lowStockThreshold,
			pinnedBadges: body.pinnedBadges,
			hiddenBadges: body.hiddenBadges,
			addonPriceINR: body.addonPriceINR,
			shippingDefaults: body.shipping,
			shippingCharges: body.shippingCharges === undefined ? product.shippingCharges : body.shippingCharges,
			freeShipping: body.freeShipping === undefined ? product.freeShipping : body.freeShipping,
			hsnCode: body.hsnCode,
			soldBy,
			returnable: body.returnable === undefined ? product.returnable : body.returnable,
			...(soldBy === 'metre'
				? {
						shortestCutTenths: metre.shortestCutTenths,
						quickLengths: metre.quickLengths,
						widthInches: metre.widthInches,
						weightPerMetreGrams: metre.weightPerMetreGrams,
					}
				: {}),
			basePriceINR: selling.length ? Math.min(...selling) : product.basePriceINR,
			onSale: live.some((row) => row.salePriceINR !== null && row.salePriceINR < row.priceINR),
			...(body.content ? applyProductContent(product, body.content) : {}),
			...(body.videos ? { videos: body.videos } : {}),
		};
		const stocked = (list: readonly ProductVariant[]) => list.reduce((sum, row) => sum + row.stock.quantity, 0);
		const received = nextRows.reduce(
			(sum, row) => sum + Math.max(0, row.stock.quantity - (rows.get(row.id)?.stock.quantity ?? 0)),
			0,
		);
		next.lifetimeUnitsReceived = product.lifetimeUnitsReceived + received;
		if (stocked([...rows.values()]) === 0 && stocked(nextRows) > 0) next.backInStockAt = now;
		const renamed = next.slug !== product.slug;
		if (renamed && (await this.products.findBySlug(next.slug, 'admin'))) {
			throw new BadRequestException('That address is already taken');
		}
		await this.inTransaction(async () => {
			await this.products.save(next);
			for (const row of nextRows) await this.variants.save(row);
			if (body.content) for (const row of syncVariantRows(next, priced)) await this.variants.save(row);
			if (renamed) {
				// One locale-free row: the resolver gives /en/ and /fr/ their own target.
				await this.upsertRedirect({
					sourcePath: `/product/${product.slug}`,
					statusCode: 301,
					targetPath: `/product/${next.slug}`,
					reason: 'slug_change',
					entityType: 'product',
					entityId: product.id,
				});
			}
			// In the same transaction, so a committed change is never missing from the queue.
			await this.searchOutbox?.request([product.id], new Date());
		});
		if (body.content) await this.syncProductFaq(product.id, body.content.faq);
		await this.promotePrimaryImage(next);
		await this.syncSearch(next);
		await this.record(actorUserId, 'catalog.product.save', product.id, {
			sku: next.sku,
			status: next.status,
			variants: nextRows.map((row) => ({ sku: row.sku, priceINR: row.priceINR, salePriceINR: row.salePriceINR })),
		});
		await this.replaceManualRelations(product.id, 'related', body.relatedProductIds);
		await this.replaceManualRelations(product.id, 'upsell', body.upsellProductIds);
		await this.replaceManualRelations(product.id, 'cross_sell', body.crossSellProductIds);
		await this.dropLeftBehindSwatches(swatchIdsOf(product), swatchIdsOf(next));
		// Its stock, price or status may change what the bundles holding it can make (V3).
		await this.bundleStock?.refreshContaining([product.id]);
		return { id: product.id, slug: next.slug };
	}

	/**
	 * Swatch pictures a save left behind (owner, 22 Nov 2026): each goes to the worker, which deletes it for good only
	 * when it is a swatch cut that nothing uses any more. Photos and library pictures are never deleted this way.
	 */
	async dropLeftBehindSwatches(before: readonly (string | undefined)[], after: readonly (string | undefined)[]) {
		if (!this.mediaJobs) return;
		for (const assetId of swatchesLeftBehind(before, after))
			await this.mediaJobs.enqueue({ type: 'drop-cut', assetId });
	}

	/**
	 * The index is derived and rebuildable, so a failed update never fails the save. With the
	 * search change queue, the change waits there until search takes it.
	 */
	async syncSearch(product: Product): Promise<void> {
		if (this.searchOutbox) return this.sendToSearch([product]);
		try {
			if (isShownOnShop(product)) await this.indexLive([product]);
			else await this.search?.removeProduct(product.id);
		} catch (error) {
			this.logger.warn(`Search index not updated for ${product.id}: ${String(error)}`);
		}
	}

	/**
	 * Re-indexes many products in one pass, for a search word or a Storefront setting that
	 * changes how they are found. Products not on the shop leave the index.
	 */
	async syncSearchMany(products: readonly Product[]): Promise<number> {
		const live = products.filter((product) => isShownOnShop(product));
		if (this.searchOutbox) await this.sendToSearch(products);
		else await this.indexLive(live);
		return live.length;
	}

	/** Queues the products' search changes and sends them at once; what search refuses waits for the worker. */
	private async sendToSearch(products: readonly Product[]): Promise<void> {
		const outbox = this.searchOutbox;
		const search = this.search;
		if (!outbox || !search || !products.length) return;
		const known = new Map(products.map((product) => [product.id, product]));
		try {
			const result = await requestSearchSync(
				{
					outbox,
					// Every id below comes from `known`.
					loadProduct: async (id) => known.get(id),
					apply: async (live, removed) => {
						await this.indexLive(live);
						for (const id of removed) await search.removeProduct(id);
					},
					now: () => new Date(),
				},
				[...known.keys()],
			);
			if (result.failed) this.logger.warn(`Search update waits in the queue for ${result.failed} product(s)`);
		} catch (error) {
			// Even the queue is unreachable: the nightly check finds and repairs the difference.
			this.logger.warn(`Search change not queued for ${[...known.keys()].join(', ')}: ${String(error)}`);
		}
	}

	private async indexLive(products: readonly Product[]): Promise<void> {
		if (!this.search || !products.length) return;
		const [variants, tree, definitions, vocabulary] = await Promise.all([
			this.variants.listForProducts(
				products.map((product) => product.id),
				'public',
			),
			this.categories.tree(),
			this.attributes?.listAll() ?? Promise.resolve([]),
			this.vocabulary?.current() ?? Promise.resolve(null),
		]);
		const names = new Map(tree.map((row) => [row.id, Object.values(row.name)]));
		await this.search.indexProducts(
			products.map((product) => ({
				product,
				variants: variants.filter((row) => row.productId === product.id),
				categoryNames: product.categoryIds.flatMap((id) => names.get(id) ?? []),
				searchWords: valueSearchWords(product, definitions),
				searchTerms: vocabulary?.wordsFor(product) ?? [],
				showFirst: vocabulary?.showsFirst(product) ?? false,
			})),
		);
	}

	async inTransaction(write: () => Promise<void>) {
		if (this.transactions) await this.transactions.withTransaction(write);
		else await write();
	}

	private async manualRelationIds(sourceProductId: string) {
		const ids = { related: [] as string[], upsell: [] as string[], cross_sell: [] as string[] };
		if (!this.relations) return ids;
		for (const relationType of RELATION_TYPES) {
			const rows = await this.relations.listForProduct({
				sourceProductId,
				relationType,
				audience: 'admin',
				pageSize: 100,
			});
			ids[relationType] = rows.filter((row) => row.source === 'manual').map((row) => row.targetId);
		}
		return ids;
	}

	/**
	 * The product's first photo gets the sizes only a main photo needs: the 1200×630 link-preview
	 * card, the shopping-feed square and the email thumbnail. Marking it queues a background
	 * reprocess; a photo already marked is left alone. A photo that stops being first keeps its
	 * extra sizes, which cost a few files and keep any link already shared working.
	 */
	private async promotePrimaryImage(product: Product): Promise<void> {
		const assetId = productGallery(product)[0];
		if (!assetId || !this.media || !this.mediaJobs) return;
		const asset = await this.media.findById(assetId);
		if (!asset || asset.servesAsPrimary) return;
		await this.media.update({ ...asset, servesAsPrimary: true });
		if (asset.processing.state === 'ready') {
			await this.mediaJobs.enqueue({ type: 'reprocess', assetId, reason: 'primary' });
		}
	}

	private async imageTiles(product: Product, variantImages: readonly string[] = []) {
		// Swatch pictures too, so the Options tab can show each value's chosen picture; and the share picture and
		// each variant's own picture (owner, 17 Nov), so their fields show what was chosen.
		const swatches = product.optionGroups.flatMap((group) =>
			group.terms.flatMap((term) => term.swatchAssetId ?? []),
		);
		const share = product.media.shareImage?.assetId ? [product.media.shareImage.assetId] : [];
		const ids = [
			...new Set([...product.media.gallery, ...productGallery(product), ...swatches, ...share, ...variantImages]),
		];
		const assets = await this.assetsFor(ids);
		return ids.flatMap((assetId) => {
			const asset = assets.get(assetId);
			const url = this.thumbnail(asset);
			return asset && url ? [{ assetId, url, width: asset.width, height: asset.height }] : [];
		});
	}

	private async assetsFor(ids: string[]): Promise<Map<string, MediaAsset>> {
		const wanted = [...new Set(ids.filter(Boolean))];
		if (!this.media || wanted.length === 0) return new Map();
		const assets = await this.media.findManyByIds(wanted);
		return new Map(assets.map((asset) => [asset.id, asset]));
	}

	/** List-size pictures for these photos, by photo id (Products › Drafts). */
	async thumbnailsFor(ids: readonly string[]): Promise<Map<string, string | null>> {
		const assets = await this.assetsFor([...ids]);
		return new Map([...ids].map((id) => [id, this.thumbnail(assets.get(id))]));
	}

	private thumbnail(asset: MediaAsset | undefined): string | null {
		if (!asset || !this.storage) return null;
		const storage = this.storage;
		const resolved = resolveImage({
			asset,
			getUrl: (key) => storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles: ['card'],
		});
		return resolved?.roles['card']?.[0]?.url ?? null;
	}

	private async replaceManualRelations(
		sourceProductId: string,
		relationType: 'related' | 'upsell' | 'cross_sell',
		targets: string[] | undefined,
	) {
		if (!this.relations || !targets) return;
		const existing = await this.relations.listForProduct({
			sourceProductId,
			relationType,
			audience: 'admin',
			pageSize: 100,
		});
		for (const row of existing) {
			if (row.source === 'manual') await this.relations.deleteById(row.id);
		}
		for (const [rank, targetId] of targets.filter(Boolean).slice(0, 12).entries()) {
			if (targetId === sourceProductId) continue;
			await this.relations.save(
				ProductRelation.parse({
					id: `rel_${sourceProductId}_${relationType}_${targetId}`,
					sourceProductId,
					relationType,
					targetType: 'product',
					targetId,
					surfaces: ['product_detail'],
					rank,
					source: 'manual',
					insightSetId: null,
					reason: null,
					startsAt: null,
					endsAt: null,
					status: 'live',
				}),
			);
		}
	}

	async requestStockAlert(idOrSlug: string, variantSku: string, customerId: string | null) {
		if (!customerId) throw new NotFoundException('Sign in to be notified');
		const product = await this.getProduct(idOrSlug, 'public');
		const rows = await this.variants.listForProduct(product.id, 'public');
		const variant = rows.find((row) => row.sku === variantSku);
		if (!variant) throw new NotFoundException('Variant not found');
		await this.stockAlerts?.save({
			customerId,
			productId: product.id,
			variantId: variant.id,
			now: new Date().toISOString(),
		});
		return { ok: true };
	}

	async removeRedirect(sourcePath: string, actorUserId: string | null = null): Promise<void> {
		await this.redirects.remove(sourcePath);
		await this.record(actorUserId, 'catalog.redirect.remove', sourcePath, { sourcePath });
	}

	listAddonTemplates() {
		return this.addons?.list() ?? Promise.resolve([]);
	}

	async saveAddonTemplate(input: AddonTemplateWrite, actorUserId: string | null = null) {
		if (!this.addons) throw new NotFoundException('Add-on templates are unavailable');
		const saved = await this.addons.save(input);
		await this.record(actorUserId, 'catalog.addon-template.save', saved.code, { priceINR: saved.priceINR });
		return saved;
	}

	async removeAddonTemplate(code: string, actorUserId: string | null = null): Promise<void> {
		if (!this.addons) throw new NotFoundException('Add-on templates are unavailable');
		await this.addons.remove(code);
		await this.record(actorUserId, 'catalog.addon-template.remove', code, { code });
	}

	async record(actorUserId: string | null, action: string, entityId: string, metadata: Record<string, unknown>) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'catalog',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}

	/**
	 * Card and product-page read model. The variant matrix stays off the card;
	 * the product page names the selected SKU.
	 */
	async productRead(slug: string, variantSku?: string) {
		const product = await this.getProduct(slug, 'public');
		const rows = await this.variants.listForProduct(product.id, 'public');
		const read = productReadModel(product, rows, variantSku);
		return {
			slug: product.slug,
			path: `/product/${product.slug}`,
			price: read.price,
			badges: read.badges,
			madeToOrder: read.madeToOrder,
			selected: read.selected ? skuView(read.selected, read.madeToOrder) : null,
			unknownVariant: read.unknownVariant,
		};
	}
}

function isPublished(product: Product): boolean {
	return product.status === 'live' || product.lifecycle.liveAt !== null;
}

function isBadgeCode(code: string): code is CatalogBadgeCode {
	return CatalogBadgeCode.safeParse(code).success;
}
