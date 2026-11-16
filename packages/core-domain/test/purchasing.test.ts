import type { PurchaseEntry, PurchaseReturn, SupplierPayment } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	adjustmentNeedsApproval,
	adjustmentRefusal,
	booksClosedProblem,
	classifyOpeningRow,
	computePurchaseEntry,
	computeReturnTotals,
	countLineDifference,
	entryDateWarnings,
	entryOutstanding,
	entryPaymentStatus,
	entryDueOn,
	fifoDraw,
	fiscalYearOf,
	formatDocumentNumber,
	formatQuantity,
	freeToReturn,
	goodsCheckProblems,
	holdOverdue,
	istDay,
	normalizeBillNumber,
	numberFormatProblem,
	oldestPieceDays,
	paymentStatusOf,
	paymentsTotal,
	purchaseOrderLate,
	purchaseOrderStatusOf,
	purchaseTaxType,
	reorderSuggestion,
	returnsCredit,
	samePersonProblem,
	scrapLeftover,
	shareByWeight,
	snapMetres,
	onHandValue,
	stockStatus,
	supplierStatement,
	toPaise,
	voidBlockers,
	type EntryMathLineInput,
} from '../src/purchasing/index';

const line = (overrides: Partial<EntryMathLineInput>): EntryMathLineInput => ({
	lineId: 'l1',
	soldBy: 'piece',
	quantity: 1,
	unitPriceINR: 100,
	freeOnBill: false,
	gstRatePct: 5,
	sellingPriceINR: 200,
	lastPriceINR: null,
	hsnOnBill: null,
	productHsn: null,
	disabled: false,
	notOrdered: false,
	...overrides,
});

/** The Banaras Silk Weavers bill drawn in the brief (p06, p09, p10). */
const banaras = () =>
	computePurchaseEntry({
		taxType: 'inter_state',
		pricesIncludeGst: false,
		freightINR: 1800,
		freightGstRatePct: 5,
		roundOffINR: 0,
		printedTotalINR: 183_750,
		itcClaimable: true,
		priceChangeWarnPct: 10,
		marginFloorPct: 20,
		lines: [
			line({
				lineId: 'red',
				quantity: 6,
				unitPriceINR: 9200,
				sellingPriceINR: 15_900,
				lastPriceINR: 8600,
				hsnOnBill: '5007',
				productHsn: '5007',
			}),
			line({
				lineId: 'maroon',
				quantity: 4,
				unitPriceINR: 11_400,
				sellingPriceINR: 18_900,
				lastPriceINR: 10_000,
			}),
			line({ lineId: 'gold', quantity: 3, unitPriceINR: 13_800, sellingPriceINR: 15_500, lastPriceINR: 13_500 }),
			line({
				lineId: 'pink',
				quantity: 5,
				unitPriceINR: 6200,
				sellingPriceINR: 9900,
				lastPriceINR: 6200,
				hsnOnBill: '5208',
				productHsn: '5007',
			}),
		],
	});

