import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { cardOffer } from '@core/catalog/card-offer';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

@Component({
	selector: 'app-product-box-vertical',
	templateUrl: './product-box-vertical.html',
	styleUrls: ['./product-box-vertical.scss'],
	providers: [CurrencySymbolPipe],
	imports: [RouterLink, CurrencySymbolPipe, TranslocoModule],
})
export class ProductBoxVertical {
	readonly product = input<IProduct>();
	readonly imagePriority = input<'high' | 'low' | 'lazy'>('lazy');
	readonly offer = cardOffer;
}
