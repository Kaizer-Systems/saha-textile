import { z } from 'zod';

import { I18nString, Id, IsoDateTime } from './common';

/**
 * Price rules for bundles (owner, 22 Nov 2026: the "Set price is" list is not built into the code; price
 * methods are records made in a builder, and each bundle may add its own rules on the same blocks).
 *
 * A rule is "If <conditions> then <actions>, otherwise <actions>". Conditions read facts about the shopper's
 * picks; actions change the set price or what a level offers. Nothing here runs code: the core engine reads
 * these blocks, so a rule saved in admin can never do more than the blocks allow.
 */

/** What a condition can look at. `level.pick` and `extras.has` compare item keys. */
export const BundleRuleFact = z.enum([
	'pieces.count',
	'pieces.subtotal',
	'pieces.separately',
	'level.pick',
	'extras.has',
	'extras.count',
	'pieces.onSale',
	'date',
]);
export type BundleRuleFact = z.infer<typeof BundleRuleFact>;

export const BundleRuleOperator = z.enum([
	'is',
	'isNot',
	'moreThan',
	'atLeast',
	'lessThan',
	'atMost',
	'between',
	'isOneOf',
	'isNotOneOf',
	'before',
	'after',
]);
export type BundleRuleOperator = z.infer<typeof BundleRuleOperator>;

/** One condition. A draft (any part still null) never holds, so a half-written rule can be tried safely. */
export const BundleRuleCondition = z.object({
	fact: BundleRuleFact.nullable(),
	/** The level a `level.pick` condition reads. */
	level: z.string().min(1).nullable().default(null),
	op: BundleRuleOperator.nullable(),
	value: z
		.union([z.number(), z.boolean(), z.string(), z.array(z.string()), z.tuple([z.number(), z.number()])])
		.nullable(),
});
export type BundleRuleCondition = z.infer<typeof BundleRuleCondition>;

export const BundleRuleConditionGroup = z.object({
	match: z.enum(['all', 'any']).default('all'),
	/** Empty means "always". */
	conditions: z.array(BundleRuleCondition).max(20).default([]),
});
export type BundleRuleConditionGroup = z.infer<typeof BundleRuleConditionGroup>;

/** A number typed in the rule, or one of the method's inputs ("the % off typed on the bundle"). */
export const BundleRuleAmount = z.union([z.number().finite(), z.object({ input: z.string().min(1) })]);
export type BundleRuleAmount = z.infer<typeof BundleRuleAmount>;

export const BundleRuleActionKind = z.enum([
	/** The set price becomes this amount. */
	'priceIs',
	/** The set price becomes the chosen pieces added up (their Price in this set). */
	'priceIsPieces',
	'percentOff',
	'amountOff',
	/** Listed extras cost nothing. */
	'makeExtraFree',
	/** Listed picks of a level cost nothing (a "free item" level, buy one get one). */
	'makePickFree',
	/** The shopper must take these extras. */
	'requireExtra',
	/** The level offers only these items. */
	'limitLevel',
	/** The level stops offering these items. */
	'hideItem',
]);
export type BundleRuleActionKind = z.infer<typeof BundleRuleActionKind>;

export const BundleRuleAction = z.object({
	kind: BundleRuleActionKind,
	amount: BundleRuleAmount.nullable().default(null),
	level: z.string().min(1).nullable().default(null),
	items: z.array(z.string().min(1)).max(50).default([]),
});
export type BundleRuleAction = z.infer<typeof BundleRuleAction>;

export const BundlePriceRule = z.object({
	id: z.string().min(1),
	/** Optional name shown in the list ("3 or more: 10% off"). */
	name: z.string().max(120).nullable().default(null),
	enabled: z.boolean().default(true),
	when: BundleRuleConditionGroup.default({ match: 'all', conditions: [] }),
	then: z.array(BundleRuleAction).max(10).default([]),
	otherwise: z.array(BundleRuleAction).max(10).default([]),
});
export type BundlePriceRule = z.infer<typeof BundlePriceRule>;

/** A number the admin types on each bundle that uses the method ("% off", "Set price"). */
export const BundleMethodInput = z.object({
	code: z.string().regex(/^[a-z][a-zA-Z0-9]{0,30}$/),
	label: I18nString,
	kind: z.enum(['money', 'percent', 'number']),
	min: z.number().nullable().default(null),
	max: z.number().nullable().default(null),
	default: z.number().nullable().default(null),
});
export type BundleMethodInput = z.infer<typeof BundleMethodInput>;

/**
 * Where a set price starts. `fixed`: an amount typed on the bundle (the input named by `input`); a pick dearer
 * than its level's included piece adds the difference (owner, 21 Nov 2026). `pieces`: the chosen pieces added up.
 */
export const BundleMethodBase = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('fixed'), input: z.string().min(1) }),
	z.object({ kind: z.literal('pieces') }),
]);
export type BundleMethodBase = z.infer<typeof BundleMethodBase>;

/** "Only the first rule that matches" or "every rule that matches, in order". */
export const BundleRuleCombine = z.enum(['first', 'all']);
export type BundleRuleCombine = z.infer<typeof BundleRuleCombine>;

/** A price method: one entry of the "Set price is" list, made in the price method builder. */
export const BundlePriceMethod = z.object({
	id: Id,
	code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
	name: I18nString,
	/** One line of help under the list ("The pieces' prices, less a % you choose"). */
	help: I18nString,
	inputs: z.array(BundleMethodInput).max(6).default([]),
	base: BundleMethodBase,
	rules: z.array(BundlePriceRule).max(20).default([]),
	combine: BundleRuleCombine.default('all'),
	active: z.boolean().default(true),
	/** Made by the seed (the five shown in the brief). They can be edited like any other. */
	seeded: z.boolean().default(false),
	/** Bumped on every save; a bundle priced with an older version keeps working (rules are read at price time). */
	version: z.number().int().positive().default(1),
	sortOrder: z.number().int().default(0),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type BundlePriceMethod = z.infer<typeof BundlePriceMethod>;

/** The method builder's form. */
export const BundlePriceMethodWrite = BundlePriceMethod.omit({
	id: true,
	seeded: true,
	version: true,
	createdAt: true,
	updatedAt: true,
});
export type BundlePriceMethodWrite = z.infer<typeof BundlePriceMethodWrite>;

/** One row of Products › Bundle price methods, with how many bundles use it. */
export const BundlePriceMethodRow = BundlePriceMethod.extend({ usedBy: z.number().int().nonnegative() });
export type BundlePriceMethodRow = z.infer<typeof BundlePriceMethodRow>;
