import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';

/**
 * Shipping rule sets (owner, 2026-11-19; brief https://claude.ai/artifact/FzAxc1XfEyMr8dsWvVsmdE).
 *
 * Every way of charging shipping is a rule set built in the admin's rule builder: a short list of
 * steps, each a loop (each line, the whole cart, each unit) over a decision tree that ends in a
 * result (an amount, the product's own charge, first and further units, free, can't ship, a courier
 * quote). Saha Textile's own rules are rule sets like any other, never code. These schemas are
 * structural only: a draft may hold empty amounts or a branch with no result. Whether a rule set
 * can go live is decided by `validateShippingRuleSet` in core-domain.
 *
 * Every amount is in rupees. Shoppers paying in another currency see the converted figure.
 */

/** Whether the delivery address is in the shop's home country. */
export const ShippingZone = z.enum(['domestic', 'international']);
export type ShippingZone = z.infer<typeof ShippingZone>;

/** Which zone a rule set is meant for; `both` may be chosen for either. */
export const ShippingRuleSetUse = z.enum(['domestic', 'international', 'both']);
export type ShippingRuleSetUse = z.infer<typeof ShippingRuleSetUse>;

/** The three charges a category sets and a product may override. */
export const ShippingChargeKind = z.enum(['domestic', 'internationalFirst', 'internationalFurther']);
export type ShippingChargeKind = z.infer<typeof ShippingChargeKind>;

/** A rupee amount a rule or a charge holds (two decimals at most). */
export const ShippingAmountINR = z
	.number()
	.finite()
	.nonnegative()
	.max(10_000_000)
	.refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, { message: 'two_decimals' });
export type ShippingAmountINR = z.infer<typeof ShippingAmountINR>;

/** A rupee amount a draft may leave empty. */
const DraftAmount = ShippingAmountINR.nullable();

/** Short id for a block, unique inside its rule set; errors and the builder point at it. */
export const ShippingBlockId = z.string().regex(/^[a-z0-9-]{1,40}$/);

/**
 * What a condition can look at. The prefix is the scope: `line.*` needs a line or unit loop,
 * `cart.*`, `delivery.*` and `shopper.*` work everywhere. `cart.*` always describes the whole
 * cart, even when a cart mixes rule sets.
 */
export const ShippingConditionField = z.enum([
	'line.discounted',
	'line.quantity',
	'line.sellingPrice',
	'line.mrp',
	'line.discountPercent',
	'line.onSaleEvent',
	'line.category',
	'line.mainCategory',
	'line.product',
	'line.soldBy',
	'line.madeToOrder',
	'line.chargeableWeight',
	'line.charge.domestic',
	'line.charge.internationalFirst',
	'line.charge.internationalFurther',
	'cart.subtotal',
	'cart.units',
	'cart.lines',
	'cart.chargeableWeight',
	'cart.hasMadeToOrder',
	'delivery.country',
	'delivery.state',
	'delivery.pincode',
	'delivery.zone',
	'shopper.signedIn',
	'shopper.group',
	'shopper.firstOrder',
]);
export type ShippingConditionField = z.infer<typeof ShippingConditionField>;

/** Fields a "Choose by value" block can band on. */
export const ShippingBandField = z.enum([
	'line.quantity',
	'line.sellingPrice',
	'line.chargeableWeight',
	'cart.subtotal',
	'cart.units',
	'cart.lines',
	'cart.chargeableWeight',
]);
export type ShippingBandField = z.infer<typeof ShippingBandField>;

export const ShippingOperator = z.enum([
	'is',
	'isNot',
	'isOneOf',
	'isNotOneOf',
	'moreThan',
	'atLeast',
	'lessThan',
	'atMost',
	'between',
	'startsWith',
]);
export type ShippingOperator = z.infer<typeof ShippingOperator>;

/** A condition's value: a yes/no, a number, a text or id, a list, or a `between` range. */
export const ShippingConditionValue = z.union([
	z.boolean(),
	z.number().finite(),
	z.string().max(200),
	z.array(z.string().max(200)).max(200),
	z.tuple([z.number().finite(), z.number().finite()]),
]);
export type ShippingConditionValue = z.infer<typeof ShippingConditionValue>;

