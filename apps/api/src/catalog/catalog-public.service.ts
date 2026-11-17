import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	CatalogCard,
	CatalogGallery,
	CatalogHome,
	CatalogPlacementPage,
	type CatalogPlacementQuery,
	CatalogProductPage,
	type CatalogMenuCategory,
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
	stepperStep,
	type AddonTemplateRepository,
	type CategoryPlacementRepository,
	type CategoryRepository,
	type FaqRepository,
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

import { LanguageStore } from '../languages/language-store';
import { catalogLocale, localized } from './catalog-locale';
import { pricedRow, productReadModel, skuView } from './catalog-read-model';
import { MongoListing } from './mongo-listing';
import {
	ADDON_TEMPLATE_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	CATEGORY_REPOSITORY,
	FAQ_REPOSITORY,
	LISTING_PORT,
	MEDIA_ASSET_REPOSITORY,
	PRODUCT_BUNDLE_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	PRODUCT_RELATION_REPOSITORY,
	SEO_ROUTE_REPOSITORY,
	SALE_PRICE_BOOK,
	STORAGE_PORT,
} from '../infra/tokens';
import type { SalePriceBook } from '../events/sale-price-book';

const RAIL = 12;
/** A category image is any library image, so take the size that suits it best. */
/** A parent counts its children's products and borrows a child's photo. Rows run parents first. */
function rollUp(rows: CatalogMenuCategory[]): CatalogMenuCategory[] {
	const byId = new Map(rows.map((row) => [row.id, { ...row }]));
	for (const { id } of [...rows].reverse()) {
		const row = byId.get(id) as CatalogMenuCategory;
		const parent = byId.get(row.parentId ?? '');
		if (!parent) continue;
		parent.productCount += row.productCount;
		parent.coverUrl ??= row.coverUrl;
	}
	return rows.map((row) => byId.get(row.id) as CatalogMenuCategory);
}

const CATEGORY_IMAGE_ROLES = ['category_icon', 'card', 'gallery', 'thumb'] as const;
/** Matches no category, so an unknown slug empties the list instead of widening it. */
const NO_CATEGORY = 'no-such-category';

/** "You may also like" shows at least this many when the category has them. */
const RELATED_MINIMUM = 6;

/** The sizes a product page's photos carry: the main photo, its hover zoom, and the thumbnail strip. */
const GALLERY_FRAME_ROLES = ['gallery', 'zoom', 'card'];
/** The width chat apps and search draw a link preview at (the Link preview 1.91:1 profile's size). */
const SHARE_WIDTH = 1200;

