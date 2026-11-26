import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPhone } from '@features/media/file-manager/fm-phone';

import { RuleBuilder } from './rule-builder';

import type {
	AdminShippingRuleSetDetail,
	ShippingRuleSet,
	ShippingRuleSetBody,
	ShippingTestCart,
} from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ confirm: true }));
vi.mock('@features/purchasing/shared/popups', () => ({ askConfirm: vi.fn(async () => h.confirm) }));

/** The same harness as rule-builder.spec.ts, with the overview, category rows and words that carry their values. */
const DOMESTIC: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'eachLine',
			combine: 'sum',
			node: { kind: 'result', id: 'r-1', result: { kind: 'productCharge', charge: 'domestic', per: 'unit' } },
		},
	],
	adjust: [],
};

const ruleSet = (over: Partial<ShippingRuleSet> = {}): ShippingRuleSet => ({
	id: 'rs_1',
	name: 'Domestic',
	description: '',
	use: 'domestic',
	kind: 'own',
	premadeKey: null,
	copiedFromId: null,
	activeVersion: null,
	draft: { steps: [], adjust: [] },
	hasDraftChanges: true,
	testCarts: [],
	revision: 0,
	updatedBy: null,
	...over,
});
const detail = (
	over: Partial<ShippingRuleSet> = {},
	extra: Partial<AdminShippingRuleSetDetail> = {},
): AdminShippingRuleSetDetail => ({
	ruleSet: ruleSet(over),
	usage: { zones: [], exceptionIds: [] },
	versions: [],
	issues: [],
	canActivate: false,
	...extra,
});

const cart = (id: string, expectedINR: number | null): ShippingTestCart => ({
	id,
	name: `Cart ${id}`,
	lines: [{ productId: 'p1', variationId: null, quantity: 1 }],
	delivery: { country: 'IN', state: null, pincode: null },
	shopper: { signedIn: true, groups: [], firstOrder: false },
	expectedINR,
});

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const priced = (amountINR: number | null, status = 'priced') => ({
	status,
	zone: 'domestic',
	amountINR,
	lines: [],
	trace: [],
	adjustments: [],
	cantShip: [],
	noResult: [],
	moreLines: 0,
});

interface Options {
	permissions?: string[];
	overview?: unknown;
	rows?: unknown[];
	id?: string | null;
}

async function setup(start = detail(), options: Options = {}) {
	const gateway = {
		ruleSet: vi.fn(() => of(start)),
		overview: vi.fn(() =>
			options.overview === undefined ? throwError(() => new Error('none')) : of(options.overview),
		),
		save: vi.fn((_id: string, body: { draft: ShippingRuleSetBody; revision: number }) =>
			of(detail({ draft: body.draft, revision: body.revision + 1, activeVersion: 2 })),
		),
		activate: vi.fn(),
		tryIt: vi.fn((_body: { lines: Array<{ productId: string }> }) => of(priced(200))),
		create: vi.fn(() => of(detail({ id: 'rs_copy', kind: 'own' }))),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn() };
	const popup = { close: vi.fn() };
	const modal = { open: vi.fn(() => popup) };
	const params = options.id === null ? {} : { id: options.id ?? 'rs_1' };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ShippingGateway, useValue: gateway },
			{ provide: CategoryService, useValue: { getCategoryRows: () => of(options.rows ?? []) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: t } },
			{
				provide: AuthStore,
				useValue: {
					permissions: () => options.permissions ?? ['shipping.index', 'shipping.create', 'shipping.edit'],
				},
			},
			{ provide: ActiveLanguages, useValue: { shopLocales: signal(['en', 'bn']), list: () => ['en', 'bn'] } },
			{ provide: NgbModal, useValue: modal },
			{ provide: Router, useValue: router },
			{ provide: FmPhone, useValue: { is: () => false } },
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap(params)),
					snapshot: { paramMap: convertToParamMap(params) },
				},
			},
		],
	});
	TestBed.overrideComponent(RuleBuilder, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(RuleBuilder);
	fixture.detectChanges();
	const page = fixture.componentInstance;
	for (let i = 0; i < 40 && (!page.detail() || (options.rows && !page.categories().length)); i += 1) {
		await new Promise((done) => setTimeout(done, 5));
		fixture.detectChanges();
	}
	const wait = async (ms: number) => {
		await new Promise((done) => setTimeout(done, ms));
		fixture.detectChanges();
	};
	return { page, gateway, notifier, router, modal, popup, fixture, wait };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	name: { en: id.toUpperCase() },
	path: null,
	parentId: null,
	shipping: null,
	...over,
});

