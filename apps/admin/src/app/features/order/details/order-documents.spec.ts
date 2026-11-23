import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { InvoicesGateway } from '@core/accounts/invoices.gateway';
import { RefundVouchersGateway } from '@core/accounts/refund-vouchers.gateway';
import { ReturnsGateway } from '@core/accounts/returns.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderDocuments } from './order-documents';

import type { OrderDocumentRow } from '@saha-textile/contracts';

const doc = (kind: OrderDocumentRow['kind'], patch: Partial<OrderDocumentRow> = {}): OrderDocumentRow => ({
	kind,
	id: `${kind}_1`,
	number: 'N/1',
	date: '2026-11-18',
	amountINR: 9_360,
	status: null,
	creditNoteId: null,
	...patch,
});

function setup(fail = false) {
	const pdf = () => (fail ? throwError(() => new Error('down')) : of(new Blob(['%PDF'])));
	const invoices = { pdf: vi.fn(pdf) };
	const orders = { receiptPdf: vi.fn(pdf), packingSlip: vi.fn(pdf) };
	const returns = { returnNotePdf: vi.fn(pdf), creditNotePdf: vi.fn(pdf), debitNotePdf: vi.fn(pdf) };
	const refunds = { pdf: vi.fn(pdf) };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [OrderDocuments, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			{ provide: InvoicesGateway, useValue: invoices },
			{ provide: OrdersGateway, useValue: orders },
			{ provide: ReturnsGateway, useValue: returns },
			{ provide: RefundVouchersGateway, useValue: refunds },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(OrderDocuments);
	fixture.componentRef.setInput('orderId', 'ord_1');
	fixture.componentRef.setInput('documents', [
		doc('taxInvoice'),
		doc('packingSlip', { amountINR: null, date: null }),
	]);
	fixture.detectChanges();
	return { fixture, card: fixture.componentInstance, invoices, orders, returns, refunds, notifier };
}

describe('the order’s Documents card (B1)', () => {
	it('opens each document on its own page where it has one', () => {
		const { card, fixture } = setup();
		expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(2);
		expect(card.link(doc('taxInvoice'))).toEqual(['/accounts/invoices', 'taxInvoice_1']);
		expect(card.link(doc('return'))).toEqual(['/accounts/returns', 'return_1']);
		expect(card.link(doc('creditNote'))).toEqual(['/accounts/credit-notes', 'creditNote_1']);
		expect(card.link(doc('debitNote', { creditNoteId: 'cn_9' }))).toEqual(['/accounts/credit-notes', 'cn_9']);
		expect(card.link(doc('debitNote'))).toBeNull();
		expect(card.link(doc('receipt'))).toBeNull();
		expect(card.link(doc('refundVoucher'))).toEqual(['/accounts/refund-vouchers', 'refundVoucher_1']);
		expect(
			[
				doc('return', { status: 'checked' }),
				doc('refundVoucher', { status: 'failed' }),
				doc('creditNote', { status: 'draft' }),
			].map((d) => card.statusKey(d)),
		).toEqual(['ret_status_checked', 'rf_status_failed', 'cn_status_draft']);
		expect(card.printable(doc('creditNote', { status: 'draft' }))).toBe(false);
		expect(card.printable(doc('creditNote', { status: 'cancelled' }))).toBe(true);
		expect(card.day('2026-11-18')).toBe('18 Nov 2026');
		expect(card.inr(9360)).toBe('₹9,360.00');
	});

	it('prints each kind on its own format', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		vi.spyOn(window, 'open').mockReturnValue(null);
		const { card, invoices, orders, returns, refunds } = setup();
		for (const kind of [
			'taxInvoice',
			'receipt',
			'packingSlip',
			'return',
			'creditNote',
			'debitNote',
			'refundVoucher',
		] as const)
			await card.print(doc(kind));
		expect(invoices.pdf).toHaveBeenCalledWith('ord_1', 'taxInvoice_1', 'original');
		expect(orders.receiptPdf).toHaveBeenCalledWith('ord_1', 'receipt_1');
		expect(orders.packingSlip).toHaveBeenCalledWith('ord_1');
		expect(returns.returnNotePdf).toHaveBeenCalledWith('return_1');
		expect(returns.creditNotePdf).toHaveBeenCalledWith('creditNote_1');
		expect(returns.debitNotePdf).toHaveBeenCalledWith('debitNote_1');
		expect(refunds.pdf).toHaveBeenCalledWith('refundVoucher_1');
		expect(card.busy()).toBe(false);
	});

	it('says when a print failed', async () => {
		const { card, notifier } = setup(true);
		await card.print(doc('receipt'));
		expect(notifier.showError).toHaveBeenCalled();
	});
});
