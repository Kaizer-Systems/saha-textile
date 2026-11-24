import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { type ShopDetailsImpact, type ShopDetailsView, gstinCheckCharacter } from '@saha-textile/contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ShopDetailsSettings } from './shop-details';

const h = vi.hoisted(() => ({
	data: undefined as unknown,
	bump: (): void => undefined,
	queryFn: null as null | (() => unknown),
	confirm: true,
	asked: [] as unknown[],
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	const { computed, signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	return {
		...actual,
		injectQuery: (options: () => { queryFn: () => unknown }) => {
			h.queryFn = () => options().queryFn();
			return {
				data: computed(() => {
					version();
					return h.data;
				}),
			};
		},
	};
});
vi.mock('@features/purchasing/shared/popups', () => ({
	askConfirm: async (_modals: unknown, ask: unknown) => {
		h.asked.push(ask);
		return h.confirm;
	},
}));

const gstin = (state: string, entity = '1') => {
	const first14 = `${state}AAPFS4821K${entity}Z`;
	return first14 + gstinCheckCharacter(first14);
};

const view = (over: Partial<ShopDetailsView> = {}): ShopDetailsView => ({
	legalName: 'Roy Textiles',
	tradeName: '',
	gstin: gstin('19'),
	address: '14 Hazra Road',
	city: 'Kolkata',
	pin: '700026',
	phone: '',
	email: '',
	updatedAt: '2026-11-16T13:10:00.000Z',
	updatedBy: 'adm_1',
	stateCode: '19',
	stateName: 'West Bengal',
	pan: 'AAPFS4821K',
	homeStateCode: '19',
	homeStateName: 'West Bengal',
	missing: [],
	canEdit: true,
	updatedByName: 'Asha',
	logoUrl: null,
	brandShopName: 'Roy Textiles',
	...over,
});

const impact = (over: Partial<ShopDetailsImpact> = {}): ShopDetailsImpact => ({
	problem: null,
	expectedLastCharacter: null,
	pan: 'AAPFS4821K',
	stateFrom: { code: '19', name: 'West Bengal' },
	stateTo: { code: '27', name: 'Maharashtra' },
	stateChanges: true,
	toIntraState: [],
	toInterState: [],
	...over,
});

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function make(given: ShopDetailsView | null = view(), lang = 'en') {
	const start = given ?? undefined;
	h.data = start;
	const gateway = {
		shopDetails: vi.fn(() => of(start)),
		shopDetailsImpact: vi.fn((_gstin: string) => of(impact())),
		saveShopDetails: vi.fn((_body: unknown) => of(view({ legalName: 'Saved' }))),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queryClient = { setQueryData: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StockGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: {} },
			{ provide: QueryClient, useValue: queryClient },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => lang, getTranslation: () => ({}) },
			},
		],
	});
	TestBed.overrideComponent(ShopDetailsSettings, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ShopDetailsSettings);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture, gateway, notifier, queryClient };
}

beforeEach(() => {
	vi.useFakeTimers();
	h.asked = [];
	h.confirm = true;
});
afterEach(() => {
	vi.useRealTimers();
	h.data = undefined;
});

