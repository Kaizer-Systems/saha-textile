import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoicesGateway } from '@core/accounts/invoices.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderInvoicesCard } from './order-invoices';

import type { TaxInvoice } from '@saha-textile/contracts';

const invoice = {
	id: 'ti_1',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-000001',
	number: 'TI/26-27/000001',
	date: '2026-11-23',
	gstin: '19DBYPS6736R1ZZ',
	locationId: 'loc_bar',
	shipmentId: null,
	seller: { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' },
	buyer: { name: 'Rang Mahal', gstin: null, address: 'Mumbai', stateCode: '27' },
	placeOfSupply: '27',
	interState: true,
	lines: [],
	shippingINR: 0,
	roundOffINR: 0,
	totalINR: 0,
	ratesPendingCa: true,
	status: 'issued',
	cancellation: null,
	createdAt: '2026-11-23T10:00:00.000Z',
} as unknown as TaxInvoice;

function setup(permissions: string[], pdf = () => of(new Blob(['%PDF']))) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [OrderInvoicesCard, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: InvoicesGateway, useValue: { forOrder: () => of([invoice]), pdf: vi.fn(pdf) } },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(OrderInvoicesCard);
	fixture.componentRef.setInput('orderId', 'ord_1');
	return { fixture, card: fixture.componentInstance, notifier };
}

describe('the order page’s tax invoice card (D1, EI5B)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('lists the order’s invoices, and offers the books only to people who may see them', async () => {
		const { fixture, card } = setup(['order.index', 'accounts.index']);
		fixture.detectChanges();
		await vi.waitFor(() => expect(card.invoices.data()).toEqual([invoice]));
		expect(card.canSeeBooks()).toBe(true);
		expect(setup(['order.index']).card.canSeeBooks()).toBe(false);
		expect(card.day('2026-11-23')).toBe('23 Nov 2026');
		expect(card.prints.map((p) => p.copy)).toEqual(['original', 'duplicate', 'triplicate', 'all']);
	});

	it('opens a copy to print, saves one to download, and says when it fails', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		const { card } = setup(['order.index']);
		await card.print(invoice, 'duplicate', false);
		expect(open).toHaveBeenCalled();
		await card.print(invoice, 'all', true);
		expect(click).toHaveBeenCalled();
		expect(card.busy()).toBeNull();
		const failing = setup(['order.index'], () => throwError(() => new Error('down')));
		await failing.card.print(invoice, 'original', false);
		expect(failing.notifier.showError).toHaveBeenCalled();
	});
});
