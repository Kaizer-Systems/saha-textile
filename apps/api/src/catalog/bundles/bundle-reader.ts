import type {
	BundlePriceMethod,
	BundleStockSummary,
	CatalogPageBundle,
	CatalogPageBundleItem,
	CatalogPageFreeWith,
	Product,
	ProductBundle,
	ProductVariant,
	ResolvedImage,
} from '@saha-textile/contracts';
import { bundleItemKey } from '@saha-textile/contracts';
import {
	OFFER_ACTIONS,
	anyCombinationInStock,
	bundleStockSummary,
	freeRange,
	priceRange,
	productGallery,
	quoteBundle,
	type BundlePriceMethodRepository,
	type ProductRepository,
	type ProductVariantRepository,
	type QuoteBundle,
	type QuoteItem,
} from '@saha-textile/core-domain';

import { freeToSellOf, pricedRow } from '../catalog-read-model';
import { localized } from '../catalog-locale';
import type { SalePriceBook } from '../../events/sale-price-book';

/** The shop's default low-stock number when a bundle's product sets none. */
export const DEFAULT_LOW_STOCK = 2;

/** One set item (a piece or an extra) resolved against its live product, with today's prices and stock. */
export interface ResolvedItem {
	key: string;
	productId: string;
	/** Always the product read for it: an item whose product is gone drops out instead. */
	product: Product;
	isBundle: boolean;
	live: boolean;
	shown: boolean;
	title: string;
	slug: string;
	sku: string;
	variantId: string | null;
	variantLabel: string | null;
	/** The sizes or colours a shopper may choose, when no variant is pinned. */
	variants: Array<{ id: string; label: string; inStock: boolean; available: number | null }>;
	mrpINR: number | null;
	sellingINR: number;
	saleINR: number | null;
	saleEventId: string | null;
	saleEndsAt: string | null;
	priceInSetINR: number;
	overridden: boolean;
	todayINR: number;
	quantity: number;
	soldBy: 'piece' | 'metre';
	madeToOrder: boolean;
	/** Units free to sell; null when made to order. */
	available: number | null;
	/** Whole sets this item can serve now. */
	capacity: number;
	imageAssetId: string | null;
	imageVersionId: string | null;
	freeWith: Product['freeWith'];
}

export interface ResolvedLevel {
	code: string;
	label: ProductBundle['levels'][number]['label'];
	take: number;
	priceMode: ProductBundle['levels'][number]['priceMode'];
	source: ProductBundle['levels'][number]['source'];
	items: ResolvedItem[];
}

export interface ResolvedBundle {
	bundle: ProductBundle;
	method: BundlePriceMethod | null;
	levels: ResolvedLevel[];
	extras: ResolvedItem[];
}

const termLabel = (product: Product, selections: ProductVariant['optionSelections']): string =>
	selections
		.flatMap((selection) => {
			const group = product.optionGroups.find((row) => row.attributeCode === selection.attributeCode);
			if (!group || group.semanticRole !== 'variation_axis') return [];
			const term = group.terms.find((row) => row.code === selection.termCode);
			return term ? [localized(term.label)] : [];
		})
		.join(' / ');

/**
 * Reads a bundle's items against their live products (bundle builder brief, approved 2026-11-22). Everything that
 * prices, stocks or shows a set reads through here, so the shop, the admin builder, the cart and checkout agree.
 */
export class BundleReader {
	constructor(
		private readonly products: ProductRepository,
		private readonly variants: ProductVariantRepository,
		private readonly methods: BundlePriceMethodRepository | null,
		private readonly sales: SalePriceBook | null,
	) {}

