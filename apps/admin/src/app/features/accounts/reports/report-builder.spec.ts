import { ApplicationRef, TemplateRef, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReportsGateway } from '@core/accounts/reports.gateway';
import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { accountsRange } from '@features/accounts/accounts-period';

import {
	FILTER_OPS,
	REPORT_DATASETS,
	ReportBuilderPage,
	cellText,
	filterValues,
	tableCsv,
} from './report-builder-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: vi.fn(),
}));

/** The report builder (accounts brief V1, V2): data, period, columns, filters, groups, totals, sort and saving. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const field = (key: string, type: string, summable = false) => ({ key, type, summable });
const CATALOGUE = {
	invoices: [
		field('number', 'text'),
		field('date', 'date'),
		field('customer', 'text'),
		field('city', 'text'),
		field('taxable', 'money', true),
		field('tax', 'money', true),
		field('margin', 'percent'),
		field('lines', 'number', true),
	],
	invoiceLines: [field('product', 'text'), field('qty', 'number', true)],
	ledgerLines: [],
};
const TABLE = {
	columns: [
		{ key: 'number', type: 'text' },
		{ key: 'date', type: 'date' },
		{ key: 'taxable', type: 'money' },
	],
	rows: [
		['INV/26-27/000001', '2026-11-02', 118_000],
		['INV/26-27/000002', null, -5_000],
	],
	totals: [null, null, 113_000],
	count: 250,
	truncated: true,
};
const SAVED = {
	id: 'rep1',
	name: 'Sales by city',
	folder: 'Sales',
	spec: {
		dataset: 'invoices',
		columns: ['city', 'taxable'],
		filters: [{ field: 'city', op: 'in', values: ['Kolkata', 'Barasat'] }],
		groupBy: ['city'],
		totals: ['taxable'],
		sort: { field: 'taxable', direction: 'desc' },
	},
	periodPreset: 'last_month',
	from: '2026-10-01',
	to: '2026-10-31',
	openTo: 'roles',
	roleIds: ['role1'],
	createdBy: 'u1',
	createdByName: 'Asha',
	createdAt: '2026-11-01T00:00:00.000Z',
	updatedAt: '2026-11-01T00:00:00.000Z',
	version: 3,
};

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(gateway: Record<string, unknown> = {}, options: { id?: string; data?: string; roles?: unknown[] } = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.rb-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const calls = {
		catalogue: vi.fn(() => of(CATALOGUE)),
		run: vi.fn(() => of(TABLE)),
		one: vi.fn(() => of(SAVED)),
		create: vi.fn(() => of({ ...SAVED, id: 'rep9' })),
		update: vi.fn(() => of(SAVED)),
		remove: vi.fn(() => of(undefined)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			ReportBuilderPage,
			TranslocoTestingModule.forRoot({
				langs: { en: { report_folder_default: 'Saved by you' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: ReportsGateway, useValue: calls },
			{
				provide: AdminRolesGateway,
				useValue: {
					list: vi.fn(() =>
						of({
							items: options.roles ?? [
								{ id: 'role1', label: 'Accountant' },
								{ id: 'role2', label: 'CA' },
							],
						}),
					),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap(options.id ? { id: options.id } : {})),
					queryParamMap: of(convertToParamMap(options.data ? { data: options.data } : {})),
				},
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'rb-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(ReportBuilderPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, navigate, calls, queries };
}

async function builder(gateway: Record<string, unknown> = {}, options: Parameters<typeof mount>[1] = {}) {
	const harness = mount(gateway, options);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (root: { nativeElement: HTMLElement } | Element, selector: string) =>
	[...('nativeElement' in root ? root.nativeElement : root).querySelectorAll(selector)] as HTMLElement[];
const pick = (control: HTMLElement | null | undefined, value: string, event = 'change') => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event(event));
};
const modal = (selector: string) => document.querySelector(`.rb-test-modal ${selector}`) as HTMLElement | null;
const card = (fixture: { nativeElement: HTMLElement }, title: string) =>
	all(fixture, '.card').find((c) => c.querySelector('h5')?.textContent?.includes(title)) as HTMLElement;

describe('a report’s cells and filters', () => {
	it('shows each kind of cell, with a dash for nothing', () => {
		expect(cellText(null, 'text')).toBe('—');
		expect(cellText('', 'money')).toBe('—');
		expect(cellText(118_000, 'money')).toBe('₹1,180.00');
		expect(cellText(-5_000, 'money')).toBe('−₹50.00');
		expect(cellText('2500', 'money')).toBe('₹25.00');
		expect(cellText(12.5, 'percent')).toBe('12.5%');
		expect(cellText('2026-11-02', 'date')).not.toBe('2026-11-02');
		expect(cellText(7, 'number')).toBe('7');
		expect(cellText('Kolkata', 'text')).toBe('Kolkata');
	});

	it('splits “in” and “between” at commas, and keeps any other filter as one value', () => {
		expect(filterValues('in', ' Kolkata, Barasat,, ')).toEqual(['Kolkata', 'Barasat']);
		expect(filterValues('between', '100,200')).toEqual(['100', '200']);
		expect(filterValues('is', ' Kolkata ')).toEqual(['Kolkata']);
		expect(filterValues('contains', 'a,b')).toEqual(['a,b']);
		expect([...REPORT_DATASETS]).toEqual(['invoices', 'invoiceLines', 'ledgerLines']);
		expect(FILTER_OPS).toHaveLength(7);
	});

	it('writes the table as a spreadsheet: money in rupees, nothing kept as nothing, and the totals last', () => {
		expect(tableCsv(TABLE as never, (key) => `[${key}]`)).toEqual({
			header: ['[number]', '[date]', '[taxable]'],
			rows: [
				['INV/26-27/000001', '2026-11-02', 1_180],
				['INV/26-27/000002', null, -50],
				[null, null, 1_130],
			],
		});
	});
});

describe('starting a new report', () => {
	it('opens on invoices with the first five columns, and previews them for this month', async () => {
		const { fixture, page, calls } = await builder();
		expect(page.dataset()).toBe('invoices');
		expect(page.columns()).toEqual(['number', 'date', 'customer', 'city', 'taxable']);
		expect(calls.run).toHaveBeenLastCalledWith({
			spec: {
				dataset: 'invoices',
				columns: ['number', 'date', 'customer', 'city', 'taxable'],
				filters: [],
				groupBy: [],
				totals: [],
				sort: null,
			},
			...accountsRange({ period: 'this_month' }),
			preview: true,
		});
		const preview = card(fixture, 'report_preview');
		expect(all(preview, 'th').map((th) => th.textContent?.trim())).toEqual([
			'report_field_number',
			'report_field_date',
			'report_field_taxable',
		]);
		const rows = all(preview, 'tbody tr');
		expect(rows[1]?.textContent).toContain('—');
		expect(rows[1]?.textContent).toContain('−₹50.00');
		expect(rows[2]?.textContent).toContain('₹1,130.00');
		expect(preview.textContent).toContain('report_preview_first');
		expect(el(fixture, '#report_delete')).toBeNull();
		expect(page.label('city')).toBe('report_field_city');
	});

	it('starts on the data the library asked for, or on invoices for data it does not know', async () => {
		const lines = await builder({}, { data: 'invoiceLines' });
		expect([lines.page.dataset(), lines.page.columns()]).toEqual(['invoiceLines', ['product', 'qty']]);
		const unknown = await builder({}, { data: 'payroll' });
		expect(unknown.page.dataset()).toBe('invoices');
	});

	it('waits for the catalogue, and shows no preview before there are columns', async () => {
		const { fixture, page, calls } = mount({ catalogue: vi.fn(() => NEVER) });
		await settle(fixture);
		expect([page.columns(), page.fields()]).toEqual([[], []]);
		expect(calls.run).not.toHaveBeenCalled();
		expect((el(fixture, '#report_save') as HTMLButtonElement).disabled).toBe(true);
		expect((el(fixture, '#report_excel') as HTMLButtonElement).disabled).toBe(true);
		page.setDataset('invoiceLines');
		page.addFilter();
		expect([page.columns(), page.filters()]).toEqual([[], []]);
	});

	it('says when the preview fails, and when it has no rows', async () => {
		const failed = await builder({ run: vi.fn(() => throwError(() => new Error('down'))) });
		expect(card(failed.fixture, 'report_preview').textContent).toContain('report_problem_failed');
		const empty = await builder({
			run: vi.fn(() => of({ ...TABLE, rows: [], totals: [null, null, null], truncated: false })),
		});
		const preview = card(empty.fixture, 'report_preview');
		expect(preview.textContent).toContain('report_no_rows');
		expect(preview.textContent).not.toContain('report_preview_first');
	});
});

describe('choosing what the report shows', () => {
	it('changes the data and starts it afresh, and moves to the period picked', async () => {
		const { fixture, page } = await builder();
		page.filters.set([{ field: 'city', op: 'is', values: ['Kolkata'] }]);
		page.groupBy.set(['city']);
		page.totals.set(['taxable']);
		page.sort.set({ field: 'taxable', direction: 'asc' });
		pick(el(fixture, '#report_dataset'), 'invoiceLines');
		expect([page.dataset(), page.columns(), page.filters(), page.groupBy(), page.totals(), page.sort()]).toEqual([
			'invoiceLines',
			['product', 'qty'],
			[],
			[],
			[],
			null,
		]);
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-15' });
		expect([page.preset(), page.range()]).toEqual([null, { from: '2026-10-01', to: '2026-10-15' }]);
		page.setPeriod({ period: 'last_month' });
		expect([page.preset(), page.range()]).toEqual(['last_month', accountsRange({ period: 'last_month' })]);
	});

	it('adds a column not yet chosen, and removes one from the totals, groups and sort too', async () => {
		const { fixture, page } = await builder();
		const options = () => all(fixture, '#report_add_column option').map((o) => (o as HTMLOptionElement).value);
		expect(options()).toEqual(['', 'tax', 'margin', 'lines']);
		pick(el(fixture, '#report_add_column'), 'margin');
		page.addColumn('');
		page.addColumn('margin');
		expect(page.columns()).toEqual(['number', 'date', 'customer', 'city', 'taxable', 'margin']);
		await settle(fixture);
		expect(options()).toEqual(['', 'tax', 'lines']);
		page.totals.set(['taxable']);
		page.groupBy.set(['city', 'taxable']);
		page.sort.set({ field: 'taxable', direction: 'asc' });
		page.removeColumn('taxable');
		expect([page.columns().includes('taxable'), page.totals(), page.groupBy(), page.sort()]).toEqual([
			false,
			[],
			['city'],
			null,
		]);
		page.sort.set({ field: 'city', direction: 'asc' });
		(all(fixture, 'button[title="report_remove_column"]')[0] as HTMLButtonElement).click();
		expect(page.columns()[0]).toBe('date');
		expect(page.sort()).toEqual({ field: 'city', direction: 'asc' });
	});

	it('adds, changes, types into and removes filters, and previews only filters with a value', async () => {
		const { fixture, page, calls } = await builder();
		(el(fixture, '#report_add_filter') as HTMLButtonElement).click();
		expect(page.filters()).toEqual([{ field: 'number', op: 'is', values: [''] }]);
		await settle(fixture);
		expect(page.spec().filters).toEqual([]);
		const row = () => all(card(fixture, 'report_step_filters'), '.d-flex')[0] as HTMLElement;
		const [fieldSelect, opSelect] = all(row(), 'select');
		pick(fieldSelect, 'city');
		pick(opSelect, 'in');
		await settle(fixture);
		const values = all(row(), 'input')[0] as HTMLInputElement;
		expect(values.placeholder).toBe('report_values_commas');
		pick(values, 'Kolkata, Barasat', 'input');
		expect(page.filters()).toEqual([{ field: 'city', op: 'in', values: ['Kolkata', 'Barasat'] }]);
		await settle(fixture);
		expect(calls.run).toHaveBeenLastCalledWith(
			expect.objectContaining({
				spec: expect.objectContaining({
					filters: [{ field: 'city', op: 'in', values: ['Kolkata', 'Barasat'] }],
				}),
			}),
		);
		page.addFilter();
		page.setFilter(0, { op: 'is' });
		expect(page.filters()[1]).toEqual({ field: 'number', op: 'is', values: [''] });
		page.removeFilter(1);
		await settle(fixture);
		expect((all(row(), 'input')[0] as HTMLInputElement).placeholder).toBe('report_value');
		page.typed(4, 'nothing there');
		expect(page.filters()).toHaveLength(1);
		(all(row(), 'button')[0] as HTMLButtonElement).click();
		expect(page.filters()).toEqual([]);
	});

	it('groups by up to three text or date columns in order, an empty choice ending the list there', async () => {
		const { fixture, page } = await builder();
		const options = (select: HTMLElement | undefined) =>
			all(select as HTMLElement, 'option').map((o) => (o as HTMLOptionElement).value);
		const groupSelects = () => all(fixture, 'select[aria-label="report_group_by"]');
		expect(groupSelects()).toHaveLength(1);
		expect(options(groupSelects()[0])).toEqual(['', 'number', 'date', 'customer', 'city']);
		pick(groupSelects()[0], 'city');
		page.setGroup(1, 'date');
		page.setGroup(2, 'customer');
		await settle(fixture);
		expect(page.groupBy()).toEqual(['city', 'date', 'customer']);
		expect(groupSelects()).toHaveLength(3);
		page.setGroup(1, '');
		expect(page.groupBy()).toEqual(['city']);
		expect(page.typeOf('nowhere')).toBe('text');
	});

	it('totals summable columns, sorts by a column, and turns the sort off', async () => {
		const { fixture, page } = await builder();
		page.addColumn('lines');
		await settle(fixture);
		expect(page.summable().map((f) => f.key)).toEqual(['taxable', 'lines']);
		const boxes = all(fixture, 'input[type="checkbox"]');
		expect(boxes).toHaveLength(2);
		boxes[0]?.click();
		expect(page.totals()).toEqual(['taxable']);
		page.toggleTotal('lines');
		page.toggleTotal('taxable');
		expect(page.totals()).toEqual(['lines']);
		const sortField = el(fixture, 'select[aria-label="report_sort"]');
		const sortDirection = el(fixture, 'select[aria-label="report_sort_direction"]');
		expect((sortDirection as HTMLSelectElement).disabled).toBe(true);
		pick(sortField, 'taxable');
		expect(page.sort()).toEqual({ field: 'taxable', direction: 'desc' });
		await settle(fixture);
		expect((sortDirection as HTMLSelectElement).disabled).toBe(false);
		pick(sortDirection, 'asc');
		expect(page.sort()).toEqual({ field: 'taxable', direction: 'asc' });
		page.setSort('', 'asc');
		expect(page.sort()).toBeNull();
	});
});

describe('a saved report', () => {
	it('opens with its choices once, its moving period worked out for today', async () => {
		let version = 3;
		const one = vi.fn(() => of({ ...SAVED, version: version++ }));
		const { fixture, page } = await builder({ one }, { id: 'rep1' });
		expect(one).toHaveBeenCalledWith('rep1');
		expect([page.dataset(), page.columns(), page.groupBy(), page.totals(), page.sort()]).toEqual([
			'invoices',
			['city', 'taxable'],
			['city'],
			['taxable'],
			{ field: 'taxable', direction: 'desc' },
		]);
		expect(page.filters()).toEqual(SAVED.spec.filters);
		expect(page.filters()[0]?.values).not.toBe(SAVED.spec.filters[0]?.values);
		expect([page.preset(), page.range(), page.moving()]).toEqual([
			'last_month',
			accountsRange({ period: 'last_month' }),
			true,
		]);
		expect([page.name(), page.folder(), page.openTo(), page.roleIds()]).toEqual([
			'Sales by city',
			'Sales',
			'roles',
			['role1'],
		]);
		expect(el(fixture, '#report_delete')).not.toBeNull();
		page.name.set('Changed here');
		await page.definition.refetch();
		await settle(fixture);
		expect(page.name()).toBe('Changed here');
	});

	it('keeps the days saved when its period does not move, and offers no delete for a built-in one', async () => {
		const { fixture, page } = await builder(
			{ one: vi.fn(() => of({ ...SAVED, periodPreset: null, createdBy: null })) },
			{ id: 'rep2' },
		);
		expect([page.preset(), page.range(), page.moving()]).toEqual([
			null,
			{ from: '2026-10-01', to: '2026-10-31' },
			false,
		]);
		expect(el(fixture, '#report_delete')).toBeNull();
	});

	it('deletes it and goes back to the library, or names the refusal', async () => {
		const removed = await builder({}, { id: 'rep1' });
		(el(removed.fixture, '#report_delete') as HTMLButtonElement).click();
		await settle(removed.fixture);
		expect(removed.calls.remove).toHaveBeenCalledWith('rep1');
		expect(removed.invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
		expect(removed.notifier.showSuccess).toHaveBeenCalledWith('report_deleted');
		expect(removed.navigate).toHaveBeenCalledWith(['/accounts/reports']);

		const refused = await builder(
			{ remove: vi.fn(() => throwError(() => refusal('report_not_yours:rep1'))) },
			{ id: 'rep1' },
		);
		await refused.page.remove();
		expect(refused.notifier.showError).toHaveBeenCalledWith('report_problem_report_not_yours');
		expect(refused.page.busy()).toBe(false);

		const fresh = await builder();
		await fresh.page.remove();
		expect(fresh.calls.remove).not.toHaveBeenCalled();
	});
});

describe('saving as a template (V2)', () => {
	it('fills the default folder, opens to chosen roles, and saves a new report then opens it', async () => {
		const { fixture, page, opened, calls, notifier, invalidate, navigate } = await builder();
		(el(fixture, '#report_save') as HTMLButtonElement).click();
		expect(page.folder()).toBe('Saved by you');
		const popup = opened[0] as Opened;
		const redraw = () => popup.view.detectChanges();
		const confirm = modal('#report_save_confirm') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		pick(modal('#report_name'), '  November sales  ', 'input');
		redraw();
		expect(confirm.disabled).toBe(false);
		expect(document.querySelectorAll('.rb-test-modal input[type="radio"]')).toHaveLength(3);
		(modal('#report_open_roles') as HTMLInputElement).dispatchEvent(new Event('change'));
		expect(page.openTo()).toBe('roles');
		await settle(fixture);
		redraw();
		expect(confirm.disabled).toBe(true);
		const roles = () =>
			([...document.querySelectorAll('.rb-test-modal input[type="checkbox"]')] as HTMLInputElement[]).filter(
				(box) => box.id !== 'report_moving',
			);
		expect(roles()).toHaveLength(2);
		roles()[0]?.dispatchEvent(new Event('change'));
		roles()[1]?.dispatchEvent(new Event('change'));
		page.toggleRole('role2');
		expect(page.roleIds()).toEqual(['role1']);
		redraw();
		expect(confirm.disabled).toBe(false);
		const moving = modal('#report_moving') as HTMLInputElement;
		expect(moving.disabled).toBe(false);
		confirm.click();
		await settle(fixture);
		expect(calls.create).toHaveBeenCalledWith({
			name: 'November sales',
			folder: 'Saved by you',
			spec: page.spec(),
			periodPreset: 'this_month',
			...accountsRange({ period: 'this_month' }),
			openTo: 'roles',
			roleIds: ['role1'],
		});
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('report_saved');
		expect(popup.close).toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith(['/accounts/reports/saved', 'rep9']);
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('keeps the days when the period does not move, and keeps a folder already named', async () => {
		const { fixture, page, opened, calls } = await builder();
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-15' });
		page.folder.set('Mine');
		page.name.set('October first half');
		(el(fixture, '#report_save') as HTMLButtonElement).click();
		expect(page.folder()).toBe('Mine');
		const popup = opened[0] as Opened;
		popup.view.detectChanges();
		expect((modal('#report_moving') as HTMLInputElement).disabled).toBe(true);
		page.setPeriod({ period: 'last_month' });
		popup.view.detectChanges();
		(modal('#report_moving') as HTMLInputElement).dispatchEvent(new Event('change'));
		expect(page.moving()).toBe(false);
		await page.save();
		expect(calls.create).toHaveBeenCalledWith(
			expect.objectContaining({ periodPreset: null, openTo: 'me', roleIds: [], folder: 'Mine' }),
		);
	});

	it('updates a saved report with its version without leaving it, and names a refusal', async () => {
		const saved = await builder({}, { id: 'rep1' });
		await saved.page.save();
		expect(saved.calls.update).toHaveBeenCalledWith(
			'rep1',
			expect.objectContaining({ version: 3, roleIds: ['role1'] }),
		);
		expect(saved.navigate).not.toHaveBeenCalled();

		// A saved report that could not be read is saved with version 0.
		const unread = await builder({ one: vi.fn(() => throwError(() => new Error('gone'))) }, { id: 'rep1' });
		await unread.page.save();
		expect(unread.calls.update).toHaveBeenCalledWith('rep1', expect.objectContaining({ version: 0 }));

		const refused = await builder({ create: vi.fn(() => throwError(() => refusal('report_name_taken:November'))) });
		await refused.page.save();
		expect(refused.notifier.showError).toHaveBeenCalledWith('report_problem_report_name_taken');
		const failed = await builder({ create: vi.fn(() => throwError(() => new Error('down'))) });
		await failed.page.save();
		expect(failed.notifier.showError).toHaveBeenCalledWith('report_problem_failed');
		expect(failed.page.busy()).toBe(false);
	});
});

describe('downloading the whole report', () => {
	it('runs every row and saves a spreadsheet named after the report, or “report”', async () => {
		const { fixture, page, calls } = await builder();
		(el(fixture, '#report_excel') as HTMLButtonElement).click();
		await settle(fixture);
		const { from, to } = page.range();
		expect(calls.run).toHaveBeenLastCalledWith({ spec: page.spec(), from, to, preview: false });
		expect(vi.mocked(downloadCsv).mock.lastCall).toEqual([
			`report_${from}_${to}.csv`,
			['report_field_number', 'report_field_date', 'report_field_taxable'],
			[
				['INV/26-27/000001', '2026-11-02', 1_180],
				['INV/26-27/000002', null, -50],
				[null, null, 1_130],
			],
		]);
		page.name.set('Sales');
		await page.download();
		expect(vi.mocked(downloadCsv).mock.lastCall?.[0]).toBe(`Sales_${from}_${to}.csv`);
	});

	it('names the refusal when the report cannot run', async () => {
		const run = vi
			.fn()
			.mockReturnValueOnce(of(TABLE))
			.mockReturnValue(throwError(() => refusal('report_too_many_rows:5000')));
		const { page, notifier } = await builder({ run });
		await page.download();
		expect(notifier.showError).toHaveBeenCalledWith('report_problem_report_too_many_rows');
		expect(page.busy()).toBe(false);
	});
});
