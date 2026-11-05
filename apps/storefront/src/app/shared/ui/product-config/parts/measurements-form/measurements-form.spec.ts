import { describe, expect, it } from 'vitest';

import { snapMeasurement } from './measurements-form';

describe('snapMeasurement', () => {
	it('snaps a centimetre entry onto the half-inch step', () => {
		expect(snapMeasurement('87.9', 'cm', 'in', 0.5, 24, 50)).toBe(34.5);
	});

	it('refuses a snapped value one step past the field maximum', () => {
		expect(snapMeasurement('87.9', 'cm', 'in', 0.5, 10, 24)).toBeNull();
	});
});