describe('purchase entry arithmetic', () => {
	it('adds up the Banaras bill exactly as the brief shows it', () => {
		const { totals } = banaras();
		expect(totals.linesINR).toBe(173_200);
		expect(totals.freightINR).toBe(1800);
		expect(totals.taxableINR).toBe(175_000);
		expect(totals.igstINR).toBe(8750);
		expect(totals.cgstINR + totals.sgstINR).toBe(0);
		expect(totals.totalINR).toBe(183_750);
		expect(totals.matchesPrinted).toBe(true);
		expect(totals.pieces).toBe(18);
		expect(totals.costIntoStockINR).toBe(175_000);
	});

	it('puts freight into each piece by line value: the red Banarasi goes in at ₹9,295.61', () => {
		const red = banaras().lines.find((entry) => entry.lineId === 'red');
		expect(red?.freightShareINR).toBe(573.67);
		expect(red?.unitCostINR).toBeCloseTo(9295.61, 2);
	});

	it('warns on a 14% price jump, a margin under the floor and an HSN that differs from the bill', () => {
		const codes = banaras().warnings.map((warning) => `${warning.code}:${warning.lineId}`);
		expect(codes).toEqual(expect.arrayContaining(['price_jump:maroon', 'margin_floor:gold', 'hsn_mismatch:pink']));
		expect(codes).not.toContain('price_jump:red'); // 7% is under the 10% setting
		const margin = banaras().warnings.find((warning) => warning.code === 'margin_floor');
		expect(margin?.values.marginPct).toBe(6);
	});

	it('refuses a bill whose printed total is ₹400 off, but allows ₹1 of rounding', () => {
		const off = computePurchaseEntry({ ...baseInput(), printedTotalINR: 184_150 });
		expect(off.totals.matchesPrinted).toBe(false);
		expect(off.totals.differenceINR).toBe(400);
		expect(computePurchaseEntry({ ...baseInput(), printedTotalINR: 183_751 }).totals.matchesPrinted).toBe(true);
		expect(computePurchaseEntry({ ...baseInput(), printedTotalINR: null }).totals.matchesPrinted).toBe(false);
	});

	it('splits a West Bengal supplier’s GST into CGST and SGST halves (the Shantipur bill)', () => {
		const result = computePurchaseEntry({
			...baseInput(),
			taxType: 'intra_state',
			freightINR: 0,
			printedTotalINR: 39_690,
			lines: [line({ quantity: 36, unitPriceINR: 1050 })],
		});
		expect(result.totals.taxableINR).toBe(37_800);
		expect(result.totals.cgstINR).toBe(945);
		expect(result.totals.sgstINR).toBe(945);
		expect(result.totals.totalINR).toBe(39_690);
	});

	it('reads a bill printed including GST back to its taxable value', () => {
		const result = computePurchaseEntry({
			...baseInput(),
			pricesIncludeGst: true,
			freightINR: 0,
			lines: [line({ quantity: 2, unitPriceINR: 1050 })],
		});
		expect(result.totals.taxableINR).toBe(2000);
		expect(result.totals.igstINR).toBe(100);
		expect(result.totals.totalINR).toBe(2100);
		expect(result.lines[0]?.unitCostINR).toBe(1000);
	});

	it('costs a composition supplier’s piece at its full price, with no GST lines', () => {
		const result = computePurchaseEntry({
			...baseInput(),
			taxType: 'none',
			itcClaimable: false,
			freightINR: 0,
			lines: [line({ quantity: 40, unitPriceINR: 550 })],
		});
		expect(result.totals.igstINR + result.totals.cgstINR + result.totals.sgstINR).toBe(0);
		expect(result.totals.totalINR).toBe(22_000);
		expect(result.lines[0]?.unitCostINR).toBe(550);
	});

	it('bills a metre line by metres and keeps cost per tenth for the layers', () => {
		const result = computePurchaseEntry({
			...baseInput(),
			freightINR: 0,
			lines: [line({ soldBy: 'metre', quantity: 1200, unitPriceINR: 180 })],
		});
		expect(result.totals.taxableINR).toBe(21_600); // 120.0 m × ₹180
		expect(result.lines[0]?.unitCostINR).toBe(180);
		expect(result.lines[0]?.unitCostPerStockUnitINR).toBe(18);
	});

	it('gives free pieces no cost and no freight share', () => {
		const result = computePurchaseEntry({
			...baseInput(),
			freightINR: 100,
			lines: [
				line({ lineId: 'paid', quantity: 2, unitPriceINR: 500 }),
				line({ lineId: 'free', quantity: 1, unitPriceINR: 500, freeOnBill: true }),
			],
		});
		const free = result.lines.find((entry) => entry.lineId === 'free');
		expect(free?.unitCostINR).toBe(0);
		expect(free?.freightShareINR).toBe(0);
		expect(result.lines.find((entry) => entry.lineId === 'paid')?.unitCostINR).toBe(550);
	});

	it('shares an amount by weight so the parts add back exactly', () => {
		const parts = shareByWeight(100, [1, 1, 1]);
		expect(parts.reduce((sum, part) => sum + part, 0)).toBe(100);
		expect(shareByWeight(180_000, [5_520_000, 4_560_000, 4_140_000, 3_100_000]).reduce((s, p) => s + p, 0)).toBe(
			180_000,
		);
		expect(shareByWeight(500, [0, 0])).toEqual([0, 0]);
	});

	it('takes the tax type from the supplier, never from typing', () => {
		expect(purchaseTaxType('regular', '19', '19')).toBe('intra_state');
		expect(purchaseTaxType('regular', '09', '19')).toBe('inter_state');
		expect(purchaseTaxType('composition', '19', '19')).toBe('none');
		expect(purchaseTaxType('unregistered', '24', '19')).toBe('none');
	});
});