export const ShippingCondition = z.object({
	kind: z.literal('condition'),
	id: ShippingBlockId,
	field: ShippingConditionField.nullable(),
	op: ShippingOperator.nullable(),
	value: ShippingConditionValue.nullable(),
});
export type ShippingCondition = z.infer<typeof ShippingCondition>;

export interface ShippingConditionGroup {
	kind: 'group';
	id: string;
	/** `all`: every item must hold (AND). `any`: one is enough (OR). */
	join: 'all' | 'any';
	items: Array<ShippingCondition | ShippingConditionGroup>;
}
export const ShippingConditionGroup: z.ZodType<ShippingConditionGroup> = z.object({
	kind: z.literal('group'),
	id: ShippingBlockId,
	join: z.enum(['all', 'any']),
	items: z.array(z.union([ShippingCondition, z.lazy(() => ShippingConditionGroup)])).max(30),
});

/** Where an amount comes from: typed into the rule, or the product's own charge. */
export const ShippingAmountSource = z.discriminatedUnion('from', [
	z.object({ from: z.literal('fixed'), amount: DraftAmount }),
	z.object({ from: z.literal('product'), charge: ShippingChargeKind }),
]);
export type ShippingAmountSource = z.infer<typeof ShippingAmountSource>;

/**
 * What a branch ends in.
 * - `amount`: `once` is once per line in a line loop, once per order for the whole cart; `unit` per
 *   unit; `kg` per kilogram or part of one (chargeable weight).
 * - `percent`: of the line's selling value, or of the cart subtotal.
 * - `productCharge`: the product's own charge (product, else its category, else the shop default).
 * - `firstAndFurther`: the first unit at one amount, every further unit at another. Across the cart,
 *   the first unit is the one with the highest first-unit amount.
 * - `cantShip`: checkout stops for the line with the message given.
 * - `courierQuote`: the zone's connected courier prices it.
 */
export const ShippingResult = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('amount'), amount: DraftAmount, per: z.enum(['once', 'unit', 'kg']) }),
	z.object({
		kind: z.literal('percent'),
		percent: z.number().finite().min(0).max(100).nullable(),
		of: z.enum(['line', 'cart']),
	}),
	z.object({ kind: z.literal('productCharge'), charge: ShippingChargeKind, per: z.enum(['once', 'unit']) }),
	z.object({
		kind: z.literal('firstAndFurther'),
		first: ShippingAmountSource,
		further: ShippingAmountSource,
		count: z.enum(['acrossCart', 'perProduct']),
	}),
	z.object({ kind: z.literal('free') }),
	z.object({ kind: z.literal('cantShip'), message: LocalizedText.default({}) }),
	z.object({ kind: z.literal('courierQuote') }),
]);
export type ShippingResult = z.infer<typeof ShippingResult>;
export type ShippingResultKind = ShippingResult['kind'];

export interface ShippingResultNode {
	kind: 'result';
	id: string;
	result: ShippingResult;
}
export interface ShippingIfNode {
	kind: 'if';
	id: string;
	when: ShippingConditionGroup;
	then: ShippingNode | null;
	/** Empty: whatever the conditions don't match gets no result (a draft may stay so; going live can't). */
	otherwise: ShippingNode | null;
}
export interface ShippingBand {
	id: string;
	/** Inclusive lower bound; null = no lower bound. */
	from: number | null;
	/** Exclusive upper bound; null = no upper bound. */
	to: number | null;
	then: ShippingNode | null;
}
export interface ShippingBandsNode {
	kind: 'bands';
	id: string;
	field: ShippingBandField | null;
	bands: ShippingBand[];
	otherwise: ShippingNode | null;
}
export type ShippingNode = ShippingResultNode | ShippingIfNode | ShippingBandsNode;

const ResultNode = z.object({ kind: z.literal('result'), id: ShippingBlockId, result: ShippingResult });
export const ShippingNode: z.ZodType<ShippingNode> = z.lazy(() =>
	z.union([
		ResultNode,
		z.object({
			kind: z.literal('if'),
			id: ShippingBlockId,
			when: ShippingConditionGroup,
			then: ShippingNode.nullable(),
			otherwise: ShippingNode.nullable(),
		}),
		z.object({
			kind: z.literal('bands'),
			id: ShippingBlockId,
			field: ShippingBandField.nullable(),
			bands: z
				.array(
					z.object({
						id: ShippingBlockId,
						from: z.number().finite().nonnegative().nullable(),
						to: z.number().finite().nonnegative().nullable(),
						then: ShippingNode.nullable(),
					}),
				)
				.max(30),
			otherwise: ShippingNode.nullable(),
		}),
	]),
);

