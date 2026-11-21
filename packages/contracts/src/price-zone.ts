import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Zones for business customers (`DEC-B2B-ZONES`, owner 2026-11-20).
 *
 * Every business with the customer role has exactly one zone: its buyer level. RETAIL is a system
 * zone with no rules that can't be deleted; a RETAIL business pays normal shop pricing, the same as
 * a shop customer, sale events included. Zones apply only to admin orders for businesses; they never
 * change shop prices. An order keeps the zone, its version and the rule that priced each line.
 *
 * Owner's answers (2026-11-20): each owner writes the zone's rules in a rule builder with conditions
 * and variables (the shipping rule builder's blocks); zone prices include GST; tiers stay fixed
 * (product exceptions > category rules > all-products rules) and within a tier the first rule that
 * matches wins, in the order the owner drags them into; a product no rule prices shows "Price not set
 * for this zone". Coupons apply to zone prices only when the coupon says so.
 */

export const RETAIL_ZONE_ID = 'zone_retail';
export const RETAIL_ZONE_CODE = 'RETAIL';

const RuleId = z.string().min(1).max(60);
const Rupees = z.number().finite().nonnegative().max(100_000_000);

/** The facts a zone rule can look at, for one line of a business order. */
export const ZoneField = z.enum([
	/** The piece's regular selling price, never touched by sales. */
	'line.regularSellingINR',
	/** The current sale price; empty when no sale is live. */
	'line.currentSaleINR',
	'line.isOnSale',
	'line.mrpINR',
	/** Purchase cost (seeing it needs the cost permission; a rule may still use it). */
	'line.purchaseCostINR',
	'line.quantity',
	/** Fabric sold by the metre: the cut's length in metres. */
	'line.metres',
	'line.productId',
	'line.categoryIds',
	/** The value of the goods on the whole order (order-value breaks). */
	'order.goodsINR',
]);
export type ZoneField = z.infer<typeof ZoneField>;

export const ZoneOperator = z.enum([
	'is',
	'isNot',
	'isOneOf',
	'moreThan',
	'atLeast',
	'lessThan',
	'atMost',
	'between',
	'isEmpty',
	'isNotEmpty',
]);
export type ZoneOperator = z.infer<typeof ZoneOperator>;

export const ZoneConditionValue = z.union([
	z.boolean(),
	z.number().finite(),
	z.string().max(200),
	z.array(z.string().max(200)).max(200),
	z.tuple([z.number().finite(), z.number().finite()]),
]);
export type ZoneConditionValue = z.infer<typeof ZoneConditionValue>;

export const ZoneCondition = z.object({
	kind: z.literal('condition'),
	id: RuleId,
	field: ZoneField,
	op: ZoneOperator,
	value: ZoneConditionValue.nullable().default(null),
});
export type ZoneCondition = z.infer<typeof ZoneCondition>;

export interface ZoneConditionGroup {
	kind: 'group';
	id: string;
	join: 'all' | 'any';
	items: Array<ZoneCondition | ZoneConditionGroup>;
}
export const ZoneConditionGroup: z.ZodType<ZoneConditionGroup> = z.object({
	kind: z.literal('group'),
	id: RuleId,
	join: z.enum(['all', 'any']),
	items: z.array(z.union([ZoneCondition, z.lazy(() => ZoneConditionGroup)])).max(30),
});

/** What a percentage or rupee amount is taken from. */
export const ZoneBase = z.enum([
	'regularSelling',
	/** The sale price while a sale is live, otherwise the regular selling price. */
	'currentSaleOrRegular',
	'mrp',
]);
export type ZoneBase = z.infer<typeof ZoneBase>;

export type ZonePriceFormula =
	| { kind: 'flatPrice'; amountINR: number; skuPrices: Record<string, number> }
	| { kind: 'percentOffBase'; base: ZoneBase; percent: number }
	| { kind: 'amountOffBase'; base: ZoneBase; amountINR: number }
	| { kind: 'percentAboveCost'; percent: number }
	| { kind: 'pricePerMetre'; amountINR: number }
	| { kind: 'quantityBreaks'; breaks: Array<{ minQuantity: number; formula: ZonePriceFormula }> }
	| { kind: 'orderValueBreaks'; breaks: Array<{ minGoodsINR: number; formula: ZonePriceFormula }> }
	| { kind: 'lowerOf'; formulas: ZonePriceFormula[] }
	| { kind: 'higherOf'; formulas: ZonePriceFormula[] }
	| { kind: 'noPrice' };

/**
 * How a rule prices a piece (owner: flat price, % less than a base, ₹ less than a base, % above purchase
 * cost, quantity breaks; plus what a B2B pricing product offers: MRP or the sale price as a base, price
 * per metre for cut fabric, order-value breaks, the lower or higher of two formulas, no price).
 */
export const ZonePriceFormula: z.ZodType<ZonePriceFormula> = z.lazy(() =>
	z.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('flatPrice'),
			amountINR: Rupees,
			skuPrices: z.record(z.string(), Rupees).default({}),
		}),
		z.object({ kind: z.literal('percentOffBase'), base: ZoneBase, percent: z.number().finite().gt(0).max(100) }),
		z.object({ kind: z.literal('amountOffBase'), base: ZoneBase, amountINR: Rupees.positive() }),
		z.object({ kind: z.literal('percentAboveCost'), percent: z.number().finite().min(0).max(1000) }),
		z.object({ kind: z.literal('pricePerMetre'), amountINR: Rupees.positive() }),
		z.object({
			kind: z.literal('quantityBreaks'),
			breaks: z
				.array(z.object({ minQuantity: z.number().int().positive(), formula: ZonePriceFormula }))
				.min(1)
				.max(20),
		}),
		z.object({
			kind: z.literal('orderValueBreaks'),
			breaks: z
				.array(z.object({ minGoodsINR: Rupees, formula: ZonePriceFormula }))
				.min(1)
				.max(20),
		}),
		z.object({ kind: z.literal('lowerOf'), formulas: z.array(ZonePriceFormula).min(2).max(4) }),
		z.object({ kind: z.literal('higherOf'), formulas: z.array(ZonePriceFormula).min(2).max(4) }),
		z.object({ kind: z.literal('noPrice') }),
	]),
) as z.ZodType<ZonePriceFormula>;

