import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ASSET_KEYS, AssetsGateway } from '@core/accounts/assets.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { RecurringPage, dueThisWeek, entryAmount } from './recurring-page';

/** Rent and recurring entries (accounts brief R5). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysFrom = (day: string, days: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const at = '2026-04-01T00:00:00.000Z';
const entry = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	what: 'Shop rent',
	party: 'Sen Properties',
	kind: 'journal',
	every: 'monthDay',
	day: 5,
	reverseNextDay: false,
	startOn: '2026-04-01',
	endOn: null,
	active: true,
	lines: [
		{ ledgerId: 'rent', locationId: 'l1', debitPaise: 2_500_000, creditPaise: 0, narration: 'Rent' },
		{ ledgerId: 'cash', locationId: 'l1', debitPaise: 0, creditPaise: 2_500_000, narration: '' },
	],
	nextOn: daysFrom(istToday(), 3),
	lastMadeOn: null,
	lastDraftId: null,
	createdBy: 'u1',
	createdAt: at,
	updatedAt: at,
	version: 2,
	...over,
});
const unfilled = [
	{ ledgerId: 'power', locationId: 'l1', debitPaise: 0, creditPaise: 0, narration: '' },
	{ ledgerId: 'cash', locationId: 'l1', debitPaise: 0, creditPaise: 0, narration: '' },
];
const ENTRIES = [
	entry('r1'),
	entry('r2', {
		what: 'Electricity',
		kind: 'payment',
		every: 'monthEnd',
		lines: unfilled,
		nextOn: daysFrom(istToday(), 20),
	}),
	entry('r3', { what: 'Accrued wages', reverseNextDay: true, active: false, nextOn: daysFrom(istToday(), 1) }),
];
const CHART = {
	groups: [],
	ledgers: [
		{ id: 'rent', name: 'Rent', groupId: 'g', active: true },
		{ id: 'cash', name: 'Cash', groupId: 'g' },
		{ id: 'old', name: 'Old ledger', groupId: 'g', active: false },
	],
};
const LOCATIONS = [
	{ id: 'l1', name: 'Barasat', active: true },
	{ id: 'l2', name: 'Head office', active: true },
];

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(gateway: Record<string, unknown> = {}, permissions = ['accounts.index', 'accounts.edit']) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.rec-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const calls = {
		recurring: vi.fn(() => of(ENTRIES)),
		createRecurring: vi.fn(() => of(entry('r9'))),
		updateRecurring: vi.fn(() => of(entry('r1'))),
		removeRecurring: vi.fn(() => of(undefined)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			RecurringPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: AssetsGateway, useValue: calls },
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of(CHART)) } },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of(LOCATIONS)) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'rec-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(RecurringPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, calls };
}

async function page(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const modal = (selector: string) => document.querySelector(`.rec-test-modal ${selector}`) as HTMLElement | null;
const lineRows = () =>
	[...document.querySelectorAll('.rec-test-modal tbody tr')].filter((tr) =>
		tr.querySelector('select'),
	) as HTMLElement[];
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('the recurring entries routes', () => {
	it('names the key and calls each route', () => {
		expect(ASSET_KEYS.recurring).toEqual(['assets', 'recurring']);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(AssetsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/assets/recurring`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.recurring(), 'GET', ''],
			[() => gateway.createRecurring({} as never), 'POST', ''],
			[() => gateway.updateRecurring('r/1', {} as never), 'PUT', '/r%2F1'],
			[() => gateway.removeRecurring('r/1'), 'DELETE', '/r%2F1'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});
});

describe('what an entry comes to, and when it is due', () => {
	it('adds the debit lines, nothing for lines filled in later', () => {
		expect(entryAmount(entry('r1') as never)).toBe(2_500_000);
		expect(entryAmount({ lines: unfilled } as never)).toBe(0);
	});

	it('is due this week up to seven days on, including days gone by, and never while paused', () => {
		const today = '2026-11-24';
		expect(dueThisWeek({ nextOn: '2026-12-01', active: true }, today)).toBe(true);
		expect(dueThisWeek({ nextOn: '2026-12-02', active: true }, today)).toBe(false);
		expect(dueThisWeek({ nextOn: '2026-11-20', active: true }, today)).toBe(true);
		expect(dueThisWeek({ nextOn: '2026-11-25', active: false }, today)).toBe(false);
	});
});

describe('the recurring entries page (R5)', () => {
	it('lists each entry with its amount, what it makes and its next day, paused ones muted', async () => {
		const { fixture } = await page();
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(3);
		expect(rows[0]?.textContent).toContain('₹25,000.00');
		expect(rows[0]?.textContent).toContain('recurring_makes_journal');
		expect(rows[1]?.textContent).toContain('recurring_filled_later');
		expect(rows[1]?.textContent).toContain('recurring_makes_payment');
		expect(rows[2]?.textContent).toContain('recurring_makes_journal_reversed');
		expect(rows[2]?.textContent).toContain('recurring_paused');
		expect(rows[2]?.classList.contains('text-muted')).toBe(true);
		expect(rows[0]?.classList.contains('text-muted')).toBe(false);
		expect(el(fixture, '#recurring_add')).not.toBeNull();
		expect(all(fixture, 'button[title="edit"]')).toHaveLength(3);
		expect(all(fixture, 'button[title="delete"]')).toHaveLength(3);
	});

	it('counts the entries due this week and shows only those on its chip', async () => {
		const { fixture, page: recurring } = await page();
		expect(el(fixture, '#recurring_chip_all')?.textContent).toContain('3');
		expect(el(fixture, '#recurring_chip_week')?.textContent).toContain('1');
		(el(fixture, '#recurring_chip_week') as HTMLButtonElement).click();
		await settle(fixture);
		expect(recurring.rows().map((e) => e.id)).toEqual(['r1']);
		expect(recurring.dateText('2026-11-24')).toBeTruthy();
	});

	it('says when there are none, and shows no changes to someone who may not edit', async () => {
		const empty = await page({ recurring: vi.fn(() => of([])) });
		expect(el(empty.fixture, 'tbody td[colspan]')).not.toBeNull();
		expect(el(empty.fixture, '#recurring_chip_all')?.textContent).toContain('0');
		const reader = await page({}, ['accounts.index']);
		expect(el(reader.fixture, '#recurring_add')).toBeNull();
		expect(all(reader.fixture, 'button[title="edit"]')).toHaveLength(0);
	});

	it('has no rows before the entries are read', () => {
		const { page: recurring } = mount({ recurring: vi.fn(() => of()) });
		expect([recurring.rows(), recurring.weekCount(), recurring.ledgers()]).toEqual([[], 0, []]);
	});
});

describe('adding and changing an entry', () => {
	it('opens a new entry with two blank lines, and is ready once it names what, a ledger and its location', async () => {
		const { fixture, page: recurring, opened } = await page();
		recurring.what.set('stale');
		(el(fixture, '#recurring_add') as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		const redraw = () => popup.view.detectChanges();
		expect([recurring.editing(), recurring.what(), recurring.kind(), recurring.every(), recurring.day()]).toEqual([
			null,
			'',
			'journal',
			'monthDay',
			1,
		]);
		expect([recurring.reverseNextDay(), recurring.endOn(), recurring.active()]).toEqual([false, '', true]);
		expect(recurring.startOn()).toBe(istToday());
		expect(recurring.lines()).toHaveLength(2);
		expect(modal('#rec_day')).not.toBeNull();
		expect(modal('#rec_reverse')).not.toBeNull();
		expect((modal('#rec_save') as HTMLButtonElement).disabled).toBe(true);
		expect(
			[...(lineRows()[0]?.querySelectorAll('select')[0]?.querySelectorAll('option') ?? [])].map((o) => o.value),
		).toEqual(['', 'rent', 'cash']);

		enter(modal('#rec_what'), '  Water bill ');
		enter(lineRows()[0]?.querySelectorAll('select')[0], 'rent');
		redraw();
		expect(recurring.ready()).toBe(false);
		enter(lineRows()[0]?.querySelectorAll('select')[1], 'l2');
		redraw();
		expect(recurring.ready()).toBe(true);
		enter(lineRows()[1]?.querySelectorAll('select')[0], 'cash');
		redraw();
		expect(recurring.ready()).toBe(false);
		(modal('#rec_add_line') as HTMLButtonElement).click();
		expect(recurring.lines()[2]?.locationId).toBe('');
		recurring.setLine(1, { locationId: 'l2' });
		recurring.setLine(2, { locationId: 'l2' });
		recurring.addLine();
		expect(recurring.lines()[3]?.locationId).toBe('l2');
		expect(recurring.ready()).toBe(true);
		redraw();
		expect((modal('#rec_save') as HTMLButtonElement).disabled).toBe(false);

		enter(modal('#rec_every'), 'monthEnd');
		enter(modal('#rec_kind'), 'payment');
		redraw();
		expect(modal('#rec_day')).toBeNull();
		expect(modal('#rec_reverse')).toBeNull();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('removes lines but never the last one', async () => {
		const { page: recurring } = await page();
		recurring.lines.set([{ ledgerId: 'rent', locationId: 'l1', debit: '', credit: '', narration: '' }]);
		recurring.removeLine(0);
		expect(recurring.lines()).toHaveLength(1);
		recurring.addLine();
		recurring.removeLine(0);
		expect(recurring.lines()).toEqual([{ ledgerId: '', locationId: 'l1', debit: '', credit: '', narration: '' }]);
		recurring.lines.set([]);
		recurring.addLine();
		expect(recurring.lines()).toEqual([{ ledgerId: '', locationId: '', debit: '', credit: '', narration: '' }]);
	});

	it('saves a new entry: lines with no ledger left out, rupees in paise, no reversal for a payment, no end day', async () => {
		const { fixture, page: recurring, opened, calls, notifier, invalidate } = await page();
		(el(fixture, '#recurring_add') as HTMLButtonElement).click();
		enter(modal('#rec_what'), '  Water bill ');
		enter(modal('#rec_party'), ' Municipality ');
		recurring.kind.set('payment');
		recurring.reverseNextDay.set(true);
		recurring.lines.set([
			{ ledgerId: 'water', locationId: 'l1', debit: '1,250.50', credit: '', narration: 'Water' },
			{ ledgerId: 'cash', locationId: 'l1', debit: '', credit: '1250.5', narration: '' },
			{ ledgerId: '', locationId: 'l1', debit: '5', credit: '', narration: '' },
		]);
		opened[0]?.view.detectChanges();
		(modal('#rec_save') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.createRecurring).toHaveBeenCalledWith({
			what: 'Water bill',
			party: 'Municipality',
			kind: 'payment',
			every: 'monthDay',
			day: 1,
			reverseNextDay: false,
			startOn: istToday(),
			endOn: null,
			active: true,
			lines: [
				{ ledgerId: 'water', locationId: 'l1', debitPaise: 125_050, creditPaise: 0, narration: 'Water' },
				{ ledgerId: 'cash', locationId: 'l1', debitPaise: 0, creditPaise: 125_050, narration: '' },
			],
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('recurring_saved');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assets', 'recurring'] });
		expect(opened[0]?.close).toHaveBeenCalled();
	});

	it('opens an entry with its amounts in rupees, blank for nothing, and saves the change with its version', async () => {
		const { fixture, page: recurring, opened, calls } = await page();
		(all(fixture, 'button[title="edit"]')[2] as HTMLButtonElement).click();
		expect([recurring.editing()?.id, recurring.what(), recurring.party(), recurring.reverseNextDay()]).toEqual([
			'r3',
			'Accrued wages',
			'Sen Properties',
			true,
		]);
		expect(recurring.active()).toBe(false);
		expect(recurring.lines()).toEqual([
			{ ledgerId: 'rent', locationId: 'l1', debit: '25000', credit: '', narration: 'Rent' },
			{ ledgerId: 'cash', locationId: 'l1', debit: '', credit: '25000', narration: '' },
		]);
		opened[0]?.view.detectChanges();
		(modal('#rec_active') as HTMLInputElement).dispatchEvent(new Event('change'));
		(modal('#rec_reverse') as HTMLInputElement).dispatchEvent(new Event('change'));
		enter(modal('#rec_end'), '2027-03-31');
		enter(modal('#rec_day'), '10');
		enter(modal('#rec_start'), '2026-05-01');
		await recurring.save();
		expect(calls.updateRecurring).toHaveBeenCalledWith(
			'r3',
			expect.objectContaining({
				version: 2,
				active: true,
				reverseNextDay: false,
				endOn: '2027-03-31',
				day: 10,
				startOn: '2026-05-01',
			}),
		);
	});

	it('names a refusal and keeps the pop-up open, and says when it simply failed', async () => {
		const createRecurring = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('recurring_lines_unbalanced')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { fixture, page: recurring, opened, notifier } = await page({ createRecurring });
		(el(fixture, '#recurring_add') as HTMLButtonElement).click();
		await recurring.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('recurring_problem_recurring_lines_unbalanced');
		await recurring.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('recurring_problem_failed');
		expect(opened[0]?.close).not.toHaveBeenCalled();
		expect(recurring.busy()).toBe(false);
	});

	it('removes an entry from its row', async () => {
		const { fixture, calls, notifier } = await page();
		(all(fixture, 'button[title="delete"]')[1] as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.removeRecurring).toHaveBeenCalledWith('r2');
		expect(notifier.showSuccess).toHaveBeenCalledWith('recurring_removed');
	});
});
