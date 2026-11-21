import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	RETAIL_ZONE_ID,
	type AdminCartLine,
	type AdminCartView,
	type AdminCartWrite,
	type AdminOrderBuyerRef,
	type AdminProductCard,
	type AdminProductCardQuery,
	type AdminVariantChoiceQuery,
	type AdminVariantChoices,
	type CatalogProductPage,
	type PriceZone,
	type ZoneLinePrice,
} from '@saha-textile/contracts';
import {
	cartLineTotalINR,
	foreignAmountFromINR,
	priceCartLine,
	zoneAddOnPrice,
	type BusinessRepository,
	type PriceZoneRepository,
	type PricedCartLine,
	type ProductRepository,
	type ZoneForPricing,
} from '@saha-textile/core-domain';

import { CatalogPublicService } from '../catalog/catalog-public.service';
import { codedRefusal } from '../common/coded-refusal';
import { CurrencyService } from '../currency/currency.service';
import { BUSINESS_REPOSITORY, PRICE_ZONE_REPOSITORY, PRODUCT_REPOSITORY } from '../infra/tokens';
import { ZonePricingService, retailUnitINR } from '../orders-setup/zone-pricing.service';

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

/** The zone that prices a buyer: RETAIL for a shop customer or a business on RETAIL. */
export interface BuyerZone {
	zone: PriceZone | null;
	pricing: ZoneForPricing;
}

interface Rate {
	currency: string;
	rateFromINR: number;
	markupPercent: number;
}

/** Problems that keep a line out of the subtotal. */
const UNSELLABLE = new Set<AdminCartLine['problem']>(['unavailable', 'out_of_stock', 'noZonePrice']);

/**
 * The create-order screen's cart and product cards (brief oc01–oc03; owner 2026-11-20: zone cards).
 * Lines are priced exactly as the shop prices them (the same core `priceCartLine`); for a business on
 * a live zone the zone's rules then price the piece itself, and add-ons such as stitching keep their
 * listed price. The currency can be switched at any time: amounts convert at the stored rate plus the
 * PayPal markup, while payments taken by hand stay in rupees at rupee prices (K3).
 */
@Injectable()
export class AdminCartService {
	constructor(
		private readonly catalog: CatalogPublicService,
		private readonly zones: ZonePricingService,
		private readonly currency: CurrencyService,
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Inject(PRICE_ZONE_REPOSITORY) private readonly priceZones: PriceZoneRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
	) {}

	async buyerZone(buyer: AdminOrderBuyerRef | null): Promise<BuyerZone> {
		const retail: BuyerZone = { zone: null, pricing: { retail: true, live: true, rules: [] } };
		if (!buyer || buyer.kind === 'person') return retail;
		const business = await this.businesses.findById(buyer.businessId);
		if (!business)
			throw new NotFoundException(codedRefusal('business_missing', 'That business does not exist', 'buyer'));
		const zoneId = business.roles.customer?.zoneId ?? RETAIL_ZONE_ID;
		const zone = zoneId === RETAIL_ZONE_ID ? null : await this.priceZones.findById(zoneId);
		if (!zone || zone.system) return retail;
		return { zone, pricing: { retail: false, live: zone.status === 'live', rules: zone.rules } };
	}

