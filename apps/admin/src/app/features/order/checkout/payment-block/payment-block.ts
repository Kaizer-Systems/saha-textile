import { Component, output } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

@Component({
	selector: 'app-payment-block',
	templateUrl: './payment-block.html',
	styleUrls: ['./payment-block.scss'],
	imports: [TranslateModule],
})
export class PaymentBlock {
	readonly selectPaymentMethod = output<string>();

	constructor() {}

	set(value: string) {
		this.selectPaymentMethod.emit(value);
	}
}
