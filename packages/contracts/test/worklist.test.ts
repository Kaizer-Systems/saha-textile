import { describe, expect, it } from 'vitest';

import * as contracts from '../src/index';
import { WorklistAnswer, WorklistKind, WorklistRow } from '../src/worklist';

/** The worklist (brief 26 WL1, WL2): everything waiting on a person, each row from its own place. */

const refused = (input: unknown) => expect(input).toBe(false);

const row = {
	id: 'attendance_change:emp_priya_2026-11-25',
	kind: 'attendance_change',
	needs: 'approve',
	area: 'payroll',
	params: { name: 'Priya Das', day: '2026-11-25', minutes: 17 },
	askedBy: 'adm_manager',
	since: '2026-11-26T06:00:00.000Z',
	open: { path: ['payroll', 'attendance'] },
	answerable: true,
};

describe('the worklist', () => {
	it('is reachable from the contracts’ index', () => {
		expect(contracts.WorklistRow).toBe(WorklistRow);
		expect(contracts.WorklistKind).toBe(WorklistKind);
	});

	it('knows six kinds of item today', () => {
		expect(WorklistKind.options).toEqual([
			'attendance_change',
			'leave_asked',
			'payslip_blocking',
			'salary_below_minimum',
			'opening_leave_over_cap',
			'stock_approval',
		]);
	});

	it('opens a row with no query unless one is given, and keeps who asked, or nobody', () => {
		expect(WorklistRow.parse(row)).toEqual({ ...row, open: { path: ['payroll', 'attendance'], query: {} } });
		const fix = {
			...row,
			id: 'payslip_blocking:pr_2611:emp_rahul',
			kind: 'payslip_blocking',
			needs: 'fix',
			askedBy: null,
			open: { path: ['payroll', 'run', 'pr_2611'], query: { employee: 'emp_rahul' } },
			answerable: false,
		};
		expect(WorklistRow.parse(fix)).toEqual(fix);
	});

	it('refuses a need, area or kind it does not know, figures that are not words or numbers, and a row with no since', () => {
		refused(WorklistRow.safeParse({ ...row, needs: 'sign' }).success);
		refused(WorklistRow.safeParse({ ...row, area: 'orders' }).success);
		refused(WorklistRow.safeParse({ ...row, kind: 'gst_return' }).success);
		refused(WorklistRow.safeParse({ ...row, params: { late: true } }).success);
		refused(WorklistRow.safeParse({ ...row, since: undefined }).success);
		refused(WorklistRow.safeParse({ ...row, askedBy: undefined }).success);
		refused(WorklistRow.safeParse({ ...row, open: { path: 'payroll' } }).success);
		refused(WorklistRow.safeParse({ ...row, open: { ...row.open, query: { page: 2 } } }).success);
	});

	it('answers ✕ with a reason trimmed to 300 letters, or none', () => {
		expect(WorklistAnswer.parse({})).toEqual({ reason: '' });
		expect(WorklistAnswer.parse({ reason: ' Not on duty that day ' }).reason).toBe('Not on duty that day');
		expect(WorklistAnswer.safeParse({ reason: 'x'.repeat(300) }).success).toBe(true);
		refused(WorklistAnswer.safeParse({ reason: 'x'.repeat(301) }).success);
	});
});
