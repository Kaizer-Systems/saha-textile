import { Component, computed, inject, input, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CarouselComponent, CarouselModule } from 'ngx-owl-carousel-o';

import { roleSrcset } from '@core/media/resolved-image';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { IVideo } from '@data-access/interfaces/video.interface';
import * as data from '@shared/data/owl-carousel';
import { ShortsModal } from '@shared/ui/video/shorts-modal';
import { posterFor } from '@shared/ui/video/video-links';
import { VideoModal } from '@shared/ui/video/video-modal';

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
	imports: [CarouselModule, TranslocoModule, GalleryZoomLens, VideoModal, ShortsModal],
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

	/** About 120 px wide in the strip; the `card` widths (200 / 400) cover it at any density. */
	readonly thumbSizes = '120px';

	/** The strip uses the small `card` file, not the 900 px main photo it used to download three of. */
	thumb(image: IAttachment): { src: string; srcset: string | null } {
		return {
			src: image.image?.roles['card']?.[0]?.url ?? image.original_url,
			srcset: roleSrcset(image.image, 'card'),
		};
	}

	public activeSlide: string = '0';

	/** The product's YouTube videos and Shorts, tiled after the photos. */
	readonly videos = computed<IVideo[]>(() => this.product()?.videos ?? []);
	readonly videoModal = viewChild(VideoModal);
	readonly shortsModal = viewChild(ShortsModal);
	readonly poster = (video: IVideo) => posterFor(video, 'card');

	/** A video opens the wide popup; a Short opens the vertical one, stepping through this product's Shorts. */
	playVideo(video: IVideo): void {
		if (video.kind === 'short') {
			this.shortsModal()?.open(
				this.videos().filter((row) => row.kind === 'short'),
				video,
			);
		} else {
			this.videoModal()?.open(video);
		}
	}

	public productMainThumbSlider = data.productMainThumbSlider;
	public productThumbSlider = data.productThumbSlider;

	/**
	 * A click (or a tap on phones, which have no hover) opens the full-screen gallery. The slider
	 * stays on that photo while it is open and moves on again once it closes.
	 */
	openFullscreen(index: number): void {
		const carousel = this.carousel();
		carousel?.stopAutoplay();
		const modal = this.modals.open(GalleryFullscreen, { fullscreen: true });
		const gallery = modal.componentInstance as GalleryFullscreen;
		gallery.images = this.images();
		gallery.start = index;
		gallery.alt = this.product()?.name ?? '';
		const resume = () => carousel?.startAutoplay();
		modal.result.then(resume, resume);
	}
}
