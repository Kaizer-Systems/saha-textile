import { describe, expect, it } from 'vitest';

import { allowedNextStatuses, packLines, packListIncomplete } from '../src/orders/index';

const lines = [
	{ lineId: 's', role: 'bundle' as const },
	{ lineId: 's~a', role: 'piece' as const },
	{ lineId: 's~a>f', role: 'free' as const },
	{ lineId: 'p', role: 'product' as const },
];

describe('the Pack list (bundle builder brief E08)', () => {
	it("lists every physical piece, never a set's own line", () => {
		expect(packLines(lines).map((line) => line.lineId)).toEqual(['s~a', 's~a>f', 'p']);
	});

	it('holds Packed until every piece is ticked, on orders with sets or free items', () => {
		expect(packListIncomplete({ lines, packTicks: ['s~a', 'p'] })).toBe(true);
		expect(packListIncomplete({ lines, packTicks: ['s~a', 's~a>f', 'p'] })).toBe(false);
		expect(packListIncomplete({ lines: [{ lineId: 'p', role: 'product' }], packTicks: [] })).toBe(false);
		expect(packListIncomplete({ lines: [{ lineId: 'old' }] })).toBe(false);
	});

	it('names the reason on the status menu', () => {
		const order = {
			status: 'processing' as const,
			buyerKind: 'person' as const,
			invoiceAddressNeeded: false,
			lines: [{ madeToOrder: false }],
			placeable: true,
			hasEInvoice: false,
			hasEWayBill: false,
			goodsINR: 1000,
			packListIncomplete: true,
		};
		const settings = {
			outForDeliveryOnlyFromCourier: false,
			eInvoiceRequired: false,
			eWayBillThresholdINR: 50000,
			courierConnected: false,
		};
		const packed = allowedNextStatuses(order, settings as never).find((row) => row.to === 'packed');
		expect(packed).toMatchObject({ allowed: false, reason: 'packListIncomplete' });
	});
});
