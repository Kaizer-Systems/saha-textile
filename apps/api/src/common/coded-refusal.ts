/**
 * The body of a refusal the admin explains in its own words: a save over someone else's newer
 * work, a change only the super admin may make, a rule set still in use.
 *
 * `HttpExceptionFilter` builds the envelope's `code` from the HTTP status and keeps only `issues[]`
 * from an exception's body, so a top-level `{ code: 'stale_revision' }` reaches the browser as
 * `{ code: 'conflict' }` and the screen can only say "That didn't save". The stable code travels as
 * an issue instead, the channel `domainRefusal` (auth) and `mediaRefusal` (media) already use; see
 * `auth/domain-refusal.ts` for the full reasoning. Hand the body to the exception class whose status
 * fits, so the status and `instanceof` checks stay as they are:
 *
 *   throw new ConflictException(codedRefusal('stale_revision', 'Someone else saved this first', 'revision'));
 */
export function codedRefusal(
	code: string,
	message: string,
	path = 'request',
): { message: string; issues: Array<{ path: string; message: string; code: string }> } {
	return { message: 'Validation failed', issues: [{ path, message, code }] };
}