	async resolve(bundle: ProductBundle, now: Date = new Date()): Promise<ResolvedBundle> {
		const method = this.methods ? await this.methods.findById(bundle.pricing.methodId) : null;
		const levels = await Promise.all(
			bundle.levels.map(async (level) => {
				const items =
					level.source.kind === 'category'
						? await this.categoryItems(level.source.categoryId, level.source.limit, bundle.productId)
						: level.items;
				return {
					code: level.code,
					label: level.label,
					take: level.take,
					priceMode: level.priceMode,
					source: level.source,
					items: (await Promise.all(items.map((item) => this.item(item, now)))).filter(
						(item): item is ResolvedItem => item !== null,
					),
				};
			}),
		);
		const extras = (await Promise.all(bundle.extras.map((item) => this.item(item, now)))).filter(
			(item): item is ResolvedItem => item !== null,
		);
		return { bundle, method, levels, extras };
	}

	/** A category-filled level (S10): its newest live products, bundles left out. */
	private async categoryItems(categoryId: string, limit: number, selfId: string) {
		const page = await this.products.list({
			audience: 'admin',
			status: 'live',
			categoryId,
			page: 1,
			pageSize: limit + 1,
		});
		return page.items
			.filter((product) => product.type !== 'bundle' && product.id !== selfId)
			.slice(0, limit)
			.map((product) => ({ productId: product.id, variantId: null, quantity: 1, priceInSetINR: null }));
	}

	/** One item, priced and stocked now. A product that no longer exists drops out (the checks name it). */
	async item(
		item: ProductBundle['levels'][number]['items'][number],
		now: Date = new Date(),
	): Promise<ResolvedItem | null> {
		const product = await this.products.findById(item.productId, 'admin');
		if (!product) return null;
		const rows = (await this.variants.listForProduct(product.id, 'admin')).filter((row) => row.status === 'live');
		const madeToOrder = product.madeToOrder && product.status === 'live';
		const pinned = item.variantId ? (rows.find((row) => row.id === item.variantId) ?? null) : null;
		const shopperChooses = !item.variantId && rows.length > 1;
		const defaultRow =
			pinned ??
			rows.find((row) => row.isBaseVariant) ??
			rows.find((row) => freeToSellOf(row) > 0) ??
			rows[0] ??
			null;
		const priced = defaultRow ? pricedRow(defaultRow, madeToOrder) : null;
		const sale = defaultRow && this.sales ? this.sales.priceFor(defaultRow, now) : null;
		const sellingINR = priced?.sellingINR ?? product.basePriceINR;
		const available = madeToOrder
			? null
			: pinned
				? Math.max(0, freeToSellOf(pinned))
				: rows.reduce((sum, row) => sum + Math.max(0, freeToSellOf(row)), 0);
		const perSet = Math.max(1, item.quantity);
		const primary = productGallery(product)[0] ?? null;
		return {
			key: bundleItemKey(item),
			productId: product.id,
			product,
			isBundle: product.type === 'bundle',
			live: product.status === 'live',
			shown: product.showOnShop !== false,
			title: localized(product.title),
			slug: product.slug,
			sku: pinned?.sku ?? defaultRow?.sku ?? product.sku,
			variantId: pinned?.id ?? null,
			variantLabel: pinned ? termLabel(product, pinned.optionSelections) || null : null,
			variants: shopperChooses
				? rows.map((row) => ({
						id: row.id,
						label: termLabel(product, row.optionSelections) || row.sku,
						inStock: madeToOrder || freeToSellOf(row) > 0,
						available: madeToOrder ? null : Math.max(0, freeToSellOf(row)),
					}))
				: [],
			mrpINR: priced?.mrpINR ?? null,
			sellingINR,
			saleINR: sale?.saleINR ?? null,
			saleEventId: sale?.eventId ?? null,
			saleEndsAt: sale?.endsAt ?? null,
			priceInSetINR: item.priceInSetINR ?? sellingINR,
			overridden: item.priceInSetINR !== null,
			todayINR: sale?.saleINR ?? sellingINR,
			quantity: item.quantity,
			soldBy: product.soldBy,
			madeToOrder,
			available,
			capacity: available === null ? Number.POSITIVE_INFINITY : Math.floor(available / perSet),
			imageAssetId: primary,
			imageVersionId: primary ? (product.media.versions?.[primary] ?? null) : null,
			freeWith: product.freeWith ?? null,
		};
	}

