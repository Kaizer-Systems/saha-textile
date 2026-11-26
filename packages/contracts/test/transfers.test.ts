import { describe, expect, it } from 'vitest';

import {
	LocationStockQuery,
	StockTransfer,
	TransferCancelWrite,
	TransferDecisionWrite,
	TransferListQuery,
	TransferPackWrite,
	TransferReceiveWrite,
	TransferRequestWrite,
} from '../src/transfers';

/** Stock transfers (accounts brief N1–N8): what a request, a decision, a checklist and a receipt take. */

const AT = '2026-11-24T06:00:00.000Z';

describe('transfer contracts', () => {
	it('fills a transfer’s defaults and takes a request for at least one item', () => {
		const transfer = StockTransfer.parse({
			id: 'tr1',
			number: 'TR/26-27/000019',
			status: 'requested',
			fromLocationId: 'loc_bar',
			toLocationId: 'loc_sl',
			lines: [
				{ lineId: 'l1', variantId: 'v1', productId: 'p1', sku: 'KAN-PB', title: 'Kanchipuram', quantity: 1 },
			],
			createdAt: AT,
			updatedAt: AT,
		});
		expect(transfer).toMatchObject({ crossGstin: false, valueINR: 0, challanNumber: null, version: 0 });
		expect(transfer.lines[0]).toMatchObject({ packed: 0, arrived: null, drawn: [], soldBy: 'piece' });
		expect(
			TransferRequestWrite.parse({
				fromLocationId: 'a',
				toLocationId: 'b',
				lines: [{ variantId: 'v1', quantity: 2 }],
			}),
		).toMatchObject({ neededBy: null, forOrderId: null, note: '' });
		expect(TransferRequestWrite.safeParse({ fromLocationId: 'a', toLocationId: 'b', lines: [] }).success).toBe(
			false,
		);
	});

	it('takes a decision, a checklist with a 12- or 14-digit e-way bill, a receipt and a cancel with a reason', () => {
		expect(TransferDecisionWrite.parse({ approve: false, version: 0 }).reason).toBe('');
		const pack = TransferPackWrite.parse({ lines: [{ lineId: 'l1', packed: 1 }], version: 1 });
		expect([pack.dispatch, pack.ewayBillNumber, pack.boxes]).toEqual([false, '', null]);
		expect(TransferPackWrite.safeParse({ ...pack, ewayBillNumber: '34101234567890' }).success).toBe(true);
		expect(TransferPackWrite.safeParse({ ...pack, ewayBillNumber: '1234' }).success).toBe(false);
		expect(TransferReceiveWrite.parse({ lines: [{ lineId: 'l1', arrived: 2 }], version: 2 })).toMatchObject({
			short: 'carrier_claim',
			lines: [{ damaged: 0, note: '' }],
		});
		expect(TransferCancelWrite.safeParse({ reason: 'x', version: 0 }).success).toBe(false);
	});

	it('lists by period and chip, and reads stock by location', () => {
		expect(TransferListQuery.parse({ from: '2026-11-01', to: '2026-11-30' })).toMatchObject({
			chip: 'all',
			page: 1,
		});
		expect(TransferListQuery.safeParse({ from: '2026-11-01', to: '2026-11-30', chip: 'lost' }).success).toBe(false);
		expect(LocationStockQuery.parse({})).toEqual({ search: '', chip: 'all', page: 1, pageSize: 25 });
	});
});
