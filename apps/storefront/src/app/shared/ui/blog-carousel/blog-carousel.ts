import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';

import { IBlog } from '@data-access/interfaces/blog.interface';
import { SummaryPipe } from '@shared/pipes/summary.pipe';
import { Title } from '@shared/ui/title/title';

/**
 * Reusable, highly-responsive blog rail for the PDP and category pages.
 * Presentational only — the parent supplies the blogs (e.g. those the admin
 * linked to a product / its parent, or to a category). Lives in shared/ui with
 * NO reference to any demo page, so finalised pages never break when demo pages
 * are dropped.
 *
 * Layout is driven by an owl carousel whose per-viewport `items` = the count,
 * capped at 3 (desktop) / 2 (mobile). Owl divides the container by `items`, so:
 *   1 blog  -> full width (col-12)   2 -> halves (col-6)   3 -> thirds (col-4 desktop; 2 shown + scroll on mobile)
 *   >3      -> 3 shown desktop / 2 mobile, the rest on side-scroll
 * Owl recalculates on resize AND orientation change (no refresh needed), and
 * with `loop:false` every slide stays in the DOM — crawlable for SEO even when
 * scrolled out of view. Styled nav arrows come from the theme's `.product-arrow`.
 */
@Component({
	selector: 'app-blog-carousel',
	templateUrl: './blog-carousel.html',
	styleUrls: ['./blog-carousel.scss'],
	imports: [Title, CarouselModule, RouterLink, DatePipe, SummaryPipe, TranslocoModule],
})
export class BlogCarousel {
	readonly blogs = input<IBlog[]>([]);
	readonly title = input<string>('');

	/** Single blog renders as the wide list-view card; multiples as grid cards. */
	readonly isSingle = computed(() => this.blogs().length === 1);

	readonly options = computed<OwlOptions>(() => {
		const n = this.blogs().length || 1;
		return {
			loop: false,
			dots: false,
			margin: 24,
			nav: true,
			navText: ['<i class="ri-arrow-left-s-line"></i>', '<i class="ri-arrow-right-s-line"></i>'],
			responsive: {
				0: { items: Math.min(n, 2), margin: 16, nav: true },
				992: { items: Math.min(n, 3), nav: true },
			},
		};
	});
}
