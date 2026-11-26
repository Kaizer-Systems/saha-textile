import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EntryView } from './entry-view';

/**
 * A purchase entry's page (p10, p10b, x03), with each payment's own voucher (accounts brief D4, decision D5). The
 * template is left out here: these are the page's own decisions.
 */

const entry = (patch: Record<string, unknown> = {}) => ({
	id: 'pe_31',
	number: 'PE/26-27/00031',
	billNumber: 'NWC/2241',
	status: 'posted',
	paymentStatus: 'unpaid',
	postedAt: '2026-11-20T00:00:00.000Z',
	checkedAt: null,
	totals: { totalINR: 48_400 },
	paidINR: 8_400,
	warnings: [{ code: 'margin_floor', lineId: 'l2' }],
	acceptedWarnings: [
		{ code: 'margin_floor', lineId: 'l1' },
		{ code: 'other', lineId: 'l3' },
	],
	...patch,
});

interface Opened {
	componentInstance: { start: ReturnType<typeof vi.fn> };
	result: Promise<unknown>;
}

function setup(
	options: {
		id?: string | null;
		current?: Record<string, unknown> | null;
		results?: unknown[];
		voidError?: unknown;
		permissions?: string[];
	} = {},
) {
	const results = [...(options.results ?? [])];
	const opened: Opened[] = [];
	const modals = {
		open: vi.fn(() => {
			const next = results.shift();
			const popup: Opened = {
				componentInstance: { start: vi.fn() },
				result: next === 'dismissed' ? Promise.reject(new Error('dismissed')) : Promise.resolve(next ?? null),
			};
			opened.push(popup);
			return popup;
		}),
	};
	const router = { navigate: vi.fn() };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		entry: vi.fn(() => of(options.current === null ? null : entry(options.current ?? {}))),
		payments: vi.fn(() => of([{ id: 'pay_1' }])),
		returnsForEntry: vi.fn(() => of([])),
		entryActivity: vi.fn(() => of([{ action: 'purchase.entry.post', actorName: 'Owner' }])),
		reversePayment: vi.fn(() => of({})),
		voidEntry: vi.fn(() => (options.voidError ? throwError(() => options.voidError) : of(entry()))),
	};
	const vouchers = {
		purchaseEntryVouchers: vi.fn(() => of([{ id: 'pv_6', number: 'PV/6', supplierPaymentId: 'pay_1' }])),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [EntryView, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(options.id === null ? {} : { id: 'pe_31' }) } },
			},
			{ provide: Router, useValue: router },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: SelfInvoicesGateway, useValue: vouchers },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['stock.cost', 'purchase_return.index']) },
			},
		],
	});
	TestBed.overrideComponent(EntryView, { set: { template: '' } });
	const fixture = TestBed.createComponent(EntryView);
	return { fixture, page: fixture.componentInstance, gateway, vouchers, router, notifier, opened };
}

