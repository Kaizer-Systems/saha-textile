import { describe, expect, it } from 'vitest';

import { INVOICE_PRINTS, invoiceProblemKey } from './invoices.gateway';

describe('tax invoices in admin (accounts brief D1, EI5B, EI10)', () => {
	it('names why an invoice could not be made, with the piece', () => {
		expect(invoiceProblemKey('invoice_problem:hsn_missing:ST-KAT-0901')).toEqual({
			key: 'inv_problem_hsn_missing',
			params: { sku: 'ST-KAT-0901' },
		});
		expect(invoiceProblemKey('invoice_problem:no_gst_registration')).toEqual({
			key: 'inv_problem_no_gst_registration',
			params: { sku: '' },
		});
		expect(invoiceProblemKey('Someone else changed this order first')).toBeNull();
	});

	it('offers the three copies in Rule 48 order, then all three', () => {
		expect(INVOICE_PRINTS.map((p) => p.copy)).toEqual(['original', 'duplicate', 'triplicate', 'all']);
	});
});
