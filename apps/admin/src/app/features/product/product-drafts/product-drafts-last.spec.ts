import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MenuStore } from '@core/state/menu.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';

import { ProductDrafts } from './product-drafts';

const listData = signal<unknown>(undefined);
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (build: () => { queryKey: unknown[]; queryFn: () => unknown }) => {
		void build().queryFn();
		return { data: listData };
	},
}));

const draftRow = (over: Record<string, unknown> = {}) => ({
	id: 'pdr_1',
	kind: 'new',
	productId: null,
	title: 'Kantha <Silk>',
	thumbnailUrl: null,
	productStatus: null,
	productTitle: null,
	productWasLive: false,
	changedCount: 0,
	toFix: 4,
	updatedAt: '2026-11-19T09:35:00.000Z',
	updatedByName: 'Mou',
	mine: true,
	...over,
});

const make = () => {
	const drafts = { list: vi.fn(() => of({ items: [], mine: 0 })), discard: vi.fn(() => of(undefined)) };
	const router = { navigateByUrl: vi.fn() };
	const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
	const menu = { setBadge: vi.fn() };
	const client = { invalidateQueries: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ProductDraftService, useValue: drafts },
			{ provide: Router, useValue: router },
			{ provide: NotificationService, useValue: toasts },
			{ provide: MenuStore, useValue: menu },
			{ provide: QueryClient, useValue: client },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: { count?: number }) => (params ? `${key}:${params.count}` : key),
					langChanges$: of('en'),
					getActiveLang: () => 'en',
				},
			},
		],
	});
	TestBed.overrideComponent(ProductDrafts, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductDrafts);
	TestBed.tick();
	return { page: fixture.componentInstance, drafts, router, toasts, menu, client };
};

describe('Products › Drafts: the last cases', () => {
	it('names a changed product by the draft’s own title when the product has none, with no saver', () => {
		const { page } = make();
		listData.set({
			items: [
				draftRow({ kind: 'edit', productId: 'p1', productTitle: null, title: 'Kantha', updatedByName: null }),
			],
			total: 1,
			mine: 1,
		});
		TestBed.tick();
		const [row] = page.tableConfig().data;
		expect(row?.product).toContain('Kantha');
		expect(row?.saved_by).toBe('');
	});

	it('does nothing for an action it does not know', () => {
		const { page, router, drafts } = make();
		page.onActionClicked({ actionToPerform: 'view', data: draftRow() } as never);
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		expect(drafts.discard).not.toHaveBeenCalled();
	});
});
