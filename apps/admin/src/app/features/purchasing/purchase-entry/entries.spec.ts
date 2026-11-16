import { describe, expect, it } from 'vitest';

import { freightRate } from './entry-form';
import { dateNotes, entryWrite, lineFromItem, lineProblem, lineWrite, previewEntry, warningText } from './entry-lines';
import { toEntryRow } from './entry-list';
import { entryStep } from './entry-steps';
import { adjust, countBody, countFrom, countProblem, countTotals, lineForCode } from './goods-check';
import { readyLines } from './import-popup';
import { orderEstimate, lineFromOption } from '../purchase-order/order-form';
import { toOrderRow } from '../purchase-order/order-list';
import { orderStep, stillToCome } from '../purchase-order/order-view';
import { exactMatch } from '../shared/line-search';
import { findColumns, importRows, parseCsv } from '../shared/sheet-rows';
import { parseQuantity } from '../shared/variant-grid';

import type { PurchaseEntry, PurchaseEntryLine, PurchaseItemOption, PurchaseOrder } from '@saha-textile/contracts';

const item = (over: Partial<PurchaseItemOption> = {}): PurchaseItemOption => ({
	productId: 'p1',
	variantId: 'v1',
	sku: 'ST-BAN-0412',
	title: 'Red Banarasi Katan Silk Saree',
	optionsLabel: '',
	imageUrl: null,
	soldBy: 'piece',
	status: 'live',
	blocked: null,
	disabled: false,
	hsnCode: '5007',
	sellingPriceINR: 15900,
	mrpINR: 18500,
	onHand: 3,
	lastCostINR: 8600,
	lastEntryNumber: 'PE/26-27/000009',
	supplierItemCode: 'BSW-K-118',
	variantCount: 1,
	...over,
});

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('quantities as typed (P11)', () => {
	it('takes whole pieces and metres in 0.1 m steps, stored as tenths', () => {
		expect(parseQuantity('6', 'piece')).toEqual({ units: 6 });
		expect(parseQuantity('2.5', 'piece')).toEqual({ problem: 'qty_whole_pieces' });
		expect(parseQuantity('2.5 m', 'metre')).toEqual({ units: 25 });
		expect(parseQuantity('120.0', 'metre')).toEqual({ units: 1200 });
		expect(parseQuantity('2.55', 'metre')).toEqual({ problem: 'qty_metres_step' });
		expect(parseQuantity('abc', 'metre')).toEqual({ problem: 'qty_metres_shape' });
		expect(parseQuantity('', 'piece')).toBeNull();
	});
});