/** A loop: what the decision tree is worked out for, and how a loop's results add up. */
export const ShippingStep = z.object({
	id: ShippingBlockId,
	scope: z.enum(['eachLine', 'wholeCart', 'eachUnit']),
	node: ShippingNode.nullable(),
	/** How the results of a line or unit loop combine; ignored for the whole cart. */
	combine: z.enum(['sum', 'highest', 'lowest']).default('sum'),
});
export type ShippingStep = z.infer<typeof ShippingStep>;

/** Changes to the total, applied in order after every step has been added up. */
export const ShippingAdjust = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('minimum'), id: ShippingBlockId, amount: DraftAmount }),
	z.object({ kind: z.literal('maximum'), id: ShippingBlockId, amount: DraftAmount }),
	z.object({ kind: z.literal('roundUp'), id: ShippingBlockId, to: DraftAmount }),
	/** Free when the whole cart's subtotal is at least this amount. */
	z.object({ kind: z.literal('freeAbove'), id: ShippingBlockId, subtotal: DraftAmount }),
]);
export type ShippingAdjust = z.infer<typeof ShippingAdjust>;

/** The blocks of a rule set. Steps are added up; then the adjustments run in order. */
export const ShippingRuleSetBody = z.object({
	steps: z.array(ShippingStep).max(10),
	adjust: z.array(ShippingAdjust).max(10).default([]),
});
export type ShippingRuleSetBody = z.infer<typeof ShippingRuleSetBody>;

/* ---------------------------------------------------------------------------------------------- */
/* What the engine prices: a cart snapshot built on the server from the live products.            */
/* ---------------------------------------------------------------------------------------------- */

/** The three charges as resolved for one line (product → main category → parents → shop default). */
export const ShippingCharges = z.object({
	domestic: ShippingAmountINR,
	internationalFirst: ShippingAmountINR,
	internationalFurther: ShippingAmountINR,
});
export type ShippingCharges = z.infer<typeof ShippingCharges>;

export const ShippingSnapshotLine = z.object({
	lineId: Id,
	productId: Id,
	/** Every category the product sits in. */
	categoryIds: z.array(Id),
	mainCategoryId: Id.nullable(),
	/** The main category's parents, nearest first; exceptions on them reach the line when they include sub-categories. */
	mainCategoryAncestorIds: z.array(Id).default([]),
	/** The product's Free shipping switch: ships free in both zones, whatever the rule sets say. */
	freeShipping: z.boolean().default(false),
	/** Units: pieces; a length of fabric is one unit. */
	units: z.number().int().positive(),
	/** Per unit, after any sale event, before coupons. */
	sellingPriceINR: z.number().nonnegative(),
	mrpINR: z.number().nonnegative().nullable(),
	onSaleEvent: z.boolean(),
	soldBy: z.enum(['piece', 'metre']),
	madeToOrder: z.boolean(),
	/** Per unit, grams: the larger of actual and volumetric; null when the product has neither. */
	chargeableWeightGrams: z.number().nonnegative().nullable(),
	charges: ShippingCharges,
});
export type ShippingSnapshotLine = z.infer<typeof ShippingSnapshotLine>;

export const ShippingSnapshotDelivery = z.object({
	/** ISO 3166-1 alpha-2. */
	country: z.string().length(2),
	state: z.string().max(80).nullable().default(null),
	pincode: z.string().max(20).nullable().default(null),
});
export type ShippingSnapshotDelivery = z.infer<typeof ShippingSnapshotDelivery>;

export const ShippingSnapshotShopper = z.object({
	signedIn: z.boolean(),
	groups: z.array(z.string().max(60)).max(20).default([]),
	firstOrder: z.boolean(),
});
export type ShippingSnapshotShopper = z.infer<typeof ShippingSnapshotShopper>;

