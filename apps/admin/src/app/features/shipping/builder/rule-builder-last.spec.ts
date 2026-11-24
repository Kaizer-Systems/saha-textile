import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { UnsavedChanges } from '@core/unsaved/unsaved-changes';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPhone } from '@features/media/file-manager/fm-phone';

import { RuleBuilder } from './rule-builder';

import type { AdminShippingRuleSetDetail, ShippingRuleSet, ShippingRuleSetBody } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ confirm: true }));
vi.mock('@features/purchasing/shared/popups', () => ({ askConfirm: vi.fn(async () => h.confirm) }));

/** The same harness as rule-builder.spec.ts, with the overview, category rows and words that carry their values. */
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
	rows?: unknown[] | 'never';
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
			{
				provide: CategoryService,
				useValue: { getCategoryRows: () => (options.rows === 'never' ? NEVER : of(options.rows ?? [])) },
			},
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
	for (let i = 0; i < 40 && (!page.detail() || (Array.isArray(options.rows) && !page.categories().length)); i += 1) {
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

const step = (id: string, node: unknown = null) => ({ id, scope: 'eachLine', combine: 'sum', node }) as never;

describe('rule builder: the last cases', () => {
	it('reads its permissions, languages, warnings and blocks in error, and tells the leave check it is dirty', async () => {
		const { page } = await setup();
		expect(page.canCreate()).toBe(true);
		expect(page.allLanguages()).toEqual(['en', 'bn']);
		expect(Array.isArray(page.warnings())).toBe(true);
		expect(page.errorIds()).toBeInstanceOf(Set);
		const unsaved = TestBed.inject(UnsavedChanges);
		expect(unsaved.hasUnsaved()).toBe(false);
		page.touch();
		expect(unsaved.hasUnsaved()).toBe(true);
	});

	it('names a category it knows and keeps the id of one it does not', async () => {
		const draft = {
			steps: [
				step('step-1', {
					kind: 'if',
					id: 'if-1',
					when: {
						kind: 'group',
						id: 'g-1',
						join: 'all',
						items: [
							{
								kind: 'condition',
								id: 'c-1',
								field: 'line.category',
								op: 'isOneOf',
								value: ['cat_a', 'cat_gone'],
							},
						],
					},
					then: { kind: 'result', id: 'r-1', result: { kind: 'free' } },
					otherwise: null,
				}),
			],
			adjust: [],
		} as unknown as ShippingRuleSetBody;
		const { page } = await setup(detail({ draft }), { rows: [row('cat_a')] });
		const words = JSON.stringify(page.words());
		expect(words).toContain('CAT_A');
		expect(words).toContain('cat_gone');
	});

	it('has no categories or charge amounts before the category list arrives', async () => {
		const { page } = await setup(detail(), { rows: 'never' });
		expect(page.categories()).toEqual([]);
		expect(page.chargeAmounts()).toEqual({});
	});

	it('changing one loop keeps the others as they were', async () => {
		const draft = { steps: [step('step-1'), step('step-2')], adjust: [] } as unknown as ShippingRuleSetBody;
		const { page } = await setup(detail({ draft }));
		const first = page.body().steps[0];
		page.setStep(1, { scope: 'wholeCart' });
		expect(page.body().steps[0]).toBe(first);
		expect(page.body().steps[1]?.scope).toBe('wholeCart');
	});
});