describe('bill lines (p06)', () => {
	const banarasi = [
		{ ...lineFromItem(item(), 6, 9200), key: 'a' },
		{
			...lineFromItem(
				item({ variantId: 'v2', sku: 'ST-BAN-0415', sellingPriceINR: 18900, lastCostINR: 10000 }),
				4,
				11400,
			),
			key: 'b',
		},
		{
			...lineFromItem(
				item({ variantId: 'v3', sku: 'ST-BAN-0427', sellingPriceINR: 15500, lastCostINR: 13500 }),
				3,
				13800,
			),
			key: 'c',
		},
		{
			...lineFromItem(
				item({ variantId: 'v4', sku: 'ST-BAN-0431', sellingPriceINR: 9900, lastCostINR: 6200 }),
				5,
				6200,
			),
			key: 'd',
			hsnOnBill: '5208',
		},
	];
	const header = {
		taxType: 'inter_state' as const,
		itcClaimable: true,
		pricesIncludeGst: false,
		freight: '1,800',
		freightGstRatePct: 5,
		roundOff: '0',
		printedTotal: '1,84,150',
	};
	const settings = { priceChangeWarnPct: 10, marginFloorPct: 20 };

	it('works the bill out exactly as the brief: ₹1,73,200 lines, ₹1,800 freight, IGST ₹8,750, ₹1,83,750', () => {
		const result = previewEntry(header, banarasi, settings);
		expect(result.totals.linesINR).toBe(173200);
		expect(result.totals.taxableINR).toBe(175000);
		expect(result.totals.igstINR).toBe(8750);
		expect(result.totals.totalINR).toBe(183750);
		expect(result.totals.matchesPrinted).toBe(false);
		expect(result.totals.differenceINR).toBe(400);
	});

	it('warns on the price jump, the low margin and the HSN the bill printed, never blocking', () => {
		const codes = previewEntry(header, banarasi, settings).warnings.map(
			(warning) => `${warning.lineId}:${warning.code}`,
		);
		expect(codes).toContain('b:price_jump');
		expect(codes).toContain('c:margin_floor');
		expect(codes).toContain('d:hsn_mismatch');
	});

	it('leaves unfinished lines out of the arithmetic and names what is wrong', () => {
		const half = { ...banarasi[0]!, quantity: '' };
		expect(lineProblem(half)).toBe('qty_required');
		expect(lineProblem({ ...banarasi[0]!, hsnOnBill: '50' })).toBe('hsn_digits');
		expect(previewEntry(header, [half], settings).lines).toHaveLength(0);
	});

	it('writes a free line at price 0 and blanks an empty HSN', () => {
		const free = { ...banarasi[0]!, freeOnBill: true, price: '', hsnOnBill: '' };
		expect(lineWrite(free)).toEqual(
			expect.objectContaining({ unitPriceINR: 0, freeOnBill: true, hsnOnBill: null }),
		);
	});

	it('gives freight the GST rate of most of the bill', () => {
		expect(
			freightRate([
				{ ...banarasi[0]!, gstRatePct: 12 },
				{ ...banarasi[3]!, gstRatePct: 5 },
			]),
		).toBe(12);
		expect(freightRate([])).toBe(0);
	});

	it('clamps the round-off and leaves out lines that are not ready', () => {
		const write = entryWrite({
			supplierId: 's1',
			purchaseOrderId: null,
			billNumber: '  BSW/0418 ',
			billDate: '2026-11-10',
			goodsReceivedOn: '2026-11-12',
			header: { ...header, roundOff: '25' },
			billAttachmentAssetId: null,
			lines: [...banarasi, { ...banarasi[0]!, key: 'x', quantity: '' }],
		});
		expect(write.billNumber).toBe('BSW/0418');
		expect(write.roundOffINR).toBe(10);
		expect(write.lines).toHaveLength(4);
		expect(write.printedTotalINR).toBe(184150);
	});

	it('refuses a date inside closed books and warns on odd dates', () => {
		expect(
			dateNotes({
				billDate: '2026-10-30',
				goodsReceivedOn: '2026-11-02',
				today: '2026-11-17',
				booksClosedUpTo: '2026-10-31',
			}).refusal?.key,
		).toBe('books_closed_up_to');
		expect(
			dateNotes({
				billDate: '2026-12-30',
				goodsReceivedOn: '2026-11-02',
				today: '2026-11-17',
				booksClosedUpTo: null,
			}).warnings,
		).toEqual(['bill_dated_in_future', 'goods_long_before_bill']);
	});

	it('words each warning from its code and values', () => {
		const money = (value: number) => `₹${value}`;
		expect(
			warningText({ code: 'price_jump', values: { risePct: 14, lastPriceINR: 10000 } }, t, money, 'PE/9'),
		).toBe('warn_price_jump_entry:{"pct":14,"price":"₹10000","entry":"PE/9"}');
		expect(warningText({ code: 'not_ordered', values: {} }, t, money)).toBe('warn_not_ordered');
	});
});

