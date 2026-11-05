import { BadRequestException, HttpException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	AdminProductDetail,
	AdminProductList,
	AdminReplacementTarget,
	CatalogBadgeCode,
	ProductRelation,
	type AdminProductListQuery,
	type AuditLog,
	type Category,
	type MediaAsset,
	type Product,
	type ProductMerchandisingWrite,
	type ProductVariant,
	type SeoRedirect,
	type SeoRedirectWrite,
} from '@saha-textile/contracts';
import {
	mrpPriceINR,
	resolveImage,
	sellingPriceINR,
	type AddonTemplateRepository,
	type AuditLogRepository,
	type CatalogAudience,
	type CategoryPlacementRepository,
	type CategoryRepository,
	type MediaAssetRepository,
	type Paginated,
	type ProductFilter,
	type ProductRelationRepository,
	type ProductRepository,
	type ProductVariantRepository,
	type SeoRedirectRepository,
	type StoragePort,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';
import { randomUUID } from 'node:crypto';

import { productReadModel, skuView } from './catalog-read-model';
import {
	ADDON_TEMPLATE_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_RELATION_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	SEO_REDIRECT_REPOSITORY,
	STORAGE_PORT,
	TRANSACTION_MANAGER,
} from '../infra/tokens';

const RELATION_TYPES = ['related', 'upsell', 'cross_sell'] as const;

@Injectable()
export class CatalogService {
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
	) {}

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

	async saveRedirect(input: SeoRedirectWrite, actorUserId: string | null = null): Promise<SeoRedirect> {
		const saved = await this.redirects.save({ ...input, id: randomUUID() });
		await this.record(actorUserId, 'catalog.redirect.save', saved.id, {
			sourcePath: saved.sourcePath,
			statusCode: saved.statusCode,
			targetPath: saved.targetPath ?? null,
		});
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
		const redirect: SeoRedirect = {
			id: `redir_${randomUUID()}`,
			sourcePath: `/product/${product.slug}`,
			statusCode: replacement ? 301 : 410,
			...(replacement ? { targetPath: replacement.path } : {}),
			reason: 'product_archived',
			entityType: 'product',
			entityId: product.id,
		};
		await this.inTransaction(async () => {
			await this.products.save(next);
			await this.redirects.save(redirect);
		});
		await this.record(actorUserId, 'catalog.product.discontinue', product.id, {
			statusCode: redirect.statusCode,
			targetPath: replacement?.path ?? null,
		});
		return { slug: product.slug, statusCode: redirect.statusCode, targetPath: replacement?.path ?? null };
	}

	private async liveReplacement(path: string, ownSlug: string): Promise<Product['replacementTarget']> {
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
			})),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		});
	}

	async adminDetail(idOrSlug: string): Promise<AdminProductDetail> {
		const product = await this.getProduct(idOrSlug, 'admin');
		const variants = await this.variants.listForProduct(product.id, 'admin');
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
			madeToOrder: product.madeToOrder,
			estimatedDeliveryText: product.estimatedDeliveryText?.en ?? null,
			lowStockThreshold: product.lowStockThreshold,
			pinnedBadges: product.pinnedBadges.filter(isBadgeCode),
			hiddenBadges: product.hiddenBadges.filter(isBadgeCode),
			addonPriceINR: product.addonPriceINR,
			replacementPath: product.replacementTarget?.path ?? null,
			shipping: product.shippingDefaults,
			hsnCode: product.hsnCode,
			relatedProductIds: relationIds.related,
			upsellProductIds: relationIds.upsell,
			crossSellProductIds: relationIds.cross_sell,
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
				available: row.status === 'live',
				weightGrams: row.shippingProfile?.weightGrams ?? null,
				lengthCm: row.shippingProfile?.lengthCm ?? null,
				widthCm: row.shippingProfile?.widthCm ?? null,
				heightCm: row.shippingProfile?.heightCm ?? null,
				barcode: row.barcode ?? null,
				hsnCode: row.taxProfile?.hsnCode ?? null,
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
		const published = isPublished(product);
		if (published && body.sku !== product.sku) {
			throw new BadRequestException('A published product keeps its SKU');
		}
		const rows = new Map((await this.variants.listForProduct(product.id, 'admin')).map((row) => [row.id, row]));
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
				stock: { ...row.stock, quantity: write.quantity },
				shippingProfile: {
					weightGrams: write.weightGrams,
					lengthCm: write.lengthCm,
					widthCm: write.widthCm,
					heightCm: write.heightCm,
				},
				taxProfile: { hsnCode: write.hsnCode, taxClassId: row.taxProfile?.taxClassId ?? null },
			};
		});
		const now = new Date().toISOString();
		const priced = [...rows.values()].map((row) => nextRows.find((next) => next.id === row.id) ?? row);
		const live = priced.filter((row) => row.status === 'live');
		const selling = (live.length ? live : priced).map((row) => sellingPriceINR(row.priceINR, row.salePriceINR));
		const next: Product = {
			...product,
			sku: body.sku,
			status: body.status,
			lifecycle: {
				...product.lifecycle,
				liveAt: product.lifecycle.liveAt ?? (body.status === 'live' ? now : null),
				disabledAt:
					body.status === 'disabled' && product.status !== 'disabled' ? now : product.lifecycle.disabledAt,
			},
			featured: body.featured,
			madeToOrder: body.madeToOrder,
			estimatedDeliveryText: body.estimatedDeliveryText
				? { ...(product.estimatedDeliveryText ?? {}), en: body.estimatedDeliveryText }
				: null,
			lowStockThreshold: body.lowStockThreshold,
			pinnedBadges: body.pinnedBadges,
			hiddenBadges: body.hiddenBadges,
			addonPriceINR: body.addonPriceINR,
			shippingDefaults: body.shipping,
			hsnCode: body.hsnCode,
			basePriceINR: selling.length ? Math.min(...selling) : product.basePriceINR,
			onSale: live.some((row) => row.salePriceINR !== null && row.salePriceINR < row.priceINR),
		};
		await this.inTransaction(async () => {
			await this.products.save(next);
			for (const row of nextRows) await this.variants.save(row);
		});
		await this.record(actorUserId, 'catalog.product.save', product.id, {
			sku: next.sku,
			status: next.status,
			variants: nextRows.map((row) => ({ sku: row.sku, priceINR: row.priceINR, salePriceINR: row.salePriceINR })),
		});
		await this.replaceManualRelations(product.id, 'related', body.relatedProductIds);
		await this.replaceManualRelations(product.id, 'upsell', body.upsellProductIds);
		await this.replaceManualRelations(product.id, 'cross_sell', body.crossSellProductIds);
		return { id: product.id, slug: product.slug };
	}

	private async inTransaction(write: () => Promise<void>) {
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

	private async assetsFor(ids: string[]): Promise<Map<string, MediaAsset>> {
		const wanted = [...new Set(ids.filter(Boolean))];
		if (!this.media || wanted.length === 0) return new Map();
		const assets = await this.media.findManyByIds(wanted);
		return new Map(assets.map((asset) => [asset.id, asset]));
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
		if (stockAlertLimited(customerId)) throw new HttpException('Too many requests', 429);
		const product = await this.getProduct(idOrSlug, 'public');
		const rows = await this.variants.listForProduct(product.id, 'public');
		const variant = rows.find((row) => row.sku === variantSku);
		if (!variant) throw new NotFoundException('Variant not found');
		await this.products.saveStockAlert(customerId, product.id, variant.id);
		return { ok: true };
	}

	async removeRedirect(sourcePath: string, actorUserId: string | null = null): Promise<void> {
		await this.redirects.remove(sourcePath);
		await this.record(actorUserId, 'catalog.redirect.remove', sourcePath, { sourcePath });
	}

	listAddonTemplates() {
		return this.addons?.list() ?? Promise.resolve([]);
	}

	async saveAddonTemplate(
		input: {
			code: string;
			label: string;
			priceINR: number;
			unit?: 'in' | 'cm';
			min?: number;
			max?: number;
			step?: number;
		},
		actorUserId: string | null = null,
	) {
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

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string,
		metadata: Record<string, unknown>,
	) {
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

const stockAlertHits = new Map<string, number[]>();

function stockAlertLimited(customerId: string): boolean {
	const now = Date.now();
	const recent = (stockAlertHits.get(customerId) ?? []).filter((at) => now - at < 60_000);
	if (recent.length >= 5) return true;
	recent.push(now);
	stockAlertHits.set(customerId, recent);
	return false;
}
