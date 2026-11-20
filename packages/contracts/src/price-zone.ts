import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Zones for business customers (`DEC-B2B-ZONES`, owner 2026-11-20).
 *
 * Every business with the customer role has exactly one zone: its buyer level. RETAIL is a system
 * zone with no rules that can't be deleted; a RETAIL business pays normal shop pricing, the same as
 * a shop customer, sale events included. Admins add more zones. Each holds a price list built like
 * a sale event: an all-products rule, category rules and product exceptions picked from a list.
 * A product exception beats a category rule, which beats the all-products rule.
 *
 * Zones apply only to admin orders for businesses; they never change shop prices. An order keeps
 * the zone, its version and the rule that priced each line.
 *
 * Still open with the owner (`pending-decisions.mdx` § DEC-B2B-ZONES): a shop sale against the zone
 * price, GST inside or on top, further rule kinds, two categories with different rules, coupons on
 * zone lines. Each is a named setting below with no value chosen on the owner's behalf; a zone that
 * needs an unchosen setting can't go live, and a line that meets one says which setting is missing.
 */

export const RETAIL_ZONE_ID = 'zone_retail';
export const RETAIL_ZONE_CODE = 'RETAIL';

/** How a zone rule prices a piece. More kinds may follow (open question 3). */
export const ZoneRuleAdjustment = z.discriminatedUnion('kind', [
	/** An absolute price in whole rupees for each piece (or each metre for fabric by the metre). */
	z.object({ kind: z.literal('flatPrice'), amountINR: z.number().int().nonnegative().max(100_000_000) }),
	/** A percentage less than the retail price. */
	z.object({ kind: z.literal('percentOffRetail'), percent: z.number().finite().gt(0).max(100) }),
]);
export type ZoneRuleAdjustment = z.infer<typeof ZoneRuleAdjustment>;

/** One product picked out of a category rule: its own adjustment, or no price in this zone. */
export const ZoneProductException = z.object({
	productId: Id,
	/** `own`: the product's own adjustment. `noPrice`: the product isn't sold in this zone. */
	mode: z.enum(['own', 'noPrice']),
	adjustment: ZoneRuleAdjustment.nullable().default(null),
	/** A flat price per SKU, for a product with several price rows (`flatPrice` only). */
	skuPrices: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type ZoneProductException = z.infer<typeof ZoneProductException>;

export const ZoneCategoryRule = z.object({
	id: Id,
	categoryId: Id,
	includeSubcategories: z.boolean().default(true),
	adjustment: ZoneRuleAdjustment,
});
export type ZoneCategoryRule = z.infer<typeof ZoneCategoryRule>;

export const ZonePriceList = z.object({
	/** Applies to every product not covered by a category rule or an exception; null = none. */
	allProducts: ZoneRuleAdjustment.nullable().default(null),
	categories: z.array(ZoneCategoryRule).max(200).default([]),
	products: z.array(ZoneProductException).max(5_000).default([]),
});
export type ZonePriceList = z.infer<typeof ZonePriceList>;

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
	priceList: ZonePriceList.default({ allProducts: null, categories: [], products: [] }),
	/** Raised on every saved change; the order keeps the version that priced it. */
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
	priceList: ZonePriceList,
	revision: z.number().int().nonnegative().optional(),
});
export type PriceZoneWrite = z.infer<typeof PriceZoneWrite>;

/**
 * The open zone questions as settings. `null` means not chosen yet: a zone that would need the
 * setting can't go live, and the screens say which setting is missing.
 */
export const ZonePricingSettings = z.object({
	/** Q1: a zone customer's price for a piece the shop has on sale. */
	saleMeetsZone: z.enum(['zonePrice', 'salePrice', 'lowerOfTheTwo']).nullable().default(null),
	/** Q2: whether a zone price already includes GST, like shop prices, or GST is added on top. */
	gstInZonePrice: z.enum(['included', 'addedOnTop']).nullable().default(null),
	/** Q4: a product in two categories whose zone rules differ. */
	categoryClash: z.enum(['lowerPrice', 'higherPrice', 'mainCategory']).nullable().default(null),
	/** Q5: whether coupons apply to lines priced by a zone. */
	couponsOnZoneLines: z.enum(['allowed', 'notAllowed']).nullable().default(null),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: z.string().nullable().default(null),
});
export type ZonePricingSettings = z.infer<typeof ZonePricingSettings>;

export const ZonePricingSettingKey = z.enum(['saleMeetsZone', 'gstInZonePrice', 'categoryClash', 'couponsOnZoneLines']);
export type ZonePricingSettingKey = z.infer<typeof ZonePricingSettingKey>;

/** Which rule priced a line (kept on the order). */
export const ZoneRuleRef = z.discriminatedUnion('level', [
	z.object({ level: z.literal('product'), productId: Id }),
	z.object({ level: z.literal('category'), ruleId: Id, categoryId: Id }),
	z.object({ level: z.literal('allProducts') }),
	z.object({ level: z.literal('retail') }),
]);
export type ZoneRuleRef = z.infer<typeof ZoneRuleRef>;

/** What a zone does to one SKU: a price, no price, or a setting it needs that isn't chosen. */
export const ZoneLinePrice = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('priced'),
		unitPriceINR: z.number().nonnegative(),
		retailUnitPriceINR: z.number().nonnegative(),
		rule: ZoneRuleRef,
		adjustment: ZoneRuleAdjustment.nullable(),
		/** True when a shop sale priced the line (RETAIL, or `saleMeetsZone` chose the sale). */
		fromSale: z.boolean().default(false),
		gstAddedOnTop: z.boolean().default(false),
	}),
	/** Shown in red as "Price not set for this zone"; the card is greyed and can't be picked. */
	z.object({ kind: z.literal('noPrice') }),
	z.object({ kind: z.literal('settingNeeded'), setting: ZonePricingSettingKey }),
]);
export type ZoneLinePrice = z.infer<typeof ZoneLinePrice>;

/** The zone record an order keeps. */
export const OrderZoneSnapshot = z.object({
	zoneId: Id,
	code: z.string(),
	name: z.string(),
	version: z.number().int().positive(),
	settings: ZonePricingSettings.pick({
		saleMeetsZone: true,
		gstInZonePrice: true,
		categoryClash: true,
		couponsOnZoneLines: true,
	}),
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
	categoryRuleCount: z.number().int().nonnegative(),
	productExceptionCount: z.number().int().nonnegative(),
	/** Settings this zone needs that aren't chosen yet (it can't go live until they are). */
	settingsNeeded: z.array(ZonePricingSettingKey),
});
export type AdminZoneRow = z.infer<typeof AdminZoneRow>;

/** Try it: what a zone does to a handful of products, line by line, in plain words on screen. */
export const ZoneTryRequest = z.object({
	priceList: ZonePriceList,
	items: z
		.array(z.object({ productId: Id, variantId: Id.nullable().default(null) }))
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
		}),
	),
});
export type ZoneTryResult = z.infer<typeof ZoneTryResult>;
