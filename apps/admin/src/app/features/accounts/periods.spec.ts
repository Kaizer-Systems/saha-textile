import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BooksCatchUpGateway } from '@core/accounts/books-catch-up.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PeriodsPage, columnState } from './periods';

/** Accounts › Periods and locks (accounts brief T1, T2, G8), with the "Post them" card under it (AP3). */

const months = Array.from({ length: 24 }, (_, i) => {
	const d = new Date(Date.UTC(2025, 3 + i, 1));
	return d.toISOString().slice(0, 7);
});
const grid = {
	months,
	locks: [
		{ month: '2026-04', part: 'cash', state: 'closed_for_staff' },
		{ month: '2026-04', part: 'bank', state: 'locked' },
	],
	filings: [{ returnType: 'GSTR-3B', month: '2026-04', gstRegistrationId: 'reg_wb' }],
};

function setup(
	options: {
		permissions?: string[];
		grid?: unknown;
		registrations?: unknown[];
		fail?: unknown;
		picked?: unknown;
		/** How Lock a month ends: it stays open, closes or is dismissed. */
		dialog?: 'open' | 'dismissed';
	} = {},
) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const opened: { close: ReturnType<typeof vi.fn>; result: Promise<unknown> }[] = [];
	const modals = {
		open: vi.fn((what: unknown) => {
			if (typeof what === 'function')
				return {
					componentInstance: { start: vi.fn() },
					result:
						options.picked === 'dismissed'
							? Promise.reject(new Error('x'))
							: Promise.resolve(options.picked),
				};
			const ref = {
				close: vi.fn(),
				result:
					options.dialog === 'open'
						? new Promise(() => undefined)
						: options.dialog === 'dismissed'
							? Promise.reject(new Error('dismissed'))
							: Promise.resolve('closed'),
			};
			opened.push(ref);
			return ref;
		}),
	};
	const result = () => (options.fail ? throwError(() => options.fail) : of({}));
	const gateway = {
		periods: vi.fn(() => of(options.grid ?? grid)),
		periodChecks: vi.fn(() => of([])),
		markFiled: vi.fn(result),
		lock: vi.fn(result),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [PeriodsPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: LedgerGateway, useValue: gateway },
			{
				provide: CompanyGateway,
				useValue: {
					registrations: () =>
						of(
							options.registrations ?? [
								{ id: 'reg_wb', gstin: '19DBYPS6736R1ZZ', active: true },
								{ id: 'reg_tr', gstin: '16ABCDE1234F1Z5' },
								{ id: 'reg_old', gstin: 'X', active: false },
							],
						),
				},
			},
			{ provide: BooksCatchUpGateway, useValue: { summary: () => NEVER, run: () => NEVER } },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['accounts.lock']) } },
		],
	});
	const fixture = TestBed.createComponent(PeriodsPage);
	return { fixture, page: fixture.componentInstance, gateway, modals, notifier, opened };
}

const template = {} as never;

describe('a column’s state', () => {
	it('is the strictest of its parts, open when none is set', () => {
		expect(columnState(grid.locks as never, '2026-04', ['cash', 'bank'])).toBe('locked');
		expect(columnState(grid.locks as never, '2026-04', ['cash'])).toBe('closed_for_staff');
		expect(columnState(grid.locks as never, '2026-05', ['sales'])).toBe('open');
	});
});

