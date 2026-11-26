import { describe, expect, it } from 'vitest';

import {
	BankLineLink,
	BookEntry,
	BookEntryQuery,
	Brs,
	BrsItem,
	BrsQuery,
	BrsRowKind,
	MatchRule,
	MatchRuleWrite,
	MatchThen,
	MatchWhen,
	ReconcilePeriod,
	ReconcileQuery,
	ReconcileRow,
	ReconcileTab,
	ReconcileView,
} from '../src/bank-reconcile';
import { BankLayout, BankLayoutWrite, BankLine } from '../src/bank-statement';

/** Reconciling a bank account (accounts brief BA7–BA10): matching rules, the reconcile screens and the BRS. */

const line = {
	id: 'bl_1',
	bankAccountId: 'ba_hdfc',
	date: '2026-11-21',
	description: 'NEFT CR PAYU PAYMENTS',
	reference: 'N325261234',
	outPaise: 0,
	inPaise: 1_250_000,
	key: '2026-11-21|N325261234|1250000',
	importId: 'imp_1',
	createdAt: '2026-11-22T05:00:00.000Z',
};

const entry = {
	voucherId: 'vch_1',
	number: 'RCPT/26-27/0041',
	date: '2026-11-21',
	narration: 'PayU settlement',
	inPaise: 1_250_000,
	outPaise: 0,
};

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

describe('matching rules', () => {
	it('names the four ways a line is recognised and the five things a rule does with it', () => {
		expect(MatchWhen.options).toEqual(['gateway_ref', 'upi_ref', 'amount_party', 'words']);
		expect(MatchThen.options).toEqual(['match', 'suggest', 'bank_charge', 'interest', 'leave']);
		refused(MatchWhen.safeParse('reference').success);
		refused(MatchThen.safeParse('delete').success);
	});

	it('takes a new rule with only its when and then, everything else defaulted', () => {
		expect(MatchRuleWrite.parse({ when: 'gateway_ref', then: 'match' })).toEqual({
			id: null,
			when: 'gateway_ref',
			words: [],
			onlyIn: false,
			then: 'match',
			gstPercent: null,
			on: true,
		});
		expect(MatchRuleWrite.parse({ id: 'mr_1', when: 'words', then: 'leave', on: false })).toMatchObject({
			id: 'mr_1',
			on: false,
		});
		refused(MatchRuleWrite.safeParse({ id: '', when: 'words', then: 'leave' }).success);
		refused(MatchRuleWrite.safeParse({ when: 'words' }).success);
	});

	it('trims each word, and refuses a word under 2 letters, over 40, or more than 10 words', () => {
		const words = (list: string[]) => MatchRuleWrite.safeParse({ when: 'words', then: 'bank_charge', words: list });
		expect(words(['  SMS CHRG  ', 'ATM']).data?.words).toEqual(['SMS CHRG', 'ATM']);
		refused(words([' a ']).success);
		refused(words(['x'.repeat(41)]).success);
		accepted(words(['x'.repeat(40)]).success);
		accepted(words(Array.from({ length: 10 }, (_, at) => `word${at}`)).success);
		refused(words(Array.from({ length: 11 }, (_, at) => `word${at}`)).success);
	});

	it('takes a bank charge’s GST from 0 to 28 per cent, or none, and refuses anything outside', () => {
		const gst = (gstPercent: unknown) =>
			MatchRuleWrite.safeParse({ when: 'words', then: 'bank_charge', words: ['CHRG'], gstPercent });
		accepted(gst(0).success);
		accepted(gst(18).success);
		accepted(gst(28).success);
		accepted(gst(null).success);
		refused(gst(28.5).success);
		refused(gst(-1).success);
		refused(gst('18').success);
	});

	it('takes money coming in only for an interest rule', () => {
		expect(MatchRuleWrite.parse({ when: 'words', then: 'interest', words: ['INT PD'], onlyIn: true }).onlyIn).toBe(
			true,
		);
	});

	it('keeps a saved rule with its id, its place in the order, whether the app made it, and when it changed', () => {
		const saved = {
			id: 'mr_builtin_gateway',
			when: 'gateway_ref',
			then: 'match',
			order: 0,
			builtIn: true,
			updatedAt: '2026-11-24T10:00:00.000Z',
		};
		expect(MatchRule.parse(saved)).toMatchObject({
			...saved,
			words: [],
			onlyIn: false,
			gstPercent: null,
			on: true,
		});
		refused(MatchRule.safeParse({ ...saved, id: null }).success);
		refused(MatchRule.safeParse({ ...saved, order: -1 }).success);
		refused(MatchRule.safeParse({ ...saved, order: 1.5 }).success);
		refused(MatchRule.safeParse({ ...saved, builtIn: undefined }).success);
		refused(MatchRule.safeParse({ ...saved, updatedAt: '' }).success);
	});
});

