import { describe, expect, it } from 'vitest';

import {
	BUILT_IN_RULES,
	type Candidate,
	normalText,
	partyWords,
	ruleEntryRows,
	ruleProblem,
	suggestMatch,
} from '../src/bank/reconcile-rules';

/** Matching statement lines to the books (accounts brief BA7, BA10). */

const line = (over: Record<string, unknown> = {}) => ({
	date: '2026-11-26',
	description: 'UPI/409912345678/SHREYA G',
	reference: '',
	inPaise: 150_000,
	outPaise: 0,
	rejectedKeys: [] as string[],
	...over,
});
const entry = (over: Partial<Candidate> = {}): Candidate => ({
	voucherId: 'jv_1',
	date: '2026-11-26',
	inPaise: 150_000,
	outPaise: 0,
	text: 'Payment received on order ST-2611-482190',
	references: [],
	...over,
});
const rules = BUILT_IN_RULES;

describe('a line’s suggested match', () => {
	it('matches a gateway payout or a UPI reference the books hold, sure when only one entry holds it', () => {
		const payout = entry({ voucherId: 'ct_1', references: [{ kind: 'payout', value: 'CCAV98240' }] });
		expect(
			suggestMatch(line({ description: 'NEFT CR CCAVENUE 251126', reference: 'CCAV98240' }), [payout], rules),
		).toEqual({
			kind: 'entries',
			voucherIds: ['ct_1'],
			why: 'gateway_ref',
			sure: true,
			ruleId: 'rule_gateway_ref',
		});
		const upi = entry({ references: [{ kind: 'upi', value: '409912345678' }] });
		expect(suggestMatch(line(), [upi], rules)).toMatchObject({ voucherIds: ['jv_1'], why: 'upi_ref', sure: true });
		const twice = [upi, { ...upi, voucherId: 'jv_2' }];
		expect(suggestMatch(line(), twice, rules)).toMatchObject({ voucherIds: ['jv_1'], sure: false });
		// Short references are too common to trust; another amount or a line taken elsewhere isn't offered.
		expect(suggestMatch(line(), [entry({ references: [{ kind: 'upi', value: '40991' }] })], rules)).toBeNull();
		expect(suggestMatch(line(), [{ ...upi, inPaise: 100 }], rules)).toBeNull();
		expect(suggestMatch(line(), [upi], rules, new Set(['jv_1']))).toBeNull();
		expect(suggestMatch(line({ rejectedKeys: ['jv_1'] }), [upi], rules)).toBeNull();
	});

	it('suggests an entry of the same amount within three days with the party’s name, nearest first', () => {
		const nila = entry({ voucherId: 'rc_1', date: '2026-11-25', text: 'Receipt RC/26-27/000009 · Boutique Nila' });
		const far = { ...nila, voucherId: 'rc_2', date: '2026-11-20' };
		const near = { ...nila, voucherId: 'rc_3', date: '2026-11-27' };
		const nilaLine = line({ description: 'NEFT CR BOUTIQUE NILA', date: '2026-11-28', inPaise: 150_000 });
		expect(suggestMatch(nilaLine, [nila, far], rules)).toMatchObject({
			voucherIds: ['rc_1'],
			why: 'amount_party',
			sure: true,
		});
		expect(suggestMatch(nilaLine, [nila, near], rules)).toMatchObject({ voucherIds: ['rc_3'], sure: false });
		expect(suggestMatch(nilaLine, [entry({ text: 'Payment received on order ST-1' })], rules)).toBeNull();
		const paid = entry({
			voucherId: 'pv_1',
			inPaise: 0,
			outPaise: 1_200_000,
			text: 'Payment to Nadia Weavers for PE/1',
		});
		expect(
			suggestMatch(
				line({ description: 'NEFT DR NADIA WEAVERS', inPaise: 0, outPaise: 1_200_000 }),
				[paid],
				rules,
			),
		).toMatchObject({ voucherIds: ['pv_1'] });
	});

	it('makes bank charges on money out and interest on money in from the words, and leaves the rest', () => {
		const sms = line({ description: 'SMS ALERT CHG', inPaise: 0, outPaise: 5_900 });
		expect(suggestMatch(sms, [], rules)).toEqual({
			kind: 'new',
			entry: 'bank_charge',
			gstPercent: 18,
			why: 'rule:SMS ALERT',
			ruleId: 'rule_bank_charges',
		});
		expect(suggestMatch(line({ description: 'INT CR FD 0042', inPaise: 41_200 }), [], rules)).toMatchObject({
			entry: 'interest',
			why: 'rule:INT CR',
		});
		// Charges words on money in, or interest words on money out, make nothing.
		expect(suggestMatch(line({ description: 'CHG REVERSAL' }), [], rules)).toBeNull();
		expect(suggestMatch(line({ description: 'INT CR', inPaise: 0, outPaise: 100 }), [], rules)).toBeNull();
		const leave = {
			...BUILT_IN_RULES[3]!,
			id: 'rule_mine',
			order: 9,
			builtIn: false,
			words: ['CASH DEP'],
			then: 'leave' as const,
		};
		const upiRule = { ...BUILT_IN_RULES[1]!, then: 'suggest' as const };
		expect(suggestMatch(line({ description: 'CASH DEP GARIAHAT' }), [], [leave, ...rules])).toBeNull();
		const sure = entry({ references: [{ kind: 'upi', value: '409912345678' }] });
		expect(suggestMatch(line(), [sure], [upiRule])).toMatchObject({ sure: false });
		const off = rules.map((rule) => ({ ...rule, on: false }));
		expect(suggestMatch(sms, [], off)).toBeNull();
		expect(
			suggestMatch(
				line({ description: 'SMS ALERT', rejectedKeys: ['rule_bank_charges'], inPaise: 0, outPaise: 59 }),
				[],
				rules,
			),
		).toBeNull();
		const words = { ...BUILT_IN_RULES[4]!, then: 'match' as const };
		expect(suggestMatch(line({ description: 'INT CR' }), [], [words])).toBeNull();
	});
});

