import { describe, expect, it } from 'vitest';

import { AUDIT_REPORT_TEMPLATES, runReport, specProblems, type ReportRow } from '../src/reports';

/** Brief 26 AU2: the fourteen starting audit reports, each a valid report on the audit trail. */

const row = (over: Partial<Record<string, string | number | null>>): ReportRow => ({
	date: '2026-11-26',
	month: '2026-11',
	time: '10:14',
	weekday: 'Thu',
	who: 'Asha Das',
	module: 'catalog',
	action: 'catalog.product.save',
	record: 'catalog prd_1',
	field: '',
	before: '',
	after: '',
	changePercent: null,
	reason: '',
	changes: 1,
	...over,
});
const byCode = (code: string) => AUDIT_REPORT_TEMPLATES.find((t) => t.code === code);

describe('the starting audit reports', () => {
	it('are fourteen, eight for this business and six for any, each code once and each spec valid', () => {
		expect(AUDIT_REPORT_TEMPLATES).toHaveLength(14);
		expect(AUDIT_REPORT_TEMPLATES.filter((t) => t.kind === 'business')).toHaveLength(8);
		expect(new Set(AUDIT_REPORT_TEMPLATES.map((t) => t.code)).size).toBe(14);
		for (const t of AUDIT_REPORT_TEMPLATES) expect(specProblems('auditLines', t)).toEqual([]);
		expect(byCode('AR-STOCK')?.sort).toEqual({ field: 'date', direction: 'desc' });
	});

	it('keeps price changes only, largest first', () => {
		const spec = byCode('AR-PRICE');
		const table = runReport(
			'auditLines',
			[
				row({ field: 'SKU-1: price', before: 1000, after: 1200, changePercent: 20 }),
				row({ field: 'SKU-1: sale price', before: 900, after: 950, changePercent: 5.6 }),
				row({ field: 'SKU-2: price', before: 500, after: 800, changePercent: 60 }),
				row({ field: 'status', before: 'draft', after: 'live' }),
				row({ action: 'catalog.category.save', field: 'price band' }),
			],
			spec as NonNullable<typeof spec>,
			50,
		);
		expect(table.rows.map((r) => r[4])).toEqual(['SKU-2: price', 'SKU-1: price', 'SKU-1: sale price']);
	});

	it('counts approvals by the person who approved', () => {
		const spec = byCode('AR-APPROVE');
		const table = runReport(
			'auditLines',
			[
				row({ action: 'attendance.day.approve', who: 'Asha Das' }),
				row({ action: 'attendance.day.approve', who: 'Asha Das' }),
				row({ action: 'stock.adjustment.approve', who: 'Mitali Sen' }),
				row({ action: 'stock.adjustment.reject', who: 'Mitali Sen' }),
			],
			spec as NonNullable<typeof spec>,
			50,
		);
		expect(table.rows).toEqual([
			['Asha Das', 'attendance.day.approve', 2],
			['Mitali Sen', 'stock.adjustment.approve', 1],
		]);
	});

	it('reads payroll and attendance together, and settings by their actions', () => {
		const pay = byCode('AR-PAY');
		const rows = [
			row({ module: 'payroll', action: 'payroll.payslip.edit' }),
			row({ module: 'attendance', action: 'attendance.day.change' }),
			row({ module: 'stock', action: 'stock.count.post' }),
		];
		expect(runReport('auditLines', rows, pay as NonNullable<typeof pay>, 50).count).toBe(2);
		const settings = byCode('AR-SETTING');
		expect(
			runReport(
				'auditLines',
				[row({ action: 'payroll.rules.add' }), row({ action: 'payroll.payslip.edit' })],
				settings as NonNullable<typeof settings>,
				50,
			).count,
		).toBe(1);
	});
});
