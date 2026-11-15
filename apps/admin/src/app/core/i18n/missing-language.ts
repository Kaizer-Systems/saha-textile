import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { isLocaleCode } from '@saha-textile/core-domain/languages';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';

import type { WrittenLanguageArea } from '@saha-textile/contracts';

/**
 * A list opened from Settings › Languages ("Open" on a to-do line) shows only the items the shop
 * shows that still lack one language's text: `?missing=hi`.
 *
 * Paged lists hand `code()` to their API, which narrows the page itself. Lists that load every row
 * keep the rows whose id is in `ids()`. Outside a routed page (a dialog, a test) nothing is filtered.
 */
export function injectMissingLanguage(area: WrittenLanguageArea) {
	const route = inject(ActivatedRoute, { optional: true });
	const gateway = inject(AdminLanguagesGateway, { optional: true });
	const read = (value: string | null | undefined) => (value && isLocaleCode(value) ? value : null);
	const code = toSignal(route?.queryParamMap?.pipe(map((params) => read(params.get('missing')))) ?? of(null), {
		initialValue: read(route?.snapshot?.queryParamMap?.get('missing')),
	});
	const found = toSignal(
		(route?.queryParamMap ?? of(null)).pipe(
			map((params) => read(params?.get('missing'))),
			switchMap((language) =>
				language && gateway
					? gateway.missing(area, language).pipe(
							map((answer) => new Set(answer.ids)),
							// Not allowed or not answered: show nothing rather than everything as "missing".
							catchError(() => of(new Set<string>())),
						)
					: of(null),
			),
		),
		{ initialValue: null },
	);
	/** The ids to keep, or null when the list is not filtered (an empty set while they load). */
	const ids = computed(() => (code() ? (found() ?? new Set<string>()) : null));
	return { code, ids };
}

/** The rows a fully loaded list keeps: every row, or only the missing ones. */
export function keepMissing<T>(rows: readonly T[], ids: ReadonlySet<string> | null, idOf: (row: T) => string): T[] {
	return ids ? rows.filter((row) => ids.has(idOf(row))) : [...rows];
}
