import { DOCUMENT, isPlatformServer } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

/** One picture to ask for before the page is parsed: its file for one screen band. */
export interface PicturePreload {
	href: string;
	srcset: string | null;
	sizes: string;
	/** The media query of the band it serves; null for every band. */
	media: string | null;
}

/**
 * Preload hints for the page's one early picture (Page Builder FX-13; the same thing Angular's `NgOptimizedImage`
 * does for a `priority` image): on the server, a `<link rel="preload" as="image">` per screen band goes into the
 * head, so the browser asks for the picture while it is still reading the HTML instead of when it reaches the
 * `<img>`. The bands' media queries match the `<picture>` sources exactly, so a screen downloads one file only.
 * Each picture is preloaded once per page; in the browser this does nothing (the links are already in the HTML).
 */
@Injectable({ providedIn: 'root' })
export class HeadPreload {
	private readonly document = inject(DOCUMENT);
	private readonly server = isPlatformServer(inject(PLATFORM_ID));
	private readonly done = new Set<string>();

	picture(preload: PicturePreload): void {
		if (!this.server || !preload.href) return;
		const key = `${preload.href}|${preload.media ?? ''}`;
		if (this.done.has(key)) return;
		this.done.add(key);
		const link = this.document.createElement('link');
		link.setAttribute('rel', 'preload');
		link.setAttribute('as', 'image');
		link.setAttribute('href', preload.href);
		if (preload.srcset) {
			link.setAttribute('imagesrcset', preload.srcset);
			link.setAttribute('imagesizes', preload.sizes);
		}
		if (preload.media) link.setAttribute('media', preload.media);
		link.setAttribute('fetchpriority', 'high');
		const head = this.document.head;
		// Before the stylesheets and scripts, so the browser's preload scanner meets it first.
		head.insertBefore(link, head.querySelector('link[rel="stylesheet"], script') ?? null);
	}
}

/** The `<picture>` bands as media queries that never overlap: phone upright, tablet (or a phone on its side), desktop. */
export function pictureBandMedia(bands: { phone: boolean; tablet: boolean }): {
	phone: string | null;
	tablet: string | null;
	desktop: string | null;
} {
	const phone = '(max-width: 767px) and (orientation: portrait)';
	const sideways = '(max-width: 767px) and (orientation: landscape)';
	const tablet = '(min-width: 768px) and (max-width: 1199px)';
	return {
		phone: bands.phone ? phone : null,
		tablet: bands.tablet ? (bands.phone ? `${sideways}, ${tablet}` : '(max-width: 1199px)') : null,
		desktop: bands.tablet ? '(min-width: 1200px)' : bands.phone ? `${sideways}, (min-width: 768px)` : null,
	};
}
