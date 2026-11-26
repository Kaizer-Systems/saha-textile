import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
	type DraftProductFromLine,
	Product,
	ProductVariant,
	type PurchaseImportRequest,
	type PurchaseImportResult,
	type PurchaseItemOption,
	type PurchaseItemSearchQuery,
} from '@saha-textile/contracts';
import {
	type CategoryRepository,
	type LastPurchaseFact,
	type ProductRepository,
	type ProductVariantRepository,
	type PurchaseEntryRepository,
	type SearchOutboxRepository,
	type StockItemFacts,
	type StockReadRepository,
	type SupplierItemCodeRepository,
	selectionHash,
} from '@saha-textile/core-domain';

import {
	CATEGORY_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	SEARCH_OUTBOX,
	STOCK_READ_REPOSITORY,
	SUPPLIER_ITEM_CODE_REPOSITORY,
} from '../infra/tokens';
import { PurchasingSupport, missing, refuse } from './purchasing-support';

const BASE_SELECTION = [{ attributeCode: 'base', termCode: 'base' }];

const slugFrom = (title: string): string =>
	title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** Why an item cannot take stock: a bundle has no stock of its own, a discontinued product none any more. */
export function blockedReason(
	facts: Pick<StockItemFacts, 'productType' | 'productStatus'>,
): 'bundle' | 'discontinued' | null {
	if (facts.productType === 'bundle') return 'bundle';
	if (facts.productStatus === 'discontinued') return 'discontinued';
	return null;
}

/**
 * The next SKU in a category (p05, `DEC-SKU`): the category's prefix is the one most of its
 * products already use ("ST-BAN-0412" → "ST-BAN-"), and the number counts on from the highest,
 * keeping its width. With no numbered SKUs yet the prefix is left for staff to type.
 */
export function nextSkuFor(skus: readonly string[]): { prefix: string; next: string } | null {
	const parsed = skus
		.map((sku) => /^(.*?)(\d+)$/.exec(sku))
		.filter((match): match is RegExpExecArray => Boolean(match && match[1]));
	if (parsed.length === 0) return null;
	const byPrefix = new Map<string, { count: number; max: number; width: number }>();
	for (const match of parsed) {
		// The filter kept only matches with a prefix, and the digits group always takes part in a match.
		const prefix = match[1] as string;
		const digits = match[2] as string;
		const entry = byPrefix.get(prefix) ?? { count: 0, max: 0, width: 0 };
		entry.count += 1;
		entry.max = Math.max(entry.max, Number(digits));
		entry.width = Math.max(entry.width, digits.length);
		byPrefix.set(prefix, entry);
	}
	// At least one SKU parsed, so at least one prefix was counted.
	const [prefix, best] = [...byPrefix.entries()].sort(
		(a, b) => b[1].count - a[1].count || b[1].max - a[1].max,
	)[0] as [string, { count: number; max: number; width: number }];
	return { prefix, next: String(best.max + 1).padStart(best.width, '0') };
}

/**
 * Finding items for purchase lines (p03, p04, p13) and making a draft product from a line (p05).
 */
@Injectable()
export class PurchaseItemsService {
	constructor(
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(SUPPLIER_ITEM_CODE_REPOSITORY) private readonly itemCodes: SupplierItemCodeRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		private readonly support: PurchasingSupport,
		@Inject(SEARCH_OUTBOX) private readonly searchOutbox: SearchOutboxRepository,
	) {}

	/** Item facts as purchase screens show them, with the last price paid and their own code. */
	async options(facts: readonly StockItemFacts[], supplierId: string | null): Promise<PurchaseItemOption[]> {
		if (facts.length === 0) return [];
		const ids = facts.map((fact) => fact.variantId);
		const [last, codes, images] = await Promise.all([
			this.entries.lastPurchases(ids, null),
			supplierId ? this.itemCodes.codesFor(supplierId, ids) : Promise.resolve(new Map<string, string>()),
			this.support.thumbnails(facts.map((fact) => fact.galleryAssetId)),
		]);
		return facts.map((fact) =>
			this.option(fact, last.get(fact.variantId) ?? null, codes.get(fact.variantId) ?? null, images),
		);
	}

	option(
		fact: StockItemFacts,
		last: LastPurchaseFact | null,
		code: string | null,
		images: ReadonlyMap<string, string>,
	): PurchaseItemOption {
		return {
			productId: fact.productId,
			variantId: fact.variantId,
			sku: fact.sku,
			title: fact.title['en'] ?? fact.sku,
			optionsLabel: fact.optionsLabel,
			imageUrl: fact.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
			soldBy: fact.soldBy,
			status: fact.productStatus,
			blocked: blockedReason(fact),
			disabled: fact.productStatus === 'disabled',
			hsnCode: fact.hsnCode,
			sellingPriceINR: fact.sellingPriceINR,
			mrpINR: fact.mrpINR,
			onHand: fact.onHand,
			lastCostINR: last?.unitPriceExGstINR ?? null,
			lastEntryNumber: last?.entryNumber ?? null,
			supplierItemCode: code,
			variantCount: fact.variantCount,
		};
	}