afterEach(() => {
	h.confirm = true;
});

describe('the rule builder: charges, words and checks (rb02, rb03, rb10)', () => {
	it('names categories and gathers each product charge into one amount or a range', async () => {
		const overview = {
			settings: null,
			defaults: {
				homeCountry: 'IN',
				defaultCharges: { domestic: 100, internationalFirst: 1500, internationalFurther: 500 },
			},
		};
		const rows = [
			row('sarees', { path: 'Sarees', shipping: { domesticINR: 150, internationalFirstINR: null } }),
			row('silk', { parentId: 'sarees' }),
			row('loop-a', { parentId: 'loop-b' }),
			row('loop-b', { parentId: 'loop-a' }),
			row('orphan', { parentId: 'gone', name: {} }),
		];
		const { page } = await setup(detail({ draft: DOMESTIC }), { overview, rows });
		await new Promise((done) => setTimeout(done, 20));
		expect(page.categories().map((c) => c.label)).toEqual(['Sarees', 'SILK', 'LOOP-A', 'LOOP-B', 'orphan']);
		expect(page.chargeAmounts()).toEqual({
			domestic: { amount: '₹100–₹150', every: false },
			internationalFirst: { amount: '₹1,500', every: true },
			internationalFurther: { amount: '₹500', every: true },
		});
		expect(page.chargeHints()).toEqual({
			domestic: 'ship_hint_by_category(₹100–₹150)',
			internationalFirst: 'ship_hint_every_category(₹1,500)',
			internationalFurther: 'ship_hint_every_category(₹500)',
		});
		expect(page.homeCountryName()).toBe('ship_country_IN');
		expect(page.words().join(' ')).toContain('ship_pw');
	});

	it('leaves the hints out without rows or shop charges, and reads the home country', async () => {
		const none = await setup(detail());
		expect(none.page.chargeAmounts()).toEqual({});
		expect(none.page.homeCountryName()).toBe('ship_country_IN');
		const withSettings = await setup(detail(), {
			overview: { settings: { homeCountry: 'GB', defaultCharges: null }, defaults: null },
			rows: [row('a')],
		});
		await withSettings.wait(20);
		expect(withSettings.page.chargeAmounts()).toEqual({});
		expect(withSettings.page.homeCountryName()).toBe('ship_country_GB');
	});

	it('says where the rule set is used', async () => {
		expect(
			(
				await setup(detail({}, { usage: { zones: [{ as: 'siteWide' }], exceptionIds: [] } as never }))
			).page.usageWords(),
		).toBe('ship_status_used_site_wide');
		expect(
			(
				await setup(
					detail({}, { usage: { zones: [{ as: 'exception' }], exceptionIds: ['e1', 'e2'] } as never }),
				)
			).page.usageWords(),
		).toBe('ship_status_used_exceptions(2)');
		expect((await setup(detail())).page.usageWords()).toBe('ship_status_not_used');
	});

	it('reads weight per step, the other combine choices and whether any block gives a result', async () => {
		const { page } = await setup(detail({ draft: DOMESTIC }));
		const step = DOMESTIC.steps[0] as ShippingRuleSetBody['steps'][number];
		expect(page.stepReadsWeight(step)).toBe(false);
		expect(page.otherCombines(step)).toBe(
			'ship_other_choices(ship_combine_highest_eachline, ship_combine_lowest_eachline)',
		);
		expect(page.hasResult()).toBe(true);
		page.edit({ steps: [], adjust: [] });
		expect(page.hasResult()).toBe(false);
		expect(page.rupees(null)).toBe('—');
		expect(page.rupees(1200)).toBe('₹1,200');
	});

	it('words each issue with its field, language and step', async () => {
		const { page } = await setup(detail({ draft: DOMESTIC }));
		expect(
			page.issueText({
				code: 'x',
				severity: 'error',
				blockId: 'b',
				stepId: 'step-1',
				params: { field: 'cart.subtotal', language: 'bn', count: 2 },
			} as never),
		).toBe('ship_issue_in_step(1)ship_issue_x(ship_f_cart_subtotal|বাংলা|2)');
		expect(page.issueText({ code: 'y', severity: 'warning', blockId: 'b', stepId: null } as never)).toBe(
			'ship_issue_y',
		);
	});
});

