import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { rupees } from './ledger-helpers';
import { VouchersListPage } from './vouchers-list';

/** Accounts › Vouchers drawn (accounts brief A, Q3, Q4): posted vouchers by period, kind and search, and drafts. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const voucher = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	number: `JV/26-27/00${id}`,
	kind: 'journal',
	date: '2026-11-20',
	narration: 'Rent for November',
	lines: [],
	source: null,
	reversalOfId: null,
	reversedById: null,
	reverseOn: null,
	idempotencyKey: null,
	attachments: [],
	totalPaise: 25_000_00,
	createdBy: 'adm_1',
	createdAt: '2026-11-20T06:00:00.000Z',
	...over,
});
const draft = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	kind: 'payment',
	date: '2026-11-24',
	narration: 'Electricity',
	lines: [
		{ ledgerId: 'l1', debitPaise: 3_000_00, creditPaise: 0 },
		{ ledgerId: 'l2', debitPaise: 0, creditPaise: 3_000_00 },
	],
	reverseOn: null,
	attachments: [],
	createdBy: 'adm_1',
	createdByName: 'Asha Roy',
	createdAt: '2026-11-24T06:00:00.000Z',
	updatedAt: '2026-11-24T06:00:00.000Z',
	updatedBy: null,
	...over,
});

function mount(options: { permissions?: string[]; items?: unknown[]; total?: number; drafts?: unknown[] } = {}) {
	TestBed.resetTestingModule();
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		vouchers: vi.fn(() =>
			of({
				items: options.items ?? [
					voucher('1'),
					voucher('2', { kind: 'payment', narration: '', reversedById: 'jv_9' }),
					voucher('3', { kind: 'contra', reversalOfId: 'jv_8' }),
				],
				total: options.total ?? 3,
				page: 1,
				pageSize: 25,
			}),
		),
		drafts: vi.fn(() => of(options.drafts ?? [draft('d1'), draft('d2', { narration: '', createdByName: '' })])),
		deleteDraft: vi.fn(() => of(undefined)),
	};
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
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: LedgerGateway, useValue: calls },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			// Deleting a draft asks first: the stand-in pop-up answers yes.
			{
				provide: NgbModal,
				useValue: { open: () => ({ componentInstance: { start: vi.fn() }, result: Promise.resolve(true) }) },
			},
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.post']) },
			},
		],
	});
	// The period picker is its own component; its choice reaches the page through setPeriod.
	TestBed.overrideComponent(VouchersListPage, {
		remove: { imports: [PeriodPicker] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(VouchersListPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, calls, invalidate };
}
async function opened(options: Parameters<typeof mount>[0] = {}) {
	const harness = mount(options);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: HTMLElement | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '');
const lastAsked = (vouchers: ReturnType<typeof vi.fn>) =>
	(vouchers.mock.lastCall as unknown as [Record<string, unknown>])[0];
const enter = async (
	fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
	box: Element | null,
	value: string,
) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await settle(fixture);
};

describe('posted vouchers (Q3, Q4)', () => {
	it('lists the last thirty days of every kind, each with its number, kind, narration, amount and state', async () => {
		const { fixture, calls } = await opened();
		expect(lastAsked(calls.vouchers)).toEqual({
			...(periodRange({ period: 'last_30_days' }) as { from: string; to: string }),
			kinds: [],
			search: '',
			page: 1,
		});
		expect(rows(fixture).map(cells)).toEqual([
			[
				'2026-11-20',
				'JV/26-27/001',
				'accounts_kind_journal',
				'Rent for November',
				rupees(25_000_00),
				'accounts_posted',
			],
			['2026-11-20', 'JV/26-27/002', 'accounts_kind_payment', '—', rupees(25_000_00), 'accounts_reversed'],
			[
				'2026-11-20',
				'JV/26-27/003',
				'accounts_kind_contra',
				'Rent for November',
				rupees(25_000_00),
				'accounts_reversal',
			],
		]);
		expect(el(fixture, 'a[href="/accounts/vouchers/1"]')).not.toBeNull();
		expect(el(fixture, '#vouchers_new')?.getAttribute('href')).toBe('/accounts/vouchers/new');
		expect(el(fixture, 'a[href="/accounts/payment-vouchers"]')).not.toBeNull();
		expect(el(fixture, 'a[href="/accounts/self-invoices"]')).not.toBeNull();
		expect(el(fixture, '#vouchers_tab_drafts .badge')?.textContent?.trim()).toBe('2');
	});

	it('reads one kind, a trimmed search and another page, each kind and search back on the first page', async () => {
		const { fixture, page, calls } = await opened({ total: 60 });
		expect([...(el<HTMLSelectElement>(fixture, '#vouchers_kind')?.options ?? [])].map((o) => o.value)).toEqual([
			'',
			'journal',
			'receipt',
			'payment',
			'contra',
			'opening',
			'document',
		]);
		(fixture.nativeElement.querySelectorAll('.page-link')[2] as HTMLElement).click();
		await settle(fixture);
		expect(lastAsked(calls.vouchers)['page']).toBe(3);
		await enter(fixture, el(fixture, '#vouchers_kind'), 'receipt');
		expect(lastAsked(calls.vouchers)).toMatchObject({ kinds: ['receipt'], page: 1 });
		page.page.set(2);
		await enter(fixture, el(fixture, '#vouchers_search'), '  rent ');
		expect(lastAsked(calls.vouchers)).toMatchObject({ search: 'rent', page: 1 });
	});

	it('reads a picked period from its first page, and the books from their start when a day is left open', async () => {
		const { fixture, page, calls } = await opened();
		page.page.set(2);
		page.setPeriod({ period: 'custom', from: '2026-04-01', to: '2026-06-30' });
		await settle(fixture);
		expect(lastAsked(calls.vouchers)).toMatchObject({ from: '2026-04-01', to: '2026-06-30', page: 1 });
		page.setPeriod({ period: 'custom' } as never);
		await settle(fixture);
		expect(lastAsked(calls.vouchers)['from']).toBe('2000-01-01');
		expect(lastAsked(calls.vouchers)['to']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('says when there are none', async () => {
		const { fixture } = await opened({ items: [], total: 0 });
		expect(cells(rows(fixture)[0])).toEqual(['accounts_no_vouchers']);
		expect(fixture.nativeElement.querySelector('.pagination')).toBeNull();
	});
});

describe('voucher drafts (Q3)', () => {
	it('lists each draft with its kind, narration, amount and who saved it, and deletes one', async () => {
		const { fixture, calls, invalidate } = await opened();
		(el(fixture, '#vouchers_tab_drafts') as HTMLElement).click();
		await settle(fixture);
		expect(el(fixture, '#vouchers_tab_drafts')?.classList.contains('active')).toBe(true);
		expect(rows(fixture).map(cells)).toEqual([
			['2026-11-24', 'accounts_kind_payment', 'Electricity', rupees(3_000_00), 'Asha Roy', ''],
			['2026-11-24', 'accounts_kind_payment', '—', rupees(3_000_00), '—', ''],
		]);
		expect(el(fixture, 'a[href="/accounts/vouchers/drafts/d1"]')).not.toBeNull();
		(rows(fixture)[0]?.querySelector('a[title="accounts_delete_draft"]') as HTMLElement).click();
		await settle(fixture);
		expect(calls.deleteDraft).toHaveBeenCalledWith('d1');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 'drafts'] });
		(el(fixture, '#vouchers_tab_posted') as HTMLElement).click();
		await settle(fixture);
		expect(el(fixture, '#vouchers_search')).not.toBeNull();
	});

	it('says when there are no drafts, with no count on the tab', async () => {
		const { fixture, page } = await opened({ drafts: [] });
		page.tab.set('drafts');
		await settle(fixture);
		expect(el(fixture, '#vouchers_tab_drafts .badge')).toBeNull();
		expect(cells(rows(fixture)[0])).toEqual(['accounts_no_drafts']);
	});

	it('shows no drafts, tabs or New to someone who may not post, and never asks for drafts', async () => {
		const { fixture, calls } = await opened({ permissions: ['accounts.index'] });
		expect(el(fixture, '#vouchers_tab_drafts')).toBeNull();
		expect(el(fixture, '#vouchers_new')).toBeNull();
		expect(calls.drafts).not.toHaveBeenCalled();
	});
});
