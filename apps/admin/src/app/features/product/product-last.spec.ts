import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';

import { BundleList } from './bundles/bundle-list';
import { ruleSentence } from './bundles/rule-words';
import { CreateProduct } from './create-product/create-product';
import { EditProduct } from './edit-product/edit-product';
import { HsnPopup } from './form-product/hsn-popup';
import { categoryRefill, metresToTenths, stockFigures } from './form-product/inventory-fields';
import { productLeaveGuard } from './product-leave.guard';
import ROUTES from './product.routes';

import type { BundlePriceRule } from '@saha-textile/contracts';

const t = (key: string) => key;

afterEach(() => vi.useRealTimers());

describe('product screens: the last small cases', () => {
	it('lets a page leave when it holds no form, and asks the form when it does', () => {
		const guard = productLeaveGuard as unknown as (page: unknown) => boolean;
		expect(guard({ form: () => undefined })).toBe(true);
		expect(guard({ form: () => ({ confirmLeave: () => false }) })).toBe(false);
	});

	it('loads each bundle screen when its address opens', async () => {
		const lazy = ROUTES.filter((route) => route.loadComponent);
		const loaded = await Promise.all(lazy.map((route) => (route.loadComponent as () => Promise<unknown>)()));
		expect(loaded.map((component) => (component as { name: string }).name)).toEqual([
			'BundleList',
			'BundleBuilder',
			'PriceMethodList',
			'PriceMethodBuilder',
		]);
	});

	it('the Add and Edit pages hold no form until it is drawn', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(CreateProduct, { set: { imports: [], template: '' } });
		TestBed.overrideComponent(EditProduct, { set: { imports: [], template: '' } });
		expect(TestBed.createComponent(CreateProduct).componentInstance.form()).toBeUndefined();
		expect(TestBed.createComponent(EditProduct).componentInstance.form()).toBeUndefined();
	});

	it('words every kind of bundle rule', () => {
		const rule = {
			when: {
				match: 'any',
				conditions: [
					{ fact: 'set.pieces', op: 'atLeast', value: 3 },
					{ fact: null, op: null, value: ['silk', 'cotton'] },
					{ fact: 'set.total', op: 'atMost', value: null },
				],
			},
			then: [
				{ kind: 'percentOff', amount: 10 },
				{ kind: 'priceIs', amount: 4500 },
				{ kind: 'makePickFree', amount: 1 },
				{ kind: 'amountOff', amount: { input: 'off' } },
				{ kind: 'amountOff', amount: { input: 'english_only' } },
				{ kind: 'amountOff', amount: { input: 'no_label' } },
				{ kind: 'amountOff', amount: { input: 'gone' } },
				{ kind: 'makeExtraFree', amount: null },
			],
		} as unknown as BundlePriceRule;
		const numbers = [
			{ code: 'off', label: { en: 'Off', bn: 'ছাড়' } },
			{ code: 'english_only', label: { en: 'English', bn: '' } },
			{ code: 'no_label', label: { en: '', bn: '' } },
		] as never;
		expect(ruleSentence(rule, t, numbers, 'bn')).toBe(
			'rule_if bundle_fact_set_pieces op_atLeast 3 bundle_rule_or silk, cotton bundle_rule_or bundle_fact_set_total op_atMost: ' +
				'bundle_action_percentOff 10%, bundle_action_priceIs ₹4,500, bundle_action_makePickFree 1, ' +
				'bundle_action_amountOff ছাড়, bundle_action_amountOff English, bundle_action_amountOff no_label, ' +
				'bundle_action_amountOff gone, bundle_action_makeExtraFree',
		);
	});

	it('escapes what a bundle’s name and code hold', async () => {
		const list = vi.fn(() =>
			of({
				items: [
					{
						id: 'b1',
						title: 'Silk & Cotton',
						sku: 'SET<1>',
						status: 'draft',
						wasLive: false,
						bundle: null,
						thumbnailUrl: null,
						showOnShop: false,
					},
				],
				total: 1,
			}),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: PLATFORM_ID, useValue: 'browser' },
				{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
				{ provide: BundleService, useValue: { list } },
				{
					provide: TranslocoService,
					useValue: { langChanges$: of('en'), getActiveLang: () => 'en', translate: t },
				},
			],
		});
		TestBed.overrideComponent(BundleList, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BundleList);
		fixture.detectChanges();
		await vi.waitFor(() => {
			fixture.detectChanges();
			expect(fixture.componentInstance.tableConfig().data[0]?.name).toContain('Silk &#38; Cotton');
		});
		expect(fixture.componentInstance.tableConfig().data[0]?.name).toContain('SET&#60;1&#62;');
	});

	it('reads metres, stock figures and a category change with parts missing', () => {
		expect(metresToTenths(null)).toBeNull();
		expect(metresToTenths(undefined)).toBeNull();
		expect(
			stockFigures([
				{ quantity: 5, held: null, inOrders: null, freeToSell: null },
				{ quantity: 4, held: 1, inOrders: 2, freeToSell: 1 },
			] as never),
		).toEqual({ onHand: 9, held: 1, inOrders: 2, free: 6 });
		const categories = new Map([['silk', { id: 'silk', name: 'Silk', hsnCode: '5007', returnable: true }]]);
		expect(categoryRefill({ previousMain: null, nextMain: 'silk', currentHsn: '5208', categories }).popup).toEqual({
			category: 'Silk',
			oldCategory: null,
			oldHsn: '5208',
			newHsn: '5007',
		});
		expect(
			categoryRefill({ previousMain: 'gone', nextMain: 'silk', currentHsn: '5208', categories }).popup
				?.oldCategory,
		).toBeNull();
	});

	it('the HSN popup: types a code, puts the buttons back, and uses only a valid code', () => {
		vi.useFakeTimers();
		const close = vi.fn();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: { close } }] });
		TestBed.overrideComponent(HsnPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(HsnPopup).componentInstance;
		const change = { category: 'Silk', oldCategory: null, oldHsn: '5208', newHsn: '5007' } as never;
		popup.start(change);
		expect(popup.change()).toBe(change);
		const box = document.createElement('input');
		box.id = 'hsn_manual';
		document.body.appendChild(box);
		popup.openManual();
		expect(popup.manual()).toBe(true);
		vi.runAllTimers();
		expect(document.activeElement).toBe(box);
		box.remove();
		popup.typed.set('50');
		popup.use();
		expect(close).not.toHaveBeenCalled();
		popup.typed.set(' 500710 ');
		expect(popup.valid()).toBe(true);
		popup.use();
		expect(close).toHaveBeenCalledWith('500710');
		popup.back();
		expect([popup.manual(), popup.typed()]).toEqual([false, '']);
	});
});
