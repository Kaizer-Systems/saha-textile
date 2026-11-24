import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NavService } from '@data-access/services/nav.service';

import { Notification, stockBellLines } from './notification';

const { asked, stockAlerts, capture } = vi.hoisted(() => {
	const asked = { enabled: [] as Array<() => boolean> };
	return {
		asked,
		stockAlerts: { value: undefined as unknown },
		capture: (enabled: () => boolean) => {
			asked.enabled.push(enabled);
			return { data: () => undefined };
		},
	};
});
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data: () => undefined }),
}));
vi.mock('@data-access/queries/admin-languages.queries', () => ({ injectLanguageRemindersQuery: capture }));
vi.mock('@data-access/queries/media-library.queries', () => ({
	injectMediaStorageQuery: capture,
	injectNightlyCheckQuery: capture,
}));
vi.mock('@data-access/queries/page-builder.queries', () => ({ injectPageBuilderAlertsQuery: capture }));
vi.mock('@core/purchasing/stock.gateway', async (original) => ({
	...(await original<object>()),
	injectStockAlertsQuery: (enabled: () => boolean) => {
		asked.enabled.push(enabled);
		return { data: () => stockAlerts.value };
	},
}));

const decision = (over: Record<string, unknown>) => ({
	id: 'req_1',
	kind: 'count',
	action: null,
	variantId: null,
	countId: null,
	countNumber: null,
	status: 'rejected',
	sku: null,
	quantity: 0,
	soldBy: 'piece',
	decidedByName: null,
	rejectReason: null,
	...over,
});

function widget(permissions: string[]) {
	asked.enabled = [];
	const router = { navigate: vi.fn(() => Promise.resolve(true)) };
	const stock = { markSeen: vi.fn(() => of(undefined)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NavService, useValue: {} },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: Router, useValue: router },
			{ provide: StockGateway, useValue: stock },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn(() => Promise.resolve()) } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: object) => (params ? `${key}:${JSON.stringify(params)}` : key),
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
		],
	});
	TestBed.overrideComponent(Notification, { set: { imports: [], template: '' } });
	return { bell: TestBed.createComponent(Notification).componentInstance, router, stock };
}

describe('the bell: who is asked what, and the stock lines', () => {
	it('asks about Media and Page Builder only for people who use them', () => {
		widget(['attachment.index', 'theme_option.index']);
		expect(asked.enabled.map((enabled) => enabled())).toEqual([false, true, true, false, true]);
		widget([]);
		expect(asked.enabled.map((enabled) => enabled())).toEqual([false, false, false, false, false]);
	});

	it('words a refused count with nobody named, and opens Stock when the line has nothing of its own', () => {
		const [line] = stockBellLines({
			pendingApprovals: 0,
			decisions: [decision({})],
			lateOrders: [],
			billsNearCreditLimit: [],
			heldOverdue: 0,
		} as never);
		expect(line).toMatchObject({
			key: 'bell_count_rejected',
			params: { name: '', sku: '', number: '', reason: '' },
			link: ['/stock'],
		});
	});

	it('writes counted lines in the plural form and dates in short, and opens a line that needs no marking', async () => {
		stockAlerts.value = {
			pendingApprovals: 3,
			decisions: [],
			lateOrders: [
				{ id: 'po_1', number: 'PO/26-27/000003', supplierName: 'Shantipur', expectedBy: '2026-11-12' },
			],
			billsNearCreditLimit: [{ id: 'pe_1', number: 'PE/1', supplierName: 'A', days: 151 }],
			heldOverdue: 0,
		};
		const { bell, router, stock } = widget(['stock.approve']);
		const [approvals, late, bills] = bell.stock();
		if (!approvals || !late || !bills) throw new Error('Three lines were expected.');
		expect(bell.stockText(approvals)).toContain('"count":3');
		expect(bell.stockText(late)).toContain('bell_order_late');
		expect(bell.stockText(late)).not.toContain('2026-11-12');
		await bell.openStock(bills);
		expect(stock.markSeen).not.toHaveBeenCalled();
		expect(router.navigate).toHaveBeenCalledWith(['/stock/reports'], { queryParams: { tab: 'unpaid' } });
		stockAlerts.value = undefined;
	});

	it('opens a decision even when marking it seen fails', async () => {
		stockAlerts.value = {
			pendingApprovals: 0,
			decisions: [decision({ countId: 'cnt_7', status: 'applied' })],
			lateOrders: [],
			billsNearCreditLimit: [],
			heldOverdue: 0,
		};
		const { bell, router, stock } = widget(['stock.approve']);
		stock.markSeen.mockReturnValue(throwError(() => new Error('offline')));
		const [line] = bell.stock();
		if (!line) throw new Error('A line was expected.');
		await bell.openStock(line);
		expect(router.navigate).toHaveBeenCalledWith(['/stock-counts', 'cnt_7'], { queryParams: undefined });
		stockAlerts.value = undefined;
	});
});
