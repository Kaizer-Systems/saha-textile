import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GST_KEYS, GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker } from '@features/media/file-manager/fm-picker';

import { GST_CHIPS, GST_STATUS_PILL, GstReturnsPage, gstProblem, returnLink } from './gst-returns-page';
import { GST_STEPS, Gstr1Page, signedRupees, stepIcon } from './gstr1-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** GST returns from the books (accounts brief G3, G4, G8): the calendar and a GSTR-1. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.edit', 'accounts.post', 'accounts.lock'];

interface Opened {
	content: unknown;
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	componentInstance: { start: ReturnType<typeof vi.fn> };
	result: Promise<unknown>;
	view: EmbeddedViewRef<unknown> | null;
}

/** Mounts a page; a pop-up opened from one of its templates is drawn into the document so its buttons can be used. */
function mount<T>(
	component: Type<T>,
	gateways: { gst?: Record<string, unknown>; company?: Record<string, unknown>; ledger?: Record<string, unknown> },
	options: { permissions?: string[]; id?: string | null } = {},
) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.gst-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	let picked: Promise<unknown> = Promise.resolve(null);
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: GstReturnsGateway, useValue: gateways.gst ?? {} },
			{ provide: CompanyGateway, useValue: gateways.company ?? { registrations: vi.fn(() => of([])) } },
			{ provide: LedgerGateway, useValue: gateways.ledger ?? {} },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ALL) } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id === null ? {} : { id: options.id ?? 'd1' })) },
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown) => {
						const ref: Opened = {
							content,
							close: vi.fn(),
							dismiss: vi.fn(),
							componentInstance: { start: vi.fn() },
							result: picked,
							view: null,
						};
						if (content instanceof TemplateRef) {
							const view = content.createEmbeddedView({ $implicit: ref });
							TestBed.inject(ApplicationRef).attachView(view);
							view.detectChanges();
							const holder = document.createElement('div');
							holder.className = 'gst-test-modal';
							holder.append(...(view.rootNodes as Node[]));
							document.body.append(holder);
							ref.view = view;
						}
						opened.push(ref);
						return ref;
					}),
				},
			},
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return {
		fixture,
		page: fixture.componentInstance,
		notifier,
		invalidate,
		navigate,
		opened,
		pickWith: (value: Promise<unknown>): void => {
			picked = value;
		},
	};
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const modal = (selector: string) => document.querySelector(`.gst-test-modal ${selector}`) as HTMLElement | null;