	/** p03: one box for SKU, name, barcode and the supplier's own code; a scanner types into it. */
	async search(query: PurchaseItemSearchQuery): Promise<PurchaseItemOption[]> {
		const supplierId = query.supplierId ?? null;
		const byCode = supplierId ? await this.itemCodes.findVariant(supplierId, query.q) : null;
		const found = await this.stock.search(query.q, query.limit);
		const facts = [...found];
		if (byCode && !facts.some((fact) => fact.variantId === byCode)) {
			const coded = (await this.stock.items([byCode])).get(byCode);
			if (coded) facts.unshift(coded);
		} else if (byCode) {
			facts.sort((a, b) => Number(b.variantId === byCode) - Number(a.variantId === byCode));
		}
		return this.options(facts.slice(0, query.limit), supplierId);
	}

	/** Lines that arrive as variant ids (an order's receive draft): the same details as a search result, in the order asked. */
	async byVariants(variantIds: readonly string[], supplierId: string | null): Promise<PurchaseItemOption[]> {
		const found = await this.stock.items(variantIds);
		const facts = variantIds
			.map((id) => found.get(id))
			.filter((fact): fact is StockItemFacts => fact !== undefined);
		return this.options(facts, supplierId);
	}

	/** p04: every colour (or colour × size) of a product, base row first. */
	async variantGrid(productId: string, supplierId: string | null): Promise<PurchaseItemOption[]> {
		const facts = await this.stock.variantsOfProduct(productId);
		if (facts.length === 0) throw missing('Product');
		return this.options(facts, supplierId);
	}

	/** p13: supplier spreadsheet rows matched by SKU or their code; only clean rows are ready. */
	async importRows(body: PurchaseImportRequest): Promise<PurchaseImportResult> {
		const codes = [...new Set(body.rows.map((row) => row.code.trim()).filter(Boolean))];
		const bySku = await this.stock.bySku(codes);
		const byTheirCode = new Map<string, string>();
		await Promise.all(
			codes
				.filter((code) => !bySku.has(code))
				.map(async (code) => {
					const variantId = await this.itemCodes.findVariant(body.supplierId, code);
					if (variantId) byTheirCode.set(code, variantId);
				}),
		);
		const coded = await this.stock.items([...byTheirCode.values()]);
		const factFor = (code: string) => bySku.get(code) ?? coded.get(byTheirCode.get(code) ?? '') ?? null;
		const facts = codes.map(factFor).filter((fact): fact is StockItemFacts => Boolean(fact));
		const options = new Map(
			(await this.options(facts, body.supplierId)).map((option) => [option.variantId, option]),
		);

		const pricesSeen = new Map<string, Set<number>>();
		for (const row of body.rows) {
			const fact = factFor(row.code.trim());
			if (!fact) continue;
			const set = pricesSeen.get(fact.variantId) ?? new Set<number>();
			set.add(row.unitPriceINR);
			pricesSeen.set(fact.variantId, set);
		}

		const rows = body.rows.map((row) => {
			const fact = factFor(row.code.trim());
			// Every fact found for a row's code was turned into an option above.
			const match = fact ? (options.get(fact.variantId) as PurchaseItemOption) : null;
			const units = fact?.soldBy === 'metre' ? row.quantity * 10 : row.quantity;
			let problem: PurchaseImportResult['rows'][number]['problem'] = null;
			if (!(row.quantity >= (fact?.soldBy === 'metre' ? 0.1 : 1)) || Math.abs(units - Math.round(units)) > 1e-9)
				problem = 'quantity_below_one';
			else if (!Number.isFinite(row.unitPriceINR) || row.unitPriceINR < 0) problem = 'price_invalid';
			else if (fact && blockedReason(fact)) problem = 'blocked_product';
			// Every row with a fact put its price in pricesSeen above.
			else if (fact && (pricesSeen.get(fact.variantId) as Set<number>).size > 1)
				problem = 'repeated_at_other_price';
			const result: 'ready' | 'needs_product' | 'problem' = problem
				? 'problem'
				: match
					? 'ready'
					: 'needs_product';
			return {
				row: row.row,
				code: row.code,
				result,
				problem,
				match,
				quantity: fact?.soldBy === 'metre' ? Math.round(units) : row.quantity,
				unitPriceINR: row.unitPriceINR,
				hsn: row.hsn,
				gstRatePct: row.gstRatePct,
			};
		});
		return {
			rows,
			counts: {
				ready: rows.filter((row) => row.result === 'ready').length,
				needsProduct: rows.filter((row) => row.result === 'needs_product').length,
				problems: rows.filter((row) => row.result === 'problem').length,
			},
		};
	}

