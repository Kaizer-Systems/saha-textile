import { HttpClient } from '@angular/common/http';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoGateway } from '@core/geo/geo.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderClosePopup } from './order-close-popup';
import { OrderEDocPopup } from './order-edoc-popup';
import { OrderInvoiceAddressPopup } from './order-invoice-address-popup';
import { OrderRequestPopup } from './order-request-popup';
import { OrderSendPopup } from './order-send-popup';
import { OrderShipsFromCard } from './order-ships-from';

const h = vi.hoisted(() => ({ india: undefined as unknown, code: null as null | (() => unknown) }));
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: (code: () => unknown) => {
		h.code = code;
		return { data: () => h.india };
	},
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;
const refused = { error: { issues: [{ code: 'x', message: 'Refused here' }] } };

function make<T>(type: Type<T>, gateway: Record<string, unknown> = {}, options: { lang?: string } = {}) {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const geo = { pin: vi.fn(() => of(null)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: GeoGateway, useValue: geo },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => options.lang ?? 'en' } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return { c: TestBed.createComponent(type).componentInstance, modal, geo };
}

const order = (over: Record<string, unknown> = {}) =>
	({
		id: 'ord_1',
		revision: 3,
		currency: 'INR',
		buyer: { name: 'Asha Roy', gstin: null },
		addresses: null,
		...over,
	}) as never;
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
	vi.useRealTimers();
	h.india = undefined;
});

describe('Close an open order: the last cases', () => {
	it('words the shipping from the trace in each language, and nothing without one', async () => {
		const trace = [JSON.stringify({ result: 'free', lineIds: ['a'], units: 2 })];
		const preview = { dueINR: 0, shippingTrace: trace, problem: null };
		const en = make(OrderClosePopup, { closePreview: vi.fn(() => of(preview)) });
		expect(en.c.shipWhy()).toBe('');
		expect(en.c.nothingDue()).toBe(true);
		await en.c.start(order());
		expect(en.c.shipWhy()).toBe('ord_ship_more_free(2)');
		const bn = make(OrderClosePopup, { closePreview: vi.fn(() => of(preview)) }, { lang: 'bn' });
		await bn.c.start(order());
		expect(bn.c.shipWhy()).toBe('Ord_ship_more_free(2)');
		bn.c.preview.set({ dueINR: 5, shippingTrace: ['not json'] } as never);
		expect(bn.c.shipWhy()).toBe('');
		expect(bn.c.nothingDue()).toBe(false);
	});

	it('says why the preview or the close failed, and closes nothing before it starts', async () => {
		const gateway = {
			closePreview: vi.fn(() => throwError(() => refused)),
			closeOpen: vi.fn(() => throwError(() => refused)),
		};
		const { c } = make(OrderClosePopup, gateway);
		await c.close();
		expect(gateway.closeOpen).not.toHaveBeenCalled();
		await c.start(order());
		expect(c.error()).toBe('Refused here');
		c.preview.set({ dueINR: 0, problem: null } as never);
		c.then.set('recordLater');
		await c.close();
		expect(c.error()).toBe('Refused here');
		expect(c.busy()).toBe(false);
	});
});

