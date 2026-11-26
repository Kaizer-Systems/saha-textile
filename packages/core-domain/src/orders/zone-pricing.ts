import type {
	ZoneAddOnAdjust,
	ZoneCondition,
	ZoneConditionGroup,
	ZoneLinePrice,
	ZonePriceFormula,
	ZoneRule,
	ZoneRuleProblem,
} from '@saha-textile/contracts';

/**
 * Zone pricing for business orders (`DEC-B2B-ZONES`; owner's answers 2026-11-20).
 *
 * RETAIL (or a business on a zone that isn't live) pays the shop's price, sale included. A live zone
 * prices a line with the owner's own rules: tiers are fixed (product exceptions, then category rules,
 * then all-products rules) and within a tier the first enabled rule whose scope, dates, minimum
 * quantity and conditions match wins. No match in any tier: "Price not set for this zone". Zone
 * prices include GST, like shop prices. The trace is a list of codes the admin turns into plain words.
 */

export interface ZoneLineFacts {
	productId: string;
	sku: string;
	/** Each of the product's categories with its parents, nearest first. */
	categoryPaths: ReadonlyArray<readonly string[]>;
	/** Never touched by sales. Per metre for fabric sold by the metre. */
	regularSellingINR: number;
	/** Null when no sale is live. */
	currentSaleINR: number | null;
	mrpINR: number | null;
	purchaseCostINR: number | null;
	/** Pieces; for fabric by the metre, the length in metres (the cart's tenths ÷ 10). */
	quantity: number;
	/** Fabric by the metre: the cut's length in metres; null for pieces. Every price is then per metre. */
	metres: number | null;
	orderGoodsINR: number;
}

export interface ZoneForPricing {
	retail: boolean;
	live: boolean;
	rules: readonly ZoneRule[];
}

export interface ZonePricingResult {
	price: ZoneLinePrice;
	trace: string[];
}

const TIERS = ['product', 'category', 'allProducts'] as const;
const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

function fieldValue(field: ZoneCondition['field'], facts: ZoneLineFacts): number | string | boolean | string[] | null {
	switch (field) {
		case 'line.regularSellingINR':
			return facts.regularSellingINR;
		case 'line.currentSaleINR':
			return facts.currentSaleINR;
		case 'line.isOnSale':
			return facts.currentSaleINR !== null;
		case 'line.mrpINR':
			return facts.mrpINR;
		case 'line.purchaseCostINR':
			return facts.purchaseCostINR;
		case 'line.quantity':
			return facts.quantity;
		case 'line.metres':
			return facts.metres;
		case 'line.productId':
			return facts.productId;
		case 'line.categoryIds':
			return [...new Set(facts.categoryPaths.flat())];
		case 'order.goodsINR':
			return facts.orderGoodsINR;
	}
}

export function zoneConditionHolds(condition: ZoneCondition, facts: ZoneLineFacts): boolean {
	const actual = fieldValue(condition.field, facts);
	const value = condition.value;
	switch (condition.op) {
		case 'isEmpty':
			return actual === null || (Array.isArray(actual) && actual.length === 0);
		case 'isNotEmpty':
			return !(actual === null || (Array.isArray(actual) && actual.length === 0));
		case 'is':
			return Array.isArray(actual) ? typeof value === 'string' && actual.includes(value) : actual === value;
		case 'isNot':
			return Array.isArray(actual) ? !(typeof value === 'string' && actual.includes(value)) : actual !== value;
		case 'isOneOf': {
			const list = Array.isArray(value) ? value.map(String) : [];
			return Array.isArray(actual) ? actual.some((item) => list.includes(item)) : list.includes(String(actual));
		}
		case 'between':
			return (
				typeof actual === 'number' &&
				Array.isArray(value) &&
				value.length === 2 &&
				actual >= Number(value[0]) &&
				actual <= Number(value[1])
			);
		default: {
			if (typeof actual !== 'number' || typeof value !== 'number') return false;
			if (condition.op === 'moreThan') return actual > value;
			if (condition.op === 'atLeast') return actual >= value;
			if (condition.op === 'lessThan') return actual < value;
			return actual <= value;
		}
	}
}