	/** The set as core's engine reads it. A missing or switched-off method prices by the pieces (checks name it). */
	toQuote(resolved: ResolvedBundle): QuoteBundle {
		const { bundle, method } = resolved;
		const quoteItem = (item: ResolvedItem): QuoteItem => ({
			key: item.key,
			quantity: item.quantity,
			priceInSetINR: item.priceInSetINR,
			todayINR: item.todayINR,
			onSale: item.saleINR !== null,
			perTenth: item.soldBy === 'metre',
		});
		return {
			levels: resolved.levels.map((level) => ({
				code: level.code,
				take: level.take,
				priceMode: level.priceMode,
				items: level.items.map(quoteItem),
			})),
			extras: resolved.extras.map(quoteItem),
			method: method
				? { base: method.base, inputs: method.inputs, rules: method.rules, combine: method.combine }
				: { base: { kind: 'pieces' }, inputs: [], rules: [], combine: 'all' },
			params: bundle.pricing.params,
			rules: bundle.pricing.rules,
			combine: bundle.pricing.combine,
			capAtSeparately: bundle.pricing.capAtSeparately,
			roundTo: bundle.pricing.roundTo,
			eventSale: this.sales?.setRules(bundle.productId) ?? [],
		};
	}

	/** The worked-out stock (V3). Rules that narrow choices are honoured: out of stock when no allowed combination remains. */
	stock(resolved: ResolvedBundle, lowStockThreshold: number | null, now: Date = new Date()): BundleStockSummary {
		const quote = this.toQuote(resolved);
		const capacity = new Map<string, number>();
		for (const item of [...resolved.levels.flatMap((level) => level.items), ...resolved.extras]) {
			capacity.set(item.key, item.live ? item.capacity : 0);
		}
		const hasOfferRules = [...quote.method.rules, ...quote.rules].some((rule) =>
			[...rule.then, ...rule.otherwise].some((action) => OFFER_ACTIONS.has(action.kind)),
		);
		const summary = bundleStockSummary(
			resolved.levels.map((level) => ({
				code: level.code,
				take: level.take,
				// Every level item's capacity was set just above.
				items: level.items.map((item) => ({ key: item.key, capacity: capacity.get(item.key) as number })),
			})),
			{
				lowStockThreshold: lowStockThreshold ?? DEFAULT_LOW_STOCK,
				hasOfferRules,
				anyCombination: () => anyCombinationInStock(quote, capacity, now),
			},
		);
		return { ...summary, updatedAt: now.toISOString() };
	}

	/** Whether the set can be bought now: live, in stock and inside its sale window. */
	buyable(
		resolved: ResolvedBundle,
		stock: BundleStockSummary,
		productLive: boolean,
		now: Date = new Date(),
	): boolean {
		const window = resolved.bundle.saleWindow;
		const inWindow =
			!window ||
			((!window.from || Date.parse(window.from) <= now.getTime()) &&
				(!window.to || now.getTime() < Date.parse(window.to)));
		return productLive && stock.setsPossible > 0 && inWindow && resolved.levels.length > 0;
	}

