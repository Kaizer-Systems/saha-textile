import { Component, input } from '@angular/core';

import { type ResolvedPageSectionView, sectionClasses } from './page-builder.types';
import { PbBanner } from './sections/pb-banner';
import { PbBlogPosts } from './sections/pb-blog-posts';
import { PbNewsletter } from './sections/pb-newsletter';
import { PbProductRow } from './sections/pb-product-row';
import { PbPromos } from './sections/pb-promos';
import { PbRecentlyViewed } from './sections/pb-recently-viewed';
import { PbVideos } from './sections/pb-videos';

/**
 * Draws a page from its live Page Builder layout (brief, How the shop draws it). The whole page comes from the
 * server; every section after the first sits in its own `@defer (hydrate on viewport)` block, so its code is a
 * separate file that wakes only near the screen (FX-7). The first section is drawn and woken at once, and only its
 * first picture is asked for early (one per screen band, FX-13).
 */
@Component({
	selector: 'app-page-layout',
	templateUrl: './page-layout.html',
	imports: [PbBanner, PbBlogPosts, PbNewsletter, PbProductRow, PbPromos, PbRecentlyViewed, PbVideos],
})
export class PageLayout {
	readonly sections = input.required<ResolvedPageSectionView[]>();
	readonly classes = sectionClasses;
}
