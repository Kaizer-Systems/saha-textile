import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { GSTR2B_CHIPS, GSTR2B_MAX_BYTES, GSTR2B_PILL, Gstr2bPage, lastMonth, sideText } from './gstr2b-page';

/** The input credit check (accounts brief G5): the month's GSTR-2B against our posted bills. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const money = (taxable: number, tax: number) => ({ taxable, igst: 0, cgst: tax / 2, sgst: tax / 2 });
const line = (key: string, over: Record<string, unknown> = {}) => ({
	key,
	result: 'matched',
	kind: 'invoice',
	supplierGstin: '19AAACW1234F1Z5',
	supplierName: 'Nadia Weavers',
	number: `NW/${key}`,
	date: '2026-10-05',
	reverseCharge: false,
	itcAvailable: true,
	books: money(242_000, 12_100),
	twoB: money(242_000, 12_100),
	entryId: 'pe1',
	entryNumber: 'PE/26-27/000001',
	action: 'accept',
	...over,
});
const ROWS = [
	line('k1'),
	line('k2', { result: 'different', twoB: money(242_000, 24_200) }),
	line('k3', { result: 'only_2b', books: null, entryId: null, entryNumber: null, action: 'pending' }),
	line('k4', { result: 'only_books', twoB: null, supplierName: '' }),
	line('k5', { result: 'note', kind: 'credit', number: 'CN/7' }),
];
const view = (over: Record<string, unknown> = {}) => ({
	gstin: '19ABCDE1234F1Z5',
	month: '2026-10',
	importId: 'imp1',
	importedAt: '2026-11-14T06:00:00.000Z',
	importedByName: 'Asha',
	generatedOn: '2026-11-14',
	notRead: [{ section: 'impg', count: 2 }],
	counts: { all: 5, matched: 1, different: 1, only_2b: 1, only_books: 1, note: 1 },
	rows: ROWS,
	claim: { igst: 0, cgst: 18_150, sgst: 18_150 },
	locked: false,
	version: 3,
	...over,
});
const REGISTRATIONS = [
	{ id: 'r0', gstin: '27AAAAA0000A1Z5', stateCode: '27', active: false },
	{ id: 'r1', gstin: '19ABCDE1234F1Z5', stateCode: '19' },
];

function mount(gst: Record<string, unknown>, options: { permissions?: string[]; registrations?: unknown[] } = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	TestBed.configureTestingModule({
		imports: [
			Gstr2bPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: GstReturnsGateway, useValue: gst },
			{
				provide: CompanyGateway,
				useValue: { registrations: vi.fn(() => of(options.registrations ?? REGISTRATIONS)) },
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.edit']) },
			},
		],
	});
	const fixture = TestBed.createComponent(Gstr2bPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const file = (text: string, size = text.length) =>
	({ name: '2b.json', size, text: async () => text }) as unknown as File;

/** Opens the page on October 2026, as a person picking the month would. */
async function onOctober(harness: ReturnType<typeof mount>) {
	await settle(harness.fixture);
	const month = el(harness.fixture, '#gstr2b_month') as HTMLInputElement;
	month.value = '2026-10';
	month.dispatchEvent(new Event('input'));
	await settle(harness.fixture);
}

describe('the month and the money', () => {
	it('takes last month in India, so the small hours of the 1st still count as the month before', () => {
		expect(lastMonth(new Date('2026-11-30T19:00:00.000Z'))).toBe('2026-11');
		expect(lastMonth(new Date('2026-11-30T18:00:00.000Z'))).toBe('2026-10');
		expect(lastMonth(new Date('2026-01-15T00:00:00.000Z'))).toBe('2025-12');
		expect(lastMonth()).toMatch(/^\d{4}-\d{2}$/);
	});

	it('writes a side as its taxable value and tax, or a dash when it has none', () => {
		expect(sideText(null)).toBe('—');
		expect(sideText(money(242_000, 12_100) as never)).toBe('₹2,420.00 + ₹121.00');
		expect([...GSTR2B_CHIPS]).toEqual(['all', 'matched', 'different', 'only_2b', 'only_books', 'note']);
		expect([GSTR2B_PILL.different, GSTR2B_PILL.note, GSTR2B_MAX_BYTES]).toEqual([
			'status-danger',
			'status-success',
			1_000_000,
		]);
	});
});

