import { describe, expect, it } from 'vitest';

import { AUTH_RATE_LIMIT_POLICY, decideRateLimit } from '../src/auth/rate-limit-policy';
import type { AuthRateLimitAction, RateLimitActionPolicy } from '../src/auth/rate-limit-policy';

const actions = Object.keys(AUTH_RATE_LIMIT_POLICY) as AuthRateLimitAction[];

describe('decideRateLimit', () => {
	const policy: RateLimitActionPolicy = {
		counting: 'failures',
		identifier: { max: 3, windowSeconds: 900 },
		ip: { max: 10, windowSeconds: 900 },
	};

	it('allows a caller below both ceilings', () => {
		expect(decideRateLimit(policy, { identifier: 2, ip: 9 })).toEqual({ allowed: true });
	});

	// `max` is the number of recorded events tolerated, so refusal begins AT it rather than
	// one past it. Off by one here is the difference between five PIN attempts and six.
	it('refuses at the ceiling, not one past it', () => {
		expect(decideRateLimit(policy, { identifier: 3, ip: 0 })).toMatchObject({ allowed: false });
		expect(decideRateLimit(policy, { identifier: 2, ip: 0 })).toEqual({ allowed: true });
	});

	// The identifier is the sharp, account-specific control. Reporting the shared address
	// first would tell a caller they are blocked by strangers when their own account is the
	// one over its budget.
	it('reports the identifier scope first when both are exceeded', () => {
		expect(decideRateLimit(policy, { identifier: 3, ip: 10 })).toMatchObject({
			allowed: false,
			scope: 'identifier',
		});
	});

	it('reports the ip scope when only the address is over', () => {
		expect(decideRateLimit(policy, { identifier: 0, ip: 10 })).toMatchObject({ allowed: false, scope: 'ip' });
	});

	it('returns the window as the retry hint', () => {
		expect(decideRateLimit(policy, { identifier: 5, ip: 0 })).toMatchObject({ retryAfterSeconds: 900 });
		expect(decideRateLimit(policy, { identifier: 0, ip: 20 })).toMatchObject({ retryAfterSeconds: 900 });
	});

	it('ignores a scope the action does not limit', () => {
		const ipOnly: RateLimitActionPolicy = { counting: 'failures', ip: { max: 2, windowSeconds: 60 } };
		expect(decideRateLimit(ipOnly, { identifier: 9999, ip: 1 })).toEqual({ allowed: true });
	});

	it('ignores a scope whose count was not measured', () => {
		expect(decideRateLimit(policy, { ip: 1 })).toEqual({ allowed: true });
	});
});

describe('AUTH_RATE_LIMIT_POLICY', () => {
	it.each(actions)('%s declares at least one scope and a positive window', (action) => {
		const entry = AUTH_RATE_LIMIT_POLICY[action];
		expect(entry.identifier ?? entry.ip).toBeDefined();
		for (const rule of [entry.identifier, entry.ip]) {
			if (!rule) continue;
			expect(rule.max).toBeGreaterThan(0);
			expect(rule.windowSeconds).toBeGreaterThan(0);
		}
	});

	// The whole point of the policy: an action that spends a real resource on success cannot
	// count failures, because the cost lands whether or not the caller was honest.
	it('counts attempts for every action that sends mail or creates an account', () => {
		for (const action of ['storefront_register', 'otp_request', 'password_reset'] as const) {
			expect(AUTH_RATE_LIMIT_POLICY[action].counting).toBe('attempts');
		}
	});

	it('counts failures for every credential-guessing action', () => {
		for (const action of ['storefront_login', 'admin_login', 'admin_pin_login', 'otp_verify'] as const) {
			expect(AUTH_RATE_LIMIT_POLICY[action].counting).toBe('failures');
		}
	});

	// Storefront and admin login shared one bucket, so customer traffic could exhaust the
	// budget the back office depends on. Separate entries are the fix; this pins it.
	it('gives storefront and admin login independent budgets', () => {
		expect(AUTH_RATE_LIMIT_POLICY.storefront_login).not.toBe(AUTH_RATE_LIMIT_POLICY.admin_login);
		expect(AUTH_RATE_LIMIT_POLICY.storefront_login.ip?.max).not.toBe(AUTH_RATE_LIMIT_POLICY.admin_login.ip?.max);
	});

	/**
	 * The owner-locked "five failed PIN attempts" is a per-ACCOUNT lock enforced through
	 * `pinLockedUntil`. A per-address ceiling of five was a different control wearing the
	 * same number, and behind carrier-grade NAT it let any five failures lock PIN login for
	 * every operator sharing that address.
	 */
	it('does not impose an account-sized PIN ceiling on a shared address', () => {
		expect(AUTH_RATE_LIMIT_POLICY.admin_pin_login.identifier).toBeUndefined();
		expect(AUTH_RATE_LIMIT_POLICY.admin_pin_login.ip?.max).toBeGreaterThan(50);
	});

	// Carrier-grade NAT means one IPv4 address can stand for thousands of subscribers, so an
	// address ceiling must always be materially looser than the per-account one.
	it.each(actions)('%s keeps the address ceiling looser than the identifier ceiling', (action) => {
		const { identifier, ip } = AUTH_RATE_LIMIT_POLICY[action];
		if (!identifier || !ip) return;
		expect(ip.max).toBeGreaterThan(identifier.max);
	});
});