@Injectable()
export class CatalogPublicService {
	private readonly listings: ListingPort;
	/** The languages the shop shows; English alone where no store is given (unit tests). */
	private get locales(): readonly string[] {
		return this.languages?.shop() ?? ['en'];
	}

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
		// Named outright: a `| null` type is recorded as Object, which Nest cannot resolve.
		@Optional() @Inject(LanguageStore) private readonly languages: LanguageStore | null = null,
		@Optional() @Inject(FAQ_REPOSITORY) private readonly faqs: FaqRepository | null = null,
		@Optional() @Inject(SALE_PRICE_BOOK) private readonly sales: SalePriceBook | null = null,
	) {
		this.listings = listing ?? new MongoListing(products, variants);
	}

	/**
	 * The shop menu: live canonical categories that have a name in every language, so no page
	 * mixes two. A child waits for its parent, because the menu has nowhere else to put it.
	 */
	async menu(): Promise<CatalogMenuCategory[]> {
		if (!this.categories || !this.placements) return [];
		const [categories, placements, summaries] = await Promise.all([
			this.categories.tree(),
			this.placements.listCanonicalLive(),
			this.products.categorySummaries(),
		]);
		const byId = new Map(categories.map((category) => [category.id, category]));
		const summary = new Map(summaries.map((row) => [row.categoryId, row]));
		const images = await this.categoryImages(
			[
				...categories.flatMap((category) =>
					[category.media?.bannerImage ?? [], category.media?.iconImage ?? []].flat(),
				),
				...summaries.flatMap((row) => row.coverAssetId ?? []),
			],
			// The version each category stored for its pictures (R4-1; media step 4d). A photo two categories
			// show in different versions draws the last one read: the address is shared by photo id.
			Object.assign({}, ...categories.map((category) => category.media?.versions ?? {})),
		);
		const shown = new Set<string>();
		const rows: CatalogMenuCategory[] = [];
		const ordered = [...placements].sort((a, b) => a.depth - b.depth || a.displayOrder - b.displayOrder);
		for (const placement of ordered) {
			const category = byId.get(placement.categoryId);
			const { parentCategoryId: parentId } = placement;
			if (!category || !this.locales.every((locale) => category.name[locale]?.trim())) continue;
			if (parentId && !shown.has(parentId)) continue;
			shown.add(category.id);
			const own = images.get(category.media?.bannerImage ?? '') ?? null;
			const count = summary.get(category.id);
			rows.push({
				id: category.id,
				name: localized(category.name),
				slug: category.slug,
				description: localized(category.description),
				parentId,
				level: placement.depth + 1,
				path: placement.pathSlugs.join('/'),
				imageUrl: own,
				iconUrl: images.get(category.media?.iconImage ?? '') ?? null,
				productCount: count?.productCount ?? 0,
				coverUrl: own ?? images.get(count?.coverAssetId ?? '') ?? null,
			});
		}
		return rollUp(rows);
	}

	/** One address per asset, for images that only need showing. */
	async categoryImages(
		ids: readonly string[],
		versions: Readonly<Record<string, string>> = {},
	): Promise<Map<string, string>> {
		const assets = await this.assetsFor([...ids]);
		const urls = [...assets].flatMap(([id, asset]) => {
			const image = this.image(asset, CATEGORY_IMAGE_ROLES, versions[id]);
			const url = CATEGORY_IMAGE_ROLES.flatMap((role) => image?.roles[role]?.[0]?.url ?? [])[0];
			return url ? [[id, url] as const] : [];
		});
		return new Map(urls);
	}

	/** The product page: one product read, one variant read, every option group the page renders. */
	async page(slug: string, variant?: string | null): Promise<CatalogProductPage> {
		const product = await this.requireLive(slug);
		const rows = await this.variants.listForProduct(product.id, 'public');
		const read = productReadModel(product, rows, variant);
		const groups = product.optionGroups.length ? product.optionGroups : groupsFromAttributes(product);
		const swatchIds = groups.flatMap((group) => group.terms.flatMap((term) => term.swatchAssetId ?? []));
		const variantPhotos = rows.flatMap((row) => row.media?.primaryAssetId ?? []);
		const assets = await this.assetsFor([...productGallery(product), ...swatchIds, ...variantPhotos]);
		const gallery = productGallery(product).flatMap((id) => {
			// `card` is the thumbnail strip's size (about 120 px); without it the strip fell back to 900 px photos.
			const image = this.image(assets.get(id), GALLERY_FRAME_ROLES, product.media.versions?.[id]);
			// A frame is a photo with its gallery size; card sizes alone (the strip's) are not one.
			return image?.roles['gallery']?.length ? [{ id, image }] : [];
		});
		// A variant's own picture ("Variation image", owner 17 Nov) at the version stored with it: the gallery's frame
		// when it is the same photo and version, else a frame of its own after the gallery, so choosing the variant
		// shows it first. A compound product's variant leads with its own photo group instead (below).
		const variantFrame = (row: ProductVariant): string | null => {
			const photo = row.media?.primaryAssetId;
			if (!photo) return null;
			const grouped = product.media.compound.some(
				(entry) => entry.selectionHash === row.optionSelectionHash && entry.gallery.length > 0,
			);
			if (product.imageMode === 'compound' && grouped) return photo;
			const version = row.media?.primaryVersionId ?? null;
			const inGallery = gallery.some((frame) => frame.id === photo);
			if (inGallery && (version === null || version === (product.media.versions?.[photo] ?? null))) return photo;
			const key = `${photo}@${version ?? ''}`;
			if (gallery.some((frame) => frame.id === key)) return key;
			const image = this.image(assets.get(photo), GALLERY_FRAME_ROLES, version);
			if (!image?.roles['gallery']?.length) return null;
			gallery.push({ id: key, image });
			return key;
		};
		const variantFrames = new Map(rows.map((row) => [row.id, variantFrame(row)]));
		// The main photo's link-preview card, once the main-photo sizes exist.
		const mainPhoto = productGallery(product)[0];
		const cards = mainPhoto ? this.image(assets.get(mainPhoto), ['share', 'story']) : null;
		// "Meta image" (owner, 17 Nov): a chosen link-preview picture wins over the main photo's own card.
		const chosenShare = await this.chosenShare(product);
		const mainCard = cards?.roles['share']?.[0]?.url || null;
		const shareImageUrl = chosenShare?.url ?? mainCard;
		// The pipeline's share card is always a 1200×630 JPEG.
		const shareImageSize = chosenShare
			? { width: chosenShare.width, height: chosenShare.height, type: chosenShare.type }
			: mainCard
				? { width: 1200, height: 630, type: 'image/jpeg' }
				: null;
		// The tall Status/Story card; the shopper's phone writes the words into its band (share brief J1).
		const shareStoryUrl = cards?.roles['story']?.[0]?.url || null;
		const axisCodes = new Set(
			groups.filter((group) => group.semanticRole === 'variation_axis').map((group) => group.attributeCode),
		);
		const selected = read.selected ? skuView(read.selected, read.madeToOrder) : null;
		const measurements = await this.measurementsFor(product);
		const title = localized(product.title);
		const description = product.description ? localized(product.description) : '';
		const framesOf = (row: ProductVariant): number[] =>
			(product.media.compound.find((entry) => entry.selectionHash === row.optionSelectionHash)?.gallery ?? [])
				.map((id) => gallery.findIndex((frame) => frame.id === id))
				.filter((index) => index >= 0);
		return CatalogProductPage.parse({
			id: product.id,
			slug: product.slug,
			path: `/product/${product.slug}`,
			title,
			description,
			shortDescription: localized(product.shortDescription) || description,
			metaTitle: localized(product.seo?.title ?? {}) || title,
			metaDescription: localized(product.seo?.description ?? {}) || description,
			price: read.price,
			badges: read.badges,
			madeToOrder: read.madeToOrder,
			saleEndsAt: this.sales?.endsAtFor(product.id) ?? null,
			estimatedDeliveryText: product.estimatedDeliveryText ? localized(product.estimatedDeliveryText) : null,
			sareeLengthM: product.sareeLengthM ?? null,
			blousePieceM: product.blousePieceM ?? null,
			soldBy: product.soldBy,
			metre:
				product.soldBy === 'metre'
					? {
							// M2: a metre product saved before its cut was set still sells from 1.0 m.
							shortestCutTenths: product.shortestCutTenths ?? 10,
							stepTenths: stepperStep('metre'),
							quickLengths: product.quickLengths.map((row) => ({
								tenths: row.tenths,
								label: localized(row.label),
							})),
							widthInches: product.widthInches,
						}
					: null,
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
			shareImageUrl,
			shareImageSize,
			shareStoryUrl,
			code: product.sku,
			// A video YouTube no longer plays (weekly check) is left off the page.
			videos: product.videos.filter((video) => !video.unavailableSince),
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
					// The version stored with the swatch; a swatch made from one of the product's own photos draws
					// the version its gallery stores.
					image: term.swatchAssetId
						? this.image(
								assets.get(term.swatchAssetId),
								['swatch_image'],
								term.swatchVersionId ?? product.media.versions?.[term.swatchAssetId],
							)
						: null,
					// An option that measures costs the template's amount unless this product overrides it.
					priceDeltaINR:
						term.priceDeltaINR ?? (term.requiresMeasurements ? (measurements?.priceINR ?? null) : null),
					requiresMeasurements: term.requiresMeasurements,
				})),
			})),
			variants: axisCodes.size
				? rows.map((row) => {
						const priced = pricedRow(row, read.madeToOrder);
						const photo = variantFrames.get(row.id) ?? null;
						const own = product.imageMode === 'compound' ? framesOf(row) : [];
						const found = photo ? gallery.findIndex((frame) => frame.id === photo) : -1;
						const galleryIndex = own[0] ?? found;
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
							galleryIndexes: own,
						};
					})
				: [],
			measurements,
			bundle: await this.bundleFor(product),
			breadcrumb: await this.breadcrumbFor(product),
			rating: { average: product.ratingsSummary.avg, count: product.ratingsSummary.count },
			faq: await this.faqFor(product),
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
				fields: template.fields.map((field) => ({ ...field, label: localized(field.label) })),
				sizeGuide: template.sizeGuide,
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
			sizeGuide: [],
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

	/**
	 * The product page FAQ, when switched on: the product's own questions, then its categories'
	 * and their parents' (owner decision 2026-11-08). Shop-wide questions stay on the FAQ page.
	 */
	private async faqFor(product: Product): Promise<Array<{ question: string; answer: string }>> {
		if (!product.faqEnabled || !this.faqs) return [];
		const placements = this.placements;
		const paths = placements
			? await Promise.all(product.categoryIds.map((id) => placements.findCanonical(id)))
			: [];
		const categoryIds = [
			...new Set([...product.categoryIds, ...paths.flatMap((row) => row?.pathCategoryIds ?? [])]),
		];
		const entries = await this.faqs.resolveForSurface({ productId: product.id, categoryIds, includeGlobal: false });
		const own = entries.filter((entry) => entry.productIds.includes(product.id));
		const shared = entries.filter((entry) => !entry.productIds.includes(product.id));
		return [...own, ...shared]
			.map((entry) => ({ question: localized(entry.question), answer: localized(entry.answer) }))
			.filter((entry) => entry.question.trim() && entry.answer.trim());
	}

	/** The trail to the product's most specific live category (the deepest one it sits in). */
	private async breadcrumbFor(product: Product) {
		const placements = this.placements;
		if (!product.categoryIds.length || !placements) return [];
		const found = await Promise.all(product.categoryIds.map((id) => placements.findCanonical(id)));
		const placement = found
			.filter((row) => row !== null && row.status === 'live')
			.reduce<(typeof found)[number]>(
				(deepest, row) => (!deepest || (row?.pathSlugs.length ?? 0) > deepest.pathSlugs.length ? row : deepest),
				null,
			);
		if (!placement) return [];
		const labels = placement.pathLabel.split(' / ');
		const named = await Promise.all(
			placement.pathCategoryIds.map(async (id) => (await this.categories?.findById(id))?.name),
		);
		return placement.pathSlugs.map((slug, index) => ({
			name: localized(named[index] ?? {}) || (labels[index] ?? slug),
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
		// Each step of the trail in the request language; the stored path label is English.
		const labels = placement?.pathLabel.split(' / ') ?? [];
		const named = await Promise.all(
			(placement?.pathCategoryIds ?? []).map(async (id) => (await this.categories?.findById(id))?.name),
		);
		const names = (placement?.pathSlugs ?? []).map(
			(slug, index) => localized(named[index] ?? {}) || (labels[index] ?? slug),
		);
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
			faq:
				placement && page === 1 && isCleanListing(query)
					? await this.categoryFaq(placement.pathCategoryIds)
					: [],
		});
	}

	/** A category page's FAQ: questions written for it or its parents, never the shop-wide ones. */
	private async categoryFaq(categoryIds: readonly string[]): Promise<Array<{ question: string; answer: string }>> {
		if (!this.faqs || !categoryIds.length) return [];
		const entries = await this.faqs.resolveForSurface({ categoryIds, includeGlobal: false });
		return entries
			.filter((entry) => entry.scope === 'category' || entry.scope === 'mixed')
			.map((entry) => ({ question: localized(entry.question), answer: localized(entry.answer) }))
			.filter((entry) => entry.question.trim() && entry.answer.trim());
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
			// `card` is the thumbnail strip's size (about 120 px); without it the strip fell back to 900 px photos.
			const image = this.image(assets.get(id), GALLERY_FRAME_ROLES, product.media.versions?.[id]);
			return image?.roles['gallery']?.length ? [image] : [];
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
		const rows = this.relations
			? await this.relations.listForProduct({ sourceProductId: product.id, audience: 'public', pageSize: 24 })
			: [];
		// Only targets still on sale, looked up one by one: at most 24 reads, however large the
		// catalogue grows (this used to load the first 1,000 products to build the same set).
		const targets = new Map<string, Product>();
		for (const id of new Set(rows.map((row) => row.targetId))) {
			const target = await this.products.findById(id, 'public');
			if (target) targets.set(id, target);
		}
		const live = liveRelations(rows, new Set(targets.keys()));
		const products = (type: 'related' | 'upsell' | 'cross_sell' | 'bought_together') =>
			live
				.filter((row) => row.relationType === type)
				.slice(0, 12)
				.flatMap((row) => targets.get(row.targetId) ?? []);
		const picked = products('related');
		const related =
			picked.length < RELATED_MINIMUM
				? [
						...picked,
						...(await this.sameCategory(
							product,
							new Set([product.id, ...picked.map((row) => row.id)]),
							RELATED_MINIMUM - picked.length,
						)),
					]
				: picked;
		return {
			related: await this.cards(related),
			upsell: await this.cards(products('upsell')),
			crossSell: await this.cards(products('cross_sell')),
			boughtTogether: await this.cards(products('bought_together')),
		};
	}

	/**
	 * Tops up "You may also like" when fewer than six were picked in the admin: live products
	 * from the product's own category first, then each parent in turn (owner decision 2026-11-09).
	 */
	private async sameCategory(product: Product, exclude: ReadonlySet<string>, wanted: number): Promise<Product[]> {
		const found: Product[] = [];
		const skip = new Set(exclude);
		for (const categoryId of [...product.categoryIds].reverse()) {
			if (found.length >= wanted) break;
			const page = await this.products.list({
				audience: 'public',
				categoryId,
				page: 1,
				pageSize: wanted + skip.size,
			});
			for (const row of page.items) {
				if (found.length >= wanted) break;
				if (skip.has(row.id) || row.type === 'bundle') continue;
				skip.add(row.id);
				found.push(row);
			}
		}
		return found;
	}

	async livePaths(): Promise<{ products: string[]; collections: string[] }> {
		const [products, collections] = await Promise.all([
			this.products.listPublicSlugs(),
			this.placements?.listLivePaths() ?? Promise.resolve([]),
		]);
		return { products, collections };
	}

	/** The live product page a short `/p/<code>` address stands for. Codes are stored as typed, then tried in capitals. */
	async slugForCode(code: string): Promise<string | null> {
		return (
			(await this.products.findPublicSlugBySku(code)) ??
			(code === code.toUpperCase() ? null : await this.products.findPublicSlugBySku(code.toUpperCase()))
		);
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
	async seoRoute(path: string, locale: string) {
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
		const shown = new Set(this.locales);
		const prefix = (path: string) => /^\/([a-z]{2,3}(?:-[A-Z]{2})?)(?=\/|$)/.exec(path)?.[1] ?? null;
		const listed = routes.filter(
			(route) => (route.entityType === 'page' || live.has(route.path)) && shown.has(route.locale),
		);
		const paths = new Set(listed.map((route) => route.canonicalPath));
		// A language switched on after the rows were written has its pages too: every live item has
		// its text by then (Settings › Languages), so its address follows the English one.
		for (const route of listed.filter((row) => row.locale === 'en' && prefix(row.canonicalPath) === 'en')) {
			const rest = route.canonicalPath.slice('/en'.length);
			for (const locale of this.locales) if (locale !== 'en') paths.add(`/${locale}${rest}`);
		}
		const own = (path: string) => (prefix(path) && path === `/${prefix(path)}` ? `${path}/` : path);
		return [...new Set([...paths].map(own))].sort();
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
			image: primary ? this.image(assets.get(primary), ['card'], product.media.versions?.[primary]) : null,
			inStock: read.sellable > 0 || read.madeToOrder,
			madeToOrder: read.madeToOrder,
			soldBy: product.soldBy,
		});
	}

	private async assetsFor(ids: string[]): Promise<Map<string, MediaAsset>> {
		if (!this.media || ids.length === 0) return new Map();
		const assets = await this.media.findManyByIds([...new Set(ids)]);
		return new Map(assets.map((asset) => [asset.id, asset]));
	}

	/** The product's chosen share picture: the widest file of the version chosen, or null when none is set or ready. */
	private async chosenShare(
		product: Product,
	): Promise<{ url: string; width: number; height: number; type: string } | null> {
		const chosen = product.media.shareImage;
		if (!chosen || !this.storage) return null;
		const asset = (await this.assetsFor([chosen.assetId])).get(chosen.assetId);
		if (!asset || asset.deletedAt) return null;
		// Link previews are drawn about 1200 wide: the widest size up to that, else the narrowest above it.
		const fit = (width: number) => (width <= SHARE_WIDTH ? SHARE_WIDTH - width : width);
		const files = asset.derivatives
			.filter((file) => (chosen.versionId ? file.versionId === chosen.versionId : true))
			// Chat apps read JPEG best, so a JPEG size wins.
			.sort(
				(a, b) =>
					Number(b.format === 'image/jpeg') - Number(a.format === 'image/jpeg') || fit(a.width) - fit(b.width),
			);
		const best = files[0];
		return best
			? { url: this.storage.getUrl(best.storageKey), width: best.width, height: best.height, type: best.format }
			: null;
	}

	private image(
		asset: MediaAsset | undefined,
		roles: readonly string[],
		versionId?: string | null,
	): ResolvedImage | null {
		if (!asset || !this.storage) return null;
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage!.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles,
			versionId,
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
