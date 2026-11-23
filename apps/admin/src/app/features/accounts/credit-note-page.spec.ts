import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { ReturnsGateway } from '@core/accounts/returns.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CreditNotePage } from './credit-note-page';

import type { CreditNote } from '@saha-textile/contracts';

const note = (patch: Partial<CreditNote> = {}) =>
	({
		id: 'cn_1',
		orderId: 'ord_1',
		status: 'draft',
		kind: 'goods_returned',
		version: 0,
		number: null,
		date: '2026-11-25',
		invoiceDate: '2026-11-18',
		invoiceNumber: 'TI/26-27/000145',
		orderNumber: 'ST-2611-482190',
		deadline: '2027-11-30',
		buyer: { name: 'Ananya Das' },
		placeOfSupply: '19',
		reason: 'Damaged',
		refundTo: 'original_payment',
		taxableINR: 0,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 0,
		totalINR: 0,
		lines: [
			{ lineId: 'delivery', delivery: true, ratePercent: 0 },
			{ lineId: 'a', delivery: false, ratePercent: 5 },
		],
		...patch,
	}) as unknown as CreditNote;

function setup(
	options: { fail?: boolean; checks?: Record<string, unknown>; id?: string | null; current?: CreditNote } = {},
) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const opened: unknown[] = [];
	const fail = () => throwError(() => ({ error: { error: { message: 'credit_note_problem:past_deadline' } } }));
	const gateway = {
		creditNote: () => of(options.current ?? note()),
		saveDraft: vi.fn(() => (options.fail ? fail() : of(note()))),
		deleteDraft: vi.fn(() => of(undefined)),
		issue: vi.fn(() => (options.fail ? throwError(() => new Error('down')) : of(note({ status: 'issued' })))),
		creditNotePdf: vi.fn(() => of(new Blob(['%PDF']))),
		debitNotePdf: vi.fn(() => of(new Blob(['%PDF']))),
		cancelChecks: () =>
			of({
				monthFiled: false,
				booksClosed: false,
				refundPaid: false,
				superAdmin: true,
				allowed: true,
				month: '2026-11',
				...options.checks,
			}),
		cancel: vi.fn(() => of(note({ status: 'cancelled' }))),
		debitNote: vi.fn(() => of({ id: 'dn_1' })),
		refund: vi.fn(() => of(note({ status: 'issued' }))),
	};
	const chart = {
		groups: [
			{ id: 'g_ca', systemKey: 'current_assets', parentId: null },
			{ id: 'g_bank', systemKey: 'bank_accounts', parentId: 'g_ca' },
			{ id: 'g_hdfc', systemKey: null, parentId: 'g_bank' },
			{ id: 'g_exp', systemKey: null, parentId: null },
		],
		ledgers: [
			{ id: 'led_hdfc', name: 'HDFC', groupId: 'g_hdfc', active: true },
			{ id: 'led_old', name: 'Old', groupId: 'g_bank', active: false },
			{ id: 'led_rent', name: 'Rent', groupId: 'g_exp', active: true },
			{ id: 'led_lost', name: 'Lost', groupId: 'g_gone', active: true },
		],
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			CreditNotePage,
			TranslocoTestingModule.forRoot({
				langs: { en: { inv_outside_india: 'Outside India (96)' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id === null ? {} : { id: options.id ?? 'cn_1' })) },
			},
			{ provide: ReturnsGateway, useValue: gateway },
			{
				provide: NgbModal,
				useValue: { open: (template: unknown) => (opened.push(template), { close: () => undefined }) },
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: LedgerGateway, useValue: { chart: () => of(chart) } },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['refund.action']) } },
		],
	});
	const fixture = TestBed.createComponent(CreditNotePage);
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	return { fixture, page: fixture.componentInstance, gateway, notifier, navigate, opened };
}

