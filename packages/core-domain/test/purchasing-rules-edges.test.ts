import { describe, expect, it } from 'vitest';

import { shortFiscalYear } from '../src/purchasing/fiscal-year';
import { CODE128_PATTERNS, code128, sheetsNeeded } from '../src/purchasing/labels';
import {
	computePurchaseEntry,
	type EntryMathInput,
	type EntryMathLineInput,
} from '../src/purchasing/purchase-entry-math';
import {
	computeReturnTotals,
	freeToReturn,
	settlementOpen,
	type ReturnableFacts,
} from '../src/purchasing/purchase-return-rules';
import { purchaseOrderStatusOf, samePersonProblem, voidBlockers } from '../src/purchasing/purchase-rules';

const entryLine = (over: Partial<EntryMathLineInput> = {}): EntryMathLineInput => ({
	lineId: 'l1',
	soldBy: 'piece',
	quantity: 2,
	unitPriceINR: 500,
	freeOnBill: false,
	gstRatePct: 5,
	sellingPriceINR: 0,
	lastPriceINR: null,
	hsnOnBill: null,
	productHsn: null,
	disabled: false,
	notOrdered: false,
	...over,
});
const entryInput = (lines: EntryMathLineInput[], over: Partial<EntryMathInput> = {}): EntryMathInput => ({
	taxType: 'intra_state',
	pricesIncludeGst: false,
	freightINR: 0,
	freightGstRatePct: 0,
	roundOffINR: 0,
	printedTotalINR: null,
	itcClaimable: true,
	lines,
	priceChangeWarnPct: 10,
	marginFloorPct: 0,
	...over,
});

describe('purchase entry math: the remaining cases', () => {
	it('costs a line of no pieces at nothing, and shares freight only across priced lines', () => {
		const result = computePurchaseEntry(
			entryInput([entryLine({ lineId: 'none', quantity: 0 }), entryLine({ lineId: 'two' })], { freightINR: 100 }),
		);
		expect(result.lines[0]).toMatchObject({ unitCostINR: 0, unitCostPerStockUnitINR: 0, unitPriceExGstINR: 0 });
		expect(result.lines[1]).toMatchObject({ freightShareINR: 100, unitCostINR: 550, unitPriceExGstINR: 500 });
		expect(result.totals.costIntoStockINR).toBe(1100);
	});

	it('warns about a disabled product and a line not on the purchase order', () => {
		const { warnings } = computePurchaseEntry(
			entryInput([
				entryLine({ lineId: 'off', disabled: true }),
				entryLine({ lineId: 'extra', notOrdered: true }),
			]),
		);
		expect(warnings.map((warning) => [warning.code, warning.lineId])).toEqual([
			['disabled_product', 'off'],
			['not_ordered', 'extra'],
		]);
	});
});

const facts = (over: Partial<ReturnableFacts> = {}): ReturnableFacts =>
	({
		entryLineId: 'l1',
		accepted: 10,
		missing: 0,
		returnedBefore: 0,
		claimedShortBefore: 0,
		onHand: 10,
		held: 0,
		reserved: 0,
		layerRemaining: 10,
		soldBy: 'piece',
		...over,
	}) as ReturnableFacts;

describe('purchase returns: how much is free to return', () => {
	it('claims short supply only while missing pieces are unclaimed', () => {
		expect(freeToReturn(facts({ missing: 3, claimedShortBefore: 3 }), 'short_supply')).toEqual({
			max: 0,
			capReason: 'Every missing piece is already claimed.',
		});
		expect(freeToReturn(facts({ missing: 3, claimedShortBefore: 1 }), 'short_supply')).toEqual({
			max: 2,
			capReason: null,
		});
	});

	it('returns a hold in full, or says why only part of it can go back', () => {
		expect(freeToReturn(facts(), 'return_goods', { quantity: 4 })).toEqual({ max: 4, capReason: null });
		expect(freeToReturn(facts({ layerRemaining: 2 }), 'return_goods', { quantity: 4 })).toEqual({
			max: 2,
			capReason: 'Some held pieces came from another entry or have already been returned.',
		});
	});

	it('names held pieces, reserved pieces or both when they limit the return', () => {
		const reason = (over: Partial<ReturnableFacts>) => freeToReturn(facts(over), 'return_goods').capReason;
		expect(reason({ held: 3 })).toBe('10 on hand, but 3 held: 7 free to return.');
		expect(reason({ reserved: 4 })).toBe('10 on hand, but 4 in paid orders waiting to ship: 6 free to return.');
		expect(reason({ held: 2, reserved: 1, soldBy: 'metre' })).toBe(
			'1.0 m on hand, but 0.2 m held and 0.1 m in paid orders waiting to ship: 0.7 m free to return.',
		);
	});

	it('says when part of the entry has sold, and nothing when all of it can go back', () => {
		expect(freeToReturn(facts({ layerRemaining: 6 }), 'return_goods')).toEqual({
			max: 6,
			capReason: 'Only 6 from this entry is still in stock; the rest has sold.',
		});
		expect(freeToReturn(facts(), 'return_goods')).toEqual({ max: 10, capReason: null });
	});
});