describe('entries made by a rule, and rules as written', () => {
	it('takes the GST out of bank charges, splits it in two, and books interest received', () => {
		expect(ruleEntryRows('bank_charge', 5_900, 18)).toEqual([
			{ ledger: { role: 'bank_charges' }, debitPaise: 5_000 },
			{ ledger: { role: 'input_cgst' }, debitPaise: 450 },
			{ ledger: { role: 'input_sgst' }, debitPaise: 450 },
		]);
		expect(ruleEntryRows('bank_charge', 2_501, null)).toEqual([
			{ ledger: { role: 'bank_charges' }, debitPaise: 2_501 },
		]);
		expect(ruleEntryRows('bank_charge', 101, 18)).toEqual([
			{ ledger: { role: 'bank_charges' }, debitPaise: 86 },
			{ ledger: { role: 'input_cgst' }, debitPaise: 7 },
			{ ledger: { role: 'input_sgst' }, debitPaise: 8 },
		]);
		expect(ruleEntryRows('interest', 41_200, null)).toEqual([
			{ ledger: { role: 'interest_received' }, creditPaise: 41_200 },
		]);
	});

	it('names the words in a line and an entry, and checks a rule before it is saved', () => {
		expect(normalText(' upi/4099 shreya-g ')).toBe('UPI 4099 SHREYA G');
		expect(partyWords('Payment to Nadia Weavers for PE/26-27/0001')).toEqual(['NADIA', 'WEAVERS']);
		expect(ruleProblem({ when: 'words', then: 'bank_charge', words: [], gstPercent: 18 })).toBe(
			'match_rule_needs_words',
		);
		expect(ruleProblem({ when: 'words', then: 'match', words: ['X'], gstPercent: null })).toBe(
			'match_rule_then_wrong',
		);
		expect(ruleProblem({ when: 'words', then: 'leave', words: ['X'], gstPercent: null })).toBeNull();
		expect(ruleProblem({ when: 'upi_ref', then: 'interest', words: [], gstPercent: null })).toBe(
			'match_rule_then_wrong',
		);
		expect(ruleProblem({ when: 'amount_party', then: 'suggest', words: [], gstPercent: null })).toBeNull();
	});
});
