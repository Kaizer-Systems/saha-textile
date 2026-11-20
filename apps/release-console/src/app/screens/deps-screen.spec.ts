import { describe, expect, it } from 'vitest';

import { bySeverity } from './deps-screen';

describe('dependencies and security', () => {
	it('counts open alerts by severity, most severe first', () => {
		expect(bySeverity([{ severity: 'low' }, { severity: 'HIGH' }, { severity: 'high' }, { severity: '' }])).toEqual(
			[
				{ severity: 'high', count: 2 },
				{ severity: 'low', count: 1 },
				{ severity: 'unrated', count: 1 },
			],
		);
		expect(bySeverity([])).toEqual([]);
	});
});
