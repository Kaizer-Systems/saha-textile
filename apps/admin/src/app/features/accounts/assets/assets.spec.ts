import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ASSET_KEYS, AssetsGateway } from '@core/accounts/assets.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AssetFormPage, monthlySlm, payingLedgers } from './asset-form';
import { AssetsRegisterPage, bookValue } from './assets-register';
import { DepreciationPage, thisMonth } from './depreciation-page';

/** Fixed assets (accounts brief R1–R4): the register, adding and changing an asset, and the month's depreciation. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.edit', 'accounts.post'];

const at = '2026-04-10T00:00:00.000Z';
const asset = (over: Record<string, unknown> = {}) => ({
	id: 'as1',
	tag: 'FA-0001',
	name: 'Billing counter',
	categoryKey: 'furniture',
	locationId: 'l2',
	costINR: 50_000,
	putToUseOn: '2026-04-10',
	method: 'slm',
	lifeMonths: 120,
	residualINR: 2_500,
	run: 'monthly',
	taxRatePct: 10,
	inputGst: 'claimed',
	reference: 'Bill 77',
	status: 'active',
	disposedOn: null,
	disposalINR: null,
	accumulatedPaise: 300_000,
	depreciatedThrough: '2026-10',
	assetLedgerId: 'led_fa',
	acquisitionVoucherId: null,
	createdBy: 'u1',
	createdAt: at,
	updatedAt: at,
	version: 4,
	...over,
});
const CATEGORIES = {
	categories: [
		{ key: 'furniture', lifeYears: 10, taxRatePct: 10 },
		{ key: 'computers', lifeYears: 3, taxRatePct: 40 },
	],
	residualPercent: 5,
};
const LOCATIONS = [
	{ id: 'l0', name: 'Old shop', active: false },
	{ id: 'l1', name: 'Barasat', active: true },
	{ id: 'l2', name: 'Head office', active: true },
];
const group = (id: string, systemKey: string | null, parentId: string | null = null) => ({
	id,
	systemKey,
	parentId,
	name: id,
	nature: 'asset',
	order: 0,
	createdAt: at,
	updatedAt: at,
});
const ledger = (id: string, groupId: string, active = true) => ({
	id,
	name: `Ledger ${id}`,
	groupId,
	active,
	nature: 'asset',
	createdAt: at,
	updatedAt: at,
});
const CHART = {
	groups: [
		group('g_cash', 'cash_in_hand'),
		group('g_bank', 'bank_accounts'),
		group('g_branch', null, 'g_bank'),
		group('g_od', 'bank_od'),
		group('g_cred', 'sundry_creditors'),
		group('g_exp', 'indirect_expenses'),
		group('g_loose', null),
	],
	ledgers: [
		ledger('cash', 'g_cash'),
		ledger('hdfc', 'g_branch'),
		ledger('od', 'g_od'),
		ledger('nadia', 'g_cred'),
		ledger('old_cash', 'g_cash', false),
		ledger('rent', 'g_exp'),
		ledger('orphan', 'g_missing'),
		ledger('loose', 'g_loose'),
	],
};

function mount<T>(
	component: Type<T>,
	assets: Record<string, unknown>,
	options: { id?: string | null; permissions?: string[]; categories?: unknown; locations?: unknown[] } = {},
) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		list: vi.fn(() => of([asset()])),
		categories: vi.fn(() => of(options.categories ?? CATEGORIES)),
		one: vi.fn(() => of(asset())),
		create: vi.fn(() => of(asset())),
		update: vi.fn(() => of(asset())),
		dispose: vi.fn(() => of(asset({ status: 'disposed' }))),
		preview: vi.fn(() => of({ month: '2026-11', rows: [], totalPaise: 0, voucherId: null })),
		post: vi.fn(() => of({})),
		...assets,
	};
	TestBed.configureTestingModule({
		imports: [
			component,
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
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of(options.locations ?? LOCATIONS)) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ALL) } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id ? { id: options.id } : {})) },
			},
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, navigate, calls };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const enter = (control: HTMLElement | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('the assets gateway', () => {
	it('names its keys and calls each route', () => {
		expect([ASSET_KEYS.all, ASSET_KEYS.list, ASSET_KEYS.categories]).toEqual([
			['assets'],
			['assets', 'list'],
			['assets', 'categories'],
		]);
		expect(ASSET_KEYS.one('as1')).toEqual(['assets', 'one', 'as1']);
		expect(ASSET_KEYS.run('2026-11')).toEqual(['assets', 'depreciation', '2026-11']);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(AssetsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/assets`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.list(), 'GET', ''],
			[() => gateway.categories(), 'GET', '/categories'],
			[() => gateway.one('a/1'), 'GET', '/a%2F1'],
			[() => gateway.create({} as never), 'POST', ''],
			[() => gateway.update('a/1', {} as never), 'PUT', '/a%2F1'],
			[() => gateway.dispose('a/1', {} as never), 'POST', '/a%2F1/dispose'],
			[() => gateway.preview('2026-11'), 'GET', '/depreciation/2026-11'],
			[() => gateway.post('2026-11'), 'POST', '/depreciation/2026-11'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});
});

describe('the fixed assets register (R1)', () => {
	it('shows the active assets with their book value, counts each chip, and switches to the disposed ones', async () => {
		const disposed = asset({ id: 'as2', tag: 'FA-0002', name: 'Old scale', status: 'disposed' });
		const { fixture, page } = mount(AssetsRegisterPage, {
			list: vi.fn(() => of([asset(), asset({ id: 'as3', tag: 'FA-0003', name: 'Laptop' }), disposed])),
		});
		expect(page.rows()).toEqual([]);
		await settle(fixture);
		expect(bookValue(asset() as never)).toBe(4_700_000);
		expect(bookValue({ costINR: 1_234.56, accumulatedPaise: 23_456 })).toBe(100_000);
		expect(page.counts()).toEqual({ active: 2, disposed: 1 });
		const chips = all(fixture, 'button').filter((b) => b.textContent?.includes('assets_chip_'));
		expect(chips.map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'assets_chip_active 2',
			'assets_chip_disposed 1',
		]);
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain('₹47,000.00');
		expect(rows[0]?.querySelector('a[title="view"]')?.getAttribute('href')).toBe('/accounts/assets/as1');
		chips[1]?.click();
		await settle(fixture);
		expect(page.rows().map((a) => a.id)).toEqual(['as2']);
		expect(page.day('2026-04-10')).toBeTruthy();
		expect(el(fixture, '#assets_depreciation')?.getAttribute('href')).toBe('/accounts/assets/depreciation');
		expect(el(fixture, '#assets_add')?.getAttribute('href')).toBe('/accounts/assets/new');
	});

	it('says when there are no assets', async () => {
		const { fixture } = mount(AssetsRegisterPage, { list: vi.fn(() => of([])) });
		await settle(fixture);
		expect(fixture.nativeElement.textContent).toContain('assets_none');
	});
});

const RUN = {
	month: '2026-11',
	rows: [
		{
			assetId: 'as1',
			tag: 'FA-0001',
			name: 'Billing counter',
			method: 'slm',
			lifeMonths: 120,
			costPaise: 5_000_000,
			thisMonthPaise: 39_583,
			bookValueAfterPaise: 4_660_417,
		},
	],
	totalPaise: 39_583,
	voucherId: null,
};

describe('the month’s depreciation (R3)', () => {
	it('takes this month in India, so the small hours of the 1st are already the new month', () => {
		expect(thisMonth(new Date('2026-11-30T19:00:00.000Z'))).toBe('2026-12');
		expect(thisMonth(new Date('2026-11-30T18:00:00.000Z'))).toBe('2026-11');
		expect(thisMonth()).toMatch(/^\d{4}-\d{2}$/);
	});

	it('previews each asset’s amount and book value after, totals them, and posts the month once', async () => {
		const preview = vi.fn(() => of(RUN));
		const harness = mount(DepreciationPage, { preview });
		const { fixture, page } = harness;
		await settle(fixture);
		expect(preview).toHaveBeenCalledWith(thisMonth());
		const rows = all(fixture, 'tbody tr');
		expect(rows[0]?.textContent).toContain('FA-0001 · Billing counter');
		expect(rows[0]?.textContent).toContain('assets_method_short');
		expect(rows[0]?.textContent).toContain('₹46,604.17');
		expect(rows[1]?.textContent).toContain('total');
		expect(rows[1]?.textContent).toContain('₹395.83');
		(el(fixture, '#dep_post') as HTMLButtonElement).click();
		await settle(fixture);
		expect(harness.calls.post).toHaveBeenCalledWith(thisMonth());
		expect(harness.notifier.showSuccess).toHaveBeenCalledWith('assets_depreciation_posted');
		expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: ['assets'] });
		expect(page.busy()).toBe(false);
		enter(el(fixture, '#dep_month'), '2026-10');
		await settle(fixture);
		expect(preview).toHaveBeenLastCalledWith('2026-10');
		const calls = preview.mock.calls.length;
		enter(el(fixture, '#dep_month'), '');
		await settle(fixture);
		expect(preview).toHaveBeenCalledTimes(calls);
	});

	it('shows a posted month with its journal, and offers no Post for a month with nothing to take', async () => {
		const posted = mount(DepreciationPage, { preview: vi.fn(() => of({ ...RUN, voucherId: 'jv9' })) });
		await settle(posted.fixture);
		expect(el(posted.fixture, '.alert-info a')?.getAttribute('href')).toBe('/accounts/vouchers/jv9');
		expect(el(posted.fixture, '#dep_post')).toBeNull();
		expect(el(posted.fixture, 'table')).toBeNull();

		const empty = mount(DepreciationPage, {});
		await settle(empty.fixture);
		expect(empty.fixture.nativeElement.textContent).toContain('assets_depreciation_none');
		expect(el(empty.fixture, '#dep_post')).toBeNull();

		const reader = mount(DepreciationPage, { preview: vi.fn(() => of(RUN)) }, { permissions: ['accounts.index'] });
		await settle(reader.fixture);
		expect(el(reader.fixture, '#dep_post')).toBeNull();
	});

	it('names a refused post, or says it failed', async () => {
		const post = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('depreciation_posted')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = mount(DepreciationPage, { post });
		await page.post();
		expect(notifier.showError).toHaveBeenLastCalledWith('assets_problem_depreciation_posted');
		await page.post();
		expect(notifier.showError).toHaveBeenLastCalledWith('assets_problem_failed');
		expect(page.busy()).toBe(false);
	});
});

describe('what an asset can be paid from, and its monthly charge', () => {
	it('keeps active ledgers under cash, bank, overdraft or suppliers, however deep', () => {
		expect(payingLedgers(CHART as never)).toEqual([
			{ id: 'cash', name: 'Ledger cash' },
			{ id: 'hdfc', name: 'Ledger hdfc' },
			{ id: 'od', name: 'Ledger od' },
			{ id: 'nadia', name: 'Ledger nadia' },
		]);
	});

	it('spreads cost less residual over the life, and charges nothing with no life', () => {
		expect(monthlySlm(50_000, 2_500, 120)).toBe(39_583);
		expect(monthlySlm(50_000, 2_500, 0)).toBe(0);
	});
});

describe('adding an asset (R2)', () => {
	async function blank(over: Record<string, unknown> = {}, options: Parameters<typeof mount>[2] = {}) {
		const harness = mount(AssetFormPage, over, options);
		await settle(harness.fixture);
		return harness;
	}

	it('picks the first active location, sets the residual from the cost, and takes a kind’s presets', async () => {
		const { fixture, page } = await blank();
		expect(page.locationId()).toBe('l1');
		expect(all(fixture, '#asset_location option').map((o) => (o as HTMLOptionElement).value)).toEqual(['l1', 'l2']);
		enter(el(fixture, '#asset_cost'), '50000');
		expect([page.cost(), page.residual()]).toEqual([50_000, 2_500]);
		enter(el(fixture, '#asset_kind'), 'computers');
		expect([page.categoryKey(), page.lifeMonths(), page.taxRatePct(), page.residual()]).toEqual([
			'computers',
			36,
			40,
			2_500,
		]);
		page.pickCategory('vehicles');
		expect([page.categoryKey(), page.lifeMonths(), page.taxRatePct()]).toEqual(['vehicles', 36, 40]);
		await settle(fixture);
		expect(fixture.nativeElement.textContent).toContain('assets_schedule_line');
		expect(el(fixture, '#asset_cost')?.hasAttribute('disabled')).toBe(false);
		expect(fixture.nativeElement.textContent).not.toContain('assets_taken_so_far');
	});

	it('cannot be saved with no active location, and has nothing to pay from before the chart is read', async () => {
		const harness = mount(AssetFormPage, {}, { locations: [LOCATIONS[0]] });
		expect(harness.page.paying()).toEqual([]);
		await settle(harness.fixture);
		harness.page.name.set('Laptop');
		harness.page.setCost(60_000);
		await settle(harness.fixture);
		expect(harness.page.locationId()).toBe('');
		expect((el(harness.fixture, '#asset_save') as HTMLButtonElement).disabled).toBe(true);
	});

	it('takes 5% for the residual when the presets name none or are not read yet', async () => {
		const unnamed = await blank({}, { categories: { categories: CATEGORIES.categories } });
		unnamed.page.setCost(10_000);
		unnamed.page.pickCategory('furniture');
		expect(unnamed.page.residual()).toBe(500);
		const unread = await blank({ categories: vi.fn(() => NEVER) });
		unread.page.setCost(20_000);
		expect(unread.page.residual()).toBe(1_000);
	});

	it('needs a name, a location and a cost, and saves an asset already in the books', async () => {
		const { fixture, page, calls, notifier, navigate, invalidate } = await blank();
		const save = () => el(fixture, '#asset_save') as HTMLButtonElement;
		expect(save().disabled).toBe(true);
		enter(el(fixture, '#asset_name'), '  Billing counter  ');
		enter(el(fixture, '#asset_cost'), '50000');
		enter(el(fixture, '#asset_reference'), ' Bill 77 ');
		await settle(fixture);
		expect(save().disabled).toBe(false);
		save().click();
		await settle(fixture);
		expect(calls.create).toHaveBeenCalledWith({
			name: 'Billing counter',
			categoryKey: 'furniture',
			locationId: 'l1',
			method: 'slm',
			lifeMonths: 120,
			residualINR: 2_500,
			run: 'monthly',
			taxRatePct: 10,
			inputGst: 'claimed',
			reference: 'Bill 77',
			costINR: 50_000,
			putToUseOn: page.putToUseOn(),
			acquisition: { kind: 'books' },
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('assets_saved');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assets'] });
		expect(navigate).toHaveBeenCalledWith(['/accounts/assets']);
	});

	it('posts a new asset against the ledger it was paid from, which must be picked', async () => {
		const { fixture, page, calls } = await blank();
		page.name.set('Laptop');
		page.setCost(60_000);
		const radios = all(fixture, 'input[type="radio"]');
		expect(radios).toHaveLength(2);
		radios[1]?.dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(page.acquisition()).toBe('post');
		expect(all(fixture, '#asset_paid_from option').map((o) => (o as HTMLOptionElement).value)).toEqual([
			'',
			'cash',
			'hdfc',
			'od',
			'nadia',
		]);
		expect((el(fixture, '#asset_save') as HTMLButtonElement).disabled).toBe(true);
		enter(el(fixture, '#asset_paid_from'), 'hdfc');
		await settle(fixture);
		(el(fixture, '#asset_save') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.create).toHaveBeenCalledWith(
			expect.objectContaining({ acquisition: { kind: 'post', ledgerId: 'hdfc' } }),
		);
		radios[0]?.dispatchEvent(new Event('change'));
		expect(page.acquisition()).toBe('books');
	});

	it('names a refusal and stays, and needs accounts.post to add', async () => {
		const refused = await blank({ create: vi.fn(() => throwError(() => refusal('asset_location_unknown'))) });
		await refused.page.save();
		expect(refused.notifier.showError).toHaveBeenCalledWith('assets_problem_asset_location_unknown');
		expect(refused.navigate).not.toHaveBeenCalled();
		expect(refused.page.busy()).toBe(false);
		const accountant = await blank({}, { permissions: ['accounts.index', 'accounts.edit'] });
		expect(el(accountant.fixture, '#asset_save')).toBeNull();
		await accountant.page.dispose();
		expect(accountant.calls.dispose).not.toHaveBeenCalled();
	});
});

describe('changing and disposing of an asset (R2, R4)', () => {
	async function saved(over: Record<string, unknown> = {}, options: Parameters<typeof mount>[2] = {}) {
		const harness = mount(AssetFormPage, over, { id: 'as1', ...options });
		await settle(harness.fixture);
		return harness;
	}

	it('opens the asset once with what was taken so far, keeps its cost and day, and saves the change', async () => {
		let version = 4;
		const one = vi.fn(() => of(asset({ version: version++ })));
		const { fixture, page, calls, navigate } = await saved({ one });
		expect(one).toHaveBeenCalledWith('as1');
		expect([page.name(), page.locationId(), page.cost(), page.reference()]).toEqual([
			'Billing counter',
			'l2',
			50_000,
			'Bill 77',
		]);
		expect(fixture.nativeElement.textContent).toContain('assets_taken_so_far');
		expect(el(fixture, '#asset_cost')?.hasAttribute('disabled')).toBe(true);
		expect(el(fixture, '#asset_in_use')?.hasAttribute('disabled')).toBe(true);
		expect(all(fixture, 'input[type="radio"]')).toHaveLength(0);
		page.name.set('Main billing counter');
		await page.asset.refetch();
		await settle(fixture);
		expect(page.name()).toBe('Main billing counter');
		(el(fixture, '#asset_save') as HTMLButtonElement).click();
		await settle(fixture);
		const [id, edit] = calls.update.mock.lastCall as unknown as [string, Record<string, unknown>];
		expect(id).toBe('as1');
		expect(edit).toMatchObject({ name: 'Main billing counter', version: 5 });
		expect(edit).not.toHaveProperty('costINR');
		expect(edit).not.toHaveProperty('putToUseOn');
		expect(navigate).toHaveBeenCalledWith(['/accounts/assets']);
	});

	it('disposes of an active asset on a day with its proceeds', async () => {
		const { fixture, page, calls, notifier } = await saved();
		expect(el(fixture, '#asset_dispose')).not.toBeNull();
		enter(el(fixture, '#asset_dispose_on'), '2026-11-20');
		enter(el(fixture, '#asset_proceeds'), '12000');
		(el(fixture, '#asset_dispose') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.dispose).toHaveBeenCalledWith('as1', { on: '2026-11-20', proceedsINR: 12_000, version: 4 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('assets_disposed');
		expect(page.busy()).toBe(false);
	});

	it('shows when a disposed asset went, and lets only accounts.edit change and accounts.post dispose', async () => {
		const gone = await saved({ one: vi.fn(() => of(asset({ status: 'disposed', disposedOn: '2026-11-20' }))) });
		expect(el(gone.fixture, '#asset_dispose')).toBeNull();
		expect(el(gone.fixture, '.alert-info')?.textContent).toContain('assets_disposed_on');
		const editor = await saved({}, { permissions: ['accounts.index', 'accounts.edit'] });
		expect(el(editor.fixture, '#asset_save')).not.toBeNull();
		expect(el(editor.fixture, '#asset_dispose')).toBeNull();
	});

	it('sends version 0 for an asset that could not be read', async () => {
		const { page, calls } = await saved({ one: vi.fn(() => throwError(() => new Error('gone'))) });
		await page.save();
		expect(calls.update).toHaveBeenCalledWith('as1', expect.objectContaining({ version: 0 }));
		await page.dispose();
		expect(calls.dispose).toHaveBeenCalledWith('as1', expect.objectContaining({ version: 0 }));
	});
});