export const ShippingCartSnapshot = z.object({
	lines: z.array(ShippingSnapshotLine).max(500),
	delivery: ShippingSnapshotDelivery,
	shopper: ShippingSnapshotShopper,
});
export type ShippingCartSnapshot = z.infer<typeof ShippingCartSnapshot>;

/** One worked-out piece of a rule set, for Try it, the order record and the shop's reason line. */
export const ShippingTraceEntry = z.object({
	stepId: z.string(),
	/** The lines this entry priced (one for a line or unit loop; all the group's lines for the cart). */
	lineIds: z.array(z.string()),
	/** The blocks taken, outermost first. */
	path: z.array(z.string()),
	/** `none`: the branch taken has no result (only possible in a draft). */
	result: z.enum([
		'amount',
		'percent',
		'productCharge',
		'firstAndFurther',
		'free',
		'cantShip',
		'courierQuote',
		'none',
	]),
	amountINR: z.number().nonnegative(),
	units: z.number().int().nonnegative().optional(),
	unitAmountINR: z.number().nonnegative().optional(),
	firstINR: z.number().nonnegative().optional(),
	furtherUnits: z.number().int().nonnegative().optional(),
	furtherINR: z.number().nonnegative().optional(),
	kg: z.number().nonnegative().optional(),
	percent: z.number().nonnegative().optional(),
});
export type ShippingTraceEntry = z.infer<typeof ShippingTraceEntry>;

/* ---------------------------------------------------------------------------------------------- */
/* Stored rule sets, versions, test carts                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** A cart kept with a rule set; every one must still give its expected amount before a version goes live. */
export const ShippingTestCart = z.object({
	id: ShippingBlockId,
	name: z.string().trim().min(1).max(80),
	lines: z
		.array(
			z.object({
				productId: Id,
				variationId: Id.nullable().default(null),
				quantity: z.number().int().positive().max(99),
			}),
		)
		.min(1)
		.max(50),
	delivery: ShippingSnapshotDelivery,
	shopper: ShippingSnapshotShopper.default({ signedIn: true, groups: [], firstOrder: false }),
	/** Null until the owner accepts the amount it gives. */
	expectedINR: z.number().nonnegative().nullable(),
});
export type ShippingTestCart = z.infer<typeof ShippingTestCart>;

export const ShippingRuleSet = z.object({
	id: Id,
	name: z.string().trim().min(1).max(80),
	description: z.string().trim().max(300).default(''),
	use: ShippingRuleSetUse,
	/** Pre-made rule sets are seeded, locked and the same for every business; copies are `own`. */
	kind: z.enum(['premade', 'own']),
	/** Stable key of a pre-made rule set (`add-per-unit`, `highest-only`, …). */
	premadeKey: z.string().max(40).nullable().default(null),
	copiedFromId: Id.nullable().default(null),
	/** The version checkout uses; null until it is first made active. */
	activeVersion: z.number().int().positive().nullable().default(null),
	/** The working copy; equals the active version's body when there are no unsaved changes. */
	draft: ShippingRuleSetBody,
	/** True when the working copy differs from the active version. */
	hasDraftChanges: z.boolean().default(true),
	testCarts: z.array(ShippingTestCart).max(20).default([]),
	/** Optimistic concurrency: a save names the revision it started from. */
	revision: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type ShippingRuleSet = z.infer<typeof ShippingRuleSet>;

/** A version made active; never changed afterwards. Orders point at it. */
export const ShippingRuleSetVersion = z.object({
	ruleSetId: Id,
	version: z.number().int().positive(),
	body: ShippingRuleSetBody,
	activatedAt: IsoDateTime,
	activatedBy: z.string().nullable().default(null),
	/** Test carts whose amount changed and were accepted on purpose when this version went live. */
	acceptedChanges: z
		.array(z.object({ testCartId: z.string(), fromINR: z.number().nullable(), toINR: z.number() }))
		.default([]),
});
export type ShippingRuleSetVersion = z.infer<typeof ShippingRuleSetVersion>;

/* ---------------------------------------------------------------------------------------------- */
/* Where rule sets apply                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** What an exception does in one zone. `siteWide` leaves the zone's own choice in place. */
export const ShippingExceptionChoice = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('siteWide') }),
	z.object({ kind: z.literal('ruleSet'), ruleSetId: Id }),
	z.object({ kind: z.literal('free') }),
	z.object({ kind: z.literal('cantShip') }),
]);
export type ShippingExceptionChoice = z.infer<typeof ShippingExceptionChoice>;

