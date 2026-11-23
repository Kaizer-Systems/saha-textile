import { describe, expect, it } from 'vitest';

import { gstStateName, gstinCheckCharacter, gstinProblem } from '../src/company/gst-identity';

describe('GST registration identity', () => {
	it('resolves the recorded state and rejects an unknown code', () => {
		expect(gstStateName('19')).toBe('West Bengal');
		expect(gstStateName('00')).toBeNull();
	});

	it('distinguishes invalid syntax, an unknown state, and a wrong check character', () => {
		expect(gstinProblem('nonsense')).toEqual({ problem: 'shape' });
		expect(gstinProblem('99ABCDE1234F1Z5')).toEqual({ problem: 'state' });
		expect(gstinProblem('19DBYPS6736R1ZA')).toEqual({ problem: 'check_digit', expected: 'Z' });
		expect(gstinProblem(' 19dbyps6736r1zz ')).toBeNull();
	});

	it('reports no check character for an invalid alphabet character', () => {
		expect(gstinCheckCharacter('19!BYPS6736R1Z')).toBe('');
	});
});
