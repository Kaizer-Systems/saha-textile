import { describe, expect, it } from 'vitest';

import {
	isApiErrorEnvelope,
	isForbidden,
	isRetryable,
	isUnauthorized,
	isUnrecoverableRefusal,
	readRefusalReason,
	toTransportFailure,
} from '../src/errors.js';

const envelope = {
	error: {
		code: 'validation_failed',
		message: 'The request payload failed validation.',
		issues: [{ path: ['email'], message: 'Invalid email', code: 'invalid_string' }],
		requestId: 'req_abc',
	},
};

describe('isApiErrorEnvelope', () => {
	it('accepts the API envelope', () => {
		expect(isApiErrorEnvelope(envelope)).toBe(true);
	});

	it('accepts an envelope without optional issues/requestId', () => {
		expect(isApiErrorEnvelope({ error: { code: 'not_found', message: 'Missing.' } })).toBe(true);
	});

	it.each([
		['null', null],
		['a string body', 'Internal Server Error'],
		['an HTML error page', '<html><body>502 Bad Gateway</body></html>'],
		['a bare object', { message: 'nope' }],
		['an unknown code', { error: { code: 'teapot', message: 'nope' } }],
		['an empty message', { error: { code: 'internal', message: '' } }],
		['a non-string message', { error: { code: 'internal', message: 42 } }],
		['non-array issues', { error: { code: 'internal', message: 'x', issues: 'oops' } }],
		['a non-string requestId', { error: { code: 'internal', message: 'x', requestId: 7 } }],
	])('rejects %s', (_label, value) => {
		expect(isApiErrorEnvelope(value)).toBe(false);
	});
});

describe('toTransportFailure', () => {
	it('passes the API envelope through, including issues and request id', () => {
		const failure = toTransportFailure(400, envelope);

		expect(failure).toEqual({
			status: 400,
			code: 'validation_failed',
			message: 'The request payload failed validation.',
			issues: [{ path: ['email'], message: 'Invalid email', code: 'invalid_string' }],
			requestId: 'req_abc',
			fromApiEnvelope: true,
		});
	});

	it('falls back to the header request id when the envelope carries none', () => {
		const failure = toTransportFailure(404, { error: { code: 'not_found', message: 'Gone.' } }, 'req_header');
		expect(failure.requestId).toBe('req_header');
	});

	it('prefers the envelope request id over the header one', () => {
		expect(toTransportFailure(400, envelope, 'req_header').requestId).toBe('req_abc');
	});

	// The API's filter already substitutes a safe message for the exception text. This is the
	// other half: a body from a proxy/gateway is untrusted text and must never be displayed.
	it('never surfaces an unrecognized body as the message', () => {
		const failure = toTransportFailure(502, '<html>nginx: upstream MongoServerError at 10.0.0.4</html>');

		expect(failure.fromApiEnvelope).toBe(false);
		expect(failure.code).toBe('unknown');
		expect(failure.message).toBe('The server could not complete the request.');
		expect(failure.message).not.toContain('MongoServerError');
		expect(failure.message).not.toContain('10.0.0.4');
	});

	it.each([
		[0, 'Could not reach the server.'],
		[401, 'Your session is not valid.'],
		[403, 'You do not have access to this.'],
		[404, 'The requested resource was not found.'],
		[429, 'Too many requests. Please wait and try again.'],
		[418, 'The request could not be completed.'],
		[500, 'The server could not complete the request.'],
		[204, 'Unexpected response from the server.'],
	])('uses a generic status-keyed message for a non-envelope %i', (status, message) => {
		expect(toTransportFailure(status, null).message).toBe(message);
	});

	it('drops malformed issue entries rather than forwarding them', () => {
		const failure = toTransportFailure(400, {
			error: {
				code: 'validation_failed',
				message: 'Invalid.',
				issues: [
					{ message: 'kept' },
					{ path: ['a'], message: '' },
					'not an object',
					null,
					{ path: 'x', message: 'kept too' },
				],
			},
		});

		expect(failure.issues).toEqual([
			{ path: [], message: 'kept' },
			{ path: [], message: 'kept too' },
		]);
	});
});

