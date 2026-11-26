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

import { BanksGateway } from '@core/accounts/banks.gateway';
import { GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { GstReturnsPage, gstProblem } from './gst-returns-page';
import { Gstr1Page } from './gstr1-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** IFF, PMT-06, CMP-08, GSTR-4 and GSTR-6 on the GST pages: the payment, the ISD distribution and GSTR-6A. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.edit', 'accounts.post', 'accounts.lock'];
const heads = (igst: number, cgst: number, sgst: number) => ({ igst, cgst, sgst });
const SET_OFF = {
	liability: heads(0, 0, 0),
	credit: heads(0, 0, 0),
	igstUsed: heads(0, 0, 0),
	cgstUsed: { cgst: 0, igst: 0 },
	sgstUsed: { sgst: 0, igst: 0 },
	cash: heads(10_000, 25_000, 25_000),
	carried: heads(0, 0, 0),
	reverseChargeCash: heads(0, 0, 0),
};
const draft = (returnType: string, status: string, over: Record<string, unknown> = {}) => ({
	id: 'd1',
	gstRegistrationId: 'r1',
	gstin: '19ABCDE1234F1Z5',
	returnType,
	month: '2026-11',
	status,
	summary: [],
	problems: [],
	portal: { gstin: '19ABCDE1234F1Z5' },
	preparedBy: 'u1',
	preparedAt: '2026-12-02T05:30:00.000Z',
	preparedByName: 'Asha',
	arn: null,
	filedOn: null,
	version: 5,
	setOff: null,
	adjustments: [],
	challanVoucherId: null,
	distributionVoucherId: null,
	...over,
});
const file = (text: string) => ({ name: '6a.json', text: async () => text });
const input = (chosen: unknown) => ({ files: chosen ? [chosen] : [], value: 'C:\\fakepath\\6a.json', click: vi.fn() });

interface Opened {
	content: unknown;
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown> | null;
}

function mount<T>(
	component: Type<T>,
	gst: Record<string, unknown>,
	options: { permissions?: string[]; company?: unknown[] } = {},
) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.iff-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const banks = {
		list: vi.fn(() => of({ items: [{ id: 'b1', shortName: 'HDFC current', numberShown: 'XXXX1234' }] })),
	};
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
			{ provide: GstReturnsGateway, useValue: gst },
			{ provide: BanksGateway, useValue: banks },
			{ provide: LedgerGateway, useValue: {} },
			{
				provide: CompanyGateway,
				useValue: {
					registrations: vi.fn(() =>
						of(options.company ?? [{ id: 'r1', gstin: '19ABCDE1234F1Z5', stateCode: '19' }]),
					),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ALL) } },
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'd1' })) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown) => {
						const ref: Opened = { content, close: vi.fn(), dismiss: vi.fn(), view: null };
						if (content instanceof TemplateRef) {
							const view = content.createEmbeddedView({ $implicit: ref });
							TestBed.inject(ApplicationRef).attachView(view);
							view.detectChanges();
							const holder = document.createElement('div');
							holder.className = 'iff-test-modal';
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
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, navigate, banks };
}

