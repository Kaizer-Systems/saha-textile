import { describe, expect, it } from 'vitest';

import { periodRange } from './edoc-list';

describe('e-invoice and e-way bill lists: the period presets (addendum 2, EI12–EI13)', () => {
	const now = new Date('2026-11-23T10:00:00Z');
	it('turns each preset into a date range', () => {
		expect(periodRange({ period: 'last_30_days' }, now)).toEqual({ from: '2026-10-25', to: '2026-11-23' });
		expect(periodRange({ period: 'last_month' }, now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
		expect(periodRange({ period: 'current_quarter' }, now)).toEqual({ from: '2026-10-01', to: '2026-11-23' });
		expect(periodRange({ period: 'last_quarter' }, now)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
		expect(periodRange({ period: 'custom', from: '2026-04-01', to: '2026-06-30' }, now)).toEqual({
			from: '2026-04-01',
			to: '2026-06-30',
		});
	});
});
