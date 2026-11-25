import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { rupees } from './ledger-helpers';
import { VoucherViewPage } from './voucher-view';

/** One voucher with its lines, and Reverse on a date with a reason (accounts brief Q3, Q5). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (message: string) => ({ error: { error: { message } } });
const VOUCHER = {
	id: 'jv_1',
	number: 'JV/26-27/000041',
	kind: 'journal',
	date: '2026-11-20',
	narration: 'Rent for November',
	lines: [
		{ ledgerId: 'rent', locationId: 'loc_b', debitPaise: 25_000_00, creditPaise: 0, narration: 'Barasat shop' },
		{ ledgerId: 'gone', locationId: 'loc_x', debitPaise: 0, creditPaise: 25_000_00, narration: '' },
	],
	source: { type: 'purchase_bill', id: 'pb_1', number: 'PB/26-27/000012' },
	reversalOfId: null,
	reversedById: null,
	reverseOn: '2026-12-01',
	idempotencyKey: null,
	attachments: [],
	attachmentLinks: [
		{ assetId: 'a1', name: 'rent-receipt.pdf', url: 'https://cdn.example.test/a1' },
		{ assetId: 'a2', name: 'agreement.pdf', url: null },
	],
	totalPaise: 25_000_00,
	createdBy: 'adm_1',
	createdAt: '2026-11-20T06:00:00.000Z',
};

function mount(
	options: { id?: string | null; voucher?: unknown; permissions?: string[]; reverse?: ReturnType<typeof vi.fn> } = {},
) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		voucher: vi.fn(() => of(options.voucher ?? VOUCHER)),
		chart: vi.fn(() => of({ groups: [], ledgers: [{ id: 'rent', name: 'Rent', groupId: 'g1' }] })),
		reverse: options.reverse ?? vi.fn(() => of({ id: 'jv_2', number: 'JV/26-27/000042' })),
	};
	const id = options.id === undefined ? 'jv_1' : options.id;
	TestBed.configureTestingModule({
		imports: [
			VoucherViewPage,
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
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'loc_b', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.post']) },
			},
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(id === null ? {} : { id })) },
			},
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(VoucherViewPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, calls, notifier, invalidate, navigate };
}
async function opened(options: Parameters<typeof mount>[0] = {}) {
	const harness = mount(options);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const text = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.textContent ?? '';
const cells = (row: Element | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '');
const enter = async (
	fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
	box: Element | null,
	value: string,
) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event('input'));
	await settle(fixture);
};

describe('a voucher (Q3)', () => {
	it('shows its number, kind, day, reversal day, source, lines with ledger and location names, totals, narration and files', async () => {
		const { fixture, calls } = await opened();
		expect(calls.voucher).toHaveBeenCalledWith('jv_1');
		expect(el(fixture, 'h5.mb-1')?.textContent).toContain('JV/26-27/000041');
		expect(el(fixture, 'h5.mb-1 .badge')?.textContent?.trim()).toBe('accounts_kind_journal');
		expect(text(fixture)).toContain('accounts_reverse_on 2026-12-01');
		expect(text(fixture)).toContain('PB/26-27/000012');
		const lines = [...fixture.nativeElement.querySelectorAll('tbody tr')];
		expect(cells(lines[0])).toEqual(['Rent', 'Barasat', rupees(25_000_00), '', 'Barasat shop']);
		expect(cells(lines[1])).toEqual(['gone', 'loc_x', '', rupees(25_000_00), '']);
		expect(cells(lines[2])).toEqual(['accounts_total', rupees(25_000_00), rupees(25_000_00), '']);
		expect(el(fixture, 'a[href="/accounts/ledgers/rent"]')).not.toBeNull();
		expect(text(fixture)).toContain('accounts_narration: Rent for November');
		const files = [...fixture.nativeElement.querySelectorAll('a[target="_blank"]')] as HTMLAnchorElement[];
		// A file without a link shows its name only, so a click can't open this page again.
		expect(files.map((a) => a.textContent?.trim())).toEqual(['rent-receipt.pdf']);
		expect(text(fixture)).toContain('agreement.pdf');
		expect(files[0]?.getAttribute('href')).toBe('https://cdn.example.test/a1');
		expect(el(fixture, '#voucher_reverse_open')).not.toBeNull();
	});

	it('names a source by its type when it has no number, and leaves out the narration and files when there are none', async () => {
		const { fixture } = await opened({
			voucher: {
				...VOUCHER,
				source: { type: 'cash_sheet', id: 'cs_1', number: null },
				reverseOn: null,
				narration: '',
				attachmentLinks: [],
			},
		});
		expect(text(fixture)).toContain('cash_sheet');
		expect(text(fixture)).not.toContain('accounts_reverse_on');
		expect(text(fixture)).not.toContain('accounts_narration:');
		expect(text(fixture)).not.toContain('accounts_attachments');
	});

	it('links a reversed voucher to its reversal and a reversal to its original, with no Reverse on either', async () => {
		const reversed = await opened({ voucher: { ...VOUCHER, source: null, reversedById: 'jv_9' } });
		expect(el(reversed.fixture, 'a[href="/accounts/vouchers/jv_9"]')?.textContent).toContain(
			'accounts_open_reversal',
		);
		expect(el(reversed.fixture, '#voucher_reverse_open')).toBeNull();
		const reversal = await opened({ voucher: { ...VOUCHER, reversalOfId: 'jv_8' } });
		expect(el(reversal.fixture, 'a[href="/accounts/vouchers/jv_8"]')?.textContent).toContain(
			'accounts_open_original',
		);
		expect(el(reversal.fixture, '#voucher_reverse_open')).toBeNull();
	});

	it('offers no Reverse to someone who may not post, and reads nothing without an id', async () => {
		const reader = await opened({ permissions: ['accounts.index'] });
		expect(el(reader.fixture, '#voucher_reverse_open')).toBeNull();
		const none = await opened({ id: null });
		expect(none.page.id()).toBe('');
		expect(none.calls.voucher).not.toHaveBeenCalled();
	});
});

describe('reversing a voucher (Q5)', () => {
	it('asks for a date and a reason of five letters or more, posts the opposite entry and opens it', async () => {
		const { fixture, page, calls, notifier, invalidate, navigate } = await opened();
		el<HTMLButtonElement>(fixture, '#voucher_reverse_open')?.click();
		await settle(fixture);
		const confirm = () => el<HTMLButtonElement>(fixture, '#voucher_reverse_confirm') as HTMLButtonElement;
		expect(confirm().disabled).toBe(true);
		await enter(fixture, el(fixture, '#voucher_reverse_date'), '2026-11-30');
		await enter(fixture, el(fixture, '#voucher_reverse_reason'), 'Typo');
		expect(confirm().disabled).toBe(true);
		await enter(fixture, el(fixture, '#voucher_reverse_reason'), 'Posted to the wrong ledger');
		expect(confirm().disabled).toBe(false);
		confirm().click();
		await settle(fixture);
		const [id, write] = calls.reverse.mock.lastCall as unknown as [string, { idempotencyKey: string }];
		expect([id, write]).toEqual([
			'jv_1',
			{
				date: '2026-11-30',
				reason: 'Posted to the wrong ledger',
				idempotencyKey: expect.stringMatching(/^rev-/),
			},
		]);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('accounts_reversed_as');
		expect(navigate).toHaveBeenCalledWith(['/accounts/vouchers', 'jv_2']);
		expect([page.reversing(), page.busy()]).toEqual([false, false]);
	});

	it('names the super-admin rule and a voucher problem, says when it simply failed, and closes on Cancel', async () => {
		const reverse = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('reverse_super_admin_only')))
			.mockReturnValueOnce(throwError(() => refusal('voucher_problem:period_locked')))
			.mockReturnValueOnce(throwError(() => refusal('quota')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { fixture, page, notifier } = await opened({ reverse });
		page.reversing.set(true);
		await page.reverse();
		expect(notifier.showError).toHaveBeenLastCalledWith('accounts_reverse_super_admin');
		await page.reverse();
		expect(notifier.showError).toHaveBeenLastCalledWith('accounts_problem_period_locked');
		await page.reverse();
		expect(notifier.showError).toHaveBeenLastCalledWith('accounts_post_failed');
		await page.reverse();
		expect(notifier.showError).toHaveBeenLastCalledWith('accounts_post_failed');
		expect([page.reversing(), page.busy()]).toEqual([true, false]);
		await settle(fixture);
		(
			[...fixture.nativeElement.querySelectorAll('button')].find((b) =>
				(b as HTMLElement).textContent?.includes('cancel'),
			) as HTMLButtonElement
		).click();
		expect(page.reversing()).toBe(false);
	});
});
