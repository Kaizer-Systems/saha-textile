import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { HeadPreload, pictureBandMedia } from '@core/media/head-preload';
import { bannerSrc, bannerSrcset, type ResolvedBanner } from '@data-access/queries/banner.queries';

@Component({
	selector: 'app-image-link',
	templateUrl: './image-link.html',
	styleUrls: ['./image-link.scss'],
	imports: [NgClass, NgTemplateOutlet, RouterLink],
})
export class ImageLink implements OnInit {
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

	private readonly preload = inject(HeadPreload);

	/** The early picture is preloaded from the page's head, per screen band (FX-13; see `HeadPreload`). */
	ngOnInit(): void {
		const banner = this.image()?.resolved as ResolvedBanner | undefined;
		if (!banner || !(this.priority() || this.isHeroMain(banner))) return;
		const images = banner.images;
		const media = pictureBandMedia({ phone: !!images.phone, tablet: !!images.tablet });
		const bands = [
			{ image: images.phone, sizes: '100vw', media: media.phone },
			{ image: images.tablet, sizes: this.sizes(), media: media.tablet },
			{ image: images.desktop, sizes: this.sizes(), media: media.desktop },
		];
		for (const band of bands) {
			if (!band.image) continue;
			this.preload.picture({
				href: bannerSrc(band.image),
				srcset: bannerSrcset(band.image),
				sizes: band.sizes,
				media: band.media,
			});
		}
	}
}