async function gstr1(d: unknown, gst: Record<string, unknown> = {}, permissions?: string[]) {
	const calls = {
		one: vi.fn(() => of(d)),
		prepare: vi.fn(() => of(d)),
		postSetOff: vi.fn(() => of(d)),
		distribute: vi.fn(() => of(d)),
		...gst,
	};
	const harness = mount(Gstr1Page, calls, { permissions });
	await settle(harness.fixture);
	return { ...harness, calls };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const modal = (selector: string) => document.querySelector(`.iff-test-modal ${selector}`) as HTMLElement | null;
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('the distribute route and the new refusals', () => {
	it('posts an ISD’s distribution with the draft’s version', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(GstReturnsGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.distribute('d/1', { version: 5 }).subscribe();
		const request = http.expectOne(
			(req) =>
				req.method === 'POST' &&
				req.urlWithParams === `${runtimeConfig.apiUrl}/admin/accounts/gst/returns/d%2F1/distribute`,
		);
		expect(request.request.body).toEqual({ version: 5 });
		request.flush({});
		http.verify();
	});

	it('words each new refusal', () => {
		const codes = [
			['gst_return_quarter_end_only', 'gst_problem_return_quarter_end_only'],
			['gst_return_not_for_this_gstin', 'gst_problem_return_not_for_this_gstin'],
			['gstr6a_needed', 'gst_problem_gstr6a_needed'],
			['gstr6a_other_gstin', 'gst_problem_gstr6a_other_gstin'],
			['gstr6a_other_month', 'gst_problem_gstr6a_other_month'],
			['gstr6a_file_unreadable', 'gst_problem_gstr6a_file_unreadable'],
			['gstr6a_line_unreadable', 'gst_problem_gstr6a_line_unreadable'],
			['gst_distribution_not_isd', 'gst_problem_distribution_not_isd'],
		];
		expect(codes.map(([code]) => gstProblem(refusal(code as string)))).toEqual(codes.map(([, key]) => key));
	});
});

describe('a return’s file for the portal', () => {
	it('is named after the return without its dashes', async () => {
		const pmt = await gstr1(draft('PMT-06', 'prepared'));
		(el(pmt.fixture, '#gst_download') as HTMLButtonElement).click();
		expect(vi.mocked(saveBlob).mock.lastCall?.[0]).toBe('PMT06_19ABCDE1234F1Z5_112026.json');
		const iff = await gstr1(draft('IFF', 'prepared'));
		(el(iff.fixture, '#gst_download') as HTMLButtonElement).click();
		expect(vi.mocked(saveBlob).mock.lastCall?.[0]).toBe('IFF_19ABCDE1234F1Z5_112026.json');
	});
});

describe('PMT-06’s method', () => {
	it('is picked while the return is open, and sent only with a PMT-06', async () => {
		const { fixture, page, calls } = await gstr1(draft('PMT-06', 'checked'));
		enter(el(fixture, '#gst_pmt06_method'), 'fixed_sum');
		expect(page.method()).toBe('fixed_sum');
		(el(fixture, '#gst_prepare_again') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.prepare).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'PMT-06',
			month: '2026-11',
			pmt06Method: 'fixed_sum',
		});
		const approved = await gstr1(draft('PMT-06', 'approved', { setOff: SET_OFF }));
		expect(el(approved.fixture, '#gst_pmt06_method')).toBeNull();
		const iff = await gstr1(draft('IFF', 'prepared'));
		expect(el(iff.fixture, '#gst_pmt06_method')).toBeNull();
		await iff.page.prepareAgain(iff.page.draft.data() as never);
		expect(iff.calls.prepare).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'IFF',
			month: '2026-11',
		});
	});
});

describe('GSTR-6 from its GSTR-6A file', () => {
	it('offers the file only while the return is open, and prepares again from a good file', async () => {
		const { fixture, page, calls, notifier } = await gstr1(draft('GSTR-6', 'prepared'));
		const hidden = el(fixture, 'input[type="file"]') as HTMLInputElement;
		const click = vi.spyOn(hidden, 'click').mockImplementation(() => undefined);
		(el(fixture, '#gst_load_6a') as HTMLButtonElement).click();
		expect(click).toHaveBeenCalled();
		hidden.dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(calls.prepare).not.toHaveBeenCalled();
		const d = page.draft.data() as never;
		for (const text of ['not json', '[1]', 'null', '"6A"']) {
			const chosen = input(file(text));
			await page.load6a(d, chosen as never);
			expect(chosen.value).toBe('');
		}
		expect(notifier.showError).toHaveBeenCalledTimes(4);
		expect(notifier.showError).toHaveBeenLastCalledWith('gst_problem_gstr6a_file_unreadable');
		await page.load6a(d, input(file('{"isd":[]}')) as never);
		expect(calls.prepare).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'GSTR-6',
			month: '2026-11',
			inward6a: { isd: [] },
		});
		const approved = await gstr1(draft('GSTR-6', 'approved'));
		expect(el(approved.fixture, '#gst_load_6a')).toBeNull();
	});
});

