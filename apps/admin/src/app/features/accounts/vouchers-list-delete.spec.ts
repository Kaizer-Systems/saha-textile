import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { VouchersListPage } from './vouchers-list';

/** Deleting a voucher draft (accounts brief Q3): asked first, and a refusal named, not lost. */

function mount(answer: boolean, deleteDraft: ReturnType<typeof vi.fn>) {
	TestBed.resetTestingModule();
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const asked: unknown[] = [];
	TestBed.configureTestingModule({
		imports: [
			VouchersListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{
				provide: LedgerGateway,
				useValue: {
					vouchers: vi.fn(() => of({ items: [], total: 0, page: 1, pageSize: 25 })),
					drafts: vi.fn(() => of([])),
					deleteDraft,
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: NgbModal,
				useValue: {
					open: () => ({
						componentInstance: { start: (ask: unknown) => asked.push(ask) },
						result: Promise.resolve(answer),
					}),
				},
			},
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.post']) } },
		],
	});
	TestBed.overrideComponent(VouchersListPage, { set: { template: '' } });
	const page = TestBed.createComponent(VouchersListPage).componentInstance;
	return { page, notifier, asked };
}

describe('deleting a voucher draft (Q3)', () => {
	it('asks first, and deletes nothing when the answer is no', async () => {
		const deleteDraft = vi.fn(() => of(undefined));
		const { page, asked } = mount(false, deleteDraft);
		await page.deleteDraft('d1');
		expect(asked).toEqual([
			{
				icon: 'ri-delete-bin-line',
				title: 'accounts_delete_draft',
				body: 'accounts_delete_draft_body',
				yes: 'delete',
			},
		]);
		expect(deleteDraft).not.toHaveBeenCalled();
	});

	it('names a refusal to delete, or says it simply failed', async () => {
		const deleteDraft = vi
			.fn()
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'Draft already posted' } })))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = mount(true, deleteDraft);
		await page.deleteDraft('d1');
		expect(notifier.showError).toHaveBeenLastCalledWith('Draft already posted');
		await page.deleteDraft('d1');
		expect(notifier.showError).toHaveBeenLastCalledWith('ord_action_failed');
	});
});
