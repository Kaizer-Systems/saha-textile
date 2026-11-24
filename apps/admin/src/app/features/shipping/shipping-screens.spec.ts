import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';

import { ShippingCouriers } from './couriers/couriers';
import { OrdersAbroad } from './orders-abroad/orders-abroad';
import { ShippingCartTester } from './overview/cart-tester';
import { ShippingOverview } from './overview/shipping-overview';
import { NewRuleSet } from './rule-sets/new-rule-set';
import { ShippingRuleSets } from './rule-sets/rule-sets';
import ROUTES from './shipping.routes';
import { WhereRulesApply } from './where-rules-apply/where-rules-apply';

import type { AdminShippingRuleSetRow, ShippingException } from '@saha-textile/contracts';

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
const failure = { status: 500 };

afterEach(() => {
	h.data.clear();
	h.bump();
	h.confirm = true;
	vi.clearAllMocks();
});

describe('Shipping › Overview (ov01)', () => {
	it('edits the shop defaults and saves them without the audit fields', () => {
		const { c, settle } = make(ShippingOverview);
		expect(c.method('domestic')).toBeNull();
		expect(c.ruleSetOf('domestic')).toBeNull();
		c.setCharge('domestic', 5);
		c.setMixed('highest');
		c.save();
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		expect(c.ownRules()).toBe('ship_check_no_own_rules');
		h.data.set('shipping/rule-sets', [{ ruleSet: { id: 'rs_dom', description: 'Each line pays its charge' } }]);
		overview({ checks: [{ code: 'default_charges_zero', severity: 'warning' }] });
		settle();
		expect(c.ruleSetOf('domestic')?.name).toBe('Domestic');
		expect(c.ruleSetOf('international')?.name).toBe('Abroad');
		expect(c.describe('domestic')).toBe('Each line pays its charge');
		expect(c.describe('international')).toBe('');
		expect(c.notNeeded('international')).toBe(false);
		expect(c.zeroDefaults()).toBe(true);
		c.setCharge('domestic', -5);
		c.setCharge('internationalFirst', null);
		c.setMixed('highest');
		expect(c.form()?.defaultCharges).toMatchObject({ domestic: 0, internationalFirst: 0 });
		c.save();
		const sent = gateway.saveSettings.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(sent).not.toHaveProperty('updatedAt');
		expect(sent['mixedRuleSets']).toBe('highest');
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_settings_saved');
		gateway.saveSettings.mockReturnValueOnce(throwError(() => failure));
		c.save();
		expect(notifier.showError).toHaveBeenCalled();
		c.saving.set(true);
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
	});

	it('reads the defaults when nothing is saved, and counts the categories and products with their own rules', () => {
		const { c, settle } = make(ShippingOverview);
		overview({
			settings: null,
			exceptionTargets: { categories: 1, products: 0 },
			checks: [{ code: 'x', severity: 'error' }],
		});
		settle();
		expect(c.form()?.homeCountry).toBe('GB');
		c.form.update((form) =>
			form ? { ...form, abroadPolicy: 'indiaOnly', domestic: { kind: 'ruleSet', ruleSetId: null } } : form,
		);
		expect(c.notNeeded('international')).toBe(true);
		expect(c.notNeeded('domestic')).toBe(false);
		expect(c.ruleSetOf('domestic')).toBeNull();
		expect(c.describe('domestic')).toBe('');
		c.form.update((form) =>
			form
				? {
						...form,
						international: {
							kind: 'courier',
							courierId: 'dhl',
							fallbackRuleSetId: null,
							extra: { amountINR: 0, percent: 0 },
						},
					}
				: form,
		);
		expect(c.ruleSetOf('international')).toBeNull();
		c.form.update((form) => (form ? { ...form, domestic: { kind: 'ruleSet', ruleSetId: 'rs_gone' } } : form));
		expect(c.ruleSetOf('domestic')).toBeNull();
		expect(c.ownRules()).toBe('ship_check_own_rules_one(ship_count_category_one(1))');
		overview({ exceptionTargets: { categories: 2, products: 1 } });
		expect(c.ownRules()).toBe(
			'ship_check_own_rules_many(ship_count_category_many(2) ship_and ship_count_product_one(1))',
		);
		overview({ exceptionTargets: { categories: 0, products: 3 } });
		expect(c.ownRules()).toBe('ship_check_own_rules_many(ship_count_product_many(3))');
		expect(c.checkIcon({ code: 'x', severity: 'error' } as never)).toContain('text-danger');
		expect(c.checkIcon({ code: 'x', severity: 'warning' } as never)).toContain('text-warning');
		c.openTester();
		expect(modals.open).toHaveBeenCalledWith(ShippingCartTester, expect.objectContaining({ size: 'lg' }));
		expect(make(ShippingCartTester).c).toBeInstanceOf(ShippingCartTester);
	});
});

