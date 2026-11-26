import type { AccountsTemplate, ReportTemplateContent } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ReportPreviewController, ReportPreviewService } from '../src/ledger/report-preview';

/** Report templates' "Preview with this company" (accounts templates plan AT6). */

const report = (over: Partial<ReportTemplateContent> = {}): ReportTemplateContent => ({
	kind: 'report',
	columns: 'thisAndLast',
	notes: false,
	level: null,
	lines: [{ key: 'cash', label: 'Cash', parentKey: null, sources: [{ kind: 'ledger', key: 'cash' }] }],
	...over,
});
const version = (content: unknown) => ({ version: 1, validFrom: '2026-04-01', content }) as never;
const template = (over: Partial<AccountsTemplate> = {}) =>
	({ code: 'RP-CASH', kind: 'report', versions: [version(report())], draft: null, ...over }) as AccountsTemplate;

function setup(found: AccountsTemplate) {
	const balances = vi.fn(async (day: string) => ({ cash: day === '2026-11-24' ? 5_000 : 3_000 }));
	const ledger = {
		chart: async () => ({
			groups: [{ id: 'g', systemKey: 'cash_in_hand', name: 'Cash', parentId: null, nature: 'asset', roles: [] }],
			ledgers: [
				{ id: 'cash', systemKey: 'cash', name: 'Cash', groupId: 'g', nature: 'asset', roles: [], active: true },
			],
		}),
		balances,
	};
	const service = new ReportPreviewService(ledger as never, { get: async () => found } as never);
	return { service, balances };
}

describe('Preview with this company (AT6)', () => {
	it('works the draft out on the books on a day, with the year before beside it', async () => {
		const { service, balances } = setup(template({ draft: { content: report({ notes: true }) } as never }));
		const preview = await service.preview('RP-CASH', { asAt: '2026-11-24' }, undefined);
		expect(preview).toMatchObject({ asAt: '2026-11-24', lastAsAt: '2026-03-31', problems: [] });
		expect(preview.rows[0]).toMatchObject({ key: 'cash', thisYearPaise: 5_000, lastYearPaise: 3_000 });
		expect(balances.mock.calls.map(([day]) => day)).toEqual(['2026-11-24', '2026-03-31', '2025-03-31']);
	});

	it('takes the newest version without a draft, today by default, and a January day in the year that began in April', async () => {
		const { service, balances } = setup(template({ versions: [version(report({ columns: 'thisYear' }))] }));
		const preview = await service.preview('RP-CASH', {}, undefined, '2027-01-15');
		expect(preview).toMatchObject({ asAt: '2027-01-15', lastAsAt: null });
		expect(preview.rows[0]?.lastYearPaise).toBeNull();
		expect(balances.mock.calls.map(([day]) => day)).toEqual(['2027-01-15', '2026-03-31']);
		expect((await setup(template()).service.preview('RP-CASH', {}, undefined)).asAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('refuses a template that is not a report, or one with nothing to show yet', async () => {
		const chart = template({ kind: 'chart', versions: [version({ kind: 'chart', groups: [], ledgers: [] })] });
		for (const found of [chart, template({ versions: [] })]) {
			await expect(setup(found).service.preview('X', {}, undefined)).rejects.toMatchObject({
				response: { issues: [{ code: 'template_not_a_report' }] },
			});
		}
	});

	it('answers on its route', async () => {
		const reports = { preview: vi.fn(async () => ({ rows: [] })) };
		const controller = new ReportPreviewController(reports as never);
		await controller.preview('RP-CASH', { asAt: '2026-11-24' }, undefined);
		expect(reports.preview).toHaveBeenCalledWith('RP-CASH', { asAt: '2026-11-24' }, undefined);
	});
});
