import { describe, expect, it } from 'vitest';

import {
	CODE128_PATTERNS,
	LABEL_SHEETS,
	code128,
	code128Bars,
	code128Encodable,
	labelSlots,
	labelsPerSheet,
	sheetsNeeded,
} from '../src/purchasing/labels';

describe('Code 128 (l01)', () => {
	it('has 107 patterns of 11 modules, the stop of 13', () => {
		expect(CODE128_PATTERNS).toHaveLength(107);
		CODE128_PATTERNS.forEach((pattern, value) => {
			const sum = [...pattern].reduce((total, width) => total + Number(width), 0);
			expect(sum, `value ${value}`).toBe(value === 106 ? 13 : 11);
		});
		expect(new Set(CODE128_PATTERNS).size).toBe(107);
	});

	it('encodes in set B with the weighted check value', () => {
		// A = value 33; check = (104 + 33 × 1) mod 103 = 34.
		expect(code128('A').values).toEqual([104, 33, 34, 106]);
		expect(code128('A').modules).toBe(46);
		// ST-1: S 51, T 52, - 13, 1 17 → (104 + 51 + 104 + 39 + 68) mod 103 = 57.
		expect(code128('ST-1').values).toEqual([104, 51, 52, 13, 17, 57, 106]);
	});

	it('draws bars only (every other run) and refuses what set B cannot hold', () => {
		const { bars, modules } = code128Bars('A');
		expect(bars).toHaveLength(3 + 3 + 3 + 4);
		expect(bars[0]).toEqual({ x: 0, width: 2 });
		expect(Math.max(...bars.map((bar) => bar.x + bar.width))).toBe(modules);
		expect(code128Encodable('শাড়ি')).toBe(false);
		expect(() => code128('')).toThrow();
	});
});

describe('A4 label sheets (P10)', () => {
	it('centres each stock size on A4', () => {
		expect(LABEL_SHEETS.a4_65).toMatchObject({ columns: 5, rows: 13, leftMm: 4.75, topMm: 10.7 });
		expect(LABEL_SHEETS.a4_40).toMatchObject({ leftMm: 9.7, topMm: 21.5 });
		expect(LABEL_SHEETS.a4_21.topMm).toBe(15.15);
		expect(labelsPerSheet('a4_24')).toBe(24);
	});

	it('starts after used labels and runs onto the next sheet', () => {
		const slots = labelSlots('a4_65', 4, 63);
		expect(slots[0]).toEqual({ sheet: 0, position: 4, xMm: 126.55, yMm: 10.7 });
		expect(slots[61]).toMatchObject({ sheet: 0, position: 65 });
		expect(slots[62]).toMatchObject({ sheet: 1, position: 1, xMm: 4.75, yMm: 10.7 });
		expect(sheetsNeeded('a4_65', 4, 22)).toBe(1);
		expect(sheetsNeeded('a4_65', 4, 63)).toBe(2);
		expect(sheetsNeeded('a4_21', 99, 1)).toBe(1);
		expect(labelSlots('a4_21', 99, 1)[0]?.position).toBe(21);
	});
});
