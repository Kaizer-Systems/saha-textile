import { inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';

import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';

/**
 * Option A — reactive fixed-label breadcrumb.
 *
 * Resolves a breadcrumb whose title/label is a STATIC UI label, from its
 * Transloco key, re-translating on runtime language switch (selectTranslate
 * without a lang re-emits on every langChanges$). Use ONLY for fixed UI labels;
 * never pass dynamic data (product/category/customer names) through here.
 *
 * Must be called from an injection context (component field initializer or
 * constructor). Produces a single active crumb whose label matches the title,
 * which covers the auth/account pages.
 */
export function translatedBreadcrumb(titleKey: string): Signal<IBreadcrumb | undefined> {
	const transloco = inject(TranslocoService);

	return toSignal(
		transloco.selectTranslate<string>(titleKey).pipe(
			map((title) => ({
				title,
				items: [{ label: title, active: true }],
			})),
		),
	);
}
