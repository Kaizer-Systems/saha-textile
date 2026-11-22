import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	GoLiveResult,
	Product,
	ProductBundle,
	type ProductBundleWrite,
	ProductVariant,
	type MediaAsset,
	type ProductCreate,
} from '@saha-textile/contracts';
import {
	bundleChecks,
	goLiveGaps,
	productGallery,
	selectionHash,
	type MediaAssetRepository,
	type BundlePriceMethodRepository,
	type ProductBundleRepository,
	type ProductRepository,
	type ProductVariantRepository,
} from '@saha-textile/core-domain';

import { CatalogService } from './catalog.service';
import { LanguageStore } from '../languages/language-store';
import type { BundleReader } from './bundles/bundle-reader';
import {
	BUNDLE_PRICE_METHOD_REPOSITORY,
	BUNDLE_READER,
	MEDIA_ASSET_REPOSITORY,
	PRODUCT_BUNDLE_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
} from '../infra/tokens';

export const slugFrom = (title: string): string =>
	title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const BASE_SELECTION = [{ attributeCode: 'base', termCode: 'base' }];

export type BundleWrite = ProductBundleWrite;

/** Creating products, going live and bundles: the admin product builder. */
@Injectable()
export class ProductBuilderService {
	constructor(
		private readonly catalog: CatalogService,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		private readonly languages: LanguageStore,
		@Optional() @Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository | null = null,
		@Optional()
		@Inject(PRODUCT_BUNDLE_REPOSITORY)
		private readonly bundles: ProductBundleRepository | null = null,
		@Optional()
		@Inject(BUNDLE_PRICE_METHOD_REPOSITORY)
		private readonly methods: BundlePriceMethodRepository | null = null,
		@Optional() @Inject(BUNDLE_READER) private readonly reader: BundleReader | null = null,
	) {}

	/** A new product starts disabled with one base row. The form finishes it. */
	async create(asked: ProductCreate, actorUserId: string | null) {
		const slug = await this.freeSlug(slugFrom(asked.title.en));
		const id = `prd_${randomUUID()}`;
		// A bundle has no SKU of its own: a BND number for search (V2, approved 22 Nov 2026).
		const body =
			asked.type === 'bundle' ? { ...asked, sku: await this.nextBundleNumber(), basePriceINR: 0 } : asked;
		const product = Product.parse({
			id,
			type: body.type,
			sku: body.sku,
			title: body.title,
			slug,
			basePriceINR: body.basePriceINR,
			status: 'disabled',
		});
		const base = ProductVariant.parse({
			id: `var_${randomUUID()}`,
			productId: id,
			sku: body.sku,
			status: 'live',
			optionSelections: BASE_SELECTION,
			optionSelectionHash: selectionHash(BASE_SELECTION),
			isBaseVariant: true,
			priceINR: body.basePriceINR,
		});
		await this.products.save(product);
		await this.variants.save(base);
		await this.catalog.record(actorUserId, 'catalog.product.create', id, { sku: body.sku, type: body.type });
		return { id, slug };
	}

	/** The next free bundle number: BND-0001, BND-0002… */
	private async nextBundleNumber(): Promise<string> {
		const page = await this.products.list({
			audience: 'admin',
			type: 'bundle',
			page: 1,
			pageSize: 100,
			search: 'BND-',
		});
		const used = page.items.map((row) => Number(/^BND-(\d+)$/.exec(row.sku)?.[1] ?? 0));
		for (let next = Math.max(0, ...used) + 1; ; next += 1) {
			const sku = `BND-${String(next).padStart(4, '0')}`;
			if (
				!(await this.products.list({ audience: 'admin', search: sku, page: 1, pageSize: 1 })).items.some(
					(row) => row.sku === sku,
				)
			) {
				return sku;
			}
		}
	}

	/** The first free address from this base: `saree`, then `saree-2`, `saree-3`… */
	async freeSlug(base: string): Promise<string> {
		if (!base) throw new BadRequestException('A product needs an English name');
		for (let attempt = 1; ; attempt += 1) {
			const slug = attempt === 1 ? base : `${base}-${attempt}`;
			if (!(await this.products.findBySlug(slug, 'admin'))) return slug;
		}
	}

	/** The one check behind Go Live, whether pressed on the form or in the list. */
	async goLive(idOrSlug: string, actorUserId: string | null): Promise<GoLiveResult> {
		const product = await this.catalog.getProduct(idOrSlug, 'admin');
		if (product.status === 'discontinued') {
			throw new BadRequestException('A discontinued product cannot go live');
		}
		const gaps = [...(await this.gapsFor(product)), ...(await this.bundleGaps(product))];
		if (gaps.length) return GoLiveResult.parse({ live: false, gaps });
		if (product.status !== 'live') {
			const now = new Date().toISOString();
			const next: Product = {
				...product,
				status: 'live',
				lifecycle: { ...product.lifecycle, liveAt: product.lifecycle.liveAt ?? now },
			};
			await this.products.save(next);
			await this.catalog.syncSearch(next);
			await this.catalog.record(actorUserId, 'catalog.product.go-live', product.id, { sku: product.sku });
		}
		// The set follows its product onto the shop.
		if (product.type === 'bundle' && this.bundles) {
			const bundle = await this.bundles.findByProductId(product.id, 'admin');
			if (bundle && bundle.status !== 'live') await this.bundles.save({ ...bundle, status: 'live' });
		}
		return GoLiveResult.parse({ live: true, gaps: [] });
	}

