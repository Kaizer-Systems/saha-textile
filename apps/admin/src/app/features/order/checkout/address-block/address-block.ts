import { Component, output, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IUserAddress } from '@data-access/interfaces/user.interface';

@Component({
	selector: 'app-address-block',
	templateUrl: './address-block.html',
	styleUrls: ['./address-block.scss'],
	imports: [TranslateModule],
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
