import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';

import { GST_REPORTS, GstReportsPage, forYou } from './gst-reports-page';

/** GST reports (accounts brief G7): every report, what it is, and whether it is for this GSTIN. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const terms = (kind: string, scheme: string, from = '2017-07-01') => ({ from, kind, scheme });
const REGISTRATIONS = [
	{ id: 'r0', gstin: '27AAAAA0000A1Z5', active: false, terms: [terms('regular', 'monthly')] },
	// A change booked for a day still to come doesn't count yet.
	{
		id: 'r1',
		gstin: '19ABCDE1234F1Z5',
		terms: [terms('regular', 'monthly'), terms('regular', 'qrmp', '2999-04-01')],
	},
	{ id: 'r2', gstin: '19QRMPX1234F1Z5', terms: [terms('regular', 'qrmp')] },
	{ id: 'r3', gstin: '19LATER1234F1Z5', terms: [terms('regular', 'monthly', '2999-04-01')] },
];

function mount(registrations: unknown[] = REGISTRATIONS) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			GstReportsPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			provideRouter([]),
			{ provide: CompanyGateway, useValue: { registrations: vi.fn(() => of(registrations)) } },
		],
	});
	const fixture = TestBed.createComponent(GstReportsPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

const cells = (fixture: { nativeElement: HTMLElement }) =>
	([...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[]).map(
		(row) => [...row.querySelectorAll('td')] as HTMLElement[],
	);

describe('who a GST report is for', () => {
	it('lists the fifteen reports in the drawn order, each named by its form or in words', () => {
		expect(GST_REPORTS).toHaveLength(15);
		expect(GST_REPORTS.map((r) => r.key)).toEqual([
			'gstr1',
			'gstr1a',
			'gstr2a',
			'gstr2b',
			'ims',
			'gstr3b',
			'pmt06',
			'cmp08',
			'gstr6',
			'gstr7',
			'gstr9',
			'itc04',
			'edocs',
			'ledgers',
			'books',
		]);
		expect(GST_REPORTS.filter((r) => r.name === null).map((r) => r.key)).toEqual([
			'gstr7',
			'edocs',
			'ledgers',
			'books',
		]);
	});

	it('words each report’s cadence for the GSTIN’s terms, or says it is not for you', () => {
		const monthly = terms('regular', 'monthly');
		const qrmp = terms('regular', 'qrmp');
		const composition = terms('composition', 'monthly');
		const isd = terms('isd', 'monthly');
		const of = (forWhom: string, t: unknown) => forYou({ forWhom } as never, t as never);
		expect([of('qrmp', qrmp), of('qrmp', monthly), of('qrmp', null)]).toEqual([
			'gst_report_for_monthly',
			'gst_report_for_not_you',
			'gst_report_for_not_you',
		]);
		expect([of('composition', composition), of('composition', monthly), of('composition', null)]).toEqual([
			'gst_report_for_composition',
			'gst_report_for_not_you',
			'gst_report_for_not_you',
		]);
		expect([of('isd', isd), of('isd', monthly), of('isd', null)]).toEqual([
			'gst_report_for_monthly',
			'gst_report_for_not_you',
			'gst_report_for_not_you',
		]);
		expect([of('monthly', qrmp), of('monthly', monthly), of('monthly', null)]).toEqual([
			'gst_report_for_quarterly',
			'gst_report_for_monthly',
			'gst_report_for_monthly',
		]);
		expect(['when_needed', 'view', 'if_any', 'yearly', 'job_work', 'any_time'].map((w) => of(w, monthly))).toEqual([
			'gst_report_for_when_needed',
			'gst_report_for_view',
			'gst_report_for_if_any',
			'gst_report_for_yearly',
			'gst_report_for_job_work',
			'gst_report_for_any_time',
		]);
	});
});

describe('the GST reports page (G7)', () => {
	it('reads the first active GSTIN’s terms today, and links each report that has a page here', async () => {
		const { fixture, page } = mount();
		expect(page.terms()).toBeNull();
		await settle(fixture);
		expect(page.registrationId()).toBe('r1');
		expect(page.terms()).toEqual(terms('regular', 'monthly'));
		const rows = cells(fixture);
		expect(rows).toHaveLength(15);
		const gstr1 = rows[0]?.[0]?.querySelector('a');
		expect([gstr1?.textContent?.trim(), gstr1?.getAttribute('href')]).toEqual([
			'GSTR-1 / IFF',
			'/accounts/gst/returns',
		]);
		expect(rows[0]?.[1]?.textContent).toContain('gst_report_gstr1_what');
		expect(rows[0]?.[2]?.textContent?.trim()).toBe('gst_report_for_monthly');
		const ledgers = rows[13]?.[0]?.querySelector('a');
		expect([ledgers?.textContent?.trim(), ledgers?.getAttribute('href')]).toEqual([
			'gst_report_ledgers',
			'/accounts/ledgers',
		]);
		expect(rows[9]?.[0]?.querySelector('a')).toBeNull();
		expect(rows[9]?.[0]?.textContent).toContain('gst_report_gstr7');
		expect(rows[9]?.[0]?.textContent).toContain('gst_report_on_portal');
		expect(rows[6]?.[0]?.textContent).toContain('PMT-06');
		expect(rows[6]?.[2]?.textContent?.trim()).toBe('gst_report_for_not_you');
	});

	it('follows the GSTIN picked: a quarterly filer’s reports read quarterly, and PMT-06 is theirs', async () => {
		const { fixture, page } = mount();
		await settle(fixture);
		const select = fixture.nativeElement.querySelector('#gst_reports_registration') as HTMLSelectElement;
		expect([...select.options].map((o) => o.value)).toEqual(['r1', 'r2', 'r3']);
		select.value = 'r2';
		select.dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(page.forYou(GST_REPORTS[0] as never)).toBe('gst_report_for_quarterly');
		expect(cells(fixture)[6]?.[2]?.textContent?.trim()).toBe('gst_report_for_monthly');
		page.registrationId.set('r3');
		expect(page.terms()).toBeNull();
	});

	it('reads no terms when the company has no GSTIN', async () => {
		const { fixture, page } = mount([]);
		await settle(fixture);
		expect([page.registrationId(), page.terms()]).toEqual(['', null]);
		expect(page.forYou(GST_REPORTS[6] as never)).toBe('gst_report_for_not_you');
	});
});
