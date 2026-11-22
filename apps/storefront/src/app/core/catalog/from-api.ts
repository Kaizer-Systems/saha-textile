import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { IAttribute, IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import {
	DisplayStyle,
	IAddonGroup,
	IBundle,
	IFreeWith,
	IMeasurementField,
	ISetItem,
	ISemanticAttribute,
} from '@data-access/interfaces/product-detail.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { IVideo } from '@data-access/interfaces/video.interface';

import type { MetreRule } from '@core/catalog/metre-length';
import type { CatalogPageBundle, CatalogPageBundleItem, CatalogPageFreeWith } from '@saha-textile/contracts';

interface ApiSource {
	url: string;
	width: number;
	height: number;
}

export interface ApiImage {
	assetId: string;
	width: number;
	height: number;
	alt: string;
	roles: Record<string, ApiSource[]>;
}

export interface ApiCard {
	id: string;
	slug: string;
	title: string;
	path: string;
	price:
		| { kind: 'single'; sellingINR: number; mrpINR: number | null; percentOff: number | null }
		| { kind: 'range'; minINR: number; maxINR: number };
	badges: string[];
	lowStockLeft?: number | null;
	sku: string | null;
	image: ApiImage | null;
	inStock: boolean;
	madeToOrder: boolean;
	soldBy?: 'piece' | 'metre';
}

export interface ApiHome {
	newArrivals: ApiCard[];
	bestsellers: ApiCard[];
	featured: ApiCard[];
	sale: ApiCard[];
}

export interface ApiPlacement {
	path: string;
	title: string;
	breadcrumb: Array<{ name: string; path: string }>;
	products: ApiCard[];
	total: number;
	page: number;
	pageSize: number;
	facets: Array<{ code: string; label: string; terms: Array<{ code: string; label: string; count: number }> }>;
	indexable: boolean;
	/** The category FAQ, on the plain first page only. */
	faq?: Array<{ question: string; answer: string }>;
}

interface ApiOptionTerm {
	code: string;
	label: string;
	/** The second line in the page language; older API builds leave it out. */
	subLabel?: string | null;
	isBase: boolean;
	hex: string | null;
	image: ApiImage | null;
	priceDeltaINR: number | null;
	requiresMeasurements: boolean;
}

interface ApiOptionGroup {
	code: string;
	label: string;
	role: 'variation_axis' | 'filter_only' | 'named_add_on' | 'bundle_component_option';
	displayStyle: string;
	required: boolean;
	defaultTermCode: string | null;
	terms: ApiOptionTerm[];
}

export interface ApiProductPage {
	id: string;
	slug: string;
	path: string;
	title: string;
	description: string;
	shortDescription: string;
	metaTitle: string;
	metaDescription: string;
	price: ApiCard['price'];
	badges: { primary: string | null; secondary: string | null };
	madeToOrder: boolean;
	/** When a running sale on this product ends; null with no sale. */
	saleEndsAt?: string | null;
	/** The link-preview picture: the one chosen in the admin, else the main photo's 1200×630 card, once made. */
	shareImageUrl?: string | null;
	/** That picture's own size and type. */
	shareImageSize?: { width: number; height: number; type: string } | null;
	/** The main photo's 1080×1920 Status/Story card, with its word band empty, once made. */
	shareStoryUrl?: string | null;
	/** The product code, behind the short `/p/<code>` address. */
	code?: string;
	/** YouTube videos and Shorts in admin order. */
	videos?: IVideo[];
	estimatedDeliveryText: string | null;
	sareeLengthM: number | null;
	blousePieceM: number | null;
	soldBy?: 'piece' | 'metre';
	metre?: MetreRule | null;
	selected: { sku: string; sellingINR: number; mrpINR: number | null; quantity: number; buyable: boolean } | null;
	unknownVariant: boolean;
	gallery: ApiImage[];
	optionGroups: ApiOptionGroup[];
	variants: Array<{
		id: string;
		sku: string;
		selections: Record<string, string>;
		sellingINR: number;
		mrpINR: number | null;
		quantity: number;
		buyable: boolean;
		galleryIndex: number | null;
		galleryIndexes: number[];
	}>;
	measurements: {
		templateCode: string | null;
		/** The template's name ("Suit measurements"); older API builds leave it out. */
		title?: string | null;
		priceINR: number;
		fields: Array<{
			code: string;
			label: string;
			unit: 'in' | 'cm';
			min: number | null;
			max: number | null;
			step: number | null;
		}>;
		sizeGuide: Array<{ size: string; values: Record<string, number> }>;
	} | null;
	bundle: CatalogPageBundle | null;
	/** Free with this product (P8); older API builds leave it out. */
	freeWith?: CatalogPageFreeWith | null;
	breadcrumb: Array<{ name: string; path: string }>;
	/** From approved reviews only. */
	rating?: { average: number; count: number };
	/** The FAQ section, empty while the product's FAQ is off. */
	faq?: Array<{ question: string; answer: string }>;
}

/** Two card slots, in the order the API returns them: one promotion, then one stock fact. */
export interface CardBadges {
	primary: string | null;
	secondary: string | null;
	/** Pieces left, sent only while the low-stock fact applies. */
	left?: number | null;
}

const FACT_BADGES = new Set(['low_stock', 'back_in_stock']);

export function cardBadges(badges: readonly string[]): CardBadges {
	return {
		primary: badges.find((badge) => !FACT_BADGES.has(badge)) ?? null,
		secondary: badges.find((badge) => FACT_BADGES.has(badge)) ?? null,
	};
}

const cardUrl = (image: ApiImage | null): string =>
	image?.roles['card']?.find((source) => source.width >= 400)?.url ?? image?.roles['card']?.[0]?.url ?? '';

/** The smallest card picture, for small rows such as a set's pieces in the cart. */
export const smallCardUrl = (image: ApiImage | null): string | null =>
	image?.roles['card']?.reduce<ApiSource | null>(
		(low, source) => (!low || source.width < low.width ? source : low),
		null,
	)?.url ?? null;

const attachment = (image: ApiImage | null, id: string): IAttachment | undefined => {
	if (!image || !cardUrl(image)) return undefined;
	return { id, original_url: cardUrl(image), image } as unknown as IAttachment;
};

export const galleryAttachment = (image: ApiImage, index: number): IAttachment => {
	const gallery = image.roles['gallery'];
	const url = gallery?.find((source) => source.width >= 900)?.url ?? gallery?.[0]?.url ?? '';
	return { id: index + 1, original_url: url, image } as unknown as IAttachment;
};

/** The link-preview picture with its size when the API sends one, else the first gallery photo. */
const shareAttachment = (
	url: string | null | undefined,
	size: ApiProductPage['shareImageSize'],
	fallback: IAttachment | undefined,
): IAttachment | undefined =>
	// The size and type tell the page it can state them in og:image:width, og:image:height and og:image:type.
	url
		? ({
				id: 0,
				original_url: url,
				mime_type: size?.type ?? '',
				pixels: size ? { width: size.width, height: size.height } : undefined,
			} as unknown as IAttachment)
		: fallback;

const swatchAttachment = (image: ApiImage | null, id: number): IAttachment | undefined => {
	const url = image?.roles['swatch_image']?.at(-1)?.url;
	return url ? ({ id, original_url: url, image } as unknown as IAttachment) : undefined;
};

/** The configurator's style vocabulary. Behaviour comes from the role, never from this. */
const STYLE: Record<string, DisplayStyle> = {
	color_swatch: 'color',
	image_swatch: 'image',
	rectangle: 'rectangle',
	circle: 'circle',
	radio: 'radio',
	dropdown: 'dropdown',
	image_tile: 'image_tile',
	radio_bar: 'radio_bar',
	picture_row: 'picture_row',
	picture_chip: 'picture_chip',
	size_v2: 'size_v2',
	colour_chip: 'colour_chip',
};

const FACT_ICONS: Record<string, string> = {
	color: 'ri-palette-line',
	fabric: 'ri-shirt-line',
	weave: 'ri-grid-line',
	occasion: 'ri-gift-line',
	border: 'ri-layout-bottom-line',
};

export function cardToProduct(card: ApiCard): IProduct {
	const selling = card.price.kind === 'single' ? card.price.sellingINR : card.price.minINR;
	const mrp = card.price.kind === 'single' ? (card.price.mrpINR ?? selling) : card.price.maxINR;
	const variations: IVariation[] =
		card.price.kind === 'range'
			? [
					{
						price: card.price.minINR,
						sale_price: card.price.minINR,
						quantity: 1,
						stock_status: 'in_stock',
						sku: 'min',
					} as IVariation,
					{
						price: card.price.maxINR,
						sale_price: card.price.maxINR,
						quantity: 1,
						stock_status: 'in_stock',
						sku: 'max',
					} as IVariation,
				]
			: [];
	const badges = cardBadges(card.badges);
	return {
		id: card.id,
		name: card.title,
		slug: card.slug,
		price: mrp,
		sale_price: selling,
		is_sale_enable: badges.primary === 'sale' ? 1 : 0,
		is_featured: badges.primary === 'featured' ? 1 : 0,
		card_badges: { ...badges, left: card.lowStockLeft },
		sku: card.sku ?? '',
		quantity: card.inStock ? 1 : 0,
		stock_status: card.inStock ? 'in_stock' : 'out_of_stock',
		product_thumbnail: attachment(card.image, card.id),
		sold_by: card.soldBy ?? 'piece',
		variations,
		categories: [],
		related_products: [],
		cross_sell_products: [],
	} as unknown as IProduct;
}

export function placementToCatalog(page: ApiPlacement): ICatalogResponse {
	const prices = page.products.flatMap((card) =>
		card.price.kind === 'single' ? [card.price.sellingINR] : [card.price.minINR, card.price.maxINR],
	);
	return {
		data: page.products.map(cardToProduct),
		total: page.total,
		page: page.page,
		limit: page.pageSize,
		last_page: Math.max(1, Math.ceil(page.total / page.pageSize)),
		category: page.path ? { id: 0, name: page.title, canonical_path: page.path } : null,
		breadcrumb: page.breadcrumb.map((crumb) => ({
			name: crumb.name,
			path: crumb.path.replace(/^\/collections\//, ''),
		})),
		facetLabels: Object.fromEntries(page.facets.map((facet) => [facet.code, facet.label])),
		facets: Object.fromEntries(
			page.facets.map((facet) => [
				facet.code,
				facet.terms.map((term) => ({ value: term.code, label: term.label, count: term.count })),
			]),
		),
		price_range: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
		faq: page.faq ?? [],
	};
}

/** Free with this product (P8), in the shop's shape. */
export function freeWithFromApi(free: CatalogPageFreeWith | null | undefined): IFreeWith | undefined {
	if (!free || free.items.length === 0) return undefined;
	return {
		take: free.take,
		count: free.count,
		from: free.from,
		required: free.required,
		given: free.given,
		min: free.min,
		max: free.max,
		none_or_exactly: free.noneOrExactly,
		items: free.items.map((item) => ({
			product_id: item.productId,
			name: item.title,
			...(item.image ? { image: cardUrl(item.image as ApiImage) || undefined } : {}),
			mrp: item.mrpINR,
			selling: item.sellingINR,
			quantity: item.quantity,
			in_stock: item.inStock,
			variant_id: item.variantId,
			variant_label: item.variantLabel,
			variants: item.variants.map((v) => ({ id: v.id, label: v.label, in_stock: v.inStock })),
		})),
	};
}

/** One set item (a piece or an extra), in the shop's shape. */
function setItemFromApi(item: CatalogPageBundleItem): ISetItem {
	return {
		key: item.key,
		product_id: item.productId,
		slug: item.slug,
		name: item.title,
		sku: item.sku,
		...(item.image ? { image: cardUrl(item.image as ApiImage) || undefined } : {}),
		mrp: item.mrpINR,
		selling: item.sellingINR,
		sale: item.saleINR,
		price_in_set: item.priceInSetINR,
		today: item.todayINR,
		quantity: item.quantity,
		sold_by: item.soldBy,
		in_stock: item.inStock,
		available: item.available,
		variant_id: item.variantId,
		variant_label: item.variantLabel,
		variants: item.variants.map((v) => ({ id: v.id, label: v.label, in_stock: v.inStock })),
		free_with: freeWithFromApi(item.freeWith) ?? null,
	};
}

function optionTerms(group: ApiOptionGroup) {
	return group.terms.map((term, index) => ({
		code: term.code,
		label: term.label,
		...(term.subLabel ? { sub_label: term.subLabel } : {}),
		price_delta: term.priceDeltaINR ?? 0,
		image: swatchAttachment(term.image, index + 1)?.original_url,
		...(term.hex ? { hex: term.hex } : {}),
		is_default: term.code === group.defaultTermCode,
		requires_measurements: term.requiresMeasurements,
	}));
}

/** Maps the product page read model into the shape the existing configurator and gallery read. */
/**
 * A set's block in the shop's shape, from the API's (or the bundle builder's live preview). Product-level option
 * groups and measurements are added by the page.
 */
export function bundleFromApi(set: CatalogPageBundle, sku: string): IBundle {
	return {
		sku,
		heading: set.heading,
		bundle_price: set.priceINR,
		separately: set.separatelyINR,
		save: set.saveINR,
		from_price: set.fromPrice,
		low: set.lowINR,
		high: set.highINR,
		levels: set.levels.map((level) => ({
			code: level.code,
			label: level.label,
			take: level.take,
			choice: level.choice,
			price_mode: level.priceMode,
			items: level.items.map(setItemFromApi),
		})),
		extras: set.extras.map(setItemFromApi),
		pricing: set.pricing,
		stock: {
			sets_possible: set.stock.setsPossible,
			state: set.stock.state,
			sold_out_pieces: set.stock.soldOutPieces,
			sold_out_choices: set.stock.soldOutChoices,
		},
		buyable: set.buyable,
		option_groups: [],
	};
}

export function pageToProduct(page: ApiProductPage): IProduct {
	// The selected SKU's price and photo come first, so `?variant=` is right in the first HTML.
	const selling =
		page.selected?.sellingINR ?? (page.price.kind === 'single' ? page.price.sellingINR : page.price.minINR);
	const mrp = page.selected
		? (page.selected.mrpINR ?? page.selected.sellingINR)
		: page.price.kind === 'single'
			? (page.price.mrpINR ?? selling)
			: page.price.maxINR;
	const ordered = page.gallery.map(galleryAttachment);
	const selectedPhoto = page.variants.find((variant) => variant.sku === page.selected?.sku)?.galleryIndex ?? null;
	const galleries =
		selectedPhoto !== null && selectedPhoto > 0
			? [...ordered.slice(selectedPhoto), ...ordered.slice(0, selectedPhoto)]
			: ordered;
	const axes = page.optionGroups.filter((group) => group.role === 'variation_axis');

	const attributes: IAttribute[] = axes.map((group, axisIndex) => {
		const attributeId = axisIndex + 1;
		return {
			id: attributeId,
			name: group.label,
			slug: group.code,
			status: true,
			style: STYLE[group.displayStyle] ?? 'rectangle',
			selected_value: '',
			created_by_id: 0,
			attribute_values: group.terms.map((term, termIndex): IAttributeValue => ({
				id: attributeId * 1000 + termIndex + 1,
				name: term.label,
				value: term.label,
				...(term.subLabel ? { sub_label: term.subLabel } : {}),
				slug: term.code,
				status: true,
				hex_color: term.hex ?? '',
				attribute_id: attributeId,
				variation_image: swatchAttachment(term.image, attributeId * 1000 + termIndex + 1),
			})),
		};
	});

	const variations: IVariation[] = page.variants.map((variant) => {
		const values = attributes.flatMap((attribute) => {
			const code = variant.selections[attribute.slug];
			const value = attribute.attribute_values.find((candidate) => candidate.slug === code);
			return value ? [value] : [];
		});
		return {
			id: variant.id,
			name: values.map((value) => value.value).join(' / '),
			price: variant.mrpINR ?? variant.sellingINR,
			sale_price: variant.sellingINR,
			discount:
				variant.mrpINR && variant.mrpINR > variant.sellingINR
					? Math.floor(((variant.mrpINR - variant.sellingINR) / variant.mrpINR) * 100)
					: 0,
			stock_status: variant.buyable ? 'in_stock' : 'out_of_stock',
			sku: variant.sku,
			quantity: variant.quantity,
			variation_image: variant.galleryIndex !== null ? ordered[variant.galleryIndex] : undefined,
			variation_galleries: variant.galleryIndexes.map((index) => ordered[index]),
			variation_image_id: variant.galleryIndex !== null ? variant.galleryIndex + 1 : undefined,
			variation_options: [],
			attribute_values: values,
			selected_variation: '',
			status: true,
		} as unknown as IVariation;
	});

	const addonGroups: IAddonGroup[] = page.optionGroups
		.filter((group) => group.role === 'named_add_on')
		.map((group) => ({
			code: group.code,
			label: group.label,
			required: group.required,
			style: STYLE[group.displayStyle] ?? 'image_tile',
			default_term_code: group.defaultTermCode ?? undefined,
			terms: optionTerms(group),
		}));

	const facts: ISemanticAttribute[] = page.optionGroups
		.filter((group) => group.role === 'filter_only')
		.map((group) => ({
			code: group.code,
			label: group.label,
			value: group.terms.map((term) => term.label).join(', '),
			icon: FACT_ICONS[group.code],
		}));

	const measurementFields: IMeasurementField[] | undefined = page.measurements?.fields.map((field) => ({
		code: field.code,
		label: field.label,
		unit: field.unit,
		...(field.step !== null ? { step: field.step } : {}),
		...(field.min !== null ? { min: field.min } : {}),
		...(field.max !== null ? { max: field.max } : {}),
	}));

	// A set (bundle builder brief, approved 2026-11-22): levels, extras and the rules the page prices choices with.
	const bundle: IBundle | undefined = page.bundle
		? {
				...bundleFromApi(page.bundle, page.selected?.sku ?? page.slug),
				option_groups: page.optionGroups
					.filter((group) => group.role === 'bundle_component_option')
					.map((group) => ({
						code: group.code,
						label: group.label,
						required: group.required,
						style: STYLE[group.displayStyle] ?? 'rectangle',
						default_term_code: group.defaultTermCode ?? undefined,
						terms: optionTerms(group),
					})),
				...(measurementFields?.length ? { measurement_fields: measurementFields } : {}),
			}
		: undefined;
	const freeWith = freeWithFromApi(page.freeWith);

	const hasBundle = Boolean(bundle);
	return {
		id: page.id,
		name: page.title,
		slug: page.slug,
		description: page.description,
		short_description: page.shortDescription,
		type: axes.length ? 'classified' : 'simple',
		price: mrp,
		sale_price: selling,
		is_sale_enable: page.badges.primary === 'sale' ? 1 : 0,
		is_featured: page.badges.primary === 'featured' ? 1 : 0,
		card_badges: page.badges,
		sku: page.selected?.sku ?? variations[0]?.sku ?? '',
		quantity: page.selected?.quantity ?? 0,
		stock_status: page.selected?.buyable === false ? 'out_of_stock' : 'in_stock',
		estimated_delivery_text: page.estimatedDeliveryText ?? '',
		sale_expired_at: page.saleEndsAt ?? '',
		saree_length_m: page.sareeLengthM,
		blouse_piece_m: page.blousePieceM,
		sold_by: page.soldBy ?? 'piece',
		made_to_order: page.madeToOrder,
		metre_rule: page.soldBy === 'metre' ? (page.metre ?? null) : null,
		...(page.measurements?.title ? { measurement_title: page.measurements.title } : {}),
		size_guide: page.measurements?.sizeGuide.length
			? {
					fields: page.measurements.fields.map(({ code, label, unit }) => ({ code, label, unit })),
					rows: page.measurements.sizeGuide,
				}
			: undefined,
		product_thumbnail: galleries[0],
		product_meta_image: shareAttachment(page.shareImageUrl, page.shareImageSize, ordered[0]),
		product_code: page.code || undefined,
		share_story_image: page.shareStoryUrl
			? ({ id: 0, original_url: page.shareStoryUrl, mime_type: 'image/jpeg' } as unknown as IAttachment)
			: undefined,
		product_galleries: galleries,
		videos: page.videos ?? [],
		attributes,
		variations,
		semantic_attributes: facts.length ? facts : undefined,
		addon_groups: addonGroups.length ? addonGroups : undefined,
		measurement_fields: !hasBundle && measurementFields?.length ? measurementFields : undefined,
		bundle,
		...(freeWith ? { free_with: freeWith } : {}),
		categories: [],
		related_products: [],
		cross_sell_products: [],
		meta_title: page.metaTitle,
		meta_description: page.metaDescription,
		unknown_variant: page.unknownVariant,
		breadcrumb_trail: page.breadcrumb,
		rating_count: page.rating?.average ?? 0,
		reviews_count: page.rating?.count ?? 0,
		faq: page.faq ?? [],
	} as unknown as IProduct;
}