	/** Free with this product, as the shop shows it. Items that no longer exist or are not live drop out. */
	async freeWithPage(
		freeWith: Product['freeWith'],
		image: (product: Product) => Promise<ResolvedImage | null>,
	): Promise<CatalogPageFreeWith | null> {
		if (!freeWith || freeWith.items.length === 0) return null;
		const items = (
			await Promise.all(
				freeWith.items.map(async (row) => {
					const resolved = await this.item({
						productId: row.productId,
						variantId: row.variantId,
						quantity: row.quantity,
						priceInSetINR: null,
					});
					if (!resolved || !resolved.live) return null;
					return {
						productId: resolved.productId,
						title: resolved.title,
						image: await image(resolved.product),
						mrpINR: resolved.mrpINR,
						sellingINR: resolved.sellingINR,
						quantity: row.quantity,
						inStock: resolved.capacity >= 1,
						variantId: resolved.variantId,
						variantLabel: resolved.variantLabel,
						variants: resolved.variants.map(({ id, label, inStock }) => ({ id, label, inStock })),
					};
				}),
			)
		).filter((item) => item !== null);
		if (items.length === 0) return null;
		const range = freeRange(freeWith);
		return {
			take: freeWith.take,
			count: freeWith.count,
			from: freeWith.from,
			required: freeWith.required,
			given: range.given,
			min: range.min,
			max: range.max,
			noneOrExactly: range.noneOrExactly,
			items,
		};
	}

	/** The set block of the product page. */
	async page(
		resolved: ResolvedBundle,
		product: Product,
		image: (product: Product) => Promise<ResolvedImage | null>,
		now: Date = new Date(),
	): Promise<CatalogPageBundle | null> {
		if (resolved.levels.every((level) => level.items.length === 0)) return null;
		const quote = this.toQuote(resolved);
		const first = quoteBundle(quote, {}, now);
		const range = priceRange(quote, now);
		const stock = resolved.bundle.stock ?? this.stock(resolved, product.lowStockThreshold, now);
		const pageItem = async (item: ResolvedItem): Promise<CatalogPageBundleItem> => ({
			key: item.key,
			productId: item.productId,
			slug: item.slug,
			title: item.title,
			sku: item.sku,
			image: await image(item.product),
			mrpINR: item.mrpINR,
			sellingINR: item.sellingINR,
			saleINR: item.saleINR,
			priceInSetINR: item.priceInSetINR,
			todayINR: item.todayINR,
			quantity: item.quantity,
			soldBy: item.soldBy,
			inStock: item.live && item.capacity >= 1,
			available: item.available,
			variantId: item.variantId,
			variantLabel: item.variantLabel,
			variants: item.variants.map(({ id, label, inStock }) => ({ id, label, inStock })),
			freeWith: await this.freeWithPage(item.freeWith, image),
		});
		const levels = await Promise.all(
			resolved.levels.map(async (level) => ({
				code: level.code,
				label: localized(level.label),
				take: level.take,
				choice: level.items.length > level.take,
				priceMode: level.priceMode,
				items: await Promise.all(level.items.map(pageItem)),
			})),
		);
		const fromPrice = levels.some((level) => level.choice);
		return {
			heading: fromPrice ? 'choose' : 'components',
			priceINR: first.setPriceINR,
			separatelyINR: first.separatelyINR,
			saveINR: first.saveINR,
			fromPrice,
			lowINR: range.count ? range.low : first.totalINR,
			highINR: range.count ? range.high : first.totalINR,
			levels,
			extras: await Promise.all(resolved.extras.map(pageItem)),
			pricing: {
				base: quote.method.base,
				inputs: [...quote.method.inputs],
				methodRules: [...quote.method.rules],
				methodCombine: quote.method.combine,
				params: { ...quote.params },
				rules: [...quote.rules],
				combine: quote.combine,
				capAtSeparately: quote.capAtSeparately,
				roundTo: quote.roundTo,
				// toQuote always lists the running sale rules, empty when there are none.
				eventSale: [...(quote.eventSale as NonNullable<QuoteBundle['eventSale']>)],
			},
			stock: {
				setsPossible: stock.setsPossible,
				state: stock.state,
				soldOutPieces: stock.soldOutPieces,
				soldOutChoices: stock.soldOutChoices,
			},
			buyable: this.buyable(resolved, stock, product.status === 'live', now),
			saleWindow: resolved.bundle.saleWindow,
		};
	}
}