describe('Shipping › Rule sets (rl01, rb01)', () => {
	const row = (
		over: Partial<AdminShippingRuleSetRow['ruleSet']> = {},
		usage = { zones: [], exceptionIds: [] },
		name: string | null = null,
	) =>
		({
			ruleSet: {
				id: 'rs_1',
				name: 'Mine',
				description: 'd',
				use: 'domestic',
				kind: 'own',
				premadeKey: null,
				activeVersion: 1,
				revision: 3,
				updatedAt: '2026-11-19T06:00:00.000Z',
				...over,
			},
			usage,
			updatedByName: name,
		}) as unknown as AdminShippingRuleSetRow;

	it('filters and counts the rule sets', () => {
		const { c } = make(ShippingRuleSets);
		expect(c.rows()).toEqual([]);
		expect(c.count('all')).toBe(0);
		h.data.set('shipping/rule-sets', [
			row(),
			row({ id: 'rs_2', kind: 'premade', premadeKey: 'courier-quote' }),
			row({ id: 'rs_3', activeVersion: null }),
		]);
		h.bump();
		for (const [filter, ids] of [
			['own', ['rs_1', 'rs_3']],
			['premade', ['rs_2']],
			['drafts', ['rs_3']],
			['all', ['rs_1', 'rs_2', 'rs_3']],
		] as const) {
			c.filter.set(filter);
			expect(c.rows().map((r) => r.ruleSet.id)).toEqual(ids);
			expect(c.count(filter)).toBe(ids.length);
		}
		expect(c.canCreate() && c.canEdit() && c.canDelete()).toBe(true);
	});

	it('says where a rule set is used, and when and by whom it was last saved', () => {
		const { c } = make(ShippingRuleSets);
		expect(
			c.whereUsed(row({}, { zones: [{ zone: 'domestic', as: 'siteWide' }], exceptionIds: ['e1'] } as never)),
		).toBe('ship_used_siteWide(ship_zone_domestic) · ship_used_exceptions(1)');
		expect(c.whereUsed(row({ premadeKey: 'courier-quote' }))).toBe('ship_needs_courier');
		expect(c.whereUsed(row())).toBe('—');
		expect(c.inUse(row())).toBe(false);
		expect(c.inUse(row({}, { zones: [], exceptionIds: ['e1'] } as never))).toBe(true);
		expect(c.inUse(row({}, { zones: [{ zone: 'domestic', as: 'siteWide' }], exceptionIds: [] } as never))).toBe(
			true,
		);
		expect(c.edited(row({ kind: 'premade' }))).toBe('—');
		expect(c.edited(row({ updatedAt: null } as never))).toBe('—');
		expect(c.edited(row({}, undefined, '  Asha  Roy '))).toBe('19 Nov · Asha');
		expect(c.edited(row({}, undefined, '   '))).toBe('19 Nov');
		expect(c.edited(row())).toBe('19 Nov');
	});

	it('copies and deletes rule sets', async () => {
		const { c } = make(ShippingRuleSets);
		await c.copy(row({ name: 'x'.repeat(100) }));
		expect((gateway.create.mock.calls[0]?.[0] as { name: string }).name).toHaveLength(80);
		expect(router.navigate).toHaveBeenCalledWith(['/shipping/rule-sets', 'rs_new']);
		gateway.create.mockReturnValueOnce(throwError(() => failure));
		await c.copy(row());
		expect(notifier.showError).toHaveBeenCalled();
		h.confirm = false;
		await c.remove(row());
		expect(gateway.remove).not.toHaveBeenCalled();
		h.confirm = true;
		await c.remove(row());
		expect(gateway.remove).toHaveBeenCalledWith('rs_1', 3);
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_rule_set_deleted');
		gateway.remove.mockReturnValueOnce(throwError(() => failure));
		await c.remove(row());
		expect(notifier.showError).toHaveBeenCalledTimes(2);
	});

	it('starts a new rule set, blank or from a pre-made one', async () => {
		const { c } = make(NewRuleSet);
		expect(c.homeCountryName()).toBe('ship_country_IN');
		expect(c.premades()).toEqual([]);
		h.data.set('shipping/rule-sets', [row(), row({ id: 'rs_p', kind: 'premade', premadeKey: 'free-above' })]);
		overview({ settings: null });
		expect(c.homeCountryName()).toBe('ship_country_GB');
		expect(c.premades().map((r) => r.id)).toEqual(['rs_p']);
		expect(c.icon('free-above')).toBe('ri-gift-line');
		expect(c.icon('unknown')).toBe('ri-file-list-3-line');
		expect(c.icon(null)).toBe('ri-file-list-3-line');
		await c.create();
		expect(gateway.create).not.toHaveBeenCalled();
		c.name.set('  Weight  ');
		c.from.set('rs_p');
		await c.create();
		expect(gateway.create).toHaveBeenCalledWith({
			name: 'Weight',
			description: '',
			use: 'domestic',
			copyFromId: 'rs_p',
		});
		expect(router.navigate).toHaveBeenCalledWith(['/shipping/rule-sets', 'rs_new']);
		gateway.create.mockReturnValueOnce(throwError(() => failure));
		await c.create();
		expect(notifier.showError).toHaveBeenCalled();
		expect(c.busy()).toBe(false);
		c.busy.set(true);
		await c.create();
		expect(gateway.create).toHaveBeenCalledTimes(2);
	});
});

