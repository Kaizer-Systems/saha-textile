import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { VoucherFormPage, contraOf } from './voucher-form';

/** Accounts › Vouchers › New voucher (accounts brief Q3, Q4): tabs, the contra form, drafts, checks and Post. */

const chart = {
	groups: [
		{ id: 'g_cash', systemKey: 'cash_in_hand', roles: [], parentId: null },
		{ id: 'g_tills', systemKey: null, roles: [], parentId: 'g_cash' },
		{ id: 'g_banks', systemKey: null, roles: ['bank_accounts'], parentId: null },
		{ id: 'g_exp', systemKey: 'expenses', roles: [], parentId: null },
	],
	ledgers: [
		{ id: 'cash', name: 'Cash', groupId: 'g_cash', handPosting: true, active: true },
		{ id: 'till', name: 'Counter till', groupId: 'g_tills', handPosting: true, active: true },
		{ id: 'hdfc', name: 'HDFC', groupId: 'g_banks', handPosting: true, active: true },
		{ id: 'rent', name: 'Rent', groupId: 'g_exp', handPosting: true, active: true },
		{ id: 'sales', name: 'Sales', groupId: 'g_exp', handPosting: false, active: true },
	],
};

function setup(
	options: {
		draftId?: string | null;
		draft?: unknown;
		locks?: unknown[];
		saveFails?: unknown;
		postFails?: unknown;
		picked?: unknown;
		locations?: unknown[];
	} = {},
) {
	const gateway = {
		chart: vi.fn(() => of(chart)),
		periods: vi.fn(() => of({ locks: options.locks ?? [] })),
		draft: vi.fn(() => of(options.draft)),
		saveDraft: vi.fn(() =>
			options.saveFails ? throwError(() => options.saveFails) : of({ id: 'vd_9', updatedAt: 'u2' }),
		),
		post: vi.fn(() =>
			options.postFails ? throwError(() => options.postFails) : of({ id: 'jv_9', number: 'JV/26-27/000031' }),
		),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const modals = {
		open: vi.fn(() => ({
			componentInstance: { start: vi.fn() },
			result:
				options.picked === undefined ? Promise.reject(new Error('closed')) : Promise.resolve(options.picked),
		})),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			VoucherFormPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.draftId ? { draftId: options.draftId } : {})) },
			},
			{ provide: LedgerGateway, useValue: gateway },
			{
				provide: LocationsGateway,
				useValue: {
					list: vi.fn(() => of(options.locations ?? [{ id: 'loc_gar', name: 'Gariahat', active: true }])),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modals },
		],
	});
	const fixture = TestBed.createComponent(VoucherFormPage);
	const router = TestBed.inject(Router);
	const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);
	return { fixture, page: fixture.componentInstance, gateway, notifier, go };
}

async function ready(options: Parameters<typeof setup>[0] = {}) {
	const made = setup(options);
	made.fixture.detectChanges();
	await vi.waitFor(() => expect(made.page.chart.data()).toBeTruthy());
	await vi.waitFor(() => expect(made.page.locations.data()).toBeTruthy());
	await vi.waitFor(() => expect(made.page.periods.data()).toBeTruthy());
	made.fixture.detectChanges();
	return made;
}

describe('a contra draft read back', () => {
	it('finds To on the debit line, From on the credit line, and the deposit slip', () => {
		expect(
			contraOf([
				{ ledgerId: 'hdfc', locationId: 'l', debit: '4412', credit: '', narration: 'Deposit slip 000781' },
				{ ledgerId: 'cash', locationId: 'l', debit: '', credit: '4412', narration: '' },
			]),
		).toEqual({ from: 'cash', to: 'hdfc', amount: '4412', slip: '000781' });
		expect(contraOf([{ ledgerId: 'hdfc', locationId: '', debit: '5', credit: '', narration: 'other' }])).toEqual({
			from: '',
			to: 'hdfc',
			amount: '5',
			slip: '',
		});
		expect(contraOf([])).toEqual({ from: '', to: '', amount: '', slip: '' });
	});
});