describe('classification', () => {
	it('identifies 401 and 403', () => {
		expect(isUnauthorized({ status: 401 })).toBe(true);
		expect(isUnauthorized({ status: 403 })).toBe(false);
		expect(isForbidden({ status: 403 })).toBe(true);
		expect(isForbidden({ status: 401 })).toBe(false);
	});

	it.each([408, 425, 429, 502, 503, 504])('treats a safe-method %i as retryable', (status) => {
		expect(isRetryable(status, 'GET')).toBe(true);
	});

	// Replaying a mutation can duplicate it, and checkout idempotency does not exist yet.
	it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('never retries %s, even on a transient status', (method) => {
		expect(isRetryable(503, method)).toBe(false);
	});

	// Recovering an expired session is the refresh coordinator's job, not the retry policy's.
	it('never retries 401', () => {
		expect(isRetryable(401, 'GET')).toBe(false);
	});

	it.each([400, 403, 404, 409, 500])('does not retry a non-transient %i', (status) => {
		expect(isRetryable(status, 'GET')).toBe(false);
	});
});

describe('refusal reasons', () => {
	const refusal = (reason: unknown) => ({
		error: { code: 'unauthorized', message: 'Authentication is required.', reason },
	});

	it('reads a recognised reason', () => {
		expect(readRefusalReason(refusal('session_expired'))).toBe('session_expired');
	});

	it('answers undefined when the API declined to say', () => {
		expect(readRefusalReason({ error: { code: 'unauthorized', message: 'x' } })).toBeUndefined();
	});

	/**
	 * Forward-compatibility. A deployed client WILL meet an API that has grown a new reason,
	 * and "I do not recognise this" must read as "no reason given" — a state every caller
	 * already handles — rather than leaking an unknown string into a policy check.
	 */
	it('treats an unknown reason as no reason at all', () => {
		expect(readRefusalReason(refusal('pin_locked'))).toBeUndefined();
		expect(readRefusalReason(refusal(''))).toBeUndefined();
		expect(readRefusalReason(refusal(42))).toBeUndefined();
		expect(readRefusalReason(refusal(null))).toBeUndefined();
	});

	it('survives bodies that are not the envelope', () => {
		for (const body of [null, undefined, 'nope', 42, [], {}, { error: null }, { error: 'x' }]) {
			expect(readRefusalReason(body)).toBeUndefined();
		}
	});

	it('carries a recognised reason through toTransportFailure', () => {
		expect(toTransportFailure(401, refusal('session_revoked')).reason).toBe('session_revoked');
	});

	it('omits the reason entirely when there is none', () => {
		const failure = toTransportFailure(401, { error: { code: 'unauthorized', message: 'x' } });

		expect(failure.reason).toBeUndefined();
		expect(Object.keys(failure)).not.toContain('reason');
	});

	it('does not invent a reason for a body that never reached us', () => {
		expect(toTransportFailure(401, '<html>gateway</html>').reason).toBeUndefined();
	});

	// Only refusals rotation provably cannot fix. `session_missing` is deliberately absent:
	// the refresh cookie is httpOnly, so the client cannot check whether one survives, and a
	// needless rotation is far cheaper than wrongly signing out a recoverable session.
	it.each(['session_revoked', 'account_inactive'] as const)('treats %s as unrecoverable', (reason) => {
		expect(isUnrecoverableRefusal(reason)).toBe(true);
	});

	it.each(['session_missing', 'session_expired', 'permissions_changed'] as const)(
		'keeps attempting rotation for %s',
		(reason) => {
			expect(isUnrecoverableRefusal(reason)).toBe(false);
		},
	);

	it('keeps attempting rotation when no reason was given', () => {
		expect(isUnrecoverableRefusal(undefined)).toBe(false);
	});
});
