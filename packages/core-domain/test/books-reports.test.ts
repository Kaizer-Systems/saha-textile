import { describe, expect, it } from 'vitest';

import {
	BOOKS_AUDIT_PREFIXES,
	type AuditLike,
	ageingBuckets,
	auditCategories,
	isBooksAudit,
} from '../src/reports/books-reports';

/** Outstanding with ageing (accounts brief U5) and the audit report's chips (U8). */

describe('outstanding by age', () => {
	it('sorts what is owed by days past its due day: not due, 1–30, 31–60, 61–90, over 90, each edge in its bucket', () => {
		const asAt = '2026-11-30';
		expect(
			ageingBuckets(
				[
					{ dueOn: '2026-12-15', duePaise: 1_000 },
					{ dueOn: '2026-11-30', duePaise: 500 },
					{ dueOn: '2026-11-29', duePaise: 200 },
					{ dueOn: '2026-10-31', duePaise: 300 },
					{ dueOn: '2026-10-30', duePaise: 400 },
					{ dueOn: '2026-10-01', duePaise: 100 },
					{ dueOn: '2026-09-30', duePaise: 700 },
					{ dueOn: '2026-09-01', duePaise: 50 },
					{ dueOn: '2026-08-31', duePaise: 900 },
				],
				asAt,
			),
		).toEqual({ notDue: 1_500, days1to30: 500, days31to60: 500, days61to90: 750, over90: 900, total: 4_150 });
	});

	it('counts days across a year’s end and a leap February', () => {
		expect(
			ageingBuckets(
				[
					{ dueOn: '2028-02-01', duePaise: 10 },
					{ dueOn: '2027-12-02', duePaise: 20 },
					{ dueOn: '2027-12-01', duePaise: 40 },
				],
				'2028-03-01',
			),
		).toEqual({ notDue: 0, days1to30: 10, days31to60: 0, days61to90: 20, over90: 40, total: 70 });
	});

	it('leaves out what is settled or paid ahead', () => {
		expect(
			ageingBuckets(
				[
					{ dueOn: '2026-01-01', duePaise: 0 },
					{ dueOn: '2026-01-01', duePaise: -5_000 },
				],
				'2026-11-30',
			),
		).toEqual({ notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 });
	});
});

describe('which changes are the books’', () => {
	it('names the areas of the books', () => {
		expect(BOOKS_AUDIT_PREFIXES).toEqual([
			'accounts.',
			'accounts_template.',
			'bank.',
			'cash.',
			'counter.',
			'creditNote.',
			'debitNote.',
			'document.lock.',
			'edocs.',
			'gst.',
			'paymentVoucher.',
			'purchase.',
			'refundVoucher.',
			'returns.',
			'selfInvoice.',
			'settlement.',
			'stock.',
			'transfer.',
		]);
	});

	it('takes an action by the start of its name, never an area that only begins the same', () => {
		expect(isBooksAudit({ action: 'purchase.entry.void' })).toBe(true);
		expect(isBooksAudit({ action: 'document.lock.unlock' })).toBe(true);
		expect(isBooksAudit({ action: 'business.setoff_reversed' })).toBe(false);
		expect(isBooksAudit({ action: 'purchases.export' })).toBe(false);
		expect(isBooksAudit({ action: 'accounts' })).toBe(false);
		expect(isBooksAudit({ action: 'document.print' })).toBe(false);
	});
});

