/**
 * Admin PIN strength policy.
 *
 * Pure and total. No clock, no storage, no framework — a string goes in and a verdict comes
 * out, so the same rule can be applied at invite acceptance, at Security Settings, and by
 * any future surface without three implementations drifting apart.
 *
 * ## Why a six-digit credential needs a policy at all
 *
 * A PIN has a million possible values, which sounds ample until you notice that people do
 * not choose uniformly from a million. They choose `123456`, they choose their birth year
 * twice, they choose the digit under their thumb six times. The owner lock pairs the PIN
 * with a five-failure account lock precisely because the keyspace is small; that lock stops
 * ONLINE guessing, and it is the only thing that does. This policy removes the handful of
 * values an attacker would try inside those five attempts.
 *
 * ## Why it lives here and not in the Zod schema
 *
 * `AdminPin` in `packages/contracts` is a shape check — six digits — and is shared with the
 * browser. Strength is a domain rule: it decides whether a credential is acceptable, it will
 * grow entries over time, and a client must never be the thing enforcing it. The contract
 * comment has named core-domain as this rule's home since the schema was written; this is
 * that module.
 *
 * ## What this policy deliberately does NOT reject
 *
 * Date-shaped PINs — `DDMMYY`, `MMDDYY`, a year repeated — are, in every published analysis
 * of real PIN choices, the single largest weak class, and they are not rejected here. Two
 * reasons. Rejecting every valid date removes roughly 3.6% of the keyspace and would refuse
 * an operator's genuinely arbitrary choice that often, with an explanation that reads as
 * arbitrary in return. More importantly, the owner locked three named rules — weak, repeated
 * and sequential — and a structural fourth is a policy decision that belongs to the owner
 * rather than to this file. It is recorded here as a known, deliberate omission rather than
 * an oversight, so that a later reader can raise it as a question instead of rediscovering it
 * as a gap.
 *
 * Nothing here ever echoes the PIN. A refusal message names the PATTERN, never the value:
 * these messages travel into HTTP responses and could otherwise carry a live credential into
 * a log or an error tracker.
 */

/** The locked admin PIN length (owner lock 2026-06-29 / UX lock 2026-07-23). */
export const ADMIN_PIN_LENGTH = 6;

/**
 * Why a PIN was refused.
 *
 * `shape` is defence in depth rather than duplication. Core cannot assume its caller ran the
 * contract first, and a policy that silently accepted `12345` or `abcdef` because it only
 * looked for patterns would be worse than no policy.
 */
export type PinRefusal = 'shape' | 'repeated' | 'sequential' | 'denylisted';

export type PinPolicyDecision =
	| { acceptable: true }
	| {
			acceptable: false;
			refusal: PinRefusal;
			/** Operator-facing and safe to display. Never contains the PIN. */
			message: string;
	  };

/**
 * PINs a guesser tries early that no structural rule above catches.
 *
 * A seed list, not a claim of completeness — it is expected to grow by review, which is why
 * it is a plain exported constant rather than a generated artefact. Entries are things a
 * human reaches for that are not a repeat and not a run: keypad columns and diagonals,
 * doubled and tripled digit groups, famous constants, and round numbers.
 *
 * Anything already caught by the repeat or run rules is deliberately absent — a duplicate
 * entry would be dead weight that reads as coverage. The test suite enforces that.
 */
export const ADMIN_PIN_DENYLIST: readonly string[] = [
	// Keypad columns, rows and diagonals — traced with a finger rather than chosen.
	'147258',
	'258369',
	'369258',
	'741852',
	'852963',
	'963852',
	'159357',
	'357159',
	'753951',
	'951753',
	'789456',
	'987456',
	'456987',
	// Grouped digits: pairs and triples that feel varied and are not.
	'112233',
	'332211',
	'111222',
	'222111',
	'122333',
	'112211',
	// Near-runs and interleaved runs.
	'121314',
	'102030',
	'123654',
	'654123',
	'123321',
	'321123',
	'135791',
	'013579',
	'246810',
	'024680',
	'112358',
	// Round numbers and famous constants.
	'100000',
	'999000',
	'123000',
	'000123',
	'111000',
	'000111',
	'314159',
	'271828',
	// The joke choices that top every leaked-credential list — `696969`, `420420` — are
	// deliberately not here. Each is a two- or three-digit group typed twice, so the repeat
	// rule already refuses them, and listing them would only make this list look longer.
];

const DENYLIST = new Set(ADMIN_PIN_DENYLIST);

const SHAPE = new RegExp(`^\\d{${ADMIN_PIN_LENGTH}}$`);

/**
 * True when the PIN is one short group typed repeatedly.
 *
 * Units of 1, 2 and 3 are exactly the lengths that divide six, so this covers `777777`,
 * `121212` and `123123` in one rule. Catching only six-identical-digits would leave the
 * other two — which feel varied to the person choosing them and are not.
 */
const hasRepeatingUnit = (pin: string): boolean =>
	[1, 2, 3].some((unit) => pin.slice(0, unit).repeat(ADMIN_PIN_LENGTH / unit) === pin);

/**
 * True when every step from one digit to the next is `step`, counting around from 9 to 0.
 *
 * The wraparound is intentional. `890123` is typed with the same single motion as `123456`
 * and is no harder to guess, so treating the 9→0 boundary as a defence would be an arbitrary
 * line drawn where the keypad has none.
 */
const isRunWithStep = (pin: string, step: number): boolean => {
	for (let index = 1; index < pin.length; index += 1) {
		const previous = Number(pin[index - 1]);
		const current = Number(pin[index]);
		if ((previous + step + 10) % 10 !== current) return false;
	}
	return true;
};

const isSequential = (pin: string): boolean => isRunWithStep(pin, 1) || isRunWithStep(pin, -1);

/**
 * Decides whether a PIN may be used as a credential.
 *
 * Checks run cheapest-and-broadest first, so the refusal an operator receives describes the
 * most general thing wrong with their choice. `000000` is reported as repeated rather than
 * denylisted because "every digit is the same" is the useful sentence; being on a list is a
 * fact about our list, not about their PIN.
 */
export function evaluateAdminPin(pin: string): PinPolicyDecision {
	if (!SHAPE.test(pin)) {
		return {
			acceptable: false,
			refusal: 'shape',
			message: `Choose a ${ADMIN_PIN_LENGTH}-digit PIN.`,
		};
	}

	if (hasRepeatingUnit(pin)) {
		return {
			acceptable: false,
			refusal: 'repeated',
			message: 'Choose a PIN that does not repeat the same digits.',
		};
	}

	if (isSequential(pin)) {
		return {
			acceptable: false,
			refusal: 'sequential',
			message: 'Choose a PIN that is not a run of consecutive digits.',
		};
	}

	if (DENYLIST.has(pin)) {
		return {
			acceptable: false,
			refusal: 'denylisted',
			message: 'That PIN is too commonly chosen. Choose another.',
		};
	}

	return { acceptable: true };
}
