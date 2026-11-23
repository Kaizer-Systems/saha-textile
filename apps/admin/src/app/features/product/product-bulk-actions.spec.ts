import { signal } from '@angular/core';
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

vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogProductsQuery: (p: () => unknown) => (p(), { data: signal(undefined), refetch: vi.fn() }),
}));

const bulkRow = (id: string, outcome: string, reason: string | null = null, gaps: unknown[] = []) => ({
	id,
	title: id,
	outcome,
	reason,
	gaps,
	copyId: null,
	copySku: null,
});

const make = (popupAnswer: unknown = undefined) => {
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
	return { page, service, toasts, router, modals, started, table };
};

const flush = async () => {
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('Product list bulk actions', () => {
	it('asks with a dry run, acts, unticks what was done and marks what was not', async () => {
		const answer = {
			dryRun: false,
			rows: [
				bulkRow('p1', 'done'),
				bulkRow('p2', 'skipped', 'already_live'),
				bulkRow('p3', 'refused', 'needs_work', [{ field: 'name', locale: 'bn' }]),
				bulkRow('p4', 'refused', null),
			],
		};
		const { page, service, toasts, started, table } = make(answer);
		page.onActionClicked({ actionToPerform: 'bulk_go_live', data: ['p1', 'p2', 'p3', 'p4'] });
		await flush();
		expect(service.bulk).toHaveBeenCalledWith('go-live', ['p1', 'p2', 'p3', 'p4'], true);
		const ask = started[0] as { act: (path: string | null) => Promise<unknown>; action: string };
		expect(ask.action).toBe('go-live');
		await ask.act(null);
		expect(service.bulk).toHaveBeenLastCalledWith('go-live', ['p1', 'p2', 'p3', 'p4'], false, null);
		expect(table.dropPicks).toHaveBeenCalledWith(['p1', 'p2']);
		expect(table.markPicks).toHaveBeenCalledWith(
			new Map([
				['p3', 'বাংলা: gap_name'],
				['p4', 'bulk_why_failed'],
			]),
		);
		expect(toasts.showSuccess).toHaveBeenCalledWith('bulk_report_go_live');
		expect(toasts.showError).toHaveBeenCalledWith('bulk_report_refused');
	});

	it('offers live pages for Discontinue, and the row bin runs Delete for one', async () => {
		const { page, service, started } = make(undefined);
		page.onActionClicked({ actionToPerform: 'bulk_discontinue', data: ['p1'] });
		await flush();
		expect((started[0] as { targets: unknown }).targets).toEqual([
			{ value: '/collections/sarees', label: 'Sarees · /collections/sarees' },
		]);
		page.onActionClicked({ actionToPerform: 'remove', data: { id: 'p9' } });
		await flush();
		expect(service.bulk).toHaveBeenLastCalledWith('delete', ['p9'], true);
	});

	it('says when the question cannot be asked, and does nothing for no products', async () => {
		const { page, service, toasts } = make(undefined);
		await page.runBulk('delete', []);
		expect(service.bulk).not.toHaveBeenCalled();
		service.bulk.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await page.runBulk('duplicate', ['p1']);
		expect(toasts.showError).toHaveBeenCalledWith('bulk_failed');
	});

	it('runs nothing for a bulk action that arrives with no ids', async () => {
		const { page, service } = make();
		page.onActionClicked({ actionToPerform: 'bulk_duplicate' });
		await Promise.resolve();
		expect(service.bulk).not.toHaveBeenCalled();
	});

	it('runs the row switch: on is Go Live, off is Take off shop', () => {
		const { page, service, toasts } = make();
		page.onActionClicked({ actionToPerform: 'status_switch', data: { id: 'p1', status_switch: 1 } });
		expect(service.goLive).toHaveBeenCalledWith('p1');
		service.bulk.mockReturnValueOnce(of({ dryRun: false, rows: [bulkRow('p1', 'done')] }) as never);
		page.onActionClicked({ actionToPerform: 'status_switch', data: { id: 'p1', status_switch: 0 } });
		expect(service.bulk).toHaveBeenLastCalledWith('take-off', ['p1'], false);
		expect(toasts.showSuccess).toHaveBeenCalledWith('bulk_report_take_off');
		service.bulk.mockReturnValueOnce(throwError(() => new Error('no')) as never);
		page.statusSwitch({ id: 'p1' } as never, 0);
		expect(toasts.showError).toHaveBeenCalledWith('bulk_failed');
	});

	it('puts picks on sale: a new draft sale opens in Events, an existing one reports', async () => {
		const created = {
			created: true,
			result: {
				dryRun: false,
				eventId: 'evt_9',
				eventStatus: 'draft',
				rows: [{ productId: 'p1', outcome: 'done' }],
			},
		};
		const one = make(created);
		one.page.onActionClicked({ actionToPerform: 'bulk_sale', data: ['p1'] });
		await flush();
		expect(one.started[0]).toEqual([{ id: 'p1', title: 'Maroon', thumbnailUrl: 'u' }]);
		expect(one.router.navigateByUrl).toHaveBeenCalledWith('/event/edit/evt_9');
		const joined = make({
			created: false,
			result: {
				dryRun: false,
				eventId: 'evt_1',
				eventStatus: 'live',
				rows: [
					{ productId: 'p1', outcome: 'done' },
					{ productId: 'p2', outcome: 'refused', reason: 'overlap' },
				],
			},
		});
		await joined.page.openSale(['p1']);
		expect(joined.table.markPicks).toHaveBeenCalledWith(new Map([['p2', 'sale_left_out_overlap']]));
		expect(joined.toasts.showSuccess).toHaveBeenCalledWith('sale_report_added');
		const closed = make(undefined);
		await closed.page.openSale(['p1']);
		closed.table.pickedRows.mockReturnValueOnce([]);
		await closed.page.openSale(['p1']);
		expect(closed.modals.open).toHaveBeenCalledTimes(1);
	});
});
