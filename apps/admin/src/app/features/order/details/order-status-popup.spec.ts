import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { RefundVouchersGateway } from '@core/accounts/refund-vouchers.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';

import { indiaToday, OrderStatusPopup } from './order-status-popup';

import type { AdminOrderDetail } from '@saha-textile/contracts';

/** Update status (st01–st05) and, for a paid order not yet invoiced, Cancel and refund (accounts brief C1). */

const option = (to: string, patch: Record<string, unknown> = {}) => ({
	to,
	allowed: true,
	reason: null,
	needs: [],
	warning: null,
	tells: [],
	...patch,
});
const gatewayPayment = {
	id: 'pay_1',
	method: 'gateway',
	state: 'received',
	amountINR: 2_600,
	receiptNumber: 'RC/26-27/000013',
	gateway: { id: 'ccavenue', attemptId: 'a', reference: '113000123', requestId: null },
};
const detail = (patch: { status?: string; payments?: unknown[]; lines?: number[]; allowedNext?: unknown[] } = {}) =>
	({
		order: {
			id: 'ord_1',
			orderNumber: 'ST-2611-688796',
			status: patch.status ?? 'placed',
			revision: 4,
			lines: (patch.lines ?? [1]).map((quantity) => ({ quantity })),
		},
		payments: patch.payments ?? [],
		allowedNext: patch.allowedNext ?? [option('processing'), option('cancelled')],
	}) as unknown as AdminOrderDetail;

function setup(fail: unknown = null) {
	const close = vi.fn();
	const orders = {
		changeStatus: vi.fn(() => (fail ? throwError(() => fail) : of({ id: 'ord_1' }))),
	};
	const refunds = {
		cancelAndRefund: vi.fn(() => (fail ? throwError(() => fail) : of([{ id: 'rf_1' }]))),
	};
	const chart = vi.fn(() =>
		of({
			groups: [{ id: 'g_bank', systemKey: 'bank_accounts', parentId: null }],
			ledgers: [{ id: 'led_hdfc', name: 'HDFC', groupId: 'g_bank', active: true }],
		}),
	);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [OrderStatusPopup, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{ provide: OrdersGateway, useValue: orders },
			{ provide: RefundVouchersGateway, useValue: refunds },
			{ provide: LedgerGateway, useValue: { chart } },
		],
	});
	const popup = TestBed.createComponent(OrderStatusPopup).componentInstance;
	return { popup, orders, refunds, chart, close };
}

describe('Update status (st01–st05)', () => {
	it('starts on the first allowed step and says what the customer will be told', () => {
		const { popup } = setup();
		expect(popup.toldLine()).toBeNull();
		popup.start(
			detail({
				allowedNext: [
					option('packed', { allowed: false, reason: 'addInvoiceAddressFirst' }),
					option('processing'),
					option('shipped'),
					option('delivered'),
					option('cancelled'),
				],
			}),
		);
		expect(popup.to()).toBe('processing');
		expect(popup.toldLine()).toContain('ord_told_nothing_for');
		popup.to.set(null);
		expect(popup.toldLine()).toContain('ord_told_add_invoice_first');
		for (const [to, key] of [
			['shipped', 'ord_told_shipped'],
			['delivered', 'ord_told_delivered'],
		] as const) {
			popup.to.set(to);
			expect(popup.toldLine()).toContain(key);
		}
		popup.to.set('cancelled');
		expect(popup.toldLine()).toBeNull();
		const blocked = setup().popup;
		blocked.start(detail({ allowedNext: [option('packed', { allowed: false })] }));
		expect([blocked.to(), blocked.toldLine()]).toEqual([null, null]);
	});

	it('hints until when an order can be cancelled, and what cancelling an unpaid order does', () => {
		const { popup } = setup();
		expect(popup.cancelHint()).toBeNull();
		for (const status of ['placed', 'processing', 'packed']) {
			popup.start(detail({ status }));
			expect(!!popup.cancelHint()).toBe(status !== 'packed');
		}
		expect(popup.cancelView()).toBeNull();
		popup.to.set('cancelled');
		for (const [lines, key] of [
			[[1], 'ord_cancel_stock_one'],
			[[1, 1], 'ord_cancel_stock_two'],
			[[2, 3], 'ord_cancel_stock_other'],
		] as const) {
			popup.start(detail({ lines: [...lines] }));
			popup.to.set('cancelled');
			expect(popup.cancelView()).toMatchObject({ refund: null, stock: expect.stringContaining(key) });
		}
		popup.start(detail({ payments: [{ ...gatewayPayment, method: 'upi', gateway: null }] }));
		popup.to.set('cancelled');
		expect(popup.cancelView()?.refund).toContain('ord_cancel_refund_manual');
		popup.start(detail({ payments: [gatewayPayment] }));
		popup.to.set('cancelled');
		expect(popup.cancelView()?.refund).toContain('ord_cancel_refund_gateway');
	});

	it('asks for what each step needs before it can be saved', () => {
		const { popup } = setup();
		expect(popup.canSave()).toBe(false);
		popup.start(detail({ allowedNext: [option('shipped', { needs: ['courier'] }), option('delivered')] }));
		expect(popup.needs('courier')).toBe(true);
		expect(popup.needs('proof')).toBe(false);
		expect(popup.canSave()).toBe(false);
		popup.courierName.set('DTDC');
		popup.trackingNumber.set('D475');
		expect(popup.canSave()).toBe(true);
		popup.to.set('delivered');
		expect(popup.canSave()).toBe(true);
		popup.deliveredOn.set('');
		expect(popup.canSave()).toBe(false);
		popup.to.set('cancelled');
		expect(popup.needs('courier')).toBe(false);
		popup.busy.set(true);
		popup.to.set('delivered');
		expect(popup.canSave()).toBe(false);
		expect(indiaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('saves each step with its fields', async () => {
		const shipped = setup();
		shipped.popup.start(detail({ allowedNext: [option('shipped')] }));
		await shipped.popup.save();
		expect(shipped.orders.changeStatus).not.toHaveBeenCalled();
		shipped.popup.courierName.set(' DTDC ');
		shipped.popup.trackingNumber.set('D475');
		await shipped.popup.save();
		expect(shipped.orders.changeStatus).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({
				to: 'shipped',
				shipped: expect.objectContaining({ courierName: 'DTDC', trackingUrl: null }),
				delivered: null,
				cancel: null,
				revision: 4,
			}),
		);
		shipped.popup.trackingUrl.set('https://track.example/D475');
		shipped.popup.comment.set(' Sent ');
		await shipped.popup.save();
		expect(shipped.orders.changeStatus).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({
				comment: 'Sent',
				shipped: expect.objectContaining({ trackingUrl: 'https://track.example/D475' }),
			}),
		);
		const delivered = setup();
		delivered.popup.start(detail({ allowedNext: [option('delivered')] }));
		delivered.popup.receivedBy.set('Ananya');
		await delivered.popup.save();
		expect(delivered.orders.changeStatus).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({
				delivered: expect.objectContaining({ receivedBy: 'Ananya', podReference: null }),
			}),
		);
		delivered.popup.receivedBy.set('');
		delivered.popup.podReference.set('POD-1');
		await delivered.popup.save();
		const cancelled = setup();
		cancelled.popup.start(detail({ allowedNext: [option('cancelled')] }));
		cancelled.popup.cancelNote.set('Asked by phone');
		await cancelled.popup.save();
		expect(cancelled.orders.changeStatus).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({ cancel: { reason: 'customerAsked', note: 'Asked by phone' } }),
		);
		expect(cancelled.close).toHaveBeenCalledWith({ id: 'ord_1' });
		const none = setup();
		await none.popup.save();
		expect(none.orders.changeStatus).not.toHaveBeenCalled();
	});

	it('says why a step was refused, in words when it knows the refusal', async () => {
		for (const [message, shown] of [
			['invoice_problem:no_hsn:BAN-3', 'inv_problem_no_hsn'],
			['refund_needs_cash_or_bank', 'rf_problem_refund_needs_cash_or_bank'],
			['Someone else changed the order', 'Someone else changed the order'],
		]) {
			const { popup } = setup({ error: { error: { message } } });
			popup.start(detail({ allowedNext: [option('processing')] }));
			await popup.save();
			expect(popup.error()).toContain(shown);
			expect(popup.busy()).toBe(false);
		}
	});
});