	/** p05: the SKU a draft product in this category would get, and the HSN and returnability it inherits. */
	async draftProductDefaults(categoryId: string) {
		const category = await this.categories.findById(categoryId);
		if (!category) throw missing('Category');
		const suggestion = nextSkuFor(await this.stock.productSkusInCategory(categoryId));
		return {
			categoryId,
			hsnCode: category.hsnCode,
			returnable: category.returnable,
			skuPrefix: suggestion?.prefix ?? null,
			skuNext: suggestion?.next ?? null,
		};
	}

	private async freeSlug(name: string): Promise<string> {
		const base = slugFrom(name) || 'product';
		for (let attempt = 1; ; attempt += 1) {
			const slug = attempt === 1 ? base : `${base}-${attempt}`;
			if (!(await this.products.findBySlug(slug, 'admin'))) return slug;
		}
	}

	/**
	 * p05: a new design from the bill becomes a DRAFT product with one row, the category's HSN and
	 * returnability, and the next SKU for the category's prefix. Photos, descriptions, every
	 * language and Go Live happen in the product form as usual.
	 */
	async createDraftProduct(body: DraftProductFromLine, actor: string | null) {
		const defaults = await this.draftProductDefaults(body.categoryId);
		if (body.mrpINR !== null && body.mrpINR < body.sellingPriceINR) {
			throw refuse('mrp_below_selling', 'The MRP cannot be lower than the selling price.', 'mrpINR');
		}
		const prefix = (body.skuPrefix ?? defaults.skuPrefix ?? '').trim().toUpperCase();
		if (!prefix) throw refuse('sku_prefix_required', 'This category has no SKU prefix yet: type one.', 'skuPrefix');
		const skus = await this.stock.productSkusInCategory(body.categoryId);
		const ownWidth = nextSkuFor(skus.filter((sku) => sku.startsWith(prefix)));
		let number = Number(ownWidth?.next ?? '1');
		const width = ownWidth?.next.length ?? 4;
		let sku = '';
		for (let attempt = 0; attempt < 50; attempt += 1, number += 1) {
			const candidate = `${prefix}${String(number).padStart(width, '0')}`;
			if (!(await this.variants.findBySku(candidate, 'admin'))) {
				sku = candidate;
				break;
			}
		}
		if (!sku) throw refuse('sku_unavailable', `No free SKU found after ${prefix}${number}.`, 'skuPrefix');

		const id = `prd_${randomUUID()}`;
		const discounted = body.mrpINR !== null && body.sellingPriceINR < body.mrpINR;
		const product = Product.parse({
			id,
			type: 'simple',
			sku,
			title: { en: body.name },
			slug: await this.freeSlug(body.name),
			basePriceINR: body.sellingPriceINR,
			status: 'draft',
			categoryIds: [body.categoryId],
			hsnCode: defaults.hsnCode,
			soldBy: body.soldBy,
			returnable: null,
		});
		const base = ProductVariant.parse({
			id: `var_${randomUUID()}`,
			productId: id,
			sku,
			status: 'live',
			optionSelections: BASE_SELECTION,
			optionSelectionHash: selectionHash(BASE_SELECTION),
			isBaseVariant: true,
			priceINR: body.mrpINR ?? body.sellingPriceINR,
			compareAtPriceINR: body.mrpINR,
			salePriceINR: discounted ? body.sellingPriceINR : null,
		});
		await this.products.save(product);
		await this.variants.save(base);
		if (body.supplierId && body.supplierItemCode) {
			await this.itemCodes.remember(body.supplierId, body.supplierItemCode, base.id);
		}
		await this.searchOutbox.request([id], new Date()).catch(() => undefined);
		await this.support.record({
			actor,
			action: 'catalog.product.create',
			entityType: 'product',
			entityId: id,
			text: `${await this.support.nameOf(actor)} made draft product ${sku} "${body.name}" from a supplier bill (HSN ${defaults.hsnCode ?? 'not set'} from the category).`,
			facts: { sku, from: 'purchase_entry' },
		});
		const [fact] = await this.stock.variantsOfProduct(id);
		if (!fact) throw missing('Product');
		const [option] = await this.options([fact], body.supplierId ?? null);
		return option;
	}
}
