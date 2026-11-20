import type {
	ZoneLinePrice,
	ZonePriceList,
	ZonePricingSettingKey,
	ZonePricingSettings,
	ZoneRuleAdjustment,
	ZoneRuleRef,
} from '@saha-textile/contracts';

/**
 * Zone pricing for business orders (`DEC-B2B-ZONES`, owner 2026-11-20).
 *
 * RETAIL (or a business on a draft zone) pays the shop's price, sale included. A live zone prices a
 * SKU by its price list: a product exception beats a category rule, which beats the all-products
 * rule; a product the list doesn't cover has no price in the zone ("Price not set for this zone").
 *
 * The open questions are settings. When a case needs one that isn't chosen (a sale on the piece,
 * two categories that disagree, GST on top), the line says which setting is missing instead of
 * guessing the owner's answer.
 */

export interface ZoneSku {
	productId: string;
	sku: string;
	/** The shop's normal selling price for the SKU, before any sale. */
	normalINR: number;
	/** The shop's sale price right now, when a live sale prices the SKU; null otherwise. */
	saleINR: number | null;
	/** The product's categories, each with its parents (nearest first), and the main category. */
	categoryPaths: ReadonlyArray<readonly string[]>;
	mainCategoryId: string | null;
}

export interface ZoneForPricing {
	retail: boolean;
	live: boolean;
	priceList: ZonePriceList;
}

/** One adjustment on a normal price, whole rupees rounded down; null when it can't apply. */
export function applyZoneAdjustment(
	adjustment: ZoneRuleAdjustment,
	normalINR: number,
	sku: string,
	skuPrices: Record<string, number> = {},
): number | null {
	if (adjustment.kind === 'flatPrice') {
		const price = skuPrices[sku] ?? adjustment.amountINR;
		return price >= 0 ? Math.floor(price) : null;
	}
	if (!(normalINR > 0)) return null;
	return Math.floor((normalINR * (100 - adjustment.percent)) / 100);
}

interface Candidate {
	price: number;
	rule: ZoneRuleRef;
	adjustment: ZoneRuleAdjustment;
	categoryId: string | null;
}

const settingNeeded = (setting: ZonePricingSettingKey): ZoneLinePrice => ({ kind: 'settingNeeded', setting });

/** The rule-level price of a SKU in a zone, before the sale and GST settings; or no price. */
function zoneCandidate(
	zone: ZoneForPricing,
	sku: ZoneSku,
	settings: ZonePricingSettings,
): Candidate | 'noPrice' | ZoneLinePrice {
	const list = zone.priceList;
	const exception = list.products.find((row) => row.productId === sku.productId);
	if (exception) {
		if (exception.mode === 'noPrice' || !exception.adjustment) return 'noPrice';
		const price = applyZoneAdjustment(exception.adjustment, sku.normalINR, sku.sku, exception.skuPrices);
		if (price === null) return 'noPrice';
		return {
			price,
			rule: { level: 'product', productId: sku.productId },
			adjustment: exception.adjustment,
			categoryId: null,
		};
	}
	// Category rules: the nearest matching rule along each of the product's category paths.
	const matches: Candidate[] = [];
	for (const path of sku.categoryPaths) {
		for (const categoryId of path) {
			const isSelf = categoryId === path[0];
			const rule = list.categories.find(
				(row) => row.categoryId === categoryId && (isSelf || row.includeSubcategories),
			);
			if (rule) {
				const price = applyZoneAdjustment(rule.adjustment, sku.normalINR, sku.sku);
				if (price !== null) {
					matches.push({
						price,
						rule: { level: 'category', ruleId: rule.id, categoryId: rule.categoryId },
						adjustment: rule.adjustment,
						categoryId: path[0] ?? null,
					});
				}
				break;
			}
		}
	}
	const distinct = new Map(matches.map((match) => [match.price, match]));
	if (distinct.size === 1) return matches[0] as Candidate;
	if (distinct.size > 1) {
		if (!settings.categoryClash) return settingNeeded('categoryClash');
		const sorted = [...matches].sort((a, b) => a.price - b.price);
		if (settings.categoryClash === 'lowerPrice') return sorted[0] as Candidate;
		if (settings.categoryClash === 'higherPrice') return sorted[sorted.length - 1] as Candidate;
		const main = matches.find((match) => match.categoryId === sku.mainCategoryId);
		return main ?? (sorted[0] as Candidate);
	}
	if (list.allProducts) {
		const price = applyZoneAdjustment(list.allProducts, sku.normalINR, sku.sku);
		if (price !== null)
			return { price, rule: { level: 'allProducts' }, adjustment: list.allProducts, categoryId: null };
	}
	return 'noPrice';
}

/** The price of one SKU for a business on a zone. */
export function zonePriceFor(zone: ZoneForPricing, sku: ZoneSku, settings: ZonePricingSettings): ZoneLinePrice {
	const retailUnit = sku.saleINR ?? sku.normalINR;
	if (zone.retail || !zone.live) {
		return {
			kind: 'priced',
			unitPriceINR: retailUnit,
			retailUnitPriceINR: retailUnit,
			rule: { level: 'retail' },
			adjustment: null,
			fromSale: sku.saleINR !== null,
			gstAddedOnTop: false,
		};
	}
	const candidate = zoneCandidate(zone, sku, settings);
	if (candidate === 'noPrice') return { kind: 'noPrice' };
	if ('kind' in candidate) return candidate;
	if (!settings.gstInZonePrice) return settingNeeded('gstInZonePrice');
	let unit = candidate.price;
	let fromSale = false;
	if (sku.saleINR !== null) {
		if (!settings.saleMeetsZone) return settingNeeded('saleMeetsZone');
		if (
			settings.saleMeetsZone === 'salePrice' ||
			(settings.saleMeetsZone === 'lowerOfTheTwo' && sku.saleINR < unit)
		) {
			unit = sku.saleINR;
			fromSale = true;
		}
	}
	return {
		kind: 'priced',
		unitPriceINR: unit,
		retailUnitPriceINR: retailUnit,
		rule: candidate.rule,
		adjustment: fromSale ? null : candidate.adjustment,
		fromSale,
		gstAddedOnTop: settings.gstInZonePrice === 'addedOnTop',
	};
}

/**
 * Settings a zone needs before it can go live: GST always (every zone price meets it), and the
 * category clash when two category rules could disagree. The sale question is asked per line, since
 * only a sale on the piece raises it; it is listed here too so a zone is never live with it unset.
 */
export function settingsZoneNeeds(priceList: ZonePriceList, settings: ZonePricingSettings): ZonePricingSettingKey[] {
	const needed: ZonePricingSettingKey[] = [];
	if (!settings.gstInZonePrice) needed.push('gstInZonePrice');
	if (!settings.saleMeetsZone) needed.push('saleMeetsZone');
	const adjustments = new Set(priceList.categories.map((rule) => JSON.stringify(rule.adjustment)));
	if (adjustments.size > 1 && !settings.categoryClash) needed.push('categoryClash');
	return needed;
}

/** Whether coupons may apply to a zone-priced line (null setting: not until chosen). */
export function couponOnZoneLine(settings: ZonePricingSettings): 'allowed' | 'notAllowed' | 'settingNeeded' {
	if (!settings.couponsOnZoneLines) return 'settingNeeded';
	return settings.couponsOnZoneLines;
}
