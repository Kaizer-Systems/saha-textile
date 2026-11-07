import { AsyncLocalStorage } from 'node:async_hooks';

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

const DEFAULT_LOCALE = 'en';
const LOCALE = /^[a-z]{2}$/;

const storage = new AsyncLocalStorage<string>();

/** The language this request reads catalogue content in. */
export function catalogLocale(): string {
	return storage.getStore() ?? DEFAULT_LOCALE;
}

/** Runs one read in a language, for callers outside a request. */
export function withCatalogLocale<T>(locale: string, read: () => T): T {
	return storage.run(locale, read);
}

/** A language-bound value in the request's language, or English where it has none. */
export function localized(value: Readonly<Record<string, string | undefined>>): string {
	return value[catalogLocale()] || value[DEFAULT_LOCALE] || '';
}

/** Reads `?locale=` once, so services resolve authored content without passing it around. */
@Injectable()
export class CatalogLocaleInterceptor implements NestInterceptor {
	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const request = context.switchToHttp().getRequest<{ query?: Record<string, unknown> }>();
		const asked = request.query?.['locale'];
		const locale = typeof asked === 'string' && LOCALE.test(asked) ? asked : DEFAULT_LOCALE;
		return new Observable((subscriber) => storage.run(locale, () => next.handle().subscribe(subscriber)));
	}
}
