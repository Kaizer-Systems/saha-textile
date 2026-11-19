import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MenuStore } from '@core/state/menu.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';

import { DRAFT_MARKS, DraftMarkDirective } from '../form-product/draft-mark';
import { ProductConflictPopup, ProductLeavePopup } from '../form-product/draft-popups';
import { ProductDrafts } from './product-drafts';

const listData = signal<unknown>(undefined);
let lastBuild: (() => { queryKey: unknown[]; queryFn: () => unknown }) | undefined;
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (build: () => { queryKey: unknown[]; queryFn: () => unknown }) => {
		lastBuild = build;
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

describe('Products › Drafts', () => {
	it('lists both kinds with where each stands, and counts yours in the menu', () => {
		const { page, menu } = make();
		listData.set({
			items: [
				draftRow(),
				draftRow({ id: 'pdr_2', title: '', toFix: 1 }),
				draftRow({
					id: 'pdr_3',
					kind: 'edit',
					productId: 'p1',
					productTitle: 'Maroon',
					productStatus: 'live',
					productWasLive: true,
					changedCount: 2,
					toFix: 0,
					thumbnailUrl: 'u',
				}),
				draftRow({ id: 'pdr_4', toFix: 0 }),
			],
			total: 4,
			mine: 3,
		});
		TestBed.tick();
		const rows = page.tableConfig().data ?? [];
		expect(menu.setBadge).toHaveBeenCalledWith('/product/drafts', 3);
		expect(rows[0]).toMatchObject({ kind: 'new', thumb: null });
		expect(rows[0]?.product).toContain('Kantha &#60;Silk&#62;');
		expect(rows[0]?.stands).toContain('draft_to_fix:4');
		expect(rows[1]?.product).toContain('draft_untitled');
		expect(rows[1]?.stands).toContain('draft_nothing_yet');
		expect(rows[2]?.kind_pill).toContain('draft_changes');
		expect(rows[2]?.product).toContain('product_state_live');
		expect(rows[2]?.stands).toContain('draft_ready_update:2');
		expect(rows[3]?.stands).toContain('draft_ready_save');
		expect(page.tableConfig().total).toBe(4);
		listData.set(undefined);
	});

	it('switches Mine and Everyone’s, passes the table state, and opens each kind', () => {
		const { page, router } = make();
		page.setWho('everyone');
		page.onTableChange({ search: 'silk', page: 2, paginate: 10 });
		TestBed.tick();
		const options = lastBuild?.();
		expect(options?.queryKey).toEqual(['product-drafts', 'everyone', { search: 'silk', page: 2, paginate: 10 }]);
		void options?.queryFn();
		listData.set({ items: [draftRow({ mine: false })], total: 1, mine: 0 });
		TestBed.tick();
		expect(page.tableConfig().data?.[0]?.product).toContain('Mou');
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'pdr_1', kind: 'new', productId: null } });
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/product/create?draft=pdr_1');
		page.open({ id: 'pdr_3', kind: 'edit', productId: 'p1' } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/product/edit/p1?draft=pdr_3');
		listData.set(undefined);
	});

	it('discards a draft only, and says when it could not', async () => {
		const { page, drafts, toasts, client } = make();
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'pdr_1' } });
		await Promise.resolve();
		await Promise.resolve();
		expect(drafts.discard).toHaveBeenCalledWith('pdr_1');
		expect(toasts.showSuccess).toHaveBeenCalledWith('draft_discarded');
		expect(client.invalidateQueries).toHaveBeenCalled();
		drafts.discard.mockReturnValueOnce(throwError(() => new Error('no')) as never);
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'pdr_2' } });
		await Promise.resolve();
		await Promise.resolve();
		expect(toasts.showError).toHaveBeenCalledWith('draft_not_saved');
	});
});

@Component({
	template: `
		<form [formGroup]="form">
			<div class="input-group"><input formControlName="price" /></div>
			<input formControlName="sku" />
		</form>
	`,
	imports: [ReactiveFormsModule, DraftMarkDirective],
	providers: [{ provide: DRAFT_MARKS, useExisting: MarksHost }],
})
class MarksHost {
	readonly form = new FormGroup({ price: new FormControl(1), sku: new FormControl('S') });
	readonly changed = signal<string | null>(null);
	wasFor(path: readonly string[] | null) {
		return path?.[0] === 'price' ? this.changed() : null;
	}
}

describe('DraftMarkDirective', () => {
	it('outlines a changed field and says what it was, then takes both away', () => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(MarksHost);
		fixture.detectChanges();
		const element = fixture.nativeElement as HTMLElement;
		const price = element.querySelector('input[formcontrolname="price"]') as HTMLInputElement;
		expect(price.classList.contains('border-warning')).toBe(false);
		fixture.componentInstance.changed.set('Changed · was: "1"');
		fixture.detectChanges();
		TestBed.tick();
		expect(price.classList.contains('border-warning')).toBe(true);
		expect(element.querySelector('.input-group + .text-warning')?.textContent).toBe('Changed · was: "1"');
		fixture.componentInstance.changed.set('Changed · was: "2"');
		TestBed.tick();
		expect(element.querySelectorAll('.text-warning')).toHaveLength(1);
		fixture.componentInstance.changed.set(null);
		TestBed.tick();
		expect(price.classList.contains('border-warning')).toBe(false);
		expect(element.querySelector('.text-warning')).toBeNull();
		fixture.componentInstance.changed.set('again');
		TestBed.tick();
		fixture.destroy();
	});
});

describe('Draft popups', () => {
	it('closes the leave and conflict questions with their answers', () => {
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: modal }] });
		TestBed.overrideComponent(ProductLeavePopup, { set: { imports: [], template: '' } });
		TestBed.overrideComponent(ProductConflictPopup, { set: { imports: [], template: '' } });
		expect(TestBed.createComponent(ProductLeavePopup).componentInstance.name()).toBe('');
		const conflict = TestBed.createComponent(ProductConflictPopup).componentInstance;
		conflict.pick('raw.weight', 'theirs');
		conflict.pick('raw.sku', 'mine');
		expect(conflict.choice()).toEqual({ 'raw.weight': 'theirs', 'raw.sku': 'mine' });
	});
});
