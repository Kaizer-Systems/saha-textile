import { describe, expect, it } from 'vitest';

import { AssetCategories, RecurringEntry, RecurringEntryEdit, RecurringEntryWrite } from '../src/assets';

/** Rent and recurring entries (accounts brief R5), and the asset category presets (R2). */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const line = { ledgerId: 'led_rent', debitPaise: 4_500_000 };
const write = {
	what: ' Shop rent, Gariahat ',
	lines: [line, { ledgerId: 'led_bank', creditPaise: 4_500_000 }],
	startOn: '2026-12-01',
};

describe('a recurring entry', () => {
	it('makes a journal on the 1st of each month from its start, with no party, end or reversal, switched on', () => {
		expect(RecurringEntryWrite.parse(write)).toEqual({
			what: 'Shop rent, Gariahat',
			party: '',
			kind: 'journal',
			every: 'monthDay',
			day: 1,
			lines: [
				{ ledgerId: 'led_rent', locationId: '', debitPaise: 4_500_000, creditPaise: 0, narration: '' },
				{ ledgerId: 'led_bank', locationId: '', debitPaise: 0, creditPaise: 4_500_000, narration: '' },
			],
			reverseNextDay: false,
			startOn: '2026-12-01',
			endOn: null,
			active: true,
		});
	});

	it('takes a payment to a party on a day up to the 28th, or at month end reversed the next day, until an end', () => {
		expect(
			RecurringEntryWrite.parse({
				...write,
				party: ' Sen Properties ',
				kind: 'payment',
				day: 28,
				endOn: '2027-11-30',
				active: false,
			}),
		).toMatchObject({ party: 'Sen Properties', kind: 'payment', day: 28, endOn: '2027-11-30', active: false });
		expect(RecurringEntryWrite.parse({ ...write, every: 'monthEnd', reverseNextDay: true })).toMatchObject({
			every: 'monthEnd',
			reverseNextDay: true,
		});
	});

	it('takes what it is for in 2 to 120 letters, a party up to 120, and 1 to 20 lines', () => {
		refused(RecurringEntryWrite.safeParse({ ...write, what: ' R ' }).success);
		accepted(RecurringEntryWrite.safeParse({ ...write, what: 'x'.repeat(120) }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, what: 'x'.repeat(121) }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, party: 'x'.repeat(121) }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, lines: [] }).success);
		accepted(RecurringEntryWrite.safeParse({ ...write, lines: Array.from({ length: 20 }, () => line) }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, lines: Array.from({ length: 21 }, () => line) }).success);
	});

	it('keeps the day between the 1st and the 28th, so every month has it', () => {
		refused(RecurringEntryWrite.safeParse({ ...write, day: 0 }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, day: 29 }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, day: 1.5 }).success);
	});

	it('refuses another kind or schedule, and days in the wrong shape', () => {
		refused(RecurringEntryWrite.safeParse({ ...write, kind: 'receipt' }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, every: 'weekly' }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, startOn: '01-12-2026' }).success);
		refused(RecurringEntryWrite.safeParse({ ...write, endOn: '2027-11' }).success);
	});

	it('keeps the next day a draft is made, the last one made, who added it and its version', () => {
		const saved = {
			...RecurringEntryWrite.parse(write),
			id: 'rec_1',
			nextOn: '2026-12-01',
			createdBy: 'adm_1',
			createdAt: '2026-11-24T10:00:00.000Z',
			updatedAt: '2026-11-24T10:00:00.000Z',
			version: 0,
		};
		expect(RecurringEntry.parse(saved)).toEqual({ ...saved, lastMadeOn: null, lastDraftId: null });
		expect(
			RecurringEntry.parse({ ...saved, nextOn: '2027-01-01', lastMadeOn: '2026-12-01', lastDraftId: 'vd_9' }),
		).toMatchObject({ lastMadeOn: '2026-12-01', lastDraftId: 'vd_9' });
		refused(RecurringEntry.safeParse({ ...saved, nextOn: undefined }).success);
		refused(RecurringEntry.safeParse({ ...saved, version: -1 }).success);
	});

	it('is edited whole at its version', () => {
		expect(RecurringEntryEdit.parse({ ...write, version: 4 })).toMatchObject({
			what: 'Shop rent, Gariahat',
			version: 4,
		});
		refused(RecurringEntryEdit.safeParse(write).success);
		refused(RecurringEntryEdit.safeParse({ ...write, version: 0.5 }).success);
	});
});

describe('the asset category presets', () => {
	it('gives each category’s life and tax rate, and the residual suggested', () => {
		const presets = {
			categories: [
				{ key: 'furniture', lifeYears: 10, taxRatePct: 10 },
				{ key: 'computers', lifeYears: 3, taxRatePct: 40 },
			],
			residualPercent: 5,
		};
		expect(AssetCategories.parse(presets)).toEqual(presets);
		refused(
			AssetCategories.safeParse({
				categories: [{ key: 'furniture', lifeYears: '10', taxRatePct: 10 }],
				residualPercent: 5,
			}).success,
		);
		refused(AssetCategories.safeParse({ categories: [] }).success);
	});
});