export const ZoneRounding = z.enum(['none', 'upToTen', 'endingInNine']);
export type ZoneRounding = z.infer<typeof ZoneRounding>;

/** Which tier a rule sits in, and what it covers. */
export const ZoneRuleScope = z.discriminatedUnion('tier', [
	z.object({ tier: z.literal('product'), productIds: z.array(Id).min(1).max(2_000) }),
	z.object({
		tier: z.literal('category'),
		categoryIds: z.array(Id).min(1).max(200),
		includeSubcategories: z.boolean().default(true),
	}),
	z.object({ tier: z.literal('allProducts') }),
]);
export type ZoneRuleScope = z.infer<typeof ZoneRuleScope>;

export const ZoneRule = z.object({
	id: RuleId,
	/** Admin only, shown in the list and in plain words. */
	name: z.string().trim().max(80).default(''),
	enabled: z.boolean().default(true),
	scope: ZoneRuleScope,
	/** Only when these hold; null = always. */
	when: ZoneConditionGroup.nullable().default(null),
	price: ZonePriceFormula,
	rounding: ZoneRounding.default('none'),
	/** Never below / above these, in rupees. */
	floorINR: Rupees.nullable().default(null),
	ceilingINR: Rupees.nullable().default(null),
	/** The line must have at least this many pieces for the rule to apply. */
	minQuantityPerLine: z.number().int().positive().nullable().default(null),
	validFrom: IsoDateTime.nullable().default(null),
	validUntil: IsoDateTime.nullable().default(null),
	/**
	 * "Also apply to stitching and add-ons" (owner, DEC-B2B-ZONES, 20 Nov: "Rule decides"). Off: only the
	 * piece takes the zone price and add-ons keep their listed price. On: the rule's % off or ₹ off also
	 * applies to each add-on. A flat price, per-variant flat price, price per metre, % above cost or no
	 * price never touches add-ons, even when this is on.
	 */
	addOns: z.boolean().default(false),
});
export type ZoneRule = z.infer<typeof ZoneRule>;

/** How a zone rule prices a line's stitching and other add-ons, when its switch is on. */
export const ZoneAddOnAdjust = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('percentOff'), percent: z.number().finite().gt(0).max(100) }),
	z.object({ kind: z.literal('amountOff'), amountINR: Rupees.positive() }),
]);
export type ZoneAddOnAdjust = z.infer<typeof ZoneAddOnAdjust>;

