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

/**
 * Why a session-bound request was refused. Mirrors `AuthRefusalReason` in contracts.
 *
 * Present only on refusals about the caller's OWN session. A refused credential — wrong
 * password, wrong PIN, locked PIN — carries no reason at all, deliberately: naming it before
 * the caller has proven who they are would confirm that a guessed account exists.
 */
export type AuthRefusalReason =
	| 'session_missing'
	| 'session_expired'
	| 'session_revoked'
	| 'permissions_changed'
	| 'account_inactive';

const AUTH_REFUSAL_REASONS: readonly string[] = [
	'session_missing',
	'session_expired',
	'session_revoked',
	'permissions_changed',
	'account_inactive',
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
	reason?: AuthRefusalReason;
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
	/** Set only for a session-bound refusal the client recognises. See `readRefusalReason`. */
	reason?: AuthRefusalReason;
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
		const reason = readRefusalReason(body);
		return {
			status,
			code,
			message,
			issues: sanitizeIssues(issues),
			requestId: requestId ?? fallbackRequestId,
			fromApiEnvelope: true,
			...(reason ? { reason } : {}),
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
 * Stays status-based, and should. Whether a 401 happened is a transport fact; WHY it happened
 * is optional detail the API attaches only to session-bound refusals, so a predicate that
 * required it would answer `false` for every credential refusal — which is still a 401.
 * Callers that want the reason ask for it separately via `readRefusalReason`.
 */
export function isUnauthorized(failure: Pick<TransportFailure, 'status'>): boolean {
	return failure.status === 401;
}

/**
 * Reads the refusal reason from a response body, if it carries one this client understands.
 *
 * Unknown values answer `undefined` rather than being passed through. That is deliberate
 * forward-compatibility: a deployed client will meet an API that has grown a new reason, and
 * the safe reading of "I do not recognise this" is "the server declined to say", which every
 * caller already handles. Passing an unrecognised string upward would instead let it fall
 * through a policy check as neither-recoverable-nor-unrecoverable by accident.
 */
export function readRefusalReason(body: unknown): AuthRefusalReason | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const error = (body as { error?: unknown }).error;
	if (typeof error !== 'object' || error === null) return undefined;

	const reason = (error as { reason?: unknown }).reason;
	if (typeof reason !== 'string' || !AUTH_REFUSAL_REASONS.includes(reason)) return undefined;
	return reason as AuthRefusalReason;
}

/**
 * Whether a refusal is one that rotating the session provably cannot fix.
 *
 * Only two reasons qualify, and the list is short on purpose:
 *
 *   - `session_revoked` — logout elsewhere, refresh-family reuse detection, or a bumped token
 *     version. The refresh token was invalidated by the same act, so rotation would fail too.
 *   - `account_inactive` — the account is suspended, so no session can be re-established at
 *     all until that changes.
 *
 * Everything else keeps attempting rotation, INCLUDING `session_missing`. That looks like it
 * ought to qualify — no session, nothing to refresh — but the client cannot see the refresh
 * cookie to check, because it is `httpOnly`. The costs are asymmetric: a needless rotation is
 * one request, already bounded to one per session by the coordinator's failure latch, while
 * wrongly skipping one signs out somebody who would have been recovered. `permissions_changed`
 * likewise keeps rotating — rotation is precisely what mints a token carrying the new
 * `permissionsVersion`.
 */
export function isUnrecoverableRefusal(reason: AuthRefusalReason | undefined): boolean {
	return reason === 'session_revoked' || reason === 'account_inactive';
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

/**
 * The sentence to show a person when a request failed.
 *
 * ## Why this lives here and not in each app
 *
 * It was written twice — once in the storefront, once in admin — and the two copies had already
 * drifted into two different bugs before either was noticed: the storefront's returned `''`
 * unconditionally (so every error toast was an empty outlined box), while admin's read
 * `.message` off the response BODY, which is `undefined` for every response this API sends (so
 * every toast said "Something Went Wrong" and never the reason). Two copies of one idea is how
 * that happens; both apps already depend on this package, and the envelope it parses is defined
 * a few lines above.
 *
 * ## Where the message actually is
 *
 * `{ error: { code, message, issues } }`, so from an `HttpErrorResponse` it is TWO levels down —
 * `httpError.error.error.message`. The one-level path is `undefined` every time, and being
 * `undefined` rather than throwing is what let both bugs survive.
 *
 * Issues win over the envelope's own message: for a rejected field the envelope says "Request
 * validation failed." while the issue says which field and why.
 *
 * ## Only ever OUR text
 *
 * A message is accepted only from a payload carrying `code` or `issues` — the marks of this
 * API's envelope. Without that check the browser's own "Failed to fetch" and Angular's "Http
 * failure response for https://…: 500" both qualify as "a string called message", and both are
 * for a log rather than for a person.
 */
export function readApiErrorMessage(error: unknown): string | null {
	let node: unknown = error;

	// Three hops covers `HttpErrorResponse` → body → payload, with one to spare.
	for (let depth = 0; depth < 3; depth += 1) {
		if (typeof node !== 'object' || node === null) return null;
		const candidate = node as Partial<ApiErrorBody>;

		const issue = candidate.issues?.find((entry) => typeof entry?.message === 'string' && entry.message.length > 0);
		if (issue) return issue.message;

		const isOurs = typeof candidate.code === 'string' || Array.isArray(candidate.issues);
		if (isOurs && typeof candidate.message === 'string' && candidate.message.length > 0) {
			return candidate.message;
		}

		node = (node as { error?: unknown }).error;
	}
	return null;
}