describe('purchase returns: totals and settlement', () => {
	it('adds no tax for a supplier whose bills carry none', () => {
		expect(
			computeReturnTotals('none', [{ quantity: 2, unitCostPerStockUnitINR: 100, gstRatePct: 5 }]),
		).toMatchObject({
			taxableINR: 200,
			igstINR: 0,
			cgstINR: 0,
			totalINR: 200,
			lines: [{ taxINR: 0, totalINR: 200 }],
		});
	});

	it('leaves what is still open to the paisa, never below nothing', () => {
		expect(settlementOpen(100, 30.004)).toBe(70);
		expect(settlementOpen(100, 150)).toBe(0);
	});
});

describe('purchase entry rules: the remaining cases', () => {
	it('names the step the same person did before', () => {
		const problem = (step: 'check' | 'post' | 'payment') =>
			samePersonProblem({ required: true, actorId: 'u1', previousActorId: 'u1', step })?.detail;
		expect(problem('check')).toMatch(/who made the draft must/);
		expect(problem('post')).toMatch(/who checked the goods must/);
		expect(problem('payment')).toMatch(/who posted the entry must/);
		expect(samePersonProblem({ required: true, actorId: 'u1', previousActorId: 'u2', step: 'post' })).toBeNull();
	});

	it('keeps a sent order sent while nothing has arrived', () => {
		expect(purchaseOrderStatusOf({ current: 'sent', lines: [{ quantity: 5, receivedQuantity: 0 }] })).toBe('sent');
	});

	it('blocks a void for written-off stock, a sent return or a payment, in that order', () => {
		const layer = { sku: 'SKU-1', received: 5, remaining: 5, sold: 0, returned: 0, documents: [] };
		const blockers = (over: Partial<Parameters<typeof voidBlockers>[0]>) =>
			voidBlockers({
				status: 'posted',
				layers: [layer],
				reservedBySku: {},
				activePayments: 0,
				sentReturns: 0,
				...over,
			});
		expect(blockers({ layers: [{ ...layer, remaining: 4 }], sentReturns: 1 })).toEqual({
			blocked: true,
			reason: 'stock_moved',
			lines: [],
		});
		expect(blockers({ sentReturns: 1, activePayments: 1 })).toMatchObject({ reason: 'returns' });
		expect(blockers({ activePayments: 1 })).toMatchObject({ reason: 'payments' });
		expect(blockers({})).toEqual({ blocked: false, reason: null, lines: [] });
	});
});

describe('labels and the financial year: the remaining cases', () => {
	it('needs no sheet for no labels', () => {
		expect(sheetsNeeded('a4_65', 1, 0)).toBe(0);
		expect(sheetsNeeded('a4_65', 1, -2)).toBe(0);
	});

	it('has a pattern for every Code 128 value, from the lowest data value to stop', () => {
		expect(CODE128_PATTERNS).toHaveLength(107);
		expect(code128(' ~').values).toEqual([104, 0, 94, (104 + 0 * 1 + 94 * 2) % 103, 106]);
	});

	it('shortens a financial year, and copes with one that has no second part', () => {
		expect(shortFiscalYear('2026-27')).toBe('26-27');
		expect(shortFiscalYear('2026')).toBe('26-');
	});
});
