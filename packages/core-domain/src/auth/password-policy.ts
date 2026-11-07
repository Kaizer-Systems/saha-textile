/**
 * Password strength policy.
 *
 * Pure and total, exactly like `pin-policy.ts` beside it: a string goes in and a verdict comes
 * out. Five surfaces set a password — storefront registration, storefront password reset,
 * admin invite acceptance, admin password change and admin password reset — and one shared
 * decision is what stops five implementations drifting apart.
 *
 * ## What is locked, and what this adds
 *
 * The owner lock is a twelve-character minimum plus a common-password denylist, for both
 * storefront and admin. Both are here. One structural rule is added beyond that literal lock —
 * `repeated` — because a twelve-character floor accepts `aaaaaaaaaaaa` and `abcabcabcabc`,
 * which no denylist of WORDS will ever catch and which nobody would defend as strong. It is
 * called out here rather than slipped in, so it can be removed if the owner disagrees.
 *
 * ## Why the denylist looks nothing like a "top 1000 passwords" list
 *
 * Because the length floor has already done most of that work. `123456`, `password`, `qwerty`,
 * `abc123` — the entire head of every leaked-credential list is under twelve characters and
 * cannot be submitted at all. Porting such a list verbatim would produce a few hundred entries
 * that can never match anything, which reads as thorough coverage while providing none.
 *
 * What actually survives the floor is a common word DECORATED until it is long enough:
 * `Password1234`, `qwerty123456`, `letmein12345!`. So the denylist stores BASE TERMS and the
 * comparison normalises the candidate down to its base — lower-cased, stripped of everything
 * that is not a letter or digit, then stripped of a trailing run of digits. `Password1234` and
 * `p a s s w o r d 9` both reduce to `password` and are both refused.
 *
 * ## What this policy deliberately does NOT do
 *
 * It does not compare the password against the user's own email, username or name. That is a
 * genuinely valuable rule — a password of `priya@example.com` reduced to `priyaexample` passes
 * everything here — but it needs the identity threaded into all five call sites, which is a
 * larger change than this one, and it is not part of the owner lock. Recorded as a known,
 * deliberate omission so a later reader raises it as a question rather than rediscovering it
 * as a gap.
 *
 * It also does not consult a breached-password service. The build prompt calls that a SEAM,
 * not a launch requirement.
 *
 * Nothing here ever echoes the password. A refusal names the PATTERN, never the value: these
 * messages travel into HTTP responses and could otherwise carry a live credential into a log.
 */

/** Owner lock 2026-06-29: twelve characters minimum, storefront and admin alike. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Upper bound, so an enormous body cannot be turned into an Argon2 denial of service. Matches
 * the contract's own cap; core re-checks because core cannot assume the contract ran.
 */
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordRefusal = 'too_short' | 'too_long' | 'repeated' | 'common';

export type PasswordPolicyDecision =
	| { acceptable: true }
	| {
			acceptable: false;
			refusal: PasswordRefusal;
			/** User-facing and safe to display. Never contains the password. */
			message: string;
	  };

/**
 * Base terms a password must not reduce to.
 *
 * A seed list, not a claim of completeness, and expected to grow by review — which is why it is
 * a plain exported constant. Entries are stored in NORMALISED form (lower case, letters and
 * digits only, no trailing digit run) because that is what candidates are reduced to before
 * comparison. An entry shorter than twelve characters is not dead weight: it is reached by
 * every decorated variant that IS long enough.
 *
 * Brand and locality terms are included deliberately. A back-office operator reaching for a
 * password thinks of the business first, and `SahaTextile2026!` is the single most predictable
 * credential this system will ever be offered.
 */
export const COMMON_PASSWORD_BASES: readonly string[] = [
	// The perennial head of every leaked-credential list, reachable here only when decorated.
	'password',
	'passwd',
	'passw',
	'pass',
	'mypassword',
	'newpassword',
	'oldpassword',
	'passwordpassword',
	'changeme',
	'letmein',
	'welcome',
	'secret',
	'default',
	'temporary',
	'temppassword',
	'iloveyou',
	'whatever',
	'trustno',
	'trustnoone',
	'freedom',
	'sunshine',
	'princess',
	'monkey',
	'dragon',
	'superman',
	'batman',
	'starwars',
	'football',
	'baseball',
	'basketball',
	'chocolate',
	'computer',
	'internet',
	'qwerty',
	'qwertyuiop',
	'qwertyuiopasdfghjkl',
	'asdfghjkl',
	'zxcvbnm',
	'qazwsxedc',
	// Long digit and letter runs, which the length floor does NOT exclude.
	// These must be at least `PASSWORD_MIN_LENGTH` themselves. A shorter all-digit entry is
	// UNREACHABLE: padding it to a submittable length can only add digits, and the normaliser
	// strips exactly those, so nothing ever reduces onto it. `0123456789` was here and was
	// caught by the reachability test rather than by review.
	'123456789012',
	'1234567890123456',
	'012345678901',
	'abcdefghijkl',
	'abcdefghijklmnop',
	// Role words an operator reaches for on a back-office account.
	'admin',
	'administrator',
	'adminadmin',
	'superadmin',
	'operator',
	'manager',
	'staff',
	'login',
	'access',
	// Brand, product and locality terms — the most predictable choices for THIS system.
	'sahatextile',
	'sahatextilecom',
	'sahatextiles',
	'textile',
	'textiles',
	'saree',
	'sarees',
	'kolkata',
	'india',
	'bengal',
];

const DENYLIST = new Set(COMMON_PASSWORD_BASES);

/**
 * Reduces a candidate to the form the denylist stores.
 *
 * Three steps, each earning its place: case is not a secret, decoration around a word is not a
 * secret, and a trailing run of digits is the single most common way a short common word is
 * stretched past a length requirement.
 */
function normalize(password: string): { stripped: string; base: string } {
	const stripped = password.toLowerCase().replace(/[^a-z0-9]/g, '');
	const base = stripped.replace(/\d+$/, '');
	return { stripped, base };
}

/**
 * True when the password is one short group typed over and over.
 *
 * Any unit up to a third of the length, so `aaaaaaaaaaaa`, `abababababab` and `abcabcabcabc`
 * all fall to it. Requiring at least three repetitions is what keeps this from firing on an
 * ordinary passphrase that happens to have a repeated half.
 */
function hasRepeatingUnit(password: string): boolean {
	const length = password.length;
	for (let unit = 1; unit <= Math.floor(length / 3); unit += 1) {
		if (length % unit !== 0) continue;
		if (password.slice(0, unit).repeat(length / unit) === password) return true;
	}
	return false;
}

/**
 * Decides whether a password may be used as a credential.
 *
 * Length first, because it is the owner-locked floor and because every later rule reads better
 * against a candidate that has already cleared it.
 */
export function evaluatePassword(password: string): PasswordPolicyDecision {
	if (password.length < PASSWORD_MIN_LENGTH) {
		return {
			acceptable: false,
			refusal: 'too_short',
			message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
		};
	}

	if (password.length > PASSWORD_MAX_LENGTH) {
		return {
			acceptable: false,
			refusal: 'too_long',
			message: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
		};
	}

	if (hasRepeatingUnit(password)) {
		return {
			acceptable: false,
			refusal: 'repeated',
			message: 'Choose a password that does not repeat the same characters.',
		};
	}

	const { stripped, base } = normalize(password);
	if (DENYLIST.has(stripped) || DENYLIST.has(base)) {
		return {
			acceptable: false,
			refusal: 'common',
			message: 'That password is too commonly chosen. Choose another.',
		};
	}

	return { acceptable: true };
}
