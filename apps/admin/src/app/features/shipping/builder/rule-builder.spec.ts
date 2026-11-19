import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPhone } from '@features/media/file-manager/fm-phone';

import { RuleBuilder } from './rule-builder';

import type { AdminShippingRuleSetDetail, ShippingRuleSet, ShippingRuleSetBody } from '@saha-textile/contracts';

const DOMESTIC: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'eachLine',
			combine: 'sum',
			node: {
				kind: 'if',
				id: 'if-1',
				when: {
					kind: 'group',
					id: 'g-1',
					join: 'all',
					items: [{ kind: 'condition', id: 'c-1', field: 'line.discounted', op: 'is', value: true }],
				},
				then: { kind: 'result', id: 'r-1', result: { kind: 'productCharge', charge: 'domestic', per: 'unit' } },
				otherwise: { kind: 'result', id: 'r-2', result: { kind: 'free' } },
			},
		},
	],
	adjust: [],
};

const ruleSet = (over: Partial<ShippingRuleSet> = {}): ShippingRuleSet => ({
	id: 'rs_1',
	name: 'Saha Textile — Domestic',
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
const detail = (over: Partial<ShippingRuleSet> = {}): AdminShippingRuleSetDetail => ({
	ruleSet: ruleSet(over),
	usage: { zones: [], exceptionIds: [] },
	versions: [],
	issues: [],
	canActivate: false,
});

async function setup(start = detail(), options: { permissions?: string[]; phone?: boolean } = {}) {
	const gateway = {
		ruleSet: vi.fn(() => of(start)),
		save: vi.fn((_id: string, body: { draft: ShippingRuleSetBody; revision: number }) =>
			of(detail({ draft: body.draft, revision: body.revision + 1 })),
		),
		activate: vi.fn(),
		tryIt: vi.fn(() =>
			of({
				status: 'priced',
				zone: 'domestic',
				amountINR: 200,
				lines: [],
				trace: [],
				adjustments: [],
				cantShip: [],
				noResult: [],
				moreLines: 0,
			}),
		),
		create: vi.fn(() => of(detail({ id: 'rs_copy', kind: 'own' }))),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn() };
	const modal = { open: vi.fn(() => ({ close: vi.fn() })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: ShippingGateway, useValue: gateway },
			{ provide: CategoryService, useValue: { getCategoryRows: () => of([]) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{
				provide: AuthStore,
				useValue: {
					permissions: () => options.permissions ?? ['shipping.index', 'shipping.create', 'shipping.edit'],
				},
			},
			{ provide: ActiveLanguages, useValue: { shopLocales: signal(['en', 'bn']), list: () => ['en', 'bn'] } },
			{ provide: NgbModal, useValue: modal },
			{ provide: Router, useValue: router },
			{ provide: FmPhone, useValue: { is: () => options.phone ?? false } },
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap({ id: 'rs_1' })),
					snapshot: { paramMap: convertToParamMap({ id: 'rs_1' }) },
				},
			},
		],
	});
	TestBed.overrideComponent(RuleBuilder, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(RuleBuilder);
	fixture.detectChanges();
	const page = fixture.componentInstance;
	for (let i = 0; i < 40 && !page.detail(); i += 1) {
		await new Promise((done) => setTimeout(done, 5));
		fixture.detectChanges();
	}
	return { page, gateway, notifier, router, modal, fixture };
}

