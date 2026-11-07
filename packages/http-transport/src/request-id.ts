/**
 * Request correlation.
 *
 * The API stamps every request with an id (Fastify `genReqId`) and echoes it on every
 * response through an `onSend` hook, including failures. Surfacing it to the user on an
 * error screen is what lets support find the matching server-side log line for a failure
 * whose message is deliberately generic.
 */

/** Response header the API echoes its correlation id on. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Upper bound on an accepted id. The API's own ids are far shorter; this is a sanity cap. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Ids are constrained to printable ASCII without whitespace.
 *
 * The value is read off the wire, so it is untrusted even though our API produced the
 * legitimate one. An id containing CR/LF would inject lines into any client-side log or
 * error report that includes it, and the API applies the same discipline to inbound ids.
 */
const SAFE_REQUEST_ID = /^[\x21-\x7e]+$/;

/**
 * Reads and validates the correlation id from a response.
 *
 * Takes a header accessor rather than a headers object so it works with `HttpHeaders`,
 * `fetch`'s `Headers`, or a plain record — this package must not depend on any one of them.
 * Returns `null` for a missing, empty, oversized or unsafe value; a failure without a usable
 * id is normal (a proxy may have answered) and must not throw out of an error path.
 */
export function readRequestId(getHeader: (name: string) => string | null | undefined): string | null {
	const raw = getHeader(REQUEST_ID_HEADER);
	if (typeof raw !== 'string') return null;

	const value = raw.trim();
	if (value.length === 0 || value.length > MAX_REQUEST_ID_LENGTH) return null;
	if (!SAFE_REQUEST_ID.test(value)) return null;

	return value;
}
