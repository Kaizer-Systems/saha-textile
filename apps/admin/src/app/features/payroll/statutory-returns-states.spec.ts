import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
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

/** Professional tax and the welfare fund, one return per State (brief 25 ST1), on Statutory returns. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const ret = (kind: string, stateCode: string | null, over: Record<string, unknown> = {}) => ({
	kind,
	period: '2026-11',
	periodTo: '2026-11',
	due: '2026-12-21',
	amountPaise: 40_000,
	status: 'ready',
	filedOn: null,
	reference: '',
	stateCode,
	...over,
});
const RETURNS = [ret('pt', '19'), ret('pt', '29', { amountPaise: 20_000 }), ret('lwf', '19'), ret('pf', null)];

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

async function opened() {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.sts-test-modal').forEach((node) => node.remove());
	const popups: Opened[] = [];
	const calls = {
		statutory: vi.fn(() => of(RETURNS)),
		statutoryFile: vi.fn(() => of({ fileName: 'PT_WB_2026-11.csv', text: 'name,tax' })),
		markFiled: vi.fn(() => of(RETURNS[0])),
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
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.post']) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'sts-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						popups.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(StatutoryReturnsPage);
	fixture.detectChanges();
	await settle(fixture);
	return { fixture, page: fixture.componentInstance, calls, popups };
}

const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const enter = (control: Element | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event('input'));
};

describe('statutory returns per State (ST1)', () => {
	it('lists each State’s professional tax and welfare fund return with the State under its name', async () => {
		const { fixture } = await opened();
		const [ptBengal, ptKarnataka, lwf, pf] = rows(fixture);
		expect(rows(fixture)).toHaveLength(4);
		expect(ptBengal?.querySelector('td small')?.textContent?.trim()).toBe('West Bengal');
		expect(ptKarnataka?.querySelector('td small')?.textContent?.trim()).toBe('Karnataka');
		expect(lwf?.querySelector('td')?.textContent).toContain('payroll_return_lwf');
		expect(pf?.querySelector('td small')).toBeNull();
	});

	it('saves a State’s file, asking for that State’s, and a company-wide one without a State', async () => {
		const { fixture, calls } = await opened();
		(rows(fixture)[1]?.querySelector('button') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.statutoryFile).toHaveBeenLastCalledWith('pt', '2026-11', '29');
		expect(vi.mocked(saveBlob).mock.lastCall?.[0]).toBe('PT_WB_2026-11.csv');
		(rows(fixture)[3]?.querySelector('button') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.statutoryFile).toHaveBeenLastCalledWith('pf', '2026-11', null);
	});

	it('names the return being filed with its State, and marks that State’s return filed', async () => {
		const { fixture, page, calls, popups } = await opened();
		(rows(fixture)[0]?.querySelectorAll('button')[1] as HTMLButtonElement).click();
		const popup = popups[0] as Opened;
		expect(page.filingName()).toBe('payroll_return_pt · West Bengal');
		enter(document.querySelector('.sts-test-modal #stat_ref'), 'PT-WB-1129');
		enter(document.querySelector('.sts-test-modal #stat_on'), '2026-12-18');
		popup.view.detectChanges();
		([...document.querySelectorAll('.sts-test-modal button')].at(-1) as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.markFiled).toHaveBeenCalledWith('pt', '2026-11', {
			reference: 'PT-WB-1129',
			filedOn: '2026-12-18',
			stateCode: '19',
		});
		page.filing.set(RETURNS[3] as never);
		expect(page.filingName()).toBe('payroll_return_pf');
	});
});
