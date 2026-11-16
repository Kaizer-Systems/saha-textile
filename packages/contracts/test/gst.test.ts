import { describe, expect, it } from 'vitest';

import {
	Gstin,
	GstStateCode,
	HsnCode,
	Pan,
	gstStateName,
	gstinCheckCharacter,
	gstinProblem,
	panFromGstin,
} from '../src/gst';

describe('GSTIN', () => {
	it('accepts a real GSTIN and names the right check character for a wrong one', () => {
		const first14 = '19AAHFS7782K1Z';
		const good = first14 + gstinCheckCharacter(first14);
		expect(gstinProblem(good)).toBeNull();
		const wrong = first14 + (good.endsWith('0') ? '1' : '0');
		expect(gstinProblem(wrong)).toEqual({ problem: 'check_digit', expected: good[14] });
		// A published GSTIN (Maharashtra), checked against its own check character.
		expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
		expect(gstinProblem('99AAPFU0939F1ZV')?.problem).toBe('state');
		expect(gstinProblem('ABC')?.problem).toBe('shape');
		expect(panFromGstin(good)).toBe('AAHFS7782K');
	});

	it('reads lower case and stray spaces the way staff type them', () => {
		expect(gstinProblem(' 27aapfu0939f1zv ')).toBeNull();
		expect(Gstin.parse(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
	});

	it('tells the form which last character the GSTIN should end in', () => {
		const result = Gstin.safeParse('27AAPFU0939F1ZA');
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('gstin_check_digit:V');
	});
});

describe('States, PAN and HSN', () => {
	it('knows West Bengal and refuses an unknown State code', () => {
		expect(gstStateName('19')).toBe('West Bengal');
		expect(GstStateCode.safeParse('19').success).toBe(true);
		expect(GstStateCode.safeParse('00').success).toBe(false);
		expect(GstStateCode.safeParse('9').success).toBe(false);
	});

	it('upper-cases a PAN and refuses a wrong shape', () => {
		expect(Pan.parse('aapfu0939f')).toBe('AAPFU0939F');
		expect(Pan.safeParse('AAPFU0939').success).toBe(false);
	});

	it('takes HSN codes of 4, 6 or 8 digits only', () => {
		for (const code of ['5007', '500720', '50072010']) expect(HsnCode.safeParse(code).success).toBe(true);
		for (const code of ['500', '50072', '5007201', '500720101', '50O7'])
			expect(HsnCode.safeParse(code).success).toBe(false);
	});
});
