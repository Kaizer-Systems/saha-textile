import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrdersGateway } from '@core/orders/orders.gateway';

import { OrderPaymentPopup } from './order-payment-popup';

/** Record payment on an order (ck03–ck05, oo03–oo05, od08), refused in words when the books can't take it (AP2). */

const order = { id: 'ord_1', revision: 4, totalINR: 4_680, openedAt: null, closedAt: null } as never;

function setup(options: { prefill?: 'fails'; save?: unknown } = {}) {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const gateway = {
		paymentPrefill: vi.fn(() =>
			options.prefill === 'fails' ? throwError(() => new Error('down')) : of({ amountINR: 2_000 }),
		),
		recordPayment: vi.fn(() => (options.save ? throwError(() => options.save) : of({ id: 'ord_1', paid: true }))),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			OrderPaymentPopup,
			TranslocoTestingModule.forRoot({
				langs: {
					en: {
						books_no_bank_received_by_bank: 'Set a bank account in Where money lands, then save again.',
					},
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: OrdersGateway, useValue: gateway },
		],
	});
	const fixture = TestBed.createComponent(OrderPaymentPopup);
	return { fixture, popup: fixture.componentInstance, modal, gateway };
}

describe('Record payment on an order', () => {
	it('opens at what is due, from the prefill, else the balance, else the total', async () => {
		const { fixture, popup } = setup();
		await popup.start(order);
		fixture.detectChanges();
		expect(popup.amount()).toBe('2000');
		const fallback = setup({ prefill: 'fails' });
		await fallback.popup.start({ ...(order as object), balance: { dueINR: 1_500 } } as never);
		expect(fallback.popup.amount()).toBe('1500');
		const bare = setup({ prefill: 'fails' });
		await bare.popup.start(order);
		expect(bare.popup.amount()).toBe('4680');
	});

	it('says what the amount does to the balance', async () => {
		const { popup } = setup();
		await popup.start(order);
		expect(popup.outcome()).toMatchObject({ tone: 'success', rest: '' });
		popup.amount.set('500');
		expect(popup.outcome()?.tone).toBe('warning');
		popup.amount.set('2500');
		expect(popup.outcome()?.tone).toBe('info');
		popup.amount.set('0');
		expect(popup.outcome()).toBeNull();
		popup.amount.set('abc');
		expect(popup.outcome()).toBeNull();
		popup.order.set({ ...(order as object), openedAt: '2026-11-20T05:00:00.000Z', closedAt: null } as never);
		popup.amount.set('2000');
		expect(popup.outcome()?.rest).toContain('ord_pay_rest_exact_open');
		popup.amount.set('2500');
		expect(popup.outcome()?.rest).toContain('ord_pay_rest_more_open');
	});

	it('saves only with an amount, a reference and a day, sending each way of paying', async () => {
		const { popup, gateway, modal } = setup();
		await popup.save();
		expect(gateway.recordPayment).not.toHaveBeenCalled();
		await popup.start(order);
		expect(popup.canSave()).toBe(false);
		await popup.save();
		expect(gateway.recordPayment).not.toHaveBeenCalled();
		popup.amount.set('');
		popup.reference.set('UTR 1');
		await popup.save();
		expect(gateway.recordPayment).not.toHaveBeenCalled();
		popup.amount.set('2000');
		popup.receivedOn.set('');
		expect(popup.canSave()).toBe(false);
		popup.receivedOn.set('2026-11-24');

		popup.method.set('bankTransfer');
		popup.received.set(false);
		popup.note.set('  part of the deposit ');
		await popup.save();
		expect(gateway.recordPayment).toHaveBeenLastCalledWith('ord_1', {
			method: 'bankTransfer',
			amountINR: 2_000,
			reference: 'UTR 1',
			receivedOn: '2026-11-24',
			received: false,
			note: 'part of the deposit',
			proofMediaId: null,
			collector: null,
			collectedBy: null,
			revision: 4,
		});
		expect(modal.close).toHaveBeenCalledWith({ id: 'ord_1', paid: true });

		popup.method.set('cashOnDelivery');
		popup.note.set('');
		await popup.save();
		expect(gateway.recordPayment).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({ received: true, note: null, collector: 'staff', collectedBy: null }),
		);
		popup.collectedBy.set(' Raju ');
		await popup.save();
		expect(gateway.recordPayment).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({ collectedBy: 'Raju' }),
		);
		popup.busy.set(true);
		expect(popup.canSave()).toBe(false);
	});

	it('shows why the books refused the payment in words, and any other refusal as it came', async () => {
		const refused = (message: string) => ({ error: { error: { issues: [{ code: message, message }] } } });
		const books = setup({ save: refused('money_lands_not_set:received_by_bank') });
		await books.popup.start(order);
		books.popup.reference.set('UTR 1');
		await books.popup.save();
		expect(books.popup.error()).toBe('Set a bank account in Where money lands, then save again.');
		expect(books.popup.busy()).toBe(false);
		const other = setup({ save: refused('order_changed') });
		await other.popup.start(order);
		other.popup.reference.set('UTR 1');
		await other.popup.save();
		expect(other.popup.error()).toBe('order_changed');
	});
});
