import { describe, expect, it } from 'vitest';

import { ADMIN_PIN_DENYLIST, ADMIN_PIN_LENGTH, evaluateAdminPin } from '../src/auth/pin-policy';

/** Every PIN in the keyspace, so coverage claims below are counted rather than asserted. */
const allPins = Array.from({ length: 10 ** ADMIN_PIN_LENGTH }, (_, value) =>
	String(value).padStart(ADMIN_PIN_LENGTH, '0'),
);

describe('evaluateAdminPin — shape', () => {
	// Core cannot assume the Zod contract ran first. A policy that only looked for patterns
	// would accept a five-digit PIN, or a word, on the way past.
	it.each(['', '12345', '1234567', '12a456', ' 123456', '123456 ', '१२३४५६'])('refuses %o', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'shape' });
	});
});

describe('evaluateAdminPin — repeated', () => {
	it.each(['000000', '111111', '999999'])('refuses one digit six times: %s', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'repeated' });
	});

	// The reason the rule is written as "a unit that divides six" rather than "all digits
	// equal": these feel varied to the person choosing them and are not.
	it.each(['121212', '858585', '123123', '407407'])('refuses a repeated group: %s', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'repeated' });
	});

	it('does not mistake an incidental repeat for a repeating unit', () => {
		expect(evaluateAdminPin('114723')).toEqual({ acceptable: true });
		expect(evaluateAdminPin('182838')).toEqual({ acceptable: true });
	});
});

describe('evaluateAdminPin — sequential', () => {
	it.each(['123456', '012345', '456789'])('refuses an ascending run: %s', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'sequential' });
	});

	it.each(['654321', '987654', '543210'])('refuses a descending run: %s', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'sequential' });
	});

	// `890123` is one finger motion, exactly like `123456`. Treating the 9→0 boundary as a
	// defence would draw a line the keypad does not have.
	it.each(['890123', '901234', '210987', '109876'])('refuses a run that wraps past 9: %s', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'sequential' });
	});

	// Only a step of exactly ±1 is a run. A step of two is a different pattern, and the ones
	// worth refusing are on the denylist by name rather than by a rule that over-reaches.
	it('does not treat every arithmetic progression as a run', () => {
		expect(evaluateAdminPin('147036')).toEqual({ acceptable: true });
	});
});

describe('evaluateAdminPin — denylist', () => {
	it.each(['147258', '102030', '112233', '314159'])('refuses %s', (pin) => {
		expect(evaluateAdminPin(pin)).toMatchObject({ acceptable: false, refusal: 'denylisted' });
	});

	// A denylist entry that a structural rule already catches is dead weight: it reads as
	// coverage while adding none, and it hides the fact that the rule is doing the work.
	it('contains no entry a structural rule already refuses', () => {
		const redundant = ADMIN_PIN_DENYLIST.filter((pin) => {
			const decision = evaluateAdminPin(pin);
			return !decision.acceptable && decision.refusal !== 'denylisted';
		});
		expect(redundant).toEqual([]);
	});

	it('holds only well-formed PINs and no duplicates', () => {
		for (const pin of ADMIN_PIN_DENYLIST) expect(pin).toMatch(/^\d{6}$/);
		expect(new Set(ADMIN_PIN_DENYLIST).size).toBe(ADMIN_PIN_DENYLIST.length);
	});
});

describe('evaluateAdminPin — the refusals themselves', () => {
	// These messages travel into HTTP responses. A message that echoed the PIN would carry a
	// live credential into whatever logs or records that response.
	it('never echoes the PIN in a refusal message', () => {
		for (const pin of [...ADMIN_PIN_DENYLIST, '000000', '123456', '12345']) {
			const decision = evaluateAdminPin(pin);
			expect(decision.acceptable).toBe(false);
			if (!decision.acceptable) expect(decision.message).not.toContain(pin);
		}
	});

	it('reports the most general problem when several rules apply', () => {
		// Both a repeat and a run down from 0 — the useful sentence is the repeat.
		expect(evaluateAdminPin('000000')).toMatchObject({ refusal: 'repeated' });
	});
});

describe('evaluateAdminPin — keyspace cost', () => {
	const refused = allPins.filter((pin) => !evaluateAdminPin(pin).acceptable);

	/**
	 * The policy's whole justification is that it removes what a guesser tries inside the
	 * five attempts the account lock allows. That argument fails in both directions if the
	 * number is not known: too few and it is decoration, too many and it is refusing
	 * arbitrary choices. 1,148 of 1,000,000 is roughly one in 871 — small enough that an
	 * operator picking at random will effectively never meet it.
	 */
	it('removes a known, small share of the keyspace', () => {
		expect(refused.length).toBe(1148);
		expect(refused.length / allPins.length).toBeLessThan(0.002);
	});

	it('leaves an overwhelming majority of PINs acceptable', () => {
		expect(allPins.length - refused.length).toBeGreaterThan(998_000);
	});
});