describe('Accounts › Periods and locks', () => {
	it('shows this financial year or the one before, with each month’s GSTR-3B', async () => {
		const { fixture, page } = setup();
		expect([page.months(), page.yearLabel()]).toEqual([[], '']);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.months()).toHaveLength(12));
		await vi.waitFor(() => expect(page.activeRegistrations()).toHaveLength(2));
		fixture.detectChanges();
		expect(page.months()[0]).toBe('2026-04');
		expect(page.yearLabel()).toBe('2026-27');
		page.year.set('last');
		expect(page.months()[0]).toBe('2025-04');
		expect(page.state('2026-04', ['cash', 'bank'])).toBe('locked');
		expect(page.gstr3b('2026-04')).toEqual({ filed: 1, of: 2 });
		expect(page.gstr3b('2026-05')).toEqual({ filed: 0, of: 2 });
		const bare = setup({ grid: { months } });
		expect(bare.page.state('2026-04', ['sales'])).toBe('open');
		expect(bare.page.gstr3b('2026-04')).toEqual({ filed: 0, of: 0 });
		bare.fixture.detectChanges();
		await vi.waitFor(() => expect(bare.page.activeRegistrations()).toHaveLength(2));
		await vi.waitFor(() => expect(bare.page.grid.data()).toBeTruthy());
		expect(bare.page.unfiledRegistrations()).toHaveLength(2);
	});

	it('marks a month’s GSTR-3B filed, with its acknowledgement, and says why when it can’t', async () => {
		const { fixture, page, gateway, notifier, opened } = setup({ picked: [{ assetId: 'ast_1', name: 'ack.pdf' }] });
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.activeRegistrations()).toHaveLength(2));
		await vi.waitFor(() => expect(page.grid.data()).toBeTruthy());
		page.openFile(template, '2026-04');
		expect(page.fileRegistration()).toBe('reg_tr');
		expect(page.fileGstin()).toBe('16ABCDE1234F1Z5');
		await page.attachAck();
		expect(page.acknowledgement()).toEqual({ assetId: 'ast_1', name: 'ack.pdf' });
		page.arn.set('AA1911260012345');
		await page.markFiled();
		expect(gateway.markFiled).toHaveBeenCalledWith(
			expect.objectContaining({ gstRegistrationId: 'reg_tr', month: '2026-04', arn: 'AA1911260012345' }),
		);
		expect(notifier.showSuccess).toHaveBeenCalled();
		expect(opened[0]?.close).toHaveBeenCalled();
		page.fileRegistration.set('reg_none');
		expect(page.fileGstin()).toBe('');
		page.openFile(template, '2026-05');
		expect(page.unfiledRegistrations().map((r) => r.id)).toEqual(['reg_wb', 'reg_tr']);

		const none = setup({ picked: 'dismissed', registrations: [] });
		none.page.openFile(template, '2026-04');
		expect(none.page.fileRegistration()).toBe('');
		await none.page.attachAck();
		expect(none.page.acknowledgement()).toBeNull();
		const nothing = setup({ picked: [] });
		await nothing.page.attachAck();
		expect(nothing.page.acknowledgement()).toBeNull();

		for (const [fail, words] of [
			[{ error: { error: { message: 'gst_already_filed' } } }, 'accounts_gst_already_filed'],
			[new Error('down'), 'accounts_gst_file_failed'],
		] as const) {
			const failing = setup({ fail });
			await failing.page.markFiled();
			expect(failing.notifier.showError).toHaveBeenCalledWith(expect.stringContaining(words));
			expect(failing.page.filing()).toBe(false);
		}
		const readOnly = setup({ permissions: [] });
		readOnly.page.openFile(template, '2026-04');
		expect(readOnly.modals.open).not.toHaveBeenCalled();
	});

	it('opens Lock a month on a chosen month, this month, the first, or none', async () => {
		const { fixture, page, opened } = setup();
		page.open(template);
		expect(page.lockMonth()).toBe('');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.months()).toHaveLength(12));
		page.open(template, '2026-06');
		expect(page.lockMonth()).toBe('2026-06');
		expect(page.modalOpen()).toBe(true);
		await opened[1]?.result;
		await Promise.resolve();
		expect(page.modalOpen()).toBe(false);
		page.open(template);
		const current = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
		expect(page.lockMonth()).toBe(months.slice(12).includes(current) ? current : '2026-04');
		page.year.set('last');
		page.open(template);
		expect(page.lockMonth()).toBe('2025-04');
		const locked = setup({ permissions: [], dialog: 'open' });
		locked.fixture.detectChanges();
		locked.page.open(template, '2026-06');
		locked.fixture.detectChanges();
		expect(locked.gateway.periodChecks).not.toHaveBeenCalled();
		const checking = setup({ dialog: 'open' });
		checking.fixture.detectChanges();
		checking.page.open(template, '2026-06');
		checking.fixture.detectChanges();
		await vi.waitFor(() => expect(checking.gateway.periodChecks).toHaveBeenCalledWith('2026-06'));
		const dismissed = setup({ dialog: 'dismissed' });
		dismissed.page.open(template, '2026-06');
		await vi.waitFor(() => expect(dismissed.page.modalOpen()).toBe(false));
	});

	it('locks everything or chosen parts with a reason, and says why when it can’t', async () => {
		const { page, gateway, notifier, opened } = setup();
		page.toggle('cash', true);
		page.toggle('bank', true);
		page.toggle('cash', false);
		expect([...page.chosen()]).toEqual(['bank']);
		await page.lock();
		expect(gateway.lock).toHaveBeenCalledWith(expect.objectContaining({ parts: page.allParts }));
		page.open(template, '2026-06');
		page.everything.set(false);
		page.toggle('bank', true);
		page.reason.set('Month closed');
		await page.lock();
		expect(gateway.lock).toHaveBeenLastCalledWith({
			months: ['2026-06'],
			parts: ['bank'],
			state: 'locked',
			reason: 'Month closed',
		});
		expect(notifier.showSuccess).toHaveBeenCalledTimes(2);
		expect(opened[0]?.close).toHaveBeenCalled();
		for (const [fail, words] of [
			[{ error: { error: { message: 'reopen_super_admin_only' } } }, 'accounts_reopen_super_admin'],
			[new Error('down'), 'accounts_period_failed'],
		] as const) {
			const failing = setup({ fail });
			await failing.page.lock();
			expect(failing.notifier.showError).toHaveBeenCalledWith(expect.stringContaining(words));
			expect(failing.page.busy()).toBe(false);
		}
	});
});
