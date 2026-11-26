import { describe, expect, it } from 'vitest';

import {
	AgeingSide,
	AuditChip,
	AuditReport,
	AuditReportQuery,
	AuditReportRow,
	OutstandingAgeing,
} from '../src/reports';

/** Outstanding with ageing (accounts brief U5) and the audit report (U8): what the screens get and send. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const buckets = { notDue: 1_500, days1to30: 500, days31to60: 500, days61to90: 750, over90: 900, total: 4_150 };

describe('outstanding by age', () => {
	it('ages what customers owe or what is owed to suppliers, party by party, with totals, in whole paise', () => {
		expect(AgeingSide.options).toEqual(['customers', 'suppliers']);
		const ageing = {
			side: 'customers',
			asAt: '2026-11-30',
			rows: [{ ...buckets, partyId: 'biz_1', name: 'Boutique Nila' }],
			totals: buckets,
		};
		expect(OutstandingAgeing.parse(ageing)).toEqual(ageing);
		accepted(OutstandingAgeing.safeParse({ ...ageing, side: 'suppliers', rows: [] }).success);
		refused(OutstandingAgeing.safeParse({ ...ageing, side: 'staff' }).success);
		refused(OutstandingAgeing.safeParse({ ...ageing, totals: { ...buckets, over90: 0.5 } }).success);
		refused(OutstandingAgeing.safeParse({ ...ageing, rows: [{ ...buckets, name: 'x' }] }).success);
		refused(OutstandingAgeing.safeParse({ ...ageing, asAt: '30-11-2026' }).success);
	});
});

describe('the audit report', () => {
	it('has a chip for all and one for each kind of change', () => {
		expect(AuditChip.options).toEqual([
			'all',
			'edits',
			'backdated',
			'cancelled',
			'unlocks',
			'takeovers',
			'superAdmin',
		]);
	});

	it('opens a period on every change, page 1 of 50, the page read from the address', () => {
		expect(AuditReportQuery.parse({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
			from: '2026-11-01',
			to: '2026-11-30',
			chip: 'all',
			page: 1,
			pageSize: 50,
		});
		expect(
			AuditReportQuery.parse({
				from: '2026-11-01',
				to: '2026-11-30',
				chip: 'backdated',
				q: '  TI/26-27  ',
				page: '3',
				pageSize: '500',
			}),
		).toEqual({ from: '2026-11-01', to: '2026-11-30', chip: 'backdated', q: 'TI/26-27', page: 3, pageSize: 500 });
	});

	it('refuses a page under 1, a page size over 500, a search over 80 letters, an unknown chip or a missing day', () => {
		const query = { from: '2026-11-01', to: '2026-11-30' };
		refused(AuditReportQuery.safeParse({ ...query, page: '0' }).success);
		refused(AuditReportQuery.safeParse({ ...query, pageSize: '501' }).success);
		refused(AuditReportQuery.safeParse({ ...query, pageSize: '0' }).success);
		accepted(AuditReportQuery.safeParse({ ...query, q: ` ${'x'.repeat(80)} ` }).success);
		refused(AuditReportQuery.safeParse({ ...query, q: 'x'.repeat(81) }).success);
		refused(AuditReportQuery.safeParse({ ...query, chip: 'deleted' }).success);
		refused(AuditReportQuery.safeParse({ from: '2026-11-01' }).success);
	});

	it('shows each change with who made it, on what, the fields changed, and its kinds, never “all”', () => {
		const row = {
			id: 'aud_1',
			at: '2026-11-24T05:00:00.000Z',
			who: 'Accountant',
			action: 'purchase.entry.void',
			entityType: 'purchaseEntry',
			entityId: 'pe_1',
			detail: 'status: posted → void',
			categories: ['cancelled', 'backdated'],
		};
		expect(AuditReportRow.parse(row)).toEqual(row);
		accepted(AuditReportRow.safeParse({ ...row, entityType: null, entityId: null, categories: [] }).success);
		refused(AuditReportRow.safeParse({ ...row, categories: ['all'] }).success);
		refused(AuditReportRow.safeParse({ ...row, id: '' }).success);
	});

	it('gives a page of rows, the total, and a count for every chip', () => {
		const counts = { all: 12, edits: 4, backdated: 1, cancelled: 2, unlocks: 1, takeovers: 0, superAdmin: 3 };
		const report = { rows: [], total: 12, counts };
		expect(AuditReport.parse(report)).toEqual(report);
		const { takeovers: _takeovers, ...fewer } = counts;
		refused(AuditReport.safeParse({ ...report, counts: fewer }).success);
		refused(AuditReport.safeParse({ ...report, total: -1 }).success);
	});
});
