const MAX_AMOUNT_MINOR = 999_999_999_999;

const isMinorAmount = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_MINOR;

/** `149910` to `1499.10`, the Numeric (12,2) form CCAvenue expects. Whole integers only. */
export function formatAmount(amountMinor: number): string | null {
	if (!isMinorAmount(amountMinor)) return null;
	const paise = String(amountMinor % 100).padStart(2, '0');
	return `${Math.floor(amountMinor / 100)}.${paise}`;
}

/**
 * `1499.1`, `1499.10` and the JSON number 1499.1 all to `149910`, with no floating-point
 * arithmetic. Null for anything that is not a plain amount of at most two decimal places.
 */
export function parseAmount(value: string | number): number | null {
	const match = /^(\d{1,10})(?:\.(\d{1,2})0*)?$/.exec(String(value).trim());
	if (!match) return null;
	return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/**
 * Reads a decrypted `name=value&name=value` string.
 *
 * CCAvenue does not URL-encode these values, so a value holding `&` or `=` cannot be recovered
 * exactly. Text a customer typed on the billing page can therefore smuggle in a second
 * `order_status` or `amount`, so a repeated name returns null and the whole message is refused.
 * A fragment with no `=` is the tail of an address that held an `&`, and is dropped.
 */
export function parsePairs(plainText: string): Record<string, string> | null {
	const pairs = new Map<string, string>();
	for (const segment of plainText.split('&')) {
		const separator = segment.indexOf('=');
		if (separator <= 0) continue;
		const name = segment.slice(0, separator);
		if (pairs.has(name)) return null;
		pairs.set(name, segment.slice(separator + 1));
	}
	return Object.fromEntries(pairs);
}

/** The kits join fields as `name=value&` with a trailing `&`. Values are checked before this. */
export function joinPairs(pairs: Readonly<Record<string, string>>): string {
	return Object.entries(pairs)
		.map(([name, value]) => `${name}=${value}&`)
		.join('');
}

/** CCAvenue prints an absent value as an empty string or the word `null`. */
export function presentOrNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed && trimmed !== 'null' ? trimmed : null;
}
