import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { type ShopDetailsImpact, type ShopDetailsView, gstinCheckCharacter } from '@saha-textile/contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ShopDetailsSettings, shopGstinVerdict } from './shop-details';

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

describe('Settings › Shop details: the last cases', () => {
	it('reads the verdict before the record and the form arrive', () => {
		const { c } = make(null);
		expect(c.form()).toBeNull();
		expect(c.verdict()).toEqual({ kind: 'empty' });
	});

	it('reads the saved GSTIN with no State name or PAN on record', () => {
		const saved = view({ stateName: null, pan: null } as never);
		expect(shopGstinVerdict(gstin('19'), saved, null)).toEqual({
			kind: 'ok',
			stateCode: '19',
			stateName: '19',
			pan: '',
		});
	});

	it('words the server’s check: no expected character, another problem, no State, and no PAN', () => {
		const typed = gstin('27');
		const checked = (over: Partial<ShopDetailsImpact>) =>
			shopGstinVerdict(typed, null, { gstin: typed, result: impact(over) });
		expect(checked({ problem: 'check_digit', expectedLastCharacter: null } as never)).toEqual({
			kind: 'problem',
			key: 'shop_gstin_check_digit_wrong',
			params: { expected: '' },
		});
		expect(checked({ problem: 'shape' } as never)).toMatchObject({ kind: 'problem', key: 'gstin_shape_wrong' });
		expect(checked({ stateTo: null } as never)).toMatchObject({ kind: 'problem', key: 'gstin_shape_wrong' });
		expect(checked({ pan: null } as never)).toEqual({
			kind: 'ok',
			stateCode: '27',
			stateName: 'Maharashtra',
			pan: '',
		});
	});

	it('names a first legal name as changing from none', async () => {
		const { c, gateway } = make(view({ legalName: '' }));
		gateway.shopDetailsImpact.mockReturnValue(
			of(impact({ stateChanges: false, stateTo: { code: '19', name: 'West Bengal' } })),
		);
		c.set('gstin', gstin('19', '2'));
		c.set('legalName', 'Roy Textiles');
		await c.save();
		const ask = h.asked.at(-1) as { items: string[] };
		expect(ask.items).toContain('shop_change_name(shop_change_none|Roy Textiles)');
	});
});
