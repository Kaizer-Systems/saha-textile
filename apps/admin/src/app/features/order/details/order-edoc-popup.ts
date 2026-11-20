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

	irnValid(): boolean {
		return /^[0-9a-fA-F]{64}$/.test(this.irn().trim());
	}

	ewbValid(): boolean {
		return /^\d{12}$/.test(this.ewbNumber().trim());
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
								number: this.ewbNumber().trim(),
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
