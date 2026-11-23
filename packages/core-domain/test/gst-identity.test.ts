import {
	BUSINESS_KINDS,
	GST_STATES as CONTRACT_STATES,
	gstStateName as contractName,
	gstinProblem as contractProblem,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { BUSINESS_KIND_LIST } from '../src/company/company-rules';
import { GST_STATES, gstStateName, gstinProblem } from '../src/company/gst-identity';

describe('core’s browser copy of the GSTIN helpers stays equal to contracts', () => {
	it('has the same State list and kinds of business', () => {
		expect(GST_STATES).toEqual(CONTRACT_STATES);
		expect([...BUSINESS_KIND_LIST]).toEqual([...BUSINESS_KINDS]);
	});
	it('answers the same for GSTINs and State codes', () => {
		for (const value of ['19DBYPS6736R1ZZ', '19DBYPS6736R1ZA', '99ABCDE1234F1Z5', 'nonsense', '27AAKFR1234M1Z2'])
			expect(gstinProblem(value)).toEqual(contractProblem(value));
		for (const code of ['19', '16', '97', '00']) expect(gstStateName(code)).toBe(contractName(code));
	});
});
