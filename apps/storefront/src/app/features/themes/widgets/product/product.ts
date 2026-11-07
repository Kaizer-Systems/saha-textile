import { NgClass } from '@angular/common';
import { Component, effect, inject, input } from '@angular/core';

import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';

import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';

import * as data from '../../../../shared/data/owl-carousel';

@Component({
	selector: 'app-theme-product',
	templateUrl: './product.html',
	styleUrls: ['./product.scss'],
	imports: [SkeletonProductBox, ProductBox, CarouselModule, NgClass, NgClass],
})
export class Product {
	productService = inject(ProductService);

	readonly style = input<string>('vertical');
	readonly boxClass = input<string>();
	readonly productStyle = input<string>('product-modern');
	readonly layout = input<string>();
	readonly sliderOption = input<OwlOptions>(data.productSlider);
	readonly slider = input<boolean>();
	readonly showItem = input<number>();
	/** The cards this rail shows. */
	readonly supplied = input<IProduct[] | null>(null);
	/** `first` marks the leading image high and the rest of the row low. `below` is lazy. */
	readonly fold = input<'first' | 'below'>('below');
	readonly loading = input(false);

	public products: IProduct[] = [];

	public skeletonItems = Array.from({ length: 6 }, (_, index) => index);

	constructor() {
		effect(() => {
			const supplied = this.supplied();
			if (this.loading()) {
				this.productService.skeletonLoader = true;
				return;
			}
			this.products = supplied ?? [];
			this.productService.skeletonLoader = false;
		});
	}

	priority(index: number): 'high' | 'low' | 'lazy' {
		if (this.fold() !== 'first') return 'lazy';
		return index === 0 ? 'high' : 'low';
	}
}
