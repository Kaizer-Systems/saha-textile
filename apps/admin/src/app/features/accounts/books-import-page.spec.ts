import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BooksImportGateway } from '@core/accounts/books-import.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BooksImportPage, IMPORT_STEPS, choiceOf, nextYearStart, stillToChoose } from './books-import-page';

/** Bring your books in (accounts brief I1, W1–W3). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const row = (name: string, how: string, over: Record<string, unknown> = {}) => ({
	name,
	group: 'Sundry Debtors',
	primary: null,
	openingPaise: 100_000,
	how,
	ledgerId: null,
	groupKey: null,
	...over,
});
const ROWS = [
	row('Cash', 'by_name', { ledgerId: 'cash', group: 'Cash-in-Hand' }),
	row('Output CGST', 'by_tax_head', { ledgerId: 'gone' }),
	row('Nadia Weavers', 'new', { groupKey: 'sundry_creditors', openingPaise: -100_000 }),
	row('Old suspense', 'choose', { openingPaise: 0 }),
	row('Shop fittings', 'choose'),
	row('Petty', 'party', { groupKey: 'unknown_group' }),
];
const PREVIEW = {
	rows: ROWS,
	matched: 3,
	toCheck: 3,
	debitPaise: 400_000,
	creditPaise: 100_000,
	balanced: true,
	toChoose: 1,
};
const at = '2026-01-01T00:00:00.000Z';
const CHART = {
	groups: [
		{
			id: 'g1',
			name: 'Sundry Creditors',
			systemKey: 'sundry_creditors',
			parentId: null,
			createdAt: at,
			updatedAt: at,
		},
		{ id: 'g2', name: 'My own group', systemKey: null, parentId: null, createdAt: at, updatedAt: at },
	],
	ledgers: [
		{ id: 'cash', name: 'Cash', groupId: 'g1' },
		{ id: 'old', name: 'Old ledger', groupId: 'g1', active: false },
	],
};
const IMPORTS = [
	{
		id: 'i1',
		source: 'tally_xml',
		fileName: 'Master.xml',
		startOn: '2026-04-01',
		locationId: 'l1',
		voucherId: 'jv1',
		ledgersMade: [],
		debitPaise: 400_000,
		createdBy: 'u1',
		createdAt: at,
		undoneAt: null,
		undoneBy: null,
	},
];

function mount(
	gateway: Record<string, unknown> = {},
	permissions = ['accounts.index', 'accounts.post', 'accounts.lock'],
) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		list: vi.fn(() => of(IMPORTS)),
		check: vi.fn(() => of(PREVIEW)),
		bringIn: vi.fn(() => of(IMPORTS[0])),
		undo: vi.fn(() => of({ ...IMPORTS[0], undoneAt: at })),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			BooksImportPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: BooksImportGateway, useValue: calls },
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of(CHART)) } },
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	const fixture = TestBed.createComponent(BooksImportPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, calls };
}

async function importer(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const buttonSaying = (fixture: { nativeElement: HTMLElement }, words: string) =>
	all(fixture, 'button').find((b) => b.textContent?.trim() === words) as HTMLButtonElement | undefined;
const fileEvent = (file: unknown) => ({ target: { files: file ? [file] : [] } }) as unknown as Event;

/** Reads a file and checks it, landing on the match step. */
async function matched(harness: ReturnType<typeof mount>) {
	await settle(harness.fixture);
	harness.page.locationId.set('l1');
	await harness.page.read(fileEvent({ name: 'Master.xml', text: async () => '<ENVELOPE/>' }));
	await harness.page.check();
	await settle(harness.fixture);
}

describe('where the books start, and the choices made', () => {
	it('starts on the next 1 April in India, that day itself included', () => {
		expect([...IMPORT_STEPS]).toEqual(['source', 'match', 'check', 'done']);
		expect(nextYearStart(new Date('2026-03-31T19:00:00.000Z'))).toBe('2026-04-01');
		expect(nextYearStart(new Date('2026-04-01T19:00:00.000Z'))).toBe('2027-04-01');
		expect(nextYearStart(new Date('2026-01-15T06:00:00.000Z'))).toBe('2026-04-01');
		expect(nextYearStart()).toMatch(/^\d{4}-04-01$/);
	});

	it('reads a choice as an existing ledger, a new one in a group, or none', () => {
		expect(choiceOf('l:cash')).toEqual({ ledgerId: 'cash', groupKey: null });
		expect(choiceOf('g:sundry_creditors')).toEqual({ ledgerId: null, groupKey: 'sundry_creditors' });
		expect(choiceOf('')).toEqual({ ledgerId: null, groupKey: null });
	});

	it('counts the rows with a balance still to place', () => {
		expect(stillToChoose(ROWS as never, {})).toBe(1);
		expect(stillToChoose(ROWS as never, { 'Shop fittings': 'l:cash' })).toBe(0);
	});
});