describe('the rule builder: editing (rb02, rb05)', () => {
	it('keeps unsaved edits when the rule set is fetched again', async () => {
		const { page, fixture } = await setup(detail({ draft: DOMESTIC }));
		page.touch();
		page.name.set('Changed');
		const query = TestBed.inject(QueryClient);
		query.setQueryData(['shipping', 'rule-set', 'rs_1'], detail({ revision: 9 }));
		fixture.detectChanges();
		expect(page.name()).toBe('Changed');
	});

	it('steps back and forward only when there is something to undo or redo', async () => {
		const { page } = await setup(detail({ draft: DOMESTIC }));
		page.undo();
		page.redo();
		expect(page.dirty()).toBe(false);
		expect(page.canUndo()).toBe(false);
		page.setStep(0, { combine: 'highest' });
		expect(page.body().steps[0]?.combine).toBe('highest');
		expect(page.canUndo()).toBe(true);
		page.duplicate(5);
		expect(page.body().steps).toHaveLength(1);
		page.drop({ previousIndex: 0, currentIndex: 0 } as never);
		expect(page.body().steps).toHaveLength(1);
	});

	it('sets and reads every adjustment’s value', async () => {
		const { page } = await setup(detail());
		for (const kind of page.adjustKinds) page.addAdjust(kind);
		page.setAdjustValue(0, '50');
		page.setAdjustValue(1, 'abc');
		page.setAdjustValue(2, '');
		page.setAdjustValue(3, null);
		page.setAdjustValue(3, '2000');
		expect(page.body().adjust.map((a) => page.adjustValue(a))).toEqual([50, null, null, 2000]);
		page.removeAdjust(1);
		expect(page.body().adjust.map((a) => a.kind)).toEqual(['minimum', 'roundUp', 'freeAbove']);
	});

	it('adds and removes test carts, and prices them again as the blocks change (rb08)', async () => {
		const { page, gateway, notifier, wait } = await setup(detail({ draft: DOMESTIC }));
		await wait(600);
		expect(page.testCartNow()).toEqual({});
		gateway.tryIt.mockImplementation((body) =>
			body.lines[0]?.productId === 'p_err'
				? throwError(() => new Error('down'))
				: body.lines[0]?.productId === 'p_quote'
					? of(priced(null, 'needsQuote'))
					: of(priced(200)),
		);
		page.addTestCart(cart('a', 200));
		page.addTestCart(cart('b', 150));
		page.addTestCart({ ...cart('c', null), lines: [{ productId: 'p_err', variationId: null, quantity: 1 }] });
		page.addTestCart({ ...cart('d', 90), lines: [{ productId: 'p_quote', variationId: null, quantity: 1 }] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_test_cart_added');
		await wait(650);
		expect(page.testCartNow()).toEqual({ a: 200, b: 200, c: null, d: null });
		expect(page.changedCarts().map((c) => c.id)).toEqual(['b', 'd']);
		expect(page.changesAllPriced()).toBe(false);
		page.acceptNewAmounts();
		expect(page.accepted()).toEqual([
			{ testCartId: 'b', name: 'Cart b', fromINR: 150, toINR: 200, status: 'priced' },
			{ testCartId: 'd', name: 'Cart d', fromINR: 90, toINR: null, status: 'priced' },
		]);
		page.removeTestCart('d');
		expect(page.testCarts().map((c) => c.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('the rule builder: saving and making active (rb11)', () => {
	it('saves quietly, names an active version, and shows a refusal', async () => {
		const { page, gateway, notifier } = await setup(detail({ draft: DOMESTIC }));
		page.busy.set(true);
		expect(await page.save()).toBe(false);
		page.busy.set(false);
		expect(await page.save(true)).toBe(true);
		expect(notifier.showSuccess).not.toHaveBeenCalled();
		expect(await page.save()).toBe(true);
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_draft_saved');
		gateway.save.mockReturnValueOnce(throwError(() => ({ status: 500 })));
		expect(await page.save()).toBe(false);
		expect(notifier.showError).toHaveBeenCalled();
	});

	it('makes a version active only when the blocks allow it, after saving', async () => {
		const { page, gateway, notifier, modal, popup } = await setup(detail({ draft: DOMESTIC }));
		await setup(detail()).then(async ({ page: empty, gateway: emptyGateway }) => {
			await empty.activate();
			expect(emptyGateway.activate).not.toHaveBeenCalled();
		});
		page.touch();
		gateway.save.mockReturnValueOnce(throwError(() => ({ status: 409 })));
		await page.activate();
		expect(gateway.activate).not.toHaveBeenCalled();
		const template = {};
		Object.defineProperty(page, 'changesPopup', { value: () => template });
		gateway.activate.mockReturnValueOnce(
			of({
				outcome: 'testCartsChanged',
				changes: [{ testCartId: 'a', name: 'A', fromINR: 1, toINR: null, status: 'cantShip' }],
			}),
		);
		await page.activate();
		expect(modal.open).toHaveBeenCalledWith(template, expect.objectContaining({ size: 'lg' }));
		expect(page.changesAcceptable()).toBe(false);
		gateway.activate.mockReturnValueOnce(of({ outcome: 'blocked' }));
		await page.activate();
		expect(notifier.showError).toHaveBeenCalledWith('ship_fix_first');
		gateway.activate.mockReturnValueOnce(
			of({
				outcome: 'activated',
				version: 3,
				detail: detail({ draft: DOMESTIC, activeVersion: 3, revision: 4 }),
			}),
		);
		await page.activate([
			{ testCartId: 'a', name: 'A', fromINR: 1, toINR: null, status: 'priced' },
			{ testCartId: 'b', name: 'B', fromINR: 1, toINR: 5, status: 'priced' },
		]);
		expect(gateway.activate).toHaveBeenLastCalledWith('rs_1', {
			revision: expect.any(Number),
			acceptChanges: [{ testCartId: 'b', toINR: 5 }],
		});
		expect(popup.close).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_activated(3)');
		gateway.activate.mockReturnValueOnce(throwError(() => ({ status: 500 })));
		await page.activate();
		expect(page.busy()).toBe(false);
	});

	it('lists the changes without a popup when none is drawn', async () => {
		const { page, gateway, modal } = await setup(detail({ draft: DOMESTIC }));
		gateway.activate.mockReturnValueOnce(of({ outcome: 'testCartsChanged', changes: [] }));
		await page.activate();
		expect(modal.open).not.toHaveBeenCalled();
		expect(page.changesAcceptable()).toBe(true);
	});

	it('confirms before making active, naming how the test carts stand', async () => {
		const { askConfirm } = await import('@features/purchasing/shared/popups');
		const confirm = vi.mocked(askConfirm);
		const empty = await setup(detail());
		await empty.page.confirmActivate();
		expect(confirm).not.toHaveBeenCalled();
		const { page, gateway, wait } = await setup(
			detail({ draft: DOMESTIC }, { versions: [{ version: 2 }, { version: 4 }] as never }),
		);
		gateway.activate.mockReturnValue(
			of({ outcome: 'activated', version: 5, detail: detail({ draft: DOMESTIC, activeVersion: 5 }) }),
		);
		h.confirm = false;
		await page.confirmActivate();
		expect(confirm).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ params: { version: 5 }, items: ['ship_no_carts_to_check(0)'] }),
		);
		expect(gateway.activate).not.toHaveBeenCalled();
		page.addTestCart(cart('a', 200));
		await wait(650);
		h.confirm = true;
		await page.confirmActivate();
		expect(confirm).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ items: ['ship_all_carts_match(1)'] }),
		);
		expect(gateway.activate).toHaveBeenCalledTimes(1);
		page.addTestCart(cart('b', 1));
		await wait(650);
		await page.confirmActivate();
		// Not accepted yet: the server is asked, and lists the changes.
		expect(gateway.activate).toHaveBeenCalledTimes(2);
		page.acceptNewAmounts();
		await page.confirmActivate();
		expect(confirm).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ items: ['ship_carts_accepted(1)'] }),
		);
	});

	it('shows the versions, and copies a rule set or shows why it could not', async () => {
		const { page, gateway, modal, notifier } = await setup(detail({ draft: DOMESTIC }));
		page.showVersions();
		expect(modal.open).not.toHaveBeenCalled();
		const template = {};
		Object.defineProperty(page, 'versionsPopup', { value: () => template });
		page.showVersions();
		expect(modal.open).toHaveBeenCalledWith(template, expect.objectContaining({ centered: true }));
		gateway.create.mockReturnValueOnce(throwError(() => ({ status: 500 })));
		await page.makeCopy();
		expect(notifier.showError).toHaveBeenCalled();
	});

	it('copies nothing before the rule set has loaded, and reads a missing id as empty', async () => {
		const { page, gateway } = await setup(detail(), { id: null });
		expect(page.id()).toBe('');
		Object.defineProperty(page, 'detail', { value: () => null });
		await page.makeCopy();
		expect(gateway.create).not.toHaveBeenCalled();
	});
});