	async price(input: AdminCartWrite, now = new Date()): Promise<AdminCartView> {
		const rate = await this.rate(input.currency);
		const { pricing } = await this.buyerZone(input.buyer);
		const reads = await Promise.all(input.lines.map((line) => this.catalog.cartRead(line.productId)));
		const priced = input.lines.map((line, index) => {
			const page = reads[index]?.page ?? null;
			const result = page ? priceCartLine(page, line) : null;
			return { line, page, title: reads[index]?.title ?? '', row: result?.ok ? result.line : null };
		});
		const zoned = pricing.retail ? [] : priced.filter((entry) => entry.row);
		const facts = zoned.length
			? await this.zones.factsFor(
					zoned.map(({ line, row }) => ({
						productId: line.productId,
						variantId: (row as PricedCartLine).variationId,
						quantity: (row as PricedCartLine).soldBy === 'metre' ? line.quantity / 10 : line.quantity,
					})),
					now,
				)
			: [];
		const factsByIndex = new Map(zoned.map((entry, index) => [entry, facts[index]]));
		const lines: AdminCartLine[] = priced.map((entry) => {
			const { line, page, row } = entry;
			const base = {
				lineId: `line_${randomUUID()}`,
				productId: line.productId,
				variationId: row?.variationId ?? line.variationId,
				title: entry.title,
				sku: row?.sku ?? '',
				quantity: line.quantity,
				soldBy: row?.soldBy ?? page?.soldBy ?? 'piece',
				imageUrl: page && row ? imageOf(page, row.galleryIndex) : null,
				measurements: (row?.measurements ?? []).map((field) => ({
					code: field.code,
					label: field.label,
					value: `${field.value} ${field.unit}`,
				})),
			};
			if (!row || !row.buyable) {
				return {
					...base,
					unitPriceINR: 0,
					unitPrice: 0,
					lineTotal: 0,
					lineTotalINR: 0,
					zonePrice: null,
					problem: 'unavailable',
					mrpINR: null,
					options: [],
					addOnsZonePriced: false,
				};
			}
			const fact = factsByIndex.get(entry);
			const zonePrice: ZoneLinePrice | null = fact ? this.zones.price(pricing, fact.facts, now).price : null;
			if (zonePrice?.kind === 'noPrice') {
				return {
					...base,
					unitPriceINR: 0,
					unitPrice: 0,
					lineTotal: 0,
					lineTotalINR: 0,
					zonePrice,
					problem: 'noZonePrice',
					mrpINR: null,
					options: [],
					addOnsZonePriced: false,
				};
			}
			// The zone prices the piece; stitching and add-ons keep their listed price unless the rule's
			// "Also apply to stitching and add-ons" is on with a % off or ₹ off (DEC-B2B-ZONES).
			const adjust = zonePrice?.kind === 'priced' ? zonePrice.addOns : null;
			const options = row.options.map((option) => ({
				...option,
				priceDeltaINR: zoneAddOnPrice(option.priceDeltaINR, adjust),
			}));
			const addOns = options.reduce((sum, option) => sum + option.priceDeltaINR, 0);
			const pieceINR = zonePrice?.kind === 'priced' ? zonePrice.unitPriceINR : row.basePriceINR;
			const effective: PricedCartLine = {
				...row,
				options,
				basePriceINR: pieceINR,
				unitPriceINR: round2(pieceINR + addOns),
			};
			const addOnsZonePriced =
				!!adjust && options.some((option, index) => option.priceDeltaINR !== row.options[index]?.priceDeltaINR);
			const lineTotalINR = round2(cartLineTotalINR(effective, line.quantity));
			const problem: AdminCartLine['problem'] =
				row.available !== null && row.available <= 0
					? 'out_of_stock'
					: row.available !== null && line.quantity > row.available
						? 'limited'
						: null;
			return {
				...base,
				unitPriceINR: effective.unitPriceINR,
				unitPrice: this.convert(effective.unitPriceINR, rate),
				lineTotal: this.convert(lineTotalINR, rate),
				lineTotalINR,
				zonePrice,
				problem,
				mrpINR: row.mrpINR,
				options: options.map((option, index) => ({
					code: option.code,
					group: option.group,
					value: option.value,
					priceINR: option.priceDeltaINR,
					listedPriceINR: row.options[index]?.priceDeltaINR ?? option.priceDeltaINR,
				})),
				addOnsZonePriced,
			};
		});
		const counted = lines.filter((line) => !UNSELLABLE.has(line.problem));
		const subtotalINR = round2(counted.reduce((sum, line) => sum + line.lineTotalINR, 0));
		return {
			currency: rate.currency,
			markupPercent: rate.markupPercent,
			lines,
			subtotal: round2(counted.reduce((sum, line) => sum + line.lineTotal, 0)),
			subtotalINR,
		};
	}

