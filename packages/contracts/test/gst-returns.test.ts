import { describe, expect, it } from 'vitest';

import {
	GstCalendar,
	GstCalendarChip,
	GstCalendarQuery,
	GstCalendarRow,
	GstDraftStatus,
	GstDraftType,
	GstReturnDraft,
	GstReturnPrepare,
	GstReturnProblem,
	GstReturnStep,
	GstReturnSummaryRow,
} from '../src/gst-returns';

/** GST returns from the books (accounts brief G3, G4, G6): drafts, their steps and the returns calendar. */

const draft = {
	id: 'gstd_1',
	gstRegistrationId: 'gst_wb',
	gstin: '19DBYPS6736R1ZZ',
	returnType: 'GSTR-1',
	month: '2026-11',
	status: 'prepared',
	summary: [{ table: '9B', records: 2, taxable: -52_900, tax: -2_495 }],
	problems: [{ table: '9B', problem: 'note_invoice_missing', document: 'CN/26-27/000005' }],
	portal: { gstin: '19DBYPS6736R1ZZ', fp: '112026', b2b: [] },
	preparedBy: 'adm_1',
	preparedAt: '2026-12-02T05:00:00.000Z',
};

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const firstMessage = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

describe('return drafts', () => {
	it('knows GSTR-1 and GSTR-3B, prepared, checked, approved and filed', () => {
		expect(GstDraftType.options).toEqual(['GSTR-1', 'GSTR-3B']);
		expect(GstDraftStatus.options).toEqual(['prepared', 'checked', 'approved', 'filed']);
		refused(GstDraftType.safeParse('GSTR-9').success);
		refused(GstDraftStatus.safeParse('draft').success);
	});

	it('keeps a summary row’s records whole and its money signed, and a problem with its table and document', () => {
		accepted(GstReturnSummaryRow.safeParse({ table: '7', records: 0, taxable: 0, tax: 0 }).success);
		refused(GstReturnSummaryRow.safeParse({ table: '7', records: -1, taxable: 0, tax: 0 }).success);
		refused(GstReturnSummaryRow.safeParse({ table: '7', records: 1.5, taxable: 0, tax: 0 }).success);
		refused(GstReturnProblem.safeParse({ table: '4A', problem: 'gstin_invalid' }).success);
	});

	it('starts a prepared draft unchecked, unapproved and at version 0', () => {
		expect(GstReturnDraft.parse(draft)).toEqual({
			...draft,
			checkedBy: null,
			checkedAt: null,
			approvedBy: null,
			approvedAt: null,
			preparedByName: '',
			checkedByName: '',
			approvedByName: '',
			arn: null,
			filedOn: null,
			setOff: null,
			adjustments: [],
			setOffVoucherId: null,
			challanVoucherId: null,
			version: 0,
		});
	});

	it('keeps who checked and approved it, and when', () => {
		const signed = {
			...draft,
			status: 'approved',
			checkedBy: 'adm_accountant',
			checkedAt: '2026-12-03T05:00:00.000Z',
			approvedBy: 'adm_ca',
			approvedAt: '2026-12-04T05:00:00.000Z',
			preparedByName: 'Sudip Ghosh',
			checkedByName: 'Sudip Ghosh',
			approvedByName: 'R. Ghosh & Co.',
			arn: 'AA191126123456Z',
			filedOn: '2026-12-10',
			setOff: null,
			adjustments: [],
			setOffVoucherId: null,
			challanVoucherId: null,
			version: 2,
		};
		expect(GstReturnDraft.parse(signed)).toEqual(signed);
	});

	it('keeps the portal file as it was prepared, whatever its blocks', () => {
		expect(GstReturnDraft.parse({ ...draft, portal: {} }).portal).toEqual({});
		expect(GstReturnDraft.parse({ ...draft, portal: { hsn: { hsn_b2b: [], hsn_b2c: [] } } }).portal).toEqual({
			hsn: { hsn_b2b: [], hsn_b2c: [] },
		});
		refused(GstReturnDraft.safeParse({ ...draft, portal: 'gstr1.json' }).success);
		refused(GstReturnDraft.safeParse({ ...draft, portal: null }).success);
	});

	it('refuses a month in the wrong shape, an unknown return or status, and a version below 0', () => {
		const result = GstReturnDraft.safeParse({ ...draft, month: '2026-13' });
		expect(firstMessage(result)).toBe('month_shape');
		refused(GstReturnDraft.safeParse({ ...draft, returnType: 'GSTR-9' }).success);
		refused(GstReturnDraft.safeParse({ ...draft, status: 'draft' }).success);
		refused(GstReturnDraft.safeParse({ ...draft, version: -1 }).success);
		refused(GstReturnDraft.safeParse({ ...draft, preparedAt: '' }).success);
		refused(GstReturnDraft.safeParse({ ...draft, preparedBy: undefined }).success);
	});
});

