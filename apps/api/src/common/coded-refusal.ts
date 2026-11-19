import { ConflictException } from '@nestjs/common';

/** One issue of a coded refusal, as `HttpExceptionFilter` reads it. */
export interface CodedRefusalIssue {
	path: string;
	message: string;
	code: string;
	params?: Record<string, string | number>;
}

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
 *
 * `params` are plain values the screen puts into its own words; the filter keeps short strings and
 * numbers only.
 */
export function codedRefusal(
	code: string,
	message: string,
	path = 'request',
	params?: Record<string, string | number>,
): { message: string; issues: CodedRefusalIssue[] } {
	return { message: 'Validation failed', issues: [{ path, message, code, ...(params ? { params } : {}) }] };
}

/** Who saved the stored copy last, and when, as the stored record says. */
export interface LastSave {
	/** The admin's id from the stored record (`updatedBy`). */
	by: string | null;
	/** Their name as other admins see it; null when the account is unknown or gone. */
	byName: string | null;
	/** ISO time of that save (`updatedAt`). */
	at: string | null;
}

/**
 * A save over someone else's newer work is refused, naming who changed it and when (shipping rules
 * brief, edge cases: "the second save is refused with who changed it and when; nothing is
 * overwritten"). `changedByYou` marks a clash with the same admin's other tab, so the screen can say
 * "You … in another tab" instead of the admin's own name.
 */
export function staleSaveRefusal(message: string, last: LastSave, actor: string | null): ConflictException {
	const params: Record<string, string | number> = {};
	if (last.at) params['changedAt'] = last.at;
	if (last.byName) params['changedBy'] = last.byName.slice(0, 80);
	if (actor && last.by === actor) params['changedByYou'] = 1;
	return new ConflictException(codedRefusal('stale_revision', message, 'revision', params));
}
