import { isPlatformBrowser } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, PLATFORM_ID, inject, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import SwiperCore from 'swiper';
import { Keyboard, Navigation, Zoom } from 'swiper/modules';

import { GalleryImage } from './gallery-image';

/** History marker so the phone's back button closes the gallery instead of leaving the page. */
const HISTORY_KEY = 'saha-textile-gallery';

/**
 * Full-screen product gallery (owner log § Media → Product imagery): Bootstrap's
 * `modal-fullscreen` (opened with `fullscreen: true`), Swiper with its Zoom module for pinch
 * and double-tap zoom, keyboard arrows on desktop, and the theme's close button. The back
 * button closes it. Nothing here adds CSS: Swiper's zoom styles ship in the bundle already
 * imported by `main.ts`.
 */
@Component({
	selector: 'app-gallery-fullscreen',
	imports: [TranslocoModule],
	// The host sits between .modal-content and its header/body; Bootstrap utilities keep the
	// modal's flex column intact so the slides fill the screen.
	host: { class: 'd-flex flex-column h-100' },
	template: `
		<div class="modal-header border-0">
			<button
				type="button"
				class="btn-close"
				[attr.aria-label]="'close' | transloco"
				(click)="close()"
			></button>
		</div>
		<div class="modal-body d-flex flex-column p-0">
			<div
				#container
				class="swiper w-100 flex-grow-1"
				style="--swiper-navigation-color: var(--theme-color)"
			>
				<div class="swiper-wrapper">
					@for (image of images; track image.id) {
						<div class="swiper-slide d-flex align-items-center justify-content-center">
							<div class="swiper-zoom-container">
								<img
									[src]="image.zoomSrc"
									[alt]="alt"
									loading="lazy"
									decoding="async"
									class="img-fluid"
								/>
							</div>
						</div>
					}
				</div>
				<div class="swiper-button-prev"></div>
				<div class="swiper-button-next"></div>
			</div>
		</div>
	`,
})
export class GalleryFullscreen implements AfterViewInit, OnDestroy {
	private readonly platformId = inject(PLATFORM_ID);
	private readonly modal = inject(NgbActiveModal);

	/** Set by the opener on the modal's component instance before the view initialises. */
	images: GalleryImage[] = [];
	start = 0;
	alt = '';

	private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
	private swiper: SwiperCore | null = null;
	private readonly onPopState = () => this.modal.dismiss('back');

	ngAfterViewInit(): void {
		if (!isPlatformBrowser(this.platformId)) return;
		this.swiper = new SwiperCore(this.container().nativeElement, {
			modules: [Zoom, Keyboard, Navigation],
			initialSlide: this.start,
			zoom: { maxRatio: 3 },
			keyboard: { enabled: true },
			navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
		});
		history.pushState({ [HISTORY_KEY]: true }, '');
		window.addEventListener('popstate', this.onPopState);
	}

	close(): void {
		this.modal.dismiss('close');
	}

	ngOnDestroy(): void {
		if (!isPlatformBrowser(this.platformId)) return;
		window.removeEventListener('popstate', this.onPopState);
		// Closed by the button or Escape: drop the history entry the gallery added.
		if ((history.state as Record<string, unknown> | null)?.[HISTORY_KEY]) history.back();
		this.swiper?.destroy(true, true);
	}
}