export const PriceZone = z.object({
	id: Id,
	/** Short code shown on the business list (`RETAIL`, `WHOLESALE-A`). */
	code: z
		.string()
		.trim()
		.regex(/^[A-Z][A-Z0-9-]{1,23}$/, { message: 'zone_code_shape' }),
	name: z.string().trim().min(1).max(80),
	description: z.string().trim().max(300).default(''),
	/** RETAIL: shop pricing, no rules, can't be deleted or edited. */
	system: z.boolean().default(false),
	/** Draft zones price nothing; a business on a draft zone pays retail until it goes live. */
	status: z.enum(['draft', 'live', 'archived']).default('draft'),
	/** In builder order; tiers are fixed, first match wins within a tier. */
	rules: z.array(ZoneRule).max(300).default([]),
	/** Raised on every saved change of the rules; the order keeps the version that priced it. */
	version: z.number().int().positive().default(1),
	revision: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type PriceZone = z.infer<typeof PriceZone>;

export const PriceZoneWrite = z.object({
	code: PriceZone.shape.code,
	name: PriceZone.shape.name,
	description: z.string().trim().max(300).default(''),
	rules: z.array(ZoneRule).max(300),
	revision: z.number().int().nonnegative().optional(),
});
export type PriceZoneWrite = z.infer<typeof PriceZoneWrite>;

/** Go live, back to draft, or archive a zone. */
export const PriceZoneStatusWrite = z.object({
	status: z.enum(['draft', 'live', 'archived']),
	revision: z.number().int().nonnegative(),
});
export type PriceZoneStatusWrite = z.infer<typeof PriceZoneStatusWrite>;

/** Mistakes the builder catches before a zone can go live. */
export const ZoneRuleProblem = z.enum([
	'impossible_condition',
	'breaks_out_of_order',
	'floor_above_ceiling',
	'ends_before_start',
	'value_missing',
]);
export type ZoneRuleProblem = z.infer<typeof ZoneRuleProblem>;

/** Which rule priced a line (kept on the order). */
export const ZoneRuleRef = z.object({
	tier: z.enum(['product', 'category', 'allProducts', 'retail']),
	ruleId: RuleId.nullable(),
	ruleName: z.string().default(''),
});
export type ZoneRuleRef = z.infer<typeof ZoneRuleRef>;

/** What a zone does to one SKU: a price (GST included), or no price in this zone. */
export const ZoneLinePrice = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('priced'),
		unitPriceINR: z.number().nonnegative(),
		retailUnitPriceINR: z.number().nonnegative(),
		rule: ZoneRuleRef,
		/** The cost guard: the zone price is below the piece's purchase cost. */
		belowCost: z.boolean().default(false),
		/** Stitching and add-ons at the rule's % off or ₹ off; null = their listed price. */
		addOns: ZoneAddOnAdjust.nullable().default(null),
	}),
	/** Shown in red as "Price not set for this zone"; the card is greyed and can't be picked. */
	z.object({
		kind: z.literal('noPrice'),
		reason: z.enum(['noRule', 'ruleSaysNoPrice', 'costUnknown']).default('noRule'),
	}),
]);
export type ZoneLinePrice = z.infer<typeof ZoneLinePrice>;

/** The zone record an order keeps. */
export const OrderZoneSnapshot = z.object({
	zoneId: Id,
	code: z.string(),
	name: z.string(),
	version: z.number().int().positive(),
});
export type OrderZoneSnapshot = z.infer<typeof OrderZoneSnapshot>;

/** A row of Admin › Customers › Zones. */
export const AdminZoneRow = PriceZone.pick({
	id: true,
	code: true,
	name: true,
	system: true,
	status: true,
	version: true,
	updatedAt: true,
}).extend({
	businessCount: z.number().int().nonnegative(),
	ruleCount: z.number().int().nonnegative(),
	problems: z.array(z.object({ ruleId: RuleId, problem: ZoneRuleProblem })),
});
export type AdminZoneRow = z.infer<typeof AdminZoneRow>;

/** Try it: what a zone's rules do to a handful of products, line by line. */
export const ZoneTryRequest = z.object({
	rules: z.array(ZoneRule).max(300),
	items: z
		.array(
			z.object({
				productId: Id,
				variantId: Id.nullable().default(null),
				quantity: z.number().positive().max(9999).default(1),
			}),
		)
		.min(1)
		.max(20),
});
export type ZoneTryRequest = z.infer<typeof ZoneTryRequest>;

export const ZoneTryResult = z.object({
	lines: z.array(
		z.object({
			productId: Id,
			variantId: Id.nullable(),
			title: z.string(),
			sku: z.string(),
			price: ZoneLinePrice,
			/** The plain-words trace of how the price was reached. */
			trace: z.array(z.string()),
		}),
	),
});
export type ZoneTryResult = z.infer<typeof ZoneTryResult>;
