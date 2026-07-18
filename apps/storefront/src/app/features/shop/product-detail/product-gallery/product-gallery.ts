import { Component, input, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgxImageZoomModule } from 'ngx-image-zoom';
import { CarouselComponent, CarouselModule } from 'ngx-owl-carousel-o';

import { IProduct } from '@data-access/interfaces/product.interface';
import * as data from '@shared/data/owl-carousel';

/**
 * Reusable PDP gallery (main zoomable slider + thumbnail strip), extracted
 * from the demo `product-thumbnail` layout so it is shared, not duplicated.
 * Exposes its `CarouselComponent` so the variation-axis part can sync the main
 * image to the selected variant.
 */
@Component({
	selector: 'app-product-gallery',
	templateUrl: './product-gallery.html',
	styleUrls: ['./product-gallery.scss'],
	imports: [CarouselModule, NgxImageZoomModule, TranslocoModule],
})
export class ProductGallery {
	readonly product = input<IProduct>();

	readonly carousel = viewChild<CarouselComponent>('owlCar');

	public activeSlide: string = '0';

	public productMainThumbSlider = data.productMainThumbSlider;
	public productThumbSlider = data.productThumbSlider;
}
