import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';

import { ShippingCouriers } from './couriers/couriers';
import { OrdersAbroad } from './orders-abroad/orders-abroad';
import { ShippingOverview } from './overview/shipping-overview';
import { WhereRulesApply } from './where-rules-apply/where-rules-apply';

/** Every query is a stand-in read from `h.data` by its key; `h.bump()` makes the pages read again. */
const h = vi.hoisted(() => ({
	data: new Map<string, unknown>(),
	bump: (): void => undefined,
	fns: [] as Array<() => unknown>,
	confirm: true,
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	const { computed, signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	return {
		...actual,
		injectQuery: (options: () => { queryKey: unknown[]; queryFn: () => unknown }) => {
			h.fns.push(() => options().queryFn());
			return {
				data: computed(() => {
					version();
					return h.data.get(options().queryKey.join('/'));
				}),
			};
		},
	};
});
vi.mock('@features/purchasing/shared/popups', () => ({ askConfirm: async () => h.confirm }));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const gateway = {
	overview: vi.fn(() => of({})),
	ruleSets: vi.fn(() => of([])),
	exceptions: vi.fn(() => of([])),
	saveSettings: vi.fn((_body: unknown) => of({})),
	create: vi.fn((_body: unknown) => of({ ruleSet: { id: 'rs_new' } })),
	remove: vi.fn(() => of({ ok: true })),
	saveException: vi.fn((_id: string | null, _body: unknown) => of({})),
	removeException: vi.fn(() => of({ ok: true })),
	productTitle: vi.fn((id: string) => of({ id, title: `Title ${id}` })),
	searchProducts: vi.fn(() => of({ items: [{ id: 'p1', title: 'Silk' }] })),
};
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
const router = { navigate: vi.fn() };
const popup = { close: vi.fn() };
const modals = { open: vi.fn(() => popup) };
const queryClient = { invalidateQueries: vi.fn(async () => undefined) };

function make<T>(type: Type<T>, permissions = ['shipping.edit', 'shipping.create', 'shipping.destroy']) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ShippingGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: {} },
			{ provide: QueryClient, useValue: queryClient },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: AuthStore, useValue: { permissions: () => permissions } },
			{ provide: CategoryService, useValue: { getCategoryRows: () => of([]) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture, settle: () => fixture.detectChanges() };
}

const settings = (over: Record<string, unknown> = {}) => ({
	domestic: { kind: 'ruleSet', ruleSetId: 'rs_dom' },
	international: {
		kind: 'courier',
		courierId: 'dhl',
		fallbackRuleSetId: 'rs_intl',
		extra: { amountINR: 100, percent: 5 },
	},
	defaultCharges: { domestic: 100, internationalFirst: 1500, internationalFurther: 500 },
	mixedRuleSets: 'sum',
	abroadPolicy: 'exportOffIndianInvoice',
	abroadOptions: { askForHomeAddress: false, holdPackingUntilComplete: true },
	homeCountry: 'IN',
	updatedAt: '2026-11-20T00:00:00.000Z',
	updatedBy: 'adm_1',
	...over,
});
const RULE_SETS = [
	{ id: 'rs_dom', name: 'Domestic', use: 'domestic', activeVersion: 1 },
	{ id: 'rs_intl', name: 'Abroad', use: 'international', activeVersion: 2 },
	{ id: 'rs_both', name: 'Both', use: 'both', activeVersion: 1 },
	{ id: 'rs_draft', name: 'Draft', use: 'domestic', activeVersion: null },
];
function overview(over: Record<string, unknown> = {}) {
	h.data.set('shipping/overview', {
		settings: settings(),
		defaults: settings({ homeCountry: 'GB' }),
		ruleSets: RULE_SETS,
		checks: [],
		exceptionTargets: { categories: 0, products: 0 },
		abroadPolicies: ['exportOffIndianInvoice', 'indiaOnly'],
		...over,
	});
	h.bump();
}

afterEach(() => {
	h.data.clear();
	h.bump();
	h.confirm = true;
	vi.clearAllMocks();
});

describe('shipping screens: the last cases', () => {
	it('a shop with no saved settings starts every screen from the defaults', () => {
		overview({ settings: null });
		const couriers = make(ShippingCouriers);
		couriers.settle();
		expect(couriers.c.canEdit()).toBe(true);
		expect(couriers.c.form()?.homeCountry).toBe('GB');
		const abroad = make(OrdersAbroad, []);
		abroad.settle();
		expect(abroad.c.canEdit()).toBe(false);
		expect(abroad.c.chosen()).toBe('exportOffIndianInvoice');
		const home = make(ShippingOverview);
		expect(home.c.canEdit()).toBe(true);
	});

	it('the overview sees no zero-charge warning before its answer arrives', () => {
		const { c } = make(ShippingOverview);
		expect(c.zeroDefaults()).toBe(false);
	});

	it('saving site-wide rules from the defaults, with no rule set chosen abroad', () => {
		overview({ settings: null });
		const { c, settle } = make(WhereRulesApply);
		settle();
		c.siteWide.set({ domestic: 'rs_dom', international: '' });
		c.saveSiteWide();
		const body = gateway.saveSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
		expect(body['homeCountry']).toBe('GB');
		expect(body['updatedAt']).toBeUndefined();
		expect(body['domestic']).toEqual({ kind: 'ruleSet', ruleSetId: 'rs_dom' });
		expect(body['international']).toEqual({ kind: 'ruleSet', ruleSetId: null });
	});
});