export function zoneGroupHolds(group: ZoneConditionGroup, facts: ZoneLineFacts): boolean {
	const results = group.items.map((item) =>
		item.kind === 'group' ? zoneGroupHolds(item, facts) : zoneConditionHolds(item, facts),
	);
	if (!results.length) return true;
	return group.join === 'all' ? results.every(Boolean) : results.some(Boolean);
}

function baseValue(base: 'regularSelling' | 'currentSaleOrRegular' | 'mrp', facts: ZoneLineFacts): number {
	if (base === 'currentSaleOrRegular') return facts.currentSaleINR ?? facts.regularSellingINR;
	if (base === 'mrp') return facts.mrpINR ?? facts.regularSellingINR;
	return facts.regularSellingINR;
}

/**
 * `skip`: the formula doesn't fit this line (no break reached, or price per metre on a piece); the next
 * rule tries. A price says how add-ons could follow it: % off or ₹ off carry over; every other kind
 * (flat, per-variant flat, per metre, % above cost) leaves add-ons at their listed price.
 */
type FormulaOutcome =
	| { kind: 'price'; amount: number; addOns: ZoneAddOnAdjust | null }
	| { kind: 'noPrice' }
	| { kind: 'costUnknown' }
	| { kind: 'skip' };

export function evaluateZoneFormula(formula: ZonePriceFormula, facts: ZoneLineFacts): FormulaOutcome {
	switch (formula.kind) {
		case 'noPrice':
			return { kind: 'noPrice' };
		case 'flatPrice':
			return { kind: 'price', amount: formula.skuPrices[facts.sku] ?? formula.amountINR, addOns: null };
		case 'percentOffBase':
			return {
				kind: 'price',
				amount: (baseValue(formula.base, facts) * (100 - formula.percent)) / 100,
				addOns: { kind: 'percentOff', percent: formula.percent },
			};
		case 'amountOffBase':
			return {
				kind: 'price',
				amount: Math.max(0, baseValue(formula.base, facts) - formula.amountINR),
				addOns: { kind: 'amountOff', amountINR: formula.amountINR },
			};
		case 'percentAboveCost':
			return facts.purchaseCostINR === null
				? { kind: 'costUnknown' }
				: { kind: 'price', amount: facts.purchaseCostINR * (1 + formula.percent / 100), addOns: null };
		case 'pricePerMetre':
			// Prices of fabric by the metre are per metre; on a piece this formula doesn't apply.
			return facts.metres === null
				? { kind: 'skip' }
				: { kind: 'price', amount: formula.amountINR, addOns: null };
		case 'quantityBreaks': {
			const step = [...formula.breaks]
				.sort((a, b) => b.minQuantity - a.minQuantity)
				.find((row) => facts.quantity >= row.minQuantity);
			return step ? evaluateZoneFormula(step.formula, facts) : { kind: 'skip' };
		}
		case 'orderValueBreaks': {
			const step = [...formula.breaks]
				.sort((a, b) => b.minGoodsINR - a.minGoodsINR)
				.find((row) => facts.orderGoodsINR >= row.minGoodsINR);
			return step ? evaluateZoneFormula(step.formula, facts) : { kind: 'skip' };
		}
		case 'lowerOf':
		case 'higherOf': {
			const outcomes = formula.formulas.map((item) => evaluateZoneFormula(item, facts));
			const priced = outcomes.filter((outcome) => outcome.kind === 'price');
			if (!priced.length) return outcomes.find((outcome) => outcome.kind !== 'price') ?? { kind: 'noPrice' };
			// The formula that set the price decides what the add-ons do.
			return priced.reduce((best, outcome) =>
				(formula.kind === 'lowerOf' ? outcome.amount < best.amount : outcome.amount > best.amount)
					? outcome
					: best,
			);
		}
	}
}

