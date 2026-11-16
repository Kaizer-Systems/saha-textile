import { describe, expect, it } from 'vitest';

import { kindFor, unitsOf } from './return-form';
import { toReturnRow } from './return-list';
import { returnStep } from './return-view';
import { barsPath, labelsForLine } from '../purchase-entry/label-sheet';

import type { PurchaseReturn, ReturnableLine } from '@saha-textile/contracts';

const line = (over: Partial<ReturnableLine> = {}) =>
	({
		entryLineId: 'l1',
		soldBy: 'piece',
		freeToReturn: 3,
		unitCostINR: 940,
		gstRatePct: 5,
		...over,
	}) as ReturnableLine;
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('purchase returns (r01–r04)', () => {
	it('makes a short-supply claim only for short supplied goods', () => {
		expect(kindFor('short_supplied')).toBe('short_supply');
		expect(kindFor('quality_after_accepting')).toBe('return_goods');
	});

	it('reads typed quantities as stock units, metres as tenths', () => {
		expect(unitsOf({ line: line(), quantity: '2' })).toBe(2);
		expect(unitsOf({ line: line({ soldBy: 'metre' }), quantity: '2.5' })).toBe(25);
		expect(unitsOf({ line: line(), quantity: 'x' })).toBe(0);
	});

	it('names drafts by what happens on sending, and steps through sent and settled', () => {
		const draft = {
			id: 'r',
			number: null,
			kind: 'short_supply',
			status: 'draft',
			supplierName: 'S',
			purchaseEntryNumber: 'PE/1',
			reason: 'short_supplied',
			origin: 'goods_check',
			lines: [{ quantity: 1, soldBy: 'piece' }],
			totalINR: 1102.5,
			settledINR: 0,
			settlements: [],
		} as unknown as PurchaseReturn;
		const row = toReturnRow(draft, t);
		expect(row.number).toContain('pr_no_goods_to_send');
		expect(row.why).toBe('pr_reason_short_supplied · pr_made_by_goods_check');
		expect(row.value).toBe('₹1,102.50');
		expect(returnStep(draft)).toBe(0);
		expect(returnStep({ status: 'sent' })).toBe(1);
		expect(returnStep({ status: 'settled' })).toBe(2);
	});
});

describe('barcode labels (l01)', () => {
	it('prints one label per piece, one per roll for fabric by the metre', () => {
		expect(labelsForLine(6, 'piece')).toBe(6);
		expect(labelsForLine(425, 'metre')).toBe(1);
		expect(labelsForLine(0, 'piece')).toBe(0);
	});

	it('draws Code 128 bars with a quiet zone, and nothing for text it cannot hold', () => {
		const bars = barsPath('ST-1');
		// Start, four characters and the check value at 11 modules each, the stop at 13: 79, plus 20 of quiet zone.
		expect(bars?.width).toBe(79 + 20);
		expect(bars?.d.startsWith('M10 0h2')).toBe(true);
		expect(barsPath('শাড়ি')).toBeNull();
	});
});
