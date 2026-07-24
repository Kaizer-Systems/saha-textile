import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { FaqService } from '@data-access/services/faq.service';

export function injectFaqsQuery(params: () => Params) {
	const faqService = inject(FaqService);
	return injectQuery(() => ({
		queryKey: ['faqs', params()],
		queryFn: () => firstValueFrom(faqService.getFaqs(params())),
	}));
}
