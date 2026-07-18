import { Component, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-payment-block',
	templateUrl: './payment-block.html',
	styleUrls: ['./payment-block.scss'],
	imports: [TranslocoModule],
})
export class PaymentBlock {
	readonly selectPaymentMethod = output<string>();

	constructor() {}

	set(value: string) {
		this.selectPaymentMethod.emit(value);
	}
}
