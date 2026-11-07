import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	CatalogCard,
	CatalogGallery,
	CatalogHome,
	CatalogPlacementPage,
	type CatalogPlacementQuery,
	CatalogProductPage,
	type CatalogSwatch,
	type MediaAsset,
	type Product,
	type ProductVariant,
	type ResolvedImage,
} from '@saha-textile/contracts';
import {
	retiredCollectionRow,
	parseAttributeFilter,
	parsePriceRanges,
	productGallery,
	resolveImage,
	liveRelations,
	type AddonTemplateRepository,
	type CategoryPlacementRepository,
	type CategoryRepository,
	type ListingFilters,
	type ListingPort,
	type MediaAssetRepository,
	type ProductBundleRepository,
	type ProductRelationRepository,
	type ProductRepository,
	type ProductVariantRepository,
	type SeoRedirectRow,
	type SeoRouteRepository,
	type StoragePort,
} from '@saha-textile/core-domain';

import { catalogLocale, localized } from './catalog-locale';
import { pricedRow, productReadModel, skuView } from './catalog-read-model';
import { MongoListing } from './mongo-listing';
import {
	ADDON_TEMPLATE_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	LISTING_PORT,
	MEDIA_ASSET_REPOSITORY,
	PRODUCT_BUNDLE_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	PRODUCT_RELATION_REPOSITORY,
	SEO_ROUTE_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';

const RAIL = 12;
/** Matches no category, so an unknown slug empties the list instead of widening it. */
const NO_CATEGORY = 'no-such-category';

@Injectable()
export class CatalogPublicService {
	private readonly listings: ListingPort;

	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Optional()
		@Inject(CATEGORY_PLACEMENT_REPOSITORY)
		private readonly placements: CategoryPlacementRepository | null = null,
		@Optional() @Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository | null = null,
		@Optional() @Inject(STORAGE_PORT) private readonly storage: StoragePort | null = null,
		@Optional()
		@Inject(PRODUCT_RELATION_REPOSITORY)
		private readonly relations: ProductRelationRepository | null = null,
		@Optional()
		@Inject(ADDON_TEMPLATE_REPOSITORY)
		private readonly addonTemplates: AddonTemplateRepository | null = null,
		@Optional()
		@Inject(PRODUCT_BUNDLE_REPOSITORY)
		private readonly bundles: ProductBundleRepository | null = null,
		@Optional() @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository | null = null,
		@Optional() @Inject(SEO_ROUTE_REPOSITORY) private readonly seoRoutes: SeoRouteRepository | null = null,
		@Optional() @Inject(LISTING_PORT) listing: ListingPort | null = null,
	) {
		this.listings = listing ?? new MongoListing(products, variants);
	}

	/** The product page: one product read, one variant read, every option group the page renders. */
	async page(slug: string, variant?: string | null): Promise<CatalogProductPage> {
		const product = await this.requireLive(slug);
		const rows = await this.variants.listForProduct(product.id, 'public');
		const read = productReadModel(product, rows, variant);
		const groups = product.optionGroups.length ? product.optionGroups : groupsFromAttributes(product);
		const swatchIds = groups.flatMap((group) => group.terms.flatMap((term) => term.swatchAssetId ?? []));
		const assets = await this.assetsFor([...productGallery(product), ...swatchIds]);
		const gallery = productGallery(product).flatMap((id) => {
			const image = this.image(assets.get(id), ['gallery', 'zoom']);
			return image ? [{ id, image }] : [];
		});
		const axisCodes = new Set(
			groups.filter((group) => group.semanticRole === 'variation_axis').map((group) => group.attributeCode),
		);
		const selected = read.selected ? skuView(read.selected, read.madeToOrder) : null;
		return CatalogProductPage.parse({
			id: product.id,
			slug: product.slug,
			path: `/product/${product.slug}`,
			title: localized(product.title),
			description: product.description ? localized(product.description) : '',
			price: read.price,
			badges: read.badges,
			madeToOrder: read.madeToOrder,
			estimatedDeliveryText: product.estimatedDeliveryText ? localized(product.estimatedDeliveryText) : null,
			selected: selected
				? {
						sku: selected.sku,
						sellingINR: selected.sellingINR,
						mrpINR: selected.mrpINR,
						quantity: selected.quantity,
						buyable: selected.buyable,
					}
				: null,
			unknownVariant: read.unknownVariant,
			gallery: gallery.map((frame) => frame.image),
			optionGroups: groups.map((group) => ({
				code: group.attributeCode,
				label: localized(group.label),
				role: group.semanticRole,
				displayStyle: group.displayStyle,
				required: group.requiredSelection,
				defaultTermCode: group.defaultTermCode,
				terms: group.terms.map((term) => ({
					code: term.code,
					label: localized(term.label),
					isBase: term.isBase,
					hex: term.hex ?? null,
					image: term.swatchAssetId ? this.image(assets.get(term.swatchAssetId), ['swatch_image']) : null,
					priceDeltaINR: term.priceDeltaINR ?? null,
					requiresMeasurements: term.requiresMeasurements,
				})),
			})),
			variants: axisCodes.size
				? rows.map((row) => {
						const priced = pricedRow(row, read.madeToOrder);
						const photo = row.media?.primaryAssetId ?? null;
						const galleryIndex = photo ? gallery.findIndex((frame) => frame.id === photo) : -1;
						return {
							id: row.id,
							sku: row.sku,
							selections: Object.fromEntries(
								row.optionSelections
									.filter((selection) => axisCodes.has(selection.attributeCode))
									.map((selection) => [selection.attributeCode, selection.termCode]),
							),
							sellingINR: priced.sellingINR,
							mrpINR: priced.mrpINR,
							quantity: priced.quantity,
							buyable: priced.buyable,
							galleryIndex: galleryIndex >= 0 ? galleryIndex : null,
						};
					})
				: [],
			measurements: await this.measurementsFor(product),
			bundle: await this.bundleFor(product),
			breadcrumb: await this.breadcrumbFor(product),
		});
	}

	/** What a cart needs of a product: the page when it can be sold, and its name either way. */
	async cartRead(id: string): Promise<{ slug: string; title: string; page: CatalogProductPage | null } | null> {
		const live = await this.products.findById(id, 'public');
		if (live) {
			const page = await this.page(live.slug);
			return { slug: page.slug, title: page.title, page };
		}
		const retired = await this.products.findById(id, 'admin');
		return retired ? { slug: retired.slug, title: localized(retired.title), page: null } : null;
	}

	private async measurementsFor(product: Product) {
		const template =
			product.addonTemplateCode && this.addonTemplates
				? await this.addonTemplates.findByCode(product.addonTemplateCode)
				: null;
		if (template && template.fields.length > 0) {
			return {
				templateCode: template.code,
				priceINR: product.addonPriceINR ?? template.priceINR,
				fields: template.fields,
			};
		}
		const own = product.addons.filter((addon) => addon.type === 'number');
		if (own.length === 0) return null;
		return {
			templateCode: null,
			priceINR: product.addonPriceINR ?? 0,
			fields: own.map((addon) => ({
				code: addon.code,
				label: localized(addon.label),
				unit: addon.unit === 'cm' ? ('cm' as const) : ('in' as const),
				min: null,
				max: null,
				step: null,
			})),
		};
	}

	private async bundleFor(product: Product) {
		if (!this.bundles) return null;
		const bundle = await this.bundles.findByProductId(product.id, 'public');
		if (!bundle) return null;
		const groups = await Promise.all(
			bundle.groups.map(async (group) => {
				const components = await Promise.all(
					group.components.map(async (component) => {
						const target = await this.products.findById(component.productId, 'public');
						if (!target) return null;
						const rows = await this.variants.listForProduct(target.id, 'public');
						const read = productReadModel(target, rows);
						const chosen = read.selected ? pricedRow(read.selected, read.madeToOrder) : null;
						return {
							productId: target.id,
							slug: target.slug,
							title: localized(target.title),
							sku: read.selected?.sku ?? target.sku,
							sellingINR: chosen?.sellingINR ?? target.basePriceINR,
							quantity: component.quantity,
							required: component.required,
							inStock: read.sellable > 0 || read.madeToOrder,
						};
					}),
				);
				const live = components.filter((component) => component !== null);
				return {
					code: group.code,
					label: localized(group.label),
					minSelections: group.minSelections,
					maxSelections: Math.min(group.maxSelections, Math.max(1, live.length)),
					components: live,
				};
			}),
		);
		const usable = groups.filter((group) => group.components.length > 0);
		if (usable.length === 0) return null;
		const sum = usable.reduce(
			(total, group) =>
				total +
				group.components.reduce((part, component) => part + component.sellingINR * component.quantity, 0),
			0,
		);
		return {
			bundleType: bundle.bundleType,
			pricePolicy: bundle.pricePolicy,
			priceINR: bundle.pricePolicy === 'fixed_bundle_price' ? (bundle.fixedPriceINR ?? sum) : sum,
			groups: usable,
		};
	}

	private async breadcrumbFor(product: Product) {
		const categoryId = product.categoryIds[0];
		if (!categoryId || !this.placements) return [];
		const placement = await this.placements.findCanonical(categoryId);
		if (!placement || placement.status !== 'live') return [];
		const names = placement.pathLabel.split(' / ');
		return placement.pathSlugs.map((slug, index) => ({
			name: names[index] ?? slug,
			path: `/collections/${placement.pathSlugs.slice(0, index + 1).join('/')}`,
		}));
	}

	async home(): Promise<CatalogHome> {
		const [fresh, featured, sale, bestsellers] = await Promise.all([
			this.products.list({ audience: 'public', page: 1, pageSize: RAIL }),
			this.products.list({ audience: 'public', page: 1, pageSize: RAIL, featured: true }),
			this.products.list({ audience: 'public', page: 1, pageSize: RAIL, onSale: true }),
			this.products.list({ audience: 'public', page: 1, pageSize: RAIL, insight: 'bestseller' }),
		]);
		return CatalogHome.parse({
			newArrivals: await this.cards(fresh.items),
			bestsellers: await this.cards(bestsellers.items),
			featured: await this.cards(featured.items),
			sale: await this.cards(sale.items),
		});
	}

	async placement(query: CatalogPlacementQuery): Promise<CatalogPlacementPage> {
		const { path, page, pageSize, sortBy } = query;
		const slugs = path.split('/').filter(Boolean);
		// No path is the all-products page, so only a named path has to exist.
		const placement = slugs.length ? await this.requirePlacement(slugs, path) : null;
		const result = await this.listings.page({
			...(placement ? { categoryId: placement.categoryId } : {}),
			filters: await this.listingFilters(query),
			...(sortBy ? { sort: sortBy } : {}),
			page,
			pageSize,
			locale: catalogLocale(),
		});
		const names = placement?.pathLabel.split(' / ') ?? [];
		return CatalogPlacementPage.parse({
			path: placement?.pathSlugs.join('/') ?? '',
			title: names.at(-1) ?? placement?.pathLabel ?? 'All products',
			breadcrumb: (placement?.pathSlugs ?? []).map((slug, index, pathSlugs) => ({
				name: names[index] ?? slug,
				path: `/collections/${pathSlugs.slice(0, index + 1).join('/')}`,
			})),
			products: await this.cardsForIds(result.productIds),
			total: result.total,
			page,
			pageSize,
			facets: result.facets,
			indexable: isCleanListing(query),
		});
	}

	private async variantsByProduct(products: readonly Product[]): Promise<Map<string, ProductVariant[]>> {
		const rows = await this.variants.listForProducts(
			products.map((product) => product.id),
			'public',
		);
		const grouped = new Map<string, ProductVariant[]>();
		for (const row of rows) grouped.set(row.productId, [...(grouped.get(row.productId) ?? []), row]);
		return grouped;
	}

	private async listingFilters(query: CatalogPlacementQuery): Promise<ListingFilters> {
		const ratings = (query.rating ?? '').split(',').filter(Boolean).map(Number);
		const groups = query.attribute === undefined ? [] : [query.attribute].flat();
		return {
			priceRanges: parsePriceRanges({ price: query.price, min: query.price_min, max: query.price_max }),
			minRating: ratings.length ? Math.min(...ratings) : null,
			categoryIds: await this.categoryIds(query.category),
			attributes: parseAttributeFilter(groups),
		};
	}

	/** A slug that matches nothing still filters, to nothing, rather than being ignored. */
	private async categoryIds(category: string | undefined): Promise<string[]> {
		if (!category || !this.categories) return [];
		const found = await Promise.all(category.split(',').map((slug) => this.categories?.findBySlug(slug)));
		const ids = found.flatMap((row) => (row ? [row.id] : []));
		return ids.length ? ids : [NO_CATEGORY];
	}

	private async requirePlacement(slugs: string[], path: string) {
		if (!this.placements) throw new NotFoundException('Catalogue placements are unavailable');
		const placement = await this.placements.findByPath(slugs, 'public');
		if (!placement) throw new NotFoundException(`Category not found: ${path}`);
		return placement;
	}

	async gallery(slug: string): Promise<CatalogGallery> {
		const product = await this.requireLive(slug);
		const assets = await this.assetsFor(productGallery(product));
		const frames = productGallery(product).flatMap((id) => {
			const image = this.image(assets.get(id), ['gallery', 'zoom']);
			return image ? [image] : [];
		});
		return CatalogGallery.parse({ slug: product.slug, frames });
	}

	async swatches(slug: string): Promise<CatalogSwatch[]> {
		const product = await this.requireLive(slug);
		const ids = product.attributes.flatMap((attribute) =>
			attribute.terms.flatMap((term) => (term.swatch ? [term.swatch] : [])),
		);
		const assets = await this.assetsFor(ids);
		return product.attributes.flatMap((attribute) =>
			attribute.terms.map((term) => ({
				attributeCode: attribute.code,
				termCode: term.code,
				label: localized(term.label),
				hex: term.hex ?? null,
				image: term.swatch ? this.image(assets.get(term.swatch), ['swatch_image']) : null,
			})),
		);
	}

	async cardsForSlugs(slugs: readonly string[]) {
		const found: Product[] = [];
		for (const slug of slugs.slice(0, 12)) {
			const product = await this.products.findBySlug(slug, 'public');
			if (product) found.push(product);
		}
		return this.cards(found);
	}

	/** Cards for products still on sale; anything no longer public is left out. */
	async cardsForIds(ids: readonly string[]): Promise<CatalogCard[]> {
		const found = await Promise.all(ids.map((id) => this.products.findById(id, 'public')));
		return this.cards(found.filter((product) => product !== null));
	}

	async relationCards(slug: string) {
		const product = await this.requireLive(slug);
		if (!this.relations) return { related: [], upsell: [], crossSell: [], boughtTogether: [] };
		const rows = liveRelations(
			await this.relations.listForProduct({ sourceProductId: product.id, audience: 'public', pageSize: 24 }),
			new Set(
				(await this.products.list({ audience: 'public', page: 1, pageSize: 1000 })).items.map((row) => row.id),
			),
		);
		const grouped = async (type: 'related' | 'upsell' | 'cross_sell' | 'bought_together') => {
			const ids = rows.filter((row) => row.relationType === type).map((row) => row.targetId);
			const found: Product[] = [];
			for (const id of ids.slice(0, 12)) {
				const target = await this.products.findById(id, 'public');
				if (target) found.push(target);
			}
			return this.cards(found);
		};
		return {
			related: await grouped('related'),
			upsell: await grouped('upsell'),
			crossSell: await grouped('cross_sell'),
			boughtTogether: await grouped('bought_together'),
		};
	}

	async livePaths(): Promise<{ products: string[]; collections: string[] }> {
		const [products, collections] = await Promise.all([
			this.products.listPublicSlugs(),
			this.placements?.listLivePaths() ?? Promise.resolve([]),
		]);
		return { products, collections };
	}

	/** Redirects the taxonomy implies: each retired collection and where it now goes. */
	async retiredCollectionRows(): Promise<SeoRedirectRow[]> {
		if (!this.placements) return [];
		const [retired, live] = await Promise.all([
			this.placements.listRetiredPaths(),
			this.placements.listLivePaths(),
		]);
		const liveSet = new Set(live);
		return retired.filter((path) => !liveSet.has(path)).map((path) => retiredCollectionRow(path, liveSet));
	}

	/** The head data for one public address. Null when the address has no row. */
	async seoRoute(path: string, locale: 'en' | 'fr') {
		const route = (await this.seoRoutes?.find(path, locale)) ?? null;
		return route && { ...route, description: plainText(route.description) };
	}

	/** Every address the sitemap may list: indexable, and still a live page. */
	async sitemapPaths(): Promise<string[]> {
		const [routes, { products, collections }] = await Promise.all([
			this.seoRoutes?.listIndexable() ?? Promise.resolve([]),
			this.livePaths(),
		]);
		const live = new Set([
			...products.map((slug) => `/product/${slug}`),
			...collections.map((path) => `/collections/${path}`),
		]);
		return routes
			.filter((route) => route.entityType === 'page' || live.has(route.path))
			.map((route) => (/^\/(en|fr)$/.test(route.canonicalPath) ? `${route.canonicalPath}/` : route.canonicalPath))
			.sort();
	}

	private async requireLive(slug: string): Promise<Product> {
		const product =
			(await this.products.findBySlug(slug, 'public')) ?? (await this.products.findById(slug, 'public'));
		if (!product) throw new NotFoundException(`Product not found: ${slug}`);
		return product;
	}

	private async cards(products: Product[], known?: ReadonlyMap<string, ProductVariant[]>): Promise<CatalogCard[]> {
		const variants = known ?? (await this.variantsByProduct(products));
		const assets = await this.assetsFor(products.flatMap((product) => productGallery(product).slice(0, 1)));
		return products.map((product) => this.card(product, variants.get(product.id) ?? [], assets));
	}

	private card(product: Product, rows: ProductVariant[], assets: Map<string, MediaAsset>): CatalogCard {
		const read = productReadModel(product, rows);
		const primary = productGallery(product)[0];
		return CatalogCard.parse({
			id: product.id,
			slug: product.slug,
			title: localized(product.title),
			path: `/product/${product.slug}`,
			price: read.price,
			badges: [read.badges.primary, read.badges.secondary].filter((badge) => badge !== null),
			lowStockLeft: read.badges.secondary === 'low_stock' ? read.sellable : null,
			sku: read.selected?.sku ?? product.sku,
			image: primary ? this.image(assets.get(primary), ['card']) : null,
			inStock: read.sellable > 0 || read.madeToOrder,
			madeToOrder: read.madeToOrder,
		});
	}

	private async assetsFor(ids: string[]): Promise<Map<string, MediaAsset>> {
		if (!this.media || ids.length === 0) return new Map();
		const assets = await this.media.findManyByIds([...new Set(ids)]);
		return new Map(assets.map((asset) => [asset.id, asset]));
	}

	private image(asset: MediaAsset | undefined, roles: readonly string[]): ResolvedImage | null {
		if (!asset || !this.storage) return null;
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage!.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles,
		});
		if (!resolved || !roles.some((role) => (resolved.roles[role]?.length ?? 0) > 0)) return null;
		return resolved;
	}
}

