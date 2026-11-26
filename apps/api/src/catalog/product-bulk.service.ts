import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	Product,
	ProductBundle,
	ProductBulkResult,
	ProductVariant,
	type ProductBulkDiscontinueWrite,
	type ProductBulkReason,
	type ProductBulkRow,
	type ProductBulkWrite,
} from '@saha-textile/contracts';
import type {
	ProductBundleRepository,
	ProductDraftRepository,
	ProductRepository,
	ProductVariantRepository,
	ShopEventRepository,
} from '@saha-textile/core-domain';

import {
	PRODUCT_BUNDLE_REPOSITORY,
	PRODUCT_DRAFT_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	SHOP_EVENT_REPOSITORY,
} from '../infra/tokens';
import { CatalogService } from './catalog.service';
import { ProductBuilderService, slugFrom } from './product-builder.service';

/** How a copy's name starts or ends, per language; other languages use English's. */
const COPY_TITLE: Readonly<Record<string, (text: string) => string>> = {
	en: (text) => `Copy of ${text}`,
	bn: (text) => `${text} (কপি)`,
};

const copyTitle = (locale: string, text: string): string =>
	text.trim() ? (COPY_TITLE[locale] ?? (COPY_TITLE['en'] as (text: string) => string))(text) : text;

/**
 * The product list's bulk actions (product bulk actions brief, approved 2026-11-19): Go Live, Take
 * off shop, Discontinue, Duplicate and Delete for up to 200 products. Each product is done on its
 * own: one failing never stops the others, and the answer says, per product, what happened and why.
 * A dry run answers the same way and changes nothing. Every change is in the activity log.
 */
@Injectable()
export class ProductBulkService {
	private readonly logger = new Logger(ProductBulkService.name);

	constructor(
		private readonly catalog: CatalogService,
		private readonly builder: ProductBuilderService,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Optional()
		@Inject(PRODUCT_BUNDLE_REPOSITORY)
		private readonly bundles: ProductBundleRepository | null = null,
		@Optional() @Inject(SHOP_EVENT_REPOSITORY) private readonly events: ShopEventRepository | null = null,
		@Optional() @Inject(PRODUCT_DRAFT_REPOSITORY) private readonly drafts: ProductDraftRepository | null = null,
	) {}

	/** Go Live: the same check as the form's Go Live, per product. */
	goLive(body: ProductBulkWrite, actor: string | null): Promise<ProductBulkResult> {
		return this.each(body, async (product) => {
			if (product.status === 'discontinued') return row(product, 'refused', 'discontinued');
			if (product.status === 'live') return row(product, 'skipped', 'already_live');
			const gaps = await this.builder.gapsFor(product);
			if (gaps.length) return { ...row(product, 'refused', 'needs_work'), gaps };
			if (body.dryRun) return row(product, 'done');
			const result = await this.builder.goLive(product.id, actor);
			return result.live ? row(product, 'done') : { ...row(product, 'refused', 'needs_work'), gaps: result.gaps };
		});
	}

	/** Take off shop: live products only; the rest are left as they are. */
	takeOff(body: ProductBulkWrite, actor: string | null): Promise<ProductBulkResult> {
		return this.each(body, async (product) => {
			if (product.status === 'discontinued') return row(product, 'skipped', 'discontinued');
			if (product.status !== 'live') return row(product, 'skipped', 'not_live');
			if (!body.dryRun) await this.catalog.takeOff(product, actor);
			return row(product, 'done');
		});
	}

	/**
	 * Discontinue, which cannot be undone: every product's old links show "gone", or all point to one
	 * live product or collection that is not among them.
	 */
	async discontinue(body: ProductBulkDiscontinueWrite, actor: string | null): Promise<ProductBulkResult> {
		const target = body.replacementPath?.match(/^\/product\/([a-z0-9-]+)$/)?.[1] ?? null;
		const batch = target ? await this.loaded(body.ids) : [];
		const inBatch = !!target && batch.some((product) => product.slug === target);
		return this.each(body, async (product) => {
			if (product.status === 'discontinued') return row(product, 'skipped', 'discontinued');
			if (inBatch) return row(product, 'refused', 'replacement_in_batch');
			if (body.replacementPath) await this.catalog.liveReplacement(body.replacementPath, product.slug);
			if (!body.dryRun) await this.catalog.discontinue(product.id, body.replacementPath, actor);
			return row(product, 'done');
		});
	}

	/**
	 * Duplicate: each copy is a product that is not live yet, called "Copy of …" in every language,
	 * with the same photos, prices, options, categories, questions and offered products. Its codes
	 * end in `-C1` (or the next free number), it has no stock and is in no sale.
	 */
	duplicate(body: ProductBulkWrite, actor: string | null): Promise<ProductBulkResult> {
		return this.each(body, async (product) => {
			if (product.status === 'discontinued') return row(product, 'refused', 'discontinued');
			const rows = await this.variants.listForProduct(product.id, 'admin');
			const suffix = await this.freeSuffix(product, rows);
			if (body.dryRun) return { ...row(product, 'done'), copySku: `${product.sku}${suffix}` };
			const copy = await this.copy(product, rows, suffix, actor);
			return { ...row(product, 'done'), copyId: copy.id, copySku: copy.sku };
		});
	}

