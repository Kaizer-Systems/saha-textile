import { DuplicateIdentifierError } from '@saha-textile/core-domain';

/**
 * Turns MongoDB's duplicate-key refusal into the domain's own.
 *
 * Read from `keyPattern` rather than by parsing the message: the message text is a driver detail
 * that has changed between releases, while the key pattern IS the index definition. Anything that
 * is not a customer identifier — the `authIdentities` provider pair, say — returns null and is
 * left to propagate, because relabelling it here would claim a meaning this layer cannot vouch for.
 *
 * Shared rather than copied. Every write that can lose a race for an email or a phone needs the
 * same translation, and two implementations of "what counts as a duplicate identifier" would be
 * free to disagree about exactly the case nobody exercises until production.
 */
export function asDuplicateIdentifier(error: unknown): DuplicateIdentifierError | null {
	const candidate = error as { code?: number; keyPattern?: Record<string, unknown> };
	if (candidate?.code !== 11000) return null;
	const field = Object.keys(candidate.keyPattern ?? {})[0];
	return field === 'email' || field === 'phone' ? new DuplicateIdentifierError(field) : null;
}
