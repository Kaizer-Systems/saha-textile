const CONTROL_CHAR_MAX = 0x1f;
const DELETE_CHAR = 0x7f;

/**
 * Storage keys are composed by us, never supplied by a browser — but they flow through
 * admin-facing code paths, so they are validated at the boundary rather than trusted.
 *
 * A key that escapes its intended prefix (`../`), starts at the bucket root (`/`), or
 * carries control characters would silently write to, read from, or delete the wrong
 * object. Rejecting the shape here means every adapter method inherits the guarantee.
 */
export function assertValidStorageKey(key: string): void {
	if (key.length === 0) {
		throw new Error('storage key must not be empty');
	}
	if (key.length > 1024) {
		throw new Error('storage key must be at most 1024 characters');
	}
	if (key.startsWith('/')) {
		throw new Error('storage key must be relative to the bucket root (no leading "/")');
	}
	if (key.endsWith('/')) {
		throw new Error('storage key must name an object, not a prefix (no trailing "/")');
	}
	if (key.includes('//')) {
		throw new Error('storage key must not contain an empty path segment ("//")');
	}
	if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
		throw new Error('storage key must not contain relative path segments ("." or "..")');
	}
	for (const character of key) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= CONTROL_CHAR_MAX || codePoint === DELETE_CHAR) {
			throw new Error('storage key must not contain control characters');
		}
	}
}

/**
 * Percent-encodes a key for use in a URL path while preserving its `/` separators.
 *
 * `encodeURIComponent` on the whole key would escape the slashes into `%2F` and produce a
 * URL pointing at a single oddly-named object; encoding nothing would break on the spaces
 * and `#` that real filenames contain. Per-segment encoding is the only correct option.
 */
export function encodeStorageKeyForUrl(key: string): string {
	return key.split('/').map(encodeURIComponent).join('/');
}