describe('RuleBuilder', () => {
	it('loads the saved rule set and checks it as it is edited', async () => {
		const { page } = await setup();
		expect(page.name()).toBe('Saha Textile — Domestic');
		expect(page.check().canActivate).toBe(false);
		expect(page.errors().map((issue) => issue.code)).toEqual(['no_steps']);
		page.addStep('eachLine');
		expect(page.errors().map((issue) => issue.code)).toEqual(['step_empty']);
		page.edit(DOMESTIC);
		expect(page.check().canActivate).toBe(true);
		// The decision, its "Otherwise" line, then the combine and "No adjustment" on one line (brief rb02).
		expect(page.words()).toEqual([
			'Ship_pw_scope_eachLine ship_pw_if_then.',
			'Ship_pw_otherwise.',
			'ship_pw_combine_sum_eachLine ship_pw_no_adjust',
		]);
		expect(page.dirty()).toBe(true);
	});

	it('undoes and redoes every change of the blocks, and moves, copies and deletes steps', async () => {
		const { page } = await setup(detail({ draft: DOMESTIC }));
		page.addStep('wholeCart');
		page.duplicate(0);
		expect(page.body().steps.map((step) => step.scope)).toEqual(['eachLine', 'eachLine', 'wholeCart']);
		expect(page.body().steps[1]?.id).not.toBe('step-1');
		expect(page.stepNumber(2)).toBe(5);
		expect(page.adjustNumber()).toBe(6);
		page.drop({ previousIndex: 2, currentIndex: 0 } as never);
		expect(page.body().steps.map((step) => step.scope)).toEqual(['wholeCart', 'eachLine', 'eachLine']);
		page.removeStep(0);
		page.undo();
		page.undo();
		expect(page.body().steps.map((step) => step.scope)).toEqual(['eachLine', 'eachLine', 'wholeCart']);
		page.redo();
		expect(page.body().steps[0]?.scope).toBe('wholeCart');
		expect(page.canRedo()).toBe(true);
		page.addAdjust('roundUp');
		expect(page.canRedo()).toBe(false);
		page.setAdjustValue(0, '10');
		expect(page.body().adjust[0]).toMatchObject({ kind: 'roundUp', to: 10 });
	});

	it('saves the working copy with the revision it opened', async () => {
		const { page, gateway, notifier } = await setup();
		page.edit(DOMESTIC);
		expect(await page.save()).toBe(true);
		expect(gateway.save).toHaveBeenCalledWith(
			'rs_1',
			expect.objectContaining({ draft: DOMESTIC, revision: 0, name: 'Saha Textile — Domestic' }),
		);
		expect(page.revision()).toBe(1);
		expect(page.dirty()).toBe(false);
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_draft_saved_inactive');
	});

	it('asks for changed test carts to be accepted, then activates with them', async () => {
		const { page, gateway, notifier } = await setup(detail({ draft: DOMESTIC }));
		const change = {
			testCartId: 'cart-1',
			name: 'Two discounted',
			fromINR: null,
			toINR: 200,
			status: 'priced' as const,
		};
		gateway.activate.mockReturnValueOnce(of({ outcome: 'testCartsChanged', changes: [change] }));
		await page.activate();
		expect(page.changes()).toEqual([change]);
		expect(page.changesAcceptable()).toBe(true);
		gateway.activate.mockReturnValueOnce(
			of({
				outcome: 'activated',
				version: 1,
				detail: detail({ draft: DOMESTIC, activeVersion: 1, revision: 1 }),
			}),
		);
		await page.activate(page.changes());
		expect(gateway.activate).toHaveBeenLastCalledWith('rs_1', {
			revision: 0,
			acceptChanges: [{ testCartId: 'cart-1', toINR: 200 }],
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('ship_activated');
	});

	it('opens pre-made rule sets read only, with Make a copy', async () => {
		const { page, gateway, router } = await setup(
			detail({ kind: 'premade', premadeKey: 'highest-only', draft: DOMESTIC, activeVersion: 1 }),
		);
		expect(page.readOnly()).toBe(true);
		expect(await page.save()).toBe(false);
		await page.makeCopy();
		expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ copyFromId: 'rs_1' }));
		expect(router.navigate).toHaveBeenCalledWith(['/shipping/rule-sets', 'rs_copy']);
	});

	it('is read only on a phone and without the edit permission', async () => {
		expect((await setup(detail(), { phone: true })).page.readOnly()).toBe(true);
		expect((await setup(detail(), { permissions: ['shipping.index'] })).page.readOnly()).toBe(true);
	});
});
