import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { bannerSrc, bannerSrcset } from '@data-access/queries/banner.queries';

@Component({
	selector: 'app-image-link',
	templateUrl: './image-link.html',
	styleUrls: ['./image-link.scss'],
	imports: [NgClass, NgTemplateOutlet, RouterLink],
})
export class ImageLink {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional migration skip (template control-flow narrowing)
	readonly image = input<any>();
	readonly link = input<string>();
	readonly bgImage = input<boolean>();
	readonly class = input<string>();
	/** The hero's first banner is the LCP image: eager and high priority. */
	readonly priority = input(false);
	/** Display width of this slot, so the browser picks the right file. */
	readonly sizes = input('100vw');

	readonly srcset = bannerSrcset;
	/** A hero's main banner is the page's LCP image in every layout. */
	readonly isHeroMain = (banner: { position: string; slot: string }) =>
		banner.position === 'hero' && banner.slot === 'main';
	readonly src = bannerSrc;

}
