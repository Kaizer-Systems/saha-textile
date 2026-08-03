/**
 * Safe mapping from an HTTP failure to something a client may act on and display.
 *
 * The API answers every failure with one envelope (`{ "error": { code, message, issues,
 * requestId } }`) whose `message` is already vetted as client-safe — the global exception
 * filter substitutes a per-status message rather than the exception text, so driver,
 * provider and stack detail cannot escape. This module's job is the other half of that
 * contract: when the body is NOT that envelope (an HTML error page from a proxy, a plain
 * string from an intermediary, an empty gateway response), refuse to surface it and fall
 * back to a generic message keyed on status. Anything else re-opens the leak the API closes.
 *
 * The shapes here are declared structurally rather than imported from
 * `@saha-textile/contracts` on purpose: contracts is a Zod package, and a runtime dependency
 * on it would pull Zod into both browser bundles as a side effect of using this transport.
 * `test/contract-alignment.test.ts` asserts the two definitions stay assignable in both
 * directions, so the duplication cannot drift silently.
 */

/** Stable machine-readable codes the API may return. Mirrors `ApiErrorCode` in contracts. */
export type ApiErrorCode =
	| 'bad_request'
	| 'validation_failed'
	| 'unauthorized'
	| 'forbidden'
	| 'not_found'
	| 'conflict'
	| 'rate_limited'
	| 'payload_too_large'
	| 'unsupported_media_type'
	| 'internal';

const API_ERROR_CODES: readonly string[] = [
	'bad_request',
	'validation_failed',
	'unauthorized',
	'forbidden',
	'not_found',
	'conflict',
	'rate_limited',
	'payload_too_large',
	'unsupported_media_type',
	'internal',
];

/** One field-level validation problem, flattened for transport. */
export interface ApiFieldIssue {
	path: (string | number)[];
	message: string;
	code?: string;
}

/** The error object inside the envelope. */
export interface ApiErrorBody {
	code: ApiErrorCode;
	message: string;
	issues: ApiFieldIssue[];
	requestId: string | null;
}

/** The full failure envelope: `{ "error": { ... } }`. */
export interface ApiErrorEnvelope {
	error: ApiErrorBody;
}

/**
 * What a caller gets: always populated, never carrying unrecognized body text.
 *
 * `code` widens to `'unknown'` for a response that did not come from our API at all, so a
 * consumer can distinguish "the API refused this" from "something between us and the API
 * answered" without inspecting the body itself.
 */
export interface TransportFailure {
	status: number;
	code: ApiErrorCode | 'unknown';
	message: string;
	issues: ApiFieldIssue[];
	requestId: string | null;
	/** True when the body parsed as the API's envelope rather than being reconstructed. */
	fromApiEnvelope: boolean;
}

/** Narrowing guard for the API failure envelope. */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
	if (typeof value !== 'object' || value === null) return false;
	const error = (value as { error?: unknown }).error;
	if (typeof error !== 'object' || error === null) return false;

	const { code, message, issues, requestId } = error as Record<string, unknown>;
	if (typeof code !== 'string' || !API_ERROR_CODES.includes(code)) return false;
	if (typeof message !== 'string' || message.length === 0) return false;
	if (issues !== undefined && !Array.isArray(issues)) return false;
	if (requestId !== undefined && requestId !== null && typeof requestId !== 'string') return false;

	return true;
}

/**
 * Maps a status plus a response body to a `TransportFailure`.
 *
 * `fallbackRequestId` is the id read from the response headers; the API echoes one on every
 * response, including those a proxy mangles, so support can still correlate a failure whose
 * body never reached us.
 */
export function toTransportFailure(
	status: number,
	body: unknown,
	fallbackRequestId: string | null = null,
): TransportFailure {
	if (isApiErrorEnvelope(body)) {
		const { code, message, issues, requestId } = body.error;
		return {
			status,
			code,
			message,
			issues: sanitizeIssues(issues),
			requestId: requestId ?? fallbackRequestId,
			fromApiEnvelope: true,
		};
	}

	return {
		status,
		code: 'unknown',
		message: genericMessageFor(status),
		issues: [],
		requestId: fallbackRequestId,
		fromApiEnvelope: false,
	};
}

/**
 * The session is absent, expired or revoked — the caller may attempt one refresh.
 *
 * Deliberately status-based rather than code-based: the API's global filter collapses every
 * `401` to the generic `unauthorized` envelope, so the code carries no extra information
 * today. Branching on a 401 sub-code would be dead client-side code until the API grows a
 * stable one (tracked as carried debt in the auth continuation brief).
 */
export function isUnauthorized(failure: Pick<TransportFailure, 'status'>): boolean {
	return failure.status === 401;
}

/** Authenticated, but not permitted. Never recoverable by refreshing — do not retry. */
export function isForbidden(failure: Pick<TransportFailure, 'status'>): boolean {
	return failure.status === 403;
}

/** Statuses that represent a transient condition rather than a rejected request. */
const RETRYABLE_STATUSES: readonly number[] = [408, 425, 429, 502, 503, 504];

/**
 * Whether an automatic retry is permissible.
 *
 * Two hard rules encoded here rather than left to each call site:
 *   1. Only safe methods. Replaying an unsafe method can duplicate a mutation, and until
 *      checkout idempotency exists (Chunk G) nothing downstream would deduplicate it.
 *   2. Never `401`. Recovering an expired session is the refresh coordinator's job; retrying
 *      the same request against the same dead session just doubles the failure.
 */
export function isRetryable(status: number, method: string): boolean {
	if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
	return RETRYABLE_STATUSES.includes(status);
}

function sanitizeIssues(issues: unknown): ApiFieldIssue[] {
	if (!Array.isArray(issues)) return [];

	return issues.flatMap((issue): ApiFieldIssue[] => {
		if (typeof issue !== 'object' || issue === null) return [];
		const { path, message, code } = issue as Record<string, unknown>;
		if (typeof message !== 'string' || message.length === 0) return [];

		const safePath = Array.isArray(path)
			? path.filter(
					(segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number',
				)
			: [];

		return [typeof code === 'string' ? { path: safePath, message, code } : { path: safePath, message }];
	});
}

/**
 * Status-keyed messages for a response that did not come from our API.
 *
 * Generic on purpose. Whatever a proxy or gateway put in the body is untrusted text, and
 * rendering it would defeat the API's own redaction.
 */
function genericMessageFor(status: number): string {
	if (status === 0) return 'Could not reach the server.';
	if (status === 401) return 'Your session is not valid.';
	if (status === 403) return 'You do not have access to this.';
	if (status === 404) return 'The requested resource was not found.';
	if (status === 429) return 'Too many requests. Please wait and try again.';
	if (status >= 500) return 'The server could not complete the request.';
	if (status >= 400) return 'The request could not be completed.';
	return 'Unexpected response from the server.';
}