describe('the GST returns gateway', () => {
	it('names its query keys and calls each route', () => {
		const query = { gstRegistrationId: 'r1', chip: 'filed' } as const;
		expect(GST_KEYS.all).toEqual(['gst-returns']);
		expect(GST_KEYS.calendar(query)).toEqual(['gst-returns', 'calendar', query]);
		expect(GST_KEYS.one('d1')).toEqual(['gst-returns', 'one', 'd1']);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(GstReturnsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/gst/returns`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.calendar(query), 'GET', '/calendar?gstRegistrationId=r1&chip=filed'],
			[() => gateway.prepare({} as never), 'POST', ''],
			[() => gateway.one('d/1'), 'GET', '/d%2F1'],
			[() => gateway.step('d/1', {} as never), 'POST', '/d%2F1/step'],
			[() => gateway.postSetOff('d/1', {} as never), 'POST', '/d%2F1/set-off'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});

	it('names the GSTR-2B key and calls the GSTR-2B routes', () => {
		const query = { gstRegistrationId: 'r1', month: '2026-10', chip: 'note' } as const;
		expect(GST_KEYS.twoB(query)).toEqual(['gst-returns', '2b', query]);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(GstReturnsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/gst/2b`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.twoB(query), 'GET', '?gstRegistrationId=r1&month=2026-10&chip=note'],
			[() => gateway.import2b({} as never), 'POST', ''],
			[() => gateway.decide2b({} as never), 'POST', '/decisions'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});
});

describe('the GSTR-9 gateway', () => {
	it('names the annual key and calls the annual routes', () => {
		const query = { gstRegistrationId: 'r1', year: '2025-26' };
		expect(GST_KEYS.annual(query)).toEqual(['gst-returns', 'annual', query]);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(GstReturnsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/gst/annual`;
		gateway.annual(query).subscribe();
		http.expectOne(
			(req) => req.method === 'GET' && req.urlWithParams === `${api}?gstRegistrationId=r1&year=2025-26`,
		).flush({});
		gateway.annualNote({} as never).subscribe();
		http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/notes`).flush({});
		http.verify();
	});
});

describe('a GST refusal in words', () => {
	it('gives each known refusal its own words, without the gst_ start, and any other the general words', () => {
		expect(gstProblem(refusal('gst_return_approver_only'))).toBe('gst_problem_return_approver_only');
		expect(gstProblem(refusal('gst_due_dates_not_installed'))).toBe('gst_problem_due_dates_not_installed');
		expect(gstProblem(refusal('arn_shape'))).toBe('gst_problem_arn_shape');
		expect(gstProblem(refusal('gst_something_new'))).toBe('gst_problem_failed');
		expect(gstProblem(new Error('down'))).toBe('gst_problem_failed');
		expect([...GST_CHIPS]).toEqual(['due', 'filed', 'all']);
		expect(GST_STATUS_PILL.filed).toBe('status-success');
	});

	it('knows the GSTR-3B and GSTR-2B refusals, and a GSTR-2B refusal keeps its own start', () => {
		expect(gstProblem(refusal('gst_gstr1_not_filed'))).toBe('gst_problem_gstr1_not_filed');
		expect(gstProblem(refusal('gst_return_qrmp_later'))).toBe('gst_problem_return_qrmp_later');
		const twoB = [
			'gstr2b_file_unreadable',
			'gstr2b_line_unreadable',
			'gstr2b_other_gstin',
			'gstr2b_month_filed',
			'gstr2b_not_imported',
			'gstr2b_line_unknown',
			'gstr2b_changed',
		];
		expect(twoB.map((code) => gstProblem(refusal(code)))).toEqual(twoB.map((code) => `gst_problem_${code}`));
	});

	it('knows the set-off refusals', () => {
		const setOff = [
			['gst_set_off_not_3b', 'gst_problem_set_off_not_3b'],
			['gst_set_off_not_approved', 'gst_problem_set_off_not_approved'],
			['gst_set_off_posted', 'gst_problem_set_off_posted'],
			['gst_set_off_nothing', 'gst_problem_set_off_nothing'],
			['bank_account_unknown', 'gst_problem_bank_account_unknown'],
			['books_need_a_location', 'gst_problem_books_need_a_location'],
			['challan_shape', 'gst_problem_challan_shape'],
			['gst_annual_changed', 'gst_problem_annual_changed'],
		];
		expect(setOff.map(([code]) => gstProblem(refusal(code as string)))).toEqual(setOff.map(([, key]) => key));
	});

	it('opens a GSTR-3B on its own page and every other return on the tables page', () => {
		expect(returnLink('GSTR-3B', 'd3')).toEqual(['/accounts/gst/returns/3b', 'd3']);
		expect(returnLink('GSTR-1', 'd1')).toEqual(['/accounts/gst/returns', 'd1']);
		expect(returnLink('GSTR-9', 'd9')).toEqual(['/accounts/gst/returns', 'd9']);
	});
});

const REGISTRATIONS = [
	{ id: 'r0', gstin: '27AAAAA0000A1Z5', stateCode: '27', active: false },
	{ id: 'r1', gstin: '19ABCDE1234F1Z5', stateCode: '19', active: true },
	{ id: 'r2', gstin: '99ZZZZZ9999Z9Z9', stateCode: 'XX' },
];
const row = (over: Record<string, unknown> = {}) => ({
	returnType: 'GSTR-1',
	period: '2026-11',
	dueOn: '2026-12-11',
	status: 'not_started',
	arn: null,
	draftId: null,
	...over,
});
const CALENDAR = {
	gstin: '19ABCDE1234F1Z5',
	rows: [
		row({ period: '2026-10', status: 'filed', arn: 'AA1910260012345', draftId: 'd10', dueOn: '2026-11-11' }),
		row(),
		row({ returnType: 'GSTR-9', period: '2025-26', dueOn: '2026-12-31' }),
	],
	counts: { due: 2, filed: 1, all: 3 },
};
const company = { registrations: vi.fn(() => of(REGISTRATIONS)) };

describe('the GST returns calendar (G3)', () => {
	it('shows the first active GSTIN with its State, each return’s status and ARN, and the actions it allows', async () => {
		const calendar = vi.fn(() => of(CALENDAR));
		const { fixture, page } = mount(GstReturnsPage, { gst: { calendar }, company });
		expect(page.heading()).toBe('—');
		await settle(fixture);
		expect(page.registrationId()).toBe('r1');
		expect(page.heading()).toBe('19ABCDE1234F1Z5 · West Bengal');
		expect(page.active().map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(calendar).toHaveBeenCalledWith({ gstRegistrationId: 'r1', chip: 'due' });
		expect(page.calendarProblem()).toBeNull();
		const rows = [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
		expect(rows).toHaveLength(3);
		expect(rows[0]?.textContent).toContain('AA1910260012345');
		expect(rows[0]?.querySelector('.status-success')).not.toBeNull();
		expect(rows[1]?.textContent).toContain('—');
		expect(rows[0]?.querySelector('button[title="view"]')).not.toBeNull();
		expect(rows[1]?.querySelector('button[title="gst_prepare"]')).not.toBeNull();
		// GSTR-9 opens the year against the books; it is never prepared here.
		expect(rows[2]?.querySelector('button[title="view"]')).not.toBeNull();
		expect(rows[2]?.querySelector('button[title="gst_prepare"]')).toBeNull();
		expect(rows[2]?.textContent).toContain('GSTR-9');
		expect(el(fixture, '#gst_chip_filed')?.textContent).toContain('1');
		expect(page.day('2026-12-11')).toBeTruthy();
	});

	it('reads another GSTIN or chip when picked, and keeps the GSTIN picked', async () => {
		const calendar = vi.fn(() => of(CALENDAR));
		const { fixture, page } = mount(GstReturnsPage, { gst: { calendar }, company });
		await settle(fixture);
		const select = el(fixture, '#gst_registration') as HTMLSelectElement;
		select.value = 'r2';
		select.dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(page.registrationId()).toBe('r2');
		expect(page.heading()).toBe('99ZZZZZ9999Z9Z9');
		(el(fixture, '#gst_chip_all') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calendar).toHaveBeenLastCalledWith({ gstRegistrationId: 'r2', chip: 'all' });
	});

	it('opens a return’s draft, prepares a GSTR-1 or GSTR-3B not started, and opens GSTR-9’s year', async () => {
		const prepare = vi
			.fn()
			.mockReturnValueOnce(of({ id: 'd11' }))
			.mockReturnValueOnce(throwError(() => refusal('gst_return_filed')))
			.mockReturnValueOnce(of({ id: 'd3b' }));
		const { fixture, page, navigate, notifier } = mount(GstReturnsPage, {
			gst: { calendar: vi.fn(() => of(CALENDAR)), prepare },
			company,
		});
		await settle(fixture);
		(el(fixture, 'button[title="view"]') as HTMLButtonElement).click();
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/gst/returns', 'd10']);
		await page.open(CALENDAR.rows[2] as never);
		expect(prepare).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/gst/annual'], { queryParams: { year: '2025-26' } });
		(el(fixture, 'button[title="gst_prepare"]') as HTMLButtonElement).click();
		await settle(fixture);
		expect(prepare).toHaveBeenCalledWith({ gstRegistrationId: 'r1', returnType: 'GSTR-1', month: '2026-11' });
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/gst/returns', 'd11']);
		await page.open(CALENDAR.rows[1] as never);
		expect(notifier.showError).toHaveBeenCalledWith('gst_problem_return_filed');
		expect(navigate).toHaveBeenCalledTimes(3);
		// GSTR-3B has its own page, prepared or not.
		await page.open({ ...CALENDAR.rows[1], returnType: 'GSTR-3B' } as never);
		expect(prepare).toHaveBeenLastCalledWith({ gstRegistrationId: 'r1', returnType: 'GSTR-3B', month: '2026-11' });
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/gst/returns/3b', 'd3b']);
		await page.open({ ...CALENDAR.rows[1], returnType: 'GSTR-3B', draftId: 'd9' } as never);
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/gst/returns/3b', 'd9']);
		expect(page.busy()).toBe(false);
	});

	it('offers to prepare a GSTR-3B not started, as a GSTR-1', async () => {
		const threeB = { ...CALENDAR, rows: [row({ returnType: 'GSTR-3B', dueOn: '2026-12-20' })] };
		const { fixture } = mount(GstReturnsPage, { gst: { calendar: vi.fn(() => of(threeB)) }, company });
		await settle(fixture);
		expect(el(fixture, 'tbody button[title="gst_prepare"]')).not.toBeNull();
	});

	it('lets someone who may not edit see a return, but not prepare one', async () => {
		const { fixture } = mount(
			GstReturnsPage,
			{ gst: { calendar: vi.fn(() => of(CALENDAR)) }, company },
			{ permissions: ['accounts.index'] },
		);
		await settle(fixture);
		expect(el(fixture, 'button[title="view"]')).not.toBeNull();
		expect(el(fixture, 'button[title="gst_prepare"]')).toBeNull();
	});

	it('says why the calendar cannot show, and that there is nothing due', async () => {
		const missing = mount(GstReturnsPage, {
			gst: { calendar: vi.fn(() => throwError(() => refusal('gst_due_dates_not_installed'))) },
			company,
		});
		await settle(missing.fixture);
		expect(missing.page.calendarProblem()).toBe('gst_problem_due_dates_not_installed');
		expect(el(missing.fixture, '.alert-warning')?.textContent).toContain('gst_problem_due_dates_not_installed');
		expect(missing.fixture.nativeElement.textContent).toContain('gst_empty');

		const down = mount(GstReturnsPage, {
			gst: { calendar: vi.fn(() => throwError(() => new Error('down'))) },
			company,
		});
		await settle(down.fixture);
		expect(down.page.calendarProblem()).toBe('gst_problem_calendar');
	});

	it('shows no GSTIN and reads no calendar when the company has none', async () => {
		const calendar = vi.fn(() => of(CALENDAR));
		const { fixture, page } = mount(GstReturnsPage, { gst: { calendar } });
		await settle(fixture);
		expect(page.heading()).toBe('—');
		expect(page.registrationId()).toBe('');
		expect(calendar).not.toHaveBeenCalled();
	});
});

const draft = (over: Record<string, unknown> = {}) => ({
	id: 'd1',
	gstRegistrationId: 'r1',
	gstin: '19ABCDE1234F1Z5',
	returnType: 'GSTR-1',
	month: '2026-11',
	status: 'prepared',
	summary: [
		// The return holds rupees, not paise.
		{ table: '4A', records: 12, taxable: 42_500, tax: 7_650 },
		{ table: '7', records: 30, taxable: 18_000, tax: 900.5 },
		{ table: '9B', records: 1, taxable: -43_600, tax: -2_180 },
		{ table: '12', records: 4, taxable: 60_500, tax: 8_550 },
		{ table: '13', records: 43, taxable: 0, tax: 0 },
	],
	problems: [],
	portal: { gstin: '19ABCDE1234F1Z5', fp: '112026', b2b: [] },
	preparedBy: 'u1',
	preparedAt: '2026-12-02T05:30:00.000Z',
	checkedBy: null,
	checkedAt: null,
	approvedBy: null,
	approvedAt: null,
	preparedByName: 'Asha',
	checkedByName: '',
	approvedByName: '',
	arn: null,
	filedOn: null,
	version: 2,
	...over,
});

async function gstr1(over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, permissions = ALL) {
	const one = vi.fn(() => of(draft(over)));
	const harness = mount(
		Gstr1Page,
		{
			gst: { one, step: vi.fn(() => of(draft())), prepare: vi.fn(() => of(draft())), ...extra },
			ledger: { markFiled: vi.fn(() => of({})), ...(extra['ledger'] as object) },
		},
		{ permissions },
	);
	await settle(harness.fixture);
	return { ...harness, one };
}

describe('a GST return’s steps and amounts', () => {
	it('marks the steps done, waited for and ahead, and signs a note’s amount in rupees', () => {
		expect([...GST_STEPS]).toEqual(['prepared', 'checked', 'approved', 'filed', 'locked']);
		expect([0, 1, 2].map((i) => stepIcon('prepared', i))).toEqual([
			'ri-checkbox-circle-line text-success',
			'ri-time-line text-warning',
			'ri-checkbox-blank-circle-line text-muted',
		]);
		expect(stepIcon('approved', 3)).toBe('ri-time-line text-warning');
		expect(stepIcon('filed', 4)).toBe('ri-checkbox-circle-line text-success');
		expect(signedRupees(43_600)).toBe('₹43,600.00');
		expect(signedRupees(-43_600)).toBe('−₹43,600.00');
		expect(signedRupees(900.5)).toBe('₹900.50');
		expect(signedRupees(0)).toBe('₹0.00');
	});
});

describe('a GSTR-1 (G4, G8)', () => {
	it('shows the return, its month, its tables with their checks, and no amounts for table 13', async () => {
		const { fixture, page, one } = await gstr1({
			problems: [
				{ table: '4A', problem: 'no_gstin', document: 'INV/26-27/000041' },
				{ table: '4A', problem: 'place_of_supply', document: 'INV/26-27/000042' },
			],
		});
		expect(one).toHaveBeenCalledWith('d1');
		expect(page.monthName()).toBe('November 2026');
		const data = page.draft.data() as never;
		expect(page.checks(data, '4A')).toBe('gstr1_check_no_gstin; gstr1_check_place_of_supply');
		expect(page.checks(data, '12')).toBe('✓ gstr1_ok_12');
		expect(page.checks(data, '13')).toBe('✓ gstr1_ok_13');
		expect(page.checks(data, '7')).toBe('✓');
		const rows = [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
		const cells = (r: HTMLElement) => [...r.querySelectorAll('td')] as HTMLElement[];
		expect(cells(rows[0] as HTMLElement)[4]?.classList.contains('text-danger')).toBe(true);
		expect(cells(rows[1] as HTMLElement)[4]?.classList.contains('text-danger')).toBe(false);
		expect(cells(rows[0] as HTMLElement)[2]?.textContent?.trim()).toBe('₹42,500.00');
		expect(cells(rows[1] as HTMLElement)[3]?.textContent?.trim()).toBe('₹900.50');
		expect(cells(rows[2] as HTMLElement)[2]?.textContent?.trim()).toBe('−₹43,600.00');
		expect(
			cells(rows[4] as HTMLElement)
				.slice(2, 4)
				.map((c) => c.textContent?.trim()),
		).toEqual(['—', '—']);
		expect(fixture.nativeElement.querySelectorAll('.ri-time-line')).toHaveLength(1);
		expect(fixture.nativeElement.textContent).toContain('gst_enter_arn_body');
		expect(page.day('2026-12-02T05:30:00.000Z')).toBeTruthy();
	});

	it('downloads the portal’s file named as the offline tool names it', async () => {
		const { fixture } = await gstr1();
		(el(fixture, '#gst_download') as HTMLButtonElement).click();
		const [name, blob] = vi.mocked(saveBlob).mock.lastCall as [string, Blob];
		expect(name).toBe('GSTR1_19ABCDE1234F1Z5_112026.json');
		expect(JSON.parse(await blob.text())).toEqual(draft().portal);
	});

	it('is prepared again or marked checked while prepared, and says so', async () => {
		const { fixture, page, notifier, invalidate } = await gstr1();
		expect(el(fixture, '#gst_approve')).toBeNull();
		expect(el(fixture, '#gst_open_file')).toBeNull();
		(el(fixture, '#gst_checked') as HTMLButtonElement).click();
		await settle(fixture);
		const gateway = TestBed.inject(GstReturnsGateway) as unknown as { step: ReturnType<typeof vi.fn> };
		expect(gateway.step).toHaveBeenCalledWith('d1', { to: 'checked', version: 2 });
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('gst_done_checked');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gst-returns'] });
		(el(fixture, '#gst_prepare_again') as HTMLButtonElement).click();
		await settle(fixture);
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('gst_done_prepared');
		expect(page.busy()).toBe(false);
	});

	it('offers Approve once checked, not while it has problems, and names a refused step', async () => {
		const clean = await gstr1(
			{ status: 'checked' },
			{
				step: vi.fn(() => throwError(() => refusal('gst_return_approver_only'))),
				prepare: vi.fn(() => throwError(() => refusal('gst_return_approved'))),
			},
		);
		expect(el(clean.fixture, '#gst_checked')).toBeNull();
		expect(el(clean.fixture, '#gst_prepare_again')).not.toBeNull();
		const approve = el(clean.fixture, '#gst_approve') as HTMLButtonElement;
		expect(approve.disabled).toBe(false);
		approve.click();
		await settle(clean.fixture);
		expect(clean.notifier.showError).toHaveBeenLastCalledWith('gst_problem_return_approver_only');
		const data = clean.page.draft.data() as never;
		await expect(clean.page.step(data, 'approved')).resolves.toBe(false);
		await expect(clean.page.prepareAgain(data)).resolves.toBe(false);
		expect(clean.notifier.showError).toHaveBeenLastCalledWith('gst_problem_return_approved');

		const blocked = await gstr1({
			status: 'checked',
			problems: [{ table: '12', problem: 'hsn_missing', document: 'INV/26-27/000050' }],
		});
		expect((el(blocked.fixture, '#gst_approve') as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows its buttons only to those who may use them', async () => {
		const { fixture } = await gstr1({}, {}, ['accounts.index']);
		expect(el(fixture, '#gst_download')).not.toBeNull();
		expect(el(fixture, '#gst_prepare_again')).toBeNull();
		expect(el(fixture, '#gst_checked')).toBeNull();
	});

	it('shows the ARN and day once filed, with every step done', async () => {
		const { fixture, page } = await gstr1({ status: 'filed', arn: 'AA191126012345X', filedOn: '2026-12-10' });
		expect(fixture.nativeElement.textContent).toContain('gst_filed_with');
		expect(fixture.nativeElement.querySelectorAll('.ri-time-line')).toHaveLength(0);
		expect(el(fixture, '#gst_prepare_again')).toBeNull();
		expect(el(fixture, '#gst_open_file')).toBeNull();
		expect(page.checks(page.draft.data() as never, '4A')).toBe('✓ gstr1_ok_4A');
	});
});

describe('entering the ARN of an approved GSTR-1 (G8)', () => {
	it('opens the Mark filed pop-up fresh, attaches the portal’s acknowledgement, and files the return', async () => {
		const harness = await gstr1({ status: 'approved' });
		const { fixture, page, opened } = harness;
		page.arn.set('old');
		page.acknowledgement.set({ assetId: 'a0', name: 'old.pdf' });
		(el(fixture, '#gst_open_file') as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		expect(popup.content).toBeInstanceOf(TemplateRef);
		expect([page.arn(), page.acknowledgement()]).toEqual(['', null]);
		expect(page.filedOn()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const redraw = () => popup.view?.detectChanges();
		redraw();
		const confirm = modal('#gst_file_confirm') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);

		harness.pickWith(Promise.resolve([{ assetId: 'a1', versionId: null, name: 'ack.pdf', thumbnailUrl: null }]));
		(modal('#gst_ack') as HTMLAnchorElement).click();
		await settle(fixture);
		expect(opened[1]?.content).toBe(FmPicker);
		expect(opened[1]?.componentInstance.start).toHaveBeenCalledWith({
			title: 'accounts_ack_file',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		expect(page.acknowledgement()).toEqual({ assetId: 'a1', name: 'ack.pdf' });
		redraw();
		expect(document.querySelector('.gst-test-modal')?.textContent).toContain('ack.pdf');
		(modal('a[title="accounts_remove_attachment"]') as HTMLAnchorElement).click();
		expect(page.acknowledgement()).toBeNull();
		redraw();
		expect(modal('#gst_ack')).not.toBeNull();

		const arn = modal('#gst_arn') as HTMLInputElement;
		arn.value = 'AA191126012345X';
		arn.dispatchEvent(new Event('input'));
		const filedOn = modal('#gst_filed_on') as HTMLInputElement;
		filedOn.value = '2026-12-10';
		filedOn.dispatchEvent(new Event('input'));
		redraw();
		expect(confirm.disabled).toBe(false);
		confirm.click();
		await settle(fixture);
		const ledger = TestBed.inject(LedgerGateway) as unknown as { markFiled: ReturnType<typeof vi.fn> };
		expect(ledger.markFiled).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'GSTR-1',
			month: '2026-11',
			arn: 'AA191126012345X',
			filedOn: '2026-12-10',
			acknowledgement: null,
		});
		expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 'periods'] });
		expect(harness.notifier.showSuccess).toHaveBeenLastCalledWith('accounts_gst_filed_saved');
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('keeps no file when the picker is closed or nothing is picked', async () => {
		const harness = await gstr1({ status: 'approved' });
		const closed = Promise.reject(new Error('closed'));
		void closed.catch(() => undefined);
		harness.pickWith(closed);
		await harness.page.attachAck();
		expect(harness.page.acknowledgement()).toBeNull();
		harness.pickWith(Promise.resolve([]));
		await harness.page.attachAck();
		expect(harness.page.acknowledgement()).toBeNull();
	});

	it('keeps the pop-up open with the reason when filing is refused, and files without a pop-up open', async () => {
		const markFiled = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('arn_shape')))
			.mockReturnValueOnce(of({}));
		const harness = await gstr1({ status: 'approved' }, { ledger: { markFiled } });
		(el(harness.fixture, '#gst_open_file') as HTMLButtonElement).click();
		const data = harness.page.draft.data() as never;
		await harness.page.markFiled(data);
		expect(harness.notifier.showError).toHaveBeenLastCalledWith('gst_problem_arn_shape');
		expect(harness.opened[0]?.close).not.toHaveBeenCalled();

		const fresh = await gstr1({ status: 'approved' }, { ledger: { markFiled: vi.fn(() => of({})) } });
		await fresh.page.markFiled(fresh.page.draft.data() as never);
		expect(fresh.notifier.showSuccess).toHaveBeenLastCalledWith('accounts_gst_filed_saved');
	});

	it('reads nothing with no return named', async () => {
		const one = vi.fn(() => of(draft()));
		for (const id of ['', null]) {
			const { fixture, page } = mount(Gstr1Page, { gst: { one } }, { id });
			await settle(fixture);
			expect(page.id()).toBe('');
			expect(page.monthName()).toBe('');
		}
		expect(one).not.toHaveBeenCalled();
	});
});
