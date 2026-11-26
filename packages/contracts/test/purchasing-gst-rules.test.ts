import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { Gstin, gstinCheckCharacter } from '../src/gst';
import {
	LabelSheetRequest,
	PurchaseEntryLineWrite,
	PurchaseItemsByVariantQuery,
	SupplierPaymentWrite,
	SupplierWrite,
} from '../src/purchasing';

const problems = (schema: z.ZodType, value: unknown): string[] => {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

/** A GSTIN for West Bengal (19) with its correct check character. */
const first14 = '19AAACK1234A1Z';
const GSTIN = first14 + gstinCheckCharacter(first14);

describe('GSTIN checks', () => {
	it('names the right check character when it is wrong, and the shape when that is wrong', () => {
		expect(problems(Gstin, GSTIN)).toEqual([]);
		const expected = GSTIN.slice(-1);
		const wrong = first14 + (expected === 'A' ? 'B' : 'A');
		expect(problems(Gstin, wrong)).toEqual([`gstin_check_digit:${expected}`]);
		expect(problems(Gstin, 'not a gstin')).toEqual(['gstin_shape']);
	});

	it('reads a short start as zeros, as before', () => {
		expect(gstinCheckCharacter('19')).toBe(gstinCheckCharacter('190000000000000'.slice(0, 14)));
	});
});

describe('suppliers', () => {
	const supplier = {
		legalName: 'K.R. Weavers',
		kind: 'regular',
		gstin: GSTIN,
		stateCode: '19',
		address: { line: '12 Bow Bazar', pin: '700012' },
		paymentTermsDays: 30,
	};

	it('a registered supplier has a GSTIN from its own State; empty text becomes null', () => {
		expect(SupplierWrite.parse({ ...supplier, contactName: '  ', email: '' })).toMatchObject({
			contactName: null,
			email: null,
		});
		expect(problems(SupplierWrite, { ...supplier, kind: 'unregistered', gstin: null })).toEqual([]);
		expect(problems(SupplierWrite, { ...supplier, gstin: null })).toEqual(['gstin_required']);
		expect(problems(SupplierWrite, { ...supplier, stateCode: '27' })).toEqual(['state_differs_from_gstin']);
	});

	it('a payment to a supplier is more than nothing', () => {
		const payment = { amountINR: 5000, paidOn: '2026-11-23', mode: 'upi' };
		expect(problems(SupplierPaymentWrite, payment)).toEqual([]);
		expect(problems(SupplierPaymentWrite, { ...payment, amountINR: 0 })).toEqual(['amount_positive']);
	});
});

describe('purchase entries and labels', () => {
	it('reads variant ids from an address list, trimmed and once each', () => {
		expect(PurchaseItemsByVariantQuery.parse({ ids: ' v1, v2 ,,v1 ' }).ids).toEqual(['v1', 'v2']);
	});

	it('a bill line with no HSN of its own keeps null', () => {
		const line = { variantId: 'v1', quantity: 2, unitPriceINR: 100, gstRatePct: 5 };
		expect(PurchaseEntryLineWrite.parse({ ...line, hsnOnBill: '  ' }).hsnOnBill).toBeNull();
	});

	it('one label sheet run prints at most 2,000 labels', () => {
		const request = { sheet: 'a4_65', startAt: 1, fields: ['name', 'price'] };
		const items = (count: number) => [
			{ variantId: 'v1', count },
			{ variantId: 'v2', count },
		];
		expect(problems(LabelSheetRequest, { ...request, items: items(1000) })).toEqual([]);
		expect(
			problems(LabelSheetRequest, { ...request, items: [...items(1000), { variantId: 'v3', count: 1 }] }),
		).toEqual(['too_many_labels']);
	});
});
