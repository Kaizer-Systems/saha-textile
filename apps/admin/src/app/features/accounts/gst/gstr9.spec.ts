import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Gstr9Page, figure, monthAgrees, pastYears, yearOf } from './gstr9-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: vi.fn(),
}));

/** GSTR-9 against the books (accounts brief G9) and each month's returns against the books (G7). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const ROWS = [
	{ table: '4', returns: 12_500_000, books: 12_500_000, unit: 'paise', note: '' },
	{
		table: '5',
		returns: 300_000,
		books: 250_000,
		unit: 'paise',
		note: 'Export bill dated 31 March, posted in April',
	},
	{ table: '6', returns: 900_000, books: 950_000, unit: 'paise', note: '' },
	{ table: '7', returns: 40_000, books: 40_000, unit: 'paise', note: 'Reversed and reclaimed in the same year' },
	{ table: '17', returns: 14, books: 15, unit: 'count', note: '' },
];
const MONTHS = [
	{
		month: '2025-04',
		gstr1Tax: 1_000_000,
		gstr3bTax: 1_000_050,
		booksTax: 1_000_000,
		gstr3bCredit: 400_000,
		booksCredit: 400_100,
	},
	{ month: '2025-05', gstr1Tax: null, gstr3bTax: null, booksTax: 800_000, gstr3bCredit: null, booksCredit: 300_000 },
	{
		month: '2025-06',
		gstr1Tax: 700_000,
		gstr3bTax: 690_000,
		booksTax: 700_000,
		gstr3bCredit: 200_000,
		booksCredit: 200_000,
	},
];
const ANNUAL = { gstin: '19ABCDE1234F1Z5', year: '2024-25', rows: ROWS, months: MONTHS, version: 6 };
const REGISTRATIONS = [
	{ id: 'r0', gstin: '27AAAAA0000A1Z5', active: false },
	{ id: 'r1', gstin: '19ABCDE1234F1Z5' },
];

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(
	gst: Record<string, unknown>,
	options: { year?: string; permissions?: string[]; registrations?: unknown[] } = {},
) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.gst-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	TestBed.configureTestingModule({
		imports: [
			Gstr9Page,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: GstReturnsGateway, useValue: gst },
			{
				provide: CompanyGateway,
				useValue: { registrations: vi.fn(() => of(options.registrations ?? REGISTRATIONS)) },
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.edit']) },
			},
			{
				provide: ActivatedRoute,
				useValue: { queryParamMap: of(convertToParamMap(options.year ? { year: options.year } : {})) },
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
						holder.className = 'gst-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(Gstr9Page);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const table = (fixture: { nativeElement: HTMLElement }, index: number) =>
	([...fixture.nativeElement.querySelectorAll('tbody')][index]?.querySelectorAll('tr') ??
		[]) as NodeListOf<HTMLElement>;
const tds = (row: HTMLElement | undefined) => [...(row?.querySelectorAll('td') ?? [])] as HTMLElement[];
const modal = (selector: string) => document.querySelector(`.gst-test-modal ${selector}`) as HTMLElement | null;

describe('the year and the figures', () => {
	it('puts a day in its financial year: April onwards starts it, January to March ends it', () => {
		expect(yearOf('2026-04-01')).toBe('2026-27');
		expect(yearOf('2026-11-24')).toBe('2026-27');
		expect(yearOf('2027-03-31')).toBe('2026-27');
		expect(yearOf('2026-01-15')).toBe('2025-26');
		expect(yearOf('2000-02-01')).toBe('1999-00');
	});

	it('offers the three years before this one', () => {
		expect(pastYears('2026-11-24')).toEqual(['2025-26', '2024-25', '2023-24']);
		expect(pastYears('2026-02-10')).toEqual(['2024-25', '2023-24', '2022-23']);
	});

	it('shows a count as it is and an amount in rupees', () => {
		expect(figure({ unit: 'count' }, 14)).toBe('14');
		expect(figure({ unit: 'paise' }, 123_456)).toBe('₹1,234.56');
		expect(figure({ unit: 'paise' }, -100_000)).toBe('−₹1,000.00');
		expect(figure({ unit: 'count' }, -1)).toBe('-1');
	});

	it('takes a month as agreeing when every filed figure is within ₹1 of the books, ignoring returns not filed', () => {
		const month = {
			month: '2025-04',
			gstr1Tax: 1_000,
			gstr3bTax: 1_000,
			booksTax: 1_000,
			gstr3bCredit: 500,
			booksCredit: 500,
		};
		expect(monthAgrees(month)).toBe(true);
		expect(monthAgrees({ ...month, gstr1Tax: null, gstr3bTax: null, gstr3bCredit: null })).toBe(true);
		expect(monthAgrees({ ...month, gstr1Tax: 1_100 })).toBe(true);
		expect(monthAgrees({ ...month, gstr1Tax: 1_101 })).toBe(false);
		expect(monthAgrees({ ...month, gstr3bTax: 899 })).toBe(false);
		expect(monthAgrees({ ...month, gstr3bCredit: 700 })).toBe(false);
	});
});

describe('the GSTR-9 page (G9)', () => {
	it('opens last year for the first active GSTIN when no year is asked for', async () => {
		const annual = vi.fn(() => of(ANNUAL));
		const { fixture, page } = mount({ annual });
		await settle(fixture);
		expect(page.years).toEqual(pastYears(istToday()));
		expect(page.year()).toBe(page.years[0]);
		expect(page.registrationId()).toBe('r1');
		expect(annual).toHaveBeenCalledWith({ gstRegistrationId: 'r1', year: page.years[0] });
		const year = el(fixture, '#gstr9_year') as HTMLSelectElement;
		year.value = page.years[2] as string;
		year.dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(annual).toHaveBeenLastCalledWith({ gstRegistrationId: 'r1', year: page.years[2] });
	});

	it('opens the year the calendar asked for, and reads nothing without a GSTIN', async () => {
		const annual = vi.fn(() => of(ANNUAL));
		const asked = mount({ annual }, { year: '2024-25' });
		await settle(asked.fixture);
		expect(asked.page.year()).toBe('2024-25');
		expect(annual).toHaveBeenCalledWith({ gstRegistrationId: 'r1', year: '2024-25' });
		expect(el(asked.fixture, 'h5.mb-1')?.textContent).toContain('GSTR-9 · 2024-25');

		const none = vi.fn(() => of(ANNUAL));
		const empty = mount({ annual: none }, { registrations: [] });
		await settle(empty.fixture);
		expect(empty.page.registrationId()).toBe('');
		expect(none).not.toHaveBeenCalled();
		expect(el(empty.fixture, '#gstr9_download')).toBeNull();
	});

	it('shows each table beside the books, its difference and whether it is explained', async () => {
		const { fixture } = mount({ annual: vi.fn(() => of(ANNUAL)) }, { year: '2024-25' });
		await settle(fixture);
		expect(el(fixture, 'small')?.textContent).toContain('19ABCDE1234F1Z5');
		const rows = table(fixture, 0);
		expect(rows).toHaveLength(5);
		const explained = (i: number) => tds(rows[i])[4] as HTMLElement;
		expect(explained(0).textContent).toContain('✓');
		expect(explained(1).textContent).toContain('Export bill dated 31 March');
		expect(explained(1).querySelector('.text-danger')).toBeNull();
		expect(explained(2).textContent).toContain('gstr9_not_explained');
		expect(explained(2).querySelector('.text-danger')).not.toBeNull();
		expect(explained(3).textContent).toContain('Reversed and reclaimed');
		expect(explained(3).textContent).not.toContain('✓');
		expect(
			tds(rows[1])
				.slice(1, 4)
				.map((td) => td.textContent?.trim()),
		).toEqual(['₹3,000.00', '₹2,500.00', '₹500.00']);
		expect(
			tds(rows[4])
				.slice(1, 4)
				.map((td) => td.textContent?.trim()),
		).toEqual(['14', '15', '—']);
		// Books above the returns: the difference keeps its minus sign.
		expect(tds(rows[2])[3]?.textContent?.trim()).toBe('−₹500.00');
		expect(fixture.nativeElement.querySelectorAll('button[title="gstr9_explain"]')).toHaveLength(5);
	});

	it('checks each month’s returns against the books, with a dash for a return not filed', async () => {
		const { fixture } = mount({ annual: vi.fn(() => of(ANNUAL)) }, { year: '2024-25' });
		await settle(fixture);
		const months = table(fixture, 1);
		expect(months).toHaveLength(3);
		expect(tds(months[0])[6]?.textContent?.trim()).toBe('✓');
		expect(tds(months[0])[6]?.classList.contains('text-danger')).toBe(false);
		expect(tds(months[1]).map((td) => td.textContent?.trim())).toEqual([
			'2025-05',
			'—',
			'₹8,000.00',
			'—',
			'—',
			'₹3,000.00',
			'✓',
		]);
		expect(tds(months[2])[6]?.textContent?.trim()).toBe('gstr9_differs');
		expect(tds(months[2])[6]?.classList.contains('text-danger')).toBe(true);
	});

	it('says when the year cannot be read', async () => {
		const { fixture } = mount({ annual: vi.fn(() => throwError(() => new Error('down'))) }, { year: '2024-25' });
		await settle(fixture);
		expect(el(fixture, '.alert-warning')?.textContent).toContain('gstr9_problem');
		expect(fixture.nativeElement.querySelectorAll('tbody')).toHaveLength(0);
	});

	it('lets only someone who may edit explain a difference', async () => {
		const { fixture } = mount(
			{ annual: vi.fn(() => of(ANNUAL)) },
			{ year: '2024-25', permissions: ['accounts.index'] },
		);
		await settle(fixture);
		expect(fixture.nativeElement.querySelectorAll('button[title="gstr9_explain"]')).toHaveLength(0);
	});
});

describe('explaining a difference (G9 “Explained”)', () => {
	it('opens the note for the row, saves it with the year’s version and closes', async () => {
		const annualNote = vi.fn(() => of(ANNUAL));
		const { fixture, page, opened, notifier, invalidate } = mount(
			{ annual: vi.fn(() => of(ANNUAL)), annualNote },
			{ year: '2024-25' },
		);
		await settle(fixture);
		(fixture.nativeElement.querySelectorAll('button[title="gstr9_explain"]')[1] as HTMLButtonElement).click();
		expect([page.noteTable(), page.noteText()]).toEqual(['5', 'Export bill dated 31 March, posted in April']);
		const popup = opened[0] as Opened;
		expect(modal('.modal-title')?.textContent).toContain('gstr9_table_5');
		(fixture.nativeElement.querySelectorAll('button[title="gstr9_explain"]')[2] as HTMLButtonElement).click();
		const note = opened[1] as Opened;
		expect([page.noteTable(), page.noteText()]).toEqual(['6', '']);
		const box = document
			.querySelectorAll('.gst-test-modal')[1]
			?.querySelector('#gstr9_note') as HTMLTextAreaElement;
		box.value = 'Credit note from Nadia Weavers came in May';
		box.dispatchEvent(new Event('input'));
		(
			document.querySelectorAll('.gst-test-modal')[1]?.querySelector('#gstr9_note_save') as HTMLButtonElement
		).click();
		await settle(fixture);
		expect(annualNote).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			year: '2024-25',
			table: '6',
			note: 'Credit note from Nadia Weavers came in May',
			version: 6,
		});
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gst-returns'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('gstr9_note_saved');
		expect(note.close).toHaveBeenCalled();
		expect(popup.close).not.toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
		expect(page.busy()).toBe(false);
	});

	it('keeps the note open with the reason when refused, and saves with none open', async () => {
		const annualNote = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('gst_annual_changed')))
			.mockReturnValueOnce(of(ANNUAL));
		const { fixture, page, opened, notifier } = mount(
			{ annual: vi.fn(() => of(ANNUAL)), annualNote },
			{ year: '2024-25' },
		);
		await settle(fixture);
		(fixture.nativeElement.querySelector('button[title="gstr9_explain"]') as HTMLButtonElement).click();
		await page.saveNote(ANNUAL as never);
		expect(notifier.showError).toHaveBeenCalledWith('gst_problem_annual_changed');
		expect(opened[0]?.close).not.toHaveBeenCalled();

		const fresh = mount(
			{ annual: vi.fn(() => of(ANNUAL)), annualNote: vi.fn(() => of(ANNUAL)) },
			{ year: '2024-25' },
		);
		await settle(fresh.fixture);
		await fresh.page.saveNote(ANNUAL as never);
		expect(fresh.notifier.showSuccess).toHaveBeenCalledWith('gstr9_note_saved');
	});
});

describe('the year as a spreadsheet', () => {
	it('downloads the tables in rupees, counts as they are, and each month with returns not filed left empty', async () => {
		const { fixture } = mount({ annual: vi.fn(() => of(ANNUAL)) }, { year: '2024-25' });
		await settle(fixture);
		(el(fixture, '#gstr9_download') as HTMLButtonElement).click();
		const [name, header, rows] = vi.mocked(downloadCsv).mock.lastCall as [string, string[], unknown[][]];
		expect(name).toBe('GSTR9_19ABCDE1234F1Z5_2024-25.csv');
		expect(header).toEqual([
			'gst_col_table',
			'gstr9_col_returns',
			'gstr9_col_books',
			'gstr9_col_difference',
			'gstr9_col_explained',
		]);
		expect(rows[1]).toEqual(['gstr9_table_5', 3_000, 2_500, 500, 'Export bill dated 31 March, posted in April']);
		expect(rows[4]).toEqual(['gstr9_table_17', 14, 15, -1, '']);
		expect(rows[5]).toEqual([]);
		expect(rows[6]).toEqual([
			'gstr9_col_month',
			'gstr9_col_gstr1',
			'gstr9_col_books_tax',
			'gstr9_col_gstr3b',
			'gstr9_col_3b_credit',
			'gstr9_col_books_credit',
		]);
		expect(rows[7]).toEqual(['2025-04', 10_000, 10_000, 10_000.5, 4_000, 4_001]);
		expect(rows[8]).toEqual(['2025-05', null, 8_000, null, null, 3_000]);
		expect(rows).toHaveLength(10);
	});
});
