import type {
	ZoneBase,
	ZoneCondition,
	ZoneConditionGroup,
	ZoneField,
	ZoneLinePrice,
	ZoneOperator,
	ZonePriceFormula,
	ZoneRule,
	ZoneRuleScope,
} from '@saha-textile/contracts';

/** Translates a key with its values (the page's Transloco). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** What kind of value a fact holds; it decides the operators and the value box. */
export type ZoneFieldType = 'money' | 'number' | 'yesNo' | 'product' | 'categories';

export const ZONE_FIELD_TYPES: Record<ZoneField, ZoneFieldType> = {
	'line.regularSellingINR': 'money',
	'line.currentSaleINR': 'money',
	'line.isOnSale': 'yesNo',
	'line.mrpINR': 'money',
	'line.purchaseCostINR': 'money',
	'line.quantity': 'number',
	'line.metres': 'number',
	'line.productId': 'product',
	'line.categoryIds': 'categories',
	'order.goodsINR': 'money',
};
export const ZONE_FIELDS = Object.keys(ZONE_FIELD_TYPES) as ZoneField[];

export const ZONE_OPERATORS: Record<ZoneFieldType, readonly ZoneOperator[]> = {
	money: ['moreThan', 'atLeast', 'lessThan', 'atMost', 'between', 'isEmpty', 'isNotEmpty'],
	number: ['moreThan', 'atLeast', 'lessThan', 'atMost', 'between', 'is'],
	yesNo: ['is'],
	product: ['isOneOf'],
	categories: ['isOneOf'],
};

export const ZONE_FORMULA_KINDS: ReadonlyArray<ZonePriceFormula['kind']> = [
	'percentOffBase',
	'amountOffBase',
	'flatPrice',
	'percentAboveCost',
	'pricePerMetre',
	'quantityBreaks',
	'orderValueBreaks',
	'lowerOf',
	'higherOf',
	'noPrice',
];
export const ZONE_BASES: readonly ZoneBase[] = ['regularSelling', 'currentSaleOrRegular', 'mrp'];
export const ZONE_TIERS: ReadonlyArray<ZoneRuleScope['tier']> = ['product', 'category', 'allProducts'];

