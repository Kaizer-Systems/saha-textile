import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
	ProductSaleResult,
	ShopEvent,
	ShopEventWrite,
	type Product,
	type ProductSaleRow,
	type ProductSaleWrite,
	type ShopEventPriceRow,
} from '@saha-textile/contracts';
import { saleRuleProblem, type ProductRepository, type ProductVariantRepository } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CatalogService } from '../catalog/catalog.service';
import { PRODUCT_REPOSITORY, PRODUCT_VARIANT_REPOSITORY } from '../infra/tokens';
import { EventCatalog } from './event-catalog';
import { EventsAdminService } from './events-admin.service';

/** Sales that can still take products: not ended, not cancelled. */
const OPEN = new Set<ShopEvent['status']>(['draft', 'scheduled', 'live']);

/**
 * "Put on sale" from the product list (product bulk actions brief § 4, approved 2026-11-19; Q2 = A:
 * a discount is always a timed sale). The products join a sale from Events as lines of their own, so
 * they get everything sales already do. A product already in another sale over the same time is left
 * out and named; a rule that cannot apply to a product's price leaves it out too. Prices come from
 * the sale engine itself, so the preview is exactly what the shop will charge.
 */
@Injectable()
export class EventProductsService {
	constructor(
		private readonly admin: EventsAdminService,
		private readonly catalog: EventCatalog,
		private readonly products: CatalogService,
		@Inject(PRODUCT_REPOSITORY) private readonly productRepo: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
	) {}

	async addProducts(body: ProductSaleWrite, principal: AuthenticatedPrincipal): Promise<ProductSaleResult> {
		const right = body.eventId ? 'event.edit' : 'event.create';
		if (!principal.permissions.includes(right)) throw new ForbiddenException('Insufficient permissions');
		const event = body.eventId ? await this.openSale(body.eventId) : this.blankSale();
		const ids = new Set(body.lines.map((line) => line.productId));
		const found = new Map<string, Product>();
		for (const id of ids) {
			const product = await this.productRepo.findById(id, 'admin');
			if (product) found.set(id, product);
		}
		const usable = body.lines.filter((line) => {
			const product = found.get(line.productId);
			return product && product.status !== 'discontinued' && !saleRuleProblem(line.rule);
		});
		const before = body.eventId ? await this.catalog.salePrices(event) : [];
		const viaCategory = new Set(
			before
				.filter((price) => price.source !== 'product' && ids.has(price.productId))
				.map((price) => price.productId),
		);
		const trial: ShopEvent = {
			...event,
			sale: {
				...event.sale,
				products: [...event.sale.products.filter((line) => !ids.has(line.productId)), ...usable],
			},
		};
		const prices = await this.catalog.salePrices(trial);
		const clashes = new Map(
			(await this.catalog.overlaps(trial, [...ids])).map((problem) => [problem.target, problem.detail]),
		);
		const labels = await this.labels([...found.values()]);
		const thumbnails = await this.products.thumbnailsFor(
			[...found.values()].map((product) => product.media.gallery[0]).filter((id): id is string => !!id),
		);
		const rows: ProductSaleRow[] = body.lines.map((line) => {
			const product = found.get(line.productId);
			if (!product) {
				return {
					productId: line.productId,
					title: '',
					sku: '',
					status: 'draft',
					thumbnailUrl: null,
					outcome: 'refused',
					reason: 'not_found',
					detail: '',
					viaCategory: false,
					prices: [],
				};
			}
			const own = prices.filter((price) => price.productId === product.id);
			const reason =
				product.status === 'discontinued'
					? 'discontinued'
					: clashes.has(product.id)
						? 'overlap'
						: saleRuleProblem(line.rule) || (own.length > 0 && own.every((price) => price.refused))
							? 'bad_rule'
							: null;
			return {
				productId: product.id,
				title: product.title['en'] || product.sku,
				sku: product.sku,
				status: product.status,
				thumbnailUrl: thumbnails.get(product.media.gallery[0] ?? '') ?? null,
				outcome: reason ? 'refused' : 'done',
				reason,
				detail: clashes.get(product.id) ?? '',
				viaCategory: viaCategory.has(product.id),
				prices: own.map((price) => this.price(price, labels)),
			};
		});
		const accepted = new Set(rows.filter((row) => row.outcome === 'done').map((row) => row.productId));
		if (body.dryRun || !accepted.size) {
			return ProductSaleResult.parse({
				dryRun: body.dryRun,
				eventId: body.eventId,
				eventStatus: body.eventId ? event.status : null,
				rows,
			});
		}
		const lines = body.lines.filter((line) => accepted.has(line.productId));
		const sale = {
			...event.sale,
			products: [...event.sale.products.filter((line) => !accepted.has(line.productId)), ...lines],
		};
		const actor = principal.userId;
		const saved = body.eventId
			? await this.admin.update(event.id, this.write(event, sale), actor)
			: await this.admin.create(
					{
						...ShopEventWrite.parse({
							name: `Sale from the product list · ${new Date().toISOString().slice(0, 10)}`,
							sale,
						}),
						type: 'sale',
					},
					actor,
				);
		return ProductSaleResult.parse({ dryRun: false, eventId: saved.id, eventStatus: saved.status, rows });
	}

	private async openSale(id: string): Promise<ShopEvent> {
		const event = await this.admin.detail(id);
		if (event.type !== 'sale') throw new BadRequestException('Only a sale takes products');
		if (!OPEN.has(event.status)) throw new BadRequestException('This sale has ended');
		return event;
	}

	/** A sale not saved yet, so a new sale's prices can be shown before it is made. */
	private blankSale(): ShopEvent {
		return ShopEvent.parse({ id: 'evt_preview', type: 'sale', name: 'preview', status: 'draft' });
	}

	/** The event's form as it is, with new sale lines: what Save on the sale form would send. */
	private write(event: ShopEvent, sale: ShopEvent['sale']): ShopEventWrite {
		return ShopEventWrite.parse({
			name: event.name,
			title: event.title,
			message: event.message,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			linkHref: event.linkHref,
			showCountdown: event.showCountdown,
			showPopup: event.showPopup,
			popupAssetIds: event.popupAssetIds,
			imageVersions: event.imageVersions,
			popupImageSide: event.popupImageSide,
			nowLiveDays: event.nowLiveDays,
			launch: event.launch,
			sale,
		});
	}

	private price(price: ShopEventPriceRow, labels: ReadonlyMap<string, string>) {
		return {
			sku: price.sku,
			label: labels.get(price.sku) ?? '',
			normalINR: price.normalINR,
			saleINR: price.saleINR,
			refused: price.refused,
			warning: price.warning,
		};
	}

	/** Each SKU's colour or size words, empty for a product with one price row. */
	private async labels(products: readonly Product[]): Promise<Map<string, string>> {
		const rows = await this.variants.listForProducts(
			products.map((product) => product.id),
			'admin',
		);
		const labels = new Map<string, string>();
		for (const product of products) {
			const term = new Map(
				product.optionGroups.flatMap((group) =>
					group.terms.map((option) => [`${group.attributeCode}:${option.code}`, option.label.en] as const),
				),
			);
			const own = rows.filter((row) => row.productId === product.id);
			for (const row of own) {
				labels.set(
					row.sku,
					own.length > 1
						? row.optionSelections
								.map((selection) => term.get(`${selection.attributeCode}:${selection.termCode}`))
								.filter(Boolean)
								.join(' / ')
						: '',
				);
			}
		}
		return labels;
	}
}
