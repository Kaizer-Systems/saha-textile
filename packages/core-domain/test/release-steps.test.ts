import { describe, expect, it, vi } from 'vitest';

import {
	ReleaseStepFailedError,
	assertMigrationOrder,
	pendingMigrations,
	runReleaseSteps,
	type ReleaseStep,
	type ReleaseStepEvent,
} from '../src/release/release-steps';

const step = (key: string, over: Partial<ReleaseStep> = {}): ReleaseStep => ({
	key,
	label: `Step ${key}`,
	cadence: 'every-release',
	needed: async () => ({ needed: true, reason: 'work to do' }),
	run: async () => 'did it',
	check: async () => ({ ok: true, detail: 'proved' }),
	...over,
});

const collect = () => {
	const events: ReleaseStepEvent[] = [];
	return { events, report: (event: ReleaseStepEvent) => events.push(event) };
};

describe('runReleaseSteps', () => {
	it('runs needed steps, checks every step, and reports each phase in order', async () => {
		const { events, report } = collect();
		let now = 1_000;
		const quiet = step('b', {
			cadence: 'once',
			needed: async () => ({ needed: false, reason: 'nothing pending' }),
			run: vi.fn(),
		});
		const result = await runReleaseSteps([step('a'), quiet], report, () => (now += 5));
		expect(result).toEqual({ ran: ['a'], skipped: ['b'] });
		expect(quiet.run).not.toHaveBeenCalled();
		expect(events.map((event) => `${event.step}:${event.phase}`)).toEqual([
			'a:start',
			'a:run',
			'a:check',
			'a:done',
			'b:start',
			'b:skip',
		]);
		expect(events[3]).toMatchObject({ detail: 'proved', ms: expect.any(Number) });
		expect(events[5]).toMatchObject({ detail: 'nothing pending; proved', cadence: 'once' });
		expect(events[0]?.ms).toBeUndefined();
		expect(events[0]?.at).toMatch(/^1970-01-01T00:00:01/);
	});

	it('stops at a failed check, before any later step', async () => {
		const { events, report } = collect();
		const later = step('c', { needed: vi.fn() });
		const failing = step('roles', {
			check: async () => ({ ok: false, detail: 'administrator lacks mailbox.use' }),
		});
		await expect(runReleaseSteps([failing, later], report)).rejects.toThrow(
			'Release step "roles" failed: administrator lacks mailbox.use',
		);
		expect(later.needed).not.toHaveBeenCalled();
		expect(events.at(-1)).toMatchObject({
			step: 'roles',
			phase: 'fail',
			detail: 'administrator lacks mailbox.use',
		});
	});

	it('turns a thrown error of any kind into a step failure', async () => {
		const { report } = collect();
		const error = await runReleaseSteps(
			[step('x', { run: async () => Promise.reject('plain text') })],
			report,
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ReleaseStepFailedError);
		expect((error as ReleaseStepFailedError).step).toBe('x');
		await expect(
			runReleaseSteps(
				[
					step('y', {
						needed: async () => {
							throw new Error('down');
						},
					}),
				],
				report,
			),
		).rejects.toThrow('down');
	});
});

describe('data migration order', () => {
	const m = (id: string) => ({ id });

	it('accepts ordered, unique, well-named ids and lists the pending ones', () => {
		expect(() => assertMigrationOrder([m('0001-a'), m('0002-b')])).not.toThrow();
		expect(pendingMigrations([m('0001-a'), m('0002-b'), m('0003-c')], new Set(['0001-a', '0003-c']))).toEqual([
			m('0002-b'),
		]);
		expect(pendingMigrations([], new Set())).toEqual([]);
	});

	it('refuses duplicates, wrong order and bad names', () => {
		expect(() => assertMigrationOrder([m('0001-a'), m('0001-a')])).toThrow('share an id');
		expect(() => assertMigrationOrder([m('0002-b'), m('0001-a')])).toThrow('id order');
		expect(() => assertMigrationOrder([m('1-a')])).toThrow('must look like 0001-short-name');
	});
});
