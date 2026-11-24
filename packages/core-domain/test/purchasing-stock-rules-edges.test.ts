import { describe, expect, it } from 'vitest';

import {
	adjustmentRefusal,
	ageingBandOf,
	fifoDraw,
	layersValue,
	oldestPieceDays,
	onHandValue,
	reorderSuggestion,
	soldByChangeProblem,
	stepperStep,
	type CostLayerFact,
} from '../src/purchasing/stock-rules';

const facts = { onHand: 10, held: 2, reserved: 3 };
const refusal = (over: Partial<Parameters<typeof adjustmentRefusal>[0]>) =>
	adjustmentRefusal({ action: 'add', quantity: 1, facts, soldBy: 'piece', hold: null, tracked: true, ...over });
const layer = (id: string, receivedAt: string, quantityRemaining: number, unitCostINR = 100): CostLayerFact => ({
	id,
	receivedAt,
	quantityRemaining,
	unitCostINR,
});

describe('stock adjustments: what is refused', () => {
	it('refuses untracked items and quantities of nothing', () => {
		expect(refusal({ tracked: false })).toBe('This item does not keep stock.');
		expect(refusal({ quantity: 0 })).toBe('The quantity must be more than 0.');
	});

	it('releases only from an open hold, no more than it holds', () => {
		expect(refusal({ action: 'release' })).toBe('That hold is no longer open.');
		expect(refusal({ action: 'release', hold: { quantity: 2, status: 'closed' } })).toBe(
			'That hold is no longer open.',
		);
		expect(refusal({ action: 'release', quantity: 3, hold: { quantity: 2, status: 'open' } })).toBe(
			'Only 2 is held there.',
		);
		expect(refusal({ action: 'release', quantity: 2, hold: { quantity: 2, status: 'open' } })).toBeNull();
	});

	it('holds only what is free', () => {
		expect(refusal({ action: 'hold', quantity: 9 })).toBe('Only 5 is free to hold.');
		expect(refusal({ action: 'hold', quantity: 5 })).toBeNull();
	});

	it('removes from an open hold within it, or from free stock', () => {
		expect(refusal({ action: 'remove', hold: { quantity: 2, status: 'void' } })).toBe(
			'That hold is no longer open.',
		);
		expect(refusal({ action: 'remove', quantity: 3, hold: { quantity: 2, status: 'open' } })).toBe(
			'Only 2 is held there.',
		);
		expect(refusal({ action: 'remove', quantity: 2, hold: { quantity: 2, status: 'open' } })).toBeNull();
		expect(refusal({ action: 'remove', quantity: 4 })).toBeNull();
		expect(refusal({ action: 'remove', quantity: 9 })).toMatch(/paid orders need 3/);
		expect(refusal({ action: 'remove', quantity: 9, facts: { onHand: 10, held: 2, reserved: 0 } })).toMatch(
			/release held pieces first/,
		);
	});
});

describe('stock value and age', () => {
	it('stops drawing once enough is taken, and values what is left newest first', () => {
		const layers = [
			layer('old', '2026-01-01', 5, 100),
			layer('new', '2026-06-01', 5, 120),
			layer('empty', '2026-02-01', 0),
		];
		expect(fifoDraw(layers, 3, 'piece')).toMatchObject({ valueINR: 300, uncosted: 0, parts: [{ layerId: 'old' }] });
		expect(fifoDraw(layers, 25, 'metre').breakdown).toBe('0.5 m at ₹1,000 / m + 0.5 m at ₹1,200 / m');
		expect(onHandValue(layers, 3)).toEqual({ valueINR: 360, uncosted: 0 });
		expect(layersValue(layers)).toBe(1100);
	});

	it('counts the oldest open layer’s age, whatever order the layers come in', () => {
		const layers = [
			layer('b', '2026-06-01', 1),
			layer('a', '2026-01-01T10:00:00Z', 1),
			layer('c', '2026-08-01', 1),
		];
		expect(oldestPieceDays(layers, '2026-01-11')).toBe(10);
		expect(oldestPieceDays([layer('x', '2026-01-01', 0)], '2026-01-11')).toBeNull();
	});

	it('places every age in its band', () => {
		expect([0, 90, 91, 365, 366, 2000].map(ageingBandOf)).toEqual([0, 0, 1, 2, 3, 3]);
	});
});

describe('reorders, steppers and sold-by changes', () => {
	it('suggests half-metre steps for fabric, at least a metre', () => {
		expect(reorderSuggestion({ free: 0, lowLevel: null, soldLast60: 60, soldBy: 'metre' })).toMatchObject({
			listed: true,
			suggested: 45,
		});
		expect(reorderSuggestion({ free: 500, lowLevel: null, soldLast60: 6, soldBy: 'metre' }).suggested).toBe(10);
	});

	it('steps metres by half a metre and pieces by one', () => {
		expect(stepperStep('metre')).toBe(5);
		expect(stepperStep('piece')).toBe(1);
	});

	it('keeps sold-by while stock, history or orders count in it, and lets an unused product change', () => {
		const change = (over: Partial<Parameters<typeof soldByChangeProblem>[0]>) =>
			soldByChangeProblem({
				from: 'piece',
				to: 'metre',
				hasStock: false,
				hasMovements: false,
				hasOrders: false,
				...over,
			});
		expect(change({ to: 'piece' })).toBeNull();
		expect(change({})).toBeNull();
		expect(change({ hasStock: true })?.detail).toBe('Sold by stays piece: it has stock, all counted in that unit.');
		expect(change({ hasMovements: true })?.detail).toMatch(/it has stock history/);
		expect(change({ from: 'metre', to: 'piece', hasOrders: true })?.detail).toBe(
			'Sold by stays metre: it has orders, all counted in that unit.',
		);
	});
});
