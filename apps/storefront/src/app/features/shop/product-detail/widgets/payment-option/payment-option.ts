import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

@Component({
	selector: 'app-payment-option',
	templateUrl: './payment-option.html',
	styleUrls: ['./payment-option.scss'],
	imports: [TranslocoModule],
})
export class PaymentOption {
	readonly product = input<IProduct>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly option = input<ISiteConfig | null>();
}
