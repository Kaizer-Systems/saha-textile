import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ReportBuilderPage, reportTree } from './report-builder';

import type { ReportLine } from '@saha-textile/contracts';

/** Settings › Accounts templates › a report template (AT6). */

const line = (key: string, over: Partial<ReportLine> = {}): ReportLine => ({
	key,
	label: key,
	parentKey: null,
	sources: [],
	...over,
});
const content = {
	kind: 'report',
	columns: 'thisAndLast',
	notes: false,
	level: null,
	lines: [
		line('funds', { label: "Owners' funds", sources: [{ kind: 'role', key: 'owners_capital' }] }),
		line('current', {
			parentKey: 'funds',
			sources: [
				{ kind: 'role', key: 'drawings' },
				{ kind: 'group', key: 'capital_account' },
			],
		}),
	],
};
const bs = {
	code: 'RP-NCE-BS',
	name: 'Balance sheet (non-corporate)',
	kind: 'report',
	appliesTo: { all: false, kinds: ['proprietorship', 'partnership'] },
	versions: [{ version: 1, validFrom: '2026-04-01', content }],
	draft: null,
	updatedAt: 'u1',
};
const preview = {
	asAt: '2026-11-24',
	lastAsAt: '2026-03-31',
	rows: [
		{
			key: 'funds',
			label: "Owners' funds",
			depth: 0,
			side: 'credit',
			thisYearPaise: 80_000,
			lastYearPaise: null,
			ledgers: [{ name: 'Capital', thisYearPaise: 100_000, lastYearPaise: null }],
		},
	],
	problems: ['report_source_unknown:role:yacht_hire'],
};

function setup(options: { template?: unknown; code?: string | null; fail?: unknown; permissions?: string[] } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const result = <T>(value: T) => (options.fail ? throwError(() => options.fail) : of(value));
	const gateway = {
		get: vi.fn(() => of(options.template ?? bs)),
		preview: vi.fn(() => result(preview)),
		saveDraft: vi.fn(() => result({})),
		publish: vi.fn(() => result({})),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			ReportBuilderPage,
			TranslocoTestingModule.forRoot({
				langs: {
					en: {
						rb_new_line: 'New line',
						rb_caption_role: 'roles',
						rb_caption_group: 'groups',
						rb_source_role: 'role',
						rb_unknown_source: 'The books have no {{kind}} “{{key}}”.',
						at_all_kinds: 'All kinds',
						co_kind_proprietorship: 'Proprietorship',
						co_kind_partnership: 'Firm',
					},
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap(options.code === null ? {} : { code: options.code ?? 'RP-NCE-BS' })),
				},
			},
			{ provide: AccountsTemplatesGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts_template.edit']) },
			},
		],
	});
	const fixture = TestBed.createComponent(ReportBuilderPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier };
}

async function loaded(options: Parameters<typeof setup>[0] = {}) {
	const ready = setup(options);
	ready.fixture.detectChanges();
	await vi.waitFor(() => expect(ready.page.template.data()).toBeTruthy());
	ready.fixture.detectChanges();
	return ready;
}

describe('the report tree', () => {
	it('puts a line whose parent is missing at the top, and leaves out loops and repeats', () => {
		const tree = reportTree([
			line('a'),
			line('b', { parentKey: 'a' }),
			line('c', { parentKey: 'gone' }),
			line('x', { parentKey: 'y' }),
			line('y', { parentKey: 'x' }),
			line('a'),
		]);
		expect(tree.map((n) => [n.line.key, n.lines.map((c) => c.line.key)])).toEqual([
			['a', ['b']],
			['c', []],
		]);
	});
});

