/**
 * Reduces a client address to the key a rate limit should count against.
 *
 * IPv4 is taken as-is and treated as coarse: on Indian consumer networks it is
 * carrier-grade NAT, so one address can stand for thousands of unrelated subscribers.
 *
 * IPv6 is reduced to its `/64` prefix, which is the opposite situation and worth
 * exploiting. A subscriber is allocated a whole /64 (often a /56 or shorter), so the prefix
 * identifies one household or handset while the low 64 bits are just whichever address the
 * device happened to pick — privacy extensions rotate them, sometimes hourly. Counting the
 * full address would let a single device evade a limit simply by ageing its address, and
 * counting a shared IPv4 punishes strangers. The prefix is both fairer and sharper, and
 * since Indian mobile traffic is heavily IPv6, it applies to most real users.
 *
 * Pure string handling on purpose: no `node:net`, no allocation of an address parser, and
 * nothing that could throw out of an authentication path. An unparseable value falls back to
 * the trimmed input so the key stays stable rather than collapsing every malformed address
 * into one shared bucket.
 */

const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;

export function rateLimitClientScope(address: string): string {
	const cleaned = strip(address);
	if (cleaned === '') return '';
	if (!cleaned.includes(':')) return cleaned;

	const groups = expandIpv6(cleaned);
	if (!groups) return cleaned;

	// `::ffff:203.0.113.5` is an IPv4 address wearing an IPv6 coat; counting it as a /64
	// would put every IPv4-mapped client in the world into one bucket.
	const mapped = mappedIpv4(groups);
	if (mapped) return mapped;

	return `${groups
		.slice(0, PREFIX_GROUPS)
		.map((group) => group.replace(/^0+(?=.)/, ''))
		.join(':')}::/64`;
}

/** Removes brackets, a zone identifier, and surrounding whitespace. */
function strip(address: string): string {
	const trimmed = address.trim().replace(/^\[/, '').replace(/\]$/, '');
	const zone = trimmed.indexOf('%');
	return (zone === -1 ? trimmed : trimmed.slice(0, zone)).toLowerCase();
}

/** Expands to exactly eight 4-digit groups, or `null` when the input is not an IPv6 address. */
function expandIpv6(address: string): string[] | null {
	const halves = address.split('::');
	if (halves.length > 2) return null;

	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;

	// A trailing dotted quad occupies the last two groups (`::ffff:203.0.113.5`).
	const last = (tail ?? head).at(-1);
	let embedded: string[] = [];
	if (last?.includes('.')) {
		const quad = parseIpv4Groups(last);
		if (!quad) return null;
		embedded = quad;
		if (tail) tail.pop();
		else head.pop();
	}

	const groups = tail === null ? [...head, ...embedded] : fill([...head], [...tail, ...embedded]);
	if (!groups || groups.length !== IPV6_GROUPS) return null;

	const normalized: string[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
		normalized.push(group.padStart(4, '0'));
	}
	return normalized;
}

/** Inserts the zero run a `::` stands for. */
function fill(head: string[], tail: string[]): string[] | null {
	const missing = IPV6_GROUPS - head.length - tail.length;
	if (missing < 0) return null;
	return [...head, ...Array<string>(missing).fill('0'), ...tail];
}

/** Converts `203.0.113.5` into the two groups it occupies. */
function parseIpv4Groups(quad: string): string[] | null {
	const octets = quad.split('.');
	if (octets.length !== 4) return null;

	const values: number[] = [];
	for (const octet of octets) {
		if (!/^\d{1,3}$/.test(octet)) return null;
		const value = Number(octet);
		if (value > 255) return null;
		values.push(value);
	}

	const high = ((values[0] as number) << 8) | (values[1] as number);
	const low = ((values[2] as number) << 8) | (values[3] as number);
	return [high.toString(16), low.toString(16)];
}

/** Returns the dotted form when the address is IPv4-mapped, otherwise `null`. */
function mappedIpv4(groups: string[]): string | null {
	const isMapped = groups.slice(0, 5).every((group) => group === '0000') && groups[5] === 'ffff';
	if (!isMapped) return null;

	const high = parseInt(groups[6] as string, 16);
	const low = parseInt(groups[7] as string, 16);
	return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}
