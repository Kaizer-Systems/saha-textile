import { describe, expect, it } from 'vitest';

import { monthLabel, periodLabel, splitReturns } from './payroll-format';

describe('payroll’s months and returns in words', () => {
	it('names a month with its year, in the reader’s language', () => {
		expect(monthLabel('2026-11', 'en')).toBe('November 2026');
		expect(monthLabel('2026-11', 'bn')).toMatch(/2026$/);
		expect(monthLabel('2026-11', 'bn')).not.toContain('November');
	});

	it('gives a monthly return its month and a quarterly one its three months', () => {
		expect(periodLabel({ period: '2026-11', periodTo: '2026-11' }, 'en')).toBe('November 2026');
		expect(periodLabel({ period: '2026-10', periodTo: '2026-12' }, 'en')).toBe('October 2026 – December 2026');
	});

	it('splits returns into those still due and those filed, keeping their order', () => {
		const rows = [
			{ kind: 'pf', status: 'ready' },
			{ kind: 'esi', status: 'filed' },
			{ kind: 'pt', status: 'later' },
		] as never[];
		const { due, filed } = splitReturns(rows);
		expect(due.map((r: { kind: string }) => r.kind)).toEqual(['pf', 'pt']);
		expect(filed.map((r: { kind: string }) => r.kind)).toEqual(['esi']);
		expect(splitReturns([])).toEqual({ due: [], filed: [] });
	});
});
