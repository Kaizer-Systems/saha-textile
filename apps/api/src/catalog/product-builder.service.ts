import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	GoLiveResult,
	Product,
	ProductBundle,
	ProductVariant,
	type MediaAsset,
	type ProductCreate,
} from '@saha-textile/contracts';
import {
	goLiveGaps,
	productGallery,
	selectionHash,
	type MediaAssetRepository,
	type ProductBundleRepository,
	type ProductRepository,
	type ProductVariantRepository,
} from '@saha-textile/core-domain';

import { CatalogService } from './catalog.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	MEDIA_ASSET_REPOSITORY,
	PRODUCT_BUNDLE_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
} from '../infra/tokens';

const slugFrom = (title: string): string =>
	title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const BASE_SELECTION = [{ attributeCode: 'base', termCode: 'base' }];

export type BundleWrite = Pick<ProductBundle, 'bundleType' | 'pricePolicy' | 'fixedPriceINR' | 'groups'>;

/** Creating products, going live and bundles: the admin product builder. */
@Injectable()
export class ProductBuilderService {
	constructor(
		private readonly catalog: CatalogService,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Optional() @Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository | null = null,
		@Optional()
		@Inject(PRODUCT_BUNDLE_REPOSITORY)
		private readonly bundles: ProductBundleRepository | null = null,
	) {}

	/** A new product starts disabled with one base row. The form finishes it. */
	async create(body: ProductCreate, actorUserId: string | null) {
		const slug = await this.freeSlug(slugFrom(body.title.en));
		const id = `prd_${randomUUID()}`;
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

	private async freeSlug(base: string): Promise<string> {
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
		const rows = await this.variants.listForProduct(product.id, 'admin');
		const primary = productGallery(product)[0];
		const asset = primary ? await this.media?.findById(primary) : null;
		const gaps = goLiveGaps({
			product,
			variants: rows,
			locales: this.config.locales,
			assetAlt: () => assetAlt(asset),
			primaryRoles: asset ? asset.derivatives.map((row) => row.role) : null,
		});
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
		return GoLiveResult.parse({ live: true, gaps: [] });
	}

	async bundle(idOrSlug: string) {
		const product = await this.catalog.getProduct(idOrSlug, 'admin');
		return (await this.requireBundles().findByProductId(product.id, 'admin')) ?? null;
	}

	/** A bundle may not hold a bundle. Checkout resolves one level into real lines. */
	async saveBundle(idOrSlug: string, body: BundleWrite, actorUserId: string | null) {
		const bundles = this.requireBundles();
		const product = await this.catalog.getProduct(idOrSlug, 'admin');
		if (product.type !== 'bundle') throw new BadRequestException('Only a bundle product has a bundle');
		const componentIds = body.groups.flatMap((group) => group.components.map((component) => component.productId));
		for (const id of componentIds) {
			if (await bundles.isBundleProduct(id)) throw new BadRequestException('A bundle may not contain a bundle');
			if (!(await this.products.findById(id, 'admin'))) throw new NotFoundException(`Product not found: ${id}`);
		}
		const existing = await bundles.findByProductId(product.id, 'admin');
		const saved = await bundles.save(
			ProductBundle.parse({
				...body,
				id: existing?.id ?? `bnd_${randomUUID()}`,
				productId: product.id,
				status: existing?.status ?? 'draft',
			}),
		);
		await this.catalog.record(actorUserId, 'catalog.bundle.save', product.id, { groups: body.groups.length });
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
