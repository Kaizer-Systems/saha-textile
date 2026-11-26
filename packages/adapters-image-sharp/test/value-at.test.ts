import { describe, expect, it } from 'vitest';

import { valueAt } from '../src/value-at';

describe('valueAt', () => {
	it('reads a number inside the array, whatever kind of array it is', () => {
		expect(valueAt([4, 5, 6], 2)).toBe(6);
		expect(valueAt(Uint8Array.of(0, 255), 1)).toBe(255);
	});

	it('fails loudly outside the array instead of counting 0', () => {
		expect(() => valueAt(Uint8Array.of(1, 2), 2)).toThrow(new RangeError('index 2 is outside 0–1'));
		expect(() => valueAt([], 0)).toThrow(RangeError);
	});
});
