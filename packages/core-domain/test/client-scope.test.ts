import { describe, expect, it } from 'vitest';

import { rateLimitClientScope } from '../src/auth/client-scope';

describe('rateLimitClientScope', () => {
	describe('IPv4', () => {
		it.each(['203.0.113.5', '127.0.0.1', '10.20.30.40'])('passes %s through unchanged', (address) => {
			expect(rateLimitClientScope(address)).toBe(address);
		});

		// `::ffff:203.0.113.5` is an IPv4 address in IPv6 clothing. Treating it as a /64 would
		// put every IPv4-mapped client on earth into one bucket.
		it('unwraps an IPv4-mapped address', () => {
			expect(rateLimitClientScope('::ffff:203.0.113.5')).toBe('203.0.113.5');
			expect(rateLimitClientScope('::FFFF:8.8.8.8')).toBe('8.8.8.8');
		});
	});

	describe('IPv6 reduced to its prefix', () => {
		// A subscriber holds a whole /64, and privacy extensions rotate the low bits — often
		// hourly. Counting the full address would let one handset shed a limit by ageing its
		// address, so every address in a /64 must land on the same key.
		it('maps every address in one /64 to the same key', () => {
			const first = rateLimitClientScope('2405:201:abcd:1234:5678:90ab:cdef:1');
			const second = rateLimitClientScope('2405:201:abcd:1234:ffff:ffff:ffff:ffff');

			expect(first).toBe('2405:201:abcd:1234::/64');
			expect(second).toBe(first);
		});

		it('separates different /64s', () => {
			expect(rateLimitClientScope('2405:201:abcd:1234::1')).not.toBe(
				rateLimitClientScope('2405:201:abcd:1235::1'),
			);
		});

		it.each([
			['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0::/64'],
			['2001:db8::1', '2001:db8:0:0::/64'],
			['fe80::1', 'fe80:0:0:0::/64'],
			['::1', '0:0:0:0::/64'],
		])('normalizes %s to %s', (address, expected) => {
			expect(rateLimitClientScope(address)).toBe(expected);
		});

		it('is case-insensitive', () => {
			expect(rateLimitClientScope('2405:201:ABCD:1234::1')).toBe(rateLimitClientScope('2405:201:abcd:1234::1'));
		});

		it('strips brackets and a zone identifier', () => {
			expect(rateLimitClientScope('[2405:201:abcd:1234::1]')).toBe('2405:201:abcd:1234::/64');
			expect(rateLimitClientScope('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
		});
	});

	describe('malformed input', () => {
		// Falling back to the trimmed value keeps the key stable. Collapsing every unparseable
		// address to one constant would let a single attacker exhaust a bucket shared with
		// everyone else whose address failed to parse.
		it.each([
			['2405:201:abcd:1234:5678:90ab:cdef:1:2:3', '2405:201:abcd:1234:5678:90ab:cdef:1:2:3'],
			['not-an-address', 'not-an-address'],
			['2001::db8::1', '2001::db8::1'],
			['2001:db8:zzzz::1', '2001:db8:zzzz::1'],
			['::ffff:999.0.0.1', '::ffff:999.0.0.1'],
		])('returns %s unchanged rather than throwing', (address, expected) => {
			expect(rateLimitClientScope(address)).toBe(expected);
		});

		it('handles an empty address', () => {
			expect(rateLimitClientScope('')).toBe('');
			expect(rateLimitClientScope('   ')).toBe('');
		});

		// It runs inside an authentication path, where an exception would become a 500 on the
		// login endpoint rather than a rate-limit decision.
		it.each(['', ':', '::', ':::', '1:2:3:4:5:6:7:8:9', '%', '[]', '....'])('never throws on %s', (address) => {
			expect(() => rateLimitClientScope(address)).not.toThrow();
		});
	});
});
