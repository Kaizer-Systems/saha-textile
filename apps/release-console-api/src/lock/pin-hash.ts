import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt with a random salt; the PIN itself is never stored. */
export function hashPin(pin: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
	return { salt, hash: scryptSync(pin, salt, 32).toString('hex') };
}

export function pinMatches(pin: string, stored: { salt: string; hash: string }): boolean {
	const actual = Buffer.from(hashPin(pin, stored.salt).hash, 'hex');
	const expected = Buffer.from(stored.hash, 'hex');
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