describe('posting a PMT-06 or CMP-08 payment', () => {
	it('is offered once approved with a set-off, reads the banks only when opened, and posts the challan', async () => {
		const { fixture, page, opened, calls, notifier, invalidate, banks } = await gstr1(
			draft('PMT-06', 'approved', { setOff: SET_OFF }),
		);
		expect([page.canPay(), page.canDistribute(), page.payPaise()]).toEqual([true, false, 60_000]);
		expect(fixture.nativeElement.textContent).toContain('gst_post_payment_body_PMT-06');
		expect(banks.list).not.toHaveBeenCalled();
		page.challan.set('OLD');
		(el(fixture, '#gst_open_pay') as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		expect([page.payOpen(), page.challan()]).toEqual([true, '']);
		await settle(fixture);
		expect(banks.list).toHaveBeenCalled();
		popup.view?.detectChanges();
		const confirm = modal('#gst_pay_confirm') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		enter(modal('#gst_pay_from'), 'b1');
		enter(modal('#gst_challan'), 'CPIN1');
		popup.view?.detectChanges();
		expect(confirm.disabled).toBe(true);
		enter(modal('#gst_challan'), 'CPIN26110099');
		enter(modal('#gst_paid_on'), '2026-12-05');
		popup.view?.detectChanges();
		expect(confirm.disabled).toBe(false);
		confirm.click();
		await settle(fixture);
		expect(calls.postSetOff).toHaveBeenCalledWith('d1', {
			bankAccountId: 'b1',
			paidOn: '2026-12-05',
			challan: 'CPIN26110099',
			version: 5,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('gst_payment_posted');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gst-returns'] });
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('keeps the pop-up open when refused, and posts with none open', async () => {
		const postSetOff = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('challan_shape')))
			.mockReturnValueOnce(of(draft('CMP-08', 'approved')));
		const { fixture, page, opened, notifier } = await gstr1(draft('CMP-08', 'filed', { setOff: SET_OFF }), {
			postSetOff,
		});
		expect(page.canPay()).toBe(true);
		(el(fixture, '#gst_open_pay') as HTMLButtonElement).click();
		await page.pay(page.draft.data() as never);
		expect(notifier.showError).toHaveBeenCalledWith('gst_problem_challan_shape');
		expect(opened[0]?.close).not.toHaveBeenCalled();
		const fresh = await gstr1(draft('CMP-08', 'approved', { setOff: SET_OFF }));
		await fresh.page.pay(fresh.page.draft.data() as never);
		expect(fresh.notifier.showSuccess).toHaveBeenCalledWith('gst_payment_posted');
	});

	it('is not offered once paid, without a set-off, before approval or for other returns', async () => {
		const paid = await gstr1(draft('PMT-06', 'filed', { setOff: SET_OFF, challanVoucherId: 'pv1' }));
		expect(paid.page.canPay()).toBe(false);
		expect(paid.fixture.nativeElement.textContent).toContain('gst_payment_posted');
		expect(el(paid.fixture, '#gst_open_pay')).toBeNull();
		for (const d of [
			draft('PMT-06', 'approved'),
			draft('PMT-06', 'checked', { setOff: SET_OFF }),
			draft('GSTR-4', 'approved', { setOff: SET_OFF }),
		]) {
			const { page } = await gstr1(d);
			expect(page.canPay()).toBe(false);
		}
		const none = await gstr1(draft('PMT-06', 'approved'));
		expect(none.page.payPaise()).toBe(0);
		const accountant = await gstr1(draft('PMT-06', 'approved', { setOff: SET_OFF }), {}, [
			'accounts.index',
			'accounts.edit',
		]);
		expect(el(accountant.fixture, '#gst_open_pay')).toBeNull();
	});
});

describe('posting a GSTR-6 distribution', () => {
	it('is offered once approved and not yet posted, and posts with the draft’s version', async () => {
		const { fixture, page, calls, notifier } = await gstr1(draft('GSTR-6', 'approved'));
		expect(page.canDistribute()).toBe(true);
		expect(fixture.nativeElement.textContent).toContain('gst_post_distribution_body');
		(el(fixture, '#gst_distribute') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.distribute).toHaveBeenCalledWith('d1', { version: 5 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('gst_distribution_posted');

		const posted = await gstr1(draft('GSTR-6', 'filed', { distributionVoucherId: 'jv4' }));
		expect(posted.page.canDistribute()).toBe(false);
		expect(el(posted.fixture, '#gst_distribute')).toBeNull();
		expect(posted.fixture.nativeElement.textContent).toContain('gst_distribution_posted');
		const open = await gstr1(draft('GSTR-6', 'checked'));
		expect(open.page.canDistribute()).toBe(false);
		const unread = mount(Gstr1Page, { one: vi.fn(() => of()) });
		expect([unread.page.canPay(), unread.page.canDistribute(), unread.page.payPaise()]).toEqual([false, false, 0]);
	});
});

const row = (returnType: string, over: Record<string, unknown> = {}) => ({
	returnType,
	period: '2026-11',
	dueOn: '2026-12-13',
	status: 'not_started',
	arn: null,
	draftId: null,
	...over,
});

describe('preparing a GSTR-6 from the calendar', () => {
	async function calendar(gst: Record<string, unknown> = {}) {
		const calls = {
			calendar: vi.fn(() =>
				of({ gstin: '19ABCDE1234F1Z5', rows: [row('GSTR-6')], counts: { due: 1, filed: 0, all: 1 } }),
			),
			prepare: vi.fn(() => of({ id: 'd6' })),
			...gst,
		};
		const harness = mount(GstReturnsPage, calls);
		await settle(harness.fixture);
		return { ...harness, calls };
	}

	it('asks for the GSTR-6A file first, then prepares the waiting return from it', async () => {
		const { fixture, page, calls, navigate } = await calendar();
		const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
		(el(fixture, 'tbody button[title="gst_prepare"]') as HTMLButtonElement).click();
		expect(click).toHaveBeenCalled();
		click.mockRestore();
		expect(calls.prepare).not.toHaveBeenCalled();
		const chosen = input(file('{"isd":[{"ctin":"19AAAAA0000A1Z5"}]}'));
		await page.load6a(chosen as never);
		expect(chosen.value).toBe('');
		expect(calls.prepare).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'GSTR-6',
			month: '2026-11',
			inward6a: { isd: [{ ctin: '19AAAAA0000A1Z5' }] },
		});
		expect(navigate).toHaveBeenCalledWith(['/accounts/gst/returns', 'd6']);
		await page.load6a(input(file('{}')) as never);
		expect(calls.prepare).toHaveBeenCalledTimes(1);
	});

	it('does nothing with no file or nothing waiting, words a bad file, and prepares at once with no file input', async () => {
		const { fixture, page, calls, notifier } = await calendar();
		const sixA = input(null);
		await page.open(row('GSTR-6') as never, sixA as never);
		expect(sixA.click).toHaveBeenCalled();
		await page.load6a(input(null) as never);
		expect(calls.prepare).not.toHaveBeenCalled();
		for (const text of ['not json', '[]', 'null']) {
			await page.open(row('GSTR-6') as never, input(null) as never);
			await page.load6a(input(file(text)) as never);
		}
		expect(notifier.showError).toHaveBeenCalledTimes(3);
		expect(notifier.showError).toHaveBeenLastCalledWith('gst_problem_gstr6a_file_unreadable');
		await page.open(row('GSTR-6') as never);
		expect(calls.prepare).toHaveBeenCalledWith({ gstRegistrationId: 'r1', returnType: 'GSTR-6', month: '2026-11' });
		(el(fixture, 'input[type="file"]') as HTMLInputElement).dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(calls.prepare).toHaveBeenCalledTimes(1);
	});
});
