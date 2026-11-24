import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { newZoneFormula } from '@core/zones/zone-blocks';
import { ZonesGateway } from '@core/zones/zones.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { ZoneEditor } from './zone-editor';
import { ZoneFormula } from './zone-formula';

import type { PriceZone, ZonePriceFormula } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	categories: undefined as unknown,
	zones: undefined as unknown,
	confirm: true,
}));
vi.mock('@data-access/queries/category.queries', async () => {
	const { signal: make } = await import('@angular/core');
	const data = make<unknown>(undefined);
	return {
		injectCategoriesQuery: (params: () => unknown) => {
			params();
			data.set(h.categories);
			return { data };
		},
	};
});
vi.mock('@core/zones/zones.gateway', async (original) => ({
	...(await original<typeof import('@core/zones/zones.gateway')>()),
	injectZonesQuery: () => ({ data: () => h.zones }),
}));
vi.mock('@features/purchasing/shared/popups', () => ({ askConfirm: async () => h.confirm }));

const t = (key: string, params?: Record<string, unknown>) =>
	key === 'zone_trace_unknown' ? key : params ? `${key}(${Object.values(params).join('|')})` : key;

const bare = <T>(type: Type<T>, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type);
};

function zone(change: Partial<PriceZone> = {}): PriceZone {
	return {
		id: 'zone_1',
		code: 'WHOLESALE',
		name: 'Wholesale',
		description: '',
		status: 'draft',
		system: false,
		revision: 3,
		rules: [],
		...change,
	} as unknown as PriceZone;
}

function editor(options: { id?: string | null; permissions?: string[]; zone?: PriceZone } = {}) {
	const gateway = {
		get: vi.fn(() => of(options.zone ?? zone())),
		save: vi.fn((id: string | null) => of(zone({ id: id ?? 'zone_new' }))),
		setStatus: vi.fn(() => of(zone({ status: 'live' }))),
		tryRules: vi.fn(() => of({ lines: [] })),
	};
	const products = {
		getCatalogProducts: vi.fn(() =>
			of({
				items: [
					{ id: 'p1', title: 'Silk', sku: 'S-1' },
					{ id: 'p2', title: 'Cotton', sku: 'C-1' },
				],
			}),
		),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn(async () => true) };
	const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
	const permissions = signal(options.permissions ?? ['price_zone.edit', 'price_zone.create', 'stock.cost']);
	const fixture = bare(ZoneEditor, [
		{
			provide: ActivatedRoute,
			useValue: { snapshot: { paramMap: { get: () => (options.id === undefined ? 'zone_1' : options.id) } } },
		},
		{ provide: Router, useValue: router },
		{ provide: ZonesGateway, useValue: gateway },
		{ provide: ProductService, useValue: products },
		{ provide: NotificationService, useValue: notifier },
		{ provide: TranslocoService, useValue: { translate: t } },
		{ provide: QueryClient, useValue: queryClient },
		{ provide: AuthStore, useValue: { permissions } },
	]);
	return { c: fixture.componentInstance, gateway, products, notifier, router, queryClient, permissions };
}

const settle = async () => {
	for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	h.categories = undefined;
	h.zones = undefined;
	h.confirm = true;
});

describe('zone screens: the last cases', () => {
	it('the editor offers no categories before the category list arrives', async () => {
		const { c } = editor();
		await settle();
		expect(c.categories()).toEqual([]);
		expect(c.categoryOptions()).toEqual([]);
	});

	it('changing one break keeps the others as they were', () => {
		const fixture = bare(ZoneFormula);
		const first = { minQuantity: 10, formula: newZoneFormula('percentOffBase') };
		const second = { minQuantity: 20, formula: newZoneFormula('percentOffBase') };
		fixture.componentRef.setInput('formula', { kind: 'quantityBreaks', breaks: [first, second] } as never);
		const out: ZonePriceFormula[] = [];
		fixture.componentInstance.formulaChange.subscribe((next) => out.push(next));
		fixture.componentInstance.setBreak(1, { minQuantity: 30 });
		const breaks = (out.at(-1) as unknown as { breaks: Array<{ minQuantity: number }> }).breaks;
		expect(breaks[0]).toBe(first);
		expect(breaks[1]?.minQuantity).toBe(30);
	});
});
