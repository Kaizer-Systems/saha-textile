import { describe, expect, it } from 'vitest';

import { BANK_CHIPS, BankAccountEdit, BankAccountWrite, Ifsc, IfscQuery } from '../src/bank';
import { BankLayoutWrite, BankLineQuery, StatementPreviewWrite, StatementSaveWrite } from '../src/bank-statement';

/** Bank accounts and statements (accounts brief BA1–BA6): what the screens send. */

const account = {
	kind: 'current',
	ifsc: 'hdfc0001234',
	bankName: 'HDFC Bank',
	holder: 'K.R. Marketing',
	number: '50200012344821',
	shortName: 'HDFC Bank · Barasat',
};

describe('bank account contracts', () => {
	it('takes an account with its IFSC in capitals and the rest defaulted, and an edit with its version', () => {
		expect(BankAccountWrite.parse(account)).toMatchObject({
			ifsc: 'HDFC0001234',
			openingINR: 0,
			upiIds: [],
			active: true,
		});
		expect(Ifsc.safeParse('HDFC1001234').success).toBe(false);
		expect(BankAccountWrite.safeParse({ ...account, number: '12' }).success).toBe(false);
		expect(BankAccountEdit.parse({ ...account, version: 2 }).version).toBe(2);
		expect(IfscQuery.safeParse({ code: 'HD' }).success).toBe(false);
		expect(BANK_CHIPS).toEqual(['all', 'current', 'credit', 'deposits']);
	});

	it('takes a layout, a preview of rows, a save with its opening and closing, and a lines query', () => {
		const layout = BankLayoutWrite.parse({
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
		});
		expect(layout.id).toBeNull();
		expect(StatementPreviewWrite.parse({ layoutId: 'lay_1', rows: [['28/11/26', 'x']] }).rows).toHaveLength(1);
		expect(StatementSaveWrite.safeParse({ openingPaise: 0, closingPaise: 0, lines: [] }).success).toBe(false);
		expect(BankLineQuery.parse({ from: '2026-11-01', to: '2026-11-30' })).toMatchObject({
			status: null,
			page: 1,
			pageSize: 50,
		});
	});
});
