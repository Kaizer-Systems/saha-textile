import type {
	BundleMethodInput,
	BundlePriceRule,
	BundleRuleAction,
	BundleRuleCondition,
} from '@saha-textile/contracts';

type Words = (key: string, params?: Record<string, unknown>) => string;

const MONEY_ACTIONS = new Set<BundleRuleAction['kind']>(['priceIs', 'amountOff']);

function valueText(condition: BundleRuleCondition): string {
	const value = condition.value;
	if (Array.isArray(value)) return value.join(', ');
	return String(value ?? '');
}

function amountText(action: BundleRuleAction, numbers: readonly BundleMethodInput[], lang: 'en' | 'bn'): string {
	const amount = action.amount;
	if (amount === null || amount === undefined) return '';
	if (typeof amount !== 'number') {
		const named = numbers.find((row) => row.code === amount.input);
		return named ? named.label[lang] || named.label['en'] || named.code : amount.input;
	}
	if (action.kind === 'percentOff') return `${amount}%`;
	return MONEY_ACTIONS.has(action.kind) ? `₹${amount.toLocaleString('en-IN')}` : String(amount);
}

/**
 * A rule "In plain words" (bundle builder brief C04–C05): "If Pieces in the set is at least 3: % off 10%". Built from
 * the same words as the rule builder's own lists, so it reads in the admin's language.
 */
export function ruleSentence(
	rule: BundlePriceRule,
	t: Words,
	numbers: readonly BundleMethodInput[] = [],
	lang: 'en' | 'bn' = 'en',
): string {
	const conditions = rule.when.conditions.map((condition) =>
		[
			condition.fact ? t(`bundle_fact_${condition.fact.replace('.', '_')}`) : '',
			condition.op ? t(`op_${condition.op}`) : '',
			valueText(condition),
		]
			.filter(Boolean)
			.join(' '),
	);
	const actions = rule.then.map((action) =>
		[t(`bundle_action_${action.kind}`), amountText(action, numbers, lang)].filter(Boolean).join(' '),
	);
	const when = conditions.length
		? `${t('rule_if')} ${conditions.join(` ${t(rule.when.match === 'any' ? 'bundle_rule_or' : 'bundle_rule_and')} `)}`
		: t('bundle_rule_always');
	return `${when}: ${actions.length ? actions.join(', ') : t('bundle_rule_does_nothing')}`;
}