describe('Shipping › Couriers (cr01)', () => {
	it('reads and changes how each zone is priced', () => {
		const { c, settle } = make(ShippingCouriers);
		expect(c.priceWith('domestic')).toBe('');
		expect(c.fallbackId('domestic')).toBe('');
		expect(c.courierChosen('domestic')).toBe(false);
		expect(c.extra('domestic')).toEqual({ amountINR: 0, percent: 0 });
		expect(c.ruleSetsFor('domestic')).toEqual([]);
		c.setPriceWith('domestic', 'ruleSet:rs_both');
		expect(c.form()).toBeNull();
		c.save();
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		overview();
		settle();
		expect(c.ruleSetsFor('domestic').map((r) => r.id)).toEqual(['rs_dom', 'rs_both']);
		expect(c.priceWith('domestic')).toBe('ruleSet:rs_dom');
		expect(c.priceWith('international')).toBe('courier:dhl');
		expect(c.fallbackId('domestic')).toBe('rs_dom');
		expect(c.fallbackId('international')).toBe('rs_intl');
		expect(c.courierChosen('international')).toBe(true);
		expect(c.extra('international')).toEqual({ amountINR: 100, percent: 5 });
		c.setPriceWith('domestic', 'courier:dhl');
		c.setPriceWith('domestic', 'ruleSet:');
		expect(c.priceWith('domestic')).toBe('ruleSet:rs_dom');
		c.setPriceWith('domestic', 'ruleSet:rs_both');
		expect(c.priceWith('domestic')).toBe('ruleSet:rs_both');
		c.form.update((form) => (form ? { ...form, domestic: { kind: 'ruleSet', ruleSetId: null } } : form));
		expect(c.priceWith('domestic')).toBe('ruleSet:');
		expect(c.fallbackId('domestic')).toBe('');
		c.form.update((form) =>
			form ? { ...form, international: { ...form.international, fallbackRuleSetId: null } as never } : form,
		);
		expect(c.fallbackId('international')).toBe('');
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(1);
		gateway.saveSettings.mockReturnValueOnce(throwError(() => failure));
		c.save();
		expect(notifier.showError).toHaveBeenCalled();
		c.saving.set(true);
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
	});
});

describe('Shipping › Orders sent abroad (io01)', () => {
	it('chooses the path and its switches, and saves them', () => {
		const { c, settle } = make(OrdersAbroad);
		expect(c.homeCountryName()).toBe('ship_country_IN');
		expect(c.available('indiaOnly')).toBe(false);
		c.save();
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		overview();
		settle();
		expect(c.chosen()).toBe('exportOffIndianInvoice');
		expect(c.isOn('keepBilling')).toBe(true);
		expect(c.isOn('askForHomeAddress')).toBe(false);
		c.setOption('keepBilling', false);
		c.setOption('askForHomeAddress', true);
		expect(c.isOn('askForHomeAddress')).toBe(true);
		expect(c.available('indiaOnly')).toBe(true);
		expect(c.available('standardExport')).toBe(false);
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				abroadPolicy: 'exportOffIndianInvoice',
				abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: true },
			}),
		);
		gateway.saveSettings.mockReturnValueOnce(throwError(() => failure));
		c.save();
		expect(notifier.showError).toHaveBeenCalled();
		c.chosen.set(null);
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
		overview({ settings: null });
		expect(c.homeCountryName()).toBe('ship_country_GB');
		c.chosen.set('indiaOnly');
		c.saving.set(true);
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
		c.saving.set(false);
		c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(3);
		expect(c.cases).toHaveLength(4);
	});
});