describe('the audit report’s chips', () => {
	const entry = (action: string, over: Partial<AuditLike> = {}): AuditLike => ({
		actorUserId: 'adm_accountant',
		action,
		createdAt: '2026-11-24T05:00:00.000Z',
		diffs: [],
		metadata: {},
		...over,
	});
	const chips = (e: AuditLike) => auditCategories(e, new Set(['adm_owner']));

	it('calls a cancel, a void or a reversal cancelled', () => {
		expect(chips(entry('purchase.order.cancel'))).toEqual(['cancelled']);
		expect(chips(entry('purchase.entry.void'))).toEqual(['cancelled']);
		expect(chips(entry('stock.adjustment.reverse'))).toEqual(['cancelled']);
	});

	it('calls an unlock, or a period lock made looser, an unlock', () => {
		expect(chips(entry('document.lock.unlock'))).toEqual(['unlocks']);
		const lock = (before: unknown, after: unknown) =>
			chips(entry('accounts.period.lock', { diffs: [{ field: 'state', before, after }] }));
		expect(lock('locked', 'closed_for_staff')).toEqual(['unlocks']);
		expect(lock('closed_for_staff', 'open')).toEqual(['unlocks']);
		expect(lock('locked', 'open')).toEqual(['unlocks']);
		// An unknown state counts as open.
		expect(lock('closed_for_staff', 'reopened')).toEqual(['unlocks']);
		expect(lock('open', 'locked')).toEqual([]);
		expect(lock('closed_for_staff', 'closed_for_staff')).toEqual([]);
		expect(lock(undefined, 'open')).toEqual([]);
		expect(chips(entry('accounts.period.lock'))).toEqual([]);
		expect(
			chips(
				entry('accounts.period.lock', {
					diffs: [
						{ field: 'note', before: 'a', after: 'b' },
						{ field: 'state', before: 'locked', after: 'open' },
					],
				}),
			),
		).toEqual(['unlocks']);
		// Only the period lock's own action reads its states.
		expect(
			chips(entry('accounts.period.close', { diffs: [{ field: 'state', before: 'locked', after: 'open' }] })),
		).toEqual([]);
	});

	it('calls a take-over a take-over', () => {
		expect(chips(entry('accounts.voucher.take_over'))).toEqual(['takeovers']);
	});

	it('calls an update, an edit or a save an edit, only at the end of the action', () => {
		expect(chips(entry('purchase.entry.update'))).toEqual(['edits']);
		expect(chips(entry('accounts.voucher.edit'))).toEqual(['edits']);
		expect(chips(entry('bank.layout.save'))).toEqual(['edits']);
		expect(chips(entry('accounts_template.edit'))).toEqual(['edits']);
		expect(chips(entry('accounts.update_rules.post'))).toEqual([]);
		expect(chips(entry('accounts.voucher.saved'))).toEqual([]);
	});

	it('calls an entry backdated when it says so, or is dated before the day it was made', () => {
		expect(chips(entry('accounts.voucher.post', { metadata: { backdated: true } }))).toEqual(['backdated']);
		expect(chips(entry('accounts.voucher.post', { metadata: { date: '2026-11-20' } }))).toEqual(['backdated']);
		expect(chips(entry('accounts.voucher.post', { metadata: { date: '2026-11-24' } }))).toEqual([]);
		expect(chips(entry('accounts.voucher.post', { metadata: { date: '2026-11-25' } }))).toEqual([]);
		expect(chips(entry('accounts.voucher.post', { metadata: { backdated: 'true', date: 20_261_120 } }))).toEqual(
			[],
		);
	});

	it('calls anything a super admin did a super admin action, never an entry without a person', () => {
		expect(chips(entry('accounts.voucher.post', { actorUserId: 'adm_owner' }))).toEqual(['superAdmin']);
		expect(chips(entry('accounts.voucher.post', { actorUserId: null }))).toEqual([]);
		expect(auditCategories(entry('accounts.voucher.post', { actorUserId: 'adm_owner' }), new Set())).toEqual([]);
	});

	it('puts an entry under every chip it fits, and under none when it fits none', () => {
		expect(
			chips(entry('purchase.entry.void', { actorUserId: 'adm_owner', metadata: { date: '2026-10-31' } })),
		).toEqual(['cancelled', 'backdated', 'superAdmin']);
		expect(chips(entry('accounts.unlock.take_over.save'))).toEqual(['unlocks', 'takeovers', 'edits']);
		expect(chips(entry('accounts.voucher.post'))).toEqual([]);
	});
});
