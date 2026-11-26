import { REPORT_DATASETS } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { ReportBuilderService, auditTemplates } from '../src/reports/report-builder.service';

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

const PEOPLE: Record<string, { displayName?: string; username?: string; email?: string }> = {
	adm_acc: { displayName: 'Asha Das' },
	adm_user: { displayName: '', username: 'mitali' },
	adm_mail: { email: 'owner@saha-textile.test' },
};
function build(pages: unknown[][], audit = true, stored: unknown[] = []) {
	const list = vi.fn(async (q: { page: number }) => ({ items: pages[q.page - 1] ?? [], total: pages.flat().length }));
	const findById = vi.fn(async (id: string) => {
		if (id === 'adm_broken') throw new Error('down');
		return PEOPLE[id] ?? null;
	});
	const definitions = { list: async () => stored, get: async () => null, save: vi.fn(), remove: vi.fn() };
	const service = new ReportBuilderService(
		...([{}, {}, {}, {}, definitions, {}, { findById }, { list: async () => [] }] as never as []),
		...((audit ? [{ list }] : []) as []),
	);
	return { service: service as unknown as Rows & ReportBuilderService, list, findById };
}
const auditor = { userId: 'adm_acc', permissions: ['accounts.index', 'audit.index'] } as never;
const accountant = { userId: 'adm_acc', permissions: ['accounts.index'] } as never;
const status = (error: unknown) => (error as { status?: number }).status;
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;

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
			who: 'Asha Das',
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

describe('who, by name (AU1)', () => {
	it('names each person once, by display name, username or email, else their id', async () => {
		const { service, findById } = build([
			[
				entry('a'),
				entry('b'),
				entry('c', { actorUserId: 'adm_user' }),
				entry('d', { actorUserId: 'adm_mail' }),
				entry('e', { actorUserId: 'adm_gone' }),
				entry('f', { actorUserId: 'adm_broken' }),
			],
		]);
		const rows = (await service.rows('auditLines', '2026-11-01', '2026-11-30', new Map())) as Record<
			string,
			unknown
		>[];
		expect(rows.map((r) => r['who'])).toEqual([
			'Asha Das',
			'Asha Das',
			'mitali',
			'owner@saha-textile.test',
			'adm_gone',
			'adm_broken',
		]);
		expect(findById).toHaveBeenCalledTimes(5);
	});
});

describe('the starting audit reports (AU2)', () => {
	const now = new Date('2026-11-26T20:00:00.000Z');

	it('are fourteen saved reports on the audit trail for this month, in two folders', () => {
		const all = auditTemplates(now);
		expect(all).toHaveLength(14);
		expect(all[0]).toMatchObject({
			id: 'rpt_audit_price',
			name: 'AR-PRICE · Price changes',
			folder: 'Audit: for this business',
			periodPreset: 'this_month',
			from: '2026-11-01',
			to: '2026-11-30',
			createdBy: null,
			spec: { dataset: 'auditLines', sort: { field: 'changePercent', direction: 'desc' } },
		});
		expect(all.at(-1)?.folder).toBe('Audit: for any business');
		// The month in India: past midnight there on the 1st, it is already December.
		expect(auditTemplates(new Date('2026-11-30T19:00:00.000Z'))[0]).toMatchObject({
			from: '2026-12-01',
			to: '2026-12-31',
		});
	});

	it('are listed and opened only by those who may see the audit trail, before the saved ones', async () => {
		const mine = { id: 'rpt_1', openTo: 'all', createdBy: 'adm_acc', roleIds: [] };
		const { service } = build([], true, [mine]);
		const listed = await service.list(auditor, now);
		expect(listed).toHaveLength(15);
		expect(listed.at(-1)).toBe(mine);
		expect(await service.list(accountant)).toEqual([mine]);
		expect((await service.get('rpt_audit_cash', auditor, now)).name).toBe(
			'AR-CASH · Cash sheets, differences and cash paid out',
		);
		expect((await service.get('rpt_audit_cash', auditor)).id).toBe('rpt_audit_cash');
		const unknown = await service.get('rpt_audit_nothing', auditor).catch((e: unknown) => e);
		expect([status(unknown), code(unknown)]).toEqual([404, 'report_definition_not_found']);
		const barred = await service.get('rpt_audit_cash', accountant).catch((e: unknown) => e);
		expect([status(barred), code(barred)]).toEqual([403, 'report_audit_not_allowed']);
	});

	it('are never changed or deleted, and the audit source runs only for those who may see it', async () => {
		const { service } = build([[entry('a')]]);
		const template = auditTemplates(now)[0] as NonNullable<ReturnType<typeof auditTemplates>[number]>;
		const { id: _id, createdBy: _c, createdByName: _n, createdAt: _a, updatedAt: _u, ...write } = template;
		for (const attempt of [
			service.update('rpt_audit_price', write as never, auditor),
			service.remove('rpt_audit_price', auditor),
		]) {
			const error = await attempt.catch((e: unknown) => e);
			expect([status(error), code(error)]).toEqual([403, 'report_definition_built_in']);
		}
		const run = { spec: template.spec, from: '2026-11-01', to: '2026-11-30', preview: true };
		const refused = await service.run(run, accountant).catch((e: unknown) => e);
		expect([status(refused), code(refused)]).toEqual([403, 'report_audit_not_allowed']);
		const none = await service.run(run, undefined).catch((e: unknown) => e);
		expect(status(none)).toBe(403);
		expect((await service.run(run, auditor)).count).toBe(0);
	});
});