/** Products saved before option groups existed: their attributes become variation axes or filter facts. */
function groupsFromAttributes(product: Product): Product['optionGroups'] {
	return product.attributes.map((attribute) => ({
		attributeCode: attribute.code,
		label: attribute.label,
		semanticRole: attribute.usedForVariations ? ('variation_axis' as const) : ('filter_only' as const),
		displayStyle: attribute.terms.some((term) => term.hex) ? ('color_swatch' as const) : ('rectangle' as const),
		requiredSelection: attribute.usedForVariations,
		defaultTermCode: null,
		terms: attribute.terms.map((term, index) => ({
			code: term.code,
			label: term.label,
			isBase: term.isBase,
			...(term.hex ? { hex: term.hex } : {}),
			...(term.swatch ? { swatchAssetId: term.swatch } : {}),
			addonTemplateIds: [],
			requiresMeasurements: false,
			sortOrder: index,
		})),
	}));
}

/** Stored descriptions can hold markup; a search snippet cannot. */
function plainText(html: string): string {
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 160);
}

/** Only the plain first page is worth indexing. */
function isCleanListing(query: CatalogPlacementQuery): boolean {
	const { attribute, price, price_min, price_max, rating, category, sortBy, page } = query;
	return (
		page === 1 && [attribute, price, price_min, price_max, rating, category, sortBy].every((v) => v === undefined)
	);
}
