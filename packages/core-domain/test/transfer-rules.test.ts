import { describe, expect, it } from 'vitest';

import {
	TRANSFER_LEDGERS,
	branchInvoice,
	dispatchBlockers,
	drawnValueINR,
	splitArrived,
	transferDispatchPosting,
	transferReceivePosting,
} from '../src/locations/transfer-rules';

/** Stock transfers (accounts brief N): the postings, the branch invoice, the layers that travel, and Dispatch's checks. */

const sum = (rows: { debitPaise?: number; creditPaise?: number }[], side: 'debitPaise' | 'creditPaise') =>
	rows.reduce((total, row) => total + (row[side] ?? 0), 0);

describe('a transfer within one GSTIN', () => {
	it('moves the cost into Stock in transit on dispatch, and on receipt into the receiver’s stock less what is short', () => {
		expect(transferDispatchPosting({ crossGstin: false, costINR: 46_200, igstINR: 0 })).toEqual([
			{ role: 'stock_in_transit', at: 'sender', debitPaise: 4_620_000 },
			{ role: 'stock_in_hand', at: 'sender', creditPaise: 4_620_000 },
		]);
		const received = transferReceivePosting({
			crossGstin: false,
			costINR: 18_600,
			arrivedCostINR: 18_290,
			igstINR: 0,
			short: 'carrier_claim',
		});
		expect(received).toEqual([
			{ role: 'stock_in_hand', at: 'receiver', debitPaise: 1_829_000 },
			{ role: 'carrier_claims_receivable', at: 'receiver', debitPaise: 31_000 },
			{ role: 'stock_in_transit', at: 'sender', creditPaise: 1_860_000 },
		]);
		expect(
			transferReceivePosting({
				crossGstin: false,
				costINR: 100,
				arrivedCostINR: 100,
				igstINR: 0,
				short: 'transit_loss',
			}),
		).toHaveLength(2);
		// Nothing arrived: it is all a loss.
		expect(
			transferReceivePosting({
				crossGstin: false,
				costINR: 100,
				arrivedCostINR: 0,
				igstINR: 0,
				short: 'transit_loss',
			}),
		).toEqual([
			{ role: 'transit_loss', at: 'receiver', debitPaise: 10_000 },
			{ role: 'stock_in_transit', at: 'sender', creditPaise: 10_000 },
		]);
	});
});

