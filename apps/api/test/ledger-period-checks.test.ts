import { describe, expect, it } from 'vitest';

import { LedgerService } from '../src/ledger/ledger.service';

/** What a month lock waits for (accounts brief T2): assets to depreciate (A1) and the month's payroll (P1). */

const asset = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	putToUseOn: '2026-04-10',
	disposedOn: null,
	depreciatedThrough: '2026-10',
	accumulatedPaise: 700_000,
	costINR: 120_000,
	residualINR: 0,
	...over,
});
const run = (month: string, status: string) => ({ month, status });

function build(options: { assets?: unknown[] | null; runs?: unknown[] | null } = {}) {
	const unused = {} as never;
	return new LedgerService(
		{ listDrafts: async () => [], dueReversals: async () => [] } as never,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		{ list: async () => ({ counts: {} }) } as never,
		{ pendingCount: async () => 0 } as never,
		unused,
		unused,
		unused,
		unused,
		null,
		null,
		options.assets === null || options.assets === undefined
			? null
			: ({ list: async () => options.assets } as never),
		options.runs === null || options.runs === undefined ? null : ({ list: async () => options.runs } as never),
	);
}
const check = async (service: LedgerService, month: string, key: string) =>
	(await service.periodChecks(month)).find((c) => c.key === key);

describe('a month lock’s checks for assets and payroll', () => {
	it('says depreciation and payroll aren’t in use when there is no asset or payroll store', async () => {
		const service = build();
		expect(await check(service, '2026-11', 'depreciation')).toEqual({
			key: 'depreciation',
			state: 'not_in_use',
			count: 0,
		});
		expect(await check(service, '2026-11', 'payroll')).toEqual({ key: 'payroll', state: 'not_in_use', count: 0 });
	});

	it('counts assets in use by the month’s end whose depreciation for the month isn’t posted', async () => {
		const service = build({
			assets: [
				asset('a_due'),
				// Disposed of during the month, never depreciated: still due for it.
				asset('a_sold', { disposedOn: '2026-11-20', depreciatedThrough: null }),
				asset('a_done', { depreciatedThrough: '2026-11' }),
				asset('a_later', { putToUseOn: '2026-12-05' }),
				asset('a_gone', { disposedOn: '2026-10-15' }),
				asset('a_spent', { accumulatedPaise: 12_000_000 }),
			],
		});
		expect(await check(service, '2026-11', 'depreciation')).toEqual({
			key: 'depreciation',
			state: 'attention',
			count: 2,
		});
		expect(await check(build({ assets: [] }), '2026-11', 'depreciation')).toEqual({
			key: 'depreciation',
			state: 'ok',
			count: 0,
		});
	});

	it('waits on payroll from its first month: a month with no run, or one not posted, needs doing', async () => {
		expect(await check(build({ runs: [] }), '2026-11', 'payroll')).toEqual({
			key: 'payroll',
			state: 'ok',
			count: 0,
		});
		const started = build({ runs: [run('2026-10', 'posted'), run('2026-12', 'draft'), run('2027-01', 'paid')] });
		expect((await check(started, '2026-09', 'payroll'))?.count).toBe(0);
		expect((await check(started, '2026-10', 'payroll'))?.count).toBe(0);
		expect(await check(started, '2026-11', 'payroll')).toEqual({ key: 'payroll', state: 'attention', count: 1 });
		expect((await check(started, '2026-12', 'payroll'))?.count).toBe(1);
		expect((await check(started, '2027-01', 'payroll'))?.count).toBe(0);
	});
});
