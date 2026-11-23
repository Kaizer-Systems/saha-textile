import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AppConfig } from '../config/app-config';

const hmac = (key: string, value: string): string => createHmac('sha256', key).update(value).digest('hex');

/**
 * Hashes opaque tokens (sessions, CSRF tokens, sign-in codes, reset and invite links, OAuth state,
 * guest carts) with the server's token key: `CSRF_SECRET`, or `JWT_REFRESH_SECRET` when that is
 * unset. HMAC, not a plain digest, so a database dump alone cannot check guesses offline.
 *
 * For 30 days after a planned change the previous key stays set (`CSRF_SECRET_PREVIOUS`, or
 * `JWT_REFRESH_SECRET_PREVIOUS` without a CSRF key; Release Path brief, owner 2026-11-23). New
 * hashes always use the current key; lookups and comparisons also try the previous one, so nobody
 * is signed out and no cart, code or link stops working. After a leak the previous key is left
 * blank, and everything hashed with it stops matching at once.
 */
export class TokenHasher {
	private readonly keys: readonly string[];

	constructor(config: Pick<AppConfig, 'cookies' | 'jwt'>) {
		const current = config.cookies.csrfSecret ?? config.jwt.refreshSecret;
		const previous = config.cookies.csrfSecret
			? config.cookies.csrfSecretPrevious
			: config.jwt.refreshSecretPrevious;
		this.keys = previous && previous !== current ? [current, previous] : [current];
	}

	/** The hash a new token is stored under: always the current key. */
	hash(value: string): string {
		return hmac(this.keys[0]!, value);
	}

	/** Every hash the value may be stored under, the current key's first. */
	candidates(value: string): string[] {
		return this.keys.map((key) => hmac(key, value));
	}

	/** Whether a stored hash belongs to the value under either key, compared in constant time. */
	matches(value: string, stored: string | null | undefined): boolean {
		if (!stored) return false;
		const expected = Buffer.from(stored, 'utf8');
		let found = false;
		for (const candidate of this.candidates(value)) {
			const actual = Buffer.from(candidate, 'utf8');
			if (actual.length === expected.length && timingSafeEqual(actual, expected)) found = true;
		}
		return found;
	}

	/**
	 * Looks a value up by its hash, the current key first. Returns what was found, the hash it was
	 * found under and whether that was the current key's, so a caller can store it again.
	 */
	async find<T>(
		value: string,
		lookup: (hash: string) => Promise<T | null>,
	): Promise<{ found: T; hash: string; current: boolean } | null> {
		const hashes = this.candidates(value);
		for (const [index, hash] of hashes.entries()) {
			const found = await lookup(hash);
			if (found) return { found, hash, current: index === 0 };
		}
		return null;
	}
}