	/** Product cards priced for the chosen buyer; a product the zone doesn't price is greyed. */
	async cards(query: AdminProductCardQuery, now = new Date()): Promise<{ items: AdminProductCard[]; total: number }> {
		const rate = await this.rate(query.currency);
		const { pricing } = await this.buyerZone(
			query.businessId ? { kind: 'business', businessId: query.businessId } : null,
		);
		const page = await this.products.list({
			audience: 'public',
			search: query.q,
			categoryIds: query.categoryId ? [query.categoryId] : undefined,
			page: query.page,
			pageSize: query.pageSize,
		});
		const cards = new Map(
			(await this.catalog.cardsForIds(page.items.map((product) => product.id))).map((card) => [card.id, card]),
		);
		const facts = await this.zones.factsFor(
			page.items.map((product) => ({ productId: product.id, variantId: null, quantity: 1 })),
			now,
		);
		const items = page.items.map((product, index) => {
			const fact = facts[index];
			const card = cards.get(product.id);
			const retailINR = fact ? retailUnitINR(fact.facts) : 0;
			const zonePrice = pricing.retail || !fact ? null : this.zones.price(pricing, fact.facts, now).price;
			const priceINR = zonePrice ? (zonePrice.kind === 'priced' ? zonePrice.unitPriceINR : null) : retailINR;
			return {
				productId: product.id,
				title: card?.title ?? product.title.en,
				imageUrl: card?.image?.roles['card']?.[0]?.url ?? null,
				categoryIds: product.categoryIds,
				hasVariants: (fact?.variant.isBaseVariant ?? true) === false,
				soldBy: product.soldBy,
				shortestCutTenths: product.shortestCutTenths ?? null,
				stock: fact
					? Math.max(0, fact.variant.stock.quantity - fact.variant.stock.held - fact.variant.stock.reserved)
					: null,
				retailINR,
				price: priceINR === null ? null : this.convert(priceINR, rate),
				zonePrice,
			};
		});
		return { items, total: page.total };
	}

	/**
	 * A product's variants (its colours, designs or sizes) priced for the buyer, for the variant
	 * picker on Create order. Only variants the shop could sell are listed.
	 */
	async variantChoices(
		productId: string,
		query: AdminVariantChoiceQuery,
		now = new Date(),
	): Promise<AdminVariantChoices> {
		const rate = await this.rate(query.currency);
		const { pricing } = await this.buyerZone(
			query.businessId ? { kind: 'business', businessId: query.businessId } : null,
		);
		const read = await this.catalog.cartRead(productId);
		const page = read?.page;
		if (!read || !page) {
			throw new NotFoundException(codedRefusal('product_missing', 'That product is not on sale', 'productId'));
		}
		const variants = page.variants.filter((variant) => variant.buyable);
		const facts = variants.length
			? await this.zones.factsFor(
					variants.map((variant) => ({ productId, variantId: variant.id, quantity: 1 })),
					now,
				)
			: [];
		const termLabel = (group: string, term: string): string =>
			page.optionGroups.find((row) => row.code === group)?.terms.find((row) => row.code === term)?.label ?? term;
		const items = variants.map((variant, index) => {
			const fact = facts[index];
			const retailINR = fact ? retailUnitINR(fact.facts) : variant.sellingINR;
			const zonePrice = pricing.retail || !fact ? null : this.zones.price(pricing, fact.facts, now).price;
			const priceINR = zonePrice ? (zonePrice.kind === 'priced' ? zonePrice.unitPriceINR : null) : retailINR;
			return {
				variationId: variant.id,
				sku: variant.sku,
				label:
					Object.entries(variant.selections)
						.map(([group, term]) => termLabel(group, term))
						.join(' · ') || variant.sku,
				imageUrl: imageOf(page, variant.galleryIndex),
				stock: fact?.variant
					? Math.max(0, fact.variant.stock.quantity - fact.variant.stock.held - fact.variant.stock.reserved)
					: variant.quantity,
				retailINR,
				price: priceINR === null ? null : this.convert(priceINR, rate),
				zonePrice,
			};
		});
		return { productId, title: read.title, soldBy: page.soldBy, items };
	}

	private async rate(code: string): Promise<Rate> {
		const sample = await this.currency.convert(0, code).catch(() => {
			throw new BadRequestException(codedRefusal('currency_unknown', 'That currency is not set up', 'currency'));
		});
		return { currency: sample.currency, rateFromINR: sample.rateFromINR, markupPercent: sample.markupPercent };
	}

	private convert(amountINR: number, rate: Rate): number {
		return rate.currency === 'INR'
			? round2(amountINR)
			: foreignAmountFromINR(amountINR, rate.rateFromINR, rate.markupPercent);
	}
}

function imageOf(page: CatalogProductPage, index: number | null): string | null {
	const image = page.gallery[index ?? 0] ?? page.gallery[0];
	return image?.roles['card']?.[0]?.url ?? image?.roles['gallery']?.[0]?.url ?? null;
}
