import { describe, expect, it } from 'vitest';

import { lengthProblem, lengthText, metreTotal, readLength, stepLength, type MetreRule } from './metre-length';

const rule: MetreRule = { shortestCutTenths: 10, stepTenths: 5, quickLengths: [], widthInches: 44 };

describe('metre lengths in the shop', () => {
	it('shows tenths as metres with English digits', () => {
		expect(lengthText(25, 'm')).toBe('2.5 m');
		expect(lengthText(10, 'মি.')).toBe('1.0 মি.');
	});

	it('reads typed lengths, snapping to 0.1 m and saying so (M03)', () => {
		expect(readLength('2.5')).toEqual({ tenths: 25, snapped: false });
		expect(readLength('2.55')).toEqual({ tenths: 26, snapped: true });
		expect(readLength('2,5 m')).toEqual({ tenths: 25, snapped: false });
		expect(readLength('3 মি.')).toEqual({ tenths: 30, snapped: false });
		expect(readLength('0')).toBeNull();
		expect(readLength('abc')).toBeNull();
		expect(readLength('-1')).toBeNull();
		expect(readLength('0.04')).toBeNull();
	});

	it('says when a length is under the shortest cut or over what is left (M04)', () => {
		expect(lengthProblem(5, rule, 45)).toBe('below_cut');
		expect(lengthProblem(50, rule, 45)).toBe('over_stock');
		expect(lengthProblem(45, rule, 45)).toBeNull();
		expect(lengthProblem(500, rule, null)).toBeNull();
	});

	it('steps by 0.5 m between the shortest cut and what is free to sell (M1)', () => {
		expect(stepLength(10, 1, rule, 45)).toBe(15);
		expect(stepLength(10, -1, rule, 45)).toBe(10);
		expect(stepLength(43, 1, rule, 45)).toBe(45);
		expect(stepLength(12, -1, rule, 45)).toBe(10);
		expect(stepLength(10, 1, rule, null)).toBe(15);
	});

	it('works the line total out to the paisa', () => {
		expect(metreTotal(180, 25)).toBe(450);
		expect(metreTotal(175.5, 23)).toBe(403.65);
	});
});