function baseInput() {
	return {
		taxType: 'inter_state' as const,
		pricesIncludeGst: false,
		freightINR: 1800,
		freightGstRatePct: 5,
		roundOffINR: 0,
		printedTotalINR: 183_750 as number | null,
		itcClaimable: true,
		priceChangeWarnPct: 10,
		marginFloorPct: 20,
		lines: [
			line({ lineId: 'red', quantity: 6, unitPriceINR: 9200 }),
			line({ lineId: 'maroon', quantity: 4, unitPriceINR: 11_400 }),
			line({ lineId: 'gold', quantity: 3, unitPriceINR: 13_800 }),
			line({ lineId: 'pink', quantity: 5, unitPriceINR: 6200 }),
		],
	};
}

describe('purchase rules', () => {
	it('checks the goods: good + damaged + missing must equal the bill, damage needs a reason', () => {
		const lines = [
			{ lineId: 'a', quantity: 12 },
			{ lineId: 'b', quantity: 6 },
		];
		expect(
			goodsCheckProblems(lines, [
				{ lineId: 'a', accepted: 11, damaged: 1, missing: 0, damageReason: 'damaged_on_arrival' },
				{ lineId: 'b', accepted: 5, damaged: 0, missing: 1, damageReason: null },
			]),
		).toEqual([]);
		const codes = goodsCheckProblems(lines, [
			{ lineId: 'a', accepted: 10, damaged: 1, missing: 0, damageReason: null },
		]).map((problem) => problem.code);
		expect(codes).toEqual(['goods_check_sum', 'goods_check_reason', 'goods_check_missing_line']);
		expect(
			goodsCheckProblems(
				[{ lineId: 'a', quantity: 2 }],
				[{ lineId: 'a', accepted: 0, damaged: 2, missing: 0, damageReason: 'wrong_item' }],
			).map((p) => p.code),
		).toContain('nothing_into_stock');
	});

	it('refuses dates on or before the books-closed day (P9)', () => {
		expect(booksClosedProblem(['2026-10-31'], '2026-10-31')?.code).toBe('books_closed');
		expect(booksClosedProblem(['2026-11-01'], '2026-10-31')).toBeNull();
		expect(booksClosedProblem(['2026-01-01'], null)).toBeNull();
	});

	it('warns on a bill dated ahead or goods received long before the bill', () => {
		expect(
			entryDateWarnings({ billDate: '2026-11-20', goodsReceivedOn: '2026-11-20', today: '2026-11-17' }).map(
				(w) => w.code,
			),
		).toEqual(['bill_in_future']);
		expect(
			entryDateWarnings({ billDate: '2026-11-15', goodsReceivedOn: '2026-10-01', today: '2026-11-17' }).map(
				(w) => w.code,
			),
		).toEqual(['date_order']);
	});

	it('asks for a second person only when the super admin has switched a step on (P1)', () => {
		expect(samePersonProblem({ required: false, actorId: 'a', previousActorId: 'a', step: 'post' })).toBeNull();
		expect(samePersonProblem({ required: true, actorId: 'a', previousActorId: 'a', step: 'post' })?.code).toBe(
			'same_person',
		);
		expect(samePersonProblem({ required: true, actorId: 'b', previousActorId: 'a', step: 'post' })).toBeNull();
	});

	it('works out due dates and payment states', () => {
		expect(entryDueOn('2026-11-10', 30)).toBe('2026-12-10');
		expect(paymentStatusOf(183_750, 0)).toBe('unpaid');
		expect(paymentStatusOf(183_750, 100_000)).toBe('part_paid');
		expect(paymentStatusOf(183_750, 183_750)).toBe('paid');
	});

	it('moves a purchase order through part received to received, and flags it late', () => {
		expect(purchaseOrderStatusOf({ current: 'sent', lines: [{ quantity: 10, receivedQuantity: 6 }] })).toBe(
			'part_received',
		);
		expect(
			purchaseOrderStatusOf({ current: 'part_received', lines: [{ quantity: 10, receivedQuantity: 12 }] }),
		).toBe('received');
		expect(purchaseOrderStatusOf({ current: 'closed_short', lines: [{ quantity: 10, receivedQuantity: 6 }] })).toBe(
			'closed_short',
		);
		expect(purchaseOrderLate({ status: 'part_received', expectedBy: '2026-11-12', today: '2026-11-15' })).toBe(
			true,
		);
		expect(purchaseOrderLate({ status: 'received', expectedBy: '2026-11-12', today: '2026-11-15' })).toBe(false);
	});

	it('refuses a void once pieces have sold, been returned, or paid for', () => {
		const sold = voidBlockers({
			status: 'posted',
			layers: [
				{ sku: 'ST-BAN-0412', received: 6, remaining: 4, sold: 2, returned: 0, documents: ['SO/26-27/000231'] },
			],
			reservedBySku: {},
			activePayments: 0,
			sentReturns: 0,
		});
		expect(sold).toMatchObject({ blocked: true, reason: 'stock_moved' });
		expect(sold.lines[0]?.documents).toEqual(['SO/26-27/000231']);
		expect(
			voidBlockers({
				status: 'posted',
				layers: [{ sku: 'x', received: 6, remaining: 6, sold: 0, returned: 0, documents: [] }],
				reservedBySku: {},
				activePayments: 1,
				sentReturns: 0,
			}).reason,
		).toBe('payments');
		expect(
			voidBlockers({
				status: 'posted',
				layers: [{ sku: 'x', received: 6, remaining: 6, sold: 0, returned: 0, documents: [] }],
				reservedBySku: {},
				activePayments: 0,
				sentReturns: 0,
			}).blocked,
		).toBe(false);
		expect(
			voidBlockers({ status: 'draft', layers: [], reservedBySku: {}, activePayments: 0, sentReturns: 0 }).reason,
		).toBe('wrong_status');
	});

	it('treats the same bill number written differently as the same bill', () => {
		expect(normalizeBillNumber('BSW/2026-27/0418')).toBe(normalizeBillNumber('bsw/2026 27/0418'));
		expect(normalizeBillNumber('BSW-2026-27-0418')).toBe(normalizeBillNumber('BSW/2026-27/0418'));
		expect(normalizeBillNumber('bw.1042')).toBe('BW1042');
		expect(normalizeBillNumber('STG/1187')).not.toBe(normalizeBillNumber('STG/1188'));
		expect(normalizeBillNumber('STG/0418')).not.toBe(normalizeBillNumber('STG/418'));
	});
});

