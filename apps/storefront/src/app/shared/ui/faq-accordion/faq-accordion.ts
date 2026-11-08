import { Component, input } from '@angular/core';

import {
	NgbAccordionBody,
	NgbAccordionButton,
	NgbAccordionCollapse,
	NgbAccordionDirective,
	NgbAccordionHeader,
	NgbAccordionItem,
} from '@ng-bootstrap/ng-bootstrap';

export interface FaqItem {
	question: string;
	answer: string;
}

/**
 * The FAQ page's accordion (theme `.faq-accordion`), shared by the FAQ page, the product page and
 * category pages. Every answer is in the server HTML: no `<ng-template>` inside the body and
 * `destroyOnHide` off, so a closed answer is collapsed, never missing (storefront SEO rule).
 */
@Component({
	selector: 'app-faq-accordion',
	templateUrl: './faq-accordion.html',
	imports: [
		NgbAccordionDirective,
		NgbAccordionItem,
		NgbAccordionHeader,
		NgbAccordionButton,
		NgbAccordionCollapse,
		NgbAccordionBody,
	],
})
export class FaqAccordion {
	readonly items = input<readonly FaqItem[]>([]);
	/** The first answer starts open. */
	readonly openFirst = input(true);
}
