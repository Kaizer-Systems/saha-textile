import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	BundleBuilderView,
	BundleDraftResponse,
	BundlePriceMethod,
	ProductBundle,
	type BundleCheckView,
	type BundleDetailsWrite,
	type BundlePriceMethodRow,
	type BundlePriceMethodWrite,
	type Product,
	type ProductBundleWrite,
} from '@saha-textile/contracts';
import {
	bundleChecks,
	productGallery,
	type BundlePriceMethodRepository,
	type ProductBundleRepository,
	type ProductRepository,
	type ShopEventRepository,
} from '@saha-textile/core-domain';

import {
	BUNDLE_PRICE_METHOD_REPOSITORY,
	BUNDLE_READER,
	PRODUCT_BUNDLE_REPOSITORY,
	PRODUCT_REPOSITORY,
	SHOP_EVENT_REPOSITORY,
} from '../../infra/tokens';
import { CatalogService } from '../catalog.service';
import type { BundleReader, ResolvedBundle, ResolvedItem } from './bundle-reader';

/**
 * The bundle builder (bundle builder brief, approved 2026-11-22; V1 option 1). Reads the builder's page, works a
 * draft out without saving (the live preview), saves the Details, SEO, FAQ and Status tabs, and keeps the price
 * method list (owner: methods are records made in a builder, never built into the code).
 */