describe('numbers and financial years (P7)', () => {
	it('resets on 1 April, in India time', () => {
		expect(fiscalYearOf('2027-03-31')).toBe('2026-27');
		expect(fiscalYearOf('2027-04-01')).toBe('2027-28');
		expect(istDay('2027-03-31T19:00:00Z')).toBe('2027-04-01');
	});

	it('formats PE/26-27/000014 and refuses a format over 16 characters', () => {
		expect(formatDocumentNumber('PE/{fy}/{seq6}', '2026-27', 14)).toBe('PE/26-27/000014');
		expect(numberFormatProblem('PE/{fy}/{seq6}')).toBeNull();
		expect(numberFormatProblem('STCN/{fy}/{seq6}')).toBe('too_long');
		expect(numberFormatProblem('PE/{fy}')).toBe('missing_sequence');
	});
});

describe('stock rules', () => {
	it('lets an approver write off directly and sends everyone else’s for approval (P2)', () => {
		expect(adjustmentNeedsApproval('remove', true)).toBe(false);
		expect(adjustmentNeedsApproval('remove', false)).toBe(true);
		expect(adjustmentNeedsApproval('add', false)).toBe(true);
		expect(adjustmentNeedsApproval('hold', false)).toBe(false);
		expect(adjustmentNeedsApproval('release', false)).toBe(false);
	});

	it('never takes out what paid orders or holds need (oversell stays off)', () => {
		const facts = { onHand: 7, held: 1, reserved: 0 };
		expect(
			adjustmentRefusal({ action: 'remove', quantity: 6, facts, soldBy: 'piece', hold: null, tracked: true }),
		).toBeNull();
		expect(
			adjustmentRefusal({ action: 'remove', quantity: 7, facts, soldBy: 'piece', hold: null, tracked: true }),
		).toMatch(/free/);
		expect(
			adjustmentRefusal({
				action: 'remove',
				quantity: 1,
				facts,
				soldBy: 'piece',
				hold: { quantity: 1, status: 'open' },
				tracked: true,
			}),
		).toBeNull();
		expect(
			adjustmentRefusal({
				action: 'release',
				quantity: 2,
				facts,
				soldBy: 'piece',
				hold: { quantity: 1, status: 'open' },
				tracked: true,
			}),
		).toMatch(/held/);
		expect(
			adjustmentRefusal({ action: 'hold', quantity: 7, facts, soldBy: 'piece', hold: null, tracked: true }),
		).toMatch(/free to hold/);
		expect(
			adjustmentRefusal({
				action: 'remove',
				quantity: 1,
				facts: { onHand: 2, held: 0, reserved: 2 },
				soldBy: 'piece',
				hold: null,
				tracked: true,
			}),
		).toMatch(/paid orders/);
	});

	it('values a write-off oldest first and says how (i04)', () => {
		const draw = fifoDraw(
			[
				{ id: 'b', receivedAt: '2026-11-12T00:00:00Z', quantityRemaining: 6, unitCostINR: 9295.61 },
				{ id: 'a', receivedAt: '2026-10-02T00:00:00Z', quantityRemaining: 1, unitCostINR: 8600 },
			],
			2,
			'piece',
		);
		expect(draw.valueINR).toBe(17_895.61);
		expect(draw.breakdown).toBe('1 at ₹8,600 + 1 at ₹9,295.61');
		expect(
			fifoDraw([{ id: 'a', receivedAt: '2026-10-02', quantityRemaining: 1, unitCostINR: 10 }], 3, 'piece')
				.uncosted,
		).toBe(2);
		expect(
			fifoDraw([{ id: 'a', receivedAt: '2026-10-02', quantityRemaining: 50, unitCostINR: 18 }], 25, 'metre')
				.breakdown,
		).toBe('2.5 m at ₹180 / m');
	});

	it('names stock states, ages and overdue holds', () => {
		expect(stockStatus({ free: 0, lowLevel: 2, madeToOrder: false })).toBe('out');
		expect(stockStatus({ free: 0, lowLevel: 2, madeToOrder: true })).toBe('made_to_order');
		expect(stockStatus({ free: 2, lowLevel: 2, madeToOrder: false })).toBe('low');
		expect(stockStatus({ free: 9, lowLevel: 2, madeToOrder: false })).toBe('in_stock');
		expect(
			oldestPieceDays(
				[{ id: 'a', receivedAt: '2026-03-14T00:00:00Z', quantityRemaining: 2, unitCostINR: 1 }],
				'2026-11-15',
			),
		).toBe(246);
		expect(holdOverdue('2026-10-18T00:00:00Z', '2026-11-15', 21)).toBe(true);
		expect(holdOverdue('2026-11-10T00:00:00Z', '2026-11-15', 21)).toBe(false);
	});

	it('expects what moved during a count, so the shop keeps selling', () => {
		expect(countLineDifference({ atStart: 8, movedSince: -1, counted: 7 })).toEqual({ expected: 7, difference: 0 });
		expect(countLineDifference({ atStart: 5, movedSince: 0, counted: 3 })).toEqual({ expected: 5, difference: -2 });
		expect(countLineDifference({ atStart: 5, movedSince: 0, counted: null }).difference).toBeNull();
	});

	it('suggests a reorder covering 45 days', () => {
		expect(reorderSuggestion({ free: 1, lowLevel: 2, soldLast60: 19, soldBy: 'piece' })).toMatchObject({
			listed: true,
			daysLeft: 3,
			suggested: 14,
		});
		expect(reorderSuggestion({ free: 50, lowLevel: 2, soldLast60: 6, soldBy: 'piece' }).listed).toBe(false);
		expect(reorderSuggestion({ free: 0, lowLevel: null, soldLast60: 0, soldBy: 'piece' })).toMatchObject({
			listed: false,
			suggested: 1,
		});
	});

	it('classifies opening stock rows and only lets ready rows post', () => {
		const base = {
			known: true,
			soldBy: 'piece' as const,
			quantity: 2,
			unitCostINR: 8200,
			hasStockOrMovements: false,
			repeated: false,
		};
		expect(classifyOpeningRow(base)).toBe('ready');
		expect(classifyOpeningRow({ ...base, unitCostINR: null })).toBe('cost_missing');
		expect(classifyOpeningRow({ ...base, known: false })).toBe('unknown_sku');
		expect(classifyOpeningRow({ ...base, hasStockOrMovements: true })).toBe('already_has_stock');
		expect(classifyOpeningRow({ ...base, quantity: 1.5 })).toBe('quantity_invalid');
		expect(classifyOpeningRow({ ...base, soldBy: 'metre', quantity: 42.5 })).toBe('ready');
		expect(classifyOpeningRow({ ...base, soldBy: 'metre', quantity: 42.55 })).toBe('quantity_invalid');
		expect(classifyOpeningRow({ ...base, repeated: true })).toBe('repeated');
	});

	it('snaps metres to 0.1 and finds the scrap a cut would leave (M1, M3)', () => {
		expect(snapMetres(2.55)).toEqual({ tenths: 26, snapped: true });
		expect(snapMetres(2.5)).toEqual({ tenths: 25, snapped: false });
		expect(scrapLeftover({ requested: 40, available: 45, shortestCut: 10 })).toBe(5);
		expect(scrapLeftover({ requested: 30, available: 45, shortestCut: 10 })).toBeNull();
		expect(formatQuantity(425, 'metre')).toBe('42.5 m');
	});
});

