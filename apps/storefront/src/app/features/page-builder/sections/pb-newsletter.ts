import { Component, computed, input } from '@angular/core';

import { Newsletter } from '@features/themes/widgets/newsletter/newsletter';

import type { ResolvedPageSectionView } from '../page-builder.types';

/** The newsletter sign-up strip (today's home strip); its form code waits for the first tap. */
@Component({
	selector: 'app-pb-newsletter',
	imports: [Newsletter],
	template: `
		<div class="newsletter-section"><app-newsletter [data]="data()" /></div>
	`,
})
export class PbNewsletter {
	readonly section = input.required<ResolvedPageSectionView>();
	readonly data = computed(() => ({
		title: this.section().title ?? '',
		sub_title: this.section().subtitle ?? '',
		image_url: 'assets/images/data/newsletter.jpg',
		status: true,
	}));
}