@Injectable()
export class BundleAdminService {
	constructor(
		private readonly catalog: CatalogService,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_BUNDLE_REPOSITORY) private readonly bundles: ProductBundleRepository,
		@Inject(BUNDLE_PRICE_METHOD_REPOSITORY) private readonly methods: BundlePriceMethodRepository,
		@Inject(BUNDLE_READER) private readonly reader: BundleReader,
		@Optional() @Inject(SHOP_EVENT_REPOSITORY) private readonly events: ShopEventRepository | null = null,
	) {}

	private async bundleProduct(idOrSlug: string): Promise<Product> {
		const product = await this.catalog.getProduct(idOrSlug, 'admin');
		if (product.type !== 'bundle') throw new BadRequestException('Only a bundle opens in the bundle builder');
		return product;
	}

	/** A new bundle starts with no levels and the first active method, so the builder opens on "Add level". */
	private async blank(product: Product): Promise<ProductBundle> {
		const method = (await this.methods.list()).find((row) => row.active);
		return ProductBundle.parse({
			id: `bnd_${randomUUID()}`,
			productId: product.id,
			levels: [],
			pricing: { methodId: method?.id ?? 'bpm_pieces_added_up', params: defaultsOf(method) },
			status: 'draft',
		});
	}

	async view(idOrSlug: string): Promise<BundleBuilderView> {
		const product = await this.bundleProduct(idOrSlug);
		const bundle = (await this.bundles.findByProductId(product.id, 'admin')) ?? null;
		const worked = await this.workOut(product, bundle ?? (await this.blank(product)));
		return BundleBuilderView.parse({
			product: {
				id: product.id,
				slug: product.slug,
				sku: product.sku,
				status: product.status,
				published: product.status === 'live' || product.lifecycle.liveAt !== null,
				showOnShop: product.showOnShop !== false,
				featured: product.featured,
				title: product.title,
				shortDescription: product.shortDescription,
				description: product.description ?? {},
				categoryIds: product.categoryIds,
				tags: product.tags,
				seo: { title: product.seo?.title ?? {}, description: product.seo?.description ?? {} },
				faqEnabled: product.faqEnabled,
				faq: (await this.catalog.productFaq(product.id)).map((entry) => ({
					id: entry.id,
					question: entry.question,
					answer: entry.answer,
				})),
				lowStockThreshold: product.lowStockThreshold,
			},
			bundle,
			methods: await this.methodRows(),
			...worked,
		});
	}

	/** The live preview: the builder's tabs worked out as the shop would draw them, nothing saved. */
	async draft(idOrSlug: string, body: ProductBundleWrite): Promise<BundleDraftResponse> {
		const product = await this.bundleProduct(idOrSlug);
		const existing = await this.bundles.findByProductId(product.id, 'admin');
		const draft = ProductBundle.parse({
			...body,
			id: existing?.id ?? 'draft',
			productId: product.id,
			stock: null,
			status: product.status === 'live' ? 'live' : 'draft',
		});
		return BundleDraftResponse.parse(await this.workOut(product, draft));
	}

	private async workOut(product: Product, bundle: ProductBundle) {
		const resolved = await this.reader.resolve(bundle);
		const items = [...resolved.levels.flatMap((level) => level.items), ...resolved.extras];
		const thumbnails = await this.catalog.thumbnailsFor(items.flatMap((item) => item.imageAssetId ?? []));
		const saleNames = await this.saleNames(items);
		const stock = this.reader.stock(resolved, product.lowStockThreshold);
		// The preview draws each piece's card-size photo, as the product page does.
		const cardOf = async (target: Product) => {
			const assetId = productGallery(target)[0];
			const url = assetId ? thumbnails.get(assetId) : null;
			return assetId && url
				? {
						assetId,
						width: 400,
						height: 533,
						alt: '',
						dominantColor: null,
						thumbHash: null,
						roles: { card: [{ url, width: 400, height: 533, format: 'image/webp' as const }] },
					}
				: null;
		};
		const page = await this.reader.page(resolved, { ...product, status: 'live' }, cardOf);
		return {
			items: dedupe(items).map((item) => ({
				key: item.key,
				productId: item.productId,
				title: item.title,
				sku: item.sku,
				imageUrl: item.imageAssetId ? (thumbnails.get(item.imageAssetId) ?? null) : null,
				mrpINR: item.mrpINR,
				sellingINR: item.sellingINR,
				saleINR: item.saleINR,
				saleName: item.saleEventId ? (saleNames.get(item.saleEventId) ?? null) : null,
				saleEndsAt: item.saleEndsAt,
				priceInSetINR: item.priceInSetINR,
				overridden: item.overridden,
				available: item.available,
				live: item.live,
				shown: item.shown,
				isBundle: item.isBundle,
				soldBy: item.soldBy,
				variants: item.variants.map(({ id, label }) => ({ id, label })),
				freeItems: item.freeWith?.items.length ?? 0,
			})),
			checks: this.checks(resolved, bundle),
			page,
			stock,
			photos: this.photosOf(resolved, thumbnails),
		};
	}

	private checks(resolved: ResolvedBundle, bundle: ProductBundle): BundleCheckView[] {
		const item = (row: ResolvedItem) => ({
			key: row.key,
			live: row.live,
			isBundle: row.isBundle,
			inStock: row.capacity >= 1,
		});
		return bundleChecks({
			bundle: this.reader.toQuote(resolved),
			levels: resolved.levels.map((level) => ({
				code: level.code,
				take: level.take,
				items: level.items.map(item),
			})),
			extras: resolved.extras.map(item),
			methodActive: resolved.method?.active ?? false,
			dearerReason: bundle.dearerReason,
		}).map((check) => ({
			severity: check.severity,
			code: check.code,
			level: check.level ?? null,
			key: check.key ?? null,
			input: check.input ?? null,
			totalINR: check.totalINR ?? null,
			separatelyINR: check.separatelyINR ?? null,
		}));
	}

	/** The styled photo first, then each level's included pieces' main photos, in level order (A5). */
	private photosOf(resolved: ResolvedBundle, thumbnails: ReadonlyMap<string, string | null>) {
		const out: Array<{ assetId: string; url: string; fromKey: string | null }> = [];
		const styled = resolved.bundle.styledPhoto?.assetId;
		if (styled) out.push({ assetId: styled, url: thumbnails.get(styled) ?? '', fromKey: null });
		for (const level of resolved.levels) {
			for (const item of level.items.slice(0, level.take)) {
				if (!item.imageAssetId || out.some((row) => row.assetId === item.imageAssetId)) continue;
				out.push({
					assetId: item.imageAssetId,
					url: thumbnails.get(item.imageAssetId) ?? '',
					fromKey: item.key,
				});
			}
		}
		return out;
	}

	/** The gallery a saved bundle's product shows: its photos, linked from the pieces (A5, A08). */
	async syncPhotos(productId: string): Promise<void> {
		const product = await this.products.findById(productId, 'admin');
		const bundle = await this.bundles.findByProductId(productId, 'admin');
		if (!product || !bundle) return;
		const resolved = await this.reader.resolve(bundle);
		const gallery = this.photosOf(resolved, new Map()).map((row) => row.assetId);
		if (gallery.join() === productGallery(product).join()) return;
		await this.products.save({ ...product, imageMode: 'simple', media: { ...product.media, gallery } });
	}

	private async saleNames(items: readonly ResolvedItem[]): Promise<Map<string, string>> {
		const ids = [...new Set(items.flatMap((item) => item.saleEventId ?? []))];
		const out = new Map<string, string>();
		for (const id of ids) {
			const event = await this.events?.findById(id);
			if (event) out.set(id, event.name);
		}
		return out;
	}

	/** Details, SEO, FAQ's and Status: no HSN, tax, stock, weight or variations for a bundle (V2). */
	async saveDetails(idOrSlug: string, body: BundleDetailsWrite, actor: string | null) {
		const product = await this.bundleProduct(idOrSlug);
		if (!body.title['en']?.trim()) throw new BadRequestException('A bundle needs an English name');
		const next: Product = {
			...product,
			title: { ...product.title, ...body.title, en: body.title['en'].trim() },
			shortDescription: body.shortDescription,
			description: { en: body.description['en'] ?? '', ...body.description },
			categoryIds: body.categoryIds,
			tags: body.tags,
			seo: { ...(product.seo ?? {}), title: body.seo.title, description: body.seo.description } as Product['seo'],
			faqEnabled: body.faqEnabled,
			featured: body.featured,
			showOnShop: body.showOnShop,
			lowStockThreshold: body.lowStockThreshold,
		};
		await this.products.save(next);
		await this.catalog.saveProductFaq(product.id, body.faq);
		await this.catalog.syncSearch(next);
		await this.catalog.record(actor, 'catalog.bundle.details', product.id, { showOnShop: body.showOnShop });
		return { id: product.id, slug: next.slug };
	}

	// --- Products › Bundle price methods -------------------------------------------------------------

	async methodRows(): Promise<BundlePriceMethodRow[]> {
		const rows = await this.methods.list();
		return Promise.all(rows.map(async (row) => ({ ...row, usedBy: await this.bundles.countUsingMethod(row.id) })));
	}

	async method(id: string): Promise<BundlePriceMethodRow> {
		const row = await this.methods.findById(id);
		if (!row) throw new NotFoundException('No such price method');
		return { ...row, usedBy: await this.bundles.countUsingMethod(row.id) };
	}

	async createMethod(body: BundlePriceMethodWrite, actor: string | null): Promise<BundlePriceMethod> {
		if (await this.methods.findByCode(body.code)) throw new ConflictException('That code is already used');
		this.checkMethod(body);
		const saved = await this.methods.save(
			BundlePriceMethod.parse({ ...body, id: `bpm_${randomUUID().slice(0, 8)}`, seeded: false, version: 1 }),
		);
		await this.catalog.record(actor, 'catalog.bundle-method.create', saved.id, { code: saved.code });
		return saved;
	}

	async updateMethod(id: string, body: BundlePriceMethodWrite, actor: string | null): Promise<BundlePriceMethod> {
		const current = await this.methods.findById(id);
		if (!current) throw new NotFoundException('No such price method');
		const clash = await this.methods.findByCode(body.code);
		if (clash && clash.id !== id) throw new ConflictException('That code is already used');
		this.checkMethod(body);
		const saved = await this.methods.save(
			BundlePriceMethod.parse({
				...body,
				id,
				seeded: current.seeded,
				version: current.version + 1,
				createdAt: current.createdAt,
			}),
		);
		await this.catalog.record(actor, 'catalog.bundle-method.update', id, { version: saved.version });
		return saved;
	}

	/** A method still pricing a bundle can't be removed; switch it off instead. */
	async deleteMethod(id: string, actor: string | null): Promise<void> {
		const current = await this.methods.findById(id);
		if (!current) throw new NotFoundException('No such price method');
		const used = await this.bundles.countUsingMethod(id);
		if (used > 0)
			throw new ConflictException(
				`This method prices ${used} bundle${used === 1 ? '' : 's'}: switch it off instead`,
			);
		await this.methods.deleteById(id);
		await this.catalog.record(actor, 'catalog.bundle-method.delete', id, { code: current.code });
	}

	/** A fixed base must name one of the method's own inputs, and every rule amount an input it has. */
	private checkMethod(body: BundlePriceMethodWrite): void {
		const inputs = new Set(body.inputs.map((input) => input.code));
		if (body.base.kind === 'fixed' && !inputs.has(body.base.input)) {
			throw new BadRequestException('The set price must be one of the numbers the method asks for');
		}
		for (const rule of body.rules) {
			for (const action of [...rule.then, ...rule.otherwise]) {
				const amount = action.amount;
				if (amount && typeof amount === 'object' && !inputs.has(amount.input)) {
					throw new BadRequestException(`A rule uses "${amount.input}", which the method does not ask for`);
				}
			}
		}
	}
}

const dedupe = (items: readonly ResolvedItem[]): ResolvedItem[] => {
	const seen = new Set<string>();
	return items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
};

function defaultsOf(method: BundlePriceMethod | undefined): Record<string, number> {
	return Object.fromEntries(
		(method?.inputs ?? []).flatMap((input) => (input.default === null ? [] : [[input.code, input.default]])),
	);
}
