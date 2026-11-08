import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { IFaqModel } from '@data-access/interfaces/page.interface';
import { injectFaqsQuery } from '@data-access/queries/page.queries';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { FaqAccordion } from '@shared/ui/faq-accordion/faq-accordion';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import { SkeletonPage } from '../skeleton-page/skeleton-page';

@Component({
	selector: 'app-faq',
	templateUrl: './faq.html',
	styleUrls: ['./faq.scss'],
	imports: [Breadcrumb, SkeletonPage, FaqAccordion, AsyncPipe, TranslocoModule],
})
export class Faq {
	private seo = inject(LocaleSeo);

	public breadcrumb = translatedBreadcrumb('faq', { description: 'faq_meta_description' });

	private readonly faqsQuery = injectFaqsQuery();
	faq$: Observable<IFaqModel> = toObservable(computed(() => this.faqsQuery.data() ?? { data: [], total: 0 }));
	/** The skeleton follows the query's own signal, so the view redraws when the answer comes. */
	readonly loading = computed(() => this.faqsQuery.isPending());
	/** The accordion's rows. */
	readonly items = computed(() =>
		(this.faqsQuery.data()?.data ?? []).map((row) => ({ question: row.title, answer: row.description })),
	);

	constructor() {
		effect(() => {
			const rows = this.faqsQuery.data()?.data ?? [];
			// No questions yet: an empty page is kept out of search until there are some.
			if (this.faqsQuery.isSuccess() && rows.length === 0) this.seo.applyDocument({ robots: 'noindex,follow' });
			if (rows.length === 0) return;
			this.seo.applyJsonLd('faq-jsonld', {
				'@context': 'https://schema.org',
				'@type': 'FAQPage',
				mainEntity: rows.map((row) => ({
					'@type': 'Question',
					name: row.title,
					acceptedAnswer: { '@type': 'Answer', text: row.description },
				})),
			});
		});
	}
}
