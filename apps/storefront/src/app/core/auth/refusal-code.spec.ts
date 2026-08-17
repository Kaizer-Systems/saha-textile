import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { refusalCode } from './refusal-code';

/**
 * The bug this guards against is a silent one.
 *
 * Every wrong reading here still returns a STRING — the fallback — so the screen shows a
 * plausible generic message and nothing looks broken. The only way to notice is to assert on
 * the specific code, which is what these do.
 */

/** Exactly what Angular hands a subscriber for a 400 from this API. */
const httpError = (payload: Record<string, unknown>) =>
	new HttpErrorResponse({ status: 400, error: { error: payload } });

describe('refusalCode', () => {
	/**
	 * `HttpErrorResponse.error` is the BODY and the body is `{ error: … }`, so the payload sits
	 * two levels down. Reading one level — the obvious-looking `httpError.error.code` — is
	 * `undefined` and falls through to the fallback without any error.
	 */
	it('reads the domain code through both layers of nesting', () => {
		const error = httpError({
			code: 'validation_failed',
			message: 'Request validation failed.',
			issues: [{ path: ['request'], message: 'That is the only way left to sign in', code: 'last_credential' }],
		});

		expect(refusalCode(error)).toBe('last_credential');
	});

	/**
	 * The issue code wins over the envelope code. The envelope's is the transport outcome the
	 * server's filter stamped on by status; preferring it would mean every domain refusal reads
	 * as `validation_failed`.
	 */
	it('prefers the issue code over the transport code', () => {
		const error = httpError({
			code: 'validation_failed',
			issues: [{ code: 'step_up_required' }],
		});

		expect(refusalCode(error)).toBe('step_up_required');
	});

	it('falls back to the transport code when there is no issue', () => {
		expect(refusalCode(httpError({ code: 'rate_limited', issues: [] }))).toBe('rate_limited');
	});

	it('accepts a body that some other layer already unwrapped', () => {
		expect(refusalCode({ error: { issues: [{ code: 'signup_identifier_taken' }] } })).toBe(
			'signup_identifier_taken',
		);
	});

	it('uses the caller fallback when the shape is nothing it recognises', () => {
		expect(refusalCode(new Error('network down'), 'registration_failed')).toBe('registration_failed');
		expect(refusalCode(null, 'social_failed')).toBe('social_failed');
		expect(refusalCode({ error: {} }, 'social_failed')).toBe('social_failed');
	});

	/** An issue without a code must not shadow a usable envelope code. */
	it('skips issues that carry no code', () => {
		const error = httpError({ code: 'rate_limited', issues: [{ message: 'no code here' }] });

		expect(refusalCode(error)).toBe('rate_limited');
	});
});
