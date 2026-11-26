import { describe, expect, it } from 'vitest';

import { permissionLabelKey } from '@features/role/permissions/permissions';
import { reportTabFrom } from '@features/stock/reports';

import { stockBellLines } from './notification';

import type { StockAlerts } from '@core/purchasing/stock.gateway';

const alerts = (over: Partial<StockAlerts> = {}): StockAlerts => ({
	pendingApprovals: 0,
	decisions: [],
	lateOrders: [],
	billsNearCreditLimit: [],
	heldOverdue: 0,
	...over,
});

describe('stock lines in the bell', () => {
	it('says nothing when nothing waits', () => {
		expect(stockBellLines(undefined)).toEqual([]);
		expect(stockBellLines(alerts())).toEqual([]);
	});

	it('puts approvals first, then decisions on my requests that open their item or count', () => {
		const lines = stockBellLines(
			alerts({
				pendingApprovals: 3,
				decisions: [
					{
						id: 'req_1',
						kind: 'adjustment',
						action: 'remove',
						variantId: 'var_1',
						countId: null,
						countNumber: null,
						status: 'rejected',
						sku: 'ST-BAN-0412',
						quantity: 2,
						soldBy: 'piece',
						decidedByName: 'Moulik',
						rejectReason: 'Send both back first',
					},
					{
						id: 'req_2',
						kind: 'count',
						action: null,
						variantId: null,
						countId: 'cnt_7',
						countNumber: 'SC/26-27/000007',
						status: 'applied',
						sku: null,
						quantity: 0,
						soldBy: 'piece',
						decidedByName: 'Moulik',
						rejectReason: null,
					},
				],
			}),
		);
		expect(lines.map((line) => line.key)).toEqual([
			'bell_approvals_waiting',
			'bell_request_rejected',
			'bell_count_approved',
		]);
		expect(lines[0]).toMatchObject({ count: 3, link: ['/stock/approvals'], seenId: null });
		expect(lines[1]).toMatchObject({
			link: ['/stock/items', 'var_1'],
			seenId: 'req_1',
			quantity: { units: 2, soldBy: 'piece' },
			params: { reason: 'Send both back first', sku: 'ST-BAN-0412' },
		});
		expect(lines[2]).toMatchObject({ link: ['/stock-counts', 'cnt_7'], quantity: null, seenId: 'req_2' });
	});

	it('names late orders one by one, and sums old bills and overdue holds', () => {
		const lines = stockBellLines(
			alerts({
				lateOrders: [
					{
						id: 'po_1',
						number: 'PO/26-27/000003',
						supplierName: 'Shantipur Tant Ghar',
						expectedBy: '2026-11-12',
					},
				],
				billsNearCreditLimit: [
					{ id: 'pe_1', number: 'PE/26-27/000002', supplierName: 'A', days: 162 },
					{ id: 'pe_2', number: 'PE/26-27/000003', supplierName: 'B', days: 151 },
				],
				heldOverdue: 4,
			}),
		);
		expect(lines.map((line) => line.id)).toEqual(['late-po_1', 'unpaid-bills', 'held-overdue']);
		expect(lines[1]).toMatchObject({ count: 2, params: { days: 151 }, queryParams: { tab: 'unpaid' } });
		expect(lines[2]).toMatchObject({ count: 4, link: ['/stock/held'] });
	});
});

describe('links into reports and the roles form', () => {
	it('opens the asked-for report tab, never an unknown one', () => {
		expect(reportTabFrom(undefined, 'unpaid')).toBe('unpaid');
		expect(reportTabFrom('movements', 'unpaid')).toBe('movements');
		expect(reportTabFrom(undefined, 'secret')).toBe('ageing');
		expect(reportTabFrom(undefined, null)).toBe('ageing');
	});

	it('names the purchases and stock permissions as drawn and leaves the others alone', () => {
		expect(permissionLabelKey('stock')).toBe('perm_group_stock');
		expect(permissionLabelKey('stock.cost')).toBe('perm_stock_cost');
		expect(permissionLabelKey('purchase_order.cancel')).toBe('perm_purchase_order_cancel');
		expect(permissionLabelKey('product')).toBeNull();
		expect(permissionLabelKey('product.index')).toBeNull();
	});
});
