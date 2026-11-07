import { Component, computed, inject, input, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CarouselComponent, CarouselModule } from 'ngx-owl-carousel-o';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import * as data from '@shared/data/owl-carousel';

import { GalleryFullscreen } from './gallery-fullscreen';
import { GalleryImage, toGalleryImage } from './gallery-image';
import { GalleryZoomLens } from './gallery-zoom-lens';

/**
 * Reusable PDP gallery (main slider + thumbnail strip), extracted from the demo
 * `product-thumbnail` layout so it is shared, not duplicated. Exposes its
 * `CarouselComponent` so the variation-axis part can sync the main image to the selected
 * variant. Desktop hover magnifies; a click or tap opens the full-screen gallery.
 */
@Component({
	selector: 'app-product-gallery',
	templateUrl: './product-gallery.html',
	styleUrls: ['./product-gallery.scss'],
	imports: [CarouselModule, TranslocoModule, GalleryZoomLens],
})
export class ProductGallery {
	private readonly modals = inject(NgbModal);

	readonly product = input<IProduct>();
	/** A variant with its own photos shows those, in its own order. */
	readonly variation = input<IVariation | null>(null);

	readonly carousel = viewChild<CarouselComponent>('owlCar');

	readonly frames = computed(() => {
		const own = this.variation()?.variation_galleries;
		return own?.length ? own : (this.product()?.product_galleries ?? []);
	});

	readonly images = computed<GalleryImage[]>(() => this.frames().map(toGalleryImage));

	public activeSlide: string = '0';

	public productMainThumbSlider = data.productMainThumbSlider;
	public productThumbSlider = data.productThumbSlider;

	openFullscreen(index: number): void {
		const gallery = this.modals.open(GalleryFullscreen, { fullscreen: true })
			.componentInstance as GalleryFullscreen;
		gallery.images = this.images();
		gallery.start = index;
		gallery.alt = this.product()?.name ?? '';
	}
}
