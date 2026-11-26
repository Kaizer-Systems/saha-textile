import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { readApiErrorMessage } from '@saha-textile/http-transport';

import { booksWords } from '@core/accounts/books-refusal';

/**
 * Turns a failed request into a sentence worth showing someone.
 *
 * The parsing itself lives in `@saha-textile/http-transport`, beside the envelope it reads.
 * This file used to hold its own copy, and so did the other app — the two drifted into two
 * different bugs (one returned `''` and toasted an empty box; the other read the wrong nesting
 * and only ever said "Something Went Wrong"). One implementation, imported twice, is what stops
 * that recurring.
 */
@Injectable({
	providedIn: 'root',
})
export class ErrorService {
	private readonly platformId = inject<Object>(PLATFORM_ID);
	private readonly transloco = inject(TranslocoService, { optional: true });

	getClientErrorMessage(error: unknown): string {
		// `navigator` does not exist during SSR, so it is reached only in a browser.
		if (isPlatformBrowser(this.platformId) && navigator.onLine === false) {
			return 'No internet connection.';
		}

		const message = readApiErrorMessage(error);
		if (!message) return 'Something went wrong. Please try again.';
		// A step the books refused carries a code, shown in words (Postings and Convert brief AP2).
		const transloco = this.transloco;
		return transloco ? booksWords(message, (key, params) => transloco.translate(key, params)) : message;
	}

	getServerErrorMessage(error: HttpErrorResponse): string {
		return readApiErrorMessage(error) ?? error.message;
	}
}
