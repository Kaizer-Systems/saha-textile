import { describe, expect, it } from 'vitest';

import { BANK_LEDGERS, IFSC_BANKS, bankGroupFor, ifscBank, maskedNumber, openingPosting } from '../src/bank/bank-rules';

/** Bank accounts (accounts brief BA1–BA3): where each sits, the opening posting, the IFSC's bank, the masked number. */

describe('bank accounts', () => {
	it('puts a cash credit or overdraft under the bank overdraft group, every other account under Bank accounts', () => {
		expect(
			['current', 'savings', 'fixed_deposit', 'cash_credit', 'overdraft'].map((k) => bankGroupFor(k as never)),
		).toEqual(['bank_accounts', 'bank_accounts', 'bank_accounts', 'bank_od', 'bank_od']);
	});

	it('posts money in the account as a debit and a borrowed balance as a credit, against opening balance difference', () => {
		expect(openingPosting(3_12_000)).toEqual([
			{ role: 'bank', debitPaise: 3_12_00_000 },
			{ role: 'opening_balance_difference', creditPaise: 3_12_00_000 },
		]);
		expect(openingPosting(-30_00_000)).toEqual([
			{ role: 'opening_balance_difference', debitPaise: 30_00_00_000 },
			{ role: 'bank', creditPaise: 30_00_00_000 },
		]);
		expect(openingPosting(0)).toEqual([]);
	});

	it('names the bank from the IFSC’s first four letters, masks the number, and adds the v5 ledgers', () => {
		expect([ifscBank(' hdfc0001234 '), ifscBank('ZZZZ0000001')]).toEqual(['HDFC Bank', null]);
		expect(Object.keys(IFSC_BANKS).every((k) => /^[A-Z]{4}$/.test(k))).toBe(true);
		expect(maskedNumber('50200012344821')).toBe('•••• 4821');
		expect(BANK_LEDGERS.map((l) => l.key)).toEqual(['interest_received', 'opening_balance_difference']);
	});
});
