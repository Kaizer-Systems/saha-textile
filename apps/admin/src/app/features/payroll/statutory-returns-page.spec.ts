import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { StatutoryReturnsPage } from './statutory-returns-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** Statutory returns (accounts brief S7): PF, ESI, PT and LWF each month, TDS on salary each quarter. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ret = (kind: string, status: string, over: Record<string, unknown> = {}) => ({
	kind,
	period: '2026-11',
	periodTo: '2026-11',
	due: '2026-12-15',
	amountPaise: 384_000,
	status,
	filedOn: null,
	reference: '',
	...over,
});
const RETURNS = [
	ret('pf', 'ready'),
	ret('tds', 'later', { period: '2026-10', periodTo: '2026-12', due: '2027-01-31' }),
	ret('esi', 'filed', { filedOn: '2026-11-14', reference: 'ESI-778' }),
];

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(gateway: Record<string, unknown> = {}, permissions = ['accounts.index', 'accounts.post']) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.stat-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const calls = {
		statutory: vi.fn(() => of(RETURNS)),
		statutoryFile: vi.fn(() => of({ fileName: 'ECR_2026-11.txt', text: 'UAN#~#NAME' })),
		markFiled: vi.fn(() => of(RETURNS[0])),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			StatutoryReturnsPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'stat-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(StatutoryReturnsPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, calls };
}

async function returns(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const tabs = (fixture: { nativeElement: HTMLElement }) =>
	([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).filter((b) =>
		/payroll_statutory_(due|filed)/.test(b.textContent ?? ''),
	);
const modal = (selector: string) => document.querySelector(`.stat-test-modal ${selector}`) as HTMLElement | null;
const enter = (control: HTMLElement | null, value: string) => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event('input'));
};

describe('the statutory returns page (S7)', () => {
	it('shows the returns still due with their counts, each with its period, due day and amount', async () => {
		const { fixture, page } = await returns();
		expect(tabs(fixture).map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'payroll_statutory_due 2',
			'payroll_statutory_filed 1',
		]);
		const due = rows(fixture);
		expect(due).toHaveLength(2);
		expect(due[0]?.textContent).toContain('payroll_return_pf');
		expect(due[0]?.textContent).toContain('November 2026');
		expect(due[0]?.textContent).toContain('₹3,840.00');
		expect(due[1]?.textContent).toContain('October 2026 – December 2026');
		expect(due[1]?.textContent).toContain('payroll_statutory_status_later');
		expect(due[0]?.querySelectorAll('button')).toHaveLength(2);
		expect(due[1]?.querySelectorAll('button')).toHaveLength(1);
		tabs(fixture)[1]?.click();
		await settle(fixture);
		expect(page.tab()).toBe('filed');
		expect(rows(fixture)[0]?.textContent).toContain('payroll_statutory_status_filed');
		tabs(fixture)[0]?.click();
		expect(page.tab()).toBe('due');
		expect(page.day(null)).toBeDefined();
	});

	it('saves the file its portal takes, and names a refusal to make it', async () => {
		const statutoryFile = vi
			.fn()
			.mockReturnValueOnce(of({ fileName: 'ECR_2026-11.txt', text: 'UAN#~#NAME' }))
			.mockReturnValueOnce(throwError(() => refusal('payroll_no_run')));
		const { fixture, page, notifier } = await returns({ statutoryFile });
		(rows(fixture)[0]?.querySelectorAll('button')[0] as HTMLButtonElement).click();
		await settle(fixture);
		expect(statutoryFile).toHaveBeenCalledWith('pf', '2026-11');
		const [name, blob] = vi.mocked(saveBlob).mock.lastCall as [string, Blob];
		expect(name).toBe('ECR_2026-11.txt');
		expect(await blob.text()).toBe('UAN#~#NAME');
		await page.download(RETURNS[0] as never);
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_payroll_no_run');
	});

	it('marks a ready return filed with the portal’s reference, starting the pop-up afresh', async () => {
		const { fixture, page, opened, calls, notifier, invalidate } = await returns();
		expect(page.filingName()).toBe('');
		page.reference.set('old');
		(rows(fixture)[0]?.querySelectorAll('button')[1] as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		expect([page.filing()?.kind, page.reference(), page.filingName()]).toEqual(['pf', '', 'payroll_return_pf']);
		expect(page.filedOn()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const confirm = [...document.querySelectorAll('.stat-test-modal button')].at(-1) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		enter(modal('#stat_ref'), 'ECR-1129');
		enter(modal('#stat_on'), '2026-12-10');
		popup.view.detectChanges();
		expect(confirm.disabled).toBe(false);
		confirm.click();
		await settle(fixture);
		expect(calls.markFiled).toHaveBeenCalledWith('pf', '2026-11', { reference: 'ECR-1129', filedOn: '2026-12-10' });
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_statutory_marked');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll', 'statutory'] });
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('does nothing with no return open, names a refusal, and saves with no pop-up', async () => {
		const markFiled = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_return_filed')))
			.mockReturnValueOnce(of(RETURNS[0]));
		const { page, notifier, calls } = await returns({ markFiled });
		await page.markFiled();
		expect(calls.markFiled).not.toHaveBeenCalled();
		page.filing.set(RETURNS[0] as never);
		await page.markFiled();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_payroll_return_filed');
		await page.markFiled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_statutory_marked');
		expect(page.busy()).toBe(false);
	});

	it('offers Mark filed only to someone who may post, and says when there is nothing', async () => {
		const reader = await returns({}, ['accounts.index']);
		expect(rows(reader.fixture)[0]?.querySelectorAll('button')).toHaveLength(1);
		const empty = await returns({ statutory: vi.fn(() => of([])) });
		expect(empty.fixture.nativeElement.querySelector('tbody td[colspan]')).not.toBeNull();
	});
});
