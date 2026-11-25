import { REPORT_DATASETS } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { ReportBuilderService } from '../src/reports/report-builder.service';

/** Brief 26 AU2: the audit trail as a report builder source, one row per field changed. */
type Rows = { rows: (dataset: string, from: string, to: string, places: Map<string, string>) => Promise<unknown[]> };
const entry = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	actorUserId: 'adm_acc',
	action: 'payroll.payslip.edit',
	entityType: 'payrollRun',
	entityId: 'pay_1',
	diffs: [],
	metadata: {},
	createdAt: '2026-11-30T20:30:00.000Z',
	...over,
});

function build(pages: unknown[][], audit = true) {
	const list = vi.fn(async (q: { page: number }) => ({ items: pages[q.page - 1] ?? [], total: pages.flat().length }));
	const service = new ReportBuilderService(
		...(Array.from({ length: 8 }, () => ({}) as never) as []),
		...((audit ? [{ list }] : []) as []),
	);
	return { service: service as unknown as Rows, list };
}

describe('the audit trail as a report source (AU2)', () => {
	it('offers its fields in the catalogue', () => {
		expect(REPORT_DATASETS.auditLines.map((f) => f.key)).toContain('changePercent');
	});

	it('makes a row per field changed, in India’s date and time, with a numeric change in % and the reason', async () => {
		const { service, list } = build([
			[
				entry('a', {
					diffs: [
						{ field: 'sellingPrice', before: 2_000, after: 2_500 },
						{ field: 'name', before: 'Old', after: null },
						{ field: 'mrp', before: 0, after: 10 },
					],
					metadata: { reason: 'Diwali' },
				}),
				entry('b', {
					actorUserId: null,
					entityType: null,
					entityId: null,
					createdAt: '2026-11-29T03:00:00.000Z',
				}),
			],
		]);
		const rows = (await service.rows('auditLines', '2026-11-01', '2026-11-30', new Map())) as Record<
			string,
			unknown
		>[];
		expect(list).toHaveBeenCalledWith(expect.objectContaining({ audience: 'admin', page: 1, pageSize: 200 }));
		expect(rows[0]).toMatchObject({
			date: '2026-12-01',
			time: '02:00',
			weekday: 'Tue',
			module: 'payroll',
			record: 'payrollRun pay_1',
			field: 'sellingPrice',
			before: '2000',
			after: '2500',
			changePercent: 25,
			reason: 'Diwali',
			changes: 1,
		});
		expect(rows.slice(1, 3).map((r) => [r['field'], r['before'], r['after'], r['changePercent']])).toEqual([
			['name', 'Old', '', null],
			['mrp', '0', '10', null],
		]);
		expect(rows[3]).toMatchObject({ who: '', record: '', field: '', before: '', after: '', reason: '' });
	});

	it('reads page after page up to the total, and nothing without the trail', async () => {
		const full = Array.from({ length: 200 }, (_, i) => entry(`p${i}`));
		const { service, list } = build([full, [entry('last')]]);
		expect(await service.rows('auditLines', '2026-11-01', '2026-11-30', new Map())).toHaveLength(201);
		expect(list).toHaveBeenCalledTimes(2);
		expect(await build([], false).service.rows('auditLines', '2026-11-01', '2026-11-30', new Map())).toEqual([]);
	});
});
