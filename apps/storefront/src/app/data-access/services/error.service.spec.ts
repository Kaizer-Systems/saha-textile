import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ErrorService } from './error.service';

/**
 * Every wrong answer here is a STRING, which is why the bug survived so long: a blank toast and
 * a generic toast both look like "the app said something". These assert the specific sentence.
 */

function service(platform: 'browser' | 'server' = 'browser'): ErrorService {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [ErrorService, { provide: PLATFORM_ID, useValue: platform }],
	});
	return TestBed.inject(ErrorService);
}

/** Exactly what Angular hands a subscriber for one of our error responses. */
const httpError = (payload: Record<string, unknown>, status = 400) =>
	new HttpErrorResponse({ status, error: { error: payload } });

describe('ErrorService', () => {
	/**
	 * The payload sits two levels down — `httpError.error.error.message`. Reading one level, the
	 * obvious-looking path, is `undefined` for every response this API sends.
	 */
	it('reads the message through both layers of the envelope', () => {
		const message = service().getClientErrorMessage(
			httpError({ code: 'bad_request', message: 'That is the only way left to sign in.', issues: [] }),
		);

		expect(message).toBe('That is the only way left to sign in.');
	});

	/** For a rejected field the envelope says "Request validation failed."; the issue says why. */
	it('prefers a validation issue over the envelope message', () => {
		const message = service().getClientErrorMessage(
			httpError({
				code: 'validation_failed',
				message: 'Request validation failed.',
				issues: [{ path: ['password'], message: 'Use at least 12 characters.' }],
			}),
		);

		expect(message).toBe('Use at least 12 characters.');
	});

	/** The whole point: never the empty string that rendered as a blank outlined box. */
	it('never returns an empty message', () => {
		for (const input of [null, undefined, {}, new Error(''), httpError({}), httpError({ issues: [] })]) {
			expect(service().getClientErrorMessage(input).trim().length).toBeGreaterThan(0);
		}
	});

	/**
	 * Angular's own text reads "Http failure response for https://…: 500 Internal Server Error".
	 * That belongs in a log, not on screen.
	 */
	it('does not surface Angular transport text', () => {
		const raw = new HttpErrorResponse({ status: 500, url: 'https://localhost:4000/thing' });

		const message = service().getClientErrorMessage(raw);

		expect(message).not.toContain('Http failure');
		expect(message).toBe('Something went wrong. Please try again.');
	});

	/**
	 * A dropped connection gives Angular an error whose `message` is the browser's own
	 * "Failed to fetch". It has a `.message` but is not our envelope, so it must not be shown.
	 */
	it('does not surface browser transport text either', () => {
		const dropped = new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') });

		expect(service().getClientErrorMessage(dropped)).toBe('Something went wrong. Please try again.');
	});

	/**
	 * `navigator` does not exist during SSR. The previous implementation read it bare, so this
	 * would have thrown on the server the moment the empty early-return was removed.
	 */
	it('does not touch navigator on the server', () => {
		// `code` is present because the real envelope always carries one — it is what marks the
		// payload as ours rather than the browser's.
		const refusal = httpError({ code: 'bad_request', message: 'Nope.' });

		expect(() => service('server').getClientErrorMessage(refusal)).not.toThrow();
		expect(service('server').getClientErrorMessage(refusal)).toBe('Nope.');
	});
});
