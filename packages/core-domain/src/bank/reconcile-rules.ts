import type { BankLine, MatchRule } from '@saha-textile/contracts';

import type { MoneyRow } from '../ledger/money-postings';

/**
 * Reconciling a bank account (accounts brief BA7, BA10). Pure: a statement line, the entries of the books on the
 * account not matched yet, and the matching rules give a suggestion; nothing is final until a person accepts it.
 */

/** An entry of the books on the bank account, with what can identify it on a statement. */
export interface Candidate {
	voucherId: string;
	date: string;
	inPaise: number;
	outPaise: number;
	/** Its narration and number: party names are read from it. */
	text: string;
	/** References the books hold for it: a gateway payout's, a UPI or bank reference, a cheque number. */
	references: readonly { kind: 'payout' | 'upi' | 'other'; value: string }[];
}

export type Suggestion =
	| { kind: 'entries'; voucherIds: string[]; why: string; sure: boolean; ruleId: string }
	| { kind: 'new'; entry: 'bank_charge' | 'interest'; gstPercent: number | null; why: string; ruleId: string };

type Rule = Omit<MatchRule, 'updatedAt'>;

/** The app's own rules (BA10), tried first and in this order; each can be turned off, not removed. */
export const BUILT_IN_RULES: readonly Rule[] = [
	{
		id: 'rule_gateway_ref',
		order: 0,
		builtIn: true,
		when: 'gateway_ref',
		words: [],
		onlyIn: true,
		then: 'match',
		gstPercent: null,
		on: true,
	},
	{
		id: 'rule_upi_ref',
		order: 1,
		builtIn: true,
		when: 'upi_ref',
		words: [],
		onlyIn: false,
		then: 'match',
		gstPercent: null,
		on: true,
	},
	{
		id: 'rule_amount_party',
		order: 2,
		builtIn: true,
		when: 'amount_party',
		words: [],
		onlyIn: false,
		then: 'suggest',
		gstPercent: null,
		on: true,
	},
	{
		id: 'rule_bank_charges',
		order: 3,
		builtIn: true,
		when: 'words',
		words: ['SMS ALERT', 'CHG'],
		onlyIn: false,
		then: 'bank_charge',
		gstPercent: 18,
		on: true,
	},
	{
		id: 'rule_interest',
		order: 4,
		builtIn: true,
		when: 'words',
		words: ['INT CR'],
		onlyIn: true,
		then: 'interest',
		gstPercent: null,
		on: true,
	},
];

/** Upper case, words and digits only: how a line and a reference are compared. */
export function normalText(text: string): string {
	return text
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim();
}

/** Words that say what an entry is, not who it is with. */
const NOT_NAMES = new Set([
	'AGAINST',
	'BANK',
	'BILL',
	'CASH',
	'CREDIT',
	'DEBIT',
	'ENTRY',
	'FROM',
	'IMPS',
	'INVOICE',
	'NEFT',
	'NOTE',
	'ORDER',
	'PAYMENT',
	'PURCHASE',
	'RECEIPT',
	'RECEIVED',
	'REFUND',
	'REVERSAL',
	'RTGS',
	'TRANSFER',
	'VOUCHER',
]);

/** The names in an entry's narration: words of four letters or more that aren't about the money itself. */
export function partyWords(text: string): string[] {
	return normalText(text)
		.split(' ')
		.filter((word) => word.length >= 4 && !/\d/.test(word) && !NOT_NAMES.has(word));
}

const dayGap = (a: string, b: string) =>
	Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * BA7's suggestion for a line: the first rule (in order, switched on, not turned down for this line) that finds
 * something. Entries must move the same money the same way; `taken` are entries other lines already hold.
 */
