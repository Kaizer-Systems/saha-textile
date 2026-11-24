import { describe, expect, it } from 'vitest';

import {
	ITC_REVERSAL_REASONS,
	adjustmentInputTaxINR,
	reversesInputTax,
	stockAdjustmentPosting,
} from '../src/invoicing/stock-adjustment-rules';

/** Numbered stock adjustments (accounts brief D5, E1, E3, D9). */

describe('stock adjustments in the books', () => {
	it('takes back input tax only for a removal written off, for a loss reason', () => {
		expect(reversesInputTax('remove', 'writtenOff', 'damage')).toBe(true);
		expect(reversesInputTax('remove', undefined, 'lost_missing')).toBe(true);
		expect(reversesInputTax('remove', 'keptDamaged', 'damage')).toBe(false);
		expect(reversesInputTax('remove', 'writtenOff', 'supplier_shortage')).toBe(false);
		expect(reversesInputTax('remove', 'writtenOff', null)).toBe(false);
		expect(reversesInputTax('add', null, 'other')).toBe(false);
		expect(ITC_REVERSAL_REASONS).toContain('internal_use_sample');
	});

	it('works the input tax out on the cost (E1: ₹620 at 5% is ₹31.00)', () => {
		expect(adjustmentInputTaxINR(620, 5)).toBe(31);
		expect(adjustmentInputTaxINR(333.33, 12)).toBe(40);
		expect(adjustmentInputTaxINR(0, 5)).toBe(0);
	});

	it('moves the value out of stock into stock loss, or back for an addition', () => {
		expect(stockAdjustmentPosting('remove', 620)).toEqual([
			{ role: 'stock_loss', debitPaise: 62_000 },
			{ role: 'stock_in_hand', creditPaise: 62_000 },
		]);
		expect(stockAdjustmentPosting('add', 310)).toEqual([
			{ role: 'stock_in_hand', debitPaise: 31_000 },
			{ role: 'stock_loss', creditPaise: 31_000 },
		]);
		expect(stockAdjustmentPosting('remove', 0)).toEqual([]);
	});
});
