import { describe, expect, it } from 'vitest';

import { booksRefusalKey, booksWords } from './books-refusal';

describe('a books refusal in words (AP2)', () => {
	it('names the missing bank account, location or ledger, and reuses the voucher form’s words', () => {
		expect(booksRefusalKey('money_lands_not_set:received_by_bank')).toEqual({
			key: 'books_no_bank_received_by_bank',
			params: {},
		});
		expect(booksRefusalKey('money_lands_not_set:paid_by_bank')?.key).toBe('books_no_bank_paid_by_bank');
		expect(booksRefusalKey('books_need_a_location')?.key).toBe('books_need_a_location');
		expect(booksRefusalKey('voucher_problem:role_not_mapped:cod_receivable')).toEqual({
			key: 'books_role_not_mapped',
			params: { role: 'cod_receivable' },
		});
		expect(booksRefusalKey('voucher_problem:role_ambiguous:cash')?.key).toBe('books_role_ambiguous');
		expect(booksRefusalKey('voucher_problem:period_locked')?.key).toBe('accounts_problem_period_locked');
		expect(booksRefusalKey('money_lands_not_set:elsewhere')).toBeNull();
		expect(booksRefusalKey('Network down')).toBeNull();
	});

	it('translates a books refusal and leaves any other message as it came', () => {
		const translate = (key: string, params: Record<string, string>) => `${key}${params['role'] ?? ''}`;
		expect(booksWords('voucher_problem:role_not_mapped:cash', translate)).toBe('books_role_not_mappedcash');
		expect(booksWords('Network down', translate)).toBe('Network down');
	});
});