	/**
	 * Delete, kept for the exceptional case (Q1 = A): only a product that has never been live, held
	 * stock or been ordered, and that no launch or sale still names. Anything else is discontinued.
	 */
	async delete(body: ProductBulkWrite, actor: string | null): Promise<ProductBulkResult> {
		const named = await this.namedInEvents();
		return this.each(body, async (product) => {
			if (product.status === 'live' || product.lifecycle.liveAt !== null) {
				return row(product, 'refused', 'was_live');
			}
			const facts = await this.catalog.deletionFacts(product);
			if (facts.hasOrders) return row(product, 'refused', 'has_orders');
			if (facts.hasStock || facts.hasMovements) return row(product, 'refused', 'has_stock');
			if (named.has(product.id)) return row(product, 'refused', 'in_event');
			if (body.dryRun) return row(product, 'done');
			await this.catalog.removeNeverLive(product, actor);
			await this.drafts?.removeForProduct(product.id);
			return row(product, 'done');
		});
	}

	private async each(
		body: ProductBulkWrite,
		work: (product: Product) => Promise<ProductBulkRow>,
	): Promise<ProductBulkResult> {
		const rows: ProductBulkRow[] = [];
		for (const id of body.ids) {
			const product = await this.products.findById(id, 'admin');
			if (!product) {
				rows.push({ ...blank(id, ''), outcome: 'refused', reason: 'not_found' });
				continue;
			}
			try {
				rows.push(await work(product));
			} catch (error) {
				// The refusal stays generic: the cause goes to the log, never to the screen.
				this.logger.warn(
					`Bulk action refused ${product.id}: ${error instanceof Error ? error.message : 'error'}`,
				);
				rows.push(row(product, 'refused', 'failed'));
			}
		}
		return ProductBulkResult.parse({ dryRun: body.dryRun, rows });
	}

	private async loaded(ids: readonly string[]): Promise<Product[]> {
		const found = await Promise.all(ids.map((id) => this.products.findById(id, 'admin')));
		return found.filter((product): product is Product => !!product);
	}

	/** Products a draft, scheduled or running launch or sale names by itself. */
	private async namedInEvents(): Promise<Set<string>> {
		if (!this.events) return new Set();
		const drafts = await this.events.list({ status: 'draft', page: 1, pageSize: 1_000 });
		const open = [...(await this.events.listPublished()), ...drafts.items];
		return new Set(
			open.flatMap((event) => [
				...event.launch.productIds,
				...event.launch.heldProductIds,
				...event.sale.products.map((line) => line.productId),
				...event.sale.categories.flatMap((line) => line.exceptions.map((exception) => exception.productId)),
			]),
		);
	}

	/** `-C1`, or the first `-C<n>` that gives the product and every row a free code. */
	private async freeSuffix(product: Product, rows: readonly ProductVariant[]): Promise<string> {
		const codes = [...new Set([product.sku, ...rows.map((variant) => variant.sku)])];
		for (let n = 1; n < 100; n += 1) {
			const suffix = `-C${n}`;
			const taken = await Promise.all(codes.map((code) => this.variants.findBySku(`${code}${suffix}`, 'admin')));
			if (taken.every((found) => !found)) return suffix;
		}
		throw new Error('No free copy code');
	}

	private async copy(
		product: Product,
		rows: readonly ProductVariant[],
		suffix: string,
		actor: string | null,
	): Promise<Product> {
		const id = `prd_${randomUUID()}`;
		const title = Object.fromEntries(
			Object.entries(product.title).map(([locale, text]) => [locale, copyTitle(locale, text)]),
		);
		// Every product has an English title, so its copy has one too.
		const slug = await this.builder.freeSlug(slugFrom(title['en'] as string));
		const {
			createdAt: _created,
			updatedAt: _updated,
			ratingsSummary: _ratings,
			lifecycle: _lifecycle,
			...kept
		} = product;
		const copy = Product.parse({
			...kept,
			id,
			sku: `${product.sku}${suffix}`,
			slug,
			title,
			status: 'disabled',
			insightBadges: [],
			backInStockAt: null,
			lifetimeUnitsReceived: 0,
			onSale: false,
			replacementTarget: null,
		});
		const variants = rows.map((variant) => {
			const { createdAt: _rowCreated, updatedAt: _rowUpdated, ...rest } = variant;
			return ProductVariant.parse({
				...rest,
				id: `var_${randomUUID()}`,
				productId: id,
				sku: `${variant.sku}${suffix}`,
				// A barcode names one physical item, so the copy starts without one.
				barcode: null,
				stock: { ...variant.stock, quantity: 0, held: 0 },
			});
		});
		await this.catalog.inTransaction(async () => {
			await this.products.save(copy);
			for (const variant of variants) await this.variants.save(variant);
		});
		await this.catalog.copyExtras(product.id, id);
		if (product.type === 'bundle' && this.bundles) {
			const bundle = await this.bundles.findByProductId(product.id, 'admin');
			if (bundle) {
				await this.bundles.save(
					ProductBundle.parse({ ...bundle, id: `bnd_${randomUUID()}`, productId: id, status: 'draft' }),
				);
			}
		}
		await this.catalog.record(actor, 'catalog.product.duplicate', id, { from: product.id, sku: copy.sku });
		return copy;
	}
}

const blank = (id: string, title: string): ProductBulkRow => ({
	id,
	title,
	outcome: 'done',
	reason: null,
	gaps: [],
	copyId: null,
	copySku: null,
});

const row = (
	product: Product,
	outcome: ProductBulkRow['outcome'],
	reason: ProductBulkReason | null = null,
): ProductBulkRow => ({ ...blank(product.id, product.title['en'] || product.sku), outcome, reason });