describe('goods check (p08, g01)', () => {
	const line = (over: Partial<PurchaseEntryLine> = {}) =>
		({
			lineId: 'l1',
			quantity: 12,
			soldBy: 'piece',
			sku: 'ST-TNT-1108-BW',
			supplierItemCode: 'STG-7',
			accepted: null,
			damaged: 0,
			missing: 0,
			damageReason: null,
			damageNote: null,
			damagePhotoAssetIds: [],
			...over,
		}) as PurchaseEntryLine;
	const entry = (lines: PurchaseEntryLine[]) => ({ lines }) as PurchaseEntry;

	it('starts with everything good and keeps every line adding up', () => {
		const [count] = countFrom(entry([line()]));
		expect(count).toMatchObject({ good: 12, damaged: 0, missing: 0 });
		const damaged = adjust(count!, 'damaged', 1);
		expect(damaged).toMatchObject({ good: 11, damaged: 1, missing: 0 });
		const short = adjust(damaged, 'good', 10);
		expect(short).toMatchObject({ good: 10, damaged: 1, missing: 1 });
		expect(adjust(short, 'missing', 99)).toMatchObject({ missing: 12, damaged: 0, good: 0 });
		expect(adjust(short, 'good', -3).good).toBe(0);
	});

	it('needs a note for "other" and sends damage details only for damaged lines', () => {
		const [count] = countFrom(entry([line()]));
		const other = { ...adjust(count!, 'damaged', 2), reason: 'other' as const, note: ' ' };
		expect(countProblem(other)).toBe('count_note_for_other');
		const body = countBody([count!, { ...other, note: 'Torn' }], 3);
		expect(body.version).toBe(3);
		expect(body.lines[0]).toMatchObject({ damageReason: null, damageNote: null, damagePhotoAssetIds: [] });
		expect(body.lines[1]).toMatchObject({ damaged: 2, damageReason: 'other', damageNote: 'Torn' });
	});

	it('totals what goes in and back, and finds a scanned label', () => {
		const lines = countFrom(
			entry([line(), line({ lineId: 'l2', sku: 'ST-TNT-1108-MU', supplierItemCode: null, quantity: 6 })]),
		);
		const totals = countTotals([adjust(lines[0]!, 'damaged', 1), adjust(lines[1]!, 'missing', 1)]);
		expect(totals.anyBack && totals.anyMissing).toBe(true);
		expect(totals.nothingIn).toBe(false);
		expect(lineForCode(lines, ' st-tnt-1108-mu ')).toBe(1);
		expect(lineForCode(lines, 'STG-7')).toBe(0);
		expect(lineForCode(lines, 'NOPE')).toBe(-1);
	});
});

describe('spreadsheet import (p13)', () => {
	it('reads quoted CSV, a BOM, and tab-separated paste', () => {
		expect(parseCsv('﻿SKU,Qty\r\n"A,1",2\n')).toEqual([
			['SKU', 'Qty'],
			['A,1', '2'],
		]);
		expect(parseCsv('a\tb\n"say ""hi"""\t3')).toEqual([
			['a', 'b'],
			['say "hi"', '3'],
		]);
	});

	it('finds columns by heading in any order and numbers rows as the sheet does', () => {
		expect(findColumns(['Qty', 'Unit price', 'Their code'])).toEqual({ quantity: 0, price: 1, code: 2 });
		expect(findColumns(['Name', 'Qty'])).toBeNull();
		const read = importRows(parseCsv('SKU,Quantity,Unit price,HSN,GST %\nST-1,6,"9,200",5007,5\n,1,1\nST-2,x,y'));
		expect(read.problem).toBeNull();
		expect(read.rows).toEqual([
			{ row: 2, code: 'ST-1', quantity: 6, unitPriceINR: 9200, hsn: '5007', gstRatePct: 5 },
			{ row: 4, code: 'ST-2', quantity: 0, unitPriceINR: -1, hsn: '', gstRatePct: null },
		]);
		expect(importRows([]).problem).toBe('import_empty');
	});

	it('adds ready rows and rows given a product here, metres converted for a product picked by hand', () => {
		const lines = readyLines([
			{
				row: 2,
				code: 'A',
				result: 'ready',
				problem: null,
				match: item(),
				quantity: 6,
				unitPriceINR: 9200,
				hsn: '',
				gstRatePct: 12,
				picked: null,
			},
			{
				row: 3,
				code: 'B',
				result: 'needs_product',
				problem: null,
				match: null,
				quantity: 12.5,
				unitPriceINR: 180,
				hsn: '5208',
				gstRatePct: null,
				picked: item({ variantId: 'm', soldBy: 'metre' }),
			},
			{
				row: 4,
				code: 'C',
				result: 'problem',
				problem: 'quantity_below_one',
				match: item(),
				quantity: 0,
				unitPriceINR: 1,
				hsn: '',
				gstRatePct: null,
				picked: null,
			},
			{
				row: 5,
				code: 'D',
				result: 'needs_product',
				problem: null,
				match: null,
				quantity: 1,
				unitPriceINR: 1,
				hsn: '',
				gstRatePct: null,
				picked: null,
			},
		]);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ quantity: '6', gstRatePct: 12 });
		expect(lines[1]).toMatchObject({ quantity: '12.5', gstRatePct: 5, hsnOnBill: '5208' });
	});
});

