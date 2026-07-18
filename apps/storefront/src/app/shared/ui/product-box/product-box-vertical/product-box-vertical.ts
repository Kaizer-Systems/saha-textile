import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

@Component({
	selector: 'app-product-box-vertical',
	templateUrl: './product-box-vertical.html',
	styleUrls: ['./product-box-vertical.scss'],
	providers: [CurrencySymbolPipe],
	imports: [RouterLink, CurrencySymbolPipe],
})
export class ProductBoxVertical {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct>();
}
