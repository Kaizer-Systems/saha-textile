import type {
	BundlePriceRule,
	BundleRuleAction,
	BundleRuleAmount,
	BundleRuleCondition,
	BundleRuleFact,
	BundleRuleOperator,
} from '@saha-textile/contracts';

/**
 * The bundle rule blocks: what each fact is, which operators it takes, and whether a condition holds. The same
 * blocks serve the price method builder and each bundle's own Price rules tab (owner, 22 Nov 2026).
 */

export type BundleFactType = 'number' | 'money' | 'keys' | 'boolean' | 'date';

export const BUNDLE_FACT_TYPES: Readonly<Record<BundleRuleFact, BundleFactType>> = {
	'pieces.count': 'number',
	'pieces.subtotal': 'money',
	'pieces.separately': 'money',
	'level.pick': 'keys',
	'extras.has': 'keys',
	'extras.count': 'number',
	'pieces.onSale': 'boolean',
	date: 'date',
};

/** The operators each kind of fact accepts, in the order the builder lists them. */
export const BUNDLE_OPERATORS_BY_TYPE: Readonly<Record<BundleFactType, readonly BundleRuleOperator[]>> = {
	number: ['is', 'isNot', 'moreThan', 'atLeast', 'lessThan', 'atMost', 'between'],
	money: ['is', 'isNot', 'moreThan', 'atLeast', 'lessThan', 'atMost', 'between'],
	keys: ['isOneOf', 'isNotOneOf'],
	boolean: ['is'],
	date: ['before', 'after', 'between'],
};

/** Which actions change the price, and which change what the levels offer. */
export const PRICE_ACTIONS: ReadonlySet<BundleRuleAction['kind']> = new Set([
	'priceIs',
	'priceIsPieces',
	'percentOff',
	'amountOff',
	'makeExtraFree',
	'makePickFree',
]);
export const OFFER_ACTIONS: ReadonlySet<BundleRuleAction['kind']> = new Set(['requireExtra', 'limitLevel', 'hideItem']);

/** The facts one priced choice gives the rules. */
export interface BundleFacts {
	piecesCount: number;
	piecesSubtotal: number;
	piecesSeparately: number;
	picks: Readonly<Record<string, readonly string[]>>;
	extras: readonly string[];
	anyPieceOnSale: boolean;
	/** Today in India, `YYYY-MM-DD`. */
	today: string;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRange = (value: unknown): value is [number, number] =>
	Array.isArray(value) && value.length === 2 && value.every(isNumber);
const isKeyList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0);

/** Whether a condition's value has the shape its fact and operator need (a draft never does). */
export function conditionIsComplete(condition: BundleRuleCondition): boolean {
	const { fact, op, value } = condition;
	if (fact === null || op === null || value === null) return false;
	const type = BUNDLE_FACT_TYPES[fact];
	if (!BUNDLE_OPERATORS_BY_TYPE[type].includes(op)) return false;
	if (fact === 'level.pick' && !condition.level) return false;
	switch (type) {
		case 'number':
		case 'money':
			return op === 'between' ? isRange(value) && value[0] <= value[1] : isNumber(value);
		case 'keys':
			return isKeyList(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'date':
			return op === 'between'
				? Array.isArray(value) &&
						value.length === 2 &&
						value.every(isDate) &&
						String(value[0]) <= String(value[1])
				: isDate(value);
	}
}

type NumericOperator = 'is' | 'isNot' | 'moreThan' | 'atLeast' | 'lessThan' | 'atMost' | 'between';

/** How each number operator compares; a lookup table, so no operator is left without a test. */
const NUMERIC_TESTS: Readonly<Record<NumericOperator, (fact: number, value: unknown) => boolean>> = {
	is: (fact, value) => fact === value,
	isNot: (fact, value) => fact !== value,
	moreThan: (fact, value) => fact > (value as number),
	atLeast: (fact, value) => fact >= (value as number),
	lessThan: (fact, value) => fact < (value as number),
	atMost: (fact, value) => fact <= (value as number),
	between: (fact, value) => {
		const [low, high] = value as [number, number];
		return fact >= low && fact <= high;
	},
};

/** `op` is a number operator: `conditionIsComplete` admits no other for a number or money fact. */
function numericHolds(fact: number, op: BundleRuleOperator, value: unknown): boolean {
	return NUMERIC_TESTS[op as NumericOperator](fact, value);
}

/** Whether one condition holds for these facts. An unfinished condition never holds. */
export function bundleConditionHolds(condition: BundleRuleCondition, facts: BundleFacts): boolean {
	if (!conditionIsComplete(condition)) return false;
	const { fact, op, value } = condition as { fact: BundleRuleFact; op: BundleRuleOperator; value: unknown };
	switch (fact) {
		case 'pieces.count':
			return numericHolds(facts.piecesCount, op, value);
		case 'pieces.subtotal':
			return numericHolds(facts.piecesSubtotal, op, value);
		case 'pieces.separately':
			return numericHolds(facts.piecesSeparately, op, value);
		case 'extras.count':
			return numericHolds(facts.extras.length, op, value);
		case 'pieces.onSale':
			return facts.anyPieceOnSale === value;
		case 'level.pick':
		case 'extras.has': {
			// A complete level.pick condition always names its level (conditionIsComplete).
			const chosen = fact === 'extras.has' ? facts.extras : (facts.picks[condition.level as string] ?? []);
			const hit = (value as string[]).some((key) => chosen.includes(key));
			return op === 'isOneOf' ? hit : !hit;
		}
		case 'date': {
			if (op === 'before') return facts.today < (value as string);
			if (op === 'after') return facts.today > (value as string);
			const [from, to] = value as [string, string];
			return facts.today >= from && facts.today <= to;
		}
	}
}

/** Whether a rule's "If" holds. No conditions means always. */
export function ruleMatches(rule: BundlePriceRule, facts: BundleFacts): boolean {
	const conditions = rule.when.conditions;
	if (conditions.length === 0) return true;
	return rule.when.match === 'any'
		? conditions.some((condition) => bundleConditionHolds(condition, facts))
		: conditions.every((condition) => bundleConditionHolds(condition, facts));
}

/** The actions a list of rules runs, in order: "first" stops at the first rule whose If holds. */
export function actionsFor(
	rules: readonly BundlePriceRule[],
	combine: 'first' | 'all',
	facts: BundleFacts,
): { actions: BundleRuleAction[]; applied: string[] } {
	const actions: BundleRuleAction[] = [];
	const applied: string[] = [];
	for (const rule of rules) {
		if (!rule.enabled) continue;
		const hit = ruleMatches(rule, facts);
		const run = hit ? rule.then : rule.otherwise;
		if (run.length > 0) {
			actions.push(...run);
			applied.push(rule.id);
		}
		if (hit && combine === 'first') break;
	}
	return { actions, applied };
}

/** A rule amount: the number typed in the rule, or the bundle's value for one of the method's inputs. */
export function amountOf(amount: BundleRuleAmount | null, params: Readonly<Record<string, number>>): number | null {
	if (amount === null) return null;
	if (typeof amount === 'number') return amount;
	const value = params[amount.input];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