describe('the reconcile screens', () => {
	it('shows an entry of the books with its money in and out in whole paise', () => {
		expect(BookEntry.parse(entry)).toEqual(entry);
		refused(BookEntry.safeParse({ ...entry, inPaise: -1 }).success);
		refused(BookEntry.safeParse({ ...entry, outPaise: 0.5 }).success);
		refused(BookEntry.safeParse({ ...entry, date: '21/11/2026' }).success);
		refused(BookEntry.safeParse({ ...entry, voucherId: '' }).success);
	});

	it('opens on the suggested tab for a period, and refuses an unknown tab or a date in the wrong shape', () => {
		expect(ReconcileTab.options).toEqual(['suggested', 'unmatched', 'accepted']);
		expect(ReconcileQuery.parse({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
			from: '2026-11-01',
			to: '2026-11-30',
			tab: 'suggested',
		});
		expect(ReconcileQuery.parse({ from: '2026-11-01', to: '2026-11-30', tab: 'accepted' }).tab).toBe('accepted');
		refused(ReconcileQuery.safeParse({ from: '2026-11-01', to: '2026-11-30', tab: 'rejected' }).success);
		refused(ReconcileQuery.safeParse({ from: '2026-11-1', to: '2026-11-30' }).success);
		refused(ReconcileQuery.safeParse({ from: '2026-11-01' }).success);
	});

	it('shows a statement line with the entries it is or could be matched to, the line’s own defaults kept', () => {
		expect(ReconcileRow.parse({ ...line, entries: [entry] })).toEqual({
			...line,
			balancePaise: null,
			status: 'unmatched',
			match: null,
			rejectedKeys: [],
			entries: [entry],
		});
		expect(ReconcileRow.parse({ ...line, entries: [] }).entries).toEqual([]);
		refused(ReconcileRow.safeParse(line).success);
		refused(ReconcileRow.safeParse({ ...line, entries: [{ ...entry, number: undefined }] }).success);
	});

	it('counts every tab, and how many suggestions are sure', () => {
		const counts = { suggested: 4, unmatched: 9, accepted: 120 };
		expect(ReconcileView.parse({ items: [{ ...line, entries: [] }], counts, sure: 3 })).toMatchObject({
			counts,
			sure: 3,
		});
		refused(ReconcileView.safeParse({ items: [], counts: { suggested: 1, unmatched: 0 }, sure: 0 }).success);
		refused(ReconcileView.safeParse({ items: [], counts: { ...counts, rejected: 1 }, sure: 0 }).success);
		refused(ReconcileView.safeParse({ items: [], counts: { ...counts, accepted: -1 }, sure: 0 }).success);
		refused(ReconcileView.safeParse({ items: [], counts, sure: 1.5 }).success);
	});

	it('links a line to one entry or up to 50 that add up to it, never none', () => {
		const ids = (count: number) => Array.from({ length: count }, (_, at) => `vch_${at}`);
		accepted(BankLineLink.safeParse({ voucherIds: ids(1) }).success);
		accepted(BankLineLink.safeParse({ voucherIds: ids(50) }).success);
		refused(BankLineLink.safeParse({ voucherIds: [] }).success);
		refused(BankLineLink.safeParse({ voucherIds: ids(51) }).success);
		refused(BankLineLink.safeParse({ voucherIds: [''] }).success);
	});

	it('finds entries by words or amount, an empty search when none is typed, trimmed and at most 80 letters', () => {
		expect(BookEntryQuery.parse({})).toEqual({ q: '' });
		expect(BookEntryQuery.parse({ q: '  12500  ' })).toEqual({ q: '12500' });
		accepted(BookEntryQuery.safeParse({ q: `  ${'x'.repeat(80)}  ` }).success);
		refused(BookEntryQuery.safeParse({ q: 'x'.repeat(81) }).success);
		refused(BookEntryQuery.safeParse({ q: 12500 }).success);
	});

	it('acts on the period shown, from and to both given', () => {
		expect(ReconcilePeriod.parse({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
			from: '2026-11-01',
			to: '2026-11-30',
		});
		refused(ReconcilePeriod.safeParse({ from: '2026-11-01' }).success);
		refused(ReconcilePeriod.safeParse({ from: '2026-11-01', to: 'end' }).success);
	});
});

describe('the bank reconciliation statement', () => {
	it('is asked for as at a day', () => {
		expect(BrsQuery.parse({ asAt: '2026-11-30' })).toEqual({ asAt: '2026-11-30' });
		refused(BrsQuery.safeParse({}).success);
		refused(BrsQuery.safeParse({ asAt: '30-11-2026' }).success);
	});

	it('names its six steps from the books to the bank', () => {
		expect(BrsRowKind.options).toEqual([
			'unpresented',
			'uncredited',
			'bank_in',
			'bank_out',
			'bank_charges',
			'before_start',
		]);
		refused(BrsRowKind.safeParse('rounding').success);
	});

	it('keeps an item signed as it changes the balance, in whole paise', () => {
		expect(BrsItem.parse({ date: '2026-11-28', text: 'Cheque 000412 to Weaver Co.', paise: -450_000 }).paise).toBe(
			-450_000,
		);
		refused(BrsItem.safeParse({ date: '2026-11-28', text: 'x', paise: 1.5 }).success);
		refused(BrsItem.safeParse({ date: '2026-11-28', paise: 1 }).success);
	});

	it('shows the books, each step with its items, what the bank should show, and the bank’s own balance', () => {
		const brs = {
			asAt: '2026-11-30',
			bookPaise: 10_000_000,
			rows: [
				{
					kind: 'unpresented',
					paise: 450_000,
					items: [{ date: '2026-11-28', text: 'Cheque 000412', paise: 450_000 }],
				},
				{ kind: 'bank_charges', paise: -11_800, items: [] },
			],
			computedPaise: 10_438_200,
			statementPaise: 10_438_200,
			startsOn: '2026-04-01',
		};
		expect(Brs.parse(brs)).toEqual(brs);
		expect(Brs.parse({ ...brs, statementPaise: null, startsOn: null })).toMatchObject({
			statementPaise: null,
			startsOn: null,
		});
		refused(Brs.safeParse({ ...brs, statementPaise: undefined }).success);
		refused(Brs.safeParse({ ...brs, rows: [{ kind: 'rounding', paise: 0, items: [] }] }).success);
		refused(Brs.safeParse({ ...brs, bookPaise: 0.5 }).success);
		refused(Brs.safeParse({ ...brs, computedPaise: undefined }).success);
	});
});

describe('bank statement lines: what reconciling added', () => {
	const layout = {
		id: 'lay_hdfc',
		name: 'HDFC',
		skipRows: 21,
		dateFormat: 'DD/MM/YY',
		money: 'split',
		columns: {
			date: 0,
			description: 1,
			reference: 2,
			withdrawal: 4,
			deposit: 5,
			amount: null,
			drcr: null,
			balance: 6,
		},
		updatedAt: '2026-11-21T00:00:00.000Z',
	};

	it('names the value date column when the file has one, leaves it out when not, and takes it unset', () => {
		expect(BankLayout.parse(layout).columns).not.toHaveProperty('valueDate');
		expect(BankLayout.parse({ ...layout, columns: { ...layout.columns, valueDate: 3 } }).columns.valueDate).toBe(3);
		expect(
			BankLayout.parse({ ...layout, columns: { ...layout.columns, valueDate: null } }).columns.valueDate,
		).toBeNull();
		refused(BankLayout.safeParse({ ...layout, columns: { ...layout.columns, valueDate: 61 } }).success);
		refused(BankLayout.safeParse({ ...layout, columns: { ...layout.columns, valueDate: -1 } }).success);
		const { id: _id, updatedAt: _updatedAt, ...write } = layout;
		expect(BankLayoutWrite.parse({ ...write, columns: { ...write.columns, valueDate: 3 } }).columns.valueDate).toBe(
			3,
		);
	});

	it('keeps a match without an entry, GST rate or rule as none of them', () => {
		const match = { voucherIds: ['vch_1'], why: 'PayU reference', sure: true, by: null, at: null };
		expect(BankLine.parse({ ...line, status: 'suggested', match }).match).toEqual({
			...match,
			entry: null,
			gstPercent: null,
			ruleId: null,
		});
	});

	it('keeps the entry a rule makes on Accept, with its GST rate up to 28 per cent and the rule behind it', () => {
		const charge = {
			voucherIds: [],
			why: 'Rule: SMS charges',
			sure: true,
			by: 'adm_1',
			at: '2026-11-24T10:00:00.000Z',
			entry: 'bank_charge',
			gstPercent: 18,
			ruleId: 'mr_sms',
		};
		expect(BankLine.parse({ ...line, outPaise: 1_180, inPaise: 0, match: charge }).match).toEqual(charge);
		expect(
			BankLine.parse({ ...line, match: { ...charge, entry: 'interest', gstPercent: null } }).match?.entry,
		).toBe('interest');
		refused(BankLine.safeParse({ ...line, match: { ...charge, entry: 'transfer' } }).success);
		refused(BankLine.safeParse({ ...line, match: { ...charge, gstPercent: 29 } }).success);
		refused(BankLine.safeParse({ ...line, match: { ...charge, gstPercent: -1 } }).success);
		refused(BankLine.safeParse({ ...line, match: { ...charge, ruleId: '' } }).success);
	});

	it('remembers up to 100 turned-down suggestions, none to begin with', () => {
		expect(BankLine.parse(line).rejectedKeys).toEqual([]);
		const keys = (count: number) => Array.from({ length: count }, (_, at) => `vch_${at}`);
		expect(BankLine.parse({ ...line, rejectedKeys: ['vch_9', 'mr_sms'] }).rejectedKeys).toEqual([
			'vch_9',
			'mr_sms',
		]);
		accepted(BankLine.safeParse({ ...line, rejectedKeys: keys(100) }).success);
		refused(BankLine.safeParse({ ...line, rejectedKeys: keys(101) }).success);
		refused(BankLine.safeParse({ ...line, rejectedKeys: [7] }).success);
	});
});
