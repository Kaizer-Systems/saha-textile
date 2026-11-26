import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { ProductService } from '@data-access/services/product.service';

import { Product } from './product';

const h = vi.hoisted(() => ({ page: undefined as unknown }));
vi.mock('@data-access/queries/product.queries', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		injectCatalogProductsQuery: (p: () => unknown) => (p(), { data: make(h.page), refetch: vi.fn() }),
	};
});

const bulkRow = (id: string, outcome: string, reason: string | null = null, gaps: unknown[] = []) => ({
	id,
	title: id,
	outcome,
	reason,
	gaps,
	copyId: null,
	copySku: null,
});

const make = (popupAnswer: unknown = undefined, platform = 'browser') => {
	const service = {
		bulk: vi.fn(() => of({ dryRun: true, rows: [bulkRow('p1', 'done')] })),
		goLive: vi.fn(() => of({ live: true, gaps: [] })),
		getReplacementTargets: vi.fn(() => of([{ path: '/collections/sarees', label: 'Sarees' }])),
	};
	const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigateByUrl: vi.fn() };
	const started: unknown[] = [];
	const modals = {
		open: vi.fn(() => ({
			componentInstance: { start: (ask: unknown) => started.push(ask) },
			result: popupAnswer instanceof Error ? Promise.reject(popupAnswer) : Promise.resolve(popupAnswer),
		})),
	};
	const drafts = { list: vi.fn(() => of({ items: [], mine: 0 })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: ProductService, useValue: service },
			{ provide: NotificationService, useValue: toasts },
			{ provide: NgbModal, useValue: modals },
			{ provide: ProductDraftService, useValue: drafts },
			{ provide: PLATFORM_ID, useValue: platform },
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => key, langChanges$: of('en'), getActiveLang: () => 'en' },
			},
		],
	});
	TestBed.overrideComponent(Product, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(Product).componentInstance;
	const table = {
		dropPicks: vi.fn(),
		markPicks: vi.fn(),
		pickedRows: vi.fn(() => [{ id: 'p1', title: 'Maroon', product_thumbnail: { original_url: 'u' } }]),
	};
	(page as unknown as { table: () => unknown }).table = () => table;
	return { page, service, toasts, router, modals, started, table, drafts };
};

const flush = async () => {
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const listRow = (over: Record<string, unknown> = {}) => ({
	id: 'p1',
	slug: 'silk',
	title: 'Silk & Cotton',
	sku: 'S-1',
	sellingFromINR: 1200,
	thumbnailUrl: null,
	stock: 0,
	status: 'draft',
	wasLive: false,
	variantCount: 1,
	showOnShop: false,
	...over,
});

describe('Product list: the last cases', () => {
	it('escapes names, shows a hidden product as hidden, and draws a picked row with or without a picture', () => {
		h.page = { items: [listRow()], total: 1 };
		const { page } = make();
		TestBed.tick();
		const [row] = page.tableConfig().data;
		expect(row?.name).toContain('Silk &#38; Cotton');
		expect(row?.shop).toContain('hidden_from_shop');
		const pickView = page.tableConfig().pickView as (row: unknown) => { image: string | null; detail: string };
		expect(
			pickView({
				title: 'A',
				sku: 'S-1',
				variantCount: 3,
				sale_price: 1200,
				product_thumbnail: { original_url: 'u' },
			}),
		).toMatchObject({
			image: 'u',
			detail: 'S-1 · sale_colours · ₹1,200',
		});
		expect(
			pickView({ title: 'B', sku: 'S-2', variantCount: 1, sale_price: 900, product_thumbnail: null }),
		).toMatchObject({
			image: null,
			detail: 'S-2 · ₹900',
		});
		h.page = undefined;
	});

	it('on the server: no drafts read, and Edit keeps no queue', () => {
		const { page, drafts, router } = make(undefined, 'server');
		expect(drafts.list).not.toHaveBeenCalled();
		page.tableConfig.update((config) => ({ ...config, data: undefined as never }));
		page.edit({ id: 'p1' } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product/edit/p1');
	});

	it('a bulk popup closed without acting reports nothing; a delete with nothing done rereads the drafts', async () => {
		const closed = make(new Error('closed'));
		await closed.page.runBulk('take-off', ['p1']);
		expect(closed.toasts.showSuccess).not.toHaveBeenCalled();
		const answer = { dryRun: false, rows: [bulkRow('p1', 'skipped', 'already_off')] };
		const { page, toasts, drafts } = make(answer);
		drafts.list.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await page.runBulk('delete', ['p1']);
		await flush();
		expect(toasts.showSuccess).not.toHaveBeenCalled();
		expect(drafts.list).toHaveBeenCalledTimes(2);
	});

	it('Put on sale: nothing without the table, a closed popup, and products left out for no stated reason', async () => {
		const bare = make(undefined);
		(bare.page as unknown as { table: () => unknown }).table = () => undefined;
		await bare.page.openSale(['p1']);
		expect(bare.modals.open).not.toHaveBeenCalled();
		const closed = make(new Error('closed'));
		closed.table.pickedRows.mockReturnValueOnce([{ id: 'p1', title: 'Maroon', product_thumbnail: null }] as never);
		await closed.page.openSale(['p1']);
		expect(closed.started[0]).toEqual([{ id: 'p1', title: 'Maroon', thumbnailUrl: null }]);
		const left = make({
			created: false,
			result: { eventId: 'evt_1', rows: [{ productId: 'p1', outcome: 'refused', reason: null }] },
		});
		await left.page.openSale(['p1']);
		expect(left.table.markPicks).toHaveBeenCalledWith(new Map([['p1', 'sale_left_out_bad_rule']]));
		expect(left.toasts.showSuccess).not.toHaveBeenCalled();
	});
});
