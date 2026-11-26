import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { RecurringEntry, RecurringEntryWrite } from '@saha-textile/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RECURRING_SWEEP_MS, RecurringService } from '../src/assets/recurring.service';

/** Rent and recurring entries (accounts brief R5): a voucher draft made on each one's day, once. */

const at = '2026-11-27T20:00:00.000Z';
/** 01:30 on 28 November in India. */
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });

const write = (over: Partial<RecurringEntryWrite> = {}): RecurringEntryWrite => ({
	what: 'Shop rent',
	party: 'Bose Properties',
	kind: 'journal',
	every: 'monthDay',
	day: 5,
	lines: [{ ledgerId: 'led_rent', locationId: 'loc_bar', debitPaise: 0, creditPaise: 0, narration: '' }],
	reverseNextDay: false,
	startOn: '2026-11-10',
	endOn: null,
	active: true,
	...over,
});
const entry = (id: string, over: Partial<RecurringEntry> = {}): RecurringEntry => ({
	...write(),
	id,
	nextOn: '2026-11-05',
	lastMadeOn: null,
	lastDraftId: null,
	createdBy: 'adm_acc',
	createdAt: at,
	updatedAt: at,
	version: 2,
	...over,
});

function build(options: { entries?: RecurringEntry[]; saveFails?: unknown } = {}) {
	const store = new Map((options.entries ?? []).map((e) => [e.id, e]));
	const repo = {
		list: async () => [...store.values()],
		get: async (id: string) => store.get(id) ?? null,
		insert: vi.fn(async (next: RecurringEntry) => void store.set(next.id, next)),
		save: vi.fn(async (next: RecurringEntry, expectedVersion: number) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			if (store.get(next.id)?.version !== expectedVersion) throw new Error('recurring_entry_changed');
			const saved = { ...next, version: expectedVersion + 1 };
			store.set(next.id, saved);
			return saved;
		}),
		remove: vi.fn(async (id: string) => store.delete(id)),
	};
	let drafts = 0;
	const ledger = {
		saveDraft: vi.fn(async (_id: null, draft: { narration: string }, _principal: undefined) => {
			if (draft.narration.startsWith('Broken')) throw new Error('books locked');
			if (draft.narration.startsWith('Odd')) throw 'not an error';
			return { id: `vd_${++drafts}` };
		}),
	};
	return { service: new RecurringService(repo as never, ledger as never), repo, ledger, store };
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('the hourly job', () => {
	it('runs every hour once the app starts, and stops when it shuts down', async () => {
		vi.useFakeTimers();
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		const { service } = build();
		const sweep = vi.spyOn(service, 'makeDue');
		service.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(RECURRING_SWEEP_MS);
		expect(sweep).toHaveBeenCalledTimes(1);
		service.onApplicationShutdown();
		await vi.advanceTimersByTimeAsync(RECURRING_SWEEP_MS);
		expect(sweep).toHaveBeenCalledTimes(1);
	});

	it('doesn’t run under the tests or the documentation build, and shuts down with nothing to stop', async () => {
		vi.useFakeTimers();
		const { service } = build();
		const sweep = vi.spyOn(service, 'makeDue');
		service.onApplicationBootstrap();
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
		service.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(RECURRING_SWEEP_MS * 2);
		expect(sweep).not.toHaveBeenCalled();
		service.onApplicationShutdown();
	});
});

