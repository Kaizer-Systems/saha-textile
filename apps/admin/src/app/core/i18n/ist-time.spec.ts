import { describe, expect, it } from 'vitest';

import { istInputToUtc, utcToIstInput } from './ist-time';

describe('India time in the admin', () => {
	it('reads a typed time as IST whatever the computer is set to', () => {
		expect(istInputToUtc('2027-09-27T23:59')).toBe('2027-09-27T18:29:00.000Z');
		expect(utcToIstInput('2027-09-27T18:29:00.000Z')).toBe('2027-09-27T23:59');
		expect(istInputToUtc('2027-02-30T10:00')).toBeNull();
		expect(istInputToUtc('')).toBeNull();
	});
});