describe('Shipping › Where rules apply (as01, as02)', () => {
	const exception = (over: Partial<ShippingException> = {}): ShippingException =>
		({
			id: 'ex_1',
			target: { kind: 'category', categoryId: 'cat_1', includeSubcategories: false },
			domestic: { kind: 'free' },
			international: { kind: 'ruleSet', ruleSetId: 'rs_intl' },
			note: 'Heavy',
			...over,
		}) as ShippingException;

	it('picks the site-wide rule sets and saves them', () => {
		const { c, settle } = make(WhereRulesApply);
		c.saveSiteWide();
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		expect(c.activeFor(null)).toEqual([]);
		overview({
			settings: settings({
				international: {
					kind: 'courier',
					courierId: 'dhl',
					fallbackRuleSetId: null,
					extra: { amountINR: 0, percent: 0 },
				},
			}),
		});
		settle();
		expect(c.siteWide()).toEqual({ domestic: 'rs_dom', international: '' });
		expect(c.activeFor(null).map((r) => r.id)).toEqual(['rs_dom', 'rs_intl', 'rs_both']);
		expect(c.activeFor('international').map((r) => r.id)).toEqual(['rs_intl', 'rs_both']);
		c.setSiteWide('international', 'rs_both');
		c.saveSiteWide();
		expect(gateway.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				domestic: { kind: 'ruleSet', ruleSetId: 'rs_dom' },
				international: { kind: 'ruleSet', ruleSetId: 'rs_both' },
			}),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_settings_saved');
		c.setSiteWide('domestic', '');
		gateway.saveSettings.mockReturnValueOnce(throwError(() => failure));
		c.saveSiteWide();
		expect((gateway.saveSettings.mock.calls[1]?.[0] as { domestic: unknown }).domestic).toEqual({
			kind: 'ruleSet',
			ruleSetId: null,
		});
		expect(notifier.showError).toHaveBeenCalled();
		c.saving.set(true);
		c.saveSiteWide();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
		overview({ settings: null, defaults: settings({ domestic: { kind: 'ruleSet', ruleSetId: null } }) });
		settle();
		expect(c.siteWide().domestic).toBe('');
	});

	it('names categories, products and choices, and counts what an exception reaches', () => {
		const { c, settle } = make(WhereRulesApply);
		expect(c.categoryName('cat_1')).toBe('cat_1');
		expect(c.affected(exception())).toBeNull();
		expect(c.choiceLabel({ kind: 'ruleSet', ruleSetId: 'rs_intl' })).toBe('rs_intl');
		h.data.set('shipping/category-rows', [
			{ id: 'cat_1', path: 'Sarees › Silk', name: { en: 'Silk' }, productCount: 12 },
			{ id: 'cat_2', path: null, name: { en: 'Cotton' }, productCount: 4 },
			{ id: 'cat_3', path: null, name: {}, productCount: 0 },
		]);
		h.data.set('shipping/exceptions', [
			exception(),
			exception({ id: 'ex_2', target: { kind: 'product', productId: 'p9' } }),
			exception({ id: 'ex_3', target: { kind: 'product', productId: 'p9' } }),
		]);
		overview();
		settle();
		expect(gateway.productTitle).toHaveBeenCalledTimes(1);
		expect(c.productTitles()).toEqual({ p9: 'Title p9' });
		expect(c.categoryName('cat_1')).toBe('Sarees › Silk');
		expect(c.categoryName('cat_2')).toBe('Cotton');
		expect(c.categoryName('cat_3')).toBe('cat_3');
		expect(c.categoryName('cat_x')).toBe('cat_x');
		expect(c.affected(exception())).toBe(12);
		expect(
			c.affected(exception({ target: { kind: 'category', categoryId: 'cat_x', includeSubcategories: true } })),
		).toBeNull();
		expect(c.affected(exception({ target: { kind: 'product', productId: 'p1' } }))).toBe(1);
		expect(c.choiceLabel({ kind: 'free' })).toBe('ship_choice_free');
		expect(c.choiceLabel({ kind: 'ruleSet', ruleSetId: 'rs_intl' })).toBe('Abroad');
		expect(c.choiceLabel({ kind: 'ruleSet', ruleSetId: 'rs_gone' })).toBe('rs_gone');
		expect(c.canEdit() && c.canAdd() && c.canDelete()).toBe(true);
	});

	it('adds and edits exceptions in the popup, and saves them', () => {
		const { c } = make(WhereRulesApply);
		c.patch({ note: 'x' });
		expect(c.draft()).toBeNull();
		expect(c.draftValid()).toBe(false);
		c.saveException();
		expect(gateway.saveException).not.toHaveBeenCalled();
		c.add();
		expect(modals.open).not.toHaveBeenCalled();
		expect(c.draft()).toMatchObject({ id: null, kind: 'category', domestic: 'siteWide' });
		expect(c.draftValid()).toBe(false);
		const template = {};
		Object.defineProperty(c, 'popup', { value: () => template });
		c.edit(exception());
		expect(modals.open).toHaveBeenCalledWith(template, expect.objectContaining({ size: 'lg' }));
		expect(c.draft()).toMatchObject({
			categoryId: 'cat_1',
			includeSubcategories: false,
			domestic: 'free',
			international: 'rs:rs_intl',
		});
		c.setZoneChoice('domestic', 'cantShip');
		c.setZoneChoice('international', 'rs:rs_both');
		c.patch({ note: '  Fragile  ' });
		c.saveException();
		expect(gateway.saveException).toHaveBeenCalledWith('ex_1', {
			target: { kind: 'category', categoryId: 'cat_1', includeSubcategories: false },
			domestic: { kind: 'cantShip' },
			international: { kind: 'ruleSet', ruleSetId: 'rs_both' },
			note: 'Fragile',
		});
		expect(popup.close).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_exception_saved');
		c.productTitles.set({ p9: 'Silk saree' });
		c.edit(exception({ id: 'ex_2', target: { kind: 'product', productId: 'p9' } }));
		expect(c.draft()).toMatchObject({
			kind: 'product',
			categoryId: '',
			includeSubcategories: true,
			product: { id: 'p9', title: 'Silk saree' },
		});
		c.edit(exception({ id: 'ex_3', target: { kind: 'product', productId: 'p8' } }));
		expect(c.draft()?.product).toEqual({ id: 'p8', title: 'p8' });
		expect(c.draftValid()).toBe(true);
		gateway.saveException.mockReturnValueOnce(throwError(() => failure));
		c.saveException();
		expect(gateway.saveException).toHaveBeenLastCalledWith(
			'ex_3',
			expect.objectContaining({ target: { kind: 'product', productId: 'p8' } }),
		);
		expect(notifier.showError).toHaveBeenCalled();
		c.saving.set(true);
		c.saveException();
		expect(gateway.saveException).toHaveBeenCalledTimes(2);
		c.saving.set(false);
		c.patch({ product: null });
		expect(c.draftValid()).toBe(false);
	});

	it('searches products for a product exception, and deletes exceptions once confirmed', async () => {
		const { c } = make(WhereRulesApply);
		c.add();
		c.searchProducts(' s ');
		expect(gateway.searchProducts).not.toHaveBeenCalled();
		c.searchProducts(' silk ');
		expect(c.productResults()).toHaveLength(1);
		c.pickProduct({ id: 'p1', title: 'Silk' } as never);
		expect(c.draft()?.product).toEqual({ id: 'p1', title: 'Silk' });
		expect(c.productTitles()['p1']).toBe('Silk');
		expect(c.productResults()).toEqual([]);
		h.confirm = false;
		await c.remove(exception());
		expect(gateway.removeException).not.toHaveBeenCalled();
		h.confirm = true;
		await c.remove(exception());
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_exception_deleted');
		gateway.removeException.mockReturnValueOnce(throwError(() => failure));
		await c.remove(exception());
		expect(notifier.showError).toHaveBeenCalled();
	});
});

describe('Shipping routes and their queries', () => {
	it('loads every page, and each query asks the gateway', async () => {
		const pages = await Promise.all(
			ROUTES.filter((route) => route.loadComponent).map((route) =>
				(route.loadComponent as () => Promise<unknown>)(),
			),
		);
		expect(pages).toHaveLength(7);
		make(WhereRulesApply);
		make(NewRuleSet);
		for (const run of h.fns) await run();
		expect(gateway.overview).toHaveBeenCalled();
		expect(gateway.ruleSets).toHaveBeenCalled();
		expect(gateway.exceptions).toHaveBeenCalled();
	});
});