export function suggestMatch(
	line: Pick<BankLine, 'date' | 'description' | 'reference' | 'inPaise' | 'outPaise' | 'rejectedKeys'>,
	candidates: readonly Candidate[],
	rules: readonly Rule[],
	taken: ReadonlySet<string> = new Set(),
): Suggestion | null {
	const isIn = line.inPaise > 0;
	const text = normalText(`${line.description} ${line.reference}`);
	const rejected = new Set(line.rejectedKeys);
	const open = candidates.filter(
		(c) =>
			!taken.has(c.voucherId) &&
			!rejected.has(c.voucherId) &&
			(isIn ? c.inPaise === line.inPaise : c.outPaise === line.outPaise && c.outPaise > 0),
	);
	const ordered = [...rules].filter((rule) => rule.on && !rejected.has(rule.id)).sort((a, b) => a.order - b.order);
	for (const rule of ordered) {
		if (rule.onlyIn && !isIn) continue;
		const found = tryRule(rule, line.date, text, isIn, open);
		if (found !== undefined) return found;
	}
	return null;
}

/** One rule on one line: a suggestion, null for "leave it for a person", or undefined to try the next rule. */
function tryRule(
	rule: Rule,
	date: string,
	text: string,
	isIn: boolean,
	open: readonly Candidate[],
): Suggestion | null | undefined {
	const entries = (hits: readonly Candidate[], why: string): Extract<Suggestion, { kind: 'entries' }> => ({
		kind: 'entries',
		voucherIds: [(hits[0] as Candidate).voucherId],
		why,
		sure: hits.length === 1 && rule.then === 'match',
		ruleId: rule.id,
	});
	if (rule.when === 'gateway_ref' || rule.when === 'upi_ref') {
		const kind = rule.when === 'gateway_ref' ? 'payout' : 'upi';
		const hits = open.filter((c) =>
			c.references.some((r) => r.kind === kind && r.value.length >= 6 && text.includes(normalText(r.value))),
		);
		return hits.length ? entries(hits, rule.when) : undefined;
	}
	if (rule.when === 'amount_party') {
		const hits = open
			.filter((c) => dayGap(c.date, date) <= 3 && partyWords(c.text).some((word) => text.includes(word)))
			.sort((a, b) => dayGap(a.date, date) - dayGap(b.date, date));
		if (!hits.length) return undefined;
		// A party with one entry of that amount is sure; several leave the nearest as a guess.
		return { ...entries(hits, rule.when), sure: hits.length === 1 };
	}
	const word = rule.words.find((w) => text.includes(normalText(w)));
	if (!word) return undefined;
	if (rule.then === 'leave') return null;
	if ((rule.then === 'bank_charge' && !isIn) || (rule.then === 'interest' && isIn))
		return { kind: 'new', entry: rule.then, gstPercent: rule.gstPercent, why: `rule:${word}`, ruleId: rule.id };
	return undefined;
}

/**
 * The entry a rule makes on Accept (BA7 "New: bank charges ₹50 + GST ₹9"), less the bank's own side: bank charges with
 * their GST taken out of the amount (input tax, CGST and SGST), or interest received.
 */
export function ruleEntryRows(
	entry: 'bank_charge' | 'interest',
	amountPaise: number,
	gstPercent: number | null,
): MoneyRow[] {
	if (entry === 'interest') return [{ ledger: { role: 'interest_received' }, creditPaise: amountPaise }];
	const rate = gstPercent ?? 0;
	const taxable = Math.round((amountPaise * 100) / (100 + rate));
	const tax = amountPaise - taxable;
	const cgst = Math.floor(tax / 2);
	return [
		{ ledger: { role: 'bank_charges' }, debitPaise: taxable },
		{ ledger: { role: 'input_cgst' }, debitPaise: cgst },
		{ ledger: { role: 'input_sgst' }, debitPaise: tax - cgst },
	].filter((row) => row.debitPaise > 0);
}

/** A rule as a person may write it (BA10 Add rule): words need words; references and amounts match or suggest. */
export function ruleProblem(rule: Pick<MatchRule, 'when' | 'then' | 'words' | 'gstPercent'>): string | null {
	if (rule.when === 'words') {
		if (!rule.words.length) return 'match_rule_needs_words';
		if (!['bank_charge', 'interest', 'leave'].includes(rule.then)) return 'match_rule_then_wrong';
		return null;
	}
	return ['match', 'suggest'].includes(rule.then) ? null : 'match_rule_then_wrong';
}