let counter = 0;
/** A short id for a new rule, condition or group (unique within the zone). */
export function newZoneId(prefix: string): string {
	counter += 1;
	return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newZoneCondition(): ZoneCondition {
	return { kind: 'condition', id: newZoneId('c'), field: 'line.isOnSale', op: 'is', value: true };
}

export function newZoneGroup(): ZoneConditionGroup {
	return { kind: 'group', id: newZoneId('g'), join: 'all', items: [newZoneCondition()] };
}

/** A fresh formula of a kind, with sensible starting values. */
export function newZoneFormula(kind: ZonePriceFormula['kind']): ZonePriceFormula {
	switch (kind) {
		case 'percentOffBase':
			return { kind, base: 'regularSelling', percent: 10 };
		case 'amountOffBase':
			return { kind, base: 'regularSelling', amountINR: 100 };
		case 'flatPrice':
			return { kind, amountINR: 0, skuPrices: {} };
		case 'percentAboveCost':
			return { kind, percent: 30 };
		case 'pricePerMetre':
			return { kind, amountINR: 100 };
		case 'quantityBreaks':
			return { kind, breaks: [{ minQuantity: 10, formula: newZoneFormula('percentOffBase') }] };
		case 'orderValueBreaks':
			return { kind, breaks: [{ minGoodsINR: 50_000, formula: newZoneFormula('percentOffBase') }] };
		case 'lowerOf':
		case 'higherOf':
			return { kind, formulas: [newZoneFormula('percentOffBase'), newZoneFormula('amountOffBase')] };
		default:
			return { kind: 'noPrice' };
	}
}

export function newZoneRule(tier: ZoneRuleScope['tier']): ZoneRule {
	const scope: ZoneRuleScope =
		tier === 'product'
			? { tier, productIds: [] as unknown as [string] }
			: tier === 'category'
				? { tier, categoryIds: [] as unknown as [string], includeSubcategories: true }
				: { tier };
	return {
		id: newZoneId('r'),
		name: '',
		enabled: true,
		scope,
		when: null,
		price: newZoneFormula('percentOffBase'),
		rounding: 'none',
		floorINR: null,
		ceilingINR: null,
		minQuantityPerLine: null,
		validFrom: null,
		validUntil: null,
		addOns: false,
	};
}

/**
 * Whether a rule's "Also apply to stitching and add-ons" switch can do anything (owner, DEC-B2B-ZONES
 * 20 Nov): only a % off or ₹ off carries to add-ons, also inside breaks and lower-of / higher-of. The
 * same rule as core `zoneFormulaCanPriceAddOns`, which prices the order; the builder greys the switch
 * when this is false.
 */
export function zoneFormulaCanPriceAddOns(formula: ZonePriceFormula): boolean {
	switch (formula.kind) {
		case 'percentOffBase':
		case 'amountOffBase':
			return true;
		case 'quantityBreaks':
		case 'orderValueBreaks':
			return formula.breaks.some((step) => zoneFormulaCanPriceAddOns(step.formula));
		case 'lowerOf':
		case 'higherOf':
			return formula.formulas.some(zoneFormulaCanPriceAddOns);
		default:
			return false;
	}
}

// Every amount a rule words is a number: formulas hold numbers, and floor and ceiling are read only when set.
const rupees = (value: number): string => `₹${value.toLocaleString('en-IN')}`;

/** A formula in words: "10% less than the regular selling price". */
export function formulaWords(formula: ZonePriceFormula, t: Translate): string {
	switch (formula.kind) {
		case 'percentOffBase':
			return t('zone_words_percent_off', { percent: formula.percent, base: t(`zone_base_${formula.base}`) });
		case 'amountOffBase':
			return t('zone_words_amount_off', {
				amount: rupees(formula.amountINR),
				base: t(`zone_base_${formula.base}`),
			});
		case 'flatPrice': {
			const skus = Object.keys(formula.skuPrices).length;
			return skus
				? t('zone_words_flat_with_skus', { amount: rupees(formula.amountINR), count: skus })
				: t('zone_words_flat', { amount: rupees(formula.amountINR) });
		}
		case 'percentAboveCost':
			return t('zone_words_above_cost', { percent: formula.percent });
		case 'pricePerMetre':
			return t('zone_words_per_metre', { amount: rupees(formula.amountINR) });
		case 'quantityBreaks':
			return formula.breaks
				.map((step) =>
					t('zone_words_from_quantity', { count: step.minQuantity, then: formulaWords(step.formula, t) }),
				)
				.join('; ');
		case 'orderValueBreaks':
			return formula.breaks
				.map((step) =>
					t('zone_words_from_order', {
						amount: rupees(step.minGoodsINR),
						then: formulaWords(step.formula, t),
					}),
				)
				.join('; ');
		case 'lowerOf':
		case 'higherOf':
			return t(`zone_words_${formula.kind}`, {
				list: formula.formulas.map((row) => formulaWords(row, t)).join(t('zone_words_or')),
			});
		default:
			return t('zone_words_no_price');
	}
}

/** A condition in words: "the piece is on sale", "quantity is at least 10". */
export function conditionWords(
	condition: ZoneCondition,
	t: Translate,
	nameOf: (id: string) => string = (id) => id,
): string {
	const field = t(`zone_field_${condition.field.replace('.', '_')}`);
	const type = ZONE_FIELD_TYPES[condition.field];
	const value = condition.value;
	let shown = '';
	if (type === 'yesNo') shown = t(value === false ? 'zone_no' : 'zone_yes');
	else if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number')
		shown = `${type === 'money' ? rupees(value[0] as number) : value[0]}–${type === 'money' ? rupees(value[1] as number) : value[1]}`;
	else if (Array.isArray(value)) shown = (value as string[]).map(nameOf).join(', ');
	else if (typeof value === 'number') shown = type === 'money' ? rupees(value) : String(value);
	return `${field} ${t(`zone_op_${condition.op}`)} ${shown}`.trim();
}

export function groupWords(group: ZoneConditionGroup, t: Translate, nameOf?: (id: string) => string): string {
	const parts = group.items.map((item) =>
		item.kind === 'group' ? `(${groupWords(item, t, nameOf)})` : conditionWords(item, t, nameOf),
	);
	return parts.join(t(group.join === 'all' ? 'zone_words_and' : 'zone_words_or'));
}

/** One rule in plain words, as the builder's "In plain words" panel reads it. */
export function ruleWords(rule: ZoneRule, t: Translate, nameOf?: (id: string) => string): string {
	const scope =
		rule.scope.tier === 'product'
			? t('zone_words_scope_products', { count: rule.scope.productIds.length })
			: rule.scope.tier === 'category'
				? t(
						rule.scope.includeSubcategories
							? 'zone_words_scope_categories_subs'
							: 'zone_words_scope_categories',
						{
							list: rule.scope.categoryIds.map((id) => nameOf?.(id) ?? id).join(', '),
						},
					)
				: t('zone_words_scope_all');
	const when = rule.when?.items.length ? t('zone_words_when', { when: groupWords(rule.when, t, nameOf) }) : '';
	const extras = [
		rule.minQuantityPerLine ? t('zone_words_min_qty', { count: rule.minQuantityPerLine }) : '',
		rule.floorINR !== null ? t('zone_words_floor', { amount: rupees(rule.floorINR) }) : '',
		rule.ceilingINR !== null ? t('zone_words_ceiling', { amount: rupees(rule.ceilingINR) }) : '',
		rule.rounding !== 'none' ? t(`zone_rounding_${rule.rounding}`) : '',
		t(rule.addOns && zoneFormulaCanPriceAddOns(rule.price) ? 'zone_words_addons_same' : 'zone_words_addons_listed'),
	].filter(Boolean);
	const head = `${scope}${when}: ${formulaWords(rule.price, t)}`;
	return [head, ...extras].join('; ') + (rule.enabled ? '' : ` (${t('zone_words_off')})`);
}

/** Try it: what a line's stitching and add-ons cost under the rule that priced it. */
export function addOnTryWords(price: ZoneLinePrice, t: Translate): string {
	const adjust = price.kind === 'priced' ? price.addOns : null;
	if (!adjust) return t('zone_try_addons_listed');
	return adjust.kind === 'percentOff'
		? t('zone_try_addons_percent', { amount: String(adjust.percent) })
		: t('zone_try_addons_amount', { amount: adjust.amountINR.toLocaleString('en-IN') });
}

/** The engine's `addOns:percentOff:10` / `addOns:amountOff:500` trace step in words. */
export function addOnTraceWords(code: string, t: Translate): string {
	const [, kind = '', amount = ''] = code.split(':');
	return kind === 'percentOff'
		? t('zone_trace_addOns_percent', { amount })
		: t('zone_trace_addOns_amount', { amount: Number(amount).toLocaleString('en-IN') });
}
