import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReturnsGateway } from '@core/accounts/returns.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderReturnsCard } from './order-returns';

const view = {
	invoiceId: 'ti_1',
	invoiceNumber: 'TI/26-27/000145',
	deliveredOn: '2026-11-21',
	windowEnds: '2026-11-28',
	windowOpen: true,
	deadline: '2027-11-30',
	returnable: [],
	parcels: [
		{ shipmentId: 'shp_1', number: 'P1', courier: '', delivered: false },
		{ shipmentId: 'shp_2', number: 'P2', courier: '', delivered: false },
		{ shipmentId: 'shp_3', number: 'P3', courier: '', delivered: true },
	],
	returns: [],
	creditNotes: [{ id: 'cn_1', shipmentId: 'shp_2', status: 'draft' }],
	debitNotes: [],
	documents: [],
};

function setup(fail = false) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const close = vi.fn();
	const gateway = {
		view: () => of(view),
		start: vi.fn(() =>
			fail
				? throwError(() => ({ error: { error: { message: 'return_too_many:BAN-3' } } }))
				: of({ id: 'ret_1', number: 'R1' }),
		),
		priceAdjustment: vi.fn(() => (fail ? throwError(() => new Error('down')) : of({ id: 'cn_2' }))),
		undelivered: vi.fn(() => of({ id: 'cn_3' })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [OrderReturnsCard, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideHttpClient(),
			provideTanStackQuery(new QueryClient()),
			{ provide: ReturnsGateway, useValue: gateway },
			{ provide: NgbModal, useValue: { open: () => ({ close }) } },
			{ provide: AuthStore, useValue: { permissions: signal(['order.edit']) } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(OrderReturnsCard);
	fixture.componentRef.setInput('orderId', 'ord_1');
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	return { fixture, card: fixture.componentInstance, gateway, notifier, navigate, close };
}

describe('the order’s returns card (B1, B2, B10, B11)', () => {
	it('offers the parcels not delivered and without a note, and says when nothing is there yet', async () => {
		const { fixture, card } = setup();
		expect(card.empty()).toBe(true);
		expect(card.openParcels()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(card.view.data()).toBeTruthy());
		expect(card.openParcels().map((p) => p.shipmentId)).toEqual(['shp_1']);
		expect(card.empty()).toBe(false);
		expect(card.canEdit()).toBe(true);
		expect(card.day(null)).toBe('');
		expect(card.day('2026-11-28')).toBe('28 Nov 2026');
		expect(card.rupees(4680)).toBe('₹4,680.00');
	});

	it('starts a return with the pieces chosen and opens it', async () => {
		const { card, gateway, navigate, close } = setup();
		card.open({} as never);
		expect(card.picked()).toBe(false);
		card.setQuantity('a', 2.7);
		card.setQuantity('b', -1);
		card.setQuantity('c', Number.NaN);
		expect(card.quantities()).toEqual({ a: 2, b: 0, c: 0 });
		// Fabric is typed in metres and kept in tenths of a metre, as the invoice counts it.
		card.setQuantity('f', 2.3, 'MTR');
		expect([card.quantities()['f'], card.perShown({ unit: 'MTR' }), card.perShown({ unit: 'PCS' })]).toEqual([
			23, 10, 1,
		]);
		expect(card.picked()).toBe(true);
		await card.start();
		expect(gateway.start).toHaveBeenCalledWith(
			'ord_1',
			expect.objectContaining({ reason: 'damaged_on_arrival', how: 'pickup' }),
		);
		expect(navigate).toHaveBeenCalledWith(['/accounts/returns', 'ret_1']);
		expect(close).toHaveBeenCalled();
	});

	it('drafts a price adjustment, kept on account or refunded, and a parcel brought back', async () => {
		const { card, gateway, navigate } = setup();
		card.setLowerBy('a', 500);
		card.setLowerBy('b', Number.NaN);
		expect(card.lowered()).toBe(true);
		card.refundTo.set('customer_account');
		await card.adjust();
		expect(gateway.priceAdjustment).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({ refundTo: 'customer_account' }),
		);
		card.refundTo.set('bank_transfer');
		await card.adjust();
		expect(gateway.priceAdjustment).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({ refundTo: 'original_payment' }),
		);
		await card.undelivered('shp_1');
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/credit-notes', 'cn_3']);
	});

	it('says why a start or a draft was refused', async () => {
		const { card, notifier } = setup(true);
		await card.start();
		await card.adjust();
		expect(notifier.showError).toHaveBeenCalledTimes(2);
		expect(card.busy()).toBe(false);
	});
});