describe('a purchase entry’s page', () => {
	it('reads the entry, its step, what is left, who posted it, and the lines under the margin floor', async () => {
		const { fixture, page } = setup();
		expect([page.entry(), page.step(), page.left(), page.postedBy(), page.lowMargin().size]).toEqual([
			null,
			0,
			0,
			null,
			0,
		]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.entry()).toBeTruthy());
		await vi.waitFor(() => expect(page.postedBy()).toBe('Owner'));
		expect([page.step(), page.left(), page.canSeeCost(), [...page.lowMargin()]]).toEqual([
			2,
			40_000,
			true,
			['l1', 'l2'],
		]);
		expect(page.t('x')).toContain('x');
		expect([typeof page.returnStatus, typeof page.returnWhy]).toEqual(['function', 'function']);
		const draft = setup({ current: { status: 'draft', warnings: undefined, acceptedWarnings: undefined } });
		draft.fixture.detectChanges();
		await vi.waitFor(() => expect(draft.page.entry()).toBeTruthy());
		expect([draft.page.step(), draft.page.left(), draft.page.lowMargin().size]).toEqual([0, 0, 0]);
		expect(setup({ id: null }).page.id()).toBe('');
	});

	it('lists each payment with its own voucher, and returns only with the right to see them', async () => {
		const { fixture, page, gateway, vouchers } = setup();
		expect(page.voucherOf().size).toBe(0);
		page.tab.set('payments');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.voucherOf().get('pay_1')?.number).toBe('PV/6'));
		expect(vouchers.purchaseEntryVouchers).toHaveBeenCalledWith('pe_31');
		await vi.waitFor(() => expect(page.payments.data()).toEqual([{ id: 'pay_1' }]));
		page.tab.set('returns');
		fixture.detectChanges();
		await vi.waitFor(() => expect(gateway.returnsForEntry).toHaveBeenCalledWith('pe_31'));
	});

	it('goes to edit, check, return and labels', () => {
		const { page, router } = setup();
		page.edit();
		page.check();
		page.returnToSupplier();
		page.labels();
		expect(router.navigate.mock.calls).toEqual([
			[['/purchase-entries', 'pe_31', 'edit']],
			[['/purchase-entries', 'pe_31', 'check']],
			[['/purchase-returns', 'create'], { queryParams: { entry: 'pe_31' } }],
			[['/purchase-entries', 'pe_31', 'labels']],
		]);
	});

	it('records a payment through the popup with what is left, and says so when saved', async () => {
		const none = setup();
		await none.page.recordPayment();
		expect(none.opened).toHaveLength(0);
		const { fixture, page, notifier, opened } = setup({ results: [{ id: 'pe_31' }, 'dismissed'] });
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.entry()).toBeTruthy());
		await page.recordPayment();
		expect(opened[0]?.componentInstance.start).toHaveBeenCalledWith([
			expect.objectContaining({ id: 'pe_31', number: 'PE/26-27/00031', leftINR: 40_000 }),
		]);
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('payment_saved'));
		await page.recordPayment();
		expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
		const unnumbered = setup({ current: { number: null } });
		unnumbered.fixture.detectChanges();
		await vi.waitFor(() => expect(unnumbered.page.entry()).toBeTruthy());
		await unnumbered.page.recordPayment();
		expect(unnumbered.opened[0]?.componentInstance.start).toHaveBeenCalledWith([
			expect.objectContaining({ number: '' }),
		]);
	});

	it('reverses a payment with a reason', async () => {
		const { page, gateway, notifier, opened } = setup({ results: [true, null] });
		await page.reversePayment({ id: 'pay_1', amountINR: 100 } as never);
		const ask = opened[0]?.componentInstance.start.mock.calls[0]?.[0] as {
			act: (reason: string) => Promise<unknown>;
		};
		await ask.act('Typed twice');
		expect(gateway.reversePayment).toHaveBeenCalledWith('pe_31', 'pay_1', 'Typed twice');
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('payment_reversed'));
		await page.reversePayment({ id: 'pay_2', amountINR: 1 } as never);
		expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
	});

	it('voids an entry, or names the pieces that moved on and offers a return', async () => {
		const none = setup({ current: null });
		none.fixture.detectChanges();
		await none.page.voidEntry();
		expect(none.opened).toHaveLength(0);

		const voided = setup({ results: [entry()] });
		voided.fixture.detectChanges();
		await vi.waitFor(() => expect(voided.page.entry()).toBeTruthy());
		await voided.page.voidEntry();
		const ask = voided.opened[0]?.componentInstance.start.mock.calls[0]?.[0] as {
			act: (reason: string) => Promise<unknown>;
		};
		expect(await ask.act('Wrong bill')).toMatchObject({ id: 'pe_31' });
		expect(voided.notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('entry_voided'));
		const unnumbered = setup({ current: { number: null }, results: [entry()] });
		unnumbered.fixture.detectChanges();
		await vi.waitFor(() => expect(unnumbered.page.entry()).toBeTruthy());
		await unnumbered.page.voidEntry();
		expect(unnumbered.opened[0]?.componentInstance.start).toHaveBeenCalledWith(
			expect.objectContaining({ params: { number: '' } }),
		);

		const moved = {
			error: {
				error: { issues: [{ code: 'void_stock_moved', message: 'BAN-3 sold', path: ['void_stock_moved'] }] },
			},
		};
		const blocked = setup({ results: [{ blocked: [{ code: 'void_stock_moved' }] }, 'return'], voidError: moved });
		blocked.fixture.detectChanges();
		await vi.waitFor(() => expect(blocked.page.entry()).toBeTruthy());
		await blocked.page.voidEntry();
		const blockedAsk = blocked.opened[0]?.componentInstance.start.mock.calls[0]?.[0] as {
			act: (reason: string) => Promise<unknown>;
		};
		expect(await blockedAsk.act('x')).toEqual({ blocked: [expect.objectContaining({ code: 'void_stock_moved' })] });
		expect(blocked.opened[1]?.componentInstance.start).toHaveBeenCalled();
		expect(blocked.router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'create'], {
			queryParams: { entry: 'pe_31' },
		});

		const stays = setup({ results: [{ blocked: [] }, 'dismissed', null], voidError: new Error('down') });
		stays.fixture.detectChanges();
		await vi.waitFor(() => expect(stays.page.entry()).toBeTruthy());
		await stays.page.voidEntry();
		expect(stays.router.navigate).not.toHaveBeenCalled();
		const stayAsk = stays.opened[0]?.componentInstance.start.mock.calls[0]?.[0] as {
			act: (reason: string) => Promise<unknown>;
		};
		await expect(stayAsk.act('x')).rejects.toThrow('down');
		await stays.page.voidEntry();
		expect(stays.notifier.showSuccess).not.toHaveBeenCalled();
	});
});
