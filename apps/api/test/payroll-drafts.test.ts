import { afterEach, describe, expect, it, vi } from 'vitest';

import { draftDue, PAYROLL_DRAFT_SWEEP_MS, PayrollDraftsService } from '../src/payroll/payroll-drafts';

/** Brief 26 PE1: the month just ended drafted from 06:00 on the 1st, once its attendance is locked, and only once. */
const ist = (s: string) => new Date(`${s}+05:30`);

function build(options: { run?: unknown; lockedAt?: string | null; fails?: Error } = {}) {
	const prepare = vi.fn(async () => {
		if (options.fails) throw options.fails;
		return {};
	});
	const service = new PayrollDraftsService(
		{ prepare } as never,
		{ get: async () => options.run ?? null } as never,
		{
			get: async () =>
				options.lockedAt === undefined
					? { lockedAt: '2026-11-30T12:00:00.000Z' }
					: options.lockedAt === null
						? null
						: { lockedAt: options.lockedAt },
		} as never,
	);
	return { service, prepare };
}

describe('when a draft is due (PE-D1)', () => {
	it('is the month just ended, from 06:00 on the 1st in India, and any later day', () => {
		expect(draftDue(ist('2026-12-01T05:59:00'))).toEqual({ month: '2026-11', due: false });
		expect(draftDue(ist('2026-12-01T06:00:00'))).toEqual({ month: '2026-11', due: true });
		expect(draftDue(ist('2026-12-02T01:00:00'))).toEqual({ month: '2026-11', due: true });
		expect(draftDue(ist('2027-01-01T07:00:00')).month).toBe('2026-12');
	});
});

describe('the drafts job (PE1)', () => {
	it('prepares the month once its attendance is locked, and nothing before 06:00, over a run, or before the lock', async () => {
		const made = build();
		expect(await made.service.makeDue(ist('2026-12-01T06:15:00'))).toBe('2026-11');
		expect(made.prepare).toHaveBeenCalledWith('2026-11', ist('2026-12-01T06:15:00'));
		expect(await build().service.makeDue(ist('2026-12-01T05:00:00'))).toBeNull();
		expect(await build({ run: { status: 'draft' } }).service.makeDue(ist('2026-12-03T06:00:00'))).toBeNull();
		expect(await build({ lockedAt: null }).service.makeDue(ist('2026-12-03T06:00:00'))).toBeNull();
		expect(await build({ lockedAt: '' }).service.makeDue(ist('2026-12-03T06:00:00'))).toBeNull();
	});

	it('logs a draft it could not make and goes on', async () => {
		expect(
			await build({ fails: new Error('payroll_state_rules_missing') }).service.makeDue(
				ist('2026-12-01T06:15:00'),
			),
		).toBeNull();
	});
});

describe('the job’s timer', () => {
	const vitest = process.env.VITEST;
	afterEach(() => {
		process.env.VITEST = vitest;
		vi.useRealTimers();
	});

	it('does not start under the tests or a documentation build, and starts every 15 minutes otherwise', async () => {
		const { service } = build({ run: {} });
		service.onApplicationBootstrap();
		service.onApplicationShutdown();
		process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = '1';
		delete process.env.VITEST;
		service.onApplicationBootstrap();
		delete process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
		vi.useFakeTimers();
		const sweep = vi.spyOn(service, 'makeDue');
		service.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(PAYROLL_DRAFT_SWEEP_MS);
		expect(sweep).toHaveBeenCalledTimes(1);
		service.onApplicationShutdown();
	});
});