describe('Cancel and refund a paid order (C1)', () => {
	it('refunds through the gateway when every payment came that way', async () => {
		const { popup, refunds, close, chart } = setup();
		popup.start(detail({ payments: [gatewayPayment, { ...gatewayPayment, id: 'pay_x', receiptNumber: null }] }));
		popup.to.set('cancelled');
		expect(popup.refunding()).toMatchObject({ paidINR: 2_600, receipts: 'RC/26-27/000013', viaGateway: true });
		expect([popup.refundsOnCancel(), popup.refundHow(), popup.canSave()]).toEqual([true, 'gateway', true]);
		await popup.save();
		expect(refunds.cancelAndRefund).toHaveBeenCalledWith('ord_1', {
			comment: null,
			cancel: { reason: 'customerAsked', note: null },
			revision: 4,
			refund: { how: 'gateway' },
		});
		expect(close).toHaveBeenCalledWith([{ id: 'rf_1' }]);
		expect(chart).not.toHaveBeenCalled();
	});

	it('offers only a bank transfer for money that didn’t come by the gateway, from a cash or bank ledger', async () => {
		const { popup, refunds, chart } = setup();
		popup.start(detail({ payments: [{ ...gatewayPayment, method: 'upi', gateway: null }] }));
		await vi.waitFor(() => expect(popup.payFrom().map((l) => l.id)).toEqual(['led_hdfc']));
		popup.to.set('cancelled');
		expect([popup.refunding().viaGateway, popup.refundHow(), popup.canSave()]).toEqual([
			false,
			'bank_transfer',
			false,
		]);
		popup.refundLedger.set('led_hdfc');
		popup.refundReference.set(' NEFT0001 ');
		expect(popup.canSave()).toBe(true);
		await popup.chooseRefund('bank_transfer');
		expect(chart).toHaveBeenCalledTimes(1);
		await popup.save();
		expect(refunds.cancelAndRefund).toHaveBeenCalledWith(
			'ord_1',
			expect.objectContaining({ refund: { how: 'bank_transfer', ledgerId: 'led_hdfc', reference: 'NEFT0001' } }),
		);
		await popup.chooseRefund('gateway');
		expect(popup.refundHow()).toBe('gateway');
		const unpaid = setup().popup;
		expect(unpaid.refunding()).toMatchObject({ paidINR: 0, viaGateway: false });
		unpaid.start(detail({ payments: [{ ...gatewayPayment, amountINR: 0 }] }));
		expect([unpaid.refunding().viaGateway, unpaid.refundsOnCancel()]).toEqual([false, false]);
	});
});
