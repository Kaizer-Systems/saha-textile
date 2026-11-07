import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, PLATFORM_ID, computed, inject, input, output, signal, viewChild } from '@angular/core';

import { GALLERY_SIZES, GalleryImage } from './gallery-image';

const LENS = 350;
const MAGNIFICATION = 3;

/**
 * The PDP main image with the desktop hover magnifier (owner log § Media → Product imagery).
 *
 * Replaces `ngx-image-zoom`, which sized its box from the image's `load` event — an event
 * that has already fired by the time Angular hydrates a server-rendered image, so the box
 * stayed 0×0 and the slider collapsed to 1 px. Here the image is a plain server-rendered
 * `<img>` that lays out on its own, and the lens is an overlay that only exists while the
 * pointer is over it.
 *
 * - Only for a fine, hovering pointer (mouse or trackpad); touch never sees a lens.
 * - The zoom file is requested on the first hover, never at page load, so phones never
 *   download it.
 * - The lens reuses the theme's `.ngxImageZoomFullContainer.ngxImageZoomLensEnabled` look;
 *   its position is inline style, exactly as the library did.
 * - A click opens the full-screen gallery instead.
 */
@Component({
	selector: 'app-gallery-zoom-lens',
	template: `
		<div
			#frame
			class="position-relative"
			(pointerenter)="enter($event)"
			(pointermove)="move($event)"
			(pointerleave)="active.set(false)"
			(click)="opened.emit()"
		>
			<img
				[src]="image().src"
				[attr.srcset]="image().srcset"
				[attr.sizes]="image().srcset ? sizes : null"
				[attr.width]="image().width"
				[attr.height]="image().height"
				[attr.loading]="priority() ? 'eager' : 'lazy'"
				[attr.fetchpriority]="priority() ? 'high' : null"
				decoding="async"
				class="img-fluid w-100"
				[alt]="alt()"
			/>
			@if (active() && zoomSrc()) {
				<div
					class="ngxImageZoomFullContainer ngxImageZoomLensEnabled"
					aria-hidden="true"
					[style]="lensStyle()"
				>
					<img
						[src]="zoomSrc()"
						alt=""
						[style]="zoomStyle()"
					/>
				</div>
			}
		</div>
	`,
})
export class GalleryZoomLens {
	private readonly platformId = inject(PLATFORM_ID);

	readonly image = input.required<GalleryImage>();
	readonly alt = input('');
	/** The first slide is the LCP image: eager, high priority. The rest load lazily. */
	readonly priority = input(false);
	readonly opened = output<void>();

	readonly sizes = GALLERY_SIZES;
	readonly active = signal(false);
	readonly zoomSrc = signal<string | null>(null);
	private readonly point = signal({ x: 0, y: 0, width: 0, height: 0 });
	private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');

	private readonly canHover =
		isPlatformBrowser(this.platformId) && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

	readonly lensStyle = computed(() => {
		const { x, y } = this.point();
		return {
			position: 'absolute',
			overflow: 'hidden',
			pointerEvents: 'none',
			width: `${LENS}px`,
			height: `${LENS}px`,
			left: `${x - LENS / 2}px`,
			top: `${y - LENS / 2}px`,
			backgroundColor: '#fff',
			zIndex: 2,
		};
	});

	readonly zoomStyle = computed(() => {
		const { x, y, width, height } = this.point();
		return {
			position: 'absolute',
			maxWidth: 'none',
			width: `${width * MAGNIFICATION}px`,
			height: `${height * MAGNIFICATION}px`,
			left: `${LENS / 2 - x * MAGNIFICATION}px`,
			top: `${LENS / 2 - y * MAGNIFICATION}px`,
		};
	});

	enter(event: PointerEvent): void {
		if (!this.canHover || event.pointerType !== 'mouse') return;
		this.zoomSrc.set(this.image().zoomSrc);
		this.move(event);
	}

	move(event: PointerEvent): void {
		if (!this.canHover || event.pointerType !== 'mouse') return;
		const rect = this.frame().nativeElement.getBoundingClientRect();
		this.point.set({
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			width: rect.width,
			height: rect.height,
		});
		this.active.set(true);
	}
}