	/** What stops a product going live, without changing it: the launch event's readiness check. */
	async gapsFor(product: Product): Promise<GoLiveResult['gaps']> {
		const rows = await this.variants.listForProduct(product.id, 'admin');
		const primary = productGallery(product)[0];
		const asset = primary ? await this.media?.findById(primary) : null;
		const gaps = goLiveGaps({
			product,
			variants: rows,
			locales: this.languages.shop(),
			assetAlt: () => assetAlt(asset),
			primaryRoles: asset ? asset.derivatives.map((row) => row.role) : null,
			faq: product.faqEnabled ? await this.catalog.productFaq(product.id) : [],
		});
		return gaps;
	}

	/**
	 * A bundle's own checks before Go Live (rev 1 S6/S7, rev 3 C09): levels and pieces, the price method's inputs, and
	 * a set that would cost more than its pieces. Each error is a gap named `bundle:<code>`.
	 */
	async bundleGaps(product: Product): Promise<GoLiveResult['gaps']> {
		if (product.type !== 'bundle' || !this.bundles || !this.reader) return [];
		const bundle = await this.bundles.findByProductId(product.id, 'admin');
		if (!bundle) return [{ field: 'bundle:no_levels', locale: null }];
		const resolved = await this.reader.resolve(bundle);
		const checkItem = (item: (typeof resolved.levels)[number]['items'][number]) => ({
			key: item.key,
			live: item.live,
			isBundle: item.isBundle,
			inStock: item.capacity >= 1,
		});
		const checks = bundleChecks({
			bundle: this.reader.toQuote(resolved),
			levels: resolved.levels.map((level) => ({
				code: level.code,
				take: level.take,
				items: level.items.map(checkItem),
			})),
			extras: resolved.extras.map(checkItem),
			methodActive: resolved.method?.active ?? false,
			dearerReason: bundle.dearerReason,
		});
		return checks
			.filter((check) => check.severity === 'error')
			.map((check) => ({ field: `bundle:${check.code}${check.level ? `:${check.level}` : ''}`, locale: null }));
	}

	async bundle(idOrSlug: string) {
		const product = await this.catalog.getProduct(idOrSlug, 'admin');
		return (await this.requireBundles().findByProductId(product.id, 'admin')) ?? null;
	}

	/**
	 * Saves the builder's Build and Price rules tabs (bundle builder brief, approved 2026-11-22). A bundle may not hold
	 * a bundle (DEC-BUNDLE-NESTING), every item must exist, and the price method must exist. The worked-out stock is
	 * saved with it, and the set follows its product's status.
	 */
	async saveBundle(idOrSlug: string, body: BundleWrite, actorUserId: string | null) {
		const bundles = this.requireBundles();
		const product = await this.catalog.getProduct(idOrSlug, 'admin');
		if (product.type !== 'bundle') throw new BadRequestException('Only a bundle product has a bundle');
		const itemIds = [
			...new Set([...body.levels.flatMap((level) => level.items), ...body.extras].map((item) => item.productId)),
		];
		for (const id of itemIds) {
			if (id === product.id) throw new BadRequestException('A bundle may not contain itself');
			if (await bundles.isBundleProduct(id)) throw new BadRequestException('A bundle may not contain a bundle');
			const target = await this.products.findById(id, 'admin');
			if (!target) throw new NotFoundException(`Product not found: ${id}`);
			if (target.type === 'bundle') throw new BadRequestException('A bundle may not contain a bundle');
		}
		if (this.methods && !(await this.methods.findById(body.pricing.methodId))) {
			throw new BadRequestException('Choose how the set is priced');
		}
		const existing = await bundles.findByProductId(product.id, 'admin');
		const next = ProductBundle.parse({
			...body,
			id: existing?.id ?? `bnd_${randomUUID()}`,
			productId: product.id,
			stock: null,
			status: product.status === 'live' ? 'live' : 'draft',
		});
		const stock = this.reader
			? this.reader.stock(await this.reader.resolve(next), product.lowStockThreshold)
			: null;
		const saved = await bundles.save({ ...next, stock });
		await this.catalog.record(actorUserId, 'catalog.bundle.save', product.id, {
			levels: body.levels.length,
			extras: body.extras.length,
			method: body.pricing.methodId,
		});
		return saved;
	}

	private requireBundles(): ProductBundleRepository {
		if (!this.bundles) throw new NotFoundException('Bundles are unavailable');
		return this.bundles;
	}
}

function assetAlt(asset: MediaAsset | null | undefined): Readonly<Record<string, string>> | null {
	return asset ? asset.text.alt : null;
}
