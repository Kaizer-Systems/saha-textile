import { Component, input } from '@angular/core';

import { IProduct } from '@data-access/interfaces/product.interface';

import { ProductBoxHorizontal } from './product-box-horizontal/product-box-horizontal';
import { ProductBoxVertical } from './product-box-vertical/product-box-vertical';

@Component({
	selector: 'app-product-box',
	templateUrl: './product-box.html',
	styleUrls: ['./product-box.scss'],
	imports: [ProductBoxVertical, ProductBoxHorizontal],
})
export class ProductBox {
	readonly product = input<IProduct>();
	readonly style = input<string>('horizontal');
	readonly class = input<string>();
	readonly close = input<boolean>(false);
	/** `high` is the one large image. `low` is the rest of the first row. `lazy` is below it. */
	readonly imagePriority = input<'high' | 'low' | 'lazy'>('lazy');
}