describe('the GSTR-2B page (G5)', () => {
	it('shows the first active GSTIN’s month: who imported it, what was not read, each line’s result and the claim', async () => {
		const twoB = vi.fn(() => of(view()));
		const harness = mount({ twoB });
		expect(harness.page.claimText()).toBe('—');
		await onOctober(harness);
		const { fixture, page } = harness;
		expect(page.registrationId()).toBe('r1');
		expect(twoB).toHaveBeenLastCalledWith({ gstRegistrationId: 'r1', month: '2026-10', chip: 'all' });
		expect(page.monthName()).toBe('October 2026');
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('19ABCDE1234F1Z5');
		expect(text).toContain('gstr2b_imported_by');
		expect(text).toContain('gstr2b_not_read');
		expect(text).not.toContain('gstr2b_not_imported');
		expect(text).not.toContain('gstr2b_locked');
		expect(el(fixture, '#gstr2b_chip_different')?.textContent).toContain('1');
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(5);
		expect(rows[0]?.querySelector('.status-success')).not.toBeNull();
		expect(rows[1]?.querySelector('.status-danger')).not.toBeNull();
		expect(rows[1]?.textContent).toContain('₹242.00');
		expect(rows[2]?.textContent).toContain('—');
		expect(rows[3]?.textContent).toContain('19AAACW1234F1Z5');
		expect(rows[4]?.textContent).toContain('gstr2b_result_note_credit');
		expect(rows.map((row) => !!row.querySelector('select'))).toEqual([true, true, true, false, true]);
		expect(rows[3]?.textContent).toContain('gstr2b_action_accept');
		expect(rows.map((row) => row.textContent?.includes('gstr2b_hint_'))).toEqual([false, true, true, true, true]);
		expect(page.claimText()).toBe('IGST ₹0.00 · CGST ₹181.50 · SGST ₹181.50');
		expect(el(fixture, 'label[for="gstr2b_file"]')).not.toBeNull();
		expect(el(fixture, '#gstr2b_file')).not.toBeNull();
		expect(page.day('2026-10-05')).toBeTruthy();
	});

	it('switches chip and GSTIN, and reads nothing for a month not filled in', async () => {
		const twoB = vi.fn(() => of(view()));
		const harness = mount({ twoB }, { registrations: [...REGISTRATIONS, { id: 'r2', gstin: '19ZZZZZ9999Z1Z9' }] });
		await onOctober(harness);
		(el(harness.fixture, '#gstr2b_chip_note') as HTMLButtonElement).click();
		await settle(harness.fixture);
		expect(twoB).toHaveBeenLastCalledWith({ gstRegistrationId: 'r1', month: '2026-10', chip: 'note' });
		const gstin = el(harness.fixture, '#gstr2b_registration') as HTMLSelectElement;
		gstin.value = 'r2';
		gstin.dispatchEvent(new Event('change'));
		await settle(harness.fixture);
		expect(twoB).toHaveBeenLastCalledWith({ gstRegistrationId: 'r2', month: '2026-10', chip: 'note' });
		const calls = twoB.mock.calls.length;
		harness.page.month.set('');
		await settle(harness.fixture);
		expect(twoB).toHaveBeenCalledTimes(calls);
	});

	it('says when the month has no 2B yet, when the month is locked, and when no line is left', async () => {
		const harness = mount({
			twoB: vi.fn(() => of(view({ importId: null, importedAt: null, notRead: [], locked: true, rows: [] }))),
		});
		await onOctober(harness);
		const text = harness.fixture.nativeElement.textContent as string;
		expect(text).toContain('gstr2b_not_imported');
		expect(text).toContain('gstr2b_locked');
		expect(text).toContain('gstr2b_empty');
		expect(text).not.toContain('gstr2b_imported_by');
		expect(text).not.toContain('gstr2b_not_read');
		expect(el(harness.fixture, '#gstr2b_file')).toBeNull();
		expect(el(harness.fixture, 'label[for="gstr2b_file"]')).toBeNull();
	});

	it('shows what was done on the portal as words in a locked month or to someone who may not edit', async () => {
		const locked = mount({ twoB: vi.fn(() => of(view({ locked: true }))) });
		await onOctober(locked);
		expect(all(locked.fixture, 'tbody select')).toHaveLength(0);
		expect(locked.fixture.nativeElement.textContent).toContain('gstr2b_action_pending');

		const reader = mount({ twoB: vi.fn(() => of(view())) }, { permissions: ['accounts.index'] });
		await onOctober(reader);
		expect(reader.page.canEdit()).toBe(false);
		expect(all(reader.fixture, 'tbody select')).toHaveLength(0);
		expect(el(reader.fixture, 'label[for="gstr2b_file"]')).toBeNull();
	});

	it('records what was done on the portal for a line, with the view’s version', async () => {
		const decide2b = vi
			.fn()
			.mockReturnValueOnce(of(view()))
			.mockReturnValueOnce(throwError(() => refusal('gstr2b_changed')));
		const harness = mount({ twoB: vi.fn(() => of(view())), decide2b });
		await onOctober(harness);
		const select = all(harness.fixture, 'tbody select')[2] as HTMLSelectElement;
		select.value = 'reject';
		select.dispatchEvent(new Event('change'));
		await settle(harness.fixture);
		expect(decide2b).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			month: '2026-10',
			key: 'k3',
			action: 'reject',
			version: 3,
		});
		expect(harness.notifier.showSuccess).toHaveBeenCalledWith('gstr2b_decided');
		expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: ['gst-returns'] });
		await expect(harness.page.decide(ROWS[1] as never, 'accept')).resolves.toBe(false);
		expect(harness.notifier.showError).toHaveBeenCalledWith('gst_problem_gstr2b_changed');
		expect(harness.page.busy()).toBe(false);
	});

	it('sends version 0 when no month has been read', async () => {
		const decide2b = vi.fn(() => of(view()));
		const harness = mount({ twoB: vi.fn(() => of(view())), decide2b }, { registrations: [] });
		await settle(harness.fixture);
		expect(harness.page.registrationId()).toBe('');
		await harness.page.decide(ROWS[0] as never, 'accept');
		expect(decide2b).toHaveBeenCalledWith(expect.objectContaining({ key: 'k1', version: 0 }));
	});
});

