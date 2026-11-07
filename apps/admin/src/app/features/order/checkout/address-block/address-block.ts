import { Component, output, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/** Display shape for checkout address cards (mock IUserAddress or live Customer Address). */
export interface CheckoutAddressView {
	id: string | number;
	title?: string;
	street?: string;
	city?: string;
	state?: { name?: string } | null;
	country?: { name?: string } | null;
	pincode?: string | number;
	phone?: string | number;
}

@Component({
	selector: 'app-address-block',
	templateUrl: './address-block.html',
	styleUrls: ['./address-block.scss'],
	imports: [TranslocoModule],
})
export class AddressBlock {
	readonly addresses = input<CheckoutAddressView[]>([]);
	readonly type = input<string>('shipping');
	/** When true, each card shows a delete control (CRM edit). Checkout leaves this false. */
	readonly deletable = input(false);

	readonly selectAddress = output<string | number>();
	readonly deleteAddress = output<string | number>();

	constructor() {}

	set(event: Event) {
		const value = (<HTMLInputElement>event.target)?.value;
		const asNumber = Number(value);
		this.selectAddress.emit(Number.isNaN(asNumber) || String(asNumber) !== value ? value : asNumber);
	}

	remove(event: Event, id: string | number) {
		event.preventDefault();
		event.stopPropagation();
		this.deleteAddress.emit(id);
	}
}
