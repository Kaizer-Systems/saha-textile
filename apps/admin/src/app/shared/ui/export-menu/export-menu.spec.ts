import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import { ExportMenu, captured, exportColumns, exportRequest, type ExportSource } from './export-menu';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** Export ▾ (brief 25 EX1): CSV, Excel or PDF of what a screen shows, written by the API. */

const SOURCE: ExportSource = {
	fileName: 'Trial Balance_2026-11-25.csv',
	title: 'Trial balance as at 25 Nov 2026',
	header: ['Ledger', 'Debit', 'Credit', 'Lines', 'Posted on', 'Note', 'Empty'],
	rows: [
		['Cash', 1_500, null, 3, '2026-11-01', 'counter', null],
		['Sales', null, 2_000.5, 12, '2026-11-02', '', null],
	],
};

describe('a screen’s columns for export', () => {
	it('takes a given kind, finds money under a money heading, numbers, dates and text, and empty columns as text', () => {
		expect(exportColumns(SOURCE)).toEqual([
			{ key: 'c0', label: 'Ledger', kind: 'text' },
			{ key: 'c1', label: 'Debit', kind: 'money' },
			{ key: 'c2', label: 'Credit', kind: 'money' },
			{ key: 'c3', label: 'Lines', kind: 'number' },
			{ key: 'c4', label: 'Posted on', kind: 'date' },
			{ key: 'c5', label: 'Note', kind: 'text' },
			{ key: 'c6', label: 'Empty', kind: 'text' },
		]);
		expect(
			exportColumns({ ...SOURCE, kinds: { 3: 'money', 0: 'text' } })
				.map((c) => c.kind)
				.slice(0, 4),
		).toEqual(['text', 'money', 'money', 'money']);
		expect(
			exportColumns({
				...SOURCE,
				header: ['Mixed', 'Dated'],
				rows: [
					[1, '2026-11-01'],
					['two', '1 Nov'],
				],
			}).map((c) => c.kind),
		).toEqual(['text', 'text']);
	});
});

describe('the export request', () => {
	it('cleans the file name, drops a .csv on it, keys each row’s cells, and carries the filters and area', () => {
		const request = exportRequest(
			{ ...SOURCE, filters: [{ label: 'Location', value: 'Barasat' }], area: 'accounts' },
			'xlsx',
		);
		expect(request).toMatchObject({
			format: 'xlsx',
			title: 'Trial balance as at 25 Nov 2026',
			fileName: 'trial-balance-2026-11-25',
			filters: [{ label: 'Location', value: 'Barasat' }],
			area: 'accounts',
		});
		expect(request.rows[0]).toEqual({
			c0: 'Cash',
			c1: 1_500,
			c2: null,
			c3: 3,
			c4: '2026-11-01',
			c5: 'counter',
			c6: null,
		});
	});

	it('falls back to “export” for a name with nothing usable, keeps at most 80 letters, and starts with no filters', () => {
		const plain = exportRequest({ ...SOURCE, fileName: '—.csv', rows: [['only one']] }, 'pdf');
		expect([plain.fileName, plain.filters, plain.area]).toEqual(['export', [], 'other']);
		expect(plain.rows[0]).toEqual({ c0: 'only one', c1: null, c2: null, c3: null, c4: null, c5: null, c6: null });
		expect(exportRequest({ ...SOURCE, fileName: 'a'.repeat(120) }, 'csv').fileName).toHaveLength(80);
	});
});

describe('a screen’s CSV code read as an export', () => {
	it('keeps what the CSV writer was given, or nothing when the code wrote nothing', () => {
		expect(
			captured('Ageing', 'accounts', (save) => save('ageing.csv', ['Party', 'Due'], [['Nadia Weavers', 500]])),
		).toEqual({
			fileName: 'ageing.csv',
			title: 'Ageing',
			header: ['Party', 'Due'],
			rows: [['Nadia Weavers', 500]],
			area: 'accounts',
		});
		expect(captured('Nothing', 'other', () => undefined)).toBeNull();
	});
});

function mount(source: () => ExportSource | null | Promise<ExportSource | null>, inputs: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	vi.mocked(saveBlob).mockClear();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.configureTestingModule({
		imports: [
			ExportMenu,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideHttpClient(),
			provideHttpClientTesting(),
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(ExportMenu);
	fixture.componentRef.setInput('source', source);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { fixture, menu: fixture.componentInstance, notifier, http: TestBed.inject(HttpTestingController) };
}

const exportsUrl = `${runtimeConfig.apiUrl}/admin/exports`;

describe('the Export menu', () => {
	it('offers CSV, Excel and PDF under its own id, and the formats a screen asks for', () => {
		const { fixture } = mount(() => SOURCE);
		const toggle = fixture.nativeElement.querySelector('#export_menu') as HTMLButtonElement;
		expect([toggle.textContent?.trim(), toggle.disabled]).toEqual(['export_menu', false]);
		expect(
			[...fixture.nativeElement.querySelectorAll('[ngbDropdownItem]')].map((b) => [
				(b as HTMLElement).id,
				b.textContent?.trim(),
			]),
		).toEqual([
			['export_menu_csv', 'export_as_csv'],
			['export_menu_xlsx', 'export_as_xlsx'],
			['export_menu_pdf', 'export_as_pdf'],
		]);
		const statement = mount(() => SOURCE, { id: 'tb_export', formats: ['csv', 'xlsx'], disabled: true });
		expect((statement.fixture.nativeElement.querySelector('#tb_export') as HTMLButtonElement).disabled).toBe(true);
		expect(statement.fixture.nativeElement.querySelectorAll('[ngbDropdownItem]')).toHaveLength(2);
	});

	it('asks the API for the file in the format picked and saves it under the cleaned name', async () => {
		const { fixture, menu, http } = mount(async () => SOURCE);
		(fixture.nativeElement.querySelector('#export_menu_xlsx') as HTMLButtonElement).click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(menu.busy()).toBe(true);
		const request = http.expectOne((req) => req.method === 'POST' && req.url === exportsUrl);
		expect(request.request.responseType).toBe('blob');
		expect(request.request.body).toEqual(exportRequest(SOURCE, 'xlsx'));
		const file = new Blob(['xlsx']);
		request.flush(file);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(saveBlob).toHaveBeenCalledWith('trial-balance-2026-11-25.xlsx', file);
		expect(menu.busy()).toBe(false);
		http.verify();
	});

	it('asks for nothing when the screen has nothing to export yet', async () => {
		const { menu, http } = mount(() => null);
		await menu.run('csv');
		http.expectNone(exportsUrl);
		expect([vi.mocked(saveBlob).mock.calls.length, menu.busy()]).toEqual([0, false]);
	});

	it('names a refusal and says when the export simply failed', async () => {
		const { menu, http, notifier } = mount(() => SOURCE);
		const refused = menu.run('pdf');
		await new Promise((resolve) => setTimeout(resolve, 0));
		http.expectOne(exportsUrl).flush(new Blob(), { status: 400, statusText: 'Bad Request' });
		await refused;
		expect(notifier.showError).toHaveBeenLastCalledWith('export_problem_failed');
		const thrown = mount(() => {
			throw { error: { message: 'export_too_many_rows' } };
		});
		await thrown.menu.run('csv');
		expect(thrown.notifier.showError).toHaveBeenLastCalledWith('export_problem_export_too_many_rows');
		expect(thrown.menu.busy()).toBe(false);
	});
});