describe('Settings › Shop details screen (X04–X04D)', () => {
	it('fills the form from the saved record and lists what is still missing', async () => {
		const { c } = make(view({ missing: ['gstin', 'city'] }));
		expect(c.form()?.legalName).toBe('Roy Textiles');
		expect(c.canEdit()).toBe(true);
		expect(c.changed()).toBe(false);
		expect(c.missingText()).toBe('gstin and city');
		await h.queryFn?.();
		const bengali = make(view({ missing: ['pin'] }), 'bn');
		expect(bengali.c.missingText()).toBe('pin_code');
		const none = make(null);
		expect(none.c.form()).toBeNull();
		expect(none.c.missingText()).toBe('');
		expect(none.c.canEdit()).toBe(false);
		expect(none.c.problems()).toEqual({});
		expect(none.c.blocked()).toBe(false);
		none.c.set('city', 'x');
		none.c.cancel();
		await none.c.save();
	});

	it('checks a new full GSTIN on the server as it is typed, and only then', async () => {
		const { c, gateway } = make();
		c.set('gstin', ` ${gstin('27').toLowerCase()} `);
		expect(c.form()?.gstin).toBe(gstin('27'));
		await vi.advanceTimersByTimeAsync(300);
		expect(gateway.shopDetailsImpact).toHaveBeenCalledWith(gstin('27'));
		expect(c.verdict().kind).toBe('ok');
		gateway.shopDetailsImpact.mockReturnValueOnce(throwError(() => new Error('down')));
		c.set('gstin', gstin('29'));
		await vi.advanceTimersByTimeAsync(300);
		expect(c.gstinCheck()?.result).toBe('failed');
		c.set('gstin', gstin('19'));
		c.set('gstin', '19AB');
		await vi.advanceTimersByTimeAsync(300);
		expect(gateway.shopDetailsImpact).toHaveBeenCalledTimes(2);
		const reader = make(view({ canEdit: false }));
		reader.c.set('gstin', gstin('27'));
		await vi.advanceTimersByTimeAsync(300);
		expect(reader.gateway.shopDetailsImpact).not.toHaveBeenCalled();
		const empty = make(view({ gstin: null }));
		empty.c.set('gstin', gstin('19'));
		await vi.advanceTimersByTimeAsync(300);
		expect(empty.gateway.shopDetailsImpact).toHaveBeenCalled();
	});

	it('shows a row’s problem once it was left, and a wrong GSTIN at once', () => {
		const { c } = make();
		c.set('city', '');
		expect(c.problemOf('city')).toBeNull();
		c.touch('city');
		expect(c.problemOf('city')).toBe('shop_field_required');
		expect(c.blocked()).toBe(true);
		c.set('gstin', `${gstin('19')}X`);
		expect(c.problemOf('gstin')).toBe('gstin_shape_wrong');
		c.set('gstin', gstin('19'));
		expect(c.problemOf('gstin')).toBeNull();
		c.touch('gstin');
		expect(c.problemOf('gstin')).toBeNull();
		c.cancel();
		expect(c.touched().size).toBe(0);
		expect(c.form()?.city).toBe('Kolkata');
	});

	it('saves a plain change straight away, and shows a refusal', async () => {
		const { c, gateway, notifier, queryClient } = make();
		await c.save();
		expect(gateway.saveShopDetails).not.toHaveBeenCalled();
		c.set('phone', '+91 98300 00000');
		c.set('tradeName', '  Roy  ');
		await c.save();
		expect(gateway.saveShopDetails).toHaveBeenCalledWith(
			expect.objectContaining({
				phone: '+91 98300 00000',
				tradeName: 'Roy',
				expectedUpdatedAt: '2026-11-16T13:10:00.000Z',
			}),
		);
		expect(queryClient.setQueryData).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('shop_details_saved');
		expect(c.form()?.legalName).toBe('Saved');
		h.data = view();
		h.bump();
		c.set('phone', '+91 98300 11111');
		gateway.saveShopDetails.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(c.error()).toBe('purchasing_action_failed');
		c.busy.set(true);
		await c.save();
		expect(gateway.saveShopDetails).toHaveBeenCalledTimes(2);
	});

	it('asks before a new GSTIN, naming the State move and the suppliers it changes', async () => {
		const { c, gateway } = make();
		const rows = (count: number) =>
			Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Supplier ${i}` }));
		gateway.shopDetailsImpact.mockReturnValue(of(impact({ toIntraState: rows(7), toInterState: rows(1) })));
		c.set('gstin', gstin('27'));
		await vi.advanceTimersByTimeAsync(300);
		h.confirm = false;
		await c.save();
		expect(gateway.saveShopDetails).not.toHaveBeenCalled();
		const ask = h.asked[0] as { title: string; items: string[] };
		expect(ask.title).toBe('shop_change_title_gstin');
		expect(ask.items.join(' ')).toContain('shop_change_and_more(2)');
		h.confirm = true;
		gateway.shopDetailsImpact.mockReturnValue(of(impact()));
		c.gstinCheck.set(null);
		await c.save();
		expect((h.asked[1] as { items: string[] }).items).toContain('shop_change_no_supplier_moves');
		expect(gateway.saveShopDetails).toHaveBeenCalled();
	});

	it('asks before a new legal name in the same State, and stops when the server finds a problem', async () => {
		const { c, gateway } = make();
		gateway.shopDetailsImpact.mockReturnValue(
			of(impact({ stateChanges: false, stateTo: { code: '19', name: 'West Bengal' } })),
		);
		c.set('legalName', 'Roy Textiles LLP');
		await c.save();
		const ask = h.asked[0] as { title: string; items: string[] };
		expect(ask.title).toBe('shop_change_title_name');
		expect(ask.items).toContain('shop_change_tax_same(West Bengal)');
		const first = make(view({ gstin: null, legalName: '' }));
		first.gateway.shopDetailsImpact.mockReturnValue(of(impact({ stateTo: null, problem: 'state' } as never)));
		first.c.set('gstin', gstin('27'));
		first.c.set('legalName', 'New name');
		await first.c.save();
		expect(first.gateway.saveShopDetails).not.toHaveBeenCalled();
		expect(first.c.gstinCheck()?.gstin).toBe(gstin('27'));
		const failing = make();
		failing.gateway.shopDetailsImpact.mockReturnValue(throwError(() => new Error('down')));
		failing.c.set('legalName', 'Another');
		await failing.c.save();
		expect(failing.c.error()).toBe('purchasing_action_failed');
		expect(failing.c.busy()).toBe(false);
		const renamed = make(view({ gstin: null }));
		renamed.gateway.shopDetailsImpact.mockReturnValue(
			of(impact({ stateChanges: false, stateTo: { code: '19', name: 'West Bengal' } })),
		);
		renamed.c.set('legalName', 'Changed');
		renamed.c.set('gstin', gstin('19'));
		await vi.advanceTimersByTimeAsync(300);
		await renamed.c.save();
		expect((h.asked.at(-1) as { items: string[] }).items.join(' ')).toContain('shop_change_none');
	});
});
