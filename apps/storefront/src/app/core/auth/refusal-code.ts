/** The parts of the API error payload this reader cares about. */
interface ApiErrorPayload {
	code?: unknown;
	issues?: { code?: unknown }[];
}

/**
 * Digs the payload out of whatever the caller was handed.
 *
 * There are TWO nestings called `error` and it is easy to stop at the wrong one: Angular's
 * `HttpErrorResponse.error` is the response BODY, and the body is the envelope
 * `{ error: { code, message, issues, requestId } }`. So the payload is at `httpError.error.error`,
 * and reading `httpError.error.code` — the obvious-looking path — is always `undefined`, which
 * fails silently into whatever fallback the caller passed.
 *
 * Both depths are accepted so this works on an `HttpErrorResponse` and on a body that some
 * other layer already unwrapped. `readRefusalReason` in `http-transport` takes the body and is
 * called as `readRefusalReason(error.error)`; this one takes either.
 */
function payloadOf(error: unknown): ApiErrorPayload | null {
	let node: unknown = error;
	for (let depth = 0; depth < 3; depth += 1) {
		if (typeof node !== 'object' || node === null) return null;
		const candidate = node as ApiErrorPayload;
		if (typeof candidate.code === 'string' || Array.isArray(candidate.issues)) return candidate;
		node = (node as { error?: unknown }).error;
	}
	return null;
}

/**
 * The stable refusal code out of an API error.
 *
 * ## Why it is not simply `code`
 *
 * The envelope's own `code` is a TRANSPORT outcome chosen by HTTP status — `bad_request`,
 * `validation_failed`, `rate_limited` — and the server's exception filter overwrites it with
 * exactly that on the way out, deliberately, so no raw exception text can escape. A handler's
 * DOMAIN code (`last_credential`, `signup_identifier_taken`, `step_up_required`) survives only
 * inside `issues[].code`, which the filter preserves because issues describe the caller's own
 * request.
 *
 * Reading the envelope code therefore yields `bad_request` for every domain refusal, which is
 * how a screen ends up saying "Something went wrong" at the one moment the reason mattered.
 * Issues first, envelope second, generic last.
 */
export function refusalCode(error: unknown, fallback = 'something_went_wrong_please_try_again'): string {
	const payload = payloadOf(error);
	if (!payload) return fallback;

	const fromIssue = payload.issues?.find((issue) => typeof issue.code === 'string')?.code;
	if (typeof fromIssue === 'string') return fromIssue;

	// A transport-level code is still better than nothing when there is no issue to read.
	return typeof payload.code === 'string' ? payload.code : fallback;
}