describe('importing the portal’s 2B file', () => {
	it('does nothing with no file, and refuses a file too large or not a JSON object', async () => {
		const import2b = vi.fn(() => of(view()));
		const harness = mount({ twoB: vi.fn(() => of(view())), import2b });
		await onOctober(harness);
		const input = el(harness.fixture, '#gstr2b_file') as HTMLInputElement;
		input.dispatchEvent(new Event('change'));
		await harness.page.read(null);
		expect(harness.page.problem()).toBeNull();
		await harness.page.read(file('{}', GSTR2B_MAX_BYTES + 1));
		expect(harness.page.problem()).toBe('gstr2b_too_large');
		for (const text of ['not json', '[1, 2]', 'null', '"2B"', '42']) {
			harness.page.problem.set(null);
			await harness.page.read(file(text));
			expect(harness.page.problem()).toBe('gst_problem_gstr2b_file_unreadable');
		}
		harness.fixture.detectChanges();
		expect(el(harness.fixture, '.alert-warning')?.textContent).toContain('gst_problem_gstr2b_file_unreadable');
		expect(import2b).not.toHaveBeenCalled();
	});

	it('imports a good file for the GSTIN and opens the file’s month on every line', async () => {
		const import2b = vi.fn(() => of(view({ month: '2026-09' })));
		const harness = mount({ twoB: vi.fn(() => of(view())), import2b });
		await onOctober(harness);
		harness.page.chip.set('note');
		harness.page.problem.set('gstr2b_too_large');
		await harness.page.read(file('{"data":{"gstin":"19ABCDE1234F1Z5"}}'));
		expect(import2b).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			file: { data: { gstin: '19ABCDE1234F1Z5' } },
		});
		expect([harness.page.month(), harness.page.chip(), harness.page.problem()]).toEqual(['2026-09', 'all', null]);
		expect(harness.notifier.showSuccess).toHaveBeenCalledWith('gstr2b_imported');
	});

	it('names the API’s refusal of the file and keeps the month', async () => {
		const harness = mount({
			twoB: vi.fn(() => of(view())),
			import2b: vi.fn(() => throwError(() => refusal('gstr2b_other_gstin'))),
		});
		await onOctober(harness);
		await harness.page.read(file('{}'));
		expect(harness.notifier.showError).toHaveBeenCalledWith('gst_problem_gstr2b_other_gstin');
		expect(harness.page.month()).toBe('2026-10');
	});
});