describe('purchase returns', () => {
	const facts = {
		entryLineId: 'l',
		accepted: 12,
		missing: 0,
		returnedBefore: 0,
		claimedShortBefore: 0,
		onHand: 9,
		held: 4,
		reserved: 2,
		layerRemaining: 9,
		soldBy: 'piece' as const,
	};

	it('caps a return at what is free, and says why (r03)', () => {
		const cap = freeToReturn(facts, 'return_goods');
		expect(cap.max).toBe(3);
		expect(cap.capReason).toMatch(/4 held and 2 in paid orders/);
		expect(freeToReturn(facts, 'return_goods', { quantity: 4 }).max).toBe(4);
		expect(freeToReturn({ ...facts, missing: 2, claimedShortBefore: 1 }, 'short_supply').max).toBe(1);
	});

	it('values a debit note at the entry’s own cost with GST as billed', () => {
		const totals = computeReturnTotals('inter_state', [
			{ quantity: 6, unitCostPerStockUnitINR: 940, gstRatePct: 5 },
		]);
		expect(totals).toMatchObject({ taxableINR: 5640, igstINR: 282, totalINR: 5922 });
		const intra = computeReturnTotals('intra_state', [
			{ quantity: 1, unitCostPerStockUnitINR: 1050, gstRatePct: 5 },
		]);
		expect(intra.cgstINR + intra.sgstINR).toBe(52.5);
	});

	it('keeps paise exact', () => {
		expect(toPaise(0.1 + 0.2)).toBe(30);
		expect(toPaise(-1.005)).toBe(-101);
	});
});