describe('preparing and stepping a return', () => {
	it('prepares a return for a registration and a month, refusing a month that is not YYYY-MM', () => {
		const ask = { gstRegistrationId: 'gst_wb', returnType: 'GSTR-3B', month: '2026-11' };
		expect(GstReturnPrepare.parse(ask)).toEqual({ ...ask, adjustments: [] });
		for (const month of ['2026-1', '2026-00', '11-2026', '2026-11-01'])
			expect(firstMessage(GstReturnPrepare.safeParse({ ...ask, month }))).toBe('month_shape');
		refused(GstReturnPrepare.safeParse({ ...ask, gstRegistrationId: '' }).success);
		refused(GstReturnPrepare.safeParse({ ...ask, returnType: 'GSTR-9' }).success);
	});

	it('steps a draft to checked or approved at its version, never straight to filed', () => {
		expect(GstReturnStep.parse({ to: 'checked', version: 0 })).toEqual({ to: 'checked', version: 0 });
		expect(GstReturnStep.parse({ to: 'approved', version: 1 })).toEqual({ to: 'approved', version: 1 });
		refused(GstReturnStep.safeParse({ to: 'filed', version: 2 }).success);
		refused(GstReturnStep.safeParse({ to: 'checked' }).success);
		refused(GstReturnStep.safeParse({ to: 'checked', version: 0.5 }).success);
	});
});

describe('the returns calendar', () => {
	it('opens on what is due for a registration', () => {
		expect(GstCalendarChip.options).toEqual(['due', 'filed', 'all']);
		expect(GstCalendarQuery.parse({ gstRegistrationId: 'gst_wb' })).toEqual({
			gstRegistrationId: 'gst_wb',
			chip: 'due',
		});
		expect(GstCalendarQuery.parse({ gstRegistrationId: 'gst_wb', chip: 'filed' }).chip).toBe('filed');
		refused(GstCalendarQuery.safeParse({ gstRegistrationId: 'gst_wb', chip: 'late' }).success);
		refused(GstCalendarQuery.safeParse({ chip: 'due' }).success);
	});

	it('lists a month’s return or a financial year’s annual return, not started or at its step, with its ARN once filed', () => {
		const monthly = {
			returnType: 'GSTR-3B',
			period: '2026-11',
			dueOn: '2026-12-20',
			status: 'not_started',
			arn: null,
			draftId: null,
		};
		expect(GstCalendarRow.parse(monthly)).toEqual(monthly);
		const annual = { ...monthly, returnType: 'GSTR-9', period: '2025-26', dueOn: '2026-12-31' };
		expect(GstCalendarRow.parse(annual)).toEqual(annual);
		const filed = { ...monthly, status: 'filed', arn: 'AA191126123456X', draftId: 'gstd_1' };
		expect(GstCalendarRow.parse(filed)).toEqual(filed);
		refused(GstCalendarRow.safeParse({ ...monthly, returnType: 'GSTR-4' }).success);
		refused(GstCalendarRow.safeParse({ ...monthly, status: 'late' }).success);
		refused(GstCalendarRow.safeParse({ ...monthly, dueOn: '20-12-2026' }).success);
		refused(GstCalendarRow.safeParse({ ...monthly, arn: undefined }).success);
	});

	it('counts every chip', () => {
		const calendar = { gstin: '19DBYPS6736R1ZZ', rows: [], counts: { due: 2, filed: 10, all: 12 } };
		expect(GstCalendar.parse(calendar)).toEqual(calendar);
		refused(GstCalendar.safeParse({ ...calendar, counts: { due: 2, filed: 10 } }).success);
		refused(GstCalendar.safeParse({ ...calendar, counts: { due: -1, filed: 10, all: 9 } }).success);
		refused(GstCalendar.safeParse({ ...calendar, counts: { ...calendar.counts, late: 1 } }).success);
	});
});