describe('a transfer to another GSTIN (N8)', () => {
	it('is supplied at cost with IGST against the branch account, and the receiver takes credit only on what arrived', () => {
		const out = transferDispatchPosting({ crossGstin: true, costINR: 10_000, igstINR: 500 });
		expect(out).toEqual([
			{ role: 'branch_account', at: 'sender', debitPaise: 1_050_000 },
			{ role: 'branch_transfer_sales', at: 'sender', creditPaise: 1_000_000 },
			{ role: 'output_igst', at: 'sender', creditPaise: 50_000 },
			{ role: 'cost_of_goods_sold', at: 'sender', debitPaise: 1_000_000 },
			{ role: 'stock_in_hand', at: 'sender', creditPaise: 1_000_000 },
		]);
		expect(sum(out, 'debitPaise')).toBe(sum(out, 'creditPaise'));
		expect(transferDispatchPosting({ crossGstin: true, costINR: 100, igstINR: 0 })).toHaveLength(4);
		const back = transferReceivePosting({
			crossGstin: true,
			costINR: 10_000,
			arrivedCostINR: 8_000,
			igstINR: 500,
			short: 'transit_loss',
		});
		expect(back).toEqual([
			{ role: 'stock_in_hand', at: 'receiver', debitPaise: 800_000 },
			{ role: 'input_igst', at: 'receiver', debitPaise: 40_000 },
			{ role: 'transit_loss', at: 'receiver', debitPaise: 210_000 },
			{ role: 'branch_account', at: 'receiver', creditPaise: 1_050_000 },
		]);
		expect(sum(back, 'debitPaise')).toBe(sum(back, 'creditPaise'));
		// All arrived, no tax: just stock against the branch account; none arrived: all of it a loss.
		expect(
			transferReceivePosting({
				crossGstin: true,
				costINR: 100,
				arrivedCostINR: 100,
				igstINR: 0,
				short: 'transit_loss',
			}),
		).toEqual([
			{ role: 'stock_in_hand', at: 'receiver', debitPaise: 10_000 },
			{ role: 'branch_account', at: 'receiver', creditPaise: 10_000 },
		]);
		expect(
			transferReceivePosting({
				crossGstin: true,
				costINR: 0,
				arrivedCostINR: 0,
				igstINR: 0,
				short: 'carrier_claim',
			}),
		).toEqual([{ role: 'branch_account', at: 'receiver', creditPaise: 0 }]);
	});

	it('works out the branch invoice line by line, naming a line with no HSN or no rate', () => {
		const invoice = branchInvoice([
			{ sku: 'SAREE', hsn: '5007', quantity: 2, valueINR: 6_000 },
			{ sku: 'KURTA', hsn: '6211', quantity: 1, valueINR: 3_000 },
			{ sku: 'NOHSN', hsn: null, quantity: 1, valueINR: 10 },
			{ sku: 'TOY', hsn: '9503', quantity: 1, valueINR: 10 },
			{ sku: 'ZERO', hsn: '5007', quantity: 0, valueINR: 0 },
		]);
		expect(invoice.problems).toEqual([
			{ sku: 'NOHSN', problem: 'hsn_missing' },
			{ sku: 'TOY', problem: 'hsn_rate_missing' },
		]);
		expect(invoice.lines.map((l) => [l.sku, l.ratePercent, l.igstINR])).toEqual([
			['SAREE', 5, 300],
			['KURTA', 18, 540],
			['ZERO', 5, 0],
		]);
		expect([invoice.taxableINR, invoice.igstINR, invoice.totalINR]).toEqual([9_000, 840, 9_840]);
	});
});

describe('the cost layers that travel (D15)', () => {
	const drawn = [
		{ layerId: 'new', quantity: 2, unitCostINR: 320, receivedAt: '2026-11-10T00:00:00.000Z' },
		{ layerId: 'old', quantity: 1, unitCostINR: 300, receivedAt: '2026-10-01T00:00:00.000Z' },
	];

	it('values what was drawn, and gives what arrived the oldest layers, what is short the newest', () => {
		expect(drawnValueINR(drawn)).toBe(940);
		expect(splitArrived(drawn, 2)).toEqual({
			arrived: [
				{ layerId: 'old', quantity: 1, unitCostINR: 300, receivedAt: '2026-10-01T00:00:00.000Z' },
				{ layerId: 'new', quantity: 1, unitCostINR: 320, receivedAt: '2026-11-10T00:00:00.000Z' },
			],
			shortValueINR: 320,
		});
		expect(splitArrived(drawn, 0)).toEqual({ arrived: [], shortValueINR: 940 });
		expect(splitArrived(drawn, 3).shortValueINR).toBe(0);
	});
});

describe('why Dispatch is off (N5)', () => {
	it('names every check not met, and none when all are', () => {
		expect(
			dispatchBlockers({
				lines: [
					{ quantity: 4, packed: 4 },
					{ quantity: 6, packed: 5 },
				],
				sealNumber: ' ',
				ewayBillNeeded: true,
				ewayBillNumber: null,
			}),
		).toEqual(['not_all_packed', 'seal_missing', 'eway_bill_missing']);
		expect(
			dispatchBlockers({
				lines: [{ quantity: 1, packed: 1 }],
				sealNumber: 'S-55120',
				ewayBillNeeded: true,
				ewayBillNumber: '341012345678',
			}),
		).toEqual([]);
		expect(dispatchBlockers({ lines: [], sealNumber: 'S-1', ewayBillNeeded: false, ewayBillNumber: null })).toEqual(
			[],
		);
	});

	it('adds the transit loss and carrier claim ledgers to the shared chart', () => {
		expect(TRANSFER_LEDGERS.map((l) => [l.key, l.groupKey])).toEqual([
			['transit_loss', 'indirect_expenses'],
			['carrier_claims_receivable', 'loans_and_advances'],
		]);
	});
});