/**
 * Whether a rule's "Also apply to stitching and add-ons" switch can do anything: only when some formula
 * in it is a % off or ₹ off. Flat prices, per-variant flat prices, price per metre, % above cost and no
 * price never touch add-ons, so the builder greys the switch for them.
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

/** An add-on's price under a zone rule: its listed price less the rule's % or ₹, never below ₹0. */
export function zoneAddOnPrice(listedINR: number, adjust: ZoneAddOnAdjust | null): number {
	if (!adjust || listedINR <= 0) return listedINR;
	if (adjust.kind === 'percentOff') return round2((listedINR * (100 - adjust.percent)) / 100);
	return round2(Math.max(0, listedINR - adjust.amountINR));
}

/** Up to the next ₹10, or the next amount ending in 9 (₹1,999). */
export function roundZonePrice(amount: number, rounding: ZoneRule['rounding']): number {
	if (rounding === 'upToTen') return Math.ceil(amount / 10) * 10;
	if (rounding === 'endingInNine') return Math.ceil((amount + 1) / 10) * 10 - 1;
	return round2(amount);
}

function inScope(rule: ZoneRule, facts: ZoneLineFacts): boolean {
	const scope = rule.scope;
	if (scope.tier === 'product') return scope.productIds.includes(facts.productId);
	if (scope.tier === 'category') {
		return facts.categoryPaths.some((path) =>
			path.some(
				(categoryId, index) =>
					scope.categoryIds.includes(categoryId) && (index === 0 || scope.includeSubcategories),
			),
		);
	}
	return true;
}

function ruleApplies(rule: ZoneRule, facts: ZoneLineFacts, now: Date): boolean {
	if (!rule.enabled) return false;
	const at = now.toISOString();
	if (rule.validFrom && at < rule.validFrom) return false;
	if (rule.validUntil && at > rule.validUntil) return false;
	if (rule.minQuantityPerLine !== null && facts.quantity < rule.minQuantityPerLine) return false;
	if (!inScope(rule, facts)) return false;
	return rule.when ? zoneGroupHolds(rule.when, facts) : true;
}

/** The price of one line for a business on a zone (GST included). */
export function zonePriceFor(zone: ZoneForPricing, facts: ZoneLineFacts, now = new Date()): ZonePricingResult {
	const retail = facts.currentSaleINR ?? facts.regularSellingINR;
	if (zone.retail || !zone.live) {
		return {
			price: {
				kind: 'priced',
				unitPriceINR: retail,
				retailUnitPriceINR: retail,
				rule: { tier: 'retail', ruleId: null, ruleName: '' },
				belowCost: false,
				addOns: null,
			},
			trace: [facts.currentSaleINR !== null ? 'retail:sale' : 'retail:regular'],
		};
	}
	for (const tier of TIERS) {
		for (const rule of zone.rules.filter((row) => row.scope.tier === tier)) {
			if (!ruleApplies(rule, facts, now)) continue;
			const outcome = evaluateZoneFormula(rule.price, facts);
			const trace = [`tier:${tier}`, `rule:${rule.id}`, `formula:${rule.price.kind}`];
			if (outcome.kind === 'skip') continue;
			if (outcome.kind === 'noPrice') return { price: { kind: 'noPrice', reason: 'ruleSaysNoPrice' }, trace };
			if (outcome.kind === 'costUnknown') return { price: { kind: 'noPrice', reason: 'costUnknown' }, trace };
			let amount = outcome.amount;
			if (rule.floorINR !== null && amount < rule.floorINR) {
				amount = rule.floorINR;
				trace.push('floor');
			}
			if (rule.ceilingINR !== null && amount > rule.ceilingINR) {
				amount = rule.ceilingINR;
				trace.push('ceiling');
			}
			amount = roundZonePrice(amount, rule.rounding);
			if (rule.rounding !== 'none') trace.push(`rounding:${rule.rounding}`);
			const belowCost = facts.purchaseCostINR !== null && amount < facts.purchaseCostINR;
			if (belowCost) trace.push('belowCost');
			// "Also apply to stitching and add-ons": only a % off or ₹ off carries over.
			const addOns = rule.addOns ? outcome.addOns : null;
			if (addOns) {
				trace.push(
					addOns.kind === 'percentOff'
						? `addOns:percentOff:${addOns.percent}`
						: `addOns:amountOff:${addOns.amountINR}`,
				);
			}
			return {
				price: {
					kind: 'priced',
					unitPriceINR: amount,
					retailUnitPriceINR: retail,
					rule: { tier, ruleId: rule.id, ruleName: rule.name },
					belowCost,
					addOns,
				},
				trace,
			};
		}
	}
	return { price: { kind: 'noPrice', reason: 'noRule' }, trace: ['noRule'] };
}

