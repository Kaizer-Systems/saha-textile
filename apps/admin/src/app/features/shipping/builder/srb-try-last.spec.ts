import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';

import { SrbTry } from './srb-try';

import type { ShippingCartTryResult, ShippingTryLineView, ShippingTryResult } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	fx: undefined as unknown,
	fxEnabled: null as null | (() => boolean),
	figures: new Map<string, { amountINR: number | null }>(),
	explanation: 'explained',
}));
vi.mock('@core/fx/fx.gateway', async (original) => {
	const { signal: make } = await import('@angular/core');
	return {
		...(await original<typeof import('@core/fx/fx.gateway')>()),
		injectFxOverviewQuery: (enabled: () => boolean) => {
			h.fxEnabled = enabled;
			return { data: make(h.fx) };
		},
	};
});
vi.mock('@core/shipping/try-words', async (original) => ({
	...(await original<typeof import('@core/shipping/try-words')>()),
	lineFigures: () => h.figures,
	// Calls the translator it is handed, so the subline's own translator runs.
	lineSubline: (translate: (key: string, params?: Record<string, string | number>) => string) =>
		translate('ship_try_line', { units: 2 }),
	tryExplanation: () => h.explanation,
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join('|')})` : key;

function view(lineId: string, change: Partial<ShippingTryLineView> = {}): ShippingTryLineView {
	return {
		lineId,
		productId: 'p1',
		title: 'Silk',
		units: 1,
		sellingPriceINR: 1000,
		mrpINR: null,
		discounted: false,
		charges: {},
		chargeableWeightGrams: null,
		variantLabel: null,
		imageUrl: null,
		...change,
	} as ShippingTryLineView;
}

function ruleSetResult(change: Partial<ShippingTryResult> = {}): ShippingTryResult {
	return {
		status: 'priced',
		zone: 'domestic',
		amountINR: 100,
		lines: [view('l1')],
		trace: [],
		adjustments: [],
		cantShip: [],
		noResult: [],
		moreLines: 0,
		...change,
	};
}

function cartResult(change: Partial<ShippingCartTryResult> = {}): ShippingCartTryResult {
	return {
		status: 'priced',
		zone: 'international',
		amountINR: 3000,
		lines: [],
		groups: [],
		cantShip: [],
		...change,
	} as ShippingCartTryResult;
}

function tester(options: { permissions?: string[]; lang?: string } = {}) {
	const gateway = {
		tryIt: vi.fn(() => of(ruleSetResult())),
		tryCart: vi.fn(() => of(cartResult())),
		searchProducts: vi.fn(() => of({ items: [{ id: 'p1', title: 'Silk' }] })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ShippingGateway, useValue: gateway },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => options.lang ?? 'en' },
			},
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['currency.index']) } },
		],
	});
	TestBed.overrideComponent(SrbTry, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(SrbTry);
	const kept: unknown[] = [];
	fixture.componentInstance.saveTestCart.subscribe((cart) => kept.push(cart));
	return { fixture, c: fixture.componentInstance, gateway, kept };
}

describe('try it: the last cases', () => {
	it('adds a product already listed beside another, changes one line of several, and words a line', () => {
		const { c } = tester();
		c.pick({ id: 'p1', title: 'Silk' } as never);
		c.pick({ id: 'p2', title: 'Cotton' } as never);
		c.pick({ id: 'p2', title: 'Cotton' } as never);
		expect(c.lines().map((line) => [line.productId, line.quantity])).toEqual([
			['p1', 1],
			['p2', 2],
		]);
		c.setQuantity(0, '5');
		expect(c.lines().map((line) => line.quantity)).toEqual([5, 2]);
		expect(c.subline(view('l1'))).toBe('ship_try_line(2)');
	});
});