describe('the report builder (AT6)', () => {
	it('opens the newest version: lines as a tree with what each adds up, and the drawn settings', async () => {
		const { page, fixture } = await loaded();
		expect(page.content()).toEqual(content);
		expect(page.tree()[0]?.lines[0]?.line.key).toBe('current');
		expect(page.sourcesText(content.lines[1] as ReportLine)).toBe('roles: drawings · groups: capital_account');
		expect(page.sourcesText(line('empty'))).toBe('');
		expect(page.keysOf(content.lines[1] as ReportLine, 'role')).toBe('drawings');
		expect(page.appliesTo()).toBe('Proprietorship, Firm');
		expect([page.isNew('funds'), page.isNew('fresh')]).toEqual([false, true]);
		page.selected.set('current');
		fixture.detectChanges();
		expect(page.parents().map((p) => p.key)).toEqual(['funds']);
		expect(fixture.nativeElement.textContent).toContain('drawings');
	});

	it('opens a draft, says "All kinds", and has nothing to edit for another type or an empty template', async () => {
		const draft = { content: { ...content, lines: [] }, validFrom: '2027-04-01', source: 'ICAI', notes: 'n' };
		const drafted = await loaded({ template: { ...bs, appliesTo: { all: true, kinds: [] }, draft } });
		expect(drafted.page.content()?.lines).toEqual([]);
		expect([drafted.page.validFrom(), drafted.page.source(), drafted.page.notes()]).toEqual([
			'2027-04-01',
			'ICAI',
			'n',
		]);
		expect(drafted.page.appliesTo()).toBe('All kinds');
		const chart = await loaded({
			template: { ...bs, versions: [{ version: 1, content: { kind: 'chart', groups: [], ledgers: [] } }] },
		});
		expect(chart.page.content()).toBeNull();
		expect(chart.page.isNew('funds')).toBe(true);
		chart.page.addLine(null);
		expect(chart.page.content()).toBeNull();
		await chart.page.saveDraft();
		expect(chart.gateway.saveDraft).not.toHaveBeenCalled();
		const fresh = await loaded({ template: { ...bs, versions: [] } });
		expect(fresh.page.content()).toBeNull();
		const none = setup({ code: null });
		expect([none.page.code(), none.page.appliesTo(), none.page.isNew('a'), none.page.tree()]).toEqual([
			'',
			'All kinds',
			true,
			[],
		]);
		expect(none.page.parents()).toEqual([]);
		await none.page.show();
		await none.page.saveDraft();
		await none.page.publish();
		expect(none.gateway.publish).not.toHaveBeenCalled();
	});

	it('adds, edits and removes lines, their sources and the settings', async () => {
		const { page, fixture } = await loaded();
		page.setting({ columns: 'thisYear', notes: true, level: 'auto' });
		expect(page.content()).toMatchObject({ columns: 'thisYear', notes: true, level: 'auto' });
		page.addLine(null);
		expect(page.line()).toMatchObject({ key: 'new_line', parentKey: null });
		page.addLine('new_line');
		page.patchLine('new_line', { key: 'creditors', label: 'Current liabilities' });
		expect(page.content()?.lines.find((l) => l.key === 'new_line_2')?.parentKey).toBe('creditors');
		expect(page.selected()).toBe('creditors');
		page.setSources(page.line() as ReportLine, 'group', 'sundry_creditors, Bad Key, duties_and_taxes');
		page.setSources(page.line() as ReportLine, 'role', 'rcm_payable');
		expect(page.line()?.sources).toEqual([
			{ kind: 'group', key: 'sundry_creditors' },
			{ kind: 'group', key: 'duties_and_taxes' },
			{ kind: 'role', key: 'rcm_payable' },
		]);
		fixture.detectChanges();
		page.remove('new_line_2');
		expect(page.selected()).toBeNull();
		expect(page.dirty()).toBe(true);
		fixture.detectChanges();
	});

	it('previews the saved report on the books, names sources the books lack, and says why a preview failed', async () => {
		const { page, gateway, fixture } = await loaded();
		page.dirty.set(true);
		await page.show();
		expect(gateway.preview).not.toHaveBeenCalled();
		page.dirty.set(false);
		page.asAt.set('2026-11-24');
		await page.show();
		expect(gateway.preview).toHaveBeenCalledWith('RP-NCE-BS', '2026-11-24');
		expect(page.preview()).toEqual(preview);
		fixture.detectChanges();
		expect(page.missing('report_source_unknown:role:yacht_hire')).toBe('The books have no role “yacht_hire”.');
		page.asAt.set('');
		await page.show();
		expect(gateway.preview).toHaveBeenLastCalledWith('RP-NCE-BS', null);
		const refused = await loaded({
			fail: { error: { error: { issues: [{ code: 'x', message: 'template_not_a_report' }] } } },
		});
		await refused.page.show();
		expect(refused.page.problems()).toEqual(['at_problem_template_not_a_report']);
	});

	it('saves the draft, publishes, and lists every problem in words', async () => {
		const { page, gateway, notifier } = await loaded();
		await page.saveDraft();
		expect(gateway.saveDraft).toHaveBeenCalledWith(
			'RP-NCE-BS',
			expect.objectContaining({ content, expectedUpdatedAt: 'u1' }),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('tb_saved');
		page.dirty.set(true);
		await page.publish();
		expect(gateway.publish).not.toHaveBeenCalled();
		page.dirty.set(false);
		await page.publish();
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('rb_published');
		const lost = await loaded({ fail: new Error('offline') });
		await lost.page.saveDraft();
		expect(lost.page.problems()).toEqual(['at_action_failed']);
		await lost.page.publish();
		expect(lost.page.busy()).toBe(false);
		const readOnly = await loaded({ permissions: [] });
		expect(readOnly.page.canEdit()).toBe(false);
	});
});