/** Mistakes the builder names before a zone can go live. */
export function zoneRuleProblems(rules: readonly ZoneRule[]): Array<{ ruleId: string; problem: ZoneRuleProblem }> {
	const problems: Array<{ ruleId: string; problem: ZoneRuleProblem }> = [];
	const NEEDS_VALUE = new Set(['is', 'isNot', 'isOneOf', 'moreThan', 'atLeast', 'lessThan', 'atMost', 'between']);
	const walk = (rule: ZoneRule, group: ZoneConditionGroup | null): void => {
		for (const item of group?.items ?? []) {
			if (item.kind === 'group') walk(rule, item);
			else if (NEEDS_VALUE.has(item.op) && (item.value === null || item.value === ''))
				problems.push({ ruleId: rule.id, problem: 'value_missing' });
			else if (
				item.op === 'between' &&
				Array.isArray(item.value) &&
				Number(item.value[0]) > Number(item.value[1])
			) {
				problems.push({ ruleId: rule.id, problem: 'impossible_condition' });
			}
		}
	};
	const breaksInOrder = (formula: ZonePriceFormula): boolean => {
		if (formula.kind === 'quantityBreaks') {
			const values = formula.breaks.map((row) => row.minQuantity);
			return new Set(values).size === values.length && formula.breaks.every((row) => breaksInOrder(row.formula));
		}
		if (formula.kind === 'orderValueBreaks') {
			const values = formula.breaks.map((row) => row.minGoodsINR);
			return new Set(values).size === values.length && formula.breaks.every((row) => breaksInOrder(row.formula));
		}
		if (formula.kind === 'lowerOf' || formula.kind === 'higherOf') return formula.formulas.every(breaksInOrder);
		return true;
	};
	for (const rule of rules) {
		walk(rule, rule.when);
		if (!breaksInOrder(rule.price)) problems.push({ ruleId: rule.id, problem: 'breaks_out_of_order' });
		if (rule.floorINR !== null && rule.ceilingINR !== null && rule.floorINR > rule.ceilingINR)
			problems.push({ ruleId: rule.id, problem: 'floor_above_ceiling' });
		if (rule.validFrom && rule.validUntil && rule.validUntil <= rule.validFrom)
			problems.push({ ruleId: rule.id, problem: 'ends_before_start' });
	}
	return problems;
}

/**
 * Whether any rule reads the purchase cost (a "% above purchase cost" price, or a condition on the
 * cost). Writing or trying such rules needs the cost permission, so staff without it never learn a
 * cost through a rule (P8).
 */
export function zoneRulesReadCost(rules: readonly ZoneRule[]): boolean {
	const formulaReads = (formula: ZonePriceFormula): boolean => {
		if (formula.kind === 'percentAboveCost') return true;
		if (formula.kind === 'quantityBreaks' || formula.kind === 'orderValueBreaks') {
			return formula.breaks.some((row) => formulaReads(row.formula));
		}
		if (formula.kind === 'lowerOf' || formula.kind === 'higherOf') return formula.formulas.some(formulaReads);
		return false;
	};
	const groupReads = (group: ZoneConditionGroup | null): boolean =>
		(group?.items ?? []).some((item) =>
			item.kind === 'group' ? groupReads(item) : item.field === 'line.purchaseCostINR',
		);
	return rules.some((rule) => formulaReads(rule.price) || groupReads(rule.when));
}
