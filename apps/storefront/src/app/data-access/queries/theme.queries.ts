import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ThemeService } from '@data-access/services/theme.service';

/** Theme home-page JSON keyed on slug (replaces NGXS ThemeState + GetHomePageAction). */
export function injectHomePageQuery(slug: () => string | undefined) {
  const themeService = inject(ThemeService);
  return injectQuery(() => ({
    queryKey: ['home-page', slug()],
    queryFn: () => firstValueFrom(themeService.getHomePage(slug())),
    enabled: !!slug(),
    staleTime: Infinity,
  }));
}
