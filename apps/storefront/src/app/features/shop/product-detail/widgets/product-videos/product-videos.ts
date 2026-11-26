import { Component, input, viewChild, viewChildren } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselComponent, CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';

import { IVideo } from '@data-access/interfaces/video.interface';
import { VideoPoster } from '@shared/ui/video/video-poster';

/**
 * The product's videos in the Description tab (owner, 2026-11-10: brief revision 4).
 *
 * One video plays in place: full width for a video, 9:16 centred for a Short. Two or more form
 * the theme carousel, one per slide with arrows and dots, every slide the same 16:9 frame (a
 * Short sits centred in it) so the page never changes height. The carousel moves on by itself
 * only while nothing plays: it pauses under the pointer, stops while a video plays, and a slide
 * changed by hand closes the playing video. The carousel's own hover pause is not used, because
 * it restarts on mouse-leave even while a video plays.
 */
@Component({
	selector: 'app-product-videos',
	imports: [CarouselModule, VideoPoster, TranslocoModule],
	templateUrl: './product-videos.html',
	styleUrls: ['./product-videos.scss'],
})
export class ProductVideos {
	readonly videos = input.required<IVideo[]>();
	readonly posters = viewChildren(VideoPoster);
	readonly carousel = viewChild<CarouselComponent>('carousel');
	private isPlaying = false;

	readonly options: OwlOptions = {
		items: 1,
		loop: false,
		rewind: true,
		dots: true,
		nav: true,
		navText: ['<i class="ri-arrow-left-s-line"></i>', '<i class="ri-arrow-right-s-line"></i>'],
		autoplay: true,
		autoplayTimeout: 5000,
		autoplayHoverPause: false,
	};

	/** Paused while the pointer is over the carousel; resumes on leave unless a video plays. */
	hover(over: boolean): void {
		if (over) this.carousel()?.stopAutoplay();
		else if (!this.isPlaying) this.carousel()?.startAutoplay();
	}

	/** A video started: the carousel stops moving by itself. */
	playing(): void {
		this.isPlaying = true;
		this.carousel()?.stopAutoplay();
	}

	/** The shopper moved to another slide: the playing video closes and auto-advance resumes. */
	slideChanged(): void {
		if (!this.isPlaying) return;
		this.isPlaying = false;
		for (const poster of this.posters()) poster.stop();
		this.carousel()?.startAutoplay();
	}
}
