import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it } from 'vitest';

import { OrdersGateway } from '@core/orders/orders.gateway';

import { OrderEDocPopup } from './order-edoc-popup';

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const qr = (data: object) => `${b64url({ alg: 'RS256' })}.${b64url({ data: JSON.stringify(data), iss: 'NIC' })}.sig`;
const IRN = 'A'.repeat(64);

function setup(buyerGstin: string | null) {
	TestBed.configureTestingModule({
		imports: [OrderEDocPopup, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			{ provide: NgbActiveModal, useValue: { close: () => undefined, dismiss: () => undefined } },
			{ provide: OrdersGateway, useValue: {} },
		],
	});
	const popup = TestBed.createComponent(OrderEDocPopup).componentInstance;
	popup.start({ id: 'ord_1', buyer: { gstin: buyerGstin } } as never, 'eInvoice');
	return popup;
}
const file = (body: unknown) =>
	new File([typeof body === 'string' ? body : JSON.stringify(body)], 'signed.json', { type: 'application/json' });

describe('by-hand e-invoice popup: the portal’s signed file (addendum 2, EI4B)', () => {
	it('fills the IRN, acknowledgement and signed QR from the file', async () => {
		const popup = setup('27AAKFR1234M1Z2');
		const signed = qr({ BuyerGstin: '27AAKFR1234M1Z2', DocNo: 'TI/26-27/000125' });
		await popup.readSignedFile(
			file([{ AckNo: 112410123456789, AckDt: '2026-11-22 16:31:04', Irn: IRN, SignedQRCode: signed }]),
		);
		expect(popup.fileProblem()).toBeNull();
		expect(popup.irn()).toBe('a'.repeat(64));
		expect(popup.ackNo()).toBe('112410123456789');
		expect(popup.ackDate()).toBe('2026-11-22');
		expect(popup.signedQr()).toBe(signed);
	});
	it('refuses another buyer’s file, a file without a QR, and non-JSON', async () => {
		const popup = setup('27AAKFR1234M1Z2');
		await popup.readSignedFile(file({ Data: { Irn: IRN, SignedQRCode: qr({ BuyerGstin: '19AAACX0000X1Z5' }) } }));
		expect(popup.fileProblem()).toBe('ord_signed_file_other_buyer');
		await popup.readSignedFile(file({ Irn: IRN }));
		expect(popup.fileProblem()).toBe('ord_signed_file_no_qr');
		await popup.readSignedFile(file('not json'));
		expect(popup.fileProblem()).toBe('ord_signed_file_not_json');
		expect(popup.irn()).toBe('');
	});

	it('takes a 14-digit e-way bill number with spaces (NIC, 23 Nov 2026)', () => {
		const popup = setup(null);
		popup.ewbNumber.set('3410 1234 5512 70');
		expect(popup.ewbValid()).toBe(true);
		popup.ewbNumber.set('3410 1234 5512');
		expect(popup.ewbValid()).toBe(true);
		popup.ewbNumber.set('3410 1234 551');
		expect(popup.ewbValid()).toBe(false);
	});
});
