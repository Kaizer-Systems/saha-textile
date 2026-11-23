import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SelfInvoicePage } from './self-invoice-page';

/** D3: an issued self-invoice, paid with a payment voucher. */

const invoice = (patch: Record<string, unknown> = {}) => ({
	id: 'si_1',
	number: 'SI/26-27/000002',
	status: 'issued',
	version: 1,
	supplierName: 'Bose Properties',
	rule: { name: 'Rent of the shop', code: '997212', templateCode: 'RS-RCM', templateVersion: 1 },
	forMonth: '2026-11',
	receivedOn: '2026-11-01',
	date: '2026-11-21',
	taxableINR: 60_000,
	taxINR: 10_800,
	paidINR: 0,
	late: false,
	cancelReason: null,
	...patch,
});

function setup(
	options: {
		current?: Record<string, unknown>;
		fail?: string | null;
		permissions?: string[];
		banks?: number;
		cancelResult?: unknown;
		id?: string | null;
	} = {},
) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const opened: unknown[] = [];
	const asked: { start: ReturnType<typeof vi.fn> } = { start: vi.fn() };
	const fail = () => throwError(() => ({ error: { error: { message: options.fail } } }));
	const gateway = {
		get: () => of(invoice(options.current)),
		log: () =>
			of([
				{
					at: '2026-11-21T08:35:00.000Z',
					who: 'Owner',
					role: null,
					action: 'selfInvoice.issue',
					diffs: [],
					metadata: { number: 'SI/26-27/000002', late: false },
				},
			]),
		paymentVouchers: () =>
			of([
				{
					id: 'pv_1',
					number: 'PV/26-27/000007',
					date: '2026-11-21',
					mode: 'cash',
					reference: null,
					amountINR: 60_000,
				},
			]),
		pdf: vi.fn(() => of(new Blob(['%PDF']))),
		pay: vi.fn(() => (options.fail ? fail() : of({ invoice: invoice(), voucher: { number: 'PV/26-27/000007' } }))),
		cancel: vi.fn(() => (options.fail ? fail() : of(invoice({ status: 'cancelled' })))),
	};
	const banks = Array.from({ length: options.banks ?? 2 }, (_, i) => ({
		id: `led_${i}`,
		name: `Bank ${i}`,
		groupId: 'g_bank',
		active: true,
	}));
	const chart = vi.fn(() =>
		of({ groups: [{ id: 'g_bank', systemKey: 'bank_accounts', parentId: null }], ledgers: banks }),
	);
	const modals = {
		open: vi.fn((t: unknown) => {
			opened.push(t);
			return typeof t === 'function'
				? {
						componentInstance: asked,
						result:
							options.cancelResult === 'dismissed'
								? Promise.reject(new Error('dismissed'))
								: Promise.resolve(options.cancelResult ?? null),
					}
				: { close: () => undefined };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [SelfInvoicePage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id === null ? {} : { id: 'si_1' })) },
			},
			{ provide: SelfInvoicesGateway, useValue: gateway },
			{ provide: LedgerGateway, useValue: { chart } },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['purchase.payment', 'accounts.post']) },
			},
		],
	});
	const fixture = TestBed.createComponent(SelfInvoicePage);
	return { fixture, page: fixture.componentInstance, gateway, chart, notifier, opened, asked };
}

