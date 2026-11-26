import { PLATFORM_ID, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';

import { BundleRuleRows } from './bundle-rule-rows';
import { PriceMethodBuilder } from './price-method-builder';

import type { BundlePriceRule } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ list: undefined as unknown, queryFn: null as null | (() => unknown) }));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	return {
		...actual,
		injectQuery: (options: () => { queryFn: () => unknown }) => {
			h.queryFn = () => options().queryFn();
			return { data: () => h.list };
		},
	};
});

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const bundles = {
	list: vi.fn((_request: unknown) => of({ items: [], total: 0 })),
	method: vi.fn(() =>
		of({
			id: 'bpm_1',
			seeded: false,
			version: 2,
			usedBy: 3,
			createdAt: 'x',
			updatedAt: 'y',
			name: { en: 'Set price' },
			help: { en: '' },
			base: { kind: 'pieces' },
			inputs: [{ code: 'percent', label: { en: '%' }, kind: 'percent', min: 0, max: 50, default: 10 }],
			rules: [],
			combine: 'all',
		}),
	),
	createMethod: vi.fn((_body: unknown) => of({})),
	updateMethod: vi.fn((_id: string, _body: unknown) => of({})),
	methods: vi.fn(() => of([{ id: 'bpm_1' }])),
	deleteMethod: vi.fn(() => of({})),
};
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
const router = { navigate: vi.fn() };

function make<T>(type: Type<T>, options: { platform?: string; id?: string } = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: BundleService, useValue: bundles },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => '', langChanges$: of('en') },
			},
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(options.id ? { id: options.id } : {}) } },
			},
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture };
}

afterEach(() => {
	vi.clearAllMocks();
	h.list = undefined;
});

const rule = (id: string): BundlePriceRule => ({
	id,
	name: null,
	enabled: true,
	when: {
		match: 'all',
		conditions: [
			{ fact: 'pieces.count', level: null, op: 'atLeast', value: 2 },
			{ fact: 'pieces.count', level: null, op: 'atMost', value: 6 },
		],
	},
	then: [
		{ kind: 'percentOff', amount: 10, level: null, items: [] },
		{ kind: 'amountOff', amount: 100, level: null, items: [] },
	],
	otherwise: [],
});

describe('bundle parts: the last cases', () => {
	it('changing one rule, condition or action leaves the others as they were', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(BundleRuleRows, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BundleRuleRows);
		const seen: BundlePriceRule[][] = [];
		fixture.componentInstance.rulesChange.subscribe((rules) => {
			seen.push(rules);
			fixture.componentRef.setInput('rules', rules);
		});
		const first = rule('r1');
		fixture.componentRef.setInput('rules', [first, rule('r2')]);
		const rows = fixture.componentInstance;
		rows.setCondition(1, 1, { value: 8 });
		rows.setAction(1, 1, { amount: 200 });
		const last = seen.at(-1) as BundlePriceRule[];
		expect(last[0]).toBe(first);
		expect(last[1]?.when.conditions[0]).toEqual(first.when.conditions[0]);
		expect(last[1]?.when.conditions[1]?.value).toBe(8);
		expect(last[1]?.then[0]).toEqual(first.then[0]);
		expect(last[1]?.then[1]?.amount).toBe(200);
	});

	it('tries a method whose number has no starting value', () => {
		const { c } = make(PriceMethodBuilder);
		c.addInput();
		c.setInput(0, { default: null });
		expect(c.method().inputs[0]?.default).toBeNull();
		expect(c.tried()).toBeTruthy();
	});
});
