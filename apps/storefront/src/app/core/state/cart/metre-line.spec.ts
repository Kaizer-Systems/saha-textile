import { describe, expect, it } from 'vitest';

import { minusDeletes, stepLine, typedLineLength } from './metre-line';

const fabric = (quantity: number, available: number | null = 45) => ({
	sold_by: 'metre' as const,
	shortest_cut_tenths: 10,
	quantity,
	available,
});
const piece = (quantity: number) => ({ sold_by: 'piece' as const, shortest_cut_tenths: null, quantity, available: 3 });

describe('metre lines in the cart (M08–M10)', () => {
	it('steps pieces by one and removes at one, as before', () => {
		expect(stepLine(piece(2), -1)).toEqual({ kind: 'change', delta: -1 });
		expect(stepLine(piece(1), -1)).toEqual({ kind: 'delete' });
		expect(stepLine(piece(1), 1)).toEqual({ kind: 'change', delta: 1 });
		expect(minusDeletes(piece(1))).toBe(true);
	});

	it('steps metres by 0.5 m, stops at what is left, and removes at the shortest cut', () => {
		expect(stepLine(fabric(25), 1)).toEqual({ kind: 'change', delta: 5 });
		expect(stepLine(fabric(25), -1)).toEqual({ kind: 'change', delta: -5 });
		expect(stepLine(fabric(12), -1)).toEqual({ kind: 'change', delta: -2 });
		expect(stepLine(fabric(10), -1)).toEqual({ kind: 'delete' });
		expect(stepLine(fabric(43), 1)).toEqual({ kind: 'change', delta: 2 });
		expect(stepLine(fabric(45), 1)).toEqual({ kind: 'none' });
		expect(minusDeletes(fabric(15))).toBe(false);
	});

	it('takes a typed length, snapped and kept within the cut and what is left', () => {
		expect(typedLineLength(fabric(25), '3.25')).toBe(33);
		expect(typedLineLength(fabric(25), '0.5')).toBe(10);
		expect(typedLineLength(fabric(25), '60')).toBe(45);
		expect(typedLineLength(fabric(25), '2.5 m')).toBeNull();
		expect(typedLineLength(fabric(25), 'x')).toBeNull();
	});
});