describe('reading the file (W1)', () => {
	it('picks the program, the start and the location, reads the file, and checks it', async () => {
		const harness = await importer();
		const { fixture, page, calls } = harness;
		const next = el(fixture, '#import_next') as HTMLButtonElement;
		expect(next.disabled).toBe(true);
		(el(fixture, '#imp_zoho_csv') as HTMLInputElement).dispatchEvent(new Event('change'));
		(el(fixture, '#imp_start_date') as HTMLInputElement).dispatchEvent(new Event('change'));
		expect((el(fixture, '#imp_start_history') as HTMLInputElement).disabled).toBe(true);
		enter(el(fixture, '#imp_on'), '2026-10-01');
		enter(el(fixture, '#imp_loc'), 'l1');
		await page.read(fileEvent(null));
		expect(page.fileName()).toBe('');
		(el(fixture, '#imp_file') as HTMLInputElement).dispatchEvent(new Event('change'));
		await page.read(fileEvent({ name: 'books.csv', text: async () => 'Ledger,Dr,Cr' }));
		await settle(fixture);
		expect(next.disabled).toBe(false);
		page.choose('stale', 'l:cash');
		next.click();
		await settle(fixture);
		expect(calls.check).toHaveBeenCalledWith({
			source: 'zoho_csv',
			start: 'date',
			startOn: '2026-10-01',
			fileName: 'books.csv',
			text: 'Ledger,Dr,Cr',
		});
		expect([page.step(), page.chosen()]).toEqual(['match', {}]);
		expect(page.day('2026-04-01')).toBeTruthy();
	});

	it('names a file it cannot read, and stays on the first step', async () => {
		const { page, notifier } = await importer({
			check: vi.fn(() => throwError(() => refusal('import_not_tally'))),
		});
		await page.check();
		expect(notifier.showError).toHaveBeenCalledWith('import_problem_import_not_tally');
		expect([page.step(), page.busy()]).toEqual(['source', false]);
	});
});

describe('matching the ledgers (W2)', () => {
	it('names our ledger for each matched row, offers a choice for new and unplaced ones, and counts those with a balance', async () => {
		const harness = mount();
		await matched(harness);
		const { fixture, page } = harness;
		expect(page.withBalance()).toBe(5);
		expect(page.ledgers().map((l) => l.id)).toEqual(['cash']);
		expect(page.groups().map((g) => g.id)).toEqual(['g1']);
		expect(page.ourName(ROWS[0] as never)).toBe('Cash');
		expect(page.ourName(ROWS[1] as never)).toBe('');
		expect(page.ourName(ROWS[2] as never)).toBe('import_new_in');
		expect(page.ourName(ROWS[5] as never)).toBe('');
		const rows = all(fixture, 'tbody tr');
		expect(rows.filter((r) => r.querySelector('select'))).toHaveLength(3);
		expect([...(rows[4]?.querySelector('select') as HTMLSelectElement).options].map((o) => o.value)).toEqual([
			'',
			'l:cash',
			'g:sundry_creditors',
		]);
		const next = buttonSaying(fixture, 'import_next') as HTMLButtonElement;
		expect(next.disabled).toBe(true);
		enter(rows[4]?.querySelector('select'), 'g:sundry_creditors');
		await settle(fixture);
		expect(page.chosen()).toEqual({ 'Shop fittings': 'g:sundry_creditors' });
		expect(next.disabled).toBe(false);
		(el(fixture, '#imp_only') as HTMLInputElement).click();
		await settle(fixture);
		expect(page.rows().map((r) => r.name)).toEqual(['Nadia Weavers', 'Old suspense', 'Shop fittings']);
		next.click();
		await settle(fixture);
		expect(page.step()).toBe('check');
		buttonSaying(fixture, 'import_back')?.click();
		await settle(fixture);
		expect(page.step()).toBe('match');
		buttonSaying(fixture, 'import_back')?.click();
		expect(page.step()).toBe('source');
	});
});

