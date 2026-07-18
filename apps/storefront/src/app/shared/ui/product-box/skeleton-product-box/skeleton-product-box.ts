import { Component, input } from '@angular/core';

@Component({
	selector: 'app-skeleton-product-box',
	templateUrl: './skeleton-product-box.html',
	styleUrls: ['./skeleton-product-box.scss'],
	imports: [],
})
export class SkeletonProductBox {
	readonly style = input<string>('horizontal');
}
