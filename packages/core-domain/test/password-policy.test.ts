import { describe, expect, it } from 'vitest';

import {
	COMMON_PASSWORD_BASES,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	evaluatePassword,
} from '../src/auth/password-policy';

describe('evaluatePassword — length', () => {
	it.each(['', 'short', 'elevenchars', 'a'.repeat(PASSWORD_MIN_LENGTH - 1)])('refuses %o', (password) => {
		expect(evaluatePassword(password)).toMatchObject({ acceptable: false, refusal: 'too_short' });
	});

	// The cap exists so an enormous body cannot be turned into an Argon2 denial of service.
	it('refuses a password past the cap', () => {
		expect(evaluatePassword('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toMatchObject({
			acceptable: false,
			refusal: 'too_long',
		});
	});

	it('accepts exactly the floor and exactly the cap', () => {
		const atFloor = 'harbour-tram';
		expect(atFloor).toHaveLength(PASSWORD_MIN_LENGTH);
		expect(evaluatePassword(atFloor)).toEqual({ acceptable: true });

		// Deliberately NOT `'q7'.repeat(128)`, which this suite first used: that is a two-character
		// unit repeated 128 times and the repeat rule refuses it, correctly. The cap and the
		// repeat rule are separate properties and a test of one must not trip the other.
		const atCap = `${'x7q'.repeat(85)}z`;
		expect(atCap).toHaveLength(PASSWORD_MAX_LENGTH);
		expect(evaluatePassword(atCap)).toEqual({ acceptable: true });
	});
});

describe('evaluatePassword — repeated', () => {
	// The rule that earns its place: a twelve-character floor accepts every one of these, and
	// no denylist of WORDS would ever catch them.
	it.each(['aaaaaaaaaaaa', 'abababababab', 'abcabcabcabc', '123123123123', '!@!@!@!@!@!@'])(
		'refuses %s',
		(password) => {
			expect(evaluatePassword(password)).toMatchObject({ acceptable: false, refusal: 'repeated' });
		},
	);

	// Three repetitions minimum, so an ordinary passphrase with a repeated half survives.
	it('does not fire on a password whose halves merely resemble each other', () => {
		expect(evaluatePassword('rivergate-rivergate-x').acceptable).toBe(true);
		expect(evaluatePassword('tulip tulip harbour').acceptable).toBe(true);
	});
});

describe('evaluatePassword — common', () => {
	it.each([
		'Password1234',
		'password1234',
		'PASSWORD1234',
		'p a s s w o r d 1',
		'p-a-s-s-w-o-r-d-1',
		'letmein12345',
		'Welcome123456',
		'SahaTextile2026',
		'qwertyuiop12',
	])('refuses the decorated common password %o', (password) => {
		expect(evaluatePassword(password)).toMatchObject({ acceptable: false, refusal: 'common' });
	});

	/**
	 * Every entry must be REACHABLE, which is the denylist equivalent of asking whether a test
	 * can fail. An entry that no submittable password can normalise onto is dead weight: it
	 * reads as coverage and provides none. An all-digit entry shorter than the floor is the way
	 * this goes wrong — padding it with digits changes the very characters the normaliser
	 * strips, so it can never be matched.
	 */
	it('has no unreachable entry', () => {
		const unreachable = COMMON_PASSWORD_BASES.filter((base) => {
			const candidate = base.length >= PASSWORD_MIN_LENGTH ? base : `${base}1234567890`.slice(0, 16);
			const decision = evaluatePassword(candidate);
			return decision.acceptable || decision.refusal !== 'common';
		});

		expect(unreachable).toEqual([]);
	});

	it('holds only normalised entries and no duplicates', () => {
		for (const base of COMMON_PASSWORD_BASES) expect(base).toMatch(/^[a-z0-9]+$/);
		expect(new Set(COMMON_PASSWORD_BASES).size).toBe(COMMON_PASSWORD_BASES.length);
	});

	// Exact match on the normalised form, not substring. A denylist that matched substrings
	// would refuse "textileworkerdaily" for containing "textile", which is a real password.
	it.each(['textileworkerdaily', 'accessible-harbour', 'administratively-so', 'monkeywrench-77'])(
		'accepts %o, which merely contains a listed term',
		(password) => {
			expect(evaluatePassword(password)).toEqual({ acceptable: true });
		},
	);
});

describe('evaluatePassword — the refusals themselves', () => {
	// These messages travel into HTTP responses. One that echoed the password would carry a
	// live credential into whatever logs that response.
	it('never echoes the password in a refusal message', () => {
		for (const password of ['Password1234', 'aaaaaaaaaaaa', 'short', 'x'.repeat(PASSWORD_MAX_LENGTH + 1)]) {
			const decision = evaluatePassword(password);
			expect(decision.acceptable).toBe(false);
			if (!decision.acceptable) expect(decision.message).not.toContain(password);
		}
	});

	it('accepts an ordinary strong passphrase', () => {
		for (const password of ['correct horse battery staple', 'Tn7$whistle-mango', 'জলপাইগুড়ি-tram-19']) {
			expect(evaluatePassword(password)).toEqual({ acceptable: true });
		}
	});
});