describe('checking and bringing the books in (W3)', () => {
	it('shows the checks and brings the books in as one opening journal with the choices made', async () => {
		const harness = mount();
		await matched(harness);
		const { fixture, page, calls, notifier, invalidate } = harness;
		page.choose('Shop fittings', 'l:cash');
		page.choose('Old suspense', '');
		page.step.set('check');
		await settle(fixture);
		expect(fixture.nativeElement.textContent).toContain('import_check_balanced');
		expect(fixture.nativeElement.querySelector('.ri-checkbox-circle-line.text-success')).not.toBeNull();
		const bring = el(fixture, '#import_bring_in') as HTMLButtonElement;
		expect(bring.disabled).toBe(false);
		bring.click();
		await settle(fixture);
		expect(calls.bringIn).toHaveBeenCalledWith({
			source: 'tally_xml',
			start: 'year_start',
			startOn: page.startOn(),
			fileName: 'Master.xml',
			text: '<ENVELOPE/>',
			locationId: 'l1',
			choices: [
				{ name: 'Shop fittings', ledgerId: 'cash', groupKey: null },
				{ name: 'Old suspense', ledgerId: null, groupKey: null },
			],
		});
		expect(page.step()).toBe('done');
		expect(notifier.showSuccess).toHaveBeenCalledWith('import_brought_in');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 'imports'] });
		expect(el(fixture, 'a[href="/accounts/vouchers/jv1"]')).not.toBeNull();
	});

	it('cannot bring in books that do not balance, and names a refusal', async () => {
		const harness = mount({
			check: vi.fn(() => of({ ...PREVIEW, balanced: false })),
			bringIn: vi.fn(() => throwError(() => refusal('import_books_not_empty'))),
		});
		await matched(harness);
		const { fixture, page, notifier } = harness;
		page.choose('Shop fittings', 'l:cash');
		page.step.set('check');
		await settle(fixture);
		expect(fixture.nativeElement.querySelector('.ri-close-circle-line.text-danger')).not.toBeNull();
		expect((el(fixture, '#import_bring_in') as HTMLButtonElement).disabled).toBe(true);
		await page.bringIn();
		expect(notifier.showError).toHaveBeenCalledWith('import_problem_import_books_not_empty');
		expect([page.step(), page.busy()]).toEqual(['check', false]);
	});
});

describe('imports done before', () => {
	it('lists each import with Undo, or Undone once undone, and undoes one', async () => {
		const { fixture, page, calls, notifier, invalidate } = await importer({
			list: vi.fn(() => of([IMPORTS[0], { ...IMPORTS[0], id: 'i0', undoneAt: at }])),
		});
		const undo = buttonSaying(fixture, 'import_undo') as HTMLButtonElement;
		expect(undo).toBeDefined();
		expect(fixture.nativeElement.textContent).toContain('import_was_undone');
		undo.click();
		await settle(fixture);
		expect(calls.undo).toHaveBeenCalledWith('i1');
		expect(notifier.showSuccess).toHaveBeenCalledWith('import_undone');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 'imports'] });
		expect(page.busy()).toBe(false);
	});

	it('names a refused undo, offers Undo only to those who may lock, and says when there are none', async () => {
		const refused = await importer({ undo: vi.fn(() => throwError(() => refusal('import_used_since'))) });
		await refused.page.undo(IMPORTS[0] as never);
		expect(refused.notifier.showError).toHaveBeenCalledWith('import_problem_import_used_since');
		const accountant = await importer({}, ['accounts.index', 'accounts.post']);
		expect(buttonSaying(accountant.fixture, 'import_undo')).toBeUndefined();
		const empty = await importer({ list: vi.fn(() => of([])) });
		expect(empty.fixture.nativeElement.querySelector('tbody td[colspan]')).not.toBeNull();
	});

	it('has no rows, ledgers or groups before anything is read', () => {
		const { page } = mount({ list: vi.fn(() => of()) });
		expect([page.rows(), page.withBalance(), page.toChoose(), page.ledgers(), page.groups()]).toEqual([
			[],
			0,
			0,
			[],
			[],
		]);
		expect(page.ourName(ROWS[0] as never)).toBe('');
		expect(page.ourName(ROWS[2] as never)).toBe('');
	});
});
