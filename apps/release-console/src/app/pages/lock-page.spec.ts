import { describe, expect, it } from 'vitest';

import { fillDigits } from './lock-page';

const empty = ['', '', '', '', '', ''];

describe('PIN boxes', () => {
	it('puts a typed digit in its box and moves to the next', () => {
		expect(fillDigits(empty, 0, '4')).toEqual({ digits: ['4', '', '', '', '', ''], focus: 1 });
	});

	it('spreads a pasted PIN over the boxes and ignores anything but digits', () => {
		expect(fillDigits(empty, 0, '48 29-13')).toEqual({ digits: ['4', '8', '2', '9', '1', '3'], focus: 5 });
		expect(fillDigits(empty, 4, '987')).toEqual({ digits: ['', '', '', '', '9', '8'], focus: 5 });
	});

	it('clears a box when its digit is deleted and stays there', () => {
		expect(fillDigits(['1', '2', '', '', '', ''], 1, '')).toEqual({ digits: ['1', '', '', '', '', ''], focus: 1 });
		expect(fillDigits(empty, 2, 'x')).toEqual({ digits: empty, focus: 2 });
	});
});
