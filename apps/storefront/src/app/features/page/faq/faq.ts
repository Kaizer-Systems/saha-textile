import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import {
	NgbAccordionBody,
	NgbAccordionButton,
	NgbAccordionCollapse,
	NgbAccordionDirective,
	NgbAccordionHeader,
	NgbAccordionItem,
	NgbAccordionToggle,
	NgbCollapse,
} from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { IFaqModel } from '@data-access/interfaces/page.interface';
import { injectFaqsQuery } from '@data-access/queries/page.queries';
import { PageService } from '@data-access/services/page.service';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import { SkeletonPage } from '../skeleton-page/skeleton-page';

@Component({
	selector: 'app-faq',
	templateUrl: './faq.html',
	styleUrls: ['./faq.scss'],
	imports: [
		Breadcrumb,
		SkeletonPage,
		NgbAccordionDirective,
		NgbAccordionItem,
		NgbAccordionHeader,
		NgbAccordionToggle,
		NgbAccordionButton,
		NgbCollapse,
		NgbAccordionCollapse,
		NgbAccordionBody,
		AsyncPipe,
	],
})
export class Faq {
	pageService = inject(PageService);

	public breadcrumb = translatedBreadcrumb('faq');

	private readonly faqsQuery = injectFaqsQuery();
	faq$: Observable<IFaqModel> = toObservable(computed(() => this.faqsQuery.data() ?? { data: [], total: 0 }));

	constructor() {
		// Drive the template skeleton off the query (was PageService.skeletonLoader,
		// toggled by the old GetFaqsAction).
		effect(() => {
			this.pageService.skeletonLoader = this.faqsQuery.isPending();
		});
	}
}
