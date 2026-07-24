import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';

@Component({
	selector: 'app-product-delivery-information',
	templateUrl: './product-delivery-information.html',
	styleUrls: ['./product-delivery-information.scss'],
	imports: [TranslocoModule],
})
export class ProductDeliveryInformation {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct | null>();
}