describe('scanner input (p03)', () => {
	it('picks one exact SKU or supplier code, never a blocked product', () => {
		const options = [item(), item({ variantId: 'v2', sku: 'ST-BAN-0415', supplierItemCode: null })];
		expect(exactMatch(options, 'st-ban-0415')?.variantId).toBe('v2');
		expect(exactMatch(options, 'BSW-K-118')?.variantId).toBe('v1');
		expect(exactMatch(options, 'ST-BAN')).toBeNull();
		expect(exactMatch([item({ blocked: 'discontinued' })], 'ST-BAN-0412')).toBeNull();
	});
});

describe('purchase orders (po01–po04)', () => {
	const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
		({
			id: 'o1',
			number: 'PO/26-27/000003',
			status: 'part_received',
			supplierName: 'Shantipur <Tant> Ghar',
			expectedBy: '2026-11-12',
			sentAt: '2026-11-01T05:00:00.000Z',
			createdAt: '2026-11-01T05:00:00.000Z',
			late: true,
			orderedValueINR: 42000,
			lines: [
				{ quantity: 10, receivedQuantity: 6, soldBy: 'piece' },
				{ quantity: 1200, receivedQuantity: 0, soldBy: 'metre' },
			],
			...over,
		}) as PurchaseOrder;

	it('estimates value and GST from what is typed (metres priced per metre)', () => {
		const lines = [
			{ ...lineFromOption(item(), 14, 1050), gstRatePct: 5 },
			{ ...lineFromOption(item({ variantId: 'f', soldBy: 'metre' }), 1200, 180), gstRatePct: 5 },
		];
		expect(lines[1]?.quantity).toBe('120.0');
		expect(orderEstimate(lines)).toEqual({ linesINR: 36300, gstINR: 1815, totalINR: 38115, rates: [5] });
	});

	it('shows steps, what is still to come, and a late badge with names escaped', () => {
		expect(orderStep(order())).toBe(2);
		expect(orderStep(order({ status: 'closed_short' }))).toBe(2);
		expect(
			orderStep(
				order({ status: 'cancelled', lines: [{ quantity: 1, receivedQuantity: 0, soldBy: 'piece' }] as never }),
			),
		).toBe(1);
		expect(stillToCome(order().lines[0]!)).toBe(4);
		const row = toOrderRow(order(), '2026-11-15', t, (key, n) => `${key}:${n}`);
		expect(row.expectedBy).toContain('days_late:3');
		expect(row.supplier).toBe('Shantipur &lt;Tant&gt; Ghar');
		// Table cells are HTML: every piece of text is escaped, quotes included.
		expect(row.ordered).toBe('10 · unit_metres:{&quot;value&quot;:&quot;120.0&quot;}');
	});
});

describe('purchase entries list and steps (p01, p10)', () => {
	it('names a draft by its coming number and shows payment only once posted', () => {
		const row = toEntryRow(
			{
				id: 'e',
				number: null,
				status: 'draft',
				paymentStatus: 'unpaid',
				supplierName: 'S',
				billNumber: 'B',
				billDate: '2026-11-11',
				pieces: 60,
				totalINR: 81270,
			} as never,
			(key) => key,
		);
		expect(row.number).toContain('gets_number_on_posting');
		expect(row.payment).toContain('—');
		expect(entryStep({ status: 'posted', paymentStatus: 'paid', postedAt: 'x', checkedAt: 'x' })).toBe(3);
		expect(entryStep({ status: 'void', paymentStatus: 'unpaid', postedAt: 'x', checkedAt: 'x' })).toBe(2);
	});
});