describe('By-hand e-invoice and e-way bill: the last cases', () => {
	const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const IRN = 'A'.repeat(64);
	const signed = (payload: unknown) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`;
	const file = (body: unknown) => new File([JSON.stringify(body)], 'signed.json', { type: 'application/json' });

	it('reads no file, a file with no IRN, and a file with no acknowledgement or odd QR payloads', async () => {
		const { c } = make(OrderEDocPopup);
		c.start(order({ buyer: { gstin: '27AAKFR1234M1Z2' } }), 'eInvoice');
		await c.readSignedFile(null);
		expect(c.fileName()).toBeNull();
		await c.readSignedFile(file({ Data: { AckNo: 1 } }));
		expect(c.fileProblem()).toBe('ord_signed_file_no_irn');
		for (const qr of [
			'nodot',
			'a.!!!.b',
			signed({ data: 5 }),
			signed({ data: { BuyerGstin: '27AAKFR1234M1Z2' } }),
		]) {
			await c.readSignedFile(file({ data: { Irn: IRN, SignedQRCode: qr } }));
			expect(c.fileProblem()).toBeNull();
			expect(c.ackNo()).toBe('');
		}
		expect(c.signedQr()).toContain('.sig');
	});

	it('checks and saves an e-invoice, and an e-way bill with and without its optional parts', async () => {
		const gateway = {
			setEInvoice: vi.fn(() => of({ ok: true })),
			setEWayBill: vi.fn(() => of({ ok: true })),
		};
		const { c, modal } = make(OrderEDocPopup, gateway);
		await c.save();
		expect(gateway.setEInvoice).not.toHaveBeenCalled();
		c.start(order(), 'eInvoice');
		expect(c.canSave()).toBe(false);
		c.irn.set(IRN);
		c.ackNo.set(' 1124 ');
		expect(c.irnValid()).toBe(true);
		expect(c.canSave()).toBe(true);
		c.busy.set(true);
		expect(c.canSave()).toBe(false);
		c.busy.set(false);
		await c.save();
		expect(gateway.setEInvoice).toHaveBeenCalledWith(
			'ord_1',
			expect.objectContaining({ ackNo: '1124', signedQr: null }),
		);
		c.signedQr.set(' qr ');
		await c.save();
		expect(gateway.setEInvoice).toHaveBeenLastCalledWith('ord_1', expect.objectContaining({ signedQr: 'qr' }));
		expect(modal.close).toHaveBeenCalledWith({ ok: true });
		c.start(order(), 'eWayBill');
		c.ewbNumber.set('1234 5678 9012');
		c.generatedOn.set('2026-11-20');
		c.validUntil.set('2026-11-19');
		expect(c.ewbValid()).toBe(true);
		expect(c.canSave()).toBe(false);
		c.validUntil.set('2026-11-21');
		await c.save();
		expect(gateway.setEWayBill).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({
				number: '123456789012',
				transporterName: null,
				transporterId: null,
				vehicleOrDocumentNo: null,
				distanceKm: null,
			}),
		);
		c.transporterName.set(' Blue Dart ');
		c.transporterId.set(' 27AAA ');
		c.vehicleOrDocumentNo.set(' WB01 ');
		c.distanceKm.set('12');
		await c.save();
		expect(gateway.setEWayBill).toHaveBeenLastCalledWith(
			'ord_1',
			expect.objectContaining({
				transporterName: 'Blue Dart',
				transporterId: '27AAA',
				vehicleOrDocumentNo: 'WB01',
				distanceKm: 12,
			}),
		);
		gateway.setEWayBill.mockReturnValueOnce(throwError(() => refused) as never);
		await c.save();
		expect(c.error()).toBe('Refused here');
	});
});

describe('Invoice address: the last cases', () => {
	it('asks for India’s States, and fills from the order’s billing name, the buyer or nothing', () => {
		const { c } = make(OrderInvoiceAddressPopup);
		expect(h.code?.()).toBe('IN');
		expect(c.states()).toEqual([]);
		const mobile = { countryCallingCode: '91', number: '9800000000' };
		c.start(order({ addresses: { billing: { fullName: 'Billing Name', mobile }, delivery: {} } }));
		expect([c.fullName(), c.mobile()]).toEqual(['Billing Name', mobile]);
		c.start(order({ addresses: { billing: {}, delivery: {}, addressInIndia: { mobile } } }));
		expect([c.fullName(), c.mobile()]).toEqual(['Asha Roy', mobile]);
		c.start(order({ buyer: null, addresses: { billing: {}, delivery: {} } }));
		expect([c.fullName(), c.mobile()]).toEqual(['', null]);
	});

	it('a PIN answer that came too late, none at all, or with no State or with a city already typed', async () => {
		const { c, geo } = make(OrderInvoiceAddressPopup);
		const late = new Subject<unknown>();
		geo.pin.mockReturnValueOnce(late as never);
		const first = c.lookUpPin('700026');
		c.postalCode.set('700027');
		late.next({ found: true, city: 'Kolkata', subdivisionCode: 'WB' });
		late.complete();
		await first;
		expect(c.pinNote()).toBeNull();
		await c.lookUpPin('700026');
		expect(c.pinNote()).toBeNull();
		c.city.set('Howrah');
		geo.pin.mockReturnValueOnce(of({ found: true, city: 'Kolkata', subdivisionCode: null }) as never);
		await c.lookUpPin('700026');
		expect([c.city(), c.subdivisionCode(), c.pinNote()]).toEqual(['Howrah', '', 'found']);
	});

	it('saves with a typed mobile, says why a save failed, and saves nothing before it starts', async () => {
		const gateway = { setInvoiceAddress: vi.fn(() => throwError(() => refused)) };
		const { c } = make(OrderInvoiceAddressPopup, gateway);
		await c.save();
		expect(gateway.setInvoiceAddress).not.toHaveBeenCalled();
		c.start(order({ addresses: { billing: {}, delivery: {} } }));
		c.line1.set('1 College Street');
		c.city.set('Kolkata');
		c.subdivisionCode.set('WB');
		c.postalCode.set('700073');
		expect(c.canSave()).toBe(false);
		c.mobileText.set('98000 00000');
		expect(c.canSave()).toBe(true);
		await c.save();
		expect(gateway.setInvoiceAddress).toHaveBeenCalledWith(
			'ord_1',
			expect.objectContaining({
				address: expect.objectContaining({ mobile: { countryCallingCode: '91', number: '9800000000' } }),
			}),
		);
		expect(c.error()).toBe('Refused here');
	});
});

describe('Request payment: the last cases', () => {
	const preview = (over: Record<string, unknown> = {}) => ({
		dueINR: 1200,
		validDays: 5,
		currencies: [{ code: 'INR', symbol: '₹' }],
		problem: null,
		rateFromINR: null,
		...over,
	});

	it('offers the order’s own number of days, reads where the buyer is billed, and names the buyer', async () => {
		const { c } = make(OrderRequestPopup, { previewRequest: vi.fn(() => of(preview())) });
		await c.start(order({ currency: undefined, addresses: { billing: { country: 'in' } } }), null, 0);
		expect(c.currency()).toBe('INR');
		expect(c.dayChoices()).toEqual([1, 3, 5, 7, 14, 30]);
		expect(c.billedInIndia()).toBe(true);
		expect(c.buyerName()).toBe('Asha Roy');
		c.order.set(order({ buyer: null, addresses: { billing: { fullName: 'Billing Name' } } }));
		expect(c.buyerName()).toBe('Billing Name');
		c.order.set(order({ buyer: null }));
		expect([c.billedInIndia(), c.buyerName()]).toEqual([false, '']);
		c.currency.set('USD');
		expect(c.symbol()).toBe('USD');
		expect(c.money(10, 'INR')).toContain('10');
		expect(make(OrderRequestPopup, {}, { lang: 'bn' }).c.money(10, 'INR')).toContain('10');
	});

	it('asks again after typing stops, keeps only the newest answer, and falls back to rupees when the currency is gone', async () => {
		vi.useFakeTimers();
		const previewRequest = vi.fn(() => of(preview({ currencies: [{ code: 'INR', symbol: '₹' }] })));
		const { c } = make(OrderRequestPopup, { previewRequest });
		c.changeCurrency('USD');
		expect(previewRequest).not.toHaveBeenCalled();
		await c.start(order({ currency: 'USD' }), null, 0);
		expect(c.currency()).toBe('INR');
		const asked = previewRequest.mock.calls.length;
		c.changeAmount('100');
		c.changeAmount('150');
		await vi.advanceTimersByTimeAsync(350);
		expect(previewRequest).toHaveBeenCalledTimes(asked + 1);
		const slow = new Subject<unknown>();
		const failing = new Subject<unknown>();
		previewRequest.mockReturnValueOnce(slow as never).mockReturnValueOnce(failing as never);
		c.changeCurrency('INR');
		c.changeCurrency('INR');
		slow.next(preview({ dueINR: 1 }));
		slow.complete();
		await flush();
		expect(c.loading()).toBe(true);
		failing.error(refused);
		await flush();
		expect(c.error()).toBe('Refused here');
		expect(c.loading()).toBe(false);
		const stale = new Subject<unknown>();
		previewRequest.mockReturnValueOnce(stale as never);
		c.changeCurrency('INR');
		c.changeCurrency('INR');
		stale.error(refused);
		await flush();
		expect(c.loading()).toBe(false);
	});

	it('sends nothing before it starts, and says why a request was refused', async () => {
		const gateway = {
			previewRequest: vi.fn(() => of(preview())),
			requestPayment: vi.fn(() => throwError(() => refused)),
		};
		const { c } = make(OrderRequestPopup, gateway);
		await c.send();
		expect(gateway.requestPayment).not.toHaveBeenCalled();
		await c.start(order(), null, 0);
		await c.send();
		expect(c.error()).toBe('Refused here');
	});
});

describe('Send as SMS or email', () => {
	const request = { id: 'req_1', amountINR: 1200 } as never;

	it('shows the message the server built, to whom, and sends it', async () => {
		const gateway = {
			requestMessage: vi.fn(() => of({ to: '+91 98000 00000', text: 'Pay here', unavailable: null })),
			sendRequestMessage: vi.fn(() => of({ status: 'sent' })),
		};
		const { c, modal } = make(OrderSendPopup, gateway);
		expect([c.ready(), c.toLine(), c.amount()]).toEqual([false, '—', '₹0']);
		await c.send();
		expect(gateway.sendRequestMessage).not.toHaveBeenCalled();
		await c.start(order(), request, 'sms');
		expect(c.ready()).toBe(true);
		expect(c.toLine()).toBe('ord_send_to_billing(+91 98000 00000|Asha Roy)');
		expect(c.amount()).toBe('₹1,200');
		c.order.set(order({ buyer: null }));
		expect(c.toLine()).toBe('+91 98000 00000');
		c.channel.set('email');
		expect(c.toLine()).toBe('+91 98000 00000');
		await c.send();
		expect(gateway.sendRequestMessage).toHaveBeenCalledWith('ord_1', 'req_1', 'email');
		expect(modal.close).toHaveBeenCalledWith({ status: 'sent' });
	});

	it('cannot send a message the server says cannot go, and says why reading or sending failed', async () => {
		const gateway = {
			requestMessage: vi.fn(() => of({ to: 'a@b.test', text: '', unavailable: 'no_mobile' })),
			sendRequestMessage: vi.fn(() => throwError(() => refused)),
		};
		const { c } = make(OrderSendPopup, gateway);
		await c.start(order(), request, 'sms');
		expect(c.ready()).toBe(false);
		await c.send();
		expect(gateway.sendRequestMessage).not.toHaveBeenCalled();
		c.preview.set({ to: 'a@b.test', text: 'x', unavailable: null } as never);
		await c.send();
		expect(c.error()).toBe('Refused here');
		expect(c.busy()).toBe(false);
		gateway.requestMessage.mockReturnValueOnce(throwError(() => refused) as never);
		await c.start(order(), request, 'email');
		expect(c.error()).toBe('Refused here');
	});
});

describe('Ships from', () => {
	const view = {
		current: 'loc_wb',
		revision: 2,
		locations: [{ id: 'loc_wb', name: 'Kolkata store' }],
		candidates: [{ locationId: 'loc_wb', has: 2, of: 3 }],
	};

	function card(post: () => unknown, permissions = ['order.edit']) {
		const http = { get: vi.fn(() => of(view)), post: vi.fn(post) };
		const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
		const modalRef = { close: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: HttpClient, useValue: http },
				{ provide: NgbModal, useValue: { open: vi.fn(() => modalRef) } },
				{ provide: NotificationService, useValue: notifier },
				{ provide: TranslocoService, useValue: { translate: t } },
				{ provide: AuthStore, useValue: { permissions: () => permissions } },
			],
		});
		TestBed.overrideComponent(OrderShipsFromCard, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(OrderShipsFromCard);
		fixture.componentRef.setInput('orderId', 'ord_1');
		fixture.detectChanges();
		return { c: fixture.componentInstance, http, notifier, modalRef };
	}

	it('names where it ships from, what each place has, and saves a new choice', async () => {
		const { c, http, notifier, modalRef } = card(() => of({}));
		expect(c.currentName()).toBeNull();
		expect(c.has('loc_wb')).toEqual({ has: 0, of: 0 });
		c.open({} as never);
		expect(c.choice()).toBe('');
		await c.assign();
		expect(http.post).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(c.currentName()).toBe('Kolkata store'));
		expect(c.canAssign()).toBe(true);
		expect(c.has('loc_wb')).toEqual({ has: 2, of: 3 });
		expect(c.has('elsewhere')).toEqual({ has: 0, of: 0 });
		c.open({} as never);
		expect(c.choice()).toBe('loc_wb');
		c.choice.set('');
		await c.assign();
		expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/admin/orders/ord_1/ships-from'), {
			locationId: null,
			revision: 2,
			reason: '',
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('ships_from_saved');
		expect(modalRef.close).toHaveBeenCalled();
	});

	it('says why a choice was refused', async () => {
		for (const [message, key] of [
			['order_changed', 'ships_from_changed'],
			['location_out_of_scope', 'ships_from_out_of_scope'],
			['other', 'ships_from_failed'],
		]) {
			const { c, notifier } = card(() => throwError(() => ({ error: { error: { message } } })), []);
			await vi.waitFor(() => expect(c.currentName()).toBe('Kolkata store'));
			expect(c.canAssign()).toBe(false);
			await c.assign();
			expect(notifier.showError).toHaveBeenCalledWith(key);
			expect(c.saving()).toBe(false);
		}
		const { c, notifier } = card(() => throwError(() => new Error('down')));
		await vi.waitFor(() => expect(c.currentName()).toBe('Kolkata store'));
		await c.assign();
		expect(notifier.showError).toHaveBeenCalledWith('ships_from_failed');
	});
});