export const ShippingException = z.object({
	id: Id,
	target: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('category'), categoryId: Id, includeSubcategories: z.boolean().default(true) }),
		z.object({ kind: z.literal('product'), productId: Id }),
	]),
	domestic: ShippingExceptionChoice,
	international: ShippingExceptionChoice,
	note: z.string().trim().max(200).default(''),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type ShippingException = z.infer<typeof ShippingException>;

/** How one zone is priced: a rule set, or a courier quote with a rule set to fall back on. */
export const ShippingZoneMethod = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('ruleSet'), ruleSetId: Id.nullable() }),
	z.object({
		kind: z.literal('courier'),
		courierId: z.string().min(1).max(40),
		fallbackRuleSetId: Id.nullable(),
		/** Added on top of the courier's quote. */
		extra: z
			.discriminatedUnion('kind', [
				z.object({ kind: z.literal('amount'), value: ShippingAmountINR }),
				z.object({ kind: z.literal('percent'), value: z.number().finite().min(0).max(100) }),
			])
			.nullable()
			.default(null),
	}),
]);
export type ShippingZoneMethod = z.infer<typeof ShippingZoneMethod>;

/**
 * Named processing paths for orders delivered outside the home country (owner, 2026-11-19).
 * - `exportOffIndianInvoice` (Saha Textile): no export; every order is invoiced with GST to an
 *   address in India (billing, else delivery, else the one given at checkout, else staff add it).
 * - `standardExport`: designed, not built; its CA questions wait in tax-compliance-future-expansion.
 * - `indiaOnly`: delivery outside the home country is refused.
 */
export const AbroadOrderPolicy = z.enum(['exportOffIndianInvoice', 'standardExport', 'indiaOnly']);
export type AbroadOrderPolicy = z.infer<typeof AbroadOrderPolicy>;

/** The policies the shop can run today; `standardExport` can't be chosen until it is built. */
export const BUILT_ABROAD_ORDER_POLICIES = [
	'exportOffIndianInvoice',
	'indiaOnly',
] as const satisfies readonly AbroadOrderPolicy[];

export const ShippingSettings = z.object({
	/** ISO 3166-1 alpha-2; the delivery address decides the zone against it. */
	homeCountry: z.string().length(2).default('IN'),
	domestic: ShippingZoneMethod,
	international: ShippingZoneMethod,
	/** When lines of one cart fall under different rule sets: add their totals, or charge the highest. */
	mixedRuleSets: z.enum(['sum', 'highest']).default('sum'),
	/** The last fallback for the three charges. */
	defaultCharges: ShippingCharges,
	/** A new shop starts on `indiaOnly`; Saha Textile chooses `exportOffIndianInvoice` in the admin. */
	abroadPolicy: AbroadOrderPolicy.default('indiaOnly'),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type ShippingSettings = z.infer<typeof ShippingSettings>;

/* ---------------------------------------------------------------------------------------------- */
/* Charges on categories and products                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** A category's shipping values; empty inherits from the parent category, then the shop default. */
export const CategoryShipping = z.object({
	domesticINR: ShippingAmountINR.nullable().default(null),
	internationalFirstINR: ShippingAmountINR.nullable().default(null),
	internationalFurtherINR: ShippingAmountINR.nullable().default(null),
	/** Defaults for products that set none: weight and box, used for chargeable weight. */
	weightGrams: z.number().nonnegative().max(1_000_000).nullable().default(null),
	lengthCm: z.number().nonnegative().max(1000).nullable().default(null),
	widthCm: z.number().nonnegative().max(1000).nullable().default(null),
	heightCm: z.number().nonnegative().max(1000).nullable().default(null),
});
export type CategoryShipping = z.infer<typeof CategoryShipping>;

/** A product's own charges; empty uses its main category's. */
export const ProductShippingCharges = z.object({
	domesticINR: ShippingAmountINR.nullable().default(null),
	internationalFirstINR: ShippingAmountINR.nullable().default(null),
	internationalFurtherINR: ShippingAmountINR.nullable().default(null),
});
export type ProductShippingCharges = z.infer<typeof ProductShippingCharges>;
