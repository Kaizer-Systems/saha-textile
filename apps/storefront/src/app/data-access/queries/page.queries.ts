import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PageService } from '@data-access/services/page.service';

/**
 * TanStack Query for FAQs (replaces NGXS PageState.faq + GetFaqsAction).
 * The query's isPending() drives the skeleton (was PageService.skeletonLoader,
 * toggled by the old action). ContactUsAction was a no-op mock — dropped.
 */
export function injectFaqsQuery() {
  const pageService = inject(PageService);
  return injectQuery(() => ({
    queryKey: ['faqs'],
    queryFn: () => firstValueFrom(pageService.getFaqs()),
  }));
}
