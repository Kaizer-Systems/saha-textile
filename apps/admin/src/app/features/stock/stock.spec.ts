import { describe, expect, it } from 'vitest';

import { adjustProblem } from './adjust-popup';
import { isOwnRequest } from './approvals';
import { holdPill, rowFromHold } from './held';
import { documentLink, movementPill } from './stock-item';
import { toStockRow } from './stock-list';

import type { StockHold, StockListRow } from '@saha-textile/contracts';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const row = (over: Partial<StockListRow> = {}): StockListRow => ({
	productId: 'p',
	variantId: 'v',
	sku: 'ST-FAB-0007',
	title: 'Mulmul <Fabric>',
	optionsLabel: '',
	imageUrl: null,
	categoryName: 'Fabric & more',
	soldBy: 'metre',
	onHand: 425,
	held: 0,
	inOrders: 25,
	freeToSell: 400,
	lowStockLevel: 50,
	status: 'in_stock',
	valueAtCostINR: 7650,
	lastReceivedOn: '2026-11-06',
	oldestPieceDays: 246,
	...over,
});

describe('all stock (i01)', () => {
	it('shows metres in every column, escapes names, and marks old stock', () => {
		const out = toStockRow(row(), t);
		expect(out.onHand).toBe('unit_metres:{"value":"42.5"}');
		expect(out.free).toContain('40.0');
		expect(out.item).toContain('Mulmul &lt;Fabric&gt;');
		expect(out.category).toBe('Fabric &amp; more');
		expect(out.oldest).toContain('text-danger');
	});

	it('leaves cost out when the API sent none (P8)', () => {
		expect(toStockRow(row({ valueAtCostINR: null }), t).value).toBe('—');
	});
});

describe('adjust stock (i04)', () => {
	const base = {
		action: 'remove' as const,
		units: 2,
		reason: 'damage' as const,
		holdReason: null,
		holdId: null,
		note: 'Water through the roof',
	};
	it('needs a quantity, a reason, a hold to release, and a note on every write-off', () => {
		expect(adjustProblem(base)).toBeNull();
		expect(adjustProblem({ ...base, units: 0 })).toBe('qty_required');
		expect(adjustProblem({ ...base, reason: null })).toBe('adjust_pick_reason');
		expect(adjustProblem({ ...base, note: ' ' })).toBe('adjust_note_required');
		expect(adjustProblem({ ...base, action: 'add', reason: 'other', note: '' })).toBe('adjust_note_required');
		expect(adjustProblem({ ...base, action: 'add', reason: 'manual_recount_correction', note: '' })).toBeNull();
		expect(adjustProblem({ ...base, action: 'release', reason: null })).toBe('adjust_pick_hold');
		expect(adjustProblem({ ...base, action: 'hold', reason: null, holdReason: null })).toBe(
			'adjust_pick_hold_reason',
		);
	});
});

describe('history, approvals and holds (i02, i05, i06)', () => {
	it('colours movements and links their documents', () => {
		expect(movementPill({ source: 'hold', quantityDelta: 0, heldDelta: 1 })).toBe('pending');
		expect(movementPill({ source: 'order_placed', quantityDelta: -1, heldDelta: 0 })).toBe('refund');
		expect(movementPill({ source: 'purchase_return', quantityDelta: -6, heldDelta: 0 })).toBe('cancelled');
		expect(movementPill({ source: 'purchase_invoice', quantityDelta: 6, heldDelta: 0 })).toBe('completed');
		expect(documentLink({ documentType: 'purchase_entry', documentId: 'e1' })).toEqual(['/purchase-entries', 'e1']);
		expect(documentLink({ documentType: null, documentId: null })).toBeNull();
	});

	it('never lets anyone approve their own request', () => {
		expect(isOwnRequest({ requestedBy: 'u1' }, 'u1')).toBe(true);
		expect(isOwnRequest({ requestedBy: 'u1' }, 'u2')).toBe(false);
		expect(isOwnRequest({ requestedBy: 'u1' }, null)).toBe(false);
	});

	it('shapes a hold for the adjust popup', () => {
		const hold = {
			id: 'h',
			variantId: 'v',
			productId: 'p',
			sku: 'S',
			title: 'T',
			optionsLabel: '',
			imageUrl: null,
			soldBy: 'piece',
			quantity: 4,
			reason: 'photoshoot',
		} as unknown as StockHold;
		expect(rowFromHold(hold)).toMatchObject({ variantId: 'v', held: 4 });
		expect(holdPill('photoshoot')).toBe('processing');
		expect(holdPill('waiting_for_supplier')).toBe('pending');
	});
});

describe('reports (i07–i10)', () => {
	it('orders only ticked lines with a supplier and a quantity, metres as tenths', async () => {
		const { orderLines } = await import('./reorder');
		const base = {
			productId: 'p',
			sku: 'S',
			title: 'T',
			optionsLabel: '',
			imageUrl: null,
			freeToSell: 1,
			soldLast60Days: 19,
			daysLeft: 3,
			lastSupplierName: 'X',
			lastCostINR: 1050,
			suggested: 14,
		};
		const lines = orderLines([
			{ row: { ...base, variantId: 'a', soldBy: 'piece', lastSupplierId: 's1' }, ticked: true, quantity: '14' },
			{ row: { ...base, variantId: 'b', soldBy: 'metre', lastSupplierId: 's1' }, ticked: true, quantity: '12.5' },
			{ row: { ...base, variantId: 'c', soldBy: 'piece', lastSupplierId: null }, ticked: true, quantity: '3' },
			{ row: { ...base, variantId: 'd', soldBy: 'piece', lastSupplierId: 's2' }, ticked: false, quantity: '3' },
			{ row: { ...base, variantId: 'e', soldBy: 'piece', lastSupplierId: 's2' }, ticked: true, quantity: '0' },
		]);
		expect(lines).toEqual([
			{ variantId: 'a', quantity: 14, supplierId: 's1' },
			{ variantId: 'b', quantity: 125, supplierId: 's1' },
		]);
	});

	it('turns a month into its first and last day', async () => {
		const { monthRange } = await import('./reports');
		expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
		expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
	});
});
