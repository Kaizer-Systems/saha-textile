import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { GeoGateway, injectGeoCountryQuery } from '@core/geo/geo.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';

import type { Order, PhoneNumber } from '@saha-textile/contracts';

/** How staff got the address; stored as the code, shown in the page's language. */
export const INVOICE_CONFIRMED_HOW = ['phoneCall', 'email', 'message', 'inPerson'] as const;
export type InvoiceConfirmedHow = (typeof INVOICE_CONFIRMED_HOW)[number];

/**
 * Add invoice address (shipping brief od04, approved 19 Nov): name, street, city, State and a 6-digit
 * PIN code in India, and how it was confirmed. Used only on the GST invoice; the parcel still goes to
 * the delivery address. The server checks it against the country data (State list, PIN directory).
 */
@Component({
	selector: 'app-order-invoice-address-popup',
	templateUrl: './order-invoice-address-popup.html',
	imports: [FormsModule, TranslocoModule],
})
export class OrderInvoiceAddressPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly geo = inject(GeoGateway);
	private readonly transloco = inject(TranslocoService);

	readonly india = injectGeoCountryQuery(() => 'IN');
	readonly states = computed(() => this.india.data()?.subdivisions ?? []);
	readonly confirmedChoices = INVOICE_CONFIRMED_HOW;

	readonly order = signal<Order | null>(null);
	readonly fullName = signal('');
	readonly line1 = signal('');
	readonly city = signal('');
	readonly subdivisionCode = signal('');
	readonly postalCode = signal('');
	readonly confirmedHow = signal<InvoiceConfirmedHow>('phoneCall');
	/** The order's own mobile goes with the address (the form in od04 doesn't ask for one). */
	readonly mobile = signal<PhoneNumber | null>(null);
	readonly mobileText = signal('');
	readonly pinNote = signal<'found' | 'unknown' | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	readonly pinShapeWrong = computed(() => {
		const pin = this.postalCode().trim();
		return pin.length > 0 && !/^\d{6}$/.test(pin);
	});

	start(order: Order): void {
		this.order.set(order);
		const addresses = order.addresses;
		const given = addresses?.addressInIndia;
		this.fullName.set(given?.fullName ?? addresses?.billing.fullName ?? order.buyer?.name ?? '');
		this.line1.set(given?.line1 ?? '');
		this.city.set(given?.city ?? '');
		this.subdivisionCode.set(given?.subdivisionCode ?? '');
		this.postalCode.set(given?.postalCode ?? '');
		this.mobile.set(addresses?.delivery.mobile ?? addresses?.billing.mobile ?? given?.mobile ?? null);
	}

	/** A full PIN fills the city and State from India Post's directory. */
	async lookUpPin(text: string): Promise<void> {
		this.postalCode.set(text);
		this.pinNote.set(null);
		const pin = text.trim();
		if (!/^\d{6}$/.test(pin)) return;
		try {
			const found = await firstValueFrom(this.geo.pin(pin));
			if (pin !== this.postalCode().trim() || !found) return;
			if (!found.found) {
				this.pinNote.set('unknown');
				return;
			}
			if (found.subdivisionCode) this.subdivisionCode.set(found.subdivisionCode);
			if (found.city && !this.city().trim()) this.city.set(found.city);
			this.pinNote.set('found');
		} catch {
			// The lookup only helps; the server checks the PIN on save.
		}
	}

	canSave(): boolean {
		return (
			!this.busy() &&
			!!this.fullName().trim() &&
			!!this.line1().trim() &&
			!!this.city().trim() &&
			!!this.subdivisionCode() &&
			/^\d{6}$/.test(this.postalCode().trim()) &&
			(!!this.mobile() || /^\d{10}$/.test(this.mobileText().replace(/\D/g, '')))
		);
	}

	async save(): Promise<void> {
		const order = this.order();
		if (!order || !this.canSave()) return;
		const state = this.states().find((row) => row.code === this.subdivisionCode());
		const mobile = this.mobile() ?? { countryCallingCode: '91', number: this.mobileText().replace(/\D/g, '') };
		this.busy.set(true);
		this.error.set(null);
		try {
			const saved = await firstValueFrom(
				this.gateway.setInvoiceAddress(order.id, {
					address: {
						fullName: this.fullName().trim(),
						line1: this.line1().trim(),
						city: this.city().trim(),
						state: state?.name,
						subdivisionCode: this.subdivisionCode(),
						postalCode: this.postalCode().trim(),
						countryCode: 'IN',
						mobile,
					},
					confirmedHow: this.confirmedHow(),
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