describe('supplier account (s03)', () => {
	const entry = (id: string, total: number, extra: Record<string, unknown> = {}) =>
		({
			id,
			number: `PE/26-27/${id}`,
			status: 'posted',
			billNumber: `B-${id}`,
			billDate: '2026-11-01',
			totals: { totalINR: total },
			paidINR: 0,
			creditedINR: 0,
			voidedAt: null,
			voidReason: null,
			...extra,
		}) as unknown as PurchaseEntry;
	const payment = (amount: number, paidOn: string, reversedAt: string | null = null) =>
		({
			id: `pay_${amount}_${paidOn}`,
			purchaseEntryId: 'e1',
			amountINR: amount,
			paidOn,
			mode: 'bank_transfer',
			reference: 'UTR1',
			reversedAt,
			reverseReason: reversedAt ? 'Bounced' : null,
		}) as unknown as SupplierPayment;
	const debitNote = (total: number, settlement: Record<string, unknown> | null, settled = 0) =>
		({
			id: `dn_${total}`,
			number: 'DN/26-27/000001',
			status: settlement ? 'settled' : 'sent',
			purchaseEntryNumber: 'PE/26-27/e1',
			totalINR: total,
			sentAt: '2026-11-05T05:00:00.000Z',
			settlements: settlement
				? [
						{
							id: 's1',
							amountINR: settled,
							attachmentAssetId: null,
							by: null,
							at: '2026-11-09T05:00:00.000Z',
							...settlement,
						},
					]
				: [],
			settledINR: settled,
		}) as unknown as PurchaseReturn;

	it('owes the bill less payments and debit notes, in exact paise', () => {
		expect(entryOutstanding(entry('e1', 183_750.1, { paidINR: 100_000.05, creditedINR: 5_922.02 }))).toBe(
			77_828.03,
		);
	});

	it('calls a bill paid once payments and debit notes cover it', () => {
		expect(entryPaymentStatus(entry('e1', 1000))).toBe('unpaid');
		expect(entryPaymentStatus(entry('e1', 1000, { paidINR: 400 }))).toBe('part_paid');
		expect(entryPaymentStatus(entry('e1', 1000, { paidINR: 400, creditedINR: 600 }))).toBe('paid');
		expect(entryPaymentStatus(entry('e1', 1000, { creditedINR: 1000 }))).toBe('paid');
	});

	it('gives back credit when the supplier refunds or refuses a debit note', () => {
		expect(returnsCredit([debitNote(5922, null)])).toBe(5922);
		expect(returnsCredit([debitNote(5922, { how: 'refund', date: '2026-11-09', reference: 'R1' }, 2000)])).toBe(
			3922,
		);
		expect(
			returnsCredit([debitNote(5922, { how: 'written_off', date: '2026-11-09', reference: null }, 5922)]),
		).toBe(0);
		expect(returnsCredit([{ ...debitNote(5922, null), status: 'draft' } as PurchaseReturn])).toBe(0);
	});

	it('leaves reversed payments out of what was paid', () => {
		expect(
			paymentsTotal([payment(1000, '2026-11-02'), payment(500, '2026-11-03', '2026-11-04T10:00:00.000Z')]),
		).toBe(1000);
	});

	it('runs a statement in date order with bills before money on the same day', () => {
		const rows = supplierStatement({
			entries: [entry('e1', 10_000)],
			payments: [payment(10_000, '2026-11-01'), payment(500, '2026-11-06', '2026-11-07T10:00:00.000Z')],
			returns: [debitNote(1_050, { how: 'refund', date: '2026-11-08', reference: 'NEFT9' }, 1_050)],
		});
		expect(rows.map((row) => [row.date, row.kind, row.balanceINR])).toEqual([
			['2026-11-01', 'bill', 10_000],
			['2026-11-01', 'payment', 0],
			['2026-11-05', 'debit_note', -1_050],
			['2026-11-06', 'payment', -1_550],
			['2026-11-07', 'payment_reversed', -1_050],
			['2026-11-08', 'refund_received', 0],
		]);
	});
});

describe('on-hand value', () => {
	const layer = (id: string, receivedAt: string, remaining: number, cost: number) => ({
		id,
		receivedAt,
		quantityRemaining: remaining,
		unitCostINR: cost,
	});

	it('values what is on hand against the newest layers', () => {
		const layers = [layer('old', '2026-04-01', 5, 100), layer('new', '2026-10-01', 3, 150)];
		expect(onHandValue(layers, 4)).toEqual({ valueINR: 550, uncosted: 0 });
	});

	it('reports pieces no layer covers instead of valuing them at nothing silently', () => {
		expect(onHandValue([layer('only', '2026-10-01', 2, 99.99)], 5)).toEqual({ valueINR: 199.98, uncosted: 3 });
		expect(onHandValue([], 0)).toEqual({ valueINR: 0, uncosted: 0 });
	});
});