describe('a credit note’s page (B4, B5, B8, B9)', () => {
	it('loads the note and works out what the page shows', async () => {
		const { fixture, page } = setup();
		expect([page.draft(), page.goodsKind(), page.ratePercent()]).toEqual([false, true, 0]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.note.data()).toBeTruthy());
		expect([page.draft(), page.goodsKind(), page.ratePercent()]).toEqual([true, true, 5]);
		const priced = setup({ current: note({ kind: 'price_adjustment', lines: [] }) });
		priced.fixture.detectChanges();
		await vi.waitFor(() => expect(priced.page.note.data()).toBeTruthy());
		expect([priced.page.goodsKind(), priced.page.ratePercent()]).toEqual([false, 0]);
		expect(setup({ id: null }).page.id()).toBe('');
	});

	it('names States and days, and keeps a draft’s quantities within the line', () => {
		const { page } = setup();
		expect(page.state('27')).toBe('Maharashtra (27)');
		expect(page.state('00')).toBe('00 (00)');
		expect(page.state('96')).toBe('Outside India (96)');
		expect(page.day('2026-11-25')).toBe('25 Nov 2026');
		expect(page.quantity('a', 2)).toBe(2);
		page.setQuantity('a', 5, 2);
		page.setQuantity('b', Number.NaN, 2);
		expect([page.quantity('a', 2), page.quantity('b', 2)]).toEqual([2, 0]);
		expect(page.inr(4680)).toBe('₹4,680.00');
	});

	it('saves, deletes, issues and prints', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		vi.spyOn(window, 'open').mockReturnValue(null);
		const { page, gateway, navigate, notifier } = setup();
		page.setQuantity('a', 1, 2);
		await page.save(note());
		expect(gateway.saveDraft).toHaveBeenCalledWith('cn_1', { version: 0, lines: [{ lineId: 'a', quantity: 1 }] });
		expect(page.quantities()).toEqual({});
		await page.remove(note());
		expect(navigate).toHaveBeenCalledWith(['/order/details', 'ord_1']);
		await page.issue(note());
		await page.print(note());
		await page.printDebit('dn_1');
		expect(gateway.debitNotePdf).toHaveBeenCalledWith('dn_1');
		expect(notifier.showSuccess).toHaveBeenCalledTimes(3);
	});

	it('opens the cancel pop-up while the month is open, the blocked one once it isn’t, then cancels or undoes', async () => {
		const open = setup();
		await open.page.openCancel('cancel' as never, 'blocked' as never, note());
		expect(open.opened).toEqual(['cancel']);
		open.page.reason.set('Wrong invoice');
		await open.page.cancel(note());
		expect(open.gateway.cancel).toHaveBeenCalledWith('cn_1', 'Wrong invoice');
		for (const checks of [{ monthFiled: true }, { booksClosed: true }]) {
			const blocked = setup({ checks });
			await blocked.page.openCancel('cancel' as never, 'blocked' as never, note());
			expect(blocked.opened).toEqual(['blocked']);
			blocked.page.openDebit('debit' as never);
			blocked.page.reason.set('October filed');
			await blocked.page.debit(note());
			expect(blocked.gateway.debitNote).toHaveBeenCalledWith('cn_1', 'October filed');
		}
		const fresh = setup();
		fresh.page.openDebit('debit' as never);
		expect(fresh.opened).toEqual(['debit']);
	});

	it('says why a save was refused', async () => {
		const { page, notifier } = setup({ fail: true });
		await page.save(note());
		await page.issue(note());
		expect(notifier.showError).toHaveBeenCalledTimes(2);
		expect(page.busy()).toBe(false);
	});

	it('offers Refund now on an issued note with a refund due, paying by gateway or by hand from a cash or bank ledger', async () => {
		const due = note({ status: 'issued', refund: { status: 'due' } as never });
		const { fixture, page, gateway, opened } = setup({ current: due });
		expect(page.payFrom()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.canRefund()).toBe(true));
		await vi.waitFor(() => expect(page.payFrom().map((l) => l.id)).toEqual(['led_hdfc']));
		page.openRefund('refund' as never);
		expect(opened).toEqual(['refund']);
		await page.refund(due);
		expect(gateway.refund).toHaveBeenLastCalledWith('cn_1', { how: 'gateway' });
		page.refundHow.set('by_hand');
		page.refundLedger.set('led_hdfc');
		page.refundReference.set('UTR123456');
		await page.refund(due);
		expect(gateway.refund).toHaveBeenLastCalledWith('cn_1', {
			how: 'by_hand',
			method: 'bank_transfer',
			ledgerId: 'led_hdfc',
			reference: 'UTR123456',
		});
		for (const current of [
			note({ status: 'issued', refund: { status: 'kept' } as never }),
			note({ status: 'issued', debitNoteId: 'dn_1', refund: { status: 'due' } as never }),
		]) {
			const other = setup({ current });
			other.fixture.detectChanges();
			await vi.waitFor(() => expect(other.page.note.data()).toBeTruthy());
			expect(other.page.canRefund()).toBe(false);
		}
		const noRight = setup({ current: due, permissions: [] });
		noRight.fixture.detectChanges();
		await vi.waitFor(() => expect(noRight.page.note.data()).toBeTruthy());
		expect(noRight.page.canRefund()).toBe(false);
	});
});
