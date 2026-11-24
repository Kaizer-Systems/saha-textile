import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BooksImportGateway } from '@core/accounts/books-import.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import { BooksExportPage, EXPORT_FORMATS, yearToDate } from './books-export-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** Export the books (accounts brief W4). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

function mount(exportFile: ReturnType<typeof vi.fn>) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.configureTestingModule({
		imports: [
			BooksExportPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: BooksImportGateway, useValue: { export: exportFile } },
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(BooksExportPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const enter = (control: HTMLElement | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const refusal = (code: string) => ({ error: { message: code } });

describe('this year so far', () => {
	it('runs from 1 April of the year in India to today', () => {
		expect([...EXPORT_FORMATS]).toEqual(['tally_xml', 'trial_balance_csv', 'ledger_lines_csv', 'edit_log_csv']);
		expect(yearToDate(new Date('2026-11-24T06:00:00.000Z'))).toEqual({ from: '2026-04-01', to: '2026-11-24' });
		expect(yearToDate(new Date('2027-02-10T06:00:00.000Z'))).toEqual({ from: '2026-04-01', to: '2027-02-10' });
		expect(yearToDate(new Date('2027-03-31T19:00:00.000Z'))).toEqual({ from: '2027-04-01', to: '2027-04-01' });
		expect(yearToDate().from).toMatch(/^\d{4}-04-01$/);
	});
});

describe('exporting the books (W4)', () => {
	it('makes a Tally file for the year so far, at every location, and saves it as XML', async () => {
		const exportFile = vi.fn(() => of({ fileName: 'books.xml', text: '<ENVELOPE/>' }));
		const { fixture, page, notifier } = mount(exportFile);
		await settle(fixture);
		(el(fixture, '#export_make') as HTMLButtonElement).click();
		await settle(fixture);
		expect(exportFile).toHaveBeenCalledWith({ format: 'tally_xml', ...yearToDate() });
		const [name, blob] = vi.mocked(saveBlob).mock.lastCall as [string, Blob];
		expect([name, blob.type]).toEqual(['books.xml', 'application/xml;charset=utf-8']);
		expect(await blob.text()).toBe('<ENVELOPE/>');
		expect(notifier.showSuccess).toHaveBeenCalledWith('export_made');
		expect(page.busy()).toBe(false);
	});

	it('makes another format for the days and location picked, saved as CSV', async () => {
		const exportFile = vi.fn(() => of({ fileName: 'trial-balance.csv', text: 'Ledger,Dr,Cr' }));
		const { fixture } = mount(exportFile);
		await settle(fixture);
		(el(fixture, '#exp_trial_balance_csv') as HTMLInputElement).dispatchEvent(new Event('change'));
		enter(el(fixture, '#exp_from'), '2026-10-01');
		enter(el(fixture, '#exp_to'), '2026-10-31');
		enter(el(fixture, '#exp_loc'), 'l1');
		(el(fixture, '#export_make') as HTMLButtonElement).click();
		await settle(fixture);
		expect(exportFile).toHaveBeenCalledWith({
			format: 'trial_balance_csv',
			from: '2026-10-01',
			to: '2026-10-31',
			locationId: 'l1',
		});
		expect((vi.mocked(saveBlob).mock.lastCall?.[1] as Blob).type).toBe('text/csv;charset=utf-8');
	});

	it('needs both days, and names a refusal', async () => {
		const exportFile = vi.fn(() => throwError(() => refusal('export_period_too_long')));
		const { fixture, page, notifier } = mount(exportFile);
		await settle(fixture);
		enter(el(fixture, '#exp_from'), '');
		fixture.detectChanges();
		expect((el(fixture, '#export_make') as HTMLButtonElement).disabled).toBe(true);
		await page.make();
		expect(notifier.showError).toHaveBeenCalledWith('import_problem_export_period_too_long');
		expect(page.busy()).toBe(false);
	});
});
