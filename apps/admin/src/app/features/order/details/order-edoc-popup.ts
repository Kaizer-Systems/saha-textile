import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';

import { indiaToday } from './order-status-popup';

import type { Order } from '@saha-textile/contracts';

/** A date typed in the form (India) as the API takes it: the start of that day in India. */
const indiaDayStart = (day: string): string => new Date(`${day}T00:00:00+05:30`).toISOString();

/**
 * Raise e-invoice / Raise e-way bill, the manual fallback (owner 2026-11-20): until an integration
 * exists the details come from the government portals and are typed here. E-invoice: the 64-character
 * IRN, Ack No, Ack date and the signed QR (optional). E-way bill: the 12-digit number, generated on,
 * valid until, transporter, vehicle or transport document and distance.
 */
@Component({
	selector: 'app-order-edoc-popup',
	templateUrl: './order-edoc-popup.html',
	imports: [FormsModule, TranslocoModule],
})
export class OrderEDocPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly order = signal<Order | null>(null);
	readonly kind = signal<'eInvoice' | 'eWayBill'>('eInvoice');
	readonly today = indiaToday();
	/* e-invoice */
	readonly irn = signal('');
	readonly ackNo = signal('');
	readonly ackDate = signal(indiaToday());
	readonly signedQr = signal('');
	/* e-way bill */
	readonly ewbNumber = signal('');
	readonly generatedOn = signal(indiaToday());
	readonly validUntil = signal(indiaToday());
	readonly transporterName = signal('');
	readonly transporterId = signal('');
	readonly vehicleOrDocumentNo = signal('');
	readonly distanceKm = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	start(order: Order, kind: 'eInvoice' | 'eWayBill'): void {
		this.order.set(order);
		this.kind.set(kind);
	}

	/** The file read from the portal (EI4B), and why it was refused. */
	readonly fileName = signal<string | null>(null);
	readonly fileProblem = signal<string | null>(null);

	/**
	 * The e-invoice portal's signed file (a JSON result, a {Data: …} wrapper or a list): fills the IRN,
	 * acknowledgement and signed QR, after checking the QR names this order's buyer GSTIN (accounts brief
	 * addendum 2, AE1). Typed numbers stay possible, but only the file carries the signed QR.
	 */
	async readSignedFile(file: File | null | undefined): Promise<void> {
		this.fileProblem.set(null);
		if (!file) return;
		this.fileName.set(file.name);
		try {
			const parsed: unknown = JSON.parse(await file.text());
			const list = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) => {
				const obj = item as Record<string, unknown>;
				return [obj, (obj?.['Data'] ?? obj?.['data']) as Record<string, unknown> | undefined].filter(
					Boolean,
				) as Record<string, unknown>[];
			});
			const found = list.find((c) => typeof c['Irn'] === 'string');
			if (!found) return this.fileProblem.set('ord_signed_file_no_irn');
			const qr = typeof found['SignedQRCode'] === 'string' ? found['SignedQRCode'] : '';
			if (!qr) return this.fileProblem.set('ord_signed_file_no_qr');
			const buyer = this.order()?.buyer?.gstin;
			const data = qrData(qr);
			if (buyer && data?.['BuyerGstin'] && data['BuyerGstin'] !== buyer)
				return this.fileProblem.set('ord_signed_file_other_buyer');
			this.irn.set(String(found['Irn']).toLowerCase());
			this.ackNo.set(String(found['AckNo'] ?? ''));
			const ackDay = String(found['AckDt'] ?? '').slice(0, 10);
			if (/^\d{4}-\d{2}-\d{2}$/.test(ackDay)) this.ackDate.set(ackDay);
			this.signedQr.set(qr);
		} catch {
			this.fileProblem.set('ord_signed_file_not_json');
		}
	}

	irnValid(): boolean {
		return /^[0-9a-fA-F]{64}$/.test(this.irn().trim());
	}

	ewbValid(): boolean {
		return /^(\d{12}|\d{14})$/.test(this.ewbNumber().replace(/\s+/g, ''));
	}

	canSave(): boolean {
		if (this.busy()) return false;
		if (this.kind() === 'eInvoice') return this.irnValid() && !!this.ackNo().trim() && !!this.ackDate();
		return (
			this.ewbValid() && !!this.generatedOn() && !!this.validUntil() && this.validUntil() >= this.generatedOn()
		);
	}

	async save(): Promise<void> {
		const order = this.order();
		if (!order || !this.canSave()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const saved =
				this.kind() === 'eInvoice'
					? await firstValueFrom(
							this.gateway.setEInvoice(order.id, {
								irn: this.irn().trim(),
								ackNo: this.ackNo().trim(),
								ackDate: indiaDayStart(this.ackDate()),
								signedQr: this.signedQr().trim() || null,
								revision: order.revision,
							}),
						)
					: await firstValueFrom(
							this.gateway.setEWayBill(order.id, {
								number: this.ewbNumber().replace(/\s+/g, ''),
								generatedOn: indiaDayStart(this.generatedOn()),
								validUntil: indiaDayStart(this.validUntil()),
								transporterName: this.transporterName().trim() || null,
								transporterId: this.transporterId().trim() || null,
								vehicleOrDocumentNo: this.vehicleOrDocumentNo().trim() || null,
								distanceKm: this.distanceKm().trim() ? Number(this.distanceKm()) : null,
								revision: order.revision,
							}),
						);
			this.modal.close(saved);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}

/** The data inside an IRP signed QR (a JWS whose payload's "data" is a JSON string). */
function qrData(jws: string): Record<string, unknown> | null {
	const part = jws.split('.')[1];
	if (!part) return null;
	try {
		const text = decodeURIComponent(
			atob(part.replace(/-/g, '+').replace(/_/g, '/'))
				.split('')
				.map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
				.join(''),
		);
		const payload = JSON.parse(text) as { data?: unknown };
		const data = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
		return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