describe('an issued self-invoice (D3)', () => {
	it('shows the day it was made on, what is owed, and offers Pay and Cancel to the right people', async () => {
		const { fixture, page } = setup();
		expect([page.madeOnDay(), page.owed(), page.canPay(), page.canCancel(), page.logRows()]).toEqual([
			0,
			0,
			false,
			false,
			[],
		]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.invoice.data()).toBeTruthy());
		await vi.waitFor(() => expect(page.logRows()).toHaveLength(1));
		expect([page.madeOnDay(), page.owed(), page.canPay(), page.canCancel()]).toEqual([20, 60_000, true, true]);
		expect([page.day('2026-11-21'), page.monthName('2026-11')]).toEqual(['21 Nov 2026', 'November 2026']);
		for (const options of [
			{ current: { paidINR: 60_000 } },
			{ permissions: [] },
			{ current: { status: 'cancelled', date: null } },
		]) {
			const other = setup(options);
			other.fixture.detectChanges();
			await vi.waitFor(() => expect(other.page.invoice.data()).toBeTruthy());
			expect([other.page.canPay(), other.page.canCancel()]).toEqual([false, false]);
		}
		expect(setup({ id: null }).page.id()).toBe('');
	});

	it('opens a draft in the D2 form', async () => {
		const { fixture } = setup({ current: { status: 'draft', number: null, date: null } });
		const router = TestBed.inject(Router);
		const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
		fixture.detectChanges();
		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/accounts/self-invoices', 'si_1', 'edit']));
	});

	it('pays with a voucher: from the chosen bank when there are several, cash from the cash ledger', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		vi.spyOn(window, 'open').mockReturnValue(null);
		const { fixture, page, gateway, chart, notifier, opened } = setup();
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.owed()).toBe(60_000));
		await page.print();
		expect(gateway.pdf).toHaveBeenCalledWith('si_1');
		await page.openPay('pay' as never);
		await page.openPay('pay' as never);
		expect([opened, chart.mock.calls.length, page.amount()]).toEqual([['pay', 'pay'], 1, '60000']);
		expect([page.choosesBank(), page.canConfirm(), page.settles()]).toEqual([true, false, true]);
		page.paidFrom.set('led_1');
		page.reference.set(' NEFT 7712 ');
		expect(page.canConfirm()).toBe(true);
		await page.pay(page.invoice.data() as never);
		expect(gateway.pay).toHaveBeenCalledWith('si_1', {
			amountINR: 60_000,
			paidOn: page.today,
			mode: 'bank_transfer',
			reference: 'NEFT 7712',
			paidFromLedgerId: 'led_1',
			version: 1,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('si_paid_done'));
		page.mode.set('cash');
		page.reference.set('');
		page.amount.set('100');
		expect([page.choosesBank(), page.settles(), page.canConfirm()]).toEqual([false, false, true]);
		await page.pay(page.invoice.data() as never);
		expect(gateway.pay).toHaveBeenLastCalledWith(
			'si_1',
			expect.objectContaining({ reference: null, paidFromLedgerId: null }),
		);
		for (const amount of ['abc', '0', '70000']) {
			page.amount.set(amount);
			expect(page.canConfirm()).toBe(false);
		}
		page.amount.set('abc');
		expect(page.settles()).toBe(false);
	});

	it('says why a payment was refused, in words when it knows the refusal', async () => {
		for (const [fail, shown] of [
			['overpayment', 'si_problem_overpayment'],
			['Network down', 'Network down'],
		]) {
			const { page, notifier } = setup({ fail });
			await page.pay(invoice() as never);
			expect(notifier.showError).toHaveBeenCalledWith(expect.stringContaining(shown));
			expect(page.busy()).toBe(false);
		}
	});

	it('cancels through the reason popup, with the refusal in words', async () => {
		const { page, gateway, asked } = setup({ cancelResult: invoice({ status: 'cancelled' }) });
		await page.cancel(invoice() as never);
		const ask = asked.start.mock.calls[0]?.[0] as { act: (reason: string) => Promise<unknown> };
		await ask.act('Typed twice');
		expect(gateway.cancel).toHaveBeenCalledWith('si_1', { reason: 'Typed twice', version: 1 });
		await setup({ cancelResult: 'dismissed' }).page.cancel(invoice() as never);
		const refused = setup({ fail: 'only_super_admin' });
		await refused.page.cancel(invoice() as never);
		const refusedAsk = refused.asked.start.mock.calls[0]?.[0] as { act: (reason: string) => Promise<unknown> };
		await expect(refusedAsk.act('x')).rejects.toMatchObject({
			error: { message: expect.stringContaining('si_problem_only_super_admin') },
		});
	});
});
