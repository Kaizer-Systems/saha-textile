import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BooksCatchUpGateway } from '@core/accounts/books-catch-up.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { CATCH_UP_KINDS, CatchUpCard } from './catch-up-card';

/** Accounts › Periods and locks › "Saved before the books took them" (AP3, AP-D3). */

const counts = (o: Record<string, number> = {}) => ({
	receipts: 0,
	purchaseEntries: 0,
	supplierPayments: 0,
	purchaseReturns: 0,
	returnRefunds: 0,
	businessReceipts: 0,
	...o,
});
const refused = (message: string) => ({ error: { error: { issues: [{ code: message, message }] } } });

function setup(options: { summary?: unknown; run?: unknown; runFails?: unknown } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		summary: vi.fn(() =>
			options.summary instanceof Error || (options.summary as { error?: unknown })?.error
				? throwError(() => options.summary)
				: of(options.summary ?? { waiting: counts({ receipts: 14, purchaseEntries: 6 }) }),
		),
		run: vi.fn(() =>
			options.runFails
				? throwError(() => options.runFails)
				: of(options.run ?? { posted: counts({ receipts: 13, purchaseEntries: 6 }), skipped: [] }),
		),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			CatchUpCard,
			TranslocoTestingModule.forRoot({
				langs: {
					en: {
						cu_kind_receipts: 'Receipts',
						cu_kind_purchaseEntries: 'Purchase entries',
						cu_super_admin_only: 'Super admin only',
						cu_failed: 'Failed',
						cu_done: 'Posted {{count}}',
						cu_method_unknown: 'No way of paying',
						accounts_problem_period_locked: 'That month is locked.',
					},
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: BooksCatchUpGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(CatchUpCard);
	return { fixture, card: fixture.componentInstance, gateway, notifier };
}

describe('documents saved before the books took them', () => {
	it('counts what waits by kind, leaving out kinds with none', async () => {
		const { fixture, card } = setup();
		expect(card.kinds).toBe(CATCH_UP_KINDS);
		expect([card.total(), card.line(), card.refused()]).toEqual([0, '', null]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(card.total()).toBe(20));
		fixture.detectChanges();
		expect(card.line()).toBe('Receipts 14 · Purchase entries 6');
		const empty = setup({ summary: { waiting: counts() } });
		empty.fixture.detectChanges();
		await vi.waitFor(() => expect(empty.card.waiting.data()).toBeTruthy());
		empty.fixture.detectChanges();
		expect(empty.card.total()).toBe(0);
	});

	it('tells anyone but the super admin so, and says when the read failed', async () => {
		const others = setup({ summary: refused('catch_up_super_admin_only') });
		others.fixture.detectChanges();
		await vi.waitFor(() => expect(others.card.refused()).toBe('Super admin only'));
		others.fixture.detectChanges();
		const early = setup({ summary: refused('books_not_set_up') });
		early.fixture.detectChanges();
		await vi.waitFor(() => expect(early.card.refused()).toBe('cu_books_not_set_up'));
		const down = setup({ summary: new Error('down') });
		down.fixture.detectChanges();
		await vi.waitFor(() => expect(down.card.refused()).toBe('Failed'));
	});

	it('posts them, lists what the books refused with why, and says what went wrong', async () => {
		const { fixture, card, notifier } = setup({
			run: {
				posted: counts({ receipts: 13 }),
				skipped: [
					{ kind: 'receipts', number: 'RC/1', date: '2026-10-03', reason: 'voucher_problem:period_locked' },
					{ kind: 'businessReceipts', number: null, date: '2026-10-04', reason: 'receipt_method_unknown' },
					{ kind: 'receipts', number: 'RC/2', date: '2026-10-05', reason: 'Network down' },
				],
			},
		});
		fixture.detectChanges();
		await card.post();
		fixture.detectChanges();
		expect(notifier.showSuccess).toHaveBeenCalledWith('Posted 13');
		expect(card.result()?.skipped.map((row) => card.reason(row.reason))).toEqual([
			'That month is locked.',
			'No way of paying',
			'Network down',
		]);
		expect(card.day('2026-10-03')).toBe('3 Oct 2026');
		expect(card.busy()).toBe(false);
		const failing = setup({ runFails: refused('money_lands_not_set:paid_by_bank') });
		await failing.card.post();
		expect(failing.notifier.showError).toHaveBeenCalledWith('books_no_bank_paid_by_bank');
		const lost = setup({ runFails: new Error('offline') });
		await lost.card.post();
		expect(lost.notifier.showError).toHaveBeenCalledWith('Failed');
	});
});