describe('keeping recurring entries (R5)', () => {
	it('lists them, and adds one due on its first day on or after its start, made by whoever added it', async () => {
		const { service, repo } = build({ entries: [entry('rec_1')] });
		expect((await service.list()).map((e) => e.id)).toEqual(['rec_1']);
		const added = await service.create(
			write({ endOn: '2027-03-31' }),
			{ userId: 'adm_acc', permissions: [] } as never,
			now,
		);
		expect(repo.insert).toHaveBeenCalledWith(added);
		expect(added).toMatchObject({
			what: 'Shop rent',
			nextOn: '2026-12-05',
			lastMadeOn: null,
			lastDraftId: null,
			createdBy: 'adm_acc',
			createdAt: at,
			updatedAt: at,
			version: 0,
		});
		expect(added.id).toMatch(/^rec_/);
		expect((await service.create(write(), undefined)).createdBy).toBeNull();
	});

	it('refuses one that ends before it starts', async () => {
		const refused = build().service.create(write({ endOn: '2026-11-09' }), undefined);
		await expect(refused).rejects.toBeInstanceOf(BadRequestException);
		await expect(refused).rejects.toMatchObject(refusal('recurring_ends_before_start'));
	});

	it('picks the next day again from today or a later start, over the version read', async () => {
		const { service } = build({ entries: [entry('rec_1')] });
		const fromToday = await service.update(
			'rec_1',
			{ ...write({ every: 'monthEnd', startOn: '2026-01-01' }), version: 2 },
			now,
		);
		expect(fromToday).toMatchObject({ every: 'monthEnd', nextOn: '2026-11-30', updatedAt: at, version: 3 });
		const fromStart = await service.update('rec_1', { ...write({ startOn: '2027-01-15' }), version: 3 });
		expect(fromStart).toMatchObject({ nextOn: '2027-02-05', version: 4 });
		const stale = service.update('rec_1', { ...write(), version: 2 }, now);
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('recurring_entry_changed'));
		await expect(
			service.update('rec_1', { ...write({ endOn: '2026-01-01' }), version: 4 }, now),
		).rejects.toMatchObject(refusal('recurring_ends_before_start'));
		const missing = service.update('rec_9', { ...write(), version: 0 }, now);
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('recurring_entry_not_found'));
	});

	it('passes on any other failure to save a change', async () => {
		const diskFull = new Error('disk full');
		await expect(
			build({ entries: [entry('rec_1')], saveFails: diskFull }).service.update(
				'rec_1',
				{ ...write(), version: 2 },
				now,
			),
		).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(
			build({ entries: [entry('rec_1')], saveFails: odd }).service.update(
				'rec_1',
				{ ...write(), version: 2 },
				now,
			),
		).rejects.toBe(odd);
	});

	it('removes one, and refuses one that isn’t there', async () => {
		const { service, repo } = build({ entries: [entry('rec_1')] });
		await service.remove('rec_1');
		expect(repo.remove).toHaveBeenCalledWith('rec_1');
		await expect(service.remove('rec_1')).rejects.toMatchObject(refusal('recurring_entry_not_found'));
	});
});

describe('making the drafts that have come due (R5)', () => {
	it('makes a draft for each active entry due by today in India and within its end, moving each to its next day', async () => {
		const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		const { service, ledger, store } = build({
			entries: [
				entry('e_due'),
				// Month-end accrual undone the next morning, with no party; due and within its end.
				entry('e_reverse', {
					what: 'Electricity accrued',
					party: '',
					every: 'monthEnd',
					nextOn: '2026-10-31',
					endOn: '2026-12-31',
					reverseNextDay: true,
				}),
				entry('e_paused', { active: false }),
				entry('e_later', { nextOn: '2026-12-05' }),
				entry('e_ended', { endOn: '2026-10-31' }),
				entry('e_broken', { what: 'Broken entry' }),
				entry('e_odd', { what: 'Odd entry' }),
			],
		});
		expect(await service.makeDue(now)).toBe(2);
		expect(ledger.saveDraft.mock.calls.slice(0, 2)).toEqual([
			[
				null,
				{
					kind: 'journal',
					date: '2026-11-05',
					narration: 'Shop rent · Bose Properties',
					lines: write().lines,
					reverseOn: null,
					attachments: [],
					expectedUpdatedAt: null,
				},
				undefined,
			],
			[
				null,
				expect.objectContaining({
					date: '2026-10-31',
					narration: 'Electricity accrued',
					reverseOn: '2026-11-01',
				}),
				undefined,
			],
		]);
		expect(store.get('e_due')).toMatchObject({
			lastMadeOn: '2026-11-05',
			lastDraftId: 'vd_1',
			nextOn: '2026-12-05',
			updatedAt: at,
			version: 3,
		});
		expect(store.get('e_reverse')).toMatchObject({
			lastMadeOn: '2026-10-31',
			lastDraftId: 'vd_2',
			nextOn: '2026-11-30',
		});
		expect(store.get('e_paused')?.version).toBe(2);
		expect(warn.mock.calls.map(([message]) => message)).toEqual([
			'Recurring entry e_broken could not make its draft: books locked',
			'Recurring entry e_odd could not make its draft: unknown',
		]);
		expect(await build().service.makeDue()).toBe(0);
	});
});
