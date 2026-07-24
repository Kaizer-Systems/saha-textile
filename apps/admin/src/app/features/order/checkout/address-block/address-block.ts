import { Component, output, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IUserAddress } from '@data-access/interfaces/user.interface';

@Component({
	selector: 'app-address-block',
	templateUrl: './address-block.html',
	styleUrls: ['./address-block.scss'],
	imports: [TranslocoModule],
})
export class AddressBlock {
	readonly addresses = input<IUserAddress[]>([]);
	readonly type = input<string>('shipping');

	readonly selectAddress = output<number>();

	constructor() {}

	set(event: Event) {
		this.selectAddress.emit(+(<HTMLInputElement>event.target)?.value);
	}
}