describe('the voucher form', () => {
	it('opens on Journal with tabs in the drawn order, and makes a contra from From, To and Amount', async () => {
		expect(setup().page.moneyLedgers()).toEqual([]);
		const { fixture, page } = await ready();
		expect(page.kinds).toEqual(['receipt', 'payment', 'contra', 'journal']);
		expect(page.kind()).toBe('journal');
		expect(page.moneyLedgers().map((l) => l.id)).toEqual(
			['till', 'cash', 'hdfc'].sort((a, b) => (a === 'hdfc' ? 1 : b === 'hdfc' ? -1 : a.localeCompare(b))),
		);
		page.setKind('contra');
		page.setContra({ from: 'cash', to: 'hdfc', amount: '4412', slip: '000781' });
		expect(page.rows()).toEqual([
			{ ledgerId: 'hdfc', locationId: 'loc_gar', debit: '4412', credit: '', narration: 'Deposit slip 000781' },
			{ ledgerId: 'cash', locationId: 'loc_gar', debit: '', credit: '4412', narration: '' },
		]);
		expect(page.canPost()).toBe(true);
		fixture.detectChanges();
		expect((fixture.nativeElement as HTMLElement).querySelector('#contra_from')).not.toBeNull();
		page.setContra({ to: 'cash' });
		expect(page.canPost()).toBe(false);
		page.setContra({ slip: '' });
		expect(page.rows()[0]?.narration).toBe('');
		page.setKind('receipt');
		expect(page.kind()).toBe('receipt');
		fixture.detectChanges();
	});

	it('edits journal lines, checks them, and refuses to post into a locked month', async () => {
		const month = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
		const { page } = await ready({ locks: [{ month, part: 'journal', state: 'locked' }], locations: [] });
		page.setRow(0, { ledgerId: 'rent', locationId: 'loc', debit: '100' });
		page.setRow(1, { ledgerId: 'cash', locationId: 'loc', credit: '100' });
		expect(page.checks().balanced).toBe(true);
		expect(page.periodState()).toBe('locked');
		expect(page.canPost()).toBe(false);
		page.addRow();
		expect(page.rows()).toHaveLength(3);
		expect(page.rows()[2]?.locationId).toBe('loc');
		page.removeRow(2);
		page.removeRow(1);
		expect(page.rows()).toHaveLength(2);
		page.setKind('contra');
		expect(page.rows()[0]?.locationId).toBe('');
		await page.post();
	});

	it('attaches files from the Media Library once each, and removes one', async () => {
		// The same file picked twice is attached once.
		const picked = [{ assetId: 'a1', name: 'bill.pdf' }];
		const { page } = await ready({ picked });
		await page.attach();
		await page.attach();
		expect(page.attachments()).toEqual([{ assetId: 'a1', name: 'bill.pdf' }]);
		page.removeAttachment('a1');
		expect(page.attachments()).toEqual([]);
		const closed = await ready();
		await closed.page.attach();
		expect(closed.page.attachments()).toEqual([]);
		const none = await ready({ picked: [] });
		await none.page.attach();
		expect(none.page.attachments()).toEqual([]);
	});

	it('saves a draft and opens it, and says when the draft changed meanwhile or saving failed', async () => {
		const { page, gateway, go, notifier } = await ready();
		page.setRow(0, { ledgerId: 'rent', debit: '50' });
		await page.saveDraft();
		expect(gateway.saveDraft).toHaveBeenCalledWith(
			null,
			expect.objectContaining({
				kind: 'journal',
				lines: [expect.objectContaining({ ledgerId: 'rent', debitPaise: 5000 })],
			}),
		);
		expect(go).toHaveBeenCalledWith(['/accounts/vouchers/drafts', 'vd_9']);
		expect(notifier.showSuccess).toHaveBeenCalledWith('accounts_draft_saved');
		const changed = await ready({ saveFails: { error: { error: { message: 'draft_changed' } } } });
		await changed.page.saveDraft();
		expect(changed.notifier.showError).toHaveBeenCalledWith('accounts_draft_changed');
		const failed = await ready({ saveFails: new Error('offline') });
		await failed.page.saveDraft();
		expect(failed.notifier.showError).toHaveBeenCalledWith('accounts_draft_failed');
		expect(failed.page.savingDraft()).toBe(false);
	});

	it('posts a balanced voucher and opens it, and says why a post was refused', async () => {
		const { page, gateway, go, notifier } = await ready();
		page.setRow(0, { ledgerId: 'rent', locationId: 'loc', debit: '100' });
		page.setRow(1, { ledgerId: 'cash', locationId: 'loc', credit: '100' });
		page.addRow();
		await page.post();
		expect(gateway.post).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'journal', lines: expect.any(Array) }),
		);
		expect((gateway.post.mock.calls[0] as unknown as [{ lines: unknown[] }])[0].lines).toHaveLength(2);
		expect(go).toHaveBeenCalledWith(['/accounts/vouchers', 'jv_9']);
		expect(notifier.showSuccess).toHaveBeenCalledWith('accounts_voucher_posted');
		const refused = await ready({ postFails: { error: { error: { message: 'voucher_problem:period_locked' } } } });
		refused.page.setRow(0, { ledgerId: 'rent', locationId: 'loc', debit: '1' });
		refused.page.setRow(1, { ledgerId: 'cash', locationId: 'loc', credit: '1' });
		await refused.page.post();
		expect(refused.notifier.showError).toHaveBeenCalledWith('accounts_problem_period_locked');
		const failed = await ready({ postFails: new Error('offline') });
		failed.page.setRow(0, { ledgerId: 'rent', locationId: 'loc', debit: '1' });
		failed.page.setRow(1, { ledgerId: 'cash', locationId: 'loc', credit: '1' });
		await failed.page.post();
		expect(failed.notifier.showError).toHaveBeenCalledWith('accounts_post_failed');
		expect(failed.page.posting()).toBe(false);
	});

	it('opens a saved draft: its kind, lines (at least two), files, and a contra’s fields', async () => {
		const draft = {
			id: 'vd_1',
			kind: 'contra',
			date: '2026-11-24',
			reverseOn: null,
			narration: 'Banked',
			attachments: [],
			createdByName: 'Owner',
			updatedAt: 'u1',
			lines: [
				{
					ledgerId: 'hdfc',
					locationId: 'loc_gar',
					debitPaise: 441_200,
					creditPaise: 0,
					narration: 'Deposit slip 7',
				},
			],
		};
		const { page } = await ready({ draftId: 'vd_1', draft });
		await vi.waitFor(() => expect(page.kind()).toBe('contra'));
		expect(page.rows()).toHaveLength(2);
		expect(page.contra()).toEqual({ from: '', to: 'hdfc', amount: '4412', slip: '7' });
		expect(page.draftBy()).toBe('Owner');
		const journal = await ready({
			draftId: 'vd_2',
			draft: {
				...draft,
				kind: 'journal',
				reverseOn: '2026-12-01',
				lines: [
					{ ledgerId: 'rent', locationId: 'l', debitPaise: 100, creditPaise: 0, narration: '' },
					{ ledgerId: 'cash', locationId: 'l', debitPaise: 0, creditPaise: 100, narration: '' },
				],
			},
		});
		await vi.waitFor(() => expect(journal.page.reverseOn()).toBe('2026-12-01'));
		expect(journal.page.rows().map((row) => [row.debit, row.credit])).toEqual([
			['1', ''],
			['', '1'],
		]);
		await journal.page.saveDraft();
		expect(journal.gateway.saveDraft).toHaveBeenCalledWith(
			'vd_2',
			expect.objectContaining({ expectedUpdatedAt: 'u1', reverseOn: '2026-12-01' }),
		);
	});
});
